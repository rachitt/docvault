# Lessons log

Append-only. Each entry: what went wrong → the fix. Read this at the start of each session.

- **FTS5 + `snippet()`**: a contentless FTS5 table (`content=''`) can't produce snippets.
  Use a regular FTS5 table that stores the body (with a `doc_id UNINDEXED` column).
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
  copy, which does NOT auto-update from dev builds. After any substantial change, repackage and
  reinstall before testing/marking done: `pnpm --filter @docvault/desktop build` → package →
  `ditto dist-app/mac-arm64/DocVault.app /Applications/DocVault.app`.
