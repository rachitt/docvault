// electron-builder afterPack hook: flip Electron fuses to harden the packaged
// binary. Runs BEFORE code signing, so the (re)written binary is the one that
// gets signed. Disables the high-risk escape hatches that would otherwise let
// the shipped Electron be re-run as a general-purpose Node with full privileges.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;

  const ext = { darwin: '.app', win32: '.exe', linux: '' }[electronPlatformName] ?? '';
  const electronBinary =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName)
      : path.join(appOutDir, `${appName}${ext}`);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    // Block running the app binary as a bare Node process / inspector / NODE_OPTIONS.
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // Encrypt cookies at rest.
    [FuseV1Options.EnableCookieEncryption]: true,
    // NOTE: asar is intentionally disabled (the app spawns a system-node MCP
    // sidecar that reads plain files), so the asar-integrity fuses are N/A.
  });

  console.log(`[fuses] hardened ${path.basename(electronBinary)}`);
};
