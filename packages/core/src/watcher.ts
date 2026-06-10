import chokidar, { type FSWatcher } from 'chokidar';
import { parseDoc } from './doc.js';
import { isImportable, reextract } from './import/index.js';
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
  /** Per-path promise chain so rapid events for one file reindex in order. */
  private queues = new Map<string, Promise<void>>();

  constructor(
    private readonly vault: Vault,
    private readonly indexer: Indexer,
    private readonly onChange?: (change: VaultChange) => void,
    private readonly onError?: (err: Error) => void,
  ) {}

  start(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch([this.vault.docsDir, this.vault.assetsDir], {
      ignoreInitial: true,
      ignored: (p) => p.includes(`${this.vault.metaDir}`),
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    const handleUpsert = (abs: string) => {
      if (!this.contained(abs)) return;
      if (abs.endsWith('.md')) {
        this.enqueue(abs, () => this.reindexOne(abs));
      } else if (isImportable(abs)) {
        // An imported original (pdf/docx/txt) changed on disk: regenerate its
        // markdown sidecar so search + agents see the new content.
        this.enqueue(abs, () => this.reextractOne(abs));
      }
    };
    this.watcher
      .on('add', handleUpsert)
      .on('change', handleUpsert)
      .on('unlink', (abs) => {
        if (!abs.endsWith('.md') || !this.contained(abs)) return;
        this.enqueue(abs, async () => {
          const relPath = this.vault.rel(abs);
          this.indexer.removeByPath(relPath);
          this.onChange?.({ type: 'remove', relPath });
        });
      })
      // An 'error' event on an EventEmitter with no listener throws and kills
      // the process — a transient fs error (e.g. EMFILE) must not take the
      // sidecar down. Log it and surface it to the host via onError.
      .on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[docvault] watcher error:', error);
        this.onError?.(error);
      });
  }

  /**
   * Defense-in-depth: confirm an event path canonically resolves inside the
   * vault before we read it. `vault.abs()` throws on any symlink escape, so a
   * link the watcher still surfaced can't pull in out-of-vault content.
   */
  private contained(abs: string): boolean {
    try {
      this.vault.abs(this.vault.rel(abs));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run `task` after any previously queued task for the same path, so a stale
   * read can never land after a newer one and leave the index out of sync.
   */
  private enqueue(abs: string, task: () => Promise<void>): void {
    const prev = this.queues.get(abs) ?? Promise.resolve();
    const next = prev.then(task, task).finally(() => {
      if (this.queues.get(abs) === next) this.queues.delete(abs);
    });
    this.queues.set(abs, next);
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

  private async reextractOne(abs: string): Promise<void> {
    try {
      const doc = await reextract(this.vault, abs);
      if (doc) {
        this.indexer.upsert(doc);
        this.onChange?.({ type: 'upsert', relPath: doc.relPath });
      }
    } catch {
      /* unreadable / unsupported mid-event; ignore */
    }
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
