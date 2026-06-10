import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  validateMermaid,
  serializeMermaidFence,
  listDiagramTemplates,
  getDiagramTemplate,
  type ValidateResult,
  type DiagramTemplate,
} from './diagram.js';
import { chunkMarkdown } from './chunk.js';
import { DocStore, assertSafeSegment, type CreateDocInput } from './doc.js';
import { TransformersEmbedder, type Embedder } from './embed.js';
import { importFile } from './import/index.js';
import {
  Indexer,
  type HybridHit,
  type SemanticHit,
  type StoredChunk,
} from './indexer.js';
import {
  TemplateStore,
  renderTemplate,
  type Template,
  type TemplateMeta,
} from './template.js';
import {
  DEFAULT_CONFIG,
  type Doc,
  type DocMeta,
  type DocStatus,
  type Product,
  type SearchHit,
  type SearchOptions,
  type TrashEntry,
  type VaultConfig,
} from './types.js';
import { Vault } from './vault.js';
import { VaultWatcher, type VaultChange } from './watcher.js';

/** Input for {@link DocVault.createDiagram}. */
export interface CreateDiagramInput {
  /** Mermaid source (no fences). Takes precedence over `templateId`. */
  code?: string;
  /** Template id to use when `code` is omitted. */
  templateId?: string;
  /** Optional `## heading` placed above the diagram. */
  heading?: string;
  /** Append to this existing doc (vault-relative path) instead of creating one. */
  path?: string;
  /** Product slug for a new doc (required unless `path` is given). */
  product?: string;
  /** Title for a new doc (required unless `path` is given). */
  title?: string;
  tags?: string[];
  status?: DocStatus;
}

/** Input for {@link DocVault.createDocFromTemplate}. */
export interface CreateDocFromTemplateInput {
  /** Product slug the new doc lands under. */
  product: string;
  /** Title for the new doc; also fills the `{{title}}` placeholder. */
  title: string;
  /** Author name for the `{{author}}` placeholder. */
  author?: string;
  /** Date string for `{{date}}`; defaults to today's ISO date. */
  date?: string;
  /** Arbitrary `{{var}}` values declared by the template. */
  vars?: Record<string, string>;
  tags?: string[];
  status?: DocStatus;
}

/**
 * The primary entry point for working with a vault. Composes the filesystem
 * doc store, the SQLite index, and the file watcher behind one API used by both
 * the MCP server and the desktop app.
 */
/** Options for {@link DocVault.open}. */
export interface DocVaultOptions {
  /**
   * Embedder used to power semantic/hybrid search. Defaults to the on-device
   * transformers.js model ({@link TransformersEmbedder}). Inject a stub in tests
   * (or to use a different model) so nothing depends on a model download.
   */
  embedder?: Embedder;
}

export class DocVault {
  readonly vault: Vault;
  readonly docs: DocStore;
  readonly index: Indexer;
  readonly embedder: Embedder;
  readonly templates: TemplateStore;
  private watcher: VaultWatcher | null = null;

  /**
   * Serializes background embedding work so re-chunking never overlaps for the
   * same vault and the main index path is never blocked on the (slow) model.
   * Keyed by doc id so newer edits supersede in-flight ones in order.
   */
  private embedQueue = new Map<string, Promise<void>>();
  /** Surfaces a background-embedding failure to callers/tests that care. */
  private lastEmbedError: unknown = null;

  /**
   * Cached vault config, used to gate the embedding pipeline and semantic
   * queries on `semanticEnabled`. Loaded at open() and refreshed by
   * readConfig()/updateConfig() — every config writer in this process goes
   * through {@link updateConfig}. A second process sharing the vault won't see
   * a toggle until it reopens; acceptable for a local-first app.
   */
  private config: VaultConfig = { ...DEFAULT_CONFIG };

  /** In-flight auto-backfill kicked off by re-enabling semanticEnabled. */
  private pendingBackfill: Promise<void> | null = null;

  private constructor(vault: Vault, embedder: Embedder) {
    this.vault = vault;
    this.docs = new DocStore(vault);
    this.index = new Indexer(vault);
    this.embedder = embedder;
    this.templates = new TemplateStore(vault);
  }

  /** Open (creating if needed) a vault rooted at `root` and build its index. */
  static async open(root: string, opts: DocVaultOptions = {}): Promise<DocVault> {
    const vault = new Vault(root);
    await vault.ensure();
    const dv = new DocVault(vault, opts.embedder ?? new TransformersEmbedder());
    // Load config before reindexing so semanticEnabled gates the open path too.
    dv.config = await vault.readConfig();
    await dv.reindexAll();
    await dv.purgeExpiredTrash();
    return dv;
  }

