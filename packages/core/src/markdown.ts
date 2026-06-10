/**
 * Canonical markdown ⇄ custom-block conventions, shared by every surface that
 * reads or writes vault markdown (the desktop BlockNote bridge, the HTML/PDF/DOCX
 * exporter, and any agent tooling). DocVault keeps markdown on disk as the source
 * of truth and represents its two custom blocks with plain-text syntax so they
 * stay agent-readable and survive round-trips:
 *
 *   - Mermaid  →  ```mermaid … ``` fenced code block
 *   - Callout  →  GitHub-style alert blockquote: `> [!INFO]` + `> body`
 *
 * Everything in between is plain markdown. Keeping these helpers in core means
 * the editor and the exporter segment markdown identically — there is one
 * definition of what a callout / mermaid block looks like on disk.
 */

export const CALLOUT_TYPES = ['info', 'principle', 'warning'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'mermaid'; code: string }
  | { kind: 'callout'; calloutType: CalloutType; body: string };

const MERMAID_FENCE = /^```\s*mermaid\s*$/i;
const FENCE_CLOSE = /^```\s*$/;
const CALLOUT_START = /^>\s?\[!(info|principle|warning)\]\s*(.*)$/i;
const QUOTE_LINE = /^>\s?(.*)$/;
const FENCE_DELIM = /^(`{3,}|~{3,})(.*)$/;

function asCalloutType(raw: string): CalloutType {
  const t = raw.toLowerCase();
  return (CALLOUT_TYPES as readonly string[]).includes(t) ? (t as CalloutType) : 'info';
}

/** Open-fence bookkeeping: the delimiter character and run length, or null when outside. */
export type FenceState = { char: string; length: number } | null;

/**
 * Advance CommonMark fence state by one line. Outside a fence, a line of 3+
 * backticks or tildes (with an optional info string) opens one; inside, the
 * only line that closes it uses the same character, is at least the opening
 * length, and has nothing but whitespace after — closing fences cannot carry
 * an info string, so every other line (including fence-looking ones) is
 * literal content. Returns the state *after* the line; the input state is
 * returned unchanged (same reference) for ordinary content lines, so callers
 * can detect delimiter lines by reference inequality.
 */
export function nextFenceState(state: FenceState, line: string): FenceState {
  const m = FENCE_DELIM.exec(line);
  if (!m) return state;
  const delim = m[1] ?? '';
  if (state === null) return { char: delim[0] ?? '`', length: delim.length };
  const rest = m[2] ?? '';
  const closes = delim[0] === state.char && delim.length >= state.length && rest.trim() === '';
  return closes ? null : state;
}

/**
 * Apply `transform` to the parts of `text` outside code: lines inside fenced
 * code blocks (and the fence delimiter lines themselves) pass through
 * untouched, and on every other line backtick-delimited `inline code` spans
 * are preserved while the surrounding prose is transformed. Shared by every
 * pass that rewrites wikilink syntax so code samples are never corrupted.
 */
export function transformOutsideCode(text: string, transform: (chunk: string) => string): string {
  let fence: FenceState = null;
  return text
    .split('\n')
    .map((line) => {
      const wasInFence = fence !== null;
      const next = nextFenceState(fence, line);
      const isDelimiter = next !== fence;
      fence = next;
      if (wasInFence || isDelimiter) return line;
      return transformOutsideCodeSpans(line, transform);
    })
    .join('\n');
}

const INLINE_CODE_SPAN = /(`+)[^`]*\1/g;

/** Transform the non-code parts of a single line, leaving `code spans` intact. */
function transformOutsideCodeSpans(line: string, transform: (chunk: string) => string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_CODE_SPAN)) {
    parts.push(transform(line.slice(last, m.index)), m[0]);
    last = m.index + m[0].length;
  }
  parts.push(transform(line.slice(last)));
  return parts.join('');
}

/**
 * Split markdown into ordered segments, pulling mermaid fences and callout
 * blockquotes out as structured segments and leaving the rest as markdown runs.
 */
export function splitMarkdownSegments(markdown: string): Segment[] {
  const lines = markdown.split('\n');
  const segments: Segment[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    // Trim leading/trailing blank lines from the run but keep internal ones.
    const text = buffer.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (text.length > 0) segments.push({ kind: 'markdown', text });
    buffer = [];
  };

  /** Open non-mermaid fence the scanner is currently inside, if any. */
  let fence: FenceState = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Inside an enclosing code fence everything — including ```mermaid lines
    // and callout markers — is literal content; just track the closing fence.
    if (fence !== null) {
      buffer.push(line);
      fence = nextFenceState(fence, line);
      continue;
    }

    if (MERMAID_FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i++;
      }
      // `i` now points at the closing fence (or EOF); the loop's i++ skips it.
      flush();
      segments.push({ kind: 'mermaid', code: code.join('\n') });
      continue;
    }

    const calloutMatch = CALLOUT_START.exec(line);
    if (calloutMatch) {
      const calloutType = asCalloutType(calloutMatch[1] ?? 'info');
      const body: string[] = [];
      const firstInline = (calloutMatch[2] ?? '').trim();
      if (firstInline) body.push(firstInline);
      i++;
      while (i < lines.length && QUOTE_LINE.test(lines[i] ?? '')) {
        body.push((QUOTE_LINE.exec(lines[i] ?? '')?.[1] ?? '').trimEnd());
        i++;
      }
      i--; // step back: the while consumed one past the blockquote
      flush();
      segments.push({ kind: 'callout', calloutType, body: body.join('\n').trim() });
      continue;
    }

    // A non-mermaid fence opens: buffer it (and, via the branch above, its
    // content + closing line) as plain markdown.
    fence = nextFenceState(null, line);
    buffer.push(line);
  }

  flush();
  return segments;
}

/** Serialize a mermaid diagram back to a fenced code block. */
export function serializeMermaid(code: string): string {
  return '```mermaid\n' + code.replace(/\n+$/, '') + '\n```';
}

/**
 * BlockNote's markdown exporter escapes `[` / `]` (and `|`) to avoid producing
 * accidental link syntax, which would turn `[[Doc]]` into `\[\[Doc\]\]` and
 * break wikilink parsing in core. Restore the brackets (and unescape the inner
 * alias pipe) so [[wikilinks]] survive the round-trip to disk. Fenced code
 * blocks and inline code spans are left untouched: escaped brackets there are
 * literal source, not wikilinks.
 */
export function restoreWikilinks(md: string): string {
  return transformOutsideCode(md, (chunk) =>
    chunk.replace(/\\?\[\\?\[([^\]\n]*?)\\?\]\\?\]/g, (_m, inner: string) => {
      return `[[${inner.replace(/\\([|[\]])/g, '$1')}]]`;
    }),
  );
}

/** Serialize a callout back to a `> [!TYPE]` alert blockquote. */
export function serializeCallout(type: CalloutType, body: string): string {
  const marker = `> [!${type.toUpperCase()}]`;
  const lines = body.length === 0 ? [] : body.split('\n').map((l) => (l ? `> ${l}` : '>'));
  return [marker, ...lines].join('\n');
}
