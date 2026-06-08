import { contextBridge, ipcRenderer } from 'electron';
import { CH, EV, type DocVaultApi } from '../shared/ipc.js';

const api: DocVaultApi = {
  listProducts: () => ipcRenderer.invoke(CH.listProducts),
  createProduct: (slug, meta) => ipcRenderer.invoke(CH.createProduct, slug, meta),
  listDocs: (opts) => ipcRenderer.invoke(CH.listDocs, opts),
  readDoc: (idOrPath) => ipcRenderer.invoke(CH.readDoc, idOrPath),
  createDoc: (input) => ipcRenderer.invoke(CH.createDoc, input),
  updateDoc: (relPath, patch) => ipcRenderer.invoke(CH.updateDoc, relPath, patch),
  trashDoc: (relPath) => ipcRenderer.invoke(CH.trashDoc, relPath),
  deleteProduct: (slug) => ipcRenderer.invoke(CH.deleteProduct, slug),
  listTrash: () => ipcRenderer.invoke(CH.listTrash),
  restoreTrash: (trashPath) => ipcRenderer.invoke(CH.restoreTrash, trashPath),
  search: (opts) => ipcRenderer.invoke(CH.search, opts),
  backlinks: (id) => ipcRenderer.invoke(CH.backlinks, id),
  listTags: () => ipcRenderer.invoke(CH.listTags),
  listTemplates: () => ipcRenderer.invoke(CH.listTemplates),
  createDocFromTemplate: (args) => ipcRenderer.invoke(CH.createDocFromTemplate, args),
  saveAsTemplate: (idOrPath, name) => ipcRenderer.invoke(CH.saveAsTemplate, idOrPath, name),
  importFile: () => ipcRenderer.invoke(CH.importFile),
  openOriginal: (relPath) => ipcRenderer.invoke(CH.openOriginal, relPath),
  readSource: (relPath) => ipcRenderer.invoke(CH.readSource, relPath),
  getConfig: () => ipcRenderer.invoke(CH.getConfig),
  updateConfig: (patch) => ipcRenderer.invoke(CH.updateConfig, patch),
  toggleStar: (id) => ipcRenderer.invoke(CH.toggleStar, id),
  pushRecent: (id) => ipcRenderer.invoke(CH.pushRecent, id),
  ai: {
    ask: (requestId, prompt) => ipcRenderer.invoke(CH.aiAsk, requestId, prompt),
    cancel: (requestId) => ipcRenderer.invoke(CH.aiCancel, requestId),
    onChunk: (cb) => {
      const fn = (_e: unknown, id: string, text: string) => cb(id, text);
      ipcRenderer.on(EV.aiChunk, fn);
      return () => ipcRenderer.removeListener(EV.aiChunk, fn);
    },
    onDone: (cb) => {
      const fn = (_e: unknown, id: string, error?: string) => cb(id, error);
      ipcRenderer.on(EV.aiDone, fn);
      return () => ipcRenderer.removeListener(EV.aiDone, fn);
    },
  },
  onVaultChanged: (cb) => {
    const fn = (_e: unknown, paths: string[] = []) => cb(paths);
    ipcRenderer.on(EV.vaultChanged, fn);
    return () => ipcRenderer.removeListener(EV.vaultChanged, fn);
  },
};

contextBridge.exposeInMainWorld('docvault', api);
