import { app } from 'electron';

/**
 * Auto-update check, wired to the GitHub `publish` target in
 * electron-builder.yml (which emits latest-mac.yml on `pnpm release`).
 *
 * Only runs for packaged builds — never in dev or for the unpacked `dir` build
 * used by `pnpm reinstall`. electron-updater is imported dynamically and any
 * failure (no published release yet, offline, unsigned build) is swallowed so a
 * missing update feed can never block startup.
 *
 * NOTE: macOS will only *apply* an update for a signed + notarized build
 * (Squirrel.Mac rejects unsigned updates). Until signing is set up this checks
 * for and logs updates but cannot install them.
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} } as never;
    autoUpdater.autoDownload = true;
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    log(`[docvault] update check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function log(msg: unknown): void {
  console.error(typeof msg === 'string' ? msg : String(msg));
}
