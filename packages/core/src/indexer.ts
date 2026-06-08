import Database from 'better-sqlite3';
import { blobToVector, cosineSimilarity, vectorToBlob } from './embed.js';
import { extractWikilinks } from './links.js';
import type { Doc, DocMeta, SearchHit, SearchOptions } from './types.js';
import type { Vault } from './vault.js';

/** A markdown chunk persisted with its embedding for semantic search. */
export interface StoredChunk {
  docId: string;
  chunkIndex: number;
  breadcrumb: string;
  text: string;
  embedding: Float32Array;
}

/** A single semantic hit: the best-matching passage of a doc plus its score. */
export interface SemanticHit extends DocMeta {
  /** The matching chunk's text (breadcrumb-prefixed). */
  passage: string;
  /** Heading breadcrumb of the matching chunk, e.g. "Setup > Database". */
  breadcrumb: string;
  /** Cosine similarity in [-1, 1]; higher is a better match. */
  score: number;
}

/** A fused hit combining full-text and vector rankings via RRF. */
export interface HybridHit extends DocMeta {
  /** Reciprocal-rank-fusion score; higher is a better match. */
  score: number;
  /** Best snippet/passage available (FTS snippet, else semantic passage). */
  snippet: string;
  /** True if the doc appeared in the full-text results. */
  inFts: boolean;
  /** True if the doc appeared in the vector results. */
  inSemantic: boolean;
}

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

    // Versioned migrations for additive schema (semantic search). Bump
    // PRAGMA user_version as new steps are added; each step is idempotent.
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      // chunks: one row per embedded passage. Indexed by doc_id so a doc's old
      // chunks can be dropped + replaced atomically on re-index. The embedding
      // is a little-endian Float32 BLOB (see embed.ts vectorToBlob/blobToVector).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          doc_id      TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          breadcrumb  TEXT NOT NULL,
          text        TEXT NOT NULL,
          embedding   BLOB NOT NULL,
          PRIMARY KEY (doc_id, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS chunks_doc_id ON chunks(doc_id);
      `);
      this.db.pragma('user_version = 1');
    }
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
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
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

  /** Look up a doc's id by its vault-relative path (or null if not indexed). */
  idByPath(relPath: string): string | null {
    const row = this.db.prepare('SELECT id FROM docs WHERE rel_path = ?').get(relPath) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
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
      'DELETE FROM docs; DELETE FROM tags; DELETE FROM links; DELETE FROM docs_fts; DELETE FROM chunks;',
    );
  }

  // --- Semantic / vector index ------------------------------------------

  /**
   * Replace all stored chunks for a doc with a fresh set (atomically). Passing
   * an empty array just drops the doc's chunks. The doc itself must already be
   * upserted; chunks are keyed by its id.
   */
  replaceChunks(docId: string, chunks: StoredChunk[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
      const ins = this.db.prepare(
        `INSERT INTO chunks (doc_id, chunk_index, breadcrumb, text, embedding)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const c of chunks) {
        ins.run(docId, c.chunkIndex, c.breadcrumb, c.text, vectorToBlob(c.embedding));
      }
    });
    tx();
  }

  /** True if the doc currently has at least one stored chunk. */
  hasChunks(docId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM chunks WHERE doc_id = ? LIMIT 1').get(docId);
    return row !== undefined;
  }

  /** Doc ids that are indexed but have no chunks yet (backfill candidates). */
  docIdsWithoutChunks(): string[] {
    const rows = this.db
      .prepare(
        `SELECT d.id FROM docs d
         LEFT JOIN chunks c ON c.doc_id = d.id
         WHERE c.doc_id IS NULL`,
      )
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Total number of stored chunks (diagnostics / tests). */
  chunkCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  }

  /** Number of chunks stored for a single doc (tests / diagnostics). */
  chunkCountFor(docId: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?').get(docId) as {
        n: number;
      }
    ).n;
  }

  /**
   * Top-K semantic search: score every stored chunk against the query vector by
   * cosine similarity, keep the single best chunk per doc, and return the top K
   * docs. Optional product/tag filters are applied while scanning.
   *
   * This is a brute-force scan over all chunk vectors. For a local docs vault
   * (thousands of chunks) that's well under a millisecond; if a vault ever grows
   * large enough to matter, this is the seam to add an ANN index behind.
   */
  searchSemantic(
    queryVec: Float32Array,
    opts: { k?: number; product?: string; tag?: string } = {},
  ): SemanticHit[] {
    const k = opts.k ?? 10;
    const params: Record<string, unknown> = {};
    let filters = '';
    if (opts.product) {
      filters += ' AND d.product = @product';
      params.product = opts.product;
    }
    if (opts.tag) {
      filters += ' AND d.id IN (SELECT doc_id FROM tags WHERE tag = @tag)';
      params.tag = opts.tag;
    }
    const rows = this.db
      .prepare(
        `SELECT c.doc_id, c.breadcrumb, c.text, c.embedding, d.*
         FROM chunks c JOIN docs d ON d.id = c.doc_id
         WHERE 1=1${filters}`,
      )
      .all(params) as (Record<string, unknown> & {
      doc_id: string;
      breadcrumb: string;
      text: string;
      embedding: Buffer;
    })[];

    // Keep the best-scoring chunk per doc.
    const best = new Map<string, { row: (typeof rows)[number]; score: number }>();
    for (const row of rows) {
      const score = cosineSimilarity(queryVec, blobToVector(row.embedding));
      const prev = best.get(row.doc_id);
      if (!prev || score > prev.score) best.set(row.doc_id, { row, score });
    }

    const top = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
    const tags = this.tagsByDoc(top.map((t) => t.row.id as string));
    return top.map(({ row, score }) => ({
      ...this.rowToMeta(row, tags.get(row.id as string) ?? []),
      passage: row.text,
      breadcrumb: row.breadcrumb,
      score,
    }));
  }

  /**
   * Hybrid search: fuse the full-text (bm25) ranking with the vector (cosine)
   * ranking using Reciprocal Rank Fusion (RRF). Each list contributes
   * `1 / (rrfK + rank)` per doc; the scores sum, so a doc ranked highly by
   * either signal — and especially by both — floats to the top. RRF is rank-
   * based, so it needs no score normalization between the two very different
   * scales (bm25 vs cosine).
   *
   * `rrfK` (default 60, the canonical value) damps the contribution of lower
   * ranks. We pull a deeper candidate pool from each side (`poolMultiplier`) so
   * fusion can promote a doc that's mid-list in one signal but top in the other.
   */
  searchHybrid(
    query: string,
    queryVec: Float32Array,
    opts: { k?: number; product?: string; tag?: string; rrfK?: number } = {},
  ): HybridHit[] {
    const k = opts.k ?? 10;
    const rrfK = opts.rrfK ?? 60;
    const pool = Math.max(k * 5, 25);
    const filter = {
      ...(opts.product ? { product: opts.product } : {}),
      ...(opts.tag ? { tag: opts.tag } : {}),
    };

    const ftsHits = this.search({ query, limit: pool, ...filter });
    const semHits = this.searchSemantic(queryVec, { k: pool, ...filter });

    type Acc = {
      meta: DocMeta;
      score: number;
      snippet: string;
      inFts: boolean;
      inSemantic: boolean;
    };
    const acc = new Map<string, Acc>();
    const bump = (meta: DocMeta, rank: number, snippet: string, which: 'fts' | 'sem'): void => {
      const cur = acc.get(meta.id) ?? {
        meta,
        score: 0,
        snippet: '',
        inFts: false,
        inSemantic: false,
      };
      cur.score += 1 / (rrfK + rank);
      // Prefer an FTS snippet (it highlights matched terms); fall back to the
      // semantic passage when only the vector side found this doc.
      if (which === 'fts') {
        cur.snippet = snippet;
        cur.inFts = true;
      } else {
        if (!cur.inFts) cur.snippet = snippet;
        cur.inSemantic = true;
      }
      acc.set(meta.id, cur);
    };

    ftsHits.forEach((h, i) => bump(h, i, h.snippet, 'fts'));
    semHits.forEach((h, i) => bump(h, i, h.passage, 'sem'));

    return [...acc.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((a) => ({
        ...a.meta,
        score: a.score,
        snippet: a.snippet,
        inFts: a.inFts,
        inSemantic: a.inSemantic,
      }));
  }

  /**
   * Nearest-neighbour docs for an already-indexed doc, using its stored chunk
   * embeddings (no re-embedding). Scores every *other* doc's chunks against the
   * source doc's chunks and keeps the single best chunk-pair similarity per
   * candidate doc, then returns the top K. The source doc is excluded. If the
   * source has no stored chunks yet (not embedded), returns an empty list.
   */
  relatedDocs(docId: string, opts: { k?: number } = {}): SemanticHit[] {
    const k = opts.k ?? 8;
    const srcRows = this.db
      .prepare('SELECT embedding FROM chunks WHERE doc_id = ?')
      .all(docId) as { embedding: Buffer }[];
    if (srcRows.length === 0) return [];
    const srcVecs = srcRows.map((r) => blobToVector(r.embedding));

    const rows = this.db
      .prepare(
        `SELECT c.doc_id, c.breadcrumb, c.text, c.embedding, d.*
         FROM chunks c JOIN docs d ON d.id = c.doc_id
         WHERE c.doc_id != ?`,
      )
      .all(docId) as (Record<string, unknown> & {
      doc_id: string;
      breadcrumb: string;
      text: string;
      embedding: Buffer;
    })[];

    const best = new Map<string, { row: (typeof rows)[number]; score: number }>();
    for (const row of rows) {
      const vec = blobToVector(row.embedding);
      let score = -Infinity;
      for (const s of srcVecs) {
        const sim = cosineSimilarity(s, vec);
        if (sim > score) score = sim;
      }
      const prev = best.get(row.doc_id);
      if (!prev || score > prev.score) best.set(row.doc_id, { row, score });
    }

    const top = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
    const tags = this.tagsByDoc(top.map((t) => t.row.id as string));
    return top.map(({ row, score }) => ({
      ...this.rowToMeta(row, tags.get(row.id as string) ?? []),
      passage: row.text,
      breadcrumb: row.breadcrumb,
      score,
    }));
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
