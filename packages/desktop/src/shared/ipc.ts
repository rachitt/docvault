import type {
  CreateDocInput,
  Doc,
  DocMeta,
  Product,
  SearchHit,
  SearchOptions,
  TrashEntry,
  VaultConfig,
} from '@docvault/core';

/** IPC channel names (request/response via ipcRenderer.invoke). */
export const CH = {
  listProducts: 'dv:listProducts',
  createProduct: 'dv:createProduct',
  listDocs: 'dv:listDocs',
  readDoc: 'dv:readDoc',
  createDoc: 'dv:createDoc',
  updateDoc: 'dv:updateDoc',
  trashDoc: 'dv:trashDoc',
  deleteProduct: 'dv:deleteProduct',
  listTrash: 'dv:listTrash',
  restoreTrash: 'dv:restoreTrash',
  search: 'dv:search',
  backlinks: 'dv:backlinks',
  listTags: 'dv:listTags',
  importFile: 'dv:importFile',
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
} as const;

export type UpdateDocPatch = {
  content?: string;
  title?: string;
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
  trashDoc(relPath: string): Promise<void>;
  /** Soft-delete a product and all its docs; recoverable from trash. */
  deleteProduct(slug: string): Promise<void>;
  /** List soft-deleted docs/products still recoverable from trash. */
  listTrash(): Promise<TrashEntry[]>;
  /** Restore a trashed doc/product to its original location by trash path. */
  restoreTrash(trashPath: string): Promise<void>;
  search(opts: SearchOptions): Promise<SearchHit[]>;
  backlinks(id: string): Promise<DocMeta[]>;
  listTags(): Promise<{ tag: string; count: number }[]>;
  importFile(): Promise<Doc | null>;
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
