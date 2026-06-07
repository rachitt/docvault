import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
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

  // The source path is caller-supplied (incl. via the MCP `import_file` tool, an
  // otherwise-bounded interface). Reject symlinks and anything that isn't a
  // regular file so a planted link can't make us copy `/etc/...` into the vault.
  const st = await lstat(srcAbsPath);
  if (st.isSymbolicLink()) throw new Error(`Refusing to import a symlink: ${srcAbsPath}`);
  if (!st.isFile()) throw new Error(`Not a regular file: ${srcAbsPath}`);

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

/**
 * Re-extract the text of an already-imported original whose bytes changed on
 * disk, rewriting its `<file>.md` sidecar in place while preserving the
 * sidecar's identity (id, title, tags, created). Returns the refreshed sidecar
 * doc, or null when the file isn't importable or has no managed sidecar yet
 * (we only refresh sidecars that were created by a prior import).
 */
export async function reextract(vault: Vault, originalAbs: string): Promise<Doc | null> {
  const ext = path.extname(originalAbs).toLowerCase() as ImportableExt;
  const extractor = EXTRACTORS[ext];
  if (!extractor) return null;

  const sidecarAbs = `${originalAbs}.md`;
  if (!existsSync(sidecarAbs)) return null;

  const existing = parseDoc(await readFile(sidecarAbs, 'utf8'), vault, sidecarAbs);
  const text = await extractor(originalAbs);
  const doc: Doc = {
    ...existing,
    frontmatter: {
      ...existing.frontmatter,
      updated: new Date().toISOString(),
      source: existing.frontmatter.source ?? vault.rel(originalAbs),
    },
    content: text || '_(no extractable text)_',
  };
  const serialized = serializeDoc(doc);
  await writeFile(sidecarAbs, serialized, 'utf8');
  return parseDoc(serialized, vault, sidecarAbs);
}
