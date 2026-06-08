import { create } from 'zustand';
import type {
  Doc,
  DocMeta,
  Product,
  SearchHit,
  ThemeMode,
  TrashEntry,
  VaultConfig,
} from '@docvault/core';
import type { ExportFormat, ExportProgress } from '../shared/ipc';

export type NavView =
  | 'home'
  | 'recent'
  | 'starred'
  | 'templates'
  | 'trash'
  | 'settings'
  | 'tags'
  | 'search'
  | 'doc';
export type RightTab = 'outline' | 'links' | 'ai';

/** Resolve the effective light/dark theme, expanding 'system' via the OS. */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

interface State {
  products: Product[];
  docs: DocMeta[];
  /** Soft-deleted docs/products recoverable from trash (most-recent first). */
  trash: TrashEntry[];
  config: VaultConfig | null;
  currentDoc: Doc | null;
  view: NavView;
  rightTab: RightTab;
  paletteOpen: boolean;
  loading: boolean;
  error: string | null;
  /** Effective theme after resolving 'system'; drives the `.dark` class. */
  resolvedTheme: 'light' | 'dark';
  /** Selected tag in the Tags browser, or null to show the tag list. */
  tagFilter: string | null;
  /** Query backing the full-page search results view. */
  searchQuery: string;
  /** True while an export is running; drives spinners / disabled buttons. */
  exporting: boolean;
  /** Latest bulk-export progress tick, or null when not bulk-exporting. */
  exportProgress: ExportProgress | null;

  refresh: () => Promise<void>;
  openDoc: (idOrPath: string) => Promise<void>;
  /** Replace the open doc in place (e.g. after reloading it from disk). */
  setCurrentDoc: (doc: Doc) => void;
  saveCurrent: (content: string) => Promise<void>;
  newDoc: (product: string, title: string) => Promise<void>;
  newProduct: (title: string) => Promise<void>;
  /** Soft-delete a single doc (moves it to trash). */
  trashDoc: (relPath: string) => Promise<void>;
  /** Soft-delete a product and all its docs (moves it to trash). */
  deleteProduct: (slug: string) => Promise<void>;
  /** Restore a trashed doc/product back to its original location. */
  restoreTrash: (trashPath: string) => Promise<void>;
  importFile: () => Promise<void>;
  /** Export a single doc to a chosen file (HTML / PDF / DOCX). */
  exportDoc: (idOrPath: string, format: ExportFormat) => Promise<void>;
  /** Export a product (or whole vault) as per-doc files or a combined PDF. */
  exportBulk: (opts: { product?: string; format: ExportFormat; combined?: boolean }) => Promise<void>;
  toggleStar: (docId: string) => Promise<void>;
  updateConfig: (patch: Partial<VaultConfig>) => Promise<void>;
  setTheme: (mode: ThemeMode) => Promise<void>;
  /** Re-resolve the current theme mode and apply the `.dark` class. */
  applyTheme: () => void;
  setView: (v: NavView) => void;
  setRightTab: (t: RightTab) => void;
  setPalette: (open: boolean) => void;
  search: (q: string) => Promise<SearchHit[]>;
  /** Open the Tags browser, optionally pre-selecting a tag. */
  openTags: (tag?: string | null) => void;
  setTagFilter: (tag: string | null) => void;
  /** Open the full-page search results view seeded with a query. */
  openSearch: (q: string) => void;
  backlinks: (id: string) => Promise<DocMeta[]>;
  listTags: () => Promise<{ tag: string; count: number }[]>;
}

const api = () => window.docvault;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'untitled'
  );
}

