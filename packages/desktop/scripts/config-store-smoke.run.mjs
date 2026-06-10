/**
 * Bundles and runs a smoke test for the main-process ConfigStore, then reports
 * pass/fail.
 *   node scripts/config-store-smoke.run.mjs   (from packages/desktop)
 *
 * ConfigStore has no Electron/native dependency, so the test runs under plain
 * node: '@docvault/core' is aliased to core's pure types module (normalizeTrash)
 * to avoid loading the SQLite-backed index. Verifies:
 *   1. write() is atomic — no leftover *.tmp files, valid JSON on disk.
 *   2. update() serializes concurrent functional read-modify-writes (no lost
 *      updates), the failure mode that used to drop sidecar trash entries.
 *   3. a partial patch never clobbers unrelated fields.
 */
import assert from 'node:assert/strict';
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const outDir = path.join(root, '.smoke');
const bundle = path.join(outDir, 'config-store-smoke.mjs');

mkdirSync(outDir, { recursive: true });

// esbuild isn't directly resolvable from this package; find it in the pnpm store.
const repoRoot = path.resolve(root, '../..');
const esbuildMain = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js', {
  cwd: repoRoot,
})[0];
if (!esbuildMain) throw new Error('esbuild not found in pnpm store');
const { build } = await import(pathToFileURL(path.join(repoRoot, esbuildMain)).href);
await build({
  entryPoints: [path.join(root, 'src/main/config.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  // ConfigStore only needs normalizeTrash from core; alias to the pure types
  // module so the bundle stays free of better-sqlite3 / Electron.
  alias: { '@docvault/core': path.join(repoRoot, 'packages/core/src/types.ts') },
});

const { ConfigStore } = await import(pathToFileURL(bundle).href);
const vaultDir = mkdtempSync(path.join(os.tmpdir(), 'dv-config-smoke-'));

try {
  const store = new ConfigStore(vaultDir);
  const metaDir = path.join(vaultDir, '.docvault');

  // 1. Atomic write: file is valid JSON and no temp files are left behind.
  await store.write({ ...(await store.read()), workspaceName: 'Smoke' });
  const onDisk = JSON.parse(readFileSync(path.join(metaDir, 'config.json'), 'utf8'));
  assert.equal(onDisk.workspaceName, 'Smoke', 'write persists the config');
  assert.deepEqual(globSync('config.json.*.tmp', { cwd: metaDir }), [], 'no leftover temp files');

  // 2. Concurrent functional updates must all land (no lost read-modify-write).
  const ids = Array.from({ length: 25 }, (_, i) => `doc-${i}`);
  await Promise.all(
    ids.map((id) => store.update((cfg) => ({ starred: [...cfg.starred, id] }))),
  );
  const afterConcurrent = await store.read();
  assert.deepEqual(
    [...afterConcurrent.starred].sort(),
    [...ids].sort(),
    'every concurrent update landed',
  );

  // 3. A partial patch leaves unrelated fields intact.
  const afterPatch = await store.update({ theme: 'dark' });
  assert.equal(afterPatch.workspaceName, 'Smoke', 'patch does not clobber other fields');
  assert.deepEqual([...afterPatch.starred].sort(), [...ids].sort(), 'patch keeps starred');
  assert.equal(afterPatch.theme, 'dark', 'patch applied');

  console.log('config-store smoke: PASS');
} catch (err) {
  console.error(err);
  console.error('config-store smoke: FAIL');
  process.exitCode = 1;
} finally {
  rmSync(vaultDir, { recursive: true, force: true });
}
