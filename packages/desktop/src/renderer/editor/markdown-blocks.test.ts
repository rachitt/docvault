import { describe, expect, it } from 'vitest';
import {
  restoreWikilinks,
  serializeCallout,
  serializeMermaid,
  splitMarkdownSegments,
  type Segment,
} from './markdown-blocks';

describe('splitMarkdownSegments', () => {
  it('returns a single markdown segment for plain markdown', () => {
    expect(splitMarkdownSegments('# Hello\n\nSome text.')).toEqual([
      { kind: 'markdown', text: '# Hello\n\nSome text.' },
    ]);
  });

  it('extracts a mermaid fence between markdown runs', () => {
    const md = ['Before.', '', '```mermaid', 'graph TD;', 'A-->B;', '```', '', 'After.'].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([
      { kind: 'markdown', text: 'Before.' },
      { kind: 'mermaid', code: 'graph TD;\nA-->B;' },
      { kind: 'markdown', text: 'After.' },
    ]);
  });

  it('extracts a callout blockquote with its type and body', () => {
    const md = ['> [!WARNING]', '> Be careful here.', '> Second line.'].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([
      { kind: 'callout', calloutType: 'warning', body: 'Be careful here.\nSecond line.' },
    ]);
  });

  it('supports an inline first line after the marker', () => {
    expect(splitMarkdownSegments('> [!INFO] inline body')).toEqual<Segment[]>([
      { kind: 'callout', calloutType: 'info', body: 'inline body' },
    ]);
  });

  it('leaves a plain blockquote (no marker) as markdown', () => {
    const md = '> just a quote';
    expect(splitMarkdownSegments(md)).toEqual([{ kind: 'markdown', text: '> just a quote' }]);
  });

  it('round-trips mermaid through serialize', () => {
    const seg = splitMarkdownSegments(serializeMermaid('graph TD;\nA-->B;'))[0];
    expect(seg).toEqual({ kind: 'mermaid', code: 'graph TD;\nA-->B;' });
  });

  it('round-trips a callout through serialize', () => {
    const out = serializeCallout('principle', 'Keep it simple.\nFavor clarity.');
    expect(out).toBe('> [!PRINCIPLE]\n> Keep it simple.\n> Favor clarity.');
    expect(splitMarkdownSegments(out)[0]).toEqual({
      kind: 'callout',
      calloutType: 'principle',
      body: 'Keep it simple.\nFavor clarity.',
    });
  });

  it('handles an empty-body callout', () => {
    expect(serializeCallout('info', '')).toBe('> [!INFO]');
    expect(splitMarkdownSegments('> [!INFO]')).toEqual<Segment[]>([
      { kind: 'callout', calloutType: 'info', body: '' },
    ]);
  });

  it('restores escaped wikilink brackets and alias pipes', () => {
    expect(restoreWikilinks('see \\[\\[Architecture\\]\\] now')).toBe('see [[Architecture]] now');
    expect(restoreWikilinks('\\[\\[Doc\\|alias\\]\\]')).toBe('[[Doc|alias]]');
    // Unescaped (or partially escaped) forms are normalized too.
    expect(restoreWikilinks('[[Plain]]')).toBe('[[Plain]]');
    // A lone escaped bracket that is not a wikilink is left untouched.
    expect(restoreWikilinks('an array \\[0\\]')).toBe('an array \\[0\\]');
  });

  it('keeps multiple blocks in document order', () => {
    const md = ['# Title', '', '```mermaid', 'graph TD; A-->B;', '```', '', '> [!INFO]', '> note', '', 'Tail.'].join('\n');
    const kinds = splitMarkdownSegments(md).map((s) => s.kind);
    expect(kinds).toEqual(['markdown', 'mermaid', 'callout', 'markdown']);
  });
});
