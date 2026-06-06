/**
 * Parse inline `[[wikilinks]]` from markdown content. A wikilink targets either
 * a doc id or a doc title; the optional `|alias` display text is ignored for
 * indexing. Links inside fenced code blocks are skipped.
 */
export function extractWikilinks(content: string): string[] {
  const withoutFences = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const targets = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutFences)) !== null) {
    const target = m[1]?.trim();
    if (target) targets.add(target);
  }
  return [...targets];
}
