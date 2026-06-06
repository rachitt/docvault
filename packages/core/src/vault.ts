import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeTrash, type VaultConfig } from './types.js';

/**
 * Resolve `target` to its canonical on-disk path, following symlinks. The target
 * may not exist yet (e.g. a path we're about to create), so we canonicalize the
 * longest existing prefix and re-append the not-yet-created tail. This surfaces a
 * symlinked ancestor that points elsewhere, which `path.resolve` alone hides.
 */
function canonicalize(target: string): string {
  let dir = target;
  const tail: string[] = [];
  while (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    tail.unshift(path.basename(dir));
    dir = parent;
  }
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    real = dir;
  }
  return tail.length ? path.join(real, ...tail) : real;
}

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

  /** Canonical (symlink-resolved) vault root, used for containment checks. */
  private get canonicalRoot(): string {
    try {
      return realpathSync(this.root);
    } catch {
      return this.root;
    }
  }

  /**
   * Absolute path for a doc path that is relative to the vault root.
   * Rejects any path that would escape the vault (e.g. `../../etc/passwd` or an
   * absolute path), so caller-supplied paths from the MCP server / UI cannot
   * read or write outside the vault. A two-stage check: a lexical gate against
   * `..`/absolute traversal, then a symlink gate that canonicalizes the path so a
   * symlink placed *inside* the vault can't redirect a read/write outside it.
   */
  abs(relPath: string): string {
    const resolved = path.resolve(this.root, relPath);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes vault: ${relPath}`);
    }
    const root = this.canonicalRoot;
    const canonical = canonicalize(resolved);
    if (canonical !== root && !canonical.startsWith(root + path.sep)) {
      throw new Error(`Path escapes vault (symlink): ${relPath}`);
    }
    return resolved;
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
      const parsed = JSON.parse(raw) as Partial<VaultConfig>;
      return { ...DEFAULT_CONFIG, ...parsed, trash: normalizeTrash(parsed.trash) };
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
