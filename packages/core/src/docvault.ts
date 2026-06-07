import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DocStore, assertSafeSegment, type CreateDocInput } from './doc.js';
import { importFile } from './import/index.js';
import { Indexer } from './indexer.js';
import type {
  Doc,
  DocMeta,
  Product,
  SearchHit,
  SearchOptions,
  TrashEntry,
  VaultConfig,
} from './types.js';
import { Vault } from './vault.js';
import { VaultWatcher, type VaultChange } from './watcher.js';

/**
 * The primary entry point for working with a vault. Composes the filesystem
 * doc store, the SQLite index, and the file watcher behind one API used by both
 * the MCP server and the desktop app.
 */
export class DocVault {
  readonly vault: Vault;
  readonly docs: DocStore;
  readonly index: Indexer;
  private watcher: VaultWatcher | null = null;

  private constructor(vault: Vault) {
    this.vault = vault;
    this.docs = new DocStore(vault);
    this.index = new Indexer(vault);
  }

  /** Open (creating if needed) a vault rooted at `root` and build its index. */
  static async open(root: string): Promise<DocVault> {
    const vault = new Vault(root);
    await vault.ensure();
    const dv = new DocVault(vault);
    await dv.reindexAll();
    await dv.purgeExpiredTrash();
    return dv;
  }

  /** How long a trashed item is kept before it is permanently purged. */
  static readonly TRASH_TTL_MS = 24 * 60 * 60 * 1000;

  /** Rebuild the entire index from the markdown files on disk. */
  async reindexAll(): Promise<number> {
    this.index.clear();
    const paths = await this.docs.list();
    let count = 0;
    for (const relPath of paths) {
      try {
        this.index.upsert(await this.docs.read(relPath));
        count++;
      } catch {
        /* skip unreadable file */
      }
    }
    return count;
  }

  // --- Reads -------------------------------------------------------------

  search(opts: SearchOptions): SearchHit[] {
    return this.index.search(opts);
  }

  listDocs(opts: { product?: string; tag?: string } = {}): DocMeta[] {
    return this.index.listDocs(opts);
  }

  getMeta(id: string): DocMeta | null {
    return this.index.getById(id);
  }

  /** Read full doc content by id (via index) or by vault-relative path. */
  async readDoc(idOrPath: string): Promise<Doc> {
    const meta = this.index.getById(idOrPath);
    return this.docs.read(meta ? meta.relPath : idOrPath);
  }

  backlinks(id: string): DocMeta[] {
    return this.index.backlinks(id);
  }

  listTags(): { tag: string; count: number }[] {
    return this.index.listTags();
  }

