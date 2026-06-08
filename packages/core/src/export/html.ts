/**
 * Markdown → standalone HTML renderer.
 *
 * Pure and DOM-free so it lives in core and is unit-testable: it reuses the same
 * canonical segment splitter as the editor (`splitMarkdownSegments`) so callouts
 * and mermaid fences render identically to how they're authored, and delegates
 * the three concerns that genuinely need a host environment to injected
 * callbacks:
 *
 *   - `renderMermaid`  — turn diagram source into inline SVG/img (needs a browser)
 *   - `resolveAsset`   — inline or rewrite an image `src` (needs the filesystem)
 *   - `resolveLink`    — map a [[wikilink]] target to an href (needs the index)
 *
 * Without those callbacks it degrades gracefully (diagrams become labelled code
 * blocks, assets/links pass through), which keeps the core path dependency-free.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { splitMarkdownSegments, type CalloutType } from '../markdown.js';
import type { Doc } from '../types.js';

export interface RenderHtmlOptions {
  /**
   * Render a mermaid diagram's source to an inline HTML string (an `<svg>` or
   * `<img>`). DOM-bound, so the caller injects it (the desktop offscreen
   * renderer). Omitted → the diagram is emitted as a `<pre class="mermaid">`
   * placeholder so the source is at least preserved.
   */
  renderMermaid?: (code: string, index: number) => Promise<string> | string;
  /**
   * Resolve an image `src` from the markdown to the href to emit — e.g. inline
   * as a `data:` URI or copy + rewrite. Omitted → the src is emitted unchanged.
   */
  resolveAsset?: (src: string) => Promise<string> | string;
  /**
   * Resolve a `[[wikilink]]` target (doc title or id) to an href. Return null to
   * render it as plain text. Omitted → wikilinks render as their label text.
   */
  resolveLink?: (target: string) => string | null;
}

export interface RenderedHtml {
  /** The rendered document body as an HTML fragment. */
  html: string;
  /** Mermaid diagram sources encountered, in document order. */
  diagrams: string[];
}

/** Escape a string for safe interpolation into HTML text / attribute context. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// `html: false` escapes any raw HTML in the markdown, so the exported file is
// safe to open in a browser even when the vault content came from an import or
// an agent. linkify turns bare URLs into anchors.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;

/**
 * Replace `[[target]]` / `[[target|alias]]` with a markdown link (when the
 * target resolves) or its plain label, so markdown-it renders the rest normally.
 */
function substituteWikilinks(text: string, resolveLink?: RenderHtmlOptions['resolveLink']): string {
  return text.replace(WIKILINK, (_m, inner: string) => {
    const [rawTarget, rawAlias] = inner.split('|');
    const target = (rawTarget ?? '').trim();
    const label = (rawAlias ?? rawTarget ?? '').trim();
    const href = resolveLink?.(target) ?? null;
    if (!href) return label;
    // Escape markdown-significant chars in the label so it stays literal text.
    const safeLabel = label.replace(/([[\]()\\])/g, '\\$1');
    return `[${safeLabel}](${href})`;
  });
}

/** Walk a token tree (inline tokens nest children) yielding every token. */
function* walkTokens(tokens: Token[]): Generator<Token> {
  for (const t of tokens) {
    yield t;
    if (t.children) yield* walkTokens(t.children);
  }
}

/**
 * Render one markdown run to HTML, resolving image `src`s through `resolveAsset`
 * first. markdown-it renders synchronously, so we parse to tokens, await the
 * (possibly async) asset resolution for every image, rewrite the tokens, then
 * render.
 */
async function renderMarkdownRun(text: string, opts: RenderHtmlOptions): Promise<string> {
  const src = substituteWikilinks(text, opts.resolveLink);
  const tokens = md.parse(src, {});
  if (opts.resolveAsset) {
    for (const token of walkTokens(tokens)) {
      if (token.type !== 'image') continue;
      const current = token.attrGet('src');
      if (current) token.attrSet('src', String(await opts.resolveAsset(current)));
    }
  }
  return md.renderer.render(tokens, md.options, {});
}

const CALLOUT_LABELS: Record<CalloutType, string> = {
  info: 'Info',
  principle: 'Principle',
  warning: 'Warning',
};

/**
 * Render markdown (with DocVault's custom callout / mermaid blocks) to an HTML
 * body fragment. Returns the HTML plus the list of mermaid sources in order.
 */
