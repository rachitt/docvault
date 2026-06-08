# Lessons log

Append-only. Each entry: what went wrong → the fix. Read this at the start of each session.

- **Renderer can't import the `@docvault/core` barrel** (it pulls `indexer.ts` → `better-sqlite3`
  + `node:fs`, which break the browser bundle — symptom: `electron-vite build` fails with
  `"readFile" is not exported by "__vite-browser-external"`). Put browser-safe pure code behind a
  package `exports` subpath (e.g. `./markdown`, `./export`) and import from there, like the existing
  `./diagram` subpath. (Main process *can* import the barrel — it already does via `normalizeTrash` —
  but prefer subpaths to keep its load sqlite-free.)
- **`webContents.executeJavaScript` results must be structured-cloneable**, else it rejects with the
  opaque `"An object could not be cloned"`. Two gotchas: (1) injecting a UMD bundle returns the
  module's non-cloneable completion value — append `\n;true` so the call resolves; (2) catch errors
  *in-page* and return a plain `{ok,error}` object, otherwise a thrown Error crosses the boundary as
  the same opaque clone error and hides the real message.
- **Offscreen Mermaid/PDF: use a plain hidden window** (`show:false`), NOT `offscreen:true` —
  offscreen needs a paint subscription to composite and is the wrong mode for `printToPDF` /
  Mermaid `getBBox` layout. Also a *windowless* Electron run auto-quits on `window-all-closed`
  (even on macOS, with no handler); a headless export-test harness must add an empty handler. The
  real app is fine — its main window stays open.

- **Diagrams must be high quality, always** (user is emphatic). A passing `validate_diagram`
  is the floor, not the bar. Quality means: descriptive labels (not single abstract words),
  no noisy self-loops/clutter, and pick a diagram type that *adds* a view rather than restating
  another. For sequence diagrams use `autonumber`, `actor`/`participant` aliases, `opt`/`alt`
  blocks, `activate`/`deactivate`, and `Note over` where they aid clarity. Don't dash off a
  minimal diagram — design it.

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
