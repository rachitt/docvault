import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, type VaultConfig } from './types.js';

/**
 * Resolves the on-disk layout of a vault and manages the app-level config file.
 * The vault directory is the single source of truth shared by the desktop app,
 * the MCP server, and any agents working in the folder.
 */
export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get docsDir(): string {
    return path.join(this.root, 'docs');
  }

  get assetsDir(): string {
    return path.join(this.root, 'assets');
  }

  get templatesDir(): string {
    return path.join(this.root, 'templates');
  }

  get metaDir(): string {
    return path.join(this.root, '.docvault');
  }

  get dbPath(): string {
    return path.join(this.metaDir, 'index.db');
  }

  get configPath(): string {
    return path.join(this.metaDir, 'config.json');
  }

  /** Absolute path for a doc path that is relative to the vault root. */
  abs(relPath: string): string {
    return path.join(this.root, relPath);
  }

  /** Vault-relative path (posix-style separators) for an absolute path. */
  rel(absPath: string): string {
    return path.relative(this.root, path.resolve(absPath)).split(path.sep).join('/');
  }

  /** The product slug (top-level docs/ folder) for a vault-relative doc path. */
  productOf(relPath: string): string | null {
    const parts = relPath.split('/');
    if (parts[0] === 'docs' && parts.length > 2) return parts[1] ?? null;
    return null;
  }

  /** Create the directory skeleton if missing. Safe to call repeatedly. */
  async ensure(): Promise<void> {
    for (const dir of [this.docsDir, this.assetsDir, this.templatesDir, this.metaDir]) {
      await mkdir(dir, { recursive: true });
    }
    if (!existsSync(this.configPath)) {
      await this.writeConfig(DEFAULT_CONFIG);
    }
  }

  async readConfig(): Promise<VaultConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<VaultConfig>) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async writeConfig(config: VaultConfig): Promise<void> {
    await mkdir(this.metaDir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  /** Apply a partial update to the config and persist it. */
  async updateConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    const next = { ...(await this.readConfig()), ...patch };
    await this.writeConfig(next);
    return next;
  }
}
