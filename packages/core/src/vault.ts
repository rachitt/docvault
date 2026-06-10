import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  /** Cached symlink-resolved root; the vault dir doesn't move during a process. */
  private canonicalRootCache: string | null = null;
  /** Serializes config read-modify-write so in-process updates don't clobber. */
  private updateQueue: Promise<unknown> = Promise.resolve();
  /** Monotonic counter for unique config temp-file names. */
  private writeSeq = 0;

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

  get versionsDir(): string {
    return path.join(this.metaDir, 'versions');
  }

  get dbPath(): string {
    return path.join(this.metaDir, 'index.db');
  }

  get configPath(): string {
    return path.join(this.metaDir, 'config.json');
  }

  /** Canonical (symlink-resolved) vault root, used for containment checks.
   *  Memoized — `abs()` is hot (one call per read/write/list element). */
  private get canonicalRoot(): string {
    if (this.canonicalRootCache !== null) return this.canonicalRootCache;
    try {
      this.canonicalRootCache = realpathSync(this.root);
    } catch {
      this.canonicalRootCache = this.root;
    }
    return this.canonicalRootCache;
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
    for (const dir of [this.docsDir, this.assetsDir, this.templatesDir, this.versionsDir]) {
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
    // Atomic write: a crash mid-write must not truncate/corrupt config.json.
    // Write to a unique temp file, then rename (atomic on the same fs). The name
    // is unique per call (pid + counter) so a direct, off-queue caller can't race
    // the same temp path; a failed rename cleans up its temp instead of leaking.
    const tmp = `${this.configPath}.${process.pid}.${this.writeSeq++}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
      await rename(tmp, this.configPath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Apply an update to the config and persist it. The patch may be a partial
   * object or an updater function that receives the freshly-read config — use
   * the function form for any read-modify-write on an array field (e.g. trash,
   * starred, recent) so concurrent in-process updates don't clobber each other.
   *
   * Updates are serialized within this process; cross-process writes to the
   * shared vault remain last-writer-wins by design.
   */
  async updateConfig(
    patch: Partial<VaultConfig> | ((cfg: VaultConfig) => Partial<VaultConfig>),
  ): Promise<VaultConfig> {
    const run = this.updateQueue.then(async () => {
      const current = await this.readConfig();
      const resolved = typeof patch === 'function' ? patch(current) : patch;
      const next = { ...current, ...resolved };
      await this.writeConfig(next);
      return next;
    });
    // Keep the chain alive even if one write rejects.
    this.updateQueue = run.catch(() => undefined);
    return run;
  }
}
