import { createRequire } from 'node:module';
import path from 'node:path';
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import chokidar from 'chokidar';
import { AiBridge } from './ai.js';
import { ConfigStore } from './config.js';
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
 * and no native-ABI rebuild. Config (starred/recent/etc.) is plain JSON handled
 * here directly; external file edits are surfaced via a lightweight watcher.
 */
export async function registerIpc(win: BrowserWindow, vaultDir: string): Promise<() => void> {
  const transport = new StdioClientTransport({
    command: resolveBin('node', [process.execPath.includes('node') ? process.execPath : '']),
    args: [resolveMcpServer(), '--vault', vaultDir],
    env: enhancedEnv() as Record<string, string>,
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
  h(CH.search, (opts: Record<string, unknown>) => call('search_docs', opts));
  h(CH.backlinks, (id: string) => call('get_backlinks', { id }));
  h(CH.listTags, () => call('list_tags'));

  // --- Config (plain JSON, no native dep) ---
  h(CH.getConfig, () => config.read());
  h(CH.updateConfig, (patch: Record<string, unknown>) => config.update(patch));
  h(CH.toggleStar, (id: string) => config.toggleStar(id));
  h(CH.pushRecent, (id: string) => config.pushRecent(id));

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
  h(CH.openOriginal, async (relPath: string) => {
    // Contain to the vault: a crafted relPath must not open arbitrary files.
    const root = path.resolve(vaultDir);
    const target = path.resolve(root, relPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes vault: ${relPath}`);
    }
    await shell.openPath(target);
  });

  // --- AI assistant ---
  ipcMain.handle(CH.aiAsk, (e, requestId: string, prompt: string) =>
    ai.ask(e.sender, requestId, prompt),
  );
  ipcMain.handle(CH.aiCancel, (_e, requestId: string) => ai.cancel(requestId));

  // --- Surface external edits (e.g. an agent writing files) to the UI ---
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = chokidar.watch(path.join(vaultDir, 'docs'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on('all', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send(EV.vaultChanged);
    }, 350);
  });

  return () => {
    void watcher.close();
    void client.close();
  };
}
