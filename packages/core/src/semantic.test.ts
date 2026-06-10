import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocVault } from './docvault.js';
import type { Embedder } from './embed.js';

/**
 * Deterministic, offline stub embedder. Hashes each lowercased word into a fixed
 * number of buckets and L2-normalizes, so texts sharing vocabulary land near
 * each other in cosine space — enough to exercise ranking without a real model.
 */
class HashingEmbedder implements Embedder {
  readonly dim = 64;
  /** Counts how many texts have been embedded (proves re-embed actually ran). */
  calls = 0;

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls += texts.length;
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 0;
        for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) | 0;
        v[Math.abs(h) % this.dim] += 1;
      }
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < v.length; i++) v[i]! /= norm;
      return v;
    });
  }
}

describe('semantic + hybrid search', () => {
  let root: string;
  let dv: DocVault;
  let embedder: HashingEmbedder;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'docvault-sem-'));
    embedder = new HashingEmbedder();
    dv = await DocVault.open(root, { embedder });
  });

  afterEach(async () => {
    await dv.close();
    await rm(root, { recursive: true, force: true });
  });

  it('embeds a created doc into chunks (in the background) and finds it semantically', async () => {
    const doc = await dv.createDoc({
      product: 'p',
      title: 'Database setup',
      content:
        '# Database setup\n\nConfigure the postgres connection string and run migrations.',
    });
    await dv.whenEmbeddingsSettled();
    expect(dv.takeEmbedError()).toBeNull();
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBeGreaterThan(0);

    const hits = await dv.searchSemantic('configure postgres connection', { k: 5 });
    expect(hits[0]?.id).toBe(doc.frontmatter.id);
    expect(hits[0]?.passage).toContain('postgres');
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('ranks the more relevant doc higher in semantic search', async () => {
    await dv.createDoc({
      product: 'p',
      title: 'Cooking',
      content: '# Cooking\n\nBake bread with flour water yeast and salt in the oven.',
    });
    const target = await dv.createDoc({
      product: 'p',
      title: 'Auth',
      content: '# Auth\n\nUsers authenticate with a password and receive a session token.',
    });
    await dv.whenEmbeddingsSettled();

    const hits = await dv.searchSemantic('password session token authenticate', { k: 5 });
    expect(hits[0]?.id).toBe(target.frontmatter.id);
  });

  it('respects product/tag filters in semantic search', async () => {
    await dv.createDoc({ product: 'alpha', title: 'A', content: 'rocket science fuel', tags: ['x'] });
    await dv.createDoc({ product: 'beta', title: 'B', content: 'rocket science fuel', tags: ['y'] });
    await dv.whenEmbeddingsSettled();

    const scoped = await dv.searchSemantic('rocket science', { product: 'alpha' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.product).toBe('alpha');

    const tagged = await dv.searchSemantic('rocket science', { tag: 'y' });
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.tags).toContain('y');
  });

  it('hybrid search fuses FTS and vector hits (RRF) and returns both signals', async () => {
    const a = await dv.createDoc({
      product: 'p',
      title: 'Exact keyword doc',
      content: 'photosynthesis is the keyword that appears verbatim here',
    });
    const b = await dv.createDoc({
      product: 'p',
      title: 'Semantic neighbor',
      content: 'plants convert sunlight into chemical energy in their leaves',
    });
    await dv.whenEmbeddingsSettled();

    const hits = await dv.searchHybrid('photosynthesis', { k: 5 });
    const ids = hits.map((h) => h.id);
    // The exact-match doc must surface (FTS leg), ranked at the top.
    expect(ids).toContain(a.frontmatter.id);
    expect(hits[0]?.id).toBe(a.frontmatter.id);
    expect(hits[0]?.inFts).toBe(true);
    expect(hits.every((h) => h.score > 0)).toBe(true);
    // b is reachable via the vector leg even without the literal keyword.
    expect(ids).toContain(b.frontmatter.id);
  });

  it('re-embeds on update and never leaves duplicate/stale chunks', async () => {
    const doc = await dv.createDoc({
      product: 'p',
      title: 'Note',
      content: '# Note\n\nThe original mentions kangaroos hopping across the outback.',
    });
    await dv.whenEmbeddingsSettled();
    const firstCount = dv.index.chunkCountFor(doc.frontmatter.id);
    expect(firstCount).toBeGreaterThan(0);

    await dv.updateDoc(doc.relPath, {
      content: '# Note\n\nReplaced entirely to discuss submarines diving beneath the arctic ice.',
    });
    await dv.whenEmbeddingsSettled();

    // Old content is no longer findable; new content is — and there is exactly
    // one doc's worth of chunks (replace, not append).
    const oldHits = await dv.searchSemantic('kangaroo outback hopping', { k: 5 });
    expect(oldHits.find((h) => h.id === doc.frontmatter.id)?.passage ?? '').not.toContain('kangaroo');

    const newHits = await dv.searchSemantic('submarine arctic diving', { k: 5 });
    expect(newHits[0]?.id).toBe(doc.frontmatter.id);
    expect(newHits[0]?.passage).toContain('submarine');

    // No chunk in the DB still references the removed text.
    const all = dv.index.searchSemantic((await embedder.embed(['kangaroo']))[0]!, { k: 100 });
    expect(all.some((h) => h.passage.includes('kangaroo'))).toBe(false);
  });

  it('drops chunks when a doc is trashed (no orphans)', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Temp', content: 'disposable content here' });
    await dv.whenEmbeddingsSettled();
    expect(dv.index.chunkCount()).toBeGreaterThan(0);

    await dv.trashDoc(doc.relPath);
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBe(0);
    expect(dv.index.chunkCount()).toBe(0);
  });

  it('backfillEmbeddings embeds only docs that lack chunks and reports progress', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Backfill me', content: 'embed this later' });
    await dv.whenEmbeddingsSettled();
    // Simulate a doc that was indexed before embeddings existed.
    dv.index.replaceChunks(doc.frontmatter.id, []);
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBe(0);

    const progress: { done: number; total: number }[] = [];
    const n = await dv.backfillEmbeddings((p) => progress.push({ done: p.done, total: p.total }));
    expect(n).toBe(1);
    expect(progress.at(-1)).toEqual({ done: 1, total: 1 });
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBeGreaterThan(0);
  });

  it('re-embeds a doc edited externally on disk (watcher)', async () => {
    const doc = await dv.createDoc({
      product: 'p',
      title: 'Watched',
      content: '# Watched\n\nbefore edit talking about volcanoes',
    });
    await dv.whenEmbeddingsSettled();
    const before = embedder.calls;

    dv.startWatching();
    const abs = path.join(root, doc.relPath);
    const raw = await readFile(abs, 'utf8');
    await writeFile(abs, raw.replace('before edit talking about volcanoes', 'after edit about glaciers'), 'utf8');

    await waitFor(async () => {
      const hits = await dv.searchSemantic('glaciers', { k: 5 });
      return hits[0]?.id === doc.frontmatter.id && hits[0].passage.includes('glaciers');
    });
    expect(embedder.calls).toBeGreaterThan(before);
    // Eventual-convergence watcher assertion: allow slack for chokidar +
    // parallel-suite CPU load rather than racing a tight deadline.
  }, 20000);

  it('relatedDocs returns nearest-neighbour docs by stored embeddings, excluding the source', async () => {
    const src = await dv.createDoc({
      product: 'p',
      title: 'Auth tokens',
      content: '# Auth\n\nUsers authenticate with a password and receive a session token.',
    });
    const near = await dv.createDoc({
      product: 'p',
      title: 'Sessions',
      content: '# Sessions\n\nA session token authenticates the user on each request.',
    });
    await dv.createDoc({
      product: 'p',
      title: 'Cooking',
      content: '# Cooking\n\nBake bread with flour water yeast and salt in the oven.',
    });
    await dv.whenEmbeddingsSettled();

    const related = dv.relatedDocs(src.frontmatter.id, { k: 5 });
    // Source is excluded; the topically-close doc ranks first.
    expect(related.map((r) => r.id)).not.toContain(src.frontmatter.id);
    expect(related[0]?.id).toBe(near.frontmatter.id);
    expect(related[0]?.passage).toContain('token');
    expect(related[0]?.score).toBeGreaterThan(0);
  });

  it('relatedDocs is empty for a doc with no stored chunks', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Empty', content: 'x' });
    await dv.whenEmbeddingsSettled();
    dv.index.replaceChunks(doc.frontmatter.id, []);
    expect(dv.relatedDocs(doc.frontmatter.id)).toEqual([]);
  });

  it('embeddingStatus reports pending vs total chunks', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'S', content: 'status check content' });
    await dv.whenEmbeddingsSettled();
    expect(dv.embeddingStatus()).toMatchObject({ pending: 0, total: 1 });

    dv.index.replaceChunks(doc.frontmatter.id, []);
    expect(dv.embeddingStatus()).toMatchObject({ pending: 1, total: 1 });
  });

  it('semantic/hybrid still work when embedding is stubbed offline (no model download)', async () => {
    // The whole suite runs with HashingEmbedder — this asserts the contract that
    // an injected embedder fully replaces the on-device model.
    await dv.createDoc({ product: 'p', title: 'X', content: 'offline embedding works fine' });
    await dv.whenEmbeddingsSettled();
    expect((await dv.searchSemantic('offline embedding')).length).toBe(1);
    expect((await dv.searchHybrid('offline embedding')).length).toBe(1);
  });
});

