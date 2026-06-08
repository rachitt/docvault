import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunk.js';

describe('chunkMarkdown', () => {
  it('returns no chunks for empty or whitespace input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  \t')).toEqual([]);
  });

  it('carries the heading-path breadcrumb on each chunk', () => {
    const md = [
      '# Guide',
      '',
      'Intro paragraph at the root of the guide.',
      '',
      '## Setup',
      '',
      'How to set things up.',
      '',
      '### Database',
      '',
      'Configure the database connection.',
    ].join('\n');

    const chunks = chunkMarkdown(md);
    const byCrumb = Object.fromEntries(chunks.map((c) => [c.breadcrumb, c]));

    expect(byCrumb['Guide']?.text).toContain('Intro paragraph');
    expect(byCrumb['Guide > Setup']?.text).toContain('set things up');
    expect(byCrumb['Guide > Setup > Database']?.text).toContain('database connection');
  });

  it('pops sibling/deeper headings so breadcrumbs do not accumulate', () => {
    const md = [
      '# A',
      'a body',
      '## B',
      'b body',
      '## C',
      'c body',
    ].join('\n');
    const crumbs = chunkMarkdown(md).map((c) => c.breadcrumb);
    // "## C" must replace "## B", not nest under it.
    expect(crumbs).toContain('A > B');
    expect(crumbs).toContain('A > C');
    expect(crumbs).not.toContain('A > B > C');
  });

  it('prefixes the chunk text with its breadcrumb for embedding context', () => {
    const [chunk] = chunkMarkdown('## Setup > Notes\n\nbody text');
    // The breadcrumb is included in the embeddable text.
    expect(chunk?.text.startsWith(chunk!.breadcrumb)).toBe(true);
  });

  it('assigns stable increasing chunk indexes', () => {
    const md = '# H\n\npara one\n\npara two\n\npara three';
    const chunks = chunkMarkdown(md, { targetChars: 1 }); // force one chunk per paragraph
    expect(chunks.map((c) => c.index)).toEqual([...chunks.keys()]);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits an oversized paragraph below the hard cap', () => {
    const sentence = 'This is a sentence that has some length to it. ';
    const big = sentence.repeat(60); // ~2800 chars
    const chunks = chunkMarkdown(`# Big\n\n${big}`, { targetChars: 400, maxChars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // text includes the breadcrumb prefix; the body must respect the cap.
      const body = c.text.replace(/^Big\n\n/, '');
      expect(body.length).toBeLessThanOrEqual(600);
    }
  });

  it('keeps fenced code blocks intact (never splits mid-fence)', () => {
    const md = [
      '# Code',
      '',
      'Before.',
      '',
      '```js',
      'const x = 1;',
      '',
      'const y = 2;',
      '```',
      '',
      'After.',
    ].join('\n');
    const chunks = chunkMarkdown(md, { targetChars: 10 });
    const fenceChunk = chunks.find((c) => c.text.includes('const x'));
    expect(fenceChunk?.text).toContain('const y = 2;');
    expect(fenceChunk?.text).toContain('```');
  });
});
