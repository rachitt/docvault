/**
 * Electron smoke test for the export pipeline. Boots a real Electron runtime and
 * exports a sample doc (with a mermaid diagram, a callout, and a local image) to
 * HTML / PDF / DOCX plus a combined PDF, asserting each output looks right. This
 * exercises the parts that can't be unit-tested in Node: the offscreen Mermaid
 * renderer, printToPDF, and html-to-docx. Run it with `scripts/export-smoke.run.mjs`.
 *
 * Results are written synchronously to a report file because app.exit() can drop
 * buffered stdout. A `window-all-closed` guard keeps the app alive when the
 * transient export windows are destroyed (the real app always has a main window,
 * so this only matters for this windowless harness).
 */
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { Doc } from '@docvault/core';
import { exportCombinedPdf, exportDocToFile } from '../src/main/export/index.js';

const REPORT = process.env.DV_SMOKE_REPORT ?? path.join(os.tmpdir(), 'dv-smoke-report.txt');
const lines: string[] = [];
function log(s: string): void {
  lines.push(s);
  writeFileSync(REPORT, lines.join('\n') + '\n'); // sync so app.exit() can't lose it
}

// A 1x1 transparent PNG.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const MD = `# Hello world

Some **bold** text and a list:

- one
- two

> [!INFO]
> A callout body.

![dot](assets/dot.png)

\`\`\`mermaid
graph TD; A[Start] --> B[End];
\`\`\`
`;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function run(): Promise<void> {
  const vaultDir = path.join(os.tmpdir(), `dv-smoke-${process.pid}`);
  await mkdir(path.join(vaultDir, 'docs', 'demo'), { recursive: true });
  await mkdir(path.join(vaultDir, 'assets'), { recursive: true });
  await writeFile(path.join(vaultDir, 'assets', 'dot.png'), PNG_1x1);

  const doc: Doc = {
    frontmatter: {
      id: '01SMOKETEST',
      title: 'Smoke Test',
      tags: ['demo'],
      status: 'draft',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-06-01T00:00:00.000Z',
    },
    content: MD,
    relPath: 'docs/demo/smoke.md',
    absPath: path.join(vaultDir, 'docs', 'demo', 'smoke.md'),
  };

  const out = (ext: string): string => path.join(vaultDir, `out.${ext}`);

  await exportDocToFile(doc, 'html', out('html'), { vaultDir });
  const html = await readFile(out('html'), 'utf8');
  assert(html.includes('<title>Smoke Test</title>'), 'html has title');
  assert(html.includes('dv-callout-info'), 'html has callout');
  assert(html.includes('<svg'), 'html rendered mermaid to svg');
  assert(html.includes('data:image/png;base64'), 'html inlined the image');
  log('  HTML export ok');

  await exportDocToFile(doc, 'pdf', out('pdf'), { vaultDir });
  const pdf = await readFile(out('pdf'));
  assert(pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'pdf magic header');
  assert(pdf.length > 1000, 'pdf has content');
  log(`  PDF export ok (${pdf.length} bytes)`);

  await exportDocToFile(doc, 'docx', out('docx'), { vaultDir });
  const docx = await readFile(out('docx'));
  assert(docx.subarray(0, 2).toString('latin1') === 'PK', 'docx is a zip');
  assert(docx.length > 1000, 'docx has content');
  log(`  DOCX export ok (${docx.length} bytes)`);

  await exportCombinedPdf([doc, doc], out('combined.pdf'), { vaultDir });
  const combined = await readFile(out('combined.pdf'));
  assert(combined.subarray(0, 5).toString('latin1') === '%PDF-', 'combined pdf magic');
  log(`  Combined PDF ok (${combined.length} bytes)`);
}

// Keep the app alive when transient export windows are destroyed.
app.on('window-all-closed', () => {});

app
  .whenReady()
  .then(run)
  .then(() => {
    log('SMOKE OK');
    app.exit(0);
  })
  .catch((err: unknown) => {
    log('SMOKE FAILED: ' + (err instanceof Error ? err.stack : String(err)));
    app.exit(1);
  });
