### 1.About the application
DocVault — a local-first, Notion-style documentation desktop app. Markdown files on disk are
the **source of truth**; SQLite (FTS5) is a rebuildable index. The desktop app, an MCP server,
and any agents all share one vault folder, kept in sync by a chokidar file watcher. PDFs/DOCX/TXT
are imported as originals + auto-extracted `.md` sidecars. Native Claude Code / Codex access is
via the MCP server; the in-app AI panel runs `claude -p` in the vault.

pnpm monorepo (TypeScript, ESM, `NodeNext` → import with `.js` extensions in core/mcp source):
- `packages/core` (`@docvault/core`) — `DocVault` facade in `src/docvault.ts`; storage, FTS
  index, backlinks, importers, watcher. No Electron/DOM.
- `packages/mcp-server` — stdio MCP server wrapping core (12 tools). Logic lives in core.
- `packages/desktop` — Electron + React + BlockNote, three-pane UI (ref:
  `docs-assets/atlas-ui-reference.png`). Uses Bundler resolution (no `.js` in imports).

Build: `pnpm --filter <pkg> build`. Test core: `pnpm --filter @docvault/core test`.
Gotchas: FTS5 table stores content (not contentless) so `snippet()` works; mammoth uses
`extractRawText`; Electron + better-sqlite3 needs `electron-rebuild`; native builds are
allowlisted in `pnpm-workspace.yaml > allowBuilds`.

### 2.Subagent strategy and Self Improvement
- Use subagents liberally to manage the main context window
- AFTER any correction from the user and learning: update `tasks/lessons.md`. Make sure to keep the learnings brief and the length of the file below 300 lines.
- Ruthlessly iterate on these lessons until failure rate drops.
- Review these lessons at the start of each session.

### Git operations
- While committing, keep commit messages short and concise and dont use co-authored tags.
- While executing tasks, try to work on multiple git worktrees to accelerate the dev process. 
- Create worktrees for features which are independent to avoid merge conflicts. Merging worktrees should happen sequentially as well.
- Use the staging branch to test all changes before merging into main. Merges into main only happen through this branch. 
- Create a new branch while working on a new feature and always open PR's before merging

### Security
- Work like a senior software engineer while writing code and always prioritize on security.
- auth on every endpoint, secrets via env vars not commits, input validation on WebSocket payloads, rate limits on the LLM/TTS proxies, PII handling for call recordings. 
- Voice AI has specific security shapes (recording consent, audio storage encryption, prompt injection via transcribed speech)

### Verification before done
- Never mark a task complete without proving it works
- Diff behaviour between main and your changes when relevant
- Ask yourself : "Would a staff engineer approve this?"
- When given a bug report : just fix it
- For bugs, dont just scratch the surface. Dive into the root cause and start fixing from there.

<!-- HELM:BEGIN (managed by Helm — safe to delete this block) -->
## Helm task board

This workspace is open in **Helm**, which shares a task board with you. Use it instead
of your own internal todo list when the user mentions "tasks" or "the task list".

- See the current tasks: run `mc list` (the `mc` command is already on your PATH).
- Start a task: `mc start <id>`  ·  finish: `mc done <id>`  ·  defer: `mc later <id>`
- Record progress / a blocker / a summary: `mc note <id> "..."`
- Add a task: `mc add "title"`

Full protocol is in `.mission-control/AGENTS.md`. Your `mc` changes appear in the Helm app within ~1s.
<!-- HELM:END -->
