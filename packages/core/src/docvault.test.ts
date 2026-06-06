import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocVault } from './docvault.js';
import { toFtsMatch } from './indexer.js';

describe('DocVault core', () => {
  let root: string;
  let dv: DocVault;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'docvault-test-'));
    dv = await DocVault.open(root);
  });

  afterEach(async () => {
    await dv.close();
    await rm(root, { recursive: true, force: true });
  });

  it('creates a doc, reads it back, and finds it via search', async () => {
    const created = await dv.createDoc({
      product: 'superchat',
      title: 'Architecture',
      content: '# Architecture\n\nDesign for scale and observability.',
      tags: ['superchat', 'architecture'],
    });
    expect(created.relPath).toBe('docs/superchat/architecture.md');

    const read = await dv.readDoc(created.frontmatter.id);
    expect(read.frontmatter.title).toBe('Architecture');
    expect(read.content).toContain('observability');

    const hits = dv.search({ query: 'observability' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe(created.frontmatter.id);
    expect(hits[0]?.snippet).toContain('«observability»');
  });

  it('filters search by product and tag', async () => {
    await dv.createDoc({ product: 'superchat', title: 'Alpha', content: 'rocket science', tags: ['x'] });
    await dv.createDoc({ product: 'other', title: 'Beta', content: 'rocket fuel', tags: ['y'] });

    expect(dv.search({ query: 'rocket', product: 'superchat' })).toHaveLength(1);
    expect(dv.search({ query: 'rocket', tag: 'y' })).toHaveLength(1);
    expect(dv.search({ query: 'rocket' })).toHaveLength(2);
  });

  it('resolves backlinks from [[wikilinks]]', async () => {
    const target = await dv.createDoc({ product: 'p', title: 'Target', content: 'I am the target' });
    await dv.createDoc({
      product: 'p',
      title: 'Source',
      content: 'See [[Target]] for details.',
    });
    const back = dv.backlinks(target.frontmatter.id);
    expect(back.map((d) => d.title)).toContain('Source');
  });

  it('imports a .txt file into a searchable sidecar', async () => {
    const srcPath = path.join(root, 'notes.txt');
    await writeFile(srcPath, 'quarterly roadmap planning notes', 'utf8');
    const doc = await dv.importFile(srcPath);
    expect(doc.frontmatter.source).toBe('assets/notes.txt');

    const hits = dv.search({ query: 'roadmap' });
    expect(hits.some((h) => h.id === doc.frontmatter.id)).toBe(true);
  });

  it('lists products derived from docs/ folders', async () => {
    await dv.createProduct('superchat', { title: 'SuperChat', icon: 'message-circle', color: '#7c3aed' });
    await dv.createDoc({ product: 'superchat', title: 'Overview', content: 'hello' });
    const products = await dv.listProducts();
    const sc = products.find((p) => p.slug === 'superchat');
    expect(sc?.title).toBe('SuperChat');
    expect(sc?.docCount).toBe(1);
  });

  it('updates a doc body and reflects it in search', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Note', content: 'initial body' });
    await dv.updateDoc(doc.relPath, { content: 'replaced with photosynthesis' });
    expect(dv.search({ query: 'initial' })).toHaveLength(0);
    expect(dv.search({ query: 'photosynthesis' })).toHaveLength(1);
  });

  it('soft-deletes a doc: removed from index, moved under trash/', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Temp', content: 'disposable' });
    await dv.trashDoc(doc.relPath);
    expect(dv.getMeta(doc.frontmatter.id)).toBeNull();
    expect(dv.search({ query: 'disposable' })).toHaveLength(0);
    const trash = await dv.listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ kind: 'doc', relPath: doc.relPath, title: 'Temp' });
  });

  it('restores a trashed doc back into the index', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Recoverable', content: 'comeback' });
    await dv.trashDoc(doc.relPath);
    const [entry] = await dv.listTrash();
    await dv.restoreTrash(entry.trashPath);
    expect(dv.getMeta(doc.frontmatter.id)).not.toBeNull();
    expect(dv.search({ query: 'comeback' })).toHaveLength(1);
    expect(await dv.listTrash()).toHaveLength(0);
  });

  it('deletes a product: trashes its docs and restores them on undo', async () => {
    await dv.createDoc({ product: 'doomed', title: 'One', content: 'alpha' });
    await dv.createDoc({ product: 'doomed', title: 'Two', content: 'beta' });
    await dv.deleteProduct('doomed');
    expect(dv.listDocs({ product: 'doomed' })).toHaveLength(0);
    expect((await dv.listProducts()).some((p) => p.slug === 'doomed')).toBe(false);
    const [entry] = await dv.listTrash();
    expect(entry).toMatchObject({ kind: 'product', relPath: 'docs/doomed' });
    await dv.restoreTrash(entry.trashPath);
    expect(dv.listDocs({ product: 'doomed' })).toHaveLength(2);
    expect((await dv.listProducts()).some((p) => p.slug === 'doomed')).toBe(true);
  });

  it('auto-purges trash items older than the retention window', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Old', content: 'expired' });
    await dv.trashDoc(doc.relPath);
    expect(await dv.listTrash()).toHaveLength(1);
    // Purge anything older than 0ms — everything currently trashed qualifies.
    await dv.purgeExpiredTrash(-1);
    expect(await dv.listTrash()).toHaveLength(0);
  });

  describe('path containment', () => {
    it('rejects reading outside the vault via ..', async () => {
      await writeFile(path.join(root, 'secret.txt'), 'top secret', 'utf8');
      await expect(dv.readDoc('../secret.txt')).rejects.toThrow(/escapes vault/);
    });

    it('rejects creating a doc with a traversing product or stem', async () => {
      await expect(
        dv.createDoc({ product: '../../evil', title: 'x' }),
      ).rejects.toThrow(/Invalid product/);
      await expect(
        dv.createDoc({ product: 'p', title: 'x', stem: '../escape' }),
      ).rejects.toThrow(/Invalid stem/);
    });

    it('rejects creating a product with a traversing slug', async () => {
      await expect(dv.createProduct('../evil', { title: 'x' })).rejects.toThrow(/Invalid/);
    });

    it('rejects reading a symlink inside the vault that points outside it', async () => {
      const outside = await mkdtemp(path.join(tmpdir(), 'docvault-outside-'));
      try {
        const secret = path.join(outside, 'secret.txt');
        await writeFile(secret, 'top secret', 'utf8');
        // A symlink planted inside the vault that resolves to an external file.
        await symlink(secret, path.join(root, 'docs', 'leak.md'));
        await expect(dv.readDoc('docs/leak.md')).rejects.toThrow(/escapes vault/);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it('refuses to import a symlinked source file', async () => {
      const outside = await mkdtemp(path.join(tmpdir(), 'docvault-outside-'));
      try {
        const real = path.join(outside, 'real.txt');
        await writeFile(real, 'external content', 'utf8');
        const link = path.join(root, 'pointer.txt');
        await symlink(real, link);
        await expect(dv.importFile(link)).rejects.toThrow(/symlink/i);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('refuses to restore over a file that reclaimed the original path', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Recoverable', content: 'first' });
    await dv.trashDoc(doc.relPath);
    const [entry] = await dv.listTrash();
    // A new doc now occupies the original slug; restore must not clobber it.
    await dv.createDoc({ product: 'p', title: 'Recoverable', content: 'second' });
    await expect(dv.restoreTrash(entry.trashPath)).rejects.toThrow(/already exists/);
  });

  describe('FTS query safety', () => {
    it('toFtsMatch quotes terms and drops operator-only input', () => {
      expect(toFtsMatch('hello world')).toBe('"hello" "world"');
      expect(toFtsMatch('  *(":-)  ')).toBeNull();
      expect(toFtsMatch('')).toBeNull();
    });

    it('does not throw on FTS operator characters in a real search', async () => {
      await dv.createDoc({ product: 'p', title: 'Ops', content: 'alpha beta gamma' });
      for (const q of ['"', 'alpha AND', 'beta*', '(', 'NEAR', '-gamma', '']) {
        expect(() => dv.search({ query: q })).not.toThrow();
      }
      expect(dv.search({ query: 'alpha' })).toHaveLength(1);
    });
  });

  it('applies product filter before the search limit', async () => {
    for (let i = 0; i < 30; i++) {
      await dv.createDoc({ product: 'noise', title: `noise ${i}`, content: 'rocket' });
    }
    await dv.createDoc({ product: 'target', title: 'needle', content: 'rocket' });
    // With a default limit of 25, the single target doc would be lost if the
    // filter were applied after LIMIT. It must still be found.
    const hits = dv.search({ query: 'rocket', product: 'target' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.product).toBe('target');
  });

  it('reindexes a doc edited externally on disk (watcher)', async () => {
    const doc = await dv.createDoc({ product: 'p', title: 'Watched', content: 'before edit' });
    const changes: string[] = [];
    dv.startWatching((c) => changes.push(c.type));
    const abs = path.join(root, doc.relPath);
    const raw = await readFile(abs, 'utf8');
    await writeFile(abs, raw.replace('before edit', 'after kangaroo edit'), 'utf8');

    await waitFor(() => dv.search({ query: 'kangaroo' }).length === 1);
    expect(dv.search({ query: 'kangaroo' })).toHaveLength(1);
    expect(dv.search({ query: 'before' })).toHaveLength(0);
  });

  it('re-extracts an imported original when its bytes change on disk (watcher)', async () => {
    const src = path.join(root, 'note.txt');
    await writeFile(src, 'original alpha content', 'utf8');
    const imported = await dv.importFile(src);
    expect(dv.search({ query: 'alpha' })).toHaveLength(1);

    const originalAbs = path.join(root, imported.frontmatter.source!);
    dv.startWatching();
    await writeFile(originalAbs, 'updated zebra content', 'utf8');

    await waitFor(() => dv.search({ query: 'zebra' }).length === 1);
    expect(dv.search({ query: 'alpha' })).toHaveLength(0);
    // The sidecar keeps its identity; only its content is refreshed.
    const reread = await dv.readDoc(imported.frontmatter.id);
    expect(reread.content).toContain('zebra');
  });
});

/** Poll until `cond` is true or the timeout elapses. */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
