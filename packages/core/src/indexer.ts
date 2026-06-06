import Database from 'better-sqlite3';
import { extractWikilinks } from './links.js';
import type { Doc, DocMeta, SearchHit, SearchOptions } from './types.js';
import type { Vault } from './vault.js';

/**
 * Turn arbitrary user input into a safe FTS5 MATCH expression. Each word is
 * tokenized and wrapped as a quoted phrase so that FTS5 operators (`*`, `:`,
 * `-`, `"`, `AND`, `NEAR`, parentheses) in the input can never reach the query
 * parser and crash the search. Returns null when there is nothing to match.
 */
export function toFtsMatch(query: string): string | null {
  const terms = query.match(/[\p{L}\p{N}_]+/gu);
  if (!terms || terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(' ');
}

/**
 * SQLite-backed search/metadata index over the markdown vault. The files on
 * disk remain the source of truth; this DB is a rebuildable cache that powers
 * fast full-text search, tag filters, and backlinks.
 */
export class Indexer {
  private db: Database.Database;

  constructor(vault: Vault) {
    this.vault = vault;
    this.db = new Database(vault.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private readonly vault: Vault;

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id        TEXT PRIMARY KEY,
        rel_path  TEXT UNIQUE NOT NULL,
        title     TEXT NOT NULL,
        product   TEXT,
        status    TEXT NOT NULL,
        created   TEXT NOT NULL,
        updated   TEXT NOT NULL,
        source    TEXT
      );
      CREATE TABLE IF NOT EXISTS tags (
        doc_id TEXT NOT NULL,
        tag    TEXT NOT NULL,
        PRIMARY KEY (doc_id, tag)
      );
      CREATE TABLE IF NOT EXISTS links (
        src_id TEXT NOT NULL,   -- doc that contains the link
        dst    TEXT NOT NULL,   -- target doc id or title
        PRIMARY KEY (src_id, dst)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        doc_id UNINDEXED, title, body
      );
    `);
  }

  /** Insert or update a single doc's index entry. */
  upsert(doc: Doc): void {
    const { frontmatter: fm } = doc;
    const product = this.vault.productOf(doc.relPath);
    const tx = this.db.transaction(() => {
      // If another doc currently occupies this rel_path (e.g. a file was moved,
      // or two files share an id), drop it first so the UNIQUE(rel_path)
      // constraint can't throw and the index stays consistent with disk.
      const conflict = this.db
        .prepare('SELECT id FROM docs WHERE rel_path = ? AND id != ?')
        .get(doc.relPath, fm.id) as { id: string } | undefined;
      if (conflict) this.deleteDocRows(conflict.id);

      this.db
        .prepare(
          `INSERT INTO docs (id, rel_path, title, product, status, created, updated, source)
           VALUES (@id, @rel_path, @title, @product, @status, @created, @updated, @source)
           ON CONFLICT(id) DO UPDATE SET
             rel_path=@rel_path, title=@title, product=@product, status=@status,
             updated=@updated, source=@source`,
        )
        .run({
          id: fm.id,
          rel_path: doc.relPath,
          title: fm.title,
          product,
          status: fm.status,
          created: fm.created,
          updated: fm.updated,
          source: fm.source ?? null,
        });

      this.db.prepare('DELETE FROM tags WHERE doc_id = ?').run(fm.id);
      const insTag = this.db.prepare('INSERT OR IGNORE INTO tags (doc_id, tag) VALUES (?, ?)');
      for (const tag of fm.tags) insTag.run(fm.id, tag);

      this.db.prepare('DELETE FROM links WHERE src_id = ?').run(fm.id);
      const insLink = this.db.prepare('INSERT OR IGNORE INTO links (src_id, dst) VALUES (?, ?)');
      for (const dst of extractWikilinks(doc.content)) insLink.run(fm.id, dst);
      for (const dst of fm.links ?? []) insLink.run(fm.id, dst);

      this.db.prepare('DELETE FROM docs_fts WHERE doc_id = ?').run(fm.id);
      this.db
        .prepare('INSERT INTO docs_fts (doc_id, title, body) VALUES (?, ?, ?)')
        .run(fm.id, fm.title, doc.content);
    });
    tx();
  }

  /** Remove a doc from the index by its rel path. */
  removeByPath(relPath: string): void {
    const row = this.db.prepare('SELECT id FROM docs WHERE rel_path = ?').get(relPath) as
      | { id: string }
      | undefined;
    if (row) this.removeById(row.id);
  }

  removeById(docId: string): void {
    this.db.transaction(() => this.deleteDocRows(docId))();
  }

  /** Delete every row for a doc across all tables. Caller wraps in a tx. */
  private deleteDocRows(docId: string): void {
    this.db.prepare('DELETE FROM docs_fts WHERE doc_id = ?').run(docId);
    this.db.prepare('DELETE FROM tags WHERE doc_id = ?').run(docId);
    this.db.prepare('DELETE FROM links WHERE src_id = ?').run(docId);
    this.db.prepare('DELETE FROM docs WHERE id = ?').run(docId);
  }

  /** Batch-load tags for a set of doc ids (avoids an N+1 query per row). */
  private tagsByDoc(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT doc_id, tag FROM tags WHERE doc_id IN (${placeholders}) ORDER BY tag`)
      .all(...ids) as { doc_id: string; tag: string }[];
    for (const { doc_id, tag } of rows) {
      const list = map.get(doc_id);
      if (list) list.push(tag);
      else map.set(doc_id, [tag]);
    }
    return map;
  }

  private rowToMeta(row: Record<string, unknown>, tags: string[]): DocMeta {
    return {
      id: row.id as string,
      title: row.title as string,
      relPath: row.rel_path as string,
      product: (row.product as string | null) ?? null,
      tags,
      status: row.status as DocMeta['status'],
      created: row.created as string,
      updated: row.updated as string,
      source: (row.source as string | null) ?? null,
    };
  }

  /** Map a set of doc rows to metadata, batch-loading their tags. */
  private rowsToMeta(rows: Record<string, unknown>[]): DocMeta[] {
    const tags = this.tagsByDoc(rows.map((r) => r.id as string));
    return rows.map((r) => this.rowToMeta(r, tags.get(r.id as string) ?? []));
  }

  /** List doc metadata, optionally filtered by product and/or tag. */
  listDocs(opts: { product?: string; tag?: string } = {}): DocMeta[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.product) {
      clauses.push('product = ?');
      params.push(opts.product);
    }
    if (opts.tag) {
      clauses.push('id IN (SELECT doc_id FROM tags WHERE tag = ?)');
      params.push(opts.tag);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM docs ${where} ORDER BY updated DESC`)
      .all(...params) as Record<string, unknown>[];
    return this.rowsToMeta(rows);
  }

  getById(id: string): DocMeta | null {
    const row = this.db.prepare('SELECT * FROM docs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMeta(row, this.tagsByDoc([id]).get(id) ?? []) : null;
  }

  /** Full-text search with bm25 ranking and highlighted snippets. */
  search(opts: SearchOptions): SearchHit[] {
    const match = toFtsMatch(opts.query);
    if (!match) return [];
    const limit = opts.limit ?? 25;
    // Product/tag filters are applied in SQL (not after LIMIT) so a scoped
    // search returns up to `limit` matching docs, not just those that happen to
    // fall in the first `limit` raw FTS hits.
    const params: Record<string, unknown> = { match, limit };
    let filters = '';
    if (opts.product) {
      filters += ' AND d.product = @product';
      params.product = opts.product;
    }
    if (opts.tag) {
      filters += ' AND d.id IN (SELECT doc_id FROM tags WHERE tag = @tag)';
      params.tag = opts.tag;
    }
    // Column weights: doc_id (ignored), title 5x, body 1x.
    const rows = this.db
      .prepare(
        `SELECT d.*,
                bm25(docs_fts, 0.0, 5.0, 1.0) AS rank,
                snippet(docs_fts, 2, '«', '»', '…', 12) AS snippet
         FROM docs_fts
         JOIN docs d ON d.id = docs_fts.doc_id
         WHERE docs_fts MATCH @match${filters}
         ORDER BY rank
         LIMIT @limit`,
      )
      .all(params) as (Record<string, unknown> & { rank: number; snippet: string })[];

    const tags = this.tagsByDoc(rows.map((r) => r.id as string));
    return rows.map((r) => ({
      ...this.rowToMeta(r, tags.get(r.id as string) ?? []),
      snippet: r.snippet,
      rank: r.rank,
    }));
  }

  /** Docs that link TO the given doc (resolved by id or title). */
  backlinks(docId: string): DocMeta[] {
    const meta = this.getById(docId);
    if (!meta) return [];
    const targets = [docId, meta.title];
    const placeholders = targets.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT DISTINCT d.* FROM docs d
         JOIN links l ON l.src_id = d.id
         WHERE l.dst IN (${placeholders})`,
      )
      .all(...targets) as Record<string, unknown>[];
    return this.rowsToMeta(rows);
  }

  listTags(): { tag: string; count: number }[] {
    return this.db
      .prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag')
      .all() as { tag: string; count: number }[];
  }

  /** Clear everything (used by full reindex). */
  clear(): void {
    this.db.exec(
      'DELETE FROM docs; DELETE FROM tags; DELETE FROM links; DELETE FROM docs_fts;',
    );
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
