#!/bin/bash
#
# Sync the plugin version to the single source of truth (app/package.json).
#
#   scripts/sync-version.sh          # rewrite plugin files to match package.json
#   scripts/sync-version.sh --check  # exit non-zero if anything is out of sync (CI)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/app/package.json"
PLUGIN_PHP="$ROOT/plugin/wordpress-idx-search/wordpress-idx-search.php"
README="$ROOT/plugin/wordpress-idx-search/readme.txt"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# SSOT: version from app/package.json
VERSION="$(
  grep -m1 -E '"version"[[:space:]]*:' "$PKG" \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  | tr -d '\r'
)"

if [ -z "${VERSION:-}" ]; then
  echo "ERROR: could not read version from $PKG" >&2
  exit 1
fi

# in-place sed that works on both GNU and BSD/macOS sed
sed_i() {
  if sed --version >/dev/null 2>&1; then
    sed -i -E "$1" "$2"
  else
    sed -i '' -E "$1" "$2"
  fi
}

# Print files whose version does not match, without modifying them.
drift() {
  local mismatch=0
  grep -qE "^ \* Version: ${VERSION}$"                "$PLUGIN_PHP" || { echo "  plugin header out of sync"; mismatch=1; }
  grep -qE "const VERSION = '${VERSION}';"            "$PLUGIN_PHP" || { echo "  plugin VERSION constant out of sync"; mismatch=1; }
  grep -qE "^Stable tag: ${VERSION}$"                 "$README"     || { echo "  readme Stable tag out of sync"; mismatch=1; }
  return $mismatch
}

if [ "$CHECK" = "1" ]; then
  echo "Expected version (from app/package.json): $VERSION"
  if drift; then
    echo "Plugin version is in sync."
  else
    echo "ERROR: plugin version is out of sync. Run scripts/sync-version.sh." >&2
    exit 1
  fi
  exit 0
fi

echo "Syncing plugin version to $VERSION …"
sed_i "s/^ \* Version: .*/ * Version: ${VERSION}/"                 "$PLUGIN_PHP"
sed_i "s/const VERSION = '[^']*';/const VERSION = '${VERSION}';/"  "$PLUGIN_PHP"
sed_i "s/^Stable tag: .*/Stable tag: ${VERSION}/"                  "$README"
echo "Done."
