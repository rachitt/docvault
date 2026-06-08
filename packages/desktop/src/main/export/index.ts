/**
 * Document export: render vault docs to standalone HTML, PDF, or DOCX.
 *
 * Markdown → HTML is done by the pure core renderer; this module supplies the
 * three host-bound pieces it needs — a Mermaid renderer (offscreen BrowserWindow),
 * an image inliner (filesystem), and link resolution — then turns the HTML into
 * the target format: HTML is written as-is, PDF via an offscreen window's
 * printToPDF, DOCX via html-to-docx with diagrams rasterized to PNG (DOCX can't
 * embed inline SVG). A single MermaidRenderer is reused across a whole batch.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { Doc } from '@docvault/core';
import { escapeHtml, renderDocHtml } from '@docvault/core/export';
import HTMLtoDOCX from 'html-to-docx';
import { makeAssetInliner } from './assets.js';
import { MermaidRenderer } from './mermaid.js';

export type ExportFormat = 'html' | 'pdf' | 'docx';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['html', 'pdf', 'docx'];
export const EXPORT_EXT: Record<ExportFormat, string> = { html: 'html', pdf: 'pdf', docx: 'docx' };

/** Kebab-case a title into a safe output filename stem. */
export function fileSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'untitled'
  );
}

export interface ExportDeps {
  vaultDir: string;
  /** Map a [[wikilink]] target to an href; defaults to plain text (null). */
  resolveLink?: (target: string) => string | null;
}

interface Ctx extends ExportDeps {
  mermaid: MermaidRenderer;
}

function diagramError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `<pre class="dv-mermaid-error">Diagram error: ${escapeHtml(msg)}</pre>`;
}

/** Render a doc to standalone HTML with inline-SVG diagrams (HTML + PDF). */
async function docToHtml(doc: Doc, ctx: Ctx): Promise<string> {
  const docDir = path.dirname(path.resolve(ctx.vaultDir, doc.relPath));
  const { html } = await renderDocHtml(doc, {
    resolveLink: ctx.resolveLink,
    resolveAsset: makeAssetInliner(ctx.vaultDir, docDir),
    renderMermaid: (code) => ctx.mermaid.renderSvg(code).catch(diagramError),
  });
  return html;
}

/** Render a doc to HTML with raster (PNG) diagrams — DOCX can't embed SVG. */
async function docToHtmlRaster(doc: Doc, ctx: Ctx): Promise<string> {
  const docDir = path.dirname(path.resolve(ctx.vaultDir, doc.relPath));
  const { html } = await renderDocHtml(doc, {
    resolveLink: ctx.resolveLink,
    resolveAsset: makeAssetInliner(ctx.vaultDir, docDir),
    renderMermaid: (code) =>
      ctx.mermaid
        .renderPngDataUri(code)
        .then((uri) => `<img src="${uri}" alt="diagram" />`)
        .catch(diagramError),
  });
  return html;
}

/** Print an HTML string to a PDF buffer via a one-shot offscreen window. */
async function htmlToPdf(html: string): Promise<Buffer> {
  // Use a temp file (not a data: URL) so large docs with inlined base64 images
  // don't blow past URL length limits.
  const tmp = path.join(os.tmpdir(), `dv-export-${process.pid}-${exportNonce()}.html`);
  await writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({ printBackground: true });
    return data;
  } finally {
    win.destroy();
    await rm(tmp, { force: true });
  }
}

let nonce = 0;
function exportNonce(): string {
  return `${Date.now()}-${nonce++}`;
}

async function docToDocx(doc: Doc, ctx: Ctx): Promise<Buffer> {
  const html = await docToHtmlRaster(doc, ctx);
  const out = await HTMLtoDOCX(html, null, { title: doc.frontmatter.title });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  return Buffer.from(await (out as Blob).arrayBuffer());
}

