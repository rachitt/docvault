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
        'Full-text search across all docs (incl. imported PDF/DOCX/TXT text). Returns ranked hits with snippets.',
      inputSchema: {
        query: nonEmpty.describe('Search text (plain words; FTS operators are treated literally)'),
        product: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    tool((args) => dv.search(args)),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read document',
      description: 'Read a full document (frontmatter + markdown body) by id or vault-relative path.',
      inputSchema: {
        id_or_path: nonEmpty.describe('Doc id (ULID) or path like docs/superchat/overview.md'),
      },
    },
    tool(({ id_or_path }) => dv.readDoc(id_or_path)),
  );

  server.registerTool(
    'create_doc',
    {
      title: 'Create document',
      description: 'Create a new markdown doc under a product. Returns the created doc.',
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
      description: 'Update a doc body and/or selected frontmatter fields by vault-relative path.',
      inputSchema: {
        path: nonEmpty.describe('Vault-relative path, e.g. docs/superchat/overview.md'),
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
      inputSchema: { path: nonEmpty },
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
      inputSchema: { trash_path: nonEmpty.describe('The trashPath from list_trash') },
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
    'link_docs',
    {
      title: 'Link documents',
      description: 'Add an explicit outbound link from one doc to a target doc id.',
      inputSchema: {
        from_path: nonEmpty.describe('Vault-relative path of the source doc'),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[docvault-mcp] connected over stdio');
}

main().catch((err) => {
  console.error('[docvault-mcp] fatal:', err);
  process.exit(1);
});
