# DocVault — Local-First Documentation Platform with Native Claude Code / Codex Integration

## Context

You want your own Notion-like documentation desktop app to systematically document your
products/apps, with the explicit requirement that **Claude Code and Codex can connect to it
trivially** (via an MCP server). It must be **local-first, single-user**, store docs as
**Markdown + YAML frontmatter** (so agents can read/write files directly), and also handle
**`.pdf`, `.docx`, and `.txt`** files.

The winning idea: **files on disk are the source of truth**, a SQLite index sits on top for
search/backlinks, and *both* the desktop app and the MCP server operate on the same vault
directory. Because everything is plain markdown, Claude Code can edit docs with its normal
file tools, while the MCP server adds structured operations (search, import, backlinks, tags).
PDFs/DOCX are kept as originals plus an auto-extracted markdown **sidecar** so their content is
searchable and agent-readable.

New standalone repo. Reuses the proven Electron + React + Vite patterns already working in
Helm (this workspace), but rebuilt in TypeScript as a clean pnpm monorepo.

---

## Recommended Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language across app + MCP + core; agent-friendly |
| Desktop shell | **Electron** | JS end-to-end, no Rust learning curve, reuse Helm patterns |
| Build/bundle | **electron-vite** + **electron-builder** | Fast HMR dev, clean dmg packaging |
| UI | **React 19 + Tailwind CSS + shadcn/ui** + lucide-react | Fast, polished, consistent |
| Editor | **BlockNote** (ProseMirror/TipTap under the hood) | Notion-style blocks out of the box, markdown import/export |
| App state | **Zustand** | Lightweight, simple |
| Storage | **Filesystem** (markdown + assets) = source of truth | Git-versionable, directly agent-editable |
| Index/search | **better-sqlite3 + FTS5**, watched by **chokidar** | Fast full-text search, backlinks, tags |
| Frontmatter | **gray-matter** | Standard YAML frontmatter parse/serialize |
| PDF extract/view | **pdfjs-dist** (extract + `react-pdf` viewer) | Text extraction for search + in-app viewing |
| DOCX extract/view | **mammoth** (→ markdown/HTML) + **docx-preview** | Convert to readable text + faithful preview |
| TXT | native read | Trivial |
| Diagrams | **Mermaid** code-fence blocks rendered inline (tldraw canvas as later enhancement) | Stays as text in markdown → agent-writable; renders the "System overview" diagram |
| In-app AI | **Claude Code headless (`claude -p`)** subprocess scoped to the vault; Codex (`codex exec`) as alt backend | Powers the right-panel AI assistant; no API key, reuses the same vault + MCP |
| MCP server | **@modelcontextprotocol/sdk** (stdio transport) | Official SDK; works with Claude Code + Codex |
| Repo | **pnpm workspace** monorepo | Share `core` lib between desktop + MCP |

**Why not Tauri?** Lighter binaries, but Rust backend adds friction with no real payoff for a
local single-user app; Electron keeps the whole stack in TS and mirrors your existing Helm work.

---

## Repo Layout

```
docvault/
├─ pnpm-workspace.yaml
├─ package.json
├─ plan.md                      # implementation plan committed into the repo
├─ README.md
├─ packages/
│  ├─ core/                     # shared library (no Electron, no DOM)
│  │  ├─ src/
│  │  │  ├─ vault.ts            # vault path resolution, config
│  │  │  ├─ doc.ts             # read/write md, frontmatter (gray-matter), ULID ids
│  │  │  ├─ index.ts          # better-sqlite3 schema + FTS5
│  │  │  ├─ search.ts          # query API
│  │  │  ├─ links.ts           # [[wikilink]] parsing + backlinks
│  │  │  ├─ watcher.ts         # chokidar → incremental reindex
│  │  │  └─ import/             # pdf.ts (pdfjs), docx.ts (mammoth), txt.ts → sidecars
│  ├─ mcp-server/               # stdio MCP server, depends on core
│  │  └─ src/index.ts
│  └─ desktop/                  # Electron + React app, depends on core
│     ├─ electron/  (main.ts, preload.ts, ipc.ts, ai.ts ← spawns `claude -p`)
│     └─ src/
│        ├─ layout/   (AppShell 3-pane, TopBar breadcrumbs, StatusBar "Local • synced")
│        ├─ sidebar/  (WorkspaceSwitcher, NavTree: Home/Recent/Starred/Templates/Trash + Products tree)
│        ├─ editor/   (BlockNote + custom blocks: Callout, CodeBlock, Mermaid diagram)
│        ├─ rightpanel/ (Outline tab = auto TOC, AIAssistant tab)
│        ├─ search/   (⌘K command palette over FTS)
│        └─ viewers/  (PdfViewer, DocxViewer, TxtViewer)
```

