import type { DocVaultApi } from '../shared/ipc';

declare global {
  interface Window {
    docvault: DocVaultApi;
  }
}

export {};