export async function renderMarkdownToHtml(
  markdown: string,
  opts: RenderHtmlOptions = {},
): Promise<RenderedHtml> {
  const parts: string[] = [];
  const diagrams: string[] = [];

  for (const seg of splitMarkdownSegments(markdown)) {
    if (seg.kind === 'markdown') {
      parts.push(await renderMarkdownRun(seg.text, opts));
    } else if (seg.kind === 'mermaid') {
      const index = diagrams.length;
      diagrams.push(seg.code);
      if (opts.renderMermaid) {
        const rendered = await opts.renderMermaid(seg.code, index);
        parts.push(`<figure class="dv-mermaid">${rendered}</figure>`);
      } else {
        parts.push(`<pre class="dv-mermaid-source">${escapeHtml(seg.code)}</pre>`);
      }
    } else {
      const body = seg.body ? await renderMarkdownRun(seg.body, opts) : '';
      parts.push(
        `<div class="dv-callout dv-callout-${seg.calloutType}">` +
          `<p class="dv-callout-label">${CALLOUT_LABELS[seg.calloutType]}</p>` +
          `<div class="dv-callout-body">${body}</div>` +
          `</div>`,
      );
    }
  }

  return { html: parts.join('\n'), diagrams };
}

/** Print-friendly stylesheet embedded into the standalone document. */
const DOC_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.65; color: #1f2430; background: #fff;
  max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 5rem;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1, h2, h3, h4 { line-height: 1.25; font-weight: 700; margin: 1.8em 0 0.6em; }
h1 { font-size: 2rem; margin-top: 0; }
h2 { font-size: 1.5rem; } h3 { font-size: 1.2rem; }
p, ul, ol, blockquote, table, pre, figure { margin: 0 0 1rem; }
a { color: #4f46e5; text-decoration: none; } a:hover { text-decoration: underline; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875em;
  background: #f3f4f6; padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 0.9rem 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; color: #4b5563; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #e5e7eb; padding: 0.4rem 0.6rem; text-align: left; }
th { background: #f9fafb; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
.dv-doc-header { border-bottom: 1px solid #e5e7eb; margin-bottom: 2rem; padding-bottom: 1rem; }
.dv-doc-meta { color: #6b7280; font-size: 0.8rem; margin-top: 0.5rem; }
.dv-tag { display: inline-block; background: #f3f4f6; color: #6b7280;
  border-radius: 999px; padding: 0.1rem 0.55rem; font-size: 0.75rem; margin-right: 0.35rem; }
figure.dv-mermaid { text-align: center; } figure.dv-mermaid svg { max-width: 100%; height: auto; }
.dv-callout { border: 1px solid; border-radius: 8px; padding: 0.75rem 1rem; margin: 0 0 1rem; }
.dv-callout-label { font-weight: 600; font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: 0.05em; margin: 0 0 0.35rem; }
.dv-callout-body > :last-child { margin-bottom: 0; }
.dv-callout-info { background: #eff6ff; border-color: #bfdbfe; }
.dv-callout-info .dv-callout-label { color: #1d4ed8; }
.dv-callout-principle { background: #f5f3ff; border-color: #ddd6fe; }
.dv-callout-principle .dv-callout-label { color: #6d28d9; }
.dv-callout-warning { background: #fffbeb; border-color: #fde68a; }
.dv-callout-warning .dv-callout-label { color: #b45309; }
@media print { body { padding: 0; max-width: none; } pre, figure, table, .dv-callout { break-inside: avoid; } }
`.trim();

/** Format an ISO date as a short human date, falling back to the raw value. */
function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * Render a whole Doc to a complete, self-contained HTML document: a title +
 * metadata header followed by the rendered body, with the stylesheet inlined.
 */
export async function renderDocHtml(doc: Doc, opts: RenderHtmlOptions = {}): Promise<RenderedHtml> {
  const { frontmatter: fm } = doc;
  const { html: body, diagrams } = await renderMarkdownToHtml(doc.content, opts);

  const tags = fm.tags.map((t) => `<span class="dv-tag">#${escapeHtml(t)}</span>`).join(' ');
  const updated = fmtDate(fm.updated);
  const meta = [tags, updated ? `Updated ${escapeHtml(updated)}` : '']
    .filter(Boolean)
    .join(' &middot; ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fm.title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
<header class="dv-doc-header">
<h1>${escapeHtml(fm.title)}</h1>
${meta ? `<div class="dv-doc-meta">${meta}</div>` : ''}
</header>
${body}
</body>
</html>`;

  return { html, diagrams };
}