export const useStore = create<State>((set, get) => ({
  products: [],
  docs: [],
  trash: [],
  config: null,
  currentDoc: null,
  view: 'home',
  rightTab: 'outline',
  paletteOpen: false,
  loading: true,
  error: null,
  resolvedTheme: 'light',
  tagFilter: null,
  searchQuery: '',
  exporting: false,
  exportProgress: null,

  refresh: async () => {
    try {
      const [products, docs, config, trash] = await Promise.all([
        api().listProducts(),
        api().listDocs(),
        api().getConfig(),
        api().listTrash(),
      ]);
      set({ products, docs, config, trash, loading: false, error: null });
      get().applyTheme();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  openDoc: async (idOrPath) => {
    const doc = await api().readDoc(idOrPath);
    set({ currentDoc: doc, view: 'doc' });
    const config = await api().pushRecent(doc.frontmatter.id);
    set({ config });
  },

  setCurrentDoc: (doc) => set({ currentDoc: doc }),

  saveCurrent: async (content) => {
    const cur = get().currentDoc;
    if (!cur) return;
    const saved = await api().updateDoc(cur.relPath, { content });
    set({ currentDoc: saved });
    set({ docs: await api().listDocs() });
  },

  newDoc: async (product, title) => {
    const doc = await api().createDoc({ product, title });
    set({ docs: await api().listDocs(), products: await api().listProducts() });
    await get().openDoc(doc.frontmatter.id);
  },

  newProduct: async (title) => {
    await api().createProduct(slugify(title), { title });
    set({ products: await api().listProducts() });
  },

  trashDoc: async (relPath) => {
    await api().trashDoc(relPath);
    const cur = get().currentDoc;
    // If the open doc was the one trashed, drop back to Home.
    if (cur?.relPath === relPath) set({ currentDoc: null, view: 'home' });
    const [docs, products, trash] = await Promise.all([
      api().listDocs(),
      api().listProducts(),
      api().listTrash(),
    ]);
    set({ docs, products, trash });
  },

  deleteProduct: async (slug) => {
    await api().deleteProduct(slug);
    const cur = get().currentDoc;
    // If the open doc lived under this product, drop back to Home.
    if (cur && cur.relPath.startsWith(`docs/${slug}/`)) set({ currentDoc: null, view: 'home' });
    const [docs, products, trash] = await Promise.all([
      api().listDocs(),
      api().listProducts(),
      api().listTrash(),
    ]);
    set({ docs, products, trash });
  },

  restoreTrash: async (trashPath) => {
    await api().restoreTrash(trashPath);
    const [docs, products, trash] = await Promise.all([
      api().listDocs(),
      api().listProducts(),
      api().listTrash(),
    ]);
    set({ docs, products, trash });
  },

  importFile: async () => {
    const doc = await api().importFile();
    if (doc) {
      set({ docs: await api().listDocs() });
      await get().openDoc(doc.frontmatter.id);
    }
  },

  exportDoc: async (idOrPath, format) => {
    set({ exporting: true, error: null });
    try {
      await api().exportDoc(idOrPath, format);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ exporting: false });
    }
  },

  exportBulk: async (opts) => {
    set({ exporting: true, exportProgress: null, error: null });
    const off = api().onExportProgress((p) => set({ exportProgress: p }));
    try {
      await api().exportBulk(opts);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      off();
      set({ exporting: false, exportProgress: null });
    }
  },

  toggleStar: async (docId) => {
    set({ config: await api().toggleStar(docId) });
  },

  updateConfig: async (patch) => {
    set({ config: await api().updateConfig(patch) });
  },

  setTheme: async (mode) => {
    set({ config: await api().updateConfig({ theme: mode }) });
    get().applyTheme();
  },

  applyTheme: () => {
    const resolved = resolveTheme(get().config?.theme ?? 'system');
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    if (get().resolvedTheme !== resolved) set({ resolvedTheme: resolved });
  },

  setView: (v) => set({ view: v }),
  setRightTab: (t) => set({ rightTab: t }),
  setPalette: (open) => set({ paletteOpen: open }),
  search: (q) => api().search({ query: q, limit: 30 }),
  openTags: (tag = null) => set({ view: 'tags', tagFilter: tag }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  openSearch: (q) => set({ view: 'search', searchQuery: q, paletteOpen: false }),
  backlinks: (id) => api().backlinks(id),
  listTags: () => api().listTags(),
}));
