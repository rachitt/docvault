import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The watcher tests are timing-sensitive integration tests: they write a
    // file and wait for chokidar's fs events (awaitWriteFinish) to drive a
    // reindex/re-embed. When vitest runs every test file as a concurrent worker,
    // CPU contention starves chokidar's event delivery and these tests flake.
    // Running test files sequentially keeps them deterministic; the suite is
    // small and the pure-function tests are fast, so the wall-clock cost is tiny.
    fileParallelism: false,
  },
});
