/**
 * Markdown chunking for semantic search.
 *
 * Splits a doc's markdown body into semantically-sized chunks, each carrying the
 * heading-path breadcrumb it lives under (e.g. "Setup > Database"). Chunks are
 * the unit we embed: small enough to give a focused vector, large enough to
 * carry real meaning. Pure + deterministic so it's cheap to unit-test.
 */

/** A single chunk of a document, ready to embed. */
export interface Chunk {
  /** Zero-based position of this chunk within the doc (stable ordering). */
  index: number;
  /** Heading path this chunk sits under, e.g. "Setup > Database". Empty at root. */
  breadcrumb: string;
  /** The chunk's text. Includes the breadcrumb prefix when one exists. */
  text: string;
}

export interface ChunkOptions {
  /**
   * Soft target size (in characters) for a chunk's body. A paragraph is flushed
   * once accumulated text crosses this. Default ~900 chars (~200-300 tokens),
   * comfortably under MiniLM's 256-token window once the breadcrumb is added.
   */
  targetChars?: number;
  /**
   * Hard cap (in characters) for any single emitted chunk body. A lone paragraph
   * longer than this is split on sentence/word boundaries so nothing silently
   * overflows the model's context. Default 1200.
   */
  maxChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = { targetChars: 900, maxChars: 1200 };

/** An ATX heading line like `## Setup` → { level: 2, text: "Setup" }. */
function parseHeading(line: string): { level: number; text: string } | null {
  const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
  if (!m) return null;
  return { level: m[1]!.length, text: m[2]!.trim() };
}

/**
 * Maintain the heading breadcrumb as we walk the document. A heading at level N
 * replaces any deeper-or-equal trailing entries, so "# A / ## B" then "## C"
 * yields "A > C", and a deeper "### D" yields "A > C > D".
 */
function breadcrumbOf(stack: { level: number; text: string }[]): string {
  return stack.map((h) => h.text).join(' > ');
}

/**
 * Split a single oversized block of prose into pieces no larger than `maxChars`,
 * preferring sentence boundaries and falling back to word boundaries. Never
 * splits mid-word; a pathological single token longer than maxChars is emitted
 * whole rather than mangled.
 */
function splitLongText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  // Split into sentence-ish units, keeping the terminating punctuation.
  const sentences = text.match(/[^.!?\n]+[.!?]?\s*/g) ?? [text];
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  };
  for (const sentence of sentences) {
    if ((buf + sentence).length <= maxChars) {
      buf += sentence;
      continue;
    }
    flush();
    if (sentence.length <= maxChars) {
      buf = sentence;
      continue;
    }
    // A single sentence still too long: fall back to word-level packing.
    let line = '';
    for (const word of sentence.split(/(\s+)/)) {
      if ((line + word).length > maxChars && line.trim()) {
        out.push(line.trim());
        line = '';
      }
      line += word;
    }
    if (line.trim()) buf = line;
  }
  flush();
  return out;
}

/**
 * Chunk a markdown body into breadcrumb-tagged pieces. Fenced code blocks are
 * kept intact (never split mid-fence) and headings drive the breadcrumb path.
 * Returns at least one chunk for any non-empty input; empty/whitespace input
 * yields no chunks.
 */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const { targetChars, maxChars } = { ...DEFAULTS, ...options };
  const lines = markdown.split('\n');

  const headingStack: { level: number; text: string }[] = [];
  const chunks: Chunk[] = [];
  let index = 0;

  // Accumulated body for the current breadcrumb section.
  let buf: string[] = [];
  let bufLen = 0;
  let bufBreadcrumb = '';

  const emit = (body: string, breadcrumb: string): void => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const text = breadcrumb ? `${breadcrumb}\n\n${trimmed}` : trimmed;
    chunks.push({ index: index++, breadcrumb, text });
  };

  /** Flush the current buffer, hard-splitting if it exceeds maxChars. */
  const flush = (): void => {
    const body = buf.join('\n').trim();
    buf = [];
    bufLen = 0;
    if (!body) return;
    if (body.length <= maxChars) {
      emit(body, bufBreadcrumb);
      return;
    }
    for (const piece of splitLongText(body, maxChars)) emit(piece, bufBreadcrumb);
  };

  let inFence = false;
  let fenceMarker = '';
  let para: string[] = [];

  const pushPara = (): void => {
    const text = para.join('\n');
    para = [];
    if (!text.trim()) return;
    // Starting a new section's first content: lock in the breadcrumb.
    if (buf.length === 0) bufBreadcrumb = breadcrumbOf(headingStack);
    buf.push(text);
    bufLen += text.length;
    if (bufLen >= targetChars) flush();
  };

  for (const line of lines) {
    const fence = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[2]!;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0]!;
      } else if (marker[0] === fenceMarker) {
        inFence = false;
      }
      para.push(line);
      continue;
    }
    if (inFence) {
      para.push(line);
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      // A heading ends the current paragraph and section buffer, then updates
      // the breadcrumb stack for everything that follows.
      pushPara();
      flush();
      while (headingStack.length && headingStack[headingStack.length - 1]!.level >= heading.level) {
        headingStack.pop();
      }
      headingStack.push(heading);
      bufBreadcrumb = breadcrumbOf(headingStack);
      continue;
    }

    if (line.trim() === '') {
      pushPara();
    } else {
      para.push(line);
    }
  }
  pushPara();
  flush();

  return chunks;
}
