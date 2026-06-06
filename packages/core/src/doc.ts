import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import type { Doc, DocFrontmatter, DocStatus } from './types.js';
import type { Vault } from './vault.js';

const nowIso = (): string => new Date().toISOString();

/** Turn an arbitrary title into a safe kebab-case filename stem. */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'untitled';
}

/** Parse raw markdown (with frontmatter) into a Doc, backfilling missing fields. */
export function parseDoc(raw: string, vault: Vault, absPath: string): Doc {
  const parsed = matter(raw);
  const fm = parsed.data as Partial<DocFrontmatter>;
  const stat = existsSync(absPath);
  const frontmatter: DocFrontmatter = {
    id: fm.id ?? ulid(),
    title: fm.title ?? deriveTitle(parsed.content, absPath),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status: (fm.status as DocStatus) ?? 'draft',
    created: fm.created ?? nowIso(),
    updated: fm.updated ?? nowIso(),
    ...(fm.links ? { links: fm.links.map(String) } : {}),
    ...(fm.source ? { source: String(fm.source) } : {}),
  };
  void stat;
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

  /** Walk docs/ and return every managed markdown file (vault-relative paths). */
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
    return out.sort();
  }

  /** Persist a Doc, refreshing the updated timestamp. */
  async write(doc: Doc): Promise<Doc> {
    const next: Doc = { ...doc, frontmatter: { ...doc.frontmatter, updated: nowIso() } };
    await mkdir(path.dirname(next.absPath), { recursive: true });
    await writeFile(next.absPath, serializeDoc(next), 'utf8');
    return next;
  }

  /** Create a brand-new doc under docs/<product>/, returning the saved Doc. */
  async create(input: CreateDocInput): Promise<Doc> {
    const stem = input.stem ?? slugify(input.title);
    const relPath = `docs/${input.product}/${stem}.md`;
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

  /** Soft-delete: move the file into .docvault/trash/ preserving its rel path. */
  async trash(relPath: string): Promise<void> {
    const from = this.vault.abs(relPath);
    const to = path.join(this.vault.metaDir, 'trash', relPath);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }
}
