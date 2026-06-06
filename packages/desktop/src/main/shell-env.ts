import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * GUI apps launched from Finder/Applications do NOT inherit the user's shell
 * PATH, so `node`, `claude`, and `codex` are not found. These helpers recover a
 * login-shell PATH and resolve binaries to absolute paths.
 */

let cachedPath: string | null = null;

/** The user's login-shell PATH (cached), falling back to a sensible default. */
export function loginPath(): string {
  if (cachedPath) return cachedPath;
  const fallback = `${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  try {
    const envShell = process.env.SHELL;
    // Only trust SHELL if it's a plain absolute path (no spaces, flags, or shell
    // metacharacters) so a tampered env var can't inject a command here.
    const shell = envShell && /^\/[\w./-]+$/.test(envShell) ? envShell : '/bin/zsh';
    const out = execSync(`${shell} -lic 'printf "%s" "$PATH"'`, {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cachedPath = out ? `${out}:${fallback}` : fallback;
  } catch {
    cachedPath = fallback;
  }
  return cachedPath;
}

/** process.env with the recovered PATH merged in, for spawning CLIs. */
export function enhancedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${loginPath()}:${process.env.PATH ?? ''}` };
}

/** Resolve a CLI to an absolute path: explicit candidates, then PATH lookup. */
export function resolveBin(name: string, candidates: string[] = []): string {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  for (const dir of loginPath().split(':')) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  return name; // last resort; spawn may still find it via PATH
}