### Vault on disk (the "database")
```
~/Documents/DocVault/                # user-chosen vault dir
├─ .docvault/
│  ├─ index.db                       # SQLite FTS + metadata (rebuildable cache)
│  └─ config.json
├─ docs/                             # each top-level folder = a "Product" in the sidebar
│  └─ superchat/                     # Product (has icon/color in product.json)
│     ├─ product.json                # { title, icon, color, order }
│     ├─ overview.md
│     └─ architecture.md
├─ templates/                        # reusable doc templates (Templates nav item)
└─ assets/
   ├─ spec.pdf  +  spec.pdf.md       # original + extracted sidecar
   └─ contract.docx + contract.docx.md
```

`.docvault/config.json` holds app-level metadata that isn't doc content: **starred** doc ids,
**recent** list, **trash** (soft-deleted paths), workspace name, AI backend choice.

Markdown doc frontmatter:
```yaml
---
id: 01HZX...            # ULID, stable identifier
title: Architecture
tags: [superchat, architecture]
status: draft
created: 2026-06-05
updated: 2026-06-05
---
```

### UI model (matches the "Atlas" reference)
- **Left**: workspace switcher → `Home / Recent / Starred / Templates / Trash`, then a
  **Products** section listing each `docs/<product>/` folder (icon + color) with its docs nested.
- **Center**: breadcrumb bar + BlockNote editor. Custom blocks: colored **Callout**
  (info/principle/warning), **CodeBlock** with language label + syntax highlight, **Mermaid**
  diagram block (the "System overview"). Headings drive the outline.
- **Right**: **Outline** tab (auto-generated TOC from headings) and **AI Assistant** tab
  (context chips + free input) — backed by `claude -p` running in the vault.

---

## Implementation Plan (phased)

### Phase 0 — Scaffold
- Use the existing `~/Documents/docvault/` folder (already created); `git init` there
  (SSH remote when pushed, per your convention). Move the reference screenshot into `docs-assets/`.
- pnpm workspace; TS project refs; shared `tsconfig.base.json`; ESLint/Prettier.
- Write this implementation plan to `plan.md` in the repo root and commit.

### Phase 1 — `core` (storage + index, headless)
- `vault.ts`: resolve/create vault dir + `.docvault/config.json`.
- `doc.ts`: CRUD markdown with `gray-matter`; auto-assign ULID; update `updated` timestamp.
- `index.ts`/`search.ts`: SQLite schema (`docs`, `tags`, `links`, `docs_fts` FTS5); upsert + full-text query.
- `links.ts`: parse `[[wikilink]]` and frontmatter links → backlinks table.
- `watcher.ts`: chokidar watches `docs/` + `assets/`, incremental reindex (any writer stays in sync).
- `import/`: pdf (pdfjs-dist text extraction), docx (mammoth → markdown), txt → write `<file>.md` sidecar with frontmatter; index sidecar content.
- Unit tests for parse/index/search/import.

