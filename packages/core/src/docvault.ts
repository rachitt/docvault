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
import { DocStore, assertSafeSegment, slugify, type CreateDocInput } from './doc.js';
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
import type {
  Doc,
  DocMeta,
  DocVersion,
  DocVersionActor,
  DocVersionReason,
  DocStatus,
  Product,
  SearchHit,
  SearchOptions,
  TrashEntry,
  VaultConfig,
} from './types.js';
import { Vault } from './vault.js';
import { VaultWatcher, type VaultChange } from './watcher.js';
import { VersionStore } from './version.js';

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
  readonly versions: VersionStore;
  private watcher: VaultWatcher | null = null;
  private internalWrites = new Map<string, number>();

  /**
   * Serializes background embedding work so re-chunking never overlaps for the
   * same vault and the main index path is never blocked on the (slow) model.
   * Keyed by doc id so newer edits supersede in-flight ones in order.
   */
  private embedQueue = new Map<string, Promise<void>>();
  /** Surfaces a background-embedding failure to callers/tests that care. */
  private lastEmbedError: unknown = null;

  private constructor(vault: Vault, embedder: Embedder) {
    this.vault = vault;
    this.docs = new DocStore(vault);
    this.index = new Indexer(vault);
    this.embedder = embedder;
    this.templates = new TemplateStore(vault);
    this.versions = new VersionStore(vault);
  }

  /** Open (creating if needed) a vault rooted at `root` and build its index. */
  static async open(root: string, opts: DocVaultOptions = {}): Promise<DocVault> {
    const vault = new Vault(root);
    await vault.ensure();
    const dv = new DocVault(vault, opts.embedder ?? new TransformersEmbedder());
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
        const doc = await this.docs.read(relPath);
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

  private markInternalWrite(relPath: string): void {
    this.internalWrites.set(relPath, Date.now() + 3000);
  }

  private isInternalWrite(relPath: string): boolean {
    const until = this.internalWrites.get(relPath);
    if (until === undefined) return false;
    if (until < Date.now()) {
      this.internalWrites.delete(relPath);
      return false;
    }
    return true;
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
    return this.docs.read(meta ? meta.relPath : idOrPath);
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
    const product = assertSafeSegment(input.product, 'product');
    const stem = assertSafeSegment(input.stem ?? slugify(input.title), 'stem');
    this.markInternalWrite(`docs/${product}/${stem}.md`);
    const doc = await this.docs.create(input);
    this.index.upsert(doc);
    this.enqueueEmbed(doc.frontmatter.id, doc.content);
    await this.versions.create({ relPath: doc.relPath, reason: 'create' });
    return doc;
  }

  async updateDoc(
    relPath: string,
    patch: Parameters<DocStore['update']>[1],
  ): Promise<Doc> {
    await this.versions.create({ relPath, reason: 'edit' }).catch(() => undefined);
    this.markInternalWrite(relPath);
    const doc = await this.docs.update(relPath, patch);
    this.index.upsert(doc);
    this.enqueueEmbed(doc.frontmatter.id, doc.content);
    return doc;
  }

  async listVersions(idOrPath: string): Promise<DocVersion[]> {
    const doc = await this.readDoc(idOrPath);
    await this.versions.prune(
      doc.frontmatter.id,
      (version) => version.reason === 'external' && version.actor === 'watcher' && !version.manual,
    );
    return this.versions.list(doc.frontmatter.id);
  }

  readVersion(docId: string, versionId: string): Promise<Doc> {
    return this.versions.read(docId, versionId);
  }

  async saveVersion(
    idOrPath: string,
    opts: { reason?: DocVersionReason; actor?: DocVersionActor; manual?: boolean } = {},
  ): Promise<DocVersion | null> {
    const doc = await this.readDoc(idOrPath);
    return this.versions.create({
      relPath: doc.relPath,
      reason: opts.reason ?? 'manual',
      ...(opts.actor ? { actor: opts.actor } : {}),
      manual: opts.manual ?? true,
    });
  }

  async restoreVersion(docId: string, versionId: string): Promise<Doc> {
    const current = this.index.getById(docId);
    const versions = await this.versions.list(docId);
    const selected = versions.find((v) => v.id === versionId);
    const targetRelPath = current?.relPath ?? selected?.relPath;
    if (!targetRelPath) throw new Error(`No version target for doc: ${docId}`);
    if (current) {
      await this.versions
        .create({ relPath: current.relPath, reason: 'restore' })
        .catch(() => undefined);
    }
    const snapshot = await this.versions.read(docId, versionId);
    const restored: Doc = {
      ...snapshot,
      relPath: targetRelPath,
      absPath: this.vault.abs(targetRelPath),
      frontmatter: { ...snapshot.frontmatter, id: docId },
    };
    this.markInternalWrite(targetRelPath);
    const saved = await this.docs.write(restored);
    this.index.upsert(saved);
    this.enqueueEmbed(saved.frontmatter.id, saved.content);
    return saved;
  }

  deleteVersion(docId: string, versionId: string): Promise<void> {
    return this.versions.delete(docId, versionId);
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
    const cfg = await this.vault.readConfig();
    const entry = cfg.trash.find((e) => e.trashPath === trashPath);
    if (!entry) throw new Error(`No trash entry: ${trashPath}`);
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
    const doc = await this.docs.read(fromPath);
    const links = new Set(doc.frontmatter.links ?? []);
    links.add(targetId);
    doc.frontmatter.links = [...links];
    this.markInternalWrite(fromPath);
    const saved = await this.docs.write(doc);
    this.index.upsert(saved);
    this.enqueueEmbed(saved.frontmatter.id, saved.content);
    return saved;
  }

  async importFile(srcAbsPath: string, opts: { tags?: string[] } = {}): Promise<Doc> {
    const result = await importFile(this.vault, srcAbsPath, opts);
    this.markInternalWrite(result.doc.relPath);
    this.index.upsert(result.doc);
    this.enqueueEmbed(result.doc.frontmatter.id, result.doc.content);
    await this.versions.create({ relPath: result.doc.relPath, reason: 'import' });
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

  readConfig(): Promise<VaultConfig> {
    return this.vault.readConfig();
  }

  updateConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    return this.vault.updateConfig(patch);
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

  startWatching(onChange?: (c: VaultChange) => void): void {
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
            .then((doc) => {
              this.enqueueEmbed(id, doc.content);
              // History is created by structured app actions and manual saves.
              // Watcher events still refresh embeddings, but do not add entries.
              this.isInternalWrite(c.relPath);
            })
            .catch(() => undefined);
        }
      }
      onChange?.(c);
    };
    this.watcher = new VaultWatcher(this.vault, this.index, handle);
    this.watcher.start();
  }

  async close(): Promise<void> {
    await this.watcher?.stop();
    // Let any in-flight background embedding finish writing before the DB closes,
    // so a queued replaceChunks() can't hit a closed handle.
    await this.whenEmbeddingsSettled();
    this.index.close();
  }
}
