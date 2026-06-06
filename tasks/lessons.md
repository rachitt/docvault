# Lessons log

Append-only. Each entry: what went wrong → the fix. Read this at the start of each session.

- **FTS5 + `snippet()`**: a contentless FTS5 table (`content=''`) can't produce snippets.
  Use a regular FTS5 table that stores the body (with a `doc_id UNINDEXED` column).
- **mammoth types**: `convertToMarkdown` isn't in the published TS types. Use
  `extractRawText` for the searchable sidecar.
- **pnpm 11.5+ build approval**: native builds (better-sqlite3, esbuild) must be allowlisted
  under `allowBuilds:` in `pnpm-workspace.yaml`, not just `pnpm.onlyBuiltDependencies`.
