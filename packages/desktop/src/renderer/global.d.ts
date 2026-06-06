import type { DocVaultApi } from '../shared/ipc';

declare global {
  interface Window {
    docvault: DocVaultApi;
  }
}

// Vite `?url` asset imports resolve to a string URL (used for the pdf.js worker).
declare module '*?url' {
  const src: string;
  export default src;
}

export {};
