# @docvault/core

Storage + index core for DocVault: the markdown vault, SQLite (FTS5) index,
backlinks, importers, file watcher, and semantic search. The markdown files on
disk are the source of truth; SQLite is a rebuildable cache.

## Semantic search

Meaning-based search runs **fully on-device** — no API keys, no network at query
time.

- **Embeddings**: [`@xenova/transformers`](https://github.com/xenova/transformers.js)
  (transformers.js) with `Xenova/all-MiniLM-L6-v2` (384-dim, mean-pooled +
  L2-normalized). The model is lazy-loaded on first use and cached for the
  process; the library downloads + caches the model (~25 MB) on first run, then
  works offline. See `src/embed.ts`.
  - `TransformersEmbedder` implements the `Embedder` interface. The interface is
    the seam: inject a stub (`DocVault.open(root, { embedder })`) so tests run
    fast and offline with no model download.
- **Chunking**: `src/chunk.ts` splits a doc's markdown into semantically-sized
  chunks, each carrying its heading breadcrumb (e.g. `Setup > Database`). Fenced
  code blocks are kept intact. Pure + unit-tested.
- **Vector store**: a `chunks` table in the existing SQLite DB (managed by
  `Indexer`, migrated via `PRAGMA user_version`). Embeddings are stored as
  little-endian Float32 BLOBs; similarity is brute-force cosine, top-K.
- **Hybrid**: `searchHybrid` fuses FTS5 (bm25) and vector rankings with
  Reciprocal Rank Fusion (RRF), so exact keyword matches and paraphrases both
  surface.
- **Indexing**: embedding is **fire-and-forget** off the main index path — a
  create/update/import returns as soon as FTS + metadata are ready, and vectors
  fill in via a per-doc serialized background queue (latest edit wins, no
  duplicate chunks). Tests/CLIs can `await dv.whenEmbeddingsSettled()`.
  `dv.backfillEmbeddings(onProgress?)` embeds any docs that still lack chunks.

### Why this stack

Decided up front (local-first, zero-config): transformers.js + MiniLM keeps
everything on-device and free; a SQLite BLOB column avoids a second datastore;
cosine is trivially correct and fast enough for a personal docs vault; RRF needs
no score normalization between the two very different ranking scales.

## Build / test

```sh
pnpm --filter @docvault/core build
pnpm --filter @docvault/core test
```
