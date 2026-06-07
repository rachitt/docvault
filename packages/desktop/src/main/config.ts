import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeTrash, type VaultConfig } from '@docvault/core';

const DEFAULTS: VaultConfig = {
  workspaceName: 'My Workspace',
  starred: [],
  recent: [],
  trash: [],
  aiBackend: 'claude',
  aiStreaming: false,
  theme: 'system',
};

/**
 * Reads/writes the vault's app-level config (.docvault/config.json) directly.
 * This is plain JSON — no SQLite — so the Electron main process can own it
 * without loading any native module.
 */
export class ConfigStore {
  private readonly file: string;

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
    await writeFile(this.file, JSON.stringify(config, null, 2), 'utf8');
    return config;
  }

  async update(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    return this.write({ ...(await this.read()), ...patch });
  }

  async toggleStar(docId: string): Promise<VaultConfig> {
    const cfg = await this.read();
    const has = cfg.starred.includes(docId);
    return this.update({
      starred: has ? cfg.starred.filter((x) => x !== docId) : [...cfg.starred, docId],
    });
  }

  async pushRecent(docId: string, max = 20): Promise<VaultConfig> {
    const cfg = await this.read();
    return this.update({ recent: [docId, ...cfg.recent.filter((x) => x !== docId)].slice(0, max) });
  }
}
