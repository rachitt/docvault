import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { parseDoc, serializeDoc } from '../doc.js';
import type { Doc } from '../types.js';
import type { Vault } from '../vault.js';

/**
 * Pick a destination path inside assets/ that doesn't already exist, so
 * importing two files with the same basename never overwrites the first.
 */
function uniqueDest(dir: string, baseName: string): string {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = path.join(dir, baseName);
  let n = 1;
  while (existsSync(candidate) || existsSync(`${candidate}.md`)) {
    candidate = path.join(dir, `${stem}-${n}${ext}`);
    n++;
  }
  return candidate;
}
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
  const sameFile = path.resolve(srcAbsPath) === path.resolve(path.join(vault.assetsDir, baseName));
  const destAbs = sameFile
    ? path.join(vault.assetsDir, baseName)
    : uniqueDest(vault.assetsDir, baseName);
  if (!sameFile) await copyFile(srcAbsPath, destAbs);

  const text = await extractor(destAbs);
  const title = path.basename(destAbs, ext);
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
  const serialized = serializeDoc(doc);
  await writeFile(sidecarAbs, serialized, 'utf8');
  // Re-parse to normalize exactly what landed on disk.
  const written = parseDoc(serialized, vault, sidecarAbs);
  return { doc: written, original: vault.rel(destAbs) };
}