  /** List products = top-level folders under docs/, enriched by product.json. */
  async listProducts(): Promise<Product[]> {
    let entries;
    try {
      entries = await readdir(this.vault.docsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const counts = new Map<string, number>();
    for (const d of this.index.listDocs()) {
      if (d.product) counts.set(d.product, (counts.get(d.product) ?? 0) + 1);
    }
    const products: Product[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const cfg = await this.readProductConfig(slug);
      products.push({
        slug,
        title: cfg.title ?? slug,
        ...(cfg.icon ? { icon: cfg.icon } : {}),
        ...(cfg.color ? { color: cfg.color } : {}),
        ...(cfg.order !== undefined ? { order: cfg.order } : {}),
        docCount: counts.get(slug) ?? 0,
      });
    }
    return products.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
  }

  private async readProductConfig(
    slug: string,
  ): Promise<Partial<Pick<Product, 'title' | 'icon' | 'color' | 'order'>>> {
    try {
      const raw = await readFile(path.join(this.vault.docsDir, slug, 'product.json'), 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data !== 'object' || data === null) return {};
      // Only accept fields of the expected type; ignore anything malformed.
      return {
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
        ...(typeof data.icon === 'string' ? { icon: data.icon } : {}),
        ...(typeof data.color === 'string' ? { color: data.color } : {}),
        ...(typeof data.order === 'number' ? { order: data.order } : {}),
      };
    } catch {
      return {};
    }
  }

  // --- Writes ------------------------------------------------------------

  async createProduct(
    slug: string,
    meta: { title: string; icon?: string; color?: string; order?: number },
  ): Promise<Product> {
    assertSafeSegment(slug, 'product slug');
    const dir = path.join(this.vault.docsDir, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'product.json'), JSON.stringify(meta, null, 2), 'utf8');
    return { slug, docCount: 0, ...meta };
  }

  async createDoc(input: CreateDocInput): Promise<Doc> {
    const doc = await this.docs.create(input);
    this.index.upsert(doc);
    return doc;
  }

  async updateDoc(
    relPath: string,
    patch: Parameters<DocStore['update']>[1],
  ): Promise<Doc> {
    const doc = await this.docs.update(relPath, patch);
    this.index.upsert(doc);
    return doc;
  }

  /** Soft-delete a single doc: move it to trash and drop it from the index. */
  async trashDoc(relPath: string): Promise<void> {
    let title = path.basename(relPath);
    try {
      title = (await this.docs.read(relPath)).frontmatter.title;
    } catch {
      /* unreadable/missing — fall back to the filename */
    }
    const trashPath = await this.docs.trash(relPath);
    this.index.removeByPath(relPath);
    await this.addTrashEntry({
      kind: 'doc',
      relPath,
      trashPath,
      title,
      deletedAt: new Date().toISOString(),
    });
  }

  /**
   * Soft-delete a whole product: move its docs/<slug> folder (docs + product.json)
   * to trash, drop every doc it contained from the index, and record it for
   * restore. The folder is recoverable until auto-purged.
   */
  async deleteProduct(slug: string): Promise<void> {
    assertSafeSegment(slug, 'product slug');
    const relDir = `docs/${slug}`;
    const cfg = await this.readProductConfig(slug);
    const title = cfg.title ?? slug;
    for (const d of this.index.listDocs({ product: slug })) {
      this.index.removeByPath(d.relPath);
    }
    const trashPath = await this.docs.trash(relDir);
    await this.addTrashEntry({
      kind: 'product',
      relPath: relDir,
      trashPath,
      title,
      deletedAt: new Date().toISOString(),
    });
  }

  /** List trashed items, purging any that have outlived the retention window. */
  async listTrash(): Promise<TrashEntry[]> {
    const cfg = await this.purgeExpiredTrash();
    return cfg.trash;
  }

  /** Restore a trashed doc/product back to its original location and re-index it. */
  async restoreTrash(trashPath: string): Promise<void> {
    const cfg = await this.vault.readConfig();
    const entry = cfg.trash.find((e) => e.trashPath === trashPath);
    if (!entry) throw new Error(`No trash entry: ${trashPath}`);
    await this.docs.restore(entry.trashPath, entry.relPath);
    await this.reindexUnder(entry.relPath);
    await this.vault.updateConfig({ trash: cfg.trash.filter((e) => e.trashPath !== trashPath) });
  }

  /** Permanently delete trash entries older than the retention window. */
  async purgeExpiredTrash(maxAgeMs = DocVault.TRASH_TTL_MS): Promise<VaultConfig> {
    const cfg = await this.vault.readConfig();
    const now = Date.now();
    const keep: TrashEntry[] = [];
    for (const entry of cfg.trash) {
      if (now - new Date(entry.deletedAt).getTime() > maxAgeMs) {
        await this.docs.purge(entry.trashPath).catch(() => {
          /* already gone */
        });
      } else {
        keep.push(entry);
      }
    }
    if (keep.length === cfg.trash.length) return cfg;
    return this.vault.updateConfig({ trash: keep });
  }

  /** Append a trash entry (most-recent first) to the persisted config. */
  private async addTrashEntry(entry: TrashEntry): Promise<void> {
    const cfg = await this.vault.readConfig();
    await this.vault.updateConfig({ trash: [entry, ...cfg.trash] });
  }

  /** Re-index a restored doc, or every doc under a restored product folder. */
  private async reindexUnder(relPath: string): Promise<void> {
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    for (const p of await this.docs.list()) {
      if (p !== relPath && !p.startsWith(prefix)) continue;
      try {
        this.index.upsert(await this.docs.read(p));
      } catch {
        /* skip unreadable file */
      }
    }
  }

  /** Add an explicit outbound link from one doc to a target doc id. */
  async linkDocs(fromPath: string, targetId: string): Promise<Doc> {
    const doc = await this.docs.read(fromPath);
    const links = new Set(doc.frontmatter.links ?? []);
    links.add(targetId);
    doc.frontmatter.links = [...links];
    const saved = await this.docs.write(doc);
    this.index.upsert(saved);
    return saved;
  }

  async importFile(srcAbsPath: string, opts: { tags?: string[] } = {}): Promise<Doc> {
    const result = await importFile(this.vault, srcAbsPath, opts);
    this.index.upsert(result.doc);
    return result.doc;
  }

  // --- Config helpers ----------------------------------------------------

  readConfig(): Promise<VaultConfig> {
    return this.vault.readConfig();
  }

  updateConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    return this.vault.updateConfig(patch);
  }

  async toggleStar(docId: string): Promise<boolean> {
    const cfg = await this.vault.readConfig();
    const has = cfg.starred.includes(docId);
    const starred = has ? cfg.starred.filter((x) => x !== docId) : [...cfg.starred, docId];
    await this.vault.updateConfig({ starred });
    return !has;
  }

  async pushRecent(docId: string, max = 20): Promise<void> {
    const cfg = await this.vault.readConfig();
    const recent = [docId, ...cfg.recent.filter((x) => x !== docId)].slice(0, max);
    await this.vault.updateConfig({ recent });
  }

  // --- Watching ----------------------------------------------------------

  startWatching(onChange?: (c: VaultChange) => void): void {
    if (this.watcher) return;
    this.watcher = new VaultWatcher(this.vault, this.index, onChange);
    this.watcher.start();
  }

  async close(): Promise<void> {
    await this.watcher?.stop();
    this.index.close();
  }
}
