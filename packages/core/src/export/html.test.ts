import { describe, expect, it } from 'vitest';
import type { Doc } from '../types.js';
import { renderDocHtml, renderMarkdownToHtml } from './html.js';

describe('renderMarkdownToHtml', () => {
  it('renders standard markdown to HTML', async () => {
    const { html } = await renderMarkdownToHtml('# Title\n\nA **bold** word.\n\n- one\n- two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>one</li>');
  });

  it('escapes raw HTML so exported files are safe to open', async () => {
    const { html } = await renderMarkdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits a source placeholder for mermaid when no renderer is given', async () => {
    const { html, diagrams } = await renderMarkdownToHtml('```mermaid\ngraph TD; A-->B;\n```');
    expect(diagrams).toEqual(['graph TD; A-->B;']);
    expect(html).toContain('<pre class="dv-mermaid-source">');
    expect(html).toContain('graph TD; A--&gt;B;');
  });

  it('uses the injected mermaid renderer and reports diagrams in order', async () => {
    const { html, diagrams } = await renderMarkdownToHtml(
      '```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```',
      { renderMermaid: (code, i) => `<svg data-i="${i}">${code}</svg>` },
    );
    expect(diagrams).toEqual(['A', 'B']);
    expect(html).toContain('<figure class="dv-mermaid"><svg data-i="0">A</svg></figure>');
    expect(html).toContain('<svg data-i="1">B</svg>');
  });

  it('renders callouts with type-specific classes and a label', async () => {
    const { html } = await renderMarkdownToHtml('> [!WARNING]\n> Be careful here.');
    expect(html).toContain('dv-callout dv-callout-warning');
    expect(html).toContain('>Warning</p>');
    expect(html).toContain('Be careful here.');
  });

  it('resolves wikilinks to anchors and falls back to plain text', async () => {
    const { html } = await renderMarkdownToHtml('See [[Architecture]] and [[Missing]].', {
      resolveLink: (t) => (t === 'Architecture' ? '/docs/architecture.html' : null),
    });
    expect(html).toContain('<a href="/docs/architecture.html">Architecture</a>');
    expect(html).toContain('Missing');
    expect(html).not.toContain('href="/docs/missing');
  });

  it('honours wikilink aliases', async () => {
    const { html } = await renderMarkdownToHtml('[[architecture|the design]]', {
      resolveLink: () => '/a.html',
    });
    expect(html).toContain('<a href="/a.html">the design</a>');
  });

  it('resolves image sources through the asset resolver', async () => {
    const { html } = await renderMarkdownToHtml('![pic](assets/cat.png)', {
      resolveAsset: async (src) => `data:image/png;base64,FAKE(${src})`,
    });
    expect(html).toContain('src="data:image/png;base64,FAKE(assets/cat.png)"');
  });
});

describe('renderDocHtml', () => {
  const doc: Doc = {
    frontmatter: {
      id: '01HXYZ',
      title: 'My <Doc>',
      tags: ['spec', 'core'],
      status: 'draft',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-06-01T00:00:00.000Z',
    },
    content: '# Heading\n\nBody text.',
    relPath: 'docs/p/my-doc.md',
    absPath: '/vault/docs/p/my-doc.md',
  };

  it('produces a self-contained document with inlined CSS and header', async () => {
    const { html } = await renderDocHtml(doc);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('.dv-callout');
    // Title is escaped both in <title> and the header <h1>.
    expect(html).toContain('<title>My &lt;Doc&gt;</title>');
    expect(html).toContain('<h1>My &lt;Doc&gt;</h1>');
    expect(html).toContain('#spec');
    expect(html).toContain('Updated Jun 1, 2026');
    expect(html).toContain('<p>Body text.</p>');
  });
});
