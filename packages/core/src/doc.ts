import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import { DOC_STATUSES, type Doc, type DocFrontmatter, type DocStatus } from './types.js';
import type { Vault } from './vault.js';

const nowIso = (): string => new Date().toISOString();

/**
 * Turn an arbitrary title into a safe kebab-case filename stem. Unicode letters
 * and numbers are preserved (so e.g. "日本語ガイド" keeps a distinct slug rather
 * than collapsing to `untitled`); everything else becomes a `-` separator.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'untitled';
}

/**
 * Validate a single path segment (product slug / filename stem) supplied by a
 * caller before it is composed into a vault path. Rejects separators, `..`, and
 * other characters that could traverse out of the intended folder. Unicode
 * letters/numbers are allowed so slugified non-Latin titles remain valid stems.
 */
export function assertSafeSegment(segment: string, kind = 'segment'): string {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(segment) || segment.includes('..')) {
    throw new Error(`Invalid ${kind}: ${segment}`);
  }
  return segment;
}

/**
 * Append -1, -2, ... to `stem` until `taken(candidate)` returns false, so a new
 * file never silently overwrites an existing one that already owns the name.
 * Shared by doc creation and the importer's destination picker.
 */
export function uniqueStem(stem: string, taken: (candidate: string) => boolean): string {
  let candidate = stem;
  let n = 1;
  while (taken(candidate)) candidate = `${stem}-${n++}`;
  return candidate;
}

/** Coerce an arbitrary frontmatter value into a valid DocStatus. */
function toStatus(value: unknown): DocStatus {
  return DOC_STATUSES.includes(value as DocStatus) ? (value as DocStatus) : 'draft';
}

/** Parse raw markdown (with frontmatter) into a Doc, backfilling missing fields. */
export function parseDoc(raw: string, vault: Vault, absPath: string): Doc {
  const parsed = matter(raw);
  const fm = parsed.data as Partial<DocFrontmatter>;
  const frontmatter: DocFrontmatter = {
    id: fm.id ?? ulid(),
    title: fm.title ?? deriveTitle(parsed.content, absPath),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status: toStatus(fm.status),
    created: fm.created ?? nowIso(),
    updated: fm.updated ?? nowIso(),
    ...(fm.links ? { links: fm.links.map(String) } : {}),
    ...(fm.source ? { source: String(fm.source) } : {}),
  };
  return {
    frontmatter,
    content: parsed.content.trimStart(),
    relPath: vault.rel(absPath),
    absPath,
  };
}

/** Serialize a Doc back to a markdown string with YAML frontmatter. */
export function serializeDoc(doc: Doc): string {
  return matter.stringify(`\n${doc.content.trim()}\n`, doc.frontmatter);
}

function deriveTitle(content: string, absPath: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return path.basename(absPath, path.extname(absPath));
}

export interface CreateDocInput {
  product: string;
  title: string;
  content?: string;
  tags?: string[];
  status?: DocStatus;
  /** Optional explicit filename stem; defaults to slugified title. */
  stem?: string;
}

/** Reads and writes managed markdown docs on disk. */
export class DocStore {
  constructor(private readonly vault: Vault) {}

  async read(relPath: string): Promise<Doc> {
    const absPath = this.vault.abs(relPath);
    const raw = await readFile(absPath, 'utf8');
    return parseDoc(raw, this.vault, absPath);
  }

  /**
   * Return every managed markdown file (vault-relative paths): docs under
   * docs/ plus import sidecars under assets/ (`assets/<file>.md`). Both are
   * indexed, watched, and re-indexed on open — keeping this walk in sync with
   * the watcher's coverage is what makes imported docs survive a restart.
   */
  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          out.push(this.vault.rel(full));
        }
      }
    };
    await walk(this.vault.docsDir);
    await walk(this.vault.assetsDir);
    return out.sort();
  }

  /** Persist a Doc, refreshing the updated timestamp. */
  async write(doc: Doc): Promise<Doc> {
    const next: Doc = { ...doc, frontmatter: { ...doc.frontmatter, updated: nowIso() } };
    await mkdir(path.dirname(next.absPath), { recursive: true });
    await writeFile(next.absPath, serializeDoc(next), 'utf8');
    return next;
  }

  /**
   * Create a brand-new doc under docs/<product>/, returning the saved Doc.
   * If the slug is already taken on disk the stem is suffixed (-1, -2, …) so
   * creating "Overview" twice never overwrites the existing overview.md.
   */
  async create(input: CreateDocInput): Promise<Doc> {
    const product = assertSafeSegment(input.product, 'product');
    const base = assertSafeSegment(input.stem ?? slugify(input.title), 'stem');
    const stem = uniqueStem(base, (s) => existsSync(this.vault.abs(`docs/${product}/${s}.md`)));
    const relPath = `docs/${product}/${stem}.md`;
    const absPath = this.vault.abs(relPath);
    const created = nowIso();
    const doc: Doc = {
      frontmatter: {
        id: ulid(),
        title: input.title,
        tags: input.tags ?? [],
        status: input.status ?? 'draft',
        created,
        updated: created,
      },
      content: input.content ?? `# ${input.title}\n`,
      relPath,
      absPath,
    };
    return this.write(doc);
  }

  /** Update a doc's body and/or selected frontmatter fields in place. */
  async update(
    relPath: string,
    patch: { content?: string; title?: string; tags?: string[]; status?: DocStatus },
  ): Promise<Doc> {
    const doc = await this.read(relPath);
    const next: Doc = {
      ...doc,
      content: patch.content ?? doc.content,
      frontmatter: {
        ...doc.frontmatter,
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      },
    };
    return this.write(next);
  }

  /**
   * Soft-delete: move a file or folder into .docvault/trash/ preserving its rel
   * path. The trashed copy is timestamped so repeated deletes of the same path
   * don't overwrite (and lose) a previously trashed version. Returns the new
   * vault-relative location so callers can record it for later restore.
   */
  async trash(relPath: string): Promise<string> {
    const from = this.vault.abs(relPath);
    const stamp = nowIso().replace(/[:.]/g, '-');
    const to = path.join(this.vault.metaDir, 'trash', stamp, relPath);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return this.vault.rel(to);
  }

  /** Move a previously trashed file/folder back to its original location. */
  async restore(trashPath: string, relPath: string): Promise<void> {
    const from = this.vault.abs(trashPath);
    const to = this.vault.abs(relPath);
    // Don't silently clobber a file/folder that now occupies the original path
    // (e.g. a new doc created at the same slug after the delete).
    if (existsSync(to)) {
      throw new Error(`Cannot restore: a file already exists at ${relPath}`);
    }
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }

  /** Permanently remove a trashed file/folder. Idempotent. */
  async purge(trashPath: string): Promise<void> {
    await rm(this.vault.abs(trashPath), { recursive: true, force: true });
  }
}
