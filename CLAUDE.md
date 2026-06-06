# DocVault — project guide for agents

Local-first documentation platform. Markdown files on disk are the **source of truth**;
SQLite is a rebuildable index. Desktop app + MCP server + agents all share one vault.

## Monorepo (pnpm workspace)
- `packages/core` — `@docvault/core`: vault layout, doc CRUD, SQLite FTS index, backlinks,
  pdf/docx/txt importers, file watcher. No Electron, no DOM. The single API surface is the
  `DocVault` facade (`src/docvault.ts`).
- `packages/mcp-server` — `@docvault/mcp-server`: stdio MCP server wrapping `core`.
- `packages/desktop` — Electron + React Notion-style app (in progress).

## Commands
- Install: `pnpm install` (native builds for better-sqlite3/esbuild are pre-approved in
  `pnpm-workspace.yaml > allowBuilds`).
- Build a package: `pnpm --filter @docvault/core build` (tsc → `dist/`).
- Test core: `pnpm --filter @docvault/core test` (vitest).
- Smoke-test MCP: build it, then JSON-RPC over stdio (newline-delimited).

## Conventions
- TypeScript, ESM (`"type": "module"`), `NodeNext` resolution → **import with `.js`
  extensions** in source (e.g. `import { Vault } from './vault.js'`).
- `strict` + `noUncheckedIndexedAccess` are on; respect them.
- The index is derived: never treat `index.db` as authoritative. Any write goes through
  the file first, then `index.upsert(...)`.
- New MCP tools: register in `packages/mcp-server/src/index.ts` and back them with a
  `DocVault` method in `core` — don't put business logic in the server.

## Gotchas
- FTS5 table is a regular (content-storing) table so `snippet()` works — not contentless.
- mammoth: use `extractRawText` (its `convertToMarkdown` isn't in the TS types).
- Electron + better-sqlite3 will need `electron-rebuild` against Electron's ABI.

## Lessons log
Append mistakes + fixes to `workflows/lessons.md` (read it at the start of each session).
