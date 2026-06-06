#!/bin/sh
#
# Shared hook body: refresh /Applications/DocVault.app from the just-committed/
# merged code, in the background, so the canonical installed app stays current
# without blocking git or disrupting a running instance.
#
# - Runs detached (`&`) so `git commit` / `git merge` return immediately.
# - A lockfile debounces rapid commits and prevents overlapping packages.
# - `--no-launch --no-quit`: never steals focus, never kills a running app
#   (the bundle is refreshed in place; restart DocVault to pick up changes).
# - All output goes to /tmp/docvault-reinstall.log.
LOCK=/tmp/docvault-reinstall.lock
LOG=/tmp/docvault-reinstall.log
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Already queued/running — skip (a later commit will refresh anyway).
[ -e "$LOCK" ] && exit 0

(
  trap 'rm -f "$LOCK"' EXIT
  : > "$LOCK"
  {
    echo "=== reinstall $(date) @ $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) ==="
    cd "$REPO" || exit 0
    pnpm reinstall --no-launch --no-quit
  } >> "$LOG" 2>&1
) &

exit 0
