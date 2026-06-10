import { app, BrowserWindow, dialog, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc.js';
import { checkForUpdates } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cleanup: (() => void) | null = null;
// IPC handlers + the MCP sidecar exist exactly once per app lifetime. On macOS
// the app keeps running with zero windows; a dock re-activate must only create
// a new BrowserWindow — re-registering IPC throws ("second handler") and would
// spawn a duplicate sidecar.
let ipcReady = false;

function resolveVaultDir(): string {
  if (process.env.DOCVAULT_DIR) return path.resolve(process.env.DOCVAULT_DIR);
  // Home root, NOT ~/Documents/DocVault — that collides with the repo on
  // case-insensitive macOS filesystems (Documents/docvault == Documents/DocVault).
  return path.join(os.homedir(), 'DocVault');
}

/** Create and load a BrowserWindow. Window-only: never touches IPC/sidecar. */
async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DocVault',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Never let renderer content navigate away from the app or spawn windows;
  // open any external link in the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const isDev = devUrl ? url.startsWith(devUrl) : false;
    if (!isDev && !url.startsWith('file://')) e.preventDefault();
  });

  win.webContents.on('did-finish-load', () => console.error('[docvault] renderer loaded'));
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[docvault] renderer gone:', d.reason),
  );
  win.webContents.on('console-message', (_e, _lvl, msg) =>
    console.error('[renderer]', msg),
  );

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(
  async () => {
    try {
      // IPC must be live before the first renderer load issues its calls.
      cleanup = await registerIpc(resolveVaultDir());
      ipcReady = true;
      await createWindow();
    } catch (err) {
      // e.g. no `node` on PATH so the MCP sidecar can't spawn — tell the user
      // instead of leaving a frozen blank window.
      dialog.showErrorBox(
        'DocVault failed to start',
        err instanceof Error ? err.message : String(err),
      );
      app.quit();
      return;
    }
    void checkForUpdates();
  },
  (err: unknown) => {
    console.error('[docvault] app failed to become ready:', err);
    app.quit();
  },
);

app.on('activate', () => {
  // macOS dock re-open: only make a window; IPC/sidecar are already running.
  if (ipcReady && BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err: unknown) => {
      dialog.showErrorBox(
        'DocVault failed to open a window',
        err instanceof Error ? err.message : String(err),
      );
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => cleanup?.());
