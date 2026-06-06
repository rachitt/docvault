/**
 * Markdown ⇄ custom-block bridge.
 *
 * DocVault keeps markdown on disk as the source of truth, but BlockNote's
 * `blocksToMarkdownLossy` routes everything through HTML→remark and cannot
 * represent our custom Callout / Mermaid blocks without dropping them. To keep
 * the round-trip lossless for those blocks we segment the raw markdown around
 * them ourselves and re-serialize them with canonical, agent-readable syntax:
 *
 *   - Mermaid  →  ```mermaid … ``` fenced code block
 *   - Callout  →  GitHub-style alert blockquote: `> [!INFO]` + `> body`
 *
 * Everything in between is plain markdown handed to / from BlockNote untouched.
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

function asCalloutType(raw: string): CalloutType {
  const t = raw.toLowerCase();
  return (CALLOUT_TYPES as readonly string[]).includes(t) ? (t as CalloutType) : 'info';
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

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
 * alias pipe) so [[wikilinks]] survive the round-trip to disk.
 */
export function restoreWikilinks(md: string): string {
  return md.replace(/\\?\[\\?\[([^\]\n]*?)\\?\]\\?\]/g, (_m, inner: string) => {
    return `[[${inner.replace(/\\([|[\]])/g, '$1')}]]`;
  });
}

/** Serialize a callout back to a `> [!TYPE]` alert blockquote. */
export function serializeCallout(type: CalloutType, body: string): string {
  const marker = `> [!${type.toUpperCase()}]`;
  const lines = body.length === 0 ? [] : body.split('\n').map((l) => (l ? `> ${l}` : '>'));
  return [marker, ...lines].join('\n');
}
