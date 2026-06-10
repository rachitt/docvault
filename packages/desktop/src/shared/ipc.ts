import type {
  CreateDocInput,
  Doc,
  DocMeta,
  DocVersion,
  Product,
  SearchOptions,
  Template,
  TemplateMeta,
  TrashEntry,
  VaultConfig,
} from '@docvault/core';

/** How a search runs: exact full-text, vector, or RRF fusion of both. */
export type SearchMode = 'fts' | 'semantic' | 'hybrid';

/** Renderer-side search options: core's FTS options plus the mode selector. */
export type SearchQuery = SearchOptions & { mode?: SearchMode };

/**
 * A unified search result for the renderer. `fts` hits carry the FTS `snippet`
 * + `rank`; `semantic`/`hybrid` hits carry a best `passage`, `breadcrumb`, and
 * similarity `score`. The renderer reads whichever fields are present, so this
 * is the loose union of all hit shapes the search modes can return.
 */
export type UnifiedHit = DocMeta & {
  snippet?: string;
  rank?: number;
  passage?: string;
  breadcrumb?: string;
  score?: number;
  inFts?: boolean;
  inSemantic?: boolean;
};

/** Background embedding progress, polled for the Settings status indicator. */
export interface EmbeddingStatus {
  /** Indexed docs still lacking passage embeddings. */
  pending: number;
  /** Total indexed docs. */
  total: number;
  /** Embedding jobs currently running. */
  inFlight: number;
  /** Last embedding error message (e.g. offline model download), cleared on read. */
  error: string | null;
}

/** IPC channel names (request/response via ipcRenderer.invoke). */
export const CH = {
  listProducts: 'dv:listProducts',
  createProduct: 'dv:createProduct',
  listDocs: 'dv:listDocs',
  readDoc: 'dv:readDoc',
  createDoc: 'dv:createDoc',
  updateDoc: 'dv:updateDoc',
  listVersions: 'dv:listVersions',
  readVersion: 'dv:readVersion',
  saveVersion: 'dv:saveVersion',
  restoreVersion: 'dv:restoreVersion',
  trashDoc: 'dv:trashDoc',
  deleteProduct: 'dv:deleteProduct',
  listTrash: 'dv:listTrash',
  restoreTrash: 'dv:restoreTrash',
  search: 'dv:search',
  relatedDocs: 'dv:relatedDocs',
  embeddingStatus: 'dv:embeddingStatus',
  backfillEmbeddings: 'dv:backfillEmbeddings',
  backlinks: 'dv:backlinks',
  listTags: 'dv:listTags',
  listTemplates: 'dv:listTemplates',
  createDocFromTemplate: 'dv:createDocFromTemplate',
  saveAsTemplate: 'dv:saveAsTemplate',
  importFile: 'dv:importFile',
  exportDoc: 'dv:exportDoc',
  exportBulk: 'dv:exportBulk',
  openOriginal: 'dv:openOriginal',
  readSource: 'dv:readSource',
  getConfig: 'dv:getConfig',
  updateConfig: 'dv:updateConfig',
  toggleStar: 'dv:toggleStar',
  pushRecent: 'dv:pushRecent',
  aiAsk: 'dv:aiAsk',
  aiCancel: 'dv:aiCancel',
} as const;

/** Event channels (main → renderer, via webContents.send). */
export const EV = {
  vaultChanged: 'dv:vaultChanged',
  aiChunk: 'dv:aiChunk',
  aiDone: 'dv:aiDone',
  exportProgress: 'dv:exportProgress',
} as const;

/** Document export formats supported by the export pipeline. */
export type ExportFormat = 'html' | 'pdf' | 'docx';

/** Result of an export request; `canceled` when the user dismissed the dialog. */
export type ExportResult =
  | { canceled: true }
  | { canceled: false; path: string; count?: number };

/** Progress tick during a bulk export. */
export type ExportProgress = { done: number; total: number; title: string };

export type UpdateDocPatch = {
  content?: string;
  title?: string;
  tags?: string[];
  status?: 'draft' | 'published' | 'archived';
};

/** Args for instantiating a doc from a template (snake_case matches the MCP tool). */
export type CreateDocFromTemplateArgs = {
  template_id: string;
  product: string;
  title: string;
  author?: string;
  date?: string;
  vars?: Record<string, string>;
  tags?: string[];
  status?: 'draft' | 'published' | 'archived';
};

