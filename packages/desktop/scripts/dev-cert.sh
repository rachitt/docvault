#!/usr/bin/env bash
#
# Create a STABLE self-signed code-signing identity for local DocVault builds.
#
# Why: the app encrypts cookies via the macOS Keychain (EnableCookieEncryption
# fuse, see build/fuses.cjs). macOS ties that Keychain grant to the app's code
# signature. Default local builds are *ad-hoc* signed (identity: null), whose
# fingerprint changes on every rebuild — so macOS re-prompts "DocVault wants to
# use your confidential information…" on every launch after a reinstall.
#
# Signing each build with one fixed self-signed cert keeps the signature stable,
# so a single "Always Allow" sticks. reinstall.sh picks this identity up
# automatically once it exists.
#
# Run ONCE:  bash scripts/dev-cert.sh
# (You'll be asked for your login-keychain password — this touches your keychain.)
set -euo pipefail

CN="DocVault Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CN"; then
  echo "✓ Code-signing identity '$CN' already exists — nothing to do."
  echo "  Next: pnpm --filter @docvault/desktop reinstall"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ Generating self-signed code-signing certificate '$CN' (valid 10 years)…"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 \
  -subj "/CN=$CN" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/identity.p12" -name "$CN" -passout pass:docvault >/dev/null 2>&1

echo "▸ Importing into the login keychain (allowing codesign to use it)…"
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P docvault \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

echo "▸ Authorizing codesign to use the key without prompting…"
echo "  (enter your login-keychain password if asked)"
security set-key-partition-list -S apple-tool:,apple:,codesign: "$KEYCHAIN" >/dev/null 2>&1 \
  || echo "  ⚠ couldn't set partition list — codesign may prompt once; click 'Always Allow'."

echo
echo "✓ Created code-signing identity '$CN'."
echo "  Next: pnpm --filter @docvault/desktop reinstall"
echo "  On first launch click 'Always Allow' on the keychain prompt — it'll stick from then on."
