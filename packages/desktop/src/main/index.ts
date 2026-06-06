import { app, BrowserWindow, shell } from 'electron';
let cleanup: (() => void) | null = null;
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveVaultDir(): string {
  if (process.env.DOCVAULT_DIR) return path.resolve(process.env.DOCVAULT_DIR);
  // Home root, NOT ~/Documents/DocVault — that collides with the repo on
  // case-insensitive macOS filesystems (Documents/docvault == Documents/DocVault).
  return path.join(os.homedir(), 'DocVault');
}

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

  cleanup = await registerIpc(win, resolveVaultDir());

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

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => cleanup?.());
