#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DocVault } from '@docvault/core';
import { z } from 'zod';

/** Resolve the vault directory from --vault <dir>, $DOCVAULT_DIR, or the default. */
function resolveVaultDir(): string {
  const argv = process.argv.slice(2);
  const flag = argv.indexOf('--vault');
  if (flag !== -1 && argv[flag + 1]) return path.resolve(argv[flag + 1]!);
  if (process.env.DOCVAULT_DIR) return path.resolve(process.env.DOCVAULT_DIR);
  // Home root, NOT ~/Documents/DocVault — that collides with the repo on
  // case-insensitive macOS filesystems (Documents/docvault == Documents/DocVault).
  return path.join(os.homedir(), 'DocVault');
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const fail = (err: unknown): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
});

/**
 * Wrap a tool handler so any thrown error (missing file, bad path, FTS error,
 * unsupported import type, …) becomes a structured `isError` result instead of
 * crashing the request with an opaque internal error.
 */
function tool<A>(fn: (args: A) => unknown | Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      console.error('[docvault-mcp] tool error:', err);
      return fail(err);
    }
  };
}

const nonEmpty = z.string().min(1);
const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'must be a URL-safe slug (letters, digits, . _ -)');
const statusEnum = z.enum(['draft', 'published', 'archived']);

/**
 * A vault-relative path (or a bare doc id). Rejects absolute paths, `..`
 * segments, and NUL bytes up front so a malformed input fails with a clear
 * message; `vault.abs()` in core remains the authoritative containment gate.
 */
