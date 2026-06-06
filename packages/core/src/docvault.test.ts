import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocVault } from './docvault.js';

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
});
