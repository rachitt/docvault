import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import chokidar from 'chokidar';
import type { Doc, DocMeta } from '@docvault/core';
import { AiBridge } from './ai.js';
import { ConfigStore } from './config.js';
import {
  EXPORT_EXT,
  exportCombinedPdf,
  exportDocToFile,
  exportDocsToFolder,
  fileSlug,
  type ExportFormat,
} from './export/index.js';
import { enhancedEnv, resolveBin } from './shell-env.js';
import { CH, EV } from '../shared/ipc.js';

const require = createRequire(import.meta.url);

function resolveMcpServer(): string {
  if (process.env.DOCVAULT_MCP_PATH) return process.env.DOCVAULT_MCP_PATH;
  return require.resolve('@docvault/mcp-server');
}

/**
 * Wires the renderer to a DocVault MCP server running as a system-node sidecar.
 * Electron itself never loads the native SQLite module — it speaks to the same
 * MCP server that Claude Code / Codex use, so there is a single source of truth
 * and no native-ABI rebuild. Config reads are plain JSON handled here directly;
 * config mutations also go through the sidecar (single serialized writer);
 * external file edits are surfaced via a lightweight watcher.
 */
export async function registerIpc(win: BrowserWindow, vaultDir: string): Promise<() => void> {
  // The MCP server loads a native SQLite module compiled for the system Node
  // ABI, so it must run under a real `node` — never under Electron's runtime
  // (whose ABI differs). `process.execPath` is only a usable node when we are
  // NOT inside Electron; under Electron it is the Electron binary (and its path
  // contains "node_modules", which is why a substring check is unsafe). So
  // reuse execPath only outside Electron, otherwise resolve node from PATH.
  // Also drop ELECTRON_RUN_AS_NODE so a `node` that happens to be Electron does
  // not inherit Electron's ABI.
  const nodeBin = resolveBin('node', [process.versions.electron ? '' : process.execPath]);
  const { ELECTRON_RUN_AS_NODE: _drop, ...childEnv } = enhancedEnv();
  const transport = new StdioClientTransport({
    command: nodeBin,
    args: [resolveMcpServer(), '--vault', vaultDir],
    env: childEnv as Record<string, string>,
  });
  const client = new Client({ name: 'docvault-desktop', version: '0.1.0' });
  await client.connect(transport);

  /** Call an MCP tool and parse its JSON text payload. */
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    const text = res.content?.[0]?.text ?? 'null';
    // Tool errors come back as a result with isError + a plain-text message
    // (not JSON), so surface the real message instead of a JSON parse error.
    if (res.isError) throw new Error(text);
    return JSON.parse(text) as T;
  };

  const config = new ConfigStore(vaultDir);
  const ai = new AiBridge();

  const h = <T extends unknown[], R>(channel: string, fn: (...args: T) => R | Promise<R>) =>
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as T)));

  // --- Doc/index operations → MCP sidecar ---
  h(CH.listProducts, () => call('list_products'));
  h(CH.createProduct, (slug: string, meta: { title: string; icon?: string; color?: string }) =>
    call('create_product', { slug, ...meta }),
  );
  h(CH.listDocs, (opts?: { product?: string; tag?: string }) => call('list_docs', opts ?? {}));
  h(CH.readDoc, (idOrPath: string) => call('read_doc', { id_or_path: idOrPath }));
  h(CH.createDoc, (input: Record<string, unknown>) => call('create_doc', input));
  h(CH.updateDoc, (relPath: string, patch: Record<string, unknown>) =>
    call('update_doc', { path: relPath, ...patch }),
  );
  h(CH.trashDoc, (relPath: string) => call('delete_doc', { path: relPath }));
  h(CH.deleteProduct, (slug: string) => call('delete_product', { slug }));
  h(CH.listTrash, () => call('list_trash'));
  h(CH.restoreTrash, (trashPath: string) => call('restore_trash', { trash_path: trashPath }));
  h(CH.search, (opts: Record<string, unknown>) => call('search_docs', opts));
  h(CH.relatedDocs, (id: string, limit?: number) =>
    call('related_docs', { id, ...(limit ? { limit } : {}) }),
  );
  h(CH.embeddingStatus, () => call('embedding_status'));
  h(CH.backfillEmbeddings, () => call('backfill_embeddings'));
  h(CH.backlinks, (id: string) => call('get_backlinks', { id }));
  h(CH.listTags, () => call('list_tags'));

  // --- Templates → MCP sidecar ---
  h(CH.listTemplates, () => call('list_templates'));
  h(CH.createDocFromTemplate, (args: Record<string, unknown>) =>
    call('create_doc_from_template', args),
  );
  h(CH.saveAsTemplate, (idOrPath: string, name: string) =>
    call('save_as_template', { id_or_path: idOrPath, name }),
  );

  // --- Config ---
  // Reads stay local (plain JSON, race-safe, works before the sidecar is up),
  // but mutations go through the MCP sidecar: core serializes config writes
  // in-process, so routing every writer through it stops a stale desktop
  // read-modify-write from clobbering sidecar updates (e.g. new trash entries).
  h(CH.getConfig, () => config.read());
  h(CH.updateConfig, (patch: Record<string, unknown>) => call('update_config', patch));
  h(CH.toggleStar, (id: string) => call('toggle_star', { id }));
  h(CH.pushRecent, (id: string) => call('push_recent', { id }));

  // --- Local OS actions ---
  h(CH.importFile, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import a document',
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return call('import_file', { path: res.filePaths[0] });
  });
  // --- Export (HTML / PDF / DOCX) ---
  h(CH.exportDoc, async (idOrPath: string, format: ExportFormat) => {
    const doc = await call<Doc>('read_doc', { id_or_path: idOrPath });
    const res = await dialog.showSaveDialog(win, {
      title: 'Export document',
      defaultPath: `${fileSlug(doc.frontmatter.title)}.${EXPORT_EXT[format]}`,
      filters: [{ name: format.toUpperCase(), extensions: [EXPORT_EXT[format]] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true as const };
    await exportDocToFile(doc, format, res.filePath, { vaultDir });
    shell.showItemInFolder(res.filePath);
    return { canceled: false as const, path: res.filePath };
  });
  h(
    CH.exportBulk,
    async (opts: { product?: string; format: ExportFormat; combined?: boolean }) => {
      const metas = await call<DocMeta[]>('list_docs', opts.product ? { product: opts.product } : {});
      const docs: Doc[] = [];
      for (const m of metas) docs.push(await call<Doc>('read_doc', { id_or_path: m.id }));
      if (docs.length === 0) return { canceled: true as const };
      const label = opts.product ?? 'vault';
      const onProgress = (p: unknown): void => {
        if (!win.isDestroyed()) win.webContents.send(EV.exportProgress, p);
      };

      if (opts.combined && opts.format === 'pdf') {
        const res = await dialog.showSaveDialog(win, {
          title: 'Export combined PDF',
          defaultPath: `${fileSlug(label)}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (res.canceled || !res.filePath) return { canceled: true as const };
        await exportCombinedPdf(docs, res.filePath, { vaultDir }, onProgress);
        shell.showItemInFolder(res.filePath);
        return { canceled: false as const, path: res.filePath, count: docs.length };
      }

      const res = await dialog.showOpenDialog(win, {
        title: 'Choose a folder to export into',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
      const outDir = path.join(res.filePaths[0], `${fileSlug(label)}-export`);
      const written = await exportDocsToFolder(docs, opts.format, outDir, { vaultDir }, onProgress);
      shell.showItemInFolder(written[0] ?? outDir);
      return { canceled: false as const, path: outDir, count: written.length };
    },
  );

  // Resolve a vault-relative path to an absolute one, refusing anything that
  // escapes the vault root (a crafted relPath must not reach arbitrary files).
  const resolveInVault = (relPath: string): string => {
    const root = path.resolve(vaultDir);
    const target = path.resolve(root, relPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes vault: ${relPath}`);
    }
    return target;
  };
  h(CH.openOriginal, async (relPath: string) => {
    await shell.openPath(resolveInVault(relPath));
  });
  h(CH.readSource, async (relPath: string) => {
    const buf = await readFile(resolveInVault(relPath));
    // Return a plain Uint8Array view so it crosses IPC via structured clone.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // --- AI assistant ---
  ipcMain.handle(CH.aiAsk, (e, requestId: string, prompt: string) =>
    ai.ask(e.sender, requestId, prompt),
  );
  ipcMain.handle(CH.aiCancel, (_e, requestId: string) => ai.cancel(requestId));

  // --- Surface external edits (e.g. an agent writing files) to the UI ---
  // Carry the set of changed vault-relative paths so the renderer can tell
  // whether the *open* doc changed and reconcile it instead of clobbering.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const changed = new Set<string>();
  const root = path.resolve(vaultDir);
  const watcher = chokidar.watch([path.join(vaultDir, 'docs'), path.join(vaultDir, 'assets')], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on('all', (_event, changedPath) => {
    if (changedPath) changed.add(path.relative(root, changedPath));
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const paths = [...changed];
      changed.clear();
      if (!win.isDestroyed()) win.webContents.send(EV.vaultChanged, paths);
    }, 350);
  });
  // Without an 'error' listener a watcher error (e.g. EMFILE) would throw on
  // the EventEmitter and crash the main process; log it and keep running.
  watcher.on('error', (err) => {
    console.error('[docvault] vault watcher error:', err);
  });

  return () => {
    void watcher.close();
    void client.close();
  };
}
