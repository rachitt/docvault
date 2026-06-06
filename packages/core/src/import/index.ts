import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { parseDoc, serializeDoc } from '../doc.js';
import type { Doc } from '../types.js';
import type { Vault } from '../vault.js';
import { extractDocx } from './docx.js';
import { extractPdf } from './pdf.js';
import { extractTxt } from './txt.js';

export type ImportableExt = '.pdf' | '.docx' | '.txt';

const EXTRACTORS: Record<ImportableExt, (absPath: string) => Promise<string>> = {
  '.pdf': extractPdf,
  '.docx': extractDocx,
  '.txt': extractTxt,
};

export function isImportable(file: string): file is `${string}${ImportableExt}` {
  return ['.pdf', '.docx', '.txt'].includes(path.extname(file).toLowerCase());
}

export interface ImportResult {
  /** The generated markdown sidecar doc (already written + ready to index). */
  doc: Doc;
  /** Vault-relative path to the copied original file. */
  original: string;
}

/**
 * Import a pdf/docx/txt file: copy the original into assets/, extract its text,
 * and write a sibling markdown sidecar (`<file>.md`) with frontmatter. The
 * sidecar is what gets indexed, so the source is fully searchable and readable
 * by agents, while the desktop app can still render the original.
 */
export async function importFile(
  vault: Vault,
  srcAbsPath: string,
  opts: { tags?: string[] } = {},
): Promise<ImportResult> {
  const ext = path.extname(srcAbsPath).toLowerCase() as ImportableExt;
  const extractor = EXTRACTORS[ext];
  if (!extractor) throw new Error(`Unsupported file type: ${ext}`);

  await mkdir(vault.assetsDir, { recursive: true });
  const baseName = path.basename(srcAbsPath);
  const destAbs = path.join(vault.assetsDir, baseName);
  if (path.resolve(srcAbsPath) !== path.resolve(destAbs)) {
    await copyFile(srcAbsPath, destAbs);
  }

  const text = await extractor(destAbs);
  const title = path.basename(baseName, ext);
  const now = new Date().toISOString();
  const sidecarAbs = `${destAbs}.md`;
  const doc: Doc = {
    frontmatter: {
      id: ulid(),
      title,
      tags: opts.tags ?? [],
      status: 'published',
      created: now,
      updated: now,
      source: vault.rel(destAbs),
    },
    content: text || '_(no extractable text)_',
    relPath: vault.rel(sidecarAbs),
    absPath: sidecarAbs,
  };
  await writeFile(sidecarAbs, serializeDoc(doc), 'utf8');
  // Re-parse to normalize exactly what landed on disk.
  const written = parseDoc(serializeDoc(doc), vault, sidecarAbs);
  return { doc: written, original: vault.rel(destAbs) };
}
