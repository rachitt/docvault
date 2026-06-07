/** Shared types for the DocVault core library. */

export const DOC_STATUSES = ['draft', 'published', 'archived'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** YAML frontmatter stored at the top of every managed markdown doc. */
export interface DocFrontmatter {
  id: string;
  title: string;
  tags: string[];
  status: DocStatus;
  created: string; // ISO date
  updated: string; // ISO date
  /** Explicit outbound links by doc id (in addition to inline [[wikilinks]]). */
  links?: string[];
  /** For imported sources (pdf/docx/txt): relative path to the original file. */
  source?: string;
}

/** A managed document: frontmatter + markdown body, plus its location. */
export interface Doc {
  frontmatter: DocFrontmatter;
  /** Markdown body (without frontmatter). */
  content: string;
  /** Path relative to the vault root, e.g. "docs/superchat/overview.md". */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
}

/** Lightweight metadata row used by listings and search results. */
export interface DocMeta {
  id: string;
  title: string;
  relPath: string;
  product: string | null;
  tags: string[];
  status: DocStatus;
  created: string;
  updated: string;
  source: string | null;
}

export interface SearchHit extends DocMeta {
  /** FTS snippet with matched terms highlighted using «» markers. */
  snippet: string;
  /** Lower is a better match (bm25). */
  rank: number;
}

export interface SearchOptions {
  query: string;
  product?: string;
  tag?: string;
  limit?: number;
}

/** A product = a top-level folder under docs/. Configured via product.json. */
export interface Product {
  /** Folder slug, e.g. "superchat". */
  slug: string;
  title: string;
  icon?: string;
  color?: string;
  order?: number;
  docCount: number;
}

/** UI color theme. 'system' follows the OS appearance. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** A soft-deleted doc or product, recoverable until auto-purged. */
export interface TrashEntry {
  /** What was trashed: a single doc or a whole product folder. */
  kind: 'doc' | 'product';
  /** Original vault-relative path (e.g. docs/superchat/overview.md or docs/superchat). */
  relPath: string;
  /** Current vault-relative location under .docvault/trash. */
  trashPath: string;
  /** Human label (doc title or product title) for the trash listing. */
  title: string;
  /** ISO timestamp of when it was trashed; drives 24h auto-purge. */
  deletedAt: string;
}

/**
 * Coerce a persisted `trash` value into valid TrashEntry rows, dropping anything
 * malformed. Tolerates configs written before trash carried restore metadata
 * (those legacy string entries are simply not surfaced).
 */
export function normalizeTrash(value: unknown): TrashEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is TrashEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as TrashEntry).relPath === 'string' &&
      typeof (e as TrashEntry).trashPath === 'string' &&
      typeof (e as TrashEntry).deletedAt === 'string' &&
      ((e as TrashEntry).kind === 'doc' || (e as TrashEntry).kind === 'product'),
  );
}

/** App-level state that is not doc content (lives in .docvault/config.json). */
export interface VaultConfig {
  workspaceName: string;
  starred: string[]; // doc ids
  recent: string[]; // doc ids, most-recent first
  trash: TrashEntry[]; // soft-deleted docs/products, recoverable until auto-purged
  aiBackend: 'claude' | 'codex';
  /** Stream the assistant's output token-by-token. Off by default. */
  aiStreaming: boolean;
  /** UI color theme; 'system' tracks the OS appearance. */
  theme: ThemeMode;
}

export const DEFAULT_CONFIG: VaultConfig = {
  workspaceName: 'My Workspace',
  starred: [],
  recent: [],
  trash: [],
  aiBackend: 'claude',
  aiStreaming: false,
  theme: 'system',
};
