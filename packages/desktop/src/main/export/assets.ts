import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

/** Already-embeddable / remote sources we should pass through untouched. */
function isExternal(src: string): boolean {
  return /^(data:|https?:|file:)/i.test(src);
}

/**
 * Build an image-src resolver that inlines local vault images as `data:` URIs so
 * the exported HTML/PDF/DOCX is fully self-contained. Resolves a src relative to
 * the doc's directory first, then the vault root, and refuses any path that
 * escapes the vault. Remote / data sources and unreadable files pass through
 * unchanged so a broken image link never aborts an export.
 */
export function makeAssetInliner(vaultDir: string, docAbsDir: string) {
  const root = path.resolve(vaultDir);
  return async (src: string): Promise<string> => {
    if (!src || isExternal(src)) return src;
    const cleaned = src.replace(/^\//, '');
    const candidates = [path.resolve(docAbsDir, src), path.resolve(root, cleaned)];
    for (const abs of candidates) {
      if (abs !== root && !abs.startsWith(root + path.sep)) continue; // escapes vault
      const mime = MIME[path.extname(abs).toLowerCase()];
      if (!mime) continue;
      try {
        const buf = await readFile(abs);
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch {
        // try the next candidate
      }
    }
    return src;
  };
}
