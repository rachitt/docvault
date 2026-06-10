import { describe, expect, it } from 'vitest';
import { restoreWikilinks, splitMarkdownSegments, type Segment } from './markdown.js';

describe('splitMarkdownSegments (fence-aware)', () => {
  it('keeps a ```mermaid example inside a ````md fence as one markdown segment', () => {
    // The outer fence uses 4 backticks so the inner ``` lines are literal
    // content (a closing fence must be at least the opening length).
    const md = [
      '````md',
      'Example of a diagram:',
      '```mermaid',
      'graph TD;',
      'A-->B;',
      '```',
      'Done.',
      '````',
    ].join('\n');
    const segments = splitMarkdownSegments(md);
    expect(segments).toEqual<Segment[]>([{ kind: 'markdown', text: md }]);
  });

  it('does not extract a callout marker inside a plain ``` fence', () => {
    const md = ['```', '> [!info]', '> not a callout', '```'].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([{ kind: 'markdown', text: md }]);
  });

  it('does not extract a ```mermaid fence nested in a ~~~ fence', () => {
    const md = ['~~~', '```mermaid', 'graph TD;', '```', '~~~'].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([{ kind: 'markdown', text: md }]);
  });

  it('a longer same-char run does not close a shorter fence prematurely', () => {
    // ```` inside a ``` fence *does* close it (length >= opening), but a line
    // with an info string never closes — verify both directions.
    const md = ['```js', '``` not a close (info string)', '> [!warning]', '```'].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([{ kind: 'markdown', text: md }]);
  });

  it('still extracts mermaid and callouts at the top level after a closed fence', () => {
    const md = [
      '```',
      'code',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      '> [!INFO]',
      '> note',
    ].join('\n');
    expect(splitMarkdownSegments(md)).toEqual<Segment[]>([
      { kind: 'markdown', text: '```\ncode\n```' },
      { kind: 'mermaid', code: 'graph TD; A-->B;' },
      { kind: 'callout', calloutType: 'info', body: 'note' },
    ]);
  });
});

describe('restoreWikilinks (code-aware)', () => {
  it('restores escaped wikilinks in prose', () => {
    expect(restoreWikilinks('see \\[\\[Architecture\\]\\] now')).toBe('see [[Architecture]] now');
    expect(restoreWikilinks('\\[\\[Doc\\|alias\\]\\]')).toBe('[[Doc|alias]]');
  });

  it('leaves escaped wikilinks inside fenced code untouched', () => {
    const md = ['```', 'literal \\[\\[Doc\\]\\] sample', '```'].join('\n');
    expect(restoreWikilinks(md)).toBe(md);
  });

  it('leaves escaped wikilinks inside inline code untouched, restoring around them', () => {
    expect(restoreWikilinks('use `\\[\\[Doc\\]\\]` to link \\[\\[Doc\\]\\]')).toBe(
      'use `\\[\\[Doc\\]\\]` to link [[Doc]]',
    );
  });
});
