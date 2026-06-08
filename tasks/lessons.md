# Lessons log

Append-only. Each entry: what went wrong → the fix. Read this at the start of each session.

- **Diagrams must be high quality, always** (user is emphatic). A passing `validate_diagram`
  is the floor, not the bar. Quality means: descriptive labels (not single abstract words),
  no noisy self-loops/clutter, and pick a diagram type that *adds* a view rather than restating
  another. For sequence diagrams use `autonumber`, `actor`/`participant` aliases, `opt`/`alt`
  blocks, `activate`/`deactivate`, and `Note over` where they aid clarity. Don't dash off a
  minimal diagram — design it.

- **pnpm build allowlist is `package.json` → `pnpm.onlyBuiltDependencies`, NOT the
  `allowBuilds:` map in `pnpm-workspace.yaml`** (that key is non-standard and pnpm ignores it).
  A native dep (e.g. `sharp`, pulled in by `@xenova/transformers`) only runs its install/build
  script if listed there. Symptom: import fails with `Cannot find module .../build/Release/*.node`.
  Verify a packaging fix with a real `rm -rf node_modules && pnpm install`, not `pnpm rebuild`/
  `--force` (both no-op on cached build state).
- **Stub-based tests can hide a broken real path**: the semantic suite injected a stub embedder,
  so 68 tests passed green while the *real* `TransformersEmbedder` couldn't even import (sharp).
  Don't trust a subagent's "loads in node" claim — smoke-test the real dependency path once
  (`node -e "import('pkg')"` + a tiny functional check) before declaring a feature done.
- **Watcher integration tests flake under suite CPU load**: chokidar `awaitWriteFinish` events
  stall when vitest runs test files in parallel. Fixes: load-tolerant timeouts (assert *eventual*
  convergence, not a 3s SLA) + `vitest.config.ts` `fileParallelism: false` for the core package.

- **Keychain prompt on every launch = ad-hoc signature churn**: the app encrypts cookies
  via the Keychain (`EnableCookieEncryption` fuse in `build/fuses.cjs`). macOS ties that grant
  to the code signature, but local builds are ad-hoc (`identity: null`) so the fingerprint
  changes every rebuild → "DocVault wants to use your confidential information…" re-prompts each
  start. Fix: sign every build with one fixed self-signed cert. `pnpm --filter @docvault/desktop
  dev-cert` creates it once; `reinstall.sh` then signs SRC with "DocVault Dev" automatically.
