/**
 * Bundles and runs the Electron export smoke test, then reports pass/fail.
 *   node scripts/export-smoke.run.mjs   (from packages/desktop)
 *
 * The TS harness is bundled with esbuild (Electron + native + workspace deps left
 * external) and executed under the local Electron binary. Exits non-zero on failure.
 */
import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const outDir = path.join(root, '.smoke');
const bundle = path.join(outDir, 'smoke.mjs');
const report = path.join(os.tmpdir(), `dv-smoke-report-${process.pid}.txt`);

mkdirSync(outDir, { recursive: true });
rmSync(report, { force: true });

// esbuild isn't directly resolvable from this package; find it in the pnpm store.
const repoRoot = path.resolve(root, '../..');
const esbuildMain = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js', {
  cwd: repoRoot,
})[0];
if (!esbuildMain) throw new Error('esbuild not found in pnpm store');
const { build } = await import(pathToFileURL(path.join(repoRoot, esbuildMain)).href);
await build({
  entryPoints: [path.join(root, 'scripts/export-smoke.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  external: ['electron', '@docvault/core', '@docvault/core/export', 'html-to-docx', 'mermaid', 'better-sqlite3'],
});

const electron = require('electron'); // path to the electron binary
const res = spawnSync(electron, [bundle], {
  stdio: 'ignore',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', DV_SMOKE_REPORT: report },
});

let out = '';
try {
  out = readFileSync(report, 'utf8');
} catch {
  /* no report written */
}
process.stdout.write(out + '\n');

if (res.status === 0 && out.includes('SMOKE OK')) {
  console.log('export smoke: PASS');
  process.exit(0);
} else {
  console.error('export smoke: FAIL');
  process.exit(1);
}