/** The API surface exposed on `window.docvault` by the preload script. */
export interface DocVaultApi {
  listProducts(): Promise<Product[]>;
  createProduct(slug: string, meta: { title: string; icon?: string; color?: string }): Promise<Product>;
  listDocs(opts?: { product?: string; tag?: string }): Promise<DocMeta[]>;
  readDoc(idOrPath: string): Promise<Doc>;
  createDoc(input: CreateDocInput): Promise<Doc>;
  updateDoc(relPath: string, patch: UpdateDocPatch): Promise<Doc>;
  listVersions(idOrPath: string): Promise<DocVersion[]>;
  readVersion(docId: string, versionId: string): Promise<Doc>;
  saveVersion(idOrPath: string): Promise<DocVersion | null>;
  restoreVersion(docId: string, versionId: string): Promise<Doc>;
  trashDoc(relPath: string): Promise<void>;
  /** Soft-delete a product and all its docs; recoverable from trash. */
  deleteProduct(slug: string): Promise<void>;
  /** List soft-deleted docs/products still recoverable from trash. */
  listTrash(): Promise<TrashEntry[]>;
  /** Restore a trashed doc/product to its original location by trash path. */
  restoreTrash(trashPath: string): Promise<void>;
  /**
   * Search across all docs. `mode` selects the strategy (fts / semantic /
   * hybrid, default hybrid in core); the returned hits are the loose union of
   * all modes' shapes — read `snippet` for fts, `passage`+`breadcrumb` for
   * semantic/hybrid.
   */
  search(opts: SearchQuery): Promise<UnifiedHit[]>;
  /** Nearest-neighbour docs for an open doc (semantic "related reading"). */
  relatedDocs(id: string, limit?: number): Promise<UnifiedHit[]>;
  /** Poll background embedding/backfill progress (and clear any last error). */
  embeddingStatus(): Promise<EmbeddingStatus>;
  /** Embed every indexed doc that still lacks passage embeddings. */
  backfillEmbeddings(): Promise<{ processed: number } & EmbeddingStatus>;
  backlinks(id: string): Promise<DocMeta[]>;
  listTags(): Promise<{ tag: string; count: number }[]>;
  /** List document templates from the vault, each with its declared {{variables}}. */
  listTemplates(): Promise<TemplateMeta[]>;
  /** Instantiate a new doc by rendering a template's placeholders. */
  createDocFromTemplate(args: CreateDocFromTemplateArgs): Promise<Doc>;
  /** Save an existing doc's body verbatim as a new reusable template. */
  saveAsTemplate(idOrPath: string, name: string): Promise<Template>;
  importFile(): Promise<Doc | null>;
  /** Export one doc to a user-chosen file (HTML / PDF / DOCX), revealing it. */
  exportDoc(idOrPath: string, format: ExportFormat): Promise<ExportResult>;
  /**
   * Export a product (or the whole vault when `product` is omitted) — either one
   * file per doc into a chosen folder, or a single combined PDF.
   */
  exportBulk(opts: {
    product?: string;
    format: ExportFormat;
    combined?: boolean;
  }): Promise<ExportResult>;
  /** Subscribe to bulk-export progress ticks. */
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
  openOriginal(relPath: string): Promise<void>;
  /** Read the raw bytes of an imported original (pdf/docx/txt) for in-app viewing. */
  readSource(relPath: string): Promise<Uint8Array>;
  getConfig(): Promise<VaultConfig>;
  updateConfig(patch: Partial<VaultConfig>): Promise<VaultConfig>;
  toggleStar(docId: string): Promise<VaultConfig>;
  pushRecent(docId: string): Promise<VaultConfig>;
  ai: {
    ask(requestId: string, prompt: string): Promise<void>;
    cancel(requestId: string): Promise<void>;
    onChunk(cb: (requestId: string, text: string) => void): () => void;
    onDone(cb: (requestId: string, error?: string) => void): () => void;
  };
  /** Fired when files under docs/ change on disk; `paths` are vault-relative. */
  onVaultChanged(cb: (paths: string[]) => void): () => void;
}