async function renderToBuffer(doc: Doc, format: ExportFormat, ctx: Ctx): Promise<Buffer> {
  if (format === 'html') return Buffer.from(await docToHtml(doc, ctx), 'utf8');
  if (format === 'pdf') return htmlToPdf(await docToHtml(doc, ctx));
  return docToDocx(doc, ctx);
}

/** Export a single doc to a chosen file path. */
export async function exportDocToFile(
  doc: Doc,
  format: ExportFormat,
  outPath: string,
  deps: ExportDeps,
): Promise<void> {
  const mermaid = new MermaidRenderer();
  try {
    const buf = await renderToBuffer(doc, format, { ...deps, mermaid });
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, buf);
  } finally {
    mermaid.dispose();
  }
}

export interface BulkProgress {
  done: number;
  total: number;
  title: string;
}

/** Assign each doc a unique output filename and a link-resolution map. */
function planFilenames(
  docs: Doc[],
  ext: string,
): { fileFor: Map<string, string>; nameOf: (doc: Doc) => string } {
  const fileFor = new Map<string, string>(); // id + lowercased title -> filename
  const used = new Set<string>();
  const byId = new Map<string, string>();
  for (const doc of docs) {
    const base = fileSlug(doc.frontmatter.title) || doc.frontmatter.id;
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.${ext}`;
    used.add(name);
    byId.set(doc.frontmatter.id, name);
    fileFor.set(doc.frontmatter.id, name);
    fileFor.set(doc.frontmatter.title.toLowerCase(), name);
  }
  return { fileFor, nameOf: (doc) => byId.get(doc.frontmatter.id) as string };
}

/**
 * Export many docs into a folder, one file each. Wikilinks between exported docs
 * are rewritten to point at the sibling files so the folder is self-navigable.
 */
export async function exportDocsToFolder(
  docs: Doc[],
  format: ExportFormat,
  outDir: string,
  deps: ExportDeps,
  onProgress?: (p: BulkProgress) => void,
): Promise<string[]> {
  const mermaid = new MermaidRenderer();
  const written: string[] = [];
  try {
    await mkdir(outDir, { recursive: true });
    const { fileFor, nameOf } = planFilenames(docs, EXPORT_EXT[format]);
    const resolveLink = (target: string): string | null => {
      const f = fileFor.get(target) ?? fileFor.get(target.toLowerCase());
      return f ? `./${f}` : (deps.resolveLink?.(target) ?? null);
    };
    const ctx: Ctx = { ...deps, resolveLink, mermaid };
    let done = 0;
    for (const doc of docs) {
      const outPath = path.join(outDir, nameOf(doc));
      await writeFile(outPath, await renderToBuffer(doc, format, ctx));
      written.push(outPath);
      onProgress?.({ done: ++done, total: docs.length, title: doc.frontmatter.title });
    }
    return written;
  } finally {
    mermaid.dispose();
  }
}

/**
 * Export many docs as a single combined PDF — each doc's body concatenated with
 * a page break between, then printed once.
 */
export async function exportCombinedPdf(
  docs: Doc[],
  outPath: string,
  deps: ExportDeps,
  onProgress?: (p: BulkProgress) => void,
): Promise<void> {
  const mermaid = new MermaidRenderer();
  try {
    const ctx: Ctx = { ...deps, mermaid };
    const sections: string[] = [];
    let shell = '';
    let done = 0;
    for (const doc of docs) {
      const html = await docToHtml(doc, ctx);
      if (!shell) shell = html; // first doc's full document carries the <style>
      const body = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? html;
      sections.push(`<section class="dv-doc">${body}</section>`);
      onProgress?.({ done: ++done, total: docs.length, title: doc.frontmatter.title });
    }
    const combined = shell.replace(
      /<body>[\s\S]*<\/body>/i,
      `<body>${sections.join('<div style="break-after:page"></div>')}</body>`,
    );
    const buf = await htmlToPdf(combined);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, buf);
  } finally {
    mermaid.dispose();
  }
}