  /** How long a trashed item is kept before it is permanently purged. */
  static readonly TRASH_TTL_MS = 24 * 60 * 60 * 1000;

  /**
   * Bring the index in sync with the markdown files on disk — incrementally.
   * A doc whose indexed row matches on relPath + id + `updated` timestamp is
   * skipped outright (no upsert, no re-embed), so its stored chunk embeddings
   * survive; only new/changed docs are (re)indexed and re-embedded, and rows
   * whose file vanished from disk are dropped (chunks included). Runs on every
   * open() — it must NOT clear the DB, which is shared with sibling processes
   * (desktop sidecar + a separate MCP client) and holds expensive embeddings.
   *
   * Pass `force: true` for an explicit full rebuild (old behavior: wipe all
   * tables, re-index and re-embed everything).
   *
   * Returns the number of docs actually (re)indexed (0 on a no-op reopen).
   */
  async reindexAll(opts: { force?: boolean } = {}): Promise<number> {
    if (opts.force) this.index.clear();
    const indexed = new Map(this.index.listMeta().map((m) => [m.relPath, m]));
    const paths = await this.docs.list();
    const onDisk = new Set(paths);
    let count = 0;
    for (const relPath of paths) {
      try {
        const doc = await this.docs.read(relPath);
        const prev = indexed.get(relPath);
        // Docs missing frontmatter id/updated get fresh values on every read
        // (parseDoc), so they never compare equal → treated as changed.
        const unchanged =
          prev !== undefined &&
          prev.id === doc.frontmatter.id &&
          prev.updated === doc.frontmatter.updated;
        if (unchanged) {
          // Identity match: keep the row and its chunks. Self-heal a doc whose
          // embedding never completed (process killed mid-embed, or indexed
          // while semanticEnabled was off) — no-op when chunks are present.
          if (!this.index.hasChunks(doc.frontmatter.id)) {
            this.enqueueEmbed(doc.frontmatter.id, doc.content);
          }
          continue;
        }
        this.index.upsert(doc);
        // Embedding is fired off in the background (see enqueueEmbed) so a full
        // reindex returns as soon as FTS/metadata are ready; vectors fill in
        // asynchronously. Callers that need vectors ready (tests, a one-shot
        // CLI) can await whenEmbeddingsSettled().
        this.enqueueEmbed(doc.frontmatter.id, doc.content);
        count++;
      } catch {
        /* skip unreadable file */
      }
    }
    // Drop rows (and, via the indexer, their chunks) for files gone from disk.
    // docs.list() only walks docs/, but imported sidecars are indexed under
    // assets/ — for those, check disk existence directly instead.
    for (const m of indexed.values()) {
      if (m.relPath.startsWith('docs/')) {
        if (!onDisk.has(m.relPath)) this.index.removeByPath(m.relPath);
      } else {
        let exists = false;
        try {
          exists = existsSync(this.vault.abs(m.relPath));
        } catch {
          /* path escapes the vault → treat as gone */
        }
        if (!exists) this.index.removeByPath(m.relPath);
      }
    }
    return count;
  }

  // --- Semantic embedding pipeline --------------------------------------