### Phase 2 — `mcp-server`
- stdio MCP server (`@modelcontextprotocol/sdk`) wrapping `core`. Tools:
  - `list_docs` (tree / filter by folder+tag), `read_doc`, `search_docs` (FTS),
    `create_doc`, `update_doc` (replace/append), `delete_doc`,
    `get_backlinks`, `link_docs`, `list_tags`, `import_file` (pdf/docx/txt).
- Vault dir via `--vault` arg / `DOCVAULT_DIR` env.
- Provide ready-to-paste registration:
  - Claude Code: `claude mcp add docvault -- node /abs/path/mcp-server/dist/index.js --vault ~/Documents/DocVault`
  - Codex: `mcp_servers.docvault` block in `~/.codex/config.toml`.

### Phase 3 — `desktop` shell + navigation (Electron + React)
- Electron main + preload (contextIsolation), IPC calling `core`.
- **AppShell** 3-pane layout (Tailwind + shadcn/ui) matching the reference; light theme first.
- **Sidebar**: workspace switcher; Home/Recent/Starred/Templates/Trash; **Products** tree built
  from `docs/<product>/` (icon+color from `product.json`); "+ New product", "+ New doc".
- **TopBar**: breadcrumbs (Products › Product › Doc); StatusBar "Local • synced".
- **⌘K command palette** over FTS search (`core.search`).

### Phase 4 — `desktop` editor + viewers
- **BlockNote** editor: load md → blocks on open, serialize blocks → md on save (debounced),
  write through `core` (so index + watcher stay consistent).
- Custom blocks: **Callout** (info/principle/warning colors), **CodeBlock** (lang label +
  highlight.js/shiki), **Mermaid** diagram block (render + edit source).
- **Right panel — Outline**: auto TOC from headings, click-to-scroll.
- Viewers: `react-pdf` (PDF), `docx-preview` (DOCX), plain (TXT); "open original" + show sidecar text.
- Drag-and-drop import → `core` importer → appears in tree + search.

### Phase 5 — In-app AI Assistant (right-panel tab)
- `electron/ai.ts` spawns **`claude -p "<prompt>"`** with `cwd` = vault dir, streaming output
  back over IPC (no API key; reuses your `claude -p` subprocess pattern). Codex (`codex exec`)
  selectable as an alternate backend.
- Because it runs in the vault, the assistant can read all docs and call the **DocVault MCP**
  (auto-register the MCP for the headless session) — so "Summarize this page" / "Explain the
  system overview" work with full context.
- Context chips seeded from the current doc; free-text input; render markdown responses.

### Phase 6 — Polish & package
- Settings (choose vault dir, theme, AI backend), keyboard shortcuts (quick-open, new doc).
- Starred/Recent/Trash wired to `config.json`; Templates → "new from template".
- `electron-builder` → `.dmg` for macOS arm64. README with setup + MCP registration snippets.

---

## How agents connect (the payoff)
1. **Direct file access** — vault is plain markdown, so Claude Code/Codex in that folder read/write docs with normal tools.
2. **Structured MCP** — same agents call `search_docs`, `import_file`, `get_backlinks`, etc. against the live index.
3. Desktop app + MCP + agents all share one vault; chokidar keeps the index consistent no matter who writes.

---

## Verification
- `core`: `pnpm --filter core test` — round-trip a doc, search returns it, import a sample PDF/DOCX and confirm sidecar + searchable text, backlinks resolve.
- `mcp-server`: run with `@modelcontextprotocol/inspector`; then register in Claude Code and confirm `search_docs` / `create_doc` work end-to-end from an agent.
- `desktop`: `pnpm --filter desktop dev` — create a doc in the app, confirm the `.md` file appears on disk and is found via MCP search (proves shared-vault consistency); import a PDF and view it; render a Mermaid block; ask the AI panel "Summarize this page" and confirm `claude -p` streams a grounded answer.

---

## Open choice (non-blocking)
Editor defaulted to **BlockNote** (Notion-style blocks, markdown round-trip). If you'd prefer a
markdown-native editor with zero round-trip loss, **Milkdown** is the swap-in alternative — does
not change any other part of the architecture.
