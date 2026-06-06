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
  return path.join(os.homedir(), 'Documents', 'DocVault');
}

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

async function main(): Promise<void> {
  const vaultDir = resolveVaultDir();
  const dv = await DocVault.open(vaultDir);
  dv.startWatching();
  console.error(`[docvault-mcp] vault ready at ${vaultDir}`);

  const server = new McpServer({ name: 'docvault', version: '0.1.0' });

  server.registerTool(
    'list_products',
    { title: 'List products', description: 'List all products (top-level documentation areas).' },
    async () => json(await dv.listProducts()),
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
    async ({ product, tag }) => json(dv.listDocs({ product, tag })),
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search documents',
      description: 'Full-text search across all docs (incl. imported PDF/DOCX/TXT text). Returns ranked hits with snippets.',
      inputSchema: {
        query: z.string().describe('FTS5 query string'),
        product: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args) => json(dv.search(args)),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read document',
      description: 'Read a full document (frontmatter + markdown body) by id or vault-relative path.',
      inputSchema: { id_or_path: z.string().describe('Doc id (ULID) or path like docs/superchat/overview.md') },
    },
    async ({ id_or_path }) => json(await dv.readDoc(id_or_path)),
  );

  server.registerTool(
    'create_doc',
    {
      title: 'Create document',
      description: 'Create a new markdown doc under a product. Returns the created doc.',
      inputSchema: {
        product: z.string().describe('Product slug, e.g. "superchat"'),
        title: z.string(),
        content: z.string().optional().describe('Markdown body; defaults to a title heading'),
        tags: z.array(z.string()).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
      },
    },
    async (args) => json(await dv.createDoc(args)),
  );

  server.registerTool(
    'update_doc',
    {
      title: 'Update document',
      description: 'Update a doc body and/or selected frontmatter fields by vault-relative path.',
      inputSchema: {
        path: z.string().describe('Vault-relative path, e.g. docs/superchat/overview.md'),
        content: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
      },
    },
    async ({ path: relPath, ...patch }) => json(await dv.updateDoc(relPath, patch)),
  );

  server.registerTool(
    'delete_doc',
    {
      title: 'Delete document',
      description: 'Soft-delete a doc (moves it to trash) by vault-relative path.',
      inputSchema: { path: z.string() },
    },
    async ({ path: relPath }) => {
      await dv.trashDoc(relPath);
      return json({ trashed: relPath });
    },
  );

  server.registerTool(
    'get_backlinks',
    {
      title: 'Get backlinks',
      description: 'List docs that link to the given doc (by id).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => json(dv.backlinks(id)),
  );

  server.registerTool(
    'link_docs',
    {
      title: 'Link documents',
      description: 'Add an explicit outbound link from one doc to a target doc id.',
      inputSchema: {
        from_path: z.string().describe('Vault-relative path of the source doc'),
        target_id: z.string().describe('Doc id to link to'),
      },
    },
    async ({ from_path, target_id }) => {
      const doc = await dv.docs.read(from_path);
      const links = new Set(doc.frontmatter.links ?? []);
      links.add(target_id);
      doc.frontmatter.links = [...links];
      const saved = await dv.docs.write(doc);
      dv.index.upsert(saved);
      return json({ from: from_path, links: saved.frontmatter.links });
    },
  );

  server.registerTool(
    'list_tags',
    { title: 'List tags', description: 'List all tags with usage counts.' },
    async () => json(dv.listTags()),
  );

  server.registerTool(
    'import_file',
    {
      title: 'Import file',
      description: 'Import a .pdf, .docx, or .txt file: copies the original into the vault and creates a searchable markdown sidecar.',
      inputSchema: {
        path: z.string().describe('Absolute path to the source file on disk'),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ path: srcPath, tags }) => json(await dv.importFile(srcPath, tags ? { tags } : {})),
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create product',
      description: 'Create a new product (documentation area) with optional icon/color.',
      inputSchema: {
        slug: z.string().describe('URL-safe folder slug, e.g. "superchat"'),
        title: z.string(),
        icon: z.string().optional().describe('lucide icon name'),
        color: z.string().optional().describe('hex color, e.g. #7c3aed'),
      },
    },
    async ({ slug, title, icon, color }) =>
      json(await dv.createProduct(slug, { title, ...(icon ? { icon } : {}), ...(color ? { color } : {}) })),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[docvault-mcp] connected over stdio');
}

main().catch((err) => {
  console.error('[docvault-mcp] fatal:', err);
  process.exit(1);
});