const relPath = nonEmpty
  .refine((p) => !p.includes('\0'), 'must not contain NUL bytes')
  .refine(
    (p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'),
    'must be a vault-relative path (no leading slash or ".." segments)',
  );

async function main(): Promise<void> {
  const vaultDir = resolveVaultDir();
  const dv = await DocVault.open(vaultDir);
  dv.startWatching();
  console.error(`[docvault-mcp] vault ready at ${vaultDir}`);

  const server = new McpServer({ name: 'docvault', version: '0.1.0' });

  server.registerTool(
    'list_products',
    { title: 'List products', description: 'List all products (top-level documentation areas).' },
    tool(() => dv.listProducts()),
  );

  server.registerTool(
    'list_docs',
    {
      title: 'List documents',
      description: 'List document metadata, optionally filtered by product and/or tag.',
      inputSchema: {
        product: z.string().optional().describe('Product slug to filter by'),
        tag: z.string().optional().describe('Tag to filter by'),
      },
    },
    tool(({ product, tag }) => dv.listDocs({ product, tag })),
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search documents',
      description:
        'Search across all docs (incl. imported PDF/DOCX/TXT text). `mode` selects how: ' +
        '"fts" = exact full-text (bm25, highlighted snippets); ' +
        '"semantic" = meaning-based vector search (finds paraphrases, returns the best passage); ' +
        '"hybrid" (default) = Reciprocal Rank Fusion of both, the best general choice. ' +
        'Semantic/hybrid run a local embedding model on first use (one-time model download).',
      inputSchema: {
        query: nonEmpty.describe('Search text. In "fts" mode, FTS operators are treated literally.'),
        mode: z
          .enum(['fts', 'semantic', 'hybrid'])
          .optional()
          .describe('Search strategy; defaults to "hybrid".'),
        product: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    tool(({ query, mode = 'hybrid', product, tag, limit }) => {
      const filter = {
        ...(product ? { product } : {}),
        ...(tag ? { tag } : {}),
      };
      if (mode === 'fts') {
        return dv.search({ query, ...filter, ...(limit ? { limit } : {}) });
      }
      const k = limit ?? 25;
      return mode === 'semantic'
        ? dv.searchSemantic(query, { k, ...filter })
        : dv.searchHybrid(query, { k, ...filter });
    }),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read document',
      description: 'Read a full document (frontmatter + markdown body) by id or vault-relative path.',
      inputSchema: {
        id_or_path: relPath.describe('Doc id (ULID) or path like docs/superchat/overview.md'),
      },
    },
    tool(({ id_or_path }) => dv.readDoc(id_or_path)),
  );

  server.registerTool(
    'create_doc',
    {
      title: 'Create document',
      description:
        'Create a new markdown doc under a product. Returns the created doc. To include a diagram, embed Mermaid in a ```mermaid fenced block in `content` — use list_diagram_templates / get_diagram_template for curated starting points and validate_diagram to check syntax first (or use create_diagram).',
      inputSchema: {
        product: slug.describe('Product slug, e.g. "superchat"'),
        title: nonEmpty,
        content: z.string().optional().describe('Markdown body; defaults to a title heading'),
        tags: z.array(z.string()).optional(),
        status: statusEnum.optional(),
      },
    },
    tool((args) => dv.createDoc(args)),
  );

  server.registerTool(
    'update_doc',
    {
      title: 'Update document',
      description:
        'Update a doc body and/or selected frontmatter fields by vault-relative path. To add or change a diagram, embed Mermaid in a ```mermaid fenced block in `content` (see list_diagram_templates / validate_diagram), or use create_diagram to append one.',
      inputSchema: {
        path: relPath.describe('Vault-relative path, e.g. docs/superchat/overview.md'),
        content: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: statusEnum.optional(),
      },
    },
    tool(({ path: relPath, ...patch }) => dv.updateDoc(relPath, patch)),
  );

  server.registerTool(
    'delete_doc',
    {
      title: 'Delete document',
      description: 'Soft-delete a doc (moves it to trash) by vault-relative path.',
      inputSchema: { path: relPath },
    },
    tool(async ({ path: relPath }) => {
      await dv.trashDoc(relPath);
      return { trashed: relPath };
    }),
  );

  server.registerTool(
    'delete_product',
    {
      title: 'Delete product',
      description:
        'Soft-delete a product and all its docs (moves the docs/<slug> folder to trash). Recoverable until auto-purged.',
      inputSchema: { slug },
    },
    tool(async ({ slug: productSlug }) => {
      await dv.deleteProduct(productSlug);
      return { trashed: `docs/${productSlug}` };
    }),
  );

  server.registerTool(
    'list_trash',
    {
      title: 'List trash',
      description: 'List soft-deleted docs and products that can still be restored.',
      inputSchema: {},
    },
    tool(() => dv.listTrash()),
  );

  server.registerTool(
    'restore_trash',
    {
      title: 'Restore from trash',
      description: 'Restore a trashed doc or product back to its original location by trash path.',
      inputSchema: { trash_path: relPath.describe('The trashPath from list_trash') },
    },
    tool(async ({ trash_path }) => {
      await dv.restoreTrash(trash_path);
      return { restored: trash_path };
    }),
  );

  server.registerTool(
    'get_backlinks',
    {
      title: 'Get backlinks',
      description: 'List docs that link to the given doc (by id).',
      inputSchema: { id: nonEmpty },
    },
    tool(({ id }) => dv.backlinks(id)),
  );

  server.registerTool(
    'related_docs',
    {
      title: 'Related documents',
      description:
        'Find documents semantically related to an already-indexed doc (nearest neighbours by ' +
        'meaning, using its stored passage embeddings — no re-embedding). Returns each related ' +
        "doc's best matching passage, heading breadcrumb, and similarity score. Empty if the doc " +
        'has not been embedded yet (semantic indexing disabled or still backfilling).',
      inputSchema: {
        id: nonEmpty.describe('Doc id (ULID) of the open/source doc'),
        limit: z.number().int().positive().max(50).optional().describe('Max neighbours (default 8)'),
      },
    },
    tool(({ id, limit }) => dv.relatedDocs(id, limit ? { k: limit } : {})),
  );

  server.registerTool(
    'embedding_status',
    {
      title: 'Embedding status',
      description:
        'Snapshot of semantic-index progress: how many indexed docs still lack passage embeddings ' +
        '(`pending`) out of `total`, plus how many embedding jobs are in flight. Cheap to poll for ' +
        'a backfill progress indicator. `error` carries (and clears) the last embedding failure, ' +
        'e.g. the first-run local model download failing offline.',
    },
    tool(() => {
      const err = dv.takeEmbedError();
      return {
        ...dv.embeddingStatus(),
        error: err ? (err instanceof Error ? err.message : String(err)) : null,
      };
    }),
  );

  server.registerTool(
    'backfill_embeddings',
    {
      title: 'Backfill embeddings',
      description:
        'Embed every indexed doc that currently lacks passage embeddings (e.g. after enabling ' +
        'semantic search, or after a reindex). Runs the local embedding model; the first run ' +
        'downloads it. Returns the number of docs processed. Poll embedding_status for progress.',
    },
    tool(async () => {
      const processed = await dv.backfillEmbeddings();
      return { processed, ...dv.embeddingStatus() };
    }),
  );

  server.registerTool(
    'link_docs',
    {
      title: 'Link documents',
      description: 'Add an explicit outbound link from one doc to a target doc id.',
      inputSchema: {
        from_path: relPath.describe('Vault-relative path of the source doc'),
        target_id: nonEmpty.describe('Doc id to link to'),
      },
    },
    tool(async ({ from_path, target_id }) => {
      const saved = await dv.linkDocs(from_path, target_id);
      return { from: from_path, links: saved.frontmatter.links };
    }),
  );

  server.registerTool(
    'list_tags',
    { title: 'List tags', description: 'List all tags with usage counts.' },
    tool(() => dv.listTags()),
  );

  server.registerTool(
    'import_file',
    {
      title: 'Import file',
      description:
        'Import a .pdf, .docx, or .txt file: copies the original into the vault and creates a searchable markdown sidecar.',
      inputSchema: {
        path: nonEmpty.describe('Absolute path to the source file on disk'),
        tags: z.array(z.string()).optional(),
      },
    },
    tool(({ path: srcPath, tags }) => dv.importFile(srcPath, tags ? { tags } : {})),
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create product',
      description: 'Create a new product (documentation area) with optional icon/color.',
      inputSchema: {
        slug: slug.describe('URL-safe folder slug, e.g. "superchat"'),
        title: nonEmpty,
        icon: z.string().optional().describe('lucide icon name'),
        color: z.string().optional().describe('hex color, e.g. #7c3aed'),
      },
    },
    tool(({ slug: s, title, icon, color }) =>
      dv.createProduct(s, { title, ...(icon ? { icon } : {}), ...(color ? { color } : {}) }),
    ),
  );

  // --- Diagrams ----------------------------------------------------------

  server.registerTool(
    'list_diagram_templates',
    {
      title: 'List diagram templates',
      description:
        'List curated Mermaid diagram templates (id, label, description, type) for flowcharts, mindmaps, sequence, class, state, ER, timeline, gantt, C4, and pie diagrams. Fetch a template body with get_diagram_template, then embed it in a ```mermaid block (or pass its id to create_diagram).',
    },
    tool(() => dv.listDiagramTemplates().map(({ source: _source, ...meta }) => meta)),
  );

  server.registerTool(
    'get_diagram_template',
    {
      title: 'Get diagram template',
      description: 'Get a single Mermaid diagram template, including its source, by id.',
      inputSchema: { id: nonEmpty.describe('Template id from list_diagram_templates') },
    },
    tool(({ id }) => {
      const tpl = dv.getDiagramTemplate(id);
      if (!tpl) throw new Error(`Unknown diagram template: ${id}`);
      return tpl;
    }),
  );

  server.registerTool(
    'validate_diagram',
    {
      title: 'Validate diagram',
      description:
        'Structurally lint Mermaid source before saving it into a doc. Catches empty diagrams, unrecognized diagram types, and unbalanced brackets/quotes, and returns the detected type plus any issues. Lightweight check only — final rendering is verified in the DocVault app.',
      inputSchema: { code: nonEmpty.describe('Mermaid source (no fences)') },
    },
    tool(({ code }) => dv.validateDiagram(code)),
  );

  server.registerTool(
    'create_diagram',
    {
      title: 'Create diagram',
      description:
        'Create a Mermaid diagram as a ```mermaid fenced block — either as a new doc (pass `product` + `title`) or appended to an existing doc (pass `path`). Provide `code` or a `template_id`. The source is validated first; lint errors are rejected.',
      inputSchema: {
        code: z.string().optional().describe('Mermaid source (no fences). Required unless template_id is given.'),
        template_id: z.string().optional().describe('Template id (from list_diagram_templates) to use when code is omitted'),
        heading: z.string().optional().describe('Optional "## heading" placed above the diagram'),
        path: relPath.optional().describe('Append to this existing doc (vault-relative path) instead of creating one'),
        product: slug.optional().describe('Product slug for a new doc (required unless path is given)'),
        title: z.string().optional().describe('Title for a new doc (required unless path is given)'),
        tags: z.array(z.string()).optional(),
        status: statusEnum.optional(),
      },
    },
    tool(({ template_id, ...rest }) =>
      dv.createDiagram({ ...rest, ...(template_id ? { templateId: template_id } : {}) }),
    ),
  );

  // --- Templates ---------------------------------------------------------

  // Seed the starter templates on startup so list_templates is useful out of the
  // box. Never overwrites a user-edited file.
  await dv.seedStarterTemplates().catch((err) => {
    console.error('[docvault-mcp] template seed failed:', err);
  });

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description:
        'List document templates from the vault templates/ folder (Meeting Notes, PRD, Runbook, ADR, Spec, plus any you save). Returns each template id, title, description, and the {{variables}} it declares. Instantiate one with create_doc_from_template.',
    },
    tool(() => dv.listTemplates()),
  );

  server.registerTool(
    'create_doc_from_template',
    {
      title: 'Create doc from template',
      description:
        'Create a new doc by rendering a template: fills {{title}}, {{date}}, {{author}}, and any custom {{vars}}, then creates the doc under a product (indexed + searchable like any other). Use list_templates to see available templates and their variables. Unfilled placeholders render as blank.',
      inputSchema: {
        template_id: slug.describe('Template id from list_templates, e.g. "meeting-notes"'),
        product: slug.describe('Product slug the new doc lands under'),
        title: nonEmpty.describe('Title for the new doc (also fills {{title}})'),
        author: z.string().optional().describe('Fills the {{author}} placeholder'),
        date: z.string().optional().describe('Fills {{date}}; defaults to today (YYYY-MM-DD)'),
        vars: z
          .record(z.string())
          .optional()
          .describe('Custom {{variable}} values, keyed by name'),
        tags: z.array(z.string()).optional(),
        status: statusEnum.optional(),
      },
    },
    tool(({ template_id, ...rest }) => dv.createDocFromTemplate(template_id, rest)),
  );

  server.registerTool(
    'save_as_template',
    {
      title: 'Save doc as template',
      description:
        "Persist an existing doc's body verbatim as a new reusable template under templates/ (any {{placeholders}} already present are preserved). The template id is derived from `name`. Returns the saved template.",
      inputSchema: {
        id_or_path: relPath.describe('Doc id (ULID) or vault-relative path of the source doc'),
        name: nonEmpty.describe('Human-readable template name; the id is slugified from this'),
      },
    },
    tool(({ id_or_path, name }) => dv.saveAsTemplate(id_or_path, { name })),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[docvault-mcp] connected over stdio');
}

main().catch((err) => {
  console.error('[docvault-mcp] fatal:', err);
  process.exit(1);
});
