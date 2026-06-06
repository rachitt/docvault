import chokidar, { type FSWatcher } from 'chokidar';
import { parseDoc } from './doc.js';
import type { Indexer } from './indexer.js';
import type { Vault } from './vault.js';
import { readFile } from 'node:fs/promises';

export type VaultChange = { type: 'upsert' | 'remove'; relPath: string };

/**
 * Watches docs/ and assets/ for markdown changes and keeps the index in sync,
 * regardless of whether the desktop app, the MCP server, or an agent made the
 * edit. Emits changes via the optional onChange callback so UIs can refresh.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly vault: Vault,
    private readonly indexer: Indexer,
    private readonly onChange?: (change: VaultChange) => void,
  ) {}

  start(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch([this.vault.docsDir, this.vault.assetsDir], {
      ignoreInitial: true,
      ignored: (p) => p.includes(`${this.vault.metaDir}`),
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    const handleUpsert = (abs: string) => {
      if (!abs.endsWith('.md')) return;
      void this.reindexOne(abs);
    };
    this.watcher
      .on('add', handleUpsert)
      .on('change', handleUpsert)
      .on('unlink', (abs) => {
        if (!abs.endsWith('.md')) return;
        const relPath = this.vault.rel(abs);
        this.indexer.removeByPath(relPath);
        this.onChange?.({ type: 'remove', relPath });
      });
  }

  private async reindexOne(abs: string): Promise<void> {
    try {
      const raw = await readFile(abs, 'utf8');
      const doc = parseDoc(raw, this.vault, abs);
      this.indexer.upsert(doc);
      this.onChange?.({ type: 'upsert', relPath: doc.relPath });
    } catch {
      /* file vanished or unreadable mid-event; ignore */
    }
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
