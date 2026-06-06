import { create } from 'zustand';
import type { Doc, DocMeta, Product, SearchHit, VaultConfig } from '@docvault/core';

export type NavView = 'home' | 'recent' | 'starred' | 'templates' | 'trash' | 'doc';
export type RightTab = 'outline' | 'ai';

interface State {
  products: Product[];
  docs: DocMeta[];
  config: VaultConfig | null;
  currentDoc: Doc | null;
  view: NavView;
  rightTab: RightTab;
  paletteOpen: boolean;
  loading: boolean;

  refresh: () => Promise<void>;
  openDoc: (idOrPath: string) => Promise<void>;
  saveCurrent: (content: string) => Promise<void>;
  newDoc: (product: string, title: string) => Promise<void>;
  newProduct: (title: string) => Promise<void>;
  importFile: () => Promise<void>;
  toggleStar: (docId: string) => Promise<void>;
  setView: (v: NavView) => void;
  setRightTab: (t: RightTab) => void;
  setPalette: (open: boolean) => void;
  search: (q: string) => Promise<SearchHit[]>;
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
  config: null,
  currentDoc: null,
  view: 'home',
  rightTab: 'outline',
  paletteOpen: false,
  loading: true,

  refresh: async () => {
    const [products, docs, config] = await Promise.all([
      api().listProducts(),
      api().listDocs(),
      api().getConfig(),
    ]);
    set({ products, docs, config, loading: false });
  },

  openDoc: async (idOrPath) => {
    const doc = await api().readDoc(idOrPath);
    set({ currentDoc: doc, view: 'doc' });
    const config = await api().pushRecent(doc.frontmatter.id);
    set({ config });
  },

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

  importFile: async () => {
    const doc = await api().importFile();
    if (doc) {
      set({ docs: await api().listDocs() });
      await get().openDoc(doc.frontmatter.id);
    }
  },

  toggleStar: async (docId) => {
    set({ config: await api().toggleStar(docId) });
  },

  setView: (v) => set({ view: v }),
  setRightTab: (t) => set({ rightTab: t }),
  setPalette: (open) => set({ paletteOpen: open }),
  search: (q) => api().search({ query: q, limit: 30 }),
}));
