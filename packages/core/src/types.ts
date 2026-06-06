/** Shared types for the DocVault core library. */

export type DocStatus = 'draft' | 'published' | 'archived';

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

/** App-level state that is not doc content (lives in .docvault/config.json). */
export interface VaultConfig {
  workspaceName: string;
  starred: string[]; // doc ids
  recent: string[]; // doc ids, most-recent first
  trash: string[]; // relative paths of soft-deleted docs
  aiBackend: 'claude' | 'codex';
}

export const DEFAULT_CONFIG: VaultConfig = {
  workspaceName: 'My Workspace',
  starred: [],
  recent: [],
  trash: [],
  aiBackend: 'claude',
};