describe('incremental reindex + semanticEnabled gating', () => {
  let root: string;
  let dv: DocVault;
  let embedder: HashingEmbedder;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'docvault-reindex-'));
    embedder = new HashingEmbedder();
    dv = await DocVault.open(root, { embedder });
  });

  afterEach(async () => {
    await dv.close();
    await rm(root, { recursive: true, force: true });
  });

  it('reopening an unchanged vault re-embeds nothing and keeps chunks', async () => {
    await dv.createDoc({ product: 'p', title: 'A', content: 'alpha beta gamma' });
    await dv.createDoc({ product: 'p', title: 'B', content: 'delta epsilon zeta' });
    await dv.whenEmbeddingsSettled();
    const chunksBefore = dv.index.chunkCount();
    expect(chunksBefore).toBeGreaterThan(0);
    await dv.close();

    const embedder2 = new HashingEmbedder();
    dv = await DocVault.open(root, { embedder: embedder2 });
    await dv.whenEmbeddingsSettled();
    // No doc changed → no upserts, no re-embedding, chunks survive verbatim.
    expect(embedder2.calls).toBe(0);
    expect(dv.index.chunkCount()).toBe(chunksBefore);
    expect((await dv.searchSemantic('alpha beta gamma')).length).toBeGreaterThan(0);
  });

  it('reopening re-embeds only the doc that changed on disk', async () => {
    const a = await dv.createDoc({ product: 'p', title: 'A', content: 'alpha paragraph' });
    await dv.createDoc({ product: 'p', title: 'B', content: 'beta paragraph' });
    await dv.whenEmbeddingsSettled();
    await dv.close();

    // Edit A on disk while no vault is open, bumping its frontmatter `updated`
    // timestamp (the change signal the incremental reindex keys on).
    const abs = path.join(root, a.relPath);
    const raw = await readFile(abs, 'utf8');
    await writeFile(
      abs,
      raw
        .replace(/^updated: .*$/m, `updated: '2030-01-01T00:00:00.000Z'`)
        .replace('alpha', 'omega'),
      'utf8',
    );

    const embedder2 = new HashingEmbedder();
    dv = await DocVault.open(root, { embedder: embedder2 });
    await dv.whenEmbeddingsSettled();
    // Exactly A's chunks were re-embedded; B was skipped.
    expect(embedder2.calls).toBe(dv.index.chunkCountFor(a.frontmatter.id));
    expect(embedder2.calls).toBeGreaterThan(0);
    const hits = await dv.searchSemantic('omega paragraph', { k: 5 });
    expect(hits[0]?.id).toBe(a.frontmatter.id);
  });

  it('reopening after a doc file was deleted drops its row and chunks', async () => {
    const a = await dv.createDoc({ product: 'p', title: 'Gone', content: 'soon deleted' });
    const b = await dv.createDoc({ product: 'p', title: 'Stays', content: 'still here' });
    await dv.whenEmbeddingsSettled();
    await dv.close();

    await rm(path.join(root, a.relPath));
    dv = await DocVault.open(root, { embedder: new HashingEmbedder() });
    expect(dv.getMeta(a.frontmatter.id)).toBeNull();
    expect(dv.index.chunkCountFor(a.frontmatter.id)).toBe(0);
    expect(dv.getMeta(b.frontmatter.id)).not.toBeNull();
    expect(dv.index.chunkCountFor(b.frontmatter.id)).toBeGreaterThan(0);
  });

  it('reindexAll({ force: true }) still rebuilds + re-embeds everything', async () => {
    await dv.createDoc({ product: 'p', title: 'F', content: 'force rebuild me' });
    await dv.whenEmbeddingsSettled();
    const before = embedder.calls;

    const n = await dv.reindexAll({ force: true });
    await dv.whenEmbeddingsSettled();
    expect(n).toBe(1);
    expect(embedder.calls).toBeGreaterThan(before);
  });

  it("opening a second instance on the same vault does not wipe the first one's chunks", async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Shared', content: 'shared vault survival' });
    await dv.whenEmbeddingsSettled();
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBeGreaterThan(0);

    const embedderB = new HashingEmbedder();
    const dvB = await DocVault.open(root, { embedder: embedderB });
    try {
      expect(embedderB.calls).toBe(0);
      // The first instance's chunks are still there and still queryable.
      expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBeGreaterThan(0);
      const hits = await dv.searchSemantic('shared vault survival', { k: 5 });
      expect(hits[0]?.id).toBe(doc.frontmatter.id);
    } finally {
      await dvB.close();
    }
  });

  it('semanticEnabled=false gates embedding, backfill, and semantic queries', async () => {
    await dv.updateConfig({ semanticEnabled: false });
    const before = embedder.calls;

    const doc = await dv.createDoc({ product: 'p', title: 'Quiet', content: 'no vectors please' });
    await dv.whenEmbeddingsSettled();
    expect(embedder.calls).toBe(before); // createDoc enqueued nothing
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBe(0);

    expect(await dv.backfillEmbeddings()).toBe(0);
    await expect(dv.searchSemantic('no vectors')).rejects.toThrow(/disabled/i);
    expect(dv.relatedDocs(doc.frontmatter.id)).toEqual([]);

    // Hybrid degrades to FTS-only — still finds the doc, never embeds the query.
    const hits = await dv.searchHybrid('vectors');
    expect(hits[0]?.id).toBe(doc.frontmatter.id);
    expect(hits[0]?.inSemantic).toBe(false);
    expect(embedder.calls).toBe(before);
  });

  it('open() with semanticEnabled=false embeds nothing', async () => {
    await dv.updateConfig({ semanticEnabled: false });
    await dv.createDoc({ product: 'p', title: 'Backlog', content: 'embed me later' });
    await dv.close();

    const embedder2 = new HashingEmbedder();
    dv = await DocVault.open(root, { embedder: embedder2 });
    await dv.whenEmbeddingsSettled();
    expect(embedder2.calls).toBe(0);
    expect(dv.index.chunkCount()).toBe(0);
  });

  it('re-enabling semanticEnabled via updateConfig backfills the unembedded backlog', async () => {
    await dv.updateConfig({ semanticEnabled: false });
    const doc = await dv.createDoc({ product: 'p', title: 'Backlog', content: 'embed this backlog doc' });
    expect(dv.index.chunkCountFor(doc.frontmatter.id)).toBe(0);

    await dv.updateConfig({ semanticEnabled: true });
    await waitFor(() => dv.index.chunkCountFor(doc.frontmatter.id) > 0);
    const hits = await dv.searchSemantic('backlog doc', { k: 5 });
    expect(hits[0]?.id).toBe(doc.frontmatter.id);
  });
});

/** Poll an async condition until true or timeout. */
async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