- **Flowchart labels invisible = DOMPurify strips foreignObject**: Mermaid renders flowchart/class
  node labels as HTML inside `<foreignObject>`, but `Mermaid.tsx` sanitizes with DOMPurify's
  svg-only profile (`USE_PROFILES:{svg,svgFilters}`), which drops that HTML → shapes render, text
  vanishes. Sequence diagrams use SVG `<text>` so they're unaffected. Fix: `mermaid.initialize({
  htmlLabels:false, flowchart:{htmlLabels:false} })` so labels are SVG text that survives the
  sanitizer — keeps the strict profile (no security loosening). Verify flowcharts, not just sequence.
- **Mermaid renders tiny inside BlockNote** because `.bn-block-content` is `display:flex;width:100%`,
  which shrinks the SVG to a sliver. Opt the block out: `.bn-block-content[data-content-type='mermaid']
  { display:block }`, then size via `.dv-mermaid-svg { max-width:…; margin:0 auto }`. A standalone
  CSS harness won't reveal this — must replicate BlockNote's wrapper.
- **FTS5 + `snippet()`**: a contentless FTS5 table (`content=''`) can't produce snippets.
  Use a regular FTS5 table that stores the body (with a `doc_id UNINDEXED` column).
- **Renderer can't value-import `@docvault/core`**: the barrel re-exports `DocVault` →
  `doc.js` → `node:fs`, so a value import from `@docvault/core` breaks the browser bundle
  ("readFile is not exported by __vite-browser-external"). Type-only imports are fine (erased).
  For pure helpers the renderer needs (e.g. diagram templates), add a subpath `exports` entry in
  core's package.json (`"./diagram"`) pointing at the fs-free module and import from there.
- **chokidar `followSymlinks: false` breaks on macOS tmpdir**: `/var` is a symlink to
  `/private/var`, so watching a vault under `os.tmpdir()` silently emits no events with that flag.
  For symlink-escape safety, guard reads instead (canonicalize via `realpath` in `vault.abs()`),
  not the watcher option.
- **Path containment needs realpath, not just `..` checks**: a string-prefix check on a resolved
  path misses a symlink *inside* the dir that points out. `vault.abs()` canonicalizes the longest
  existing prefix and re-checks against `realpath(root)`.
- **mammoth types**: `convertToMarkdown` isn't in the published TS types. Use
  `extractRawText` for the searchable sidecar.
- **pnpm 11.5+ build approval**: native builds (better-sqlite3, esbuild) must be allowlisted
  under `allowBuilds:` in `pnpm-workspace.yaml`, not just `pnpm.onlyBuiltDependencies`.
- **better-sqlite3 dual-ABI**: one native binary can't serve both system-node (MCP/tests) and
  Electron. Solution: the desktop spawns the MCP server as a **system-node sidecar** and talks
  to it as an MCP client; Electron never loads better-sqlite3. Keep `npmRebuild: false` in
  electron-builder so the bundled binary stays node-ABI. Config (JSON) is read directly in main.
- **GUI launch has no shell PATH**: Finder/Applications launches don't inherit PATH, so `node`,
  `claude`, `codex` aren't found. Recover PATH via `$SHELL -lic 'printf %s "$PATH"'` and resolve
  bins to absolute paths (`src/main/shell-env.ts`).
- **Electron icon ≠ ship's wheel**: a spoked vault dial reads like Helm. DocVault icon = page +
  folded corner + keyhole. Regenerate via `pnpm --filter @docvault/desktop icon` then rebuild .icns.
- **packaging**: `asar: false` so the sidecar JS + better_sqlite3.node are plain files node can
  read/dlopen. Install = `ditto dist-app/mac-arm64/DocVault.app /Applications/DocVault.app`.
- **Helm `mc` honors `$MC_BRIDGE`**: the `mc` bridge resolves `MC_BRIDGE || __dirname`, so when
  Helm launches a terminal it exports `MC_BRIDGE` to *that* workspace's bridge. Running `mc add`
  (even `./.mission-control/mc`) from docvault then writes to the wrong board. Check `echo
  $MC_BRIDGE` first; set it explicitly to target a workspace. `mc` has no delete op (only
  add/status/note) — wrong tasks come off the board via the app UI or the SQLite DB.
- **No `window.prompt()`/`confirm()` in Electron**: they silently return `null` (logs
  "prompt() is and will not be supported"), so `if (value)` guards never fire — buttons look dead.
  Collect input via an in-app inline `<input>`/modal instead (`Sidebar.tsx` InlineInput).
- **Rebuild /Applications after every large change**: the running app is the `/Applications`
  copy, which does NOT auto-update from dev builds. This is now one command — `pnpm reinstall`
  (`packages/desktop/scripts/reinstall.sh`): build → package unsigned `.app` → quit the running
  copy → `ditto` to `/Applications/DocVault.app` → relaunch. Flags: `--no-launch`, `--no-build`,
  `--no-quit` (refresh the bundle in place without killing a running instance).
  Don't hand-run the old build → package → ditto sequence anymore.
- **/Applications auto-refreshes on commit**: git `post-commit` + `post-merge` hooks
  (`.githooks/`, activated via `core.hooksPath`; run `pnpm setup:hooks` after a fresh clone) run
  `pnpm reinstall --no-launch --no-quit` in the background, so the canonical installed app tracks
  committed code. It's lock-debounced; logs to `/tmp/docvault-reinstall.log`. A running app is
  refreshed in place — restart DocVault to see the change.