  /**
   * (Re)chunk + (re)embed a doc and replace its stored chunks — the slow path,
   * run off the main index thread. Failures are recorded (lastEmbedError) but
   * never thrown to the caller: a missing/failed model must not break normal
   * editing or FTS search, which remain fully functional without vectors.
   */
  private async embedDoc(docId: string, content: string): Promise<void> {
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) {
      this.index.replaceChunks(docId, []);
      return;
    }
    const vectors = await this.embedder.embed(chunks.map((c) => c.text));
    const stored: StoredChunk[] = chunks.map((c, i) => ({
      docId,
      chunkIndex: c.index,
      breadcrumb: c.breadcrumb,
      text: c.text,
      embedding: vectors[i]!,
    }));
    // The doc may have been deleted while we were embedding; replaceChunks just
    // writes orphan-free rows keyed by doc_id, and a later delete drops them.
    this.index.replaceChunks(docId, stored);
  }

  /**
   * Schedule embedding for a doc without blocking the caller. Per-doc work is
   * serialized so a rapid edit→edit→edit sequence re-embeds in order and the
   * latest content wins (no duplicate or stale chunks). Fire-and-forget: errors
   * are swallowed into lastEmbedError so the index path never rejects.
   */
  private enqueueEmbed(docId: string, content: string): void {
    // Semantic search off: skip queueing entirely. The embedder lazy-loads its
    // model on the first embed() call (see TransformersEmbedder), so gating
    // here also keeps the model from ever loading while disabled.
    if (!this.config.semanticEnabled) return;
    const prev = this.embedQueue.get(docId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.embedDoc(docId, content))
      .catch((err) => {
        this.lastEmbedError = err;
      })
      .finally(() => {
        if (this.embedQueue.get(docId) === next) this.embedQueue.delete(docId);
      });
    this.embedQueue.set(docId, next);
  }

  /**
   * Resolve once all currently-queued background embedding work has settled.
   * Mainly for tests and one-shot tooling; the app never needs to await this.
   * Re-checks after draining since embedding one batch can enqueue nothing new
   * here, but a concurrent upsert might have added more.
   */
  async whenEmbeddingsSettled(): Promise<void> {
    while (this.embedQueue.size > 0) {
      await Promise.allSettled([...this.embedQueue.values()]);
    }
  }

  /** The most recent background-embedding error, or null. Cleared on read. */
  takeEmbedError(): unknown {
    const err = this.lastEmbedError;
    this.lastEmbedError = null;
    return err;
  }

  /**
   * Embed every indexed doc that currently lacks chunks (e.g. on first run after
   * the feature ships, or after the DB was rebuilt). Synchronous + awaitable so
   * a caller can show progress; reports `{ done, total }` after each doc.
   */
  async backfillEmbeddings(
    onProgress?: (p: { done: number; total: number; docId: string }) => void,
  ): Promise<number> {
    if (!this.config.semanticEnabled) return 0;
    const ids = this.index.docIdsWithoutChunks();
    let done = 0;
    for (const id of ids) {
      const meta = this.index.getById(id);
      if (meta) {
        try {
          const doc = await this.docs.read(meta.relPath);
          await this.embedDoc(id, doc.content);
        } catch {
          /* unreadable mid-backfill; skip and continue */
        }
      }
      done++;
      onProgress?.({ done, total: ids.length, docId: id });
    }
    return done;
  }

  // --- Reads -------------------------------------------------------------

  search(opts: SearchOptions): SearchHit[] {
    return this.index.search(opts);
  }

  /**
   * Semantic (vector) search: embed the query, then return the top-K docs by
   * cosine similarity of their best-matching passage. Optional product/tag
   * filters mirror {@link search}. Returns each hit's best passage + score.
   */
  async searchSemantic(
    query: string,
    opts: { k?: number; product?: string; tag?: string } = {},
  ): Promise<SemanticHit[]> {
    // Throw (not []) so an explicit mode=semantic MCP call gets a clear error
    // instead of silently-empty results; the desktop never calls this when
    // disabled (the renderer falls back to FTS).
    if (!this.config.semanticEnabled) {
      throw new Error(
        'Semantic search is disabled (enable semanticEnabled in the vault config).',
      );
    }
    const [vec] = await this.embedder.embed([query]);
    if (!vec) return [];
    return this.index.searchSemantic(vec, opts);
  }

  /**
   * Hybrid search: Reciprocal Rank Fusion of full-text (bm25) and semantic
   * (cosine) rankings — best general-purpose mode, since it catches both exact
   * keyword matches and paraphrases. Embeds the query once and fuses.
   */
  async searchHybrid(
    query: string,
    opts: { k?: number; product?: string; tag?: string; rrfK?: number } = {},
  ): Promise<HybridHit[]> {
    // Semantic disabled → degrade to FTS-only (don't embed the query) so the
    // default "hybrid" search mode keeps working everywhere.
    if (!this.config.semanticEnabled) {
      return this.index
        .search({
          query,
          limit: opts.k ?? 10,
          ...(opts.product ? { product: opts.product } : {}),
          ...(opts.tag ? { tag: opts.tag } : {}),
        })
        .map((h) => ({ ...h, score: 0, inFts: true, inSemantic: false }));
    }
    const [vec] = await this.embedder.embed([query]);
    if (!vec) return this.index.search({ query, limit: opts.k ?? 10 }).map((h) => ({
      ...h,
      score: 0,
      inFts: true,
      inSemantic: false,
    }));
    return this.index.searchHybrid(query, vec, opts);
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
    const relPath = meta ? meta.relPath : idOrPath;
    // Reads are scoped to managed docs + imported markdown sidecars; templates
    // have dedicated APIs and .docvault/ (config, index, trash) is never a doc.
    this.vault.assertDocPath(relPath, { allowAssets: true, mdOnly: true });
    return this.docs.read(relPath);
  }

  backlinks(id: string): DocMeta[] {
    return this.index.backlinks(id);
  }

  /**
   * Nearest-neighbour docs for an already-open doc, by semantic similarity of
   * their stored chunk embeddings — "related reading" for the current doc.
   * Reuses the doc's stored vectors (no re-embedding); returns an empty list if
   * the doc has not been embedded yet. Each hit carries its best passage +
   * heading breadcrumb + similarity score, like {@link searchSemantic}.
   */
  relatedDocs(id: string, opts: { k?: number } = {}): SemanticHit[] {
    // Disabled → graceful empty list: matches the documented MCP contract
    // ("empty if … semantic indexing disabled") and the renderer's empty state.
    if (!this.config.semanticEnabled) return [];
    return this.index.relatedDocs(id, opts);
  }

  /**
   * Lightweight snapshot of background embedding progress for the UI: how many
   * indexed docs still lack chunks (`pending`) out of the total, plus whether
   * any embedding work is currently in flight. Cheap to poll.
   */
  embeddingStatus(): { pending: number; total: number; inFlight: number } {
    const pending = this.index.docIdsWithoutChunks().length;
    const total = this.index.listDocs().length;
    return { pending, total, inFlight: this.embedQueue.size };
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
    this.enqueueEmbed(doc.frontmatter.id, doc.content);
    return doc;
  }

  async updateDoc(
    relPath: string,
    patch: Parameters<DocStore['update']>[1],
  ): Promise<Doc> {
    // Mutations are scoped strictly to docs/*.md: the desktop never edits
    // imported sidecars (they render read-only and are regenerated from the
    // original by the watcher), and templates/.docvault must stay unreachable.
    this.vault.assertDocPath(relPath, { mdOnly: true });
    const doc = await this.docs.update(relPath, patch);
    this.index.upsert(doc);
    this.enqueueEmbed(doc.frontmatter.id, doc.content);
    return doc;
  }

  /** Soft-delete a single doc: move it to trash and drop it from the index. */
  async trashDoc(relPath: string): Promise<void> {
    // docs/ subtree only (files or folders). The desktop has no delete flow for
    // imported assets, and allowing assets/ here would let a caller trash an
    // original out from under its sidecar; templates/.docvault are never docs.
    this.vault.assertDocPath(relPath);
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
    // Move to trash FIRST: if the folder is missing this throws before we touch
    // the index, so a failed delete can't leave the index inconsistent.
    const trashPath = await this.docs.trash(relDir);
    for (const d of this.index.listDocs({ product: slug })) {
      this.index.removeByPath(d.relPath);
    }
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
    // The caller-supplied path must point inside .docvault/trash/ — it is only
    // a lookup key, but gating it here means a crafted value can never name
    // (or move) anything else even if the entry list is tampered with.
    this.vault.assertTrashPath(trashPath);
    const cfg = await this.vault.readConfig();
    const entry = cfg.trash.find((e) => e.trashPath === trashPath);
    if (!entry) throw new Error(`No trash entry: ${trashPath}`);
    // Defense in depth: the recorded destination must itself be a doc path
    // (docs/, or assets/ for legacy sidecar deletions), so a forged config
    // entry can't restore a file over .docvault/ or templates/.
    this.vault.assertDocPath(entry.relPath, { allowAssets: true });
    await this.docs.restore(entry.trashPath, entry.relPath);
    await this.reindexUnder(entry.relPath);
    // Functional filter so a concurrent trash() doesn't get clobbered.
    await this.vault.updateConfig((c) => ({
      trash: c.trash.filter((e) => e.trashPath !== trashPath),
    }));
  }

  /** Permanently delete trash entries older than the retention window. */
  async purgeExpiredTrash(maxAgeMs = DocVault.TRASH_TTL_MS): Promise<VaultConfig> {
    const cfg = await this.vault.readConfig();
    const now = Date.now();
    const purged = new Set<string>();
    for (const entry of cfg.trash) {
      const deletedAt = new Date(entry.deletedAt).getTime();
      // An unparseable timestamp (NaN) would otherwise live forever — treat it
      // as expired so corrupt entries don't become permanent zombies.
      if (Number.isNaN(deletedAt) || now - deletedAt > maxAgeMs) {
        await this.docs.purge(entry.trashPath).catch(() => {
          /* already gone */
        });
        purged.add(entry.trashPath);
      }
    }
    if (purged.size === 0) return cfg;
    // Filter against a fresh read so a concurrently-added entry isn't dropped.
    return this.vault.updateConfig((c) => ({
      trash: c.trash.filter((e) => !purged.has(e.trashPath)),
    }));
  }

  /** Append a trash entry (most-recent first) to the persisted config. */
  private async addTrashEntry(entry: TrashEntry): Promise<void> {
    await this.vault.updateConfig((cfg) => ({ trash: [entry, ...cfg.trash] }));
  }

  /** Re-index a restored doc, or every doc under a restored product folder. */
  private async reindexUnder(relPath: string): Promise<void> {
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    for (const p of await this.docs.list()) {
      if (p !== relPath && !p.startsWith(prefix)) continue;
      try {
        const doc = await this.docs.read(p);
        this.index.upsert(doc);
        this.enqueueEmbed(doc.frontmatter.id, doc.content);
      } catch {
        /* skip unreadable file */
      }
    }
  }

  /** Add an explicit outbound link from one doc to a target doc id. */
  async linkDocs(fromPath: string, targetId: string): Promise<Doc> {
    // Rewrites the source doc's frontmatter — same scope as updateDoc.
    this.vault.assertDocPath(fromPath, { mdOnly: true });
    const doc = await this.docs.read(fromPath);
    const links = new Set(doc.frontmatter.links ?? []);
    links.add(targetId);
    doc.frontmatter.links = [...links];
    const saved = await this.docs.write(doc);
    this.index.upsert(saved);
    this.enqueueEmbed(saved.frontmatter.id, saved.content);
    return saved;
  }

  async importFile(srcAbsPath: string, opts: { tags?: string[] } = {}): Promise<Doc> {
    const result = await importFile(this.vault, srcAbsPath, opts);
    this.index.upsert(result.doc);
    this.enqueueEmbed(result.doc.frontmatter.id, result.doc.content);
    return result.doc;
  }

  // --- Diagrams ----------------------------------------------------------

  /** Structurally lint Mermaid source (no DOM needed). See ./diagram. */
  validateDiagram(code: string): ValidateResult {
    return validateMermaid(code);
  }

  /** List curated Mermaid diagram templates (metadata + source). */
  listDiagramTemplates(): DiagramTemplate[] {
    return listDiagramTemplates();
  }

  /** Look up a single diagram template by id. */
  getDiagramTemplate(id: string): DiagramTemplate | null {
    return getDiagramTemplate(id);
  }

  /**
   * Create a Mermaid diagram as a ```mermaid fenced block — either as a new doc
   * (pass `product` + `title`) or appended to an existing doc (pass `path`). The
   * source is taken from `code`, or from `templateId` when `code` is omitted, and
   * is structurally validated first; any lint *error* throws (warnings pass).
   */
  async createDiagram(input: CreateDiagramInput): Promise<Doc> {
    let source = input.code;
    if (source === undefined && input.templateId) {
      const tpl = getDiagramTemplate(input.templateId);
      if (!tpl) throw new Error(`Unknown diagram template: ${input.templateId}`);
      source = tpl.source;
    }
    if (source === undefined || source.trim().length === 0) {
      throw new Error('createDiagram requires `code` or a valid `templateId`.');
    }

    const result = validateMermaid(source);
    if (!result.ok) {
      const errs = result.issues
        .filter((i) => i.severity === 'error')
        .map((i) => (i.line ? `line ${i.line}: ${i.message}` : i.message))
        .join('; ');
      throw new Error(`Invalid Mermaid diagram: ${errs}`);
    }

    const heading = input.heading ? `## ${input.heading}\n\n` : '';
    const block = heading + serializeMermaidFence(source);

    if (input.path) {
      // Appending rewrites the target doc — same scope as updateDoc.
      this.vault.assertDocPath(input.path, { mdOnly: true });
      const existing = await this.docs.read(input.path);
      const content = `${existing.content.trimEnd()}\n\n${block}\n`;
      return this.updateDoc(input.path, { content });
    }

    if (!input.product || !input.title) {
      throw new Error('createDiagram requires `path`, or both `product` and `title`.');
    }
    return this.createDoc({
      product: input.product,
      title: input.title,
      content: block + '\n',
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
  }

  // --- Templates ---------------------------------------------------------

  /** List every template (metadata, no body) in the vault's templates/ folder. */
  listTemplates(): Promise<TemplateMeta[]> {
    return this.templates.list();
  }

  /** Read a single template (with body + declared variables) by id. */
  getTemplate(id: string): Promise<Template> {
    return this.templates.read(id);
  }

  /**
   * Seed the starter template set (Meeting Notes, PRD, Runbook, ADR, Spec) into
   * templates/, skipping any the user has already created/edited. Returns the
   * ids that were actually written.
   */
  seedStarterTemplates(): Promise<string[]> {
    return this.templates.seedStarters();
  }

  /**
   * Instantiate a new doc from a template: render its `{{placeholders}}` with the
   * built-ins (title/date/author) plus `vars`, then create the doc via the normal
   * doc-creation path so it lands in the FTS index and backlinks like any other.
   */
  async createDocFromTemplate(
    templateId: string,
    input: CreateDocFromTemplateInput,
  ): Promise<Doc> {
    const tpl = await this.templates.read(templateId);
    const content = renderTemplate(tpl.body, {
      title: input.title,
      ...(input.author ? { author: input.author } : {}),
      ...(input.date ? { date: input.date } : {}),
      ...(input.vars ? { vars: input.vars } : {}),
    });
    return this.createDoc({
      product: input.product,
      title: input.title,
      content,
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
  }

  /**
   * Persist an existing doc's body as a new template under templates/. The doc's
   * markdown becomes the template body verbatim (any `{{placeholders}}` already
   * present are preserved); the template id is derived from `name`.
   */
  async saveAsTemplate(docId: string, opts: { name: string }): Promise<Template> {
    const doc = await this.readDoc(docId);
    return this.templates.save({ name: opts.name, body: doc.content });
  }

  // --- Config helpers ----------------------------------------------------

  async readConfig(): Promise<VaultConfig> {
    const cfg = await this.vault.readConfig();
    this.config = cfg; // keep the semanticEnabled gate fresh on every read
    return cfg;
  }

  async updateConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    const wasEnabled = this.config.semanticEnabled;
    const next = await this.vault.updateConfig(patch);
    this.config = next;
    if (!wasEnabled && next.semanticEnabled) {
      // Re-enabled: embed the backlog accumulated while disabled. Incremental
      // and idempotent (backfill only touches docs lacking chunks), so racing
      // an explicit backfill (e.g. the desktop Settings toggle) is harmless.
      // Fire-and-forget — a failure surfaces via takeEmbedError(), like the
      // rest of the background embedding pipeline.
      this.pendingBackfill = this.backfillEmbeddings()
        .then(() => undefined)
        .catch((err) => {
          this.lastEmbedError = err;
        })
        .finally(() => {
          this.pendingBackfill = null;
        });
    }
    return next;
  }

  async toggleStar(docId: string): Promise<boolean> {
    // Functional update so a concurrent star/pushRecent doesn't clobber the
    // array; derive the result from the committed config so it's race-free.
    const next = await this.vault.updateConfig((cfg) => ({
      starred: cfg.starred.includes(docId)
        ? cfg.starred.filter((x) => x !== docId)
        : [...cfg.starred, docId],
    }));
    return next.starred.includes(docId);
  }

  async pushRecent(docId: string, max = 20): Promise<void> {
    await this.vault.updateConfig((cfg) => ({
      recent: [docId, ...cfg.recent.filter((x) => x !== docId)].slice(0, max),
    }));
  }

  // --- Watching ----------------------------------------------------------

  startWatching(onChange?: (c: VaultChange) => void, onError?: (err: Error) => void): void {
    if (this.watcher) return;
    // Re-embed on watcher upserts (external edits / re-extracted imports). The
    // watcher has already updated FTS via index.upsert; we read back the doc id
    // for the changed path and queue a background re-embed so vectors track disk.
    const handle = (c: VaultChange): void => {
      if (c.type === 'upsert') {
        const id = this.index.idByPath(c.relPath);
        if (id) {
          this.docs
            .read(c.relPath)
            .then((doc) => this.enqueueEmbed(id, doc.content))
            .catch(() => undefined);
        }
      }
      onChange?.(c);
    };
    this.watcher = new VaultWatcher(this.vault, this.index, handle, onError);
    this.watcher.start();
  }

  async close(): Promise<void> {
    await this.watcher?.stop();
    // Let any in-flight background embedding finish writing before the DB closes,
    // so a queued replaceChunks() can't hit a closed handle.
    await this.pendingBackfill;
    await this.whenEmbeddingsSettled();
    this.index.close();
  }
}
