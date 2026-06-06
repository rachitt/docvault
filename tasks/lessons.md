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
