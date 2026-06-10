import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeTrash, type VaultConfig } from '@docvault/core';

const DEFAULTS: VaultConfig = {
  workspaceName: 'My Workspace',
  starred: [],
  recent: [],
  trash: [],
  aiBackend: 'claude',
  aiStreaming: false,
  semanticEnabled: true,
  theme: 'system',
};

/**
 * Reads/writes the vault's app-level config (.docvault/config.json) directly.
 * This is plain JSON — no SQLite — so the Electron main process can own it
 * without loading any native module.
 *
 * Config *mutations* from the renderer are routed through the MCP sidecar
 * (single writer, see ipc.ts) — this store is the read path plus a hardened
 * fallback writer: writes are atomic (tmp + rename) and update() is a
 * serialized functional read-modify-write, mirroring core's Vault.updateConfig.
 * Cross-process writes to the shared file remain last-writer-wins by design.
 */
export class ConfigStore {
  private readonly file: string;
  private writeSeq = 0;
  private updateQueue: Promise<unknown> = Promise.resolve();

  constructor(vaultDir: string) {
    this.file = path.join(vaultDir, '.docvault', 'config.json');
  }

  async read(): Promise<VaultConfig> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<VaultConfig>;
      return { ...DEFAULTS, ...parsed, trash: normalizeTrash(parsed.trash) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async write(config: VaultConfig): Promise<VaultConfig> {
    await mkdir(path.dirname(this.file), { recursive: true });
    // Atomic write: a crash mid-write must not truncate/corrupt config.json.
    // Write to a unique temp file (pid + counter), then rename (atomic on the
    // same fs); a failed rename cleans up its temp instead of leaking.
    const tmp = `${this.file}.${process.pid}.${this.writeSeq++}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    return config;
  }

  /**
   * Apply an update and persist it. The patch may be a partial object or an
   * updater function that receives the freshly-read config — use the function
   * form for any read-modify-write on an array field so concurrent in-process
   * updates don't clobber each other. Updates are serialized in-process.
   */
  async update(
    patch: Partial<VaultConfig> | ((cfg: VaultConfig) => Partial<VaultConfig>),
  ): Promise<VaultConfig> {
    const run = this.updateQueue.then(async () => {
      const current = await this.read();
      const resolved = typeof patch === 'function' ? patch(current) : patch;
      return this.write({ ...current, ...resolved });
    });
    // Keep the chain alive even if one write rejects.
    this.updateQueue = run.catch(() => undefined);
    return run;
  }
}
