# DocVault

A local-first documentation platform — like Notion, but your docs are plain Markdown
files on disk and **Claude Code / Codex connect to it natively** through an MCP server.

- **Files are the source of truth.** Every doc is a `.md` file with YAML frontmatter, so
  agents can read/write them directly and everything is git-versionable.
- **SQLite index on top.** Full-text search (FTS5), tags, and `[[wikilink]]` backlinks —
  a rebuildable cache, never the source of truth.
- **PDF / DOCX / TXT support.** Imported files are kept as originals plus an auto-extracted
  markdown **sidecar**, so their content is searchable and agent-readable.
- **One shared vault.** The desktop app, the MCP server, and any agents all operate on the
  same folder; a file watcher keeps the index consistent no matter who writes.

## Monorepo layout

```
packages/
  core/         storage + SQLite index + importers (shared library)   ✅ built & tested
  mcp-server/   stdio MCP server exposing the vault to agents          ✅ built & verified
  desktop/      Electron + React Notion-style app                      🚧 in progress
```

## Quick start

```bash
pnpm install
pnpm --filter @docvault/core build
pnpm --filter @docvault/mcp-server build
```

### Connect Claude Code to your vault

```bash
claude mcp add docvault -- node /ABS/PATH/docvault/packages/mcp-server/dist/index.js \
  --vault ~/DocVault
```

### Connect Codex to your vault

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.docvault]
command = "node"
args = ["/ABS/PATH/docvault/packages/mcp-server/dist/index.js", "--vault", "/Users/you/DocVault"]
```

## MCP tools

`list_products` · `list_docs` · `search_docs` · `read_doc` · `create_doc` · `update_doc` ·
`delete_doc` · `get_backlinks` · `link_docs` · `list_tags` · `import_file` · `create_product`

## Vault layout

```
DocVault/
├─ .docvault/        index.db (SQLite) + config.json (starred / recent / trash)
├─ docs/             one folder per Product
│  └─ superchat/     product.json + *.md docs
├─ templates/        reusable doc templates
└─ assets/           imported originals (pdf/docx/txt) + their .md sidecars
```
