#!/usr/bin/env bash
#
# One-command rebuild → repackage → reinstall into /Applications.
#
# The running app is the /Applications copy, which does NOT pick up `pnpm dev`
# or `electron-vite build` output. Historically this meant a manual
# build → electron-builder → ditto dance after every change (see tasks/lessons.md).
# This script collapses that into `pnpm reinstall` and verifies each step.
#
# Usage:
#   pnpm --filter @docvault/desktop reinstall        # build, install, relaunch
#   pnpm --filter @docvault/desktop reinstall --no-launch
#   pnpm --filter @docvault/desktop reinstall --no-build   # reuse existing package
set -euo pipefail

cd "$(dirname "$0")/.."            # → packages/desktop
APP_NAME="DocVault"
DEST="/Applications/${APP_NAME}.app"

DO_BUILD=1
DO_LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-launch) DO_LAUNCH=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ "$DO_BUILD" -eq 1 ]; then
  echo "▸ Building renderer + main…"
  pnpm exec electron-vite build
  echo "▸ Packaging unsigned .app…"
  pnpm exec electron-builder --mac --dir
fi

# electron-builder names the dir by arch (mac-arm64 / mac); pick whatever exists.
SRC="$(ls -d dist-app/mac*/${APP_NAME}.app 2>/dev/null | head -1 || true)"
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "✗ Built app not found under dist-app/. Run without --no-build first." >&2
  exit 1
fi

# Quit the running copy so ditto can replace its files cleanly.
if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  echo "▸ Quitting running ${APP_NAME}…"
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.3
  done
fi

echo "▸ Installing → ${DEST}"
rm -rf "$DEST"
ditto "$SRC" "$DEST"

echo "✓ Installed $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo '') to ${DEST}"

if [ "$DO_LAUNCH" -eq 1 ]; then
  echo "▸ Relaunching…"
  open "$DEST"
fi
