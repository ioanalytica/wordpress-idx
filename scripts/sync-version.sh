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
LOCK="$ROOT/app/package-lock.json"
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

# The two root "version" fields of a lockfileVersion 3 file: the top-level one
# and packages."". They are the first two occurrences in the file; everything
# after them belongs to dependencies.
lock_versions() {
  grep -E '^[[:space:]]*"version":' "$LOCK" | head -2 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/'
}

# Print files whose version does not match, without modifying them.
drift() {
  local mismatch=0
  grep -qE "^ \* Version: ${VERSION}$"                "$PLUGIN_PHP" || { echo "  plugin header out of sync"; mismatch=1; }
  grep -qE "const VERSION = '${VERSION}';"            "$PLUGIN_PHP" || { echo "  plugin VERSION constant out of sync"; mismatch=1; }
  grep -qE "^Stable tag: ${VERSION}$"                 "$README"     || { echo "  readme Stable tag out of sync"; mismatch=1; }
  # npm ci does not validate the root version field, so drift here is silent.
  while read -r v; do
    [ "$v" = "$VERSION" ] || { echo "  app/package-lock.json out of sync (found ${v})"; mismatch=1; }
  done < <(lock_versions)
  return $mismatch
}

if [ "$CHECK" = "1" ]; then
  echo "Expected version (from app/package.json): $VERSION"
  if drift; then
    echo "Plugin version is in sync."
  else
    echo "ERROR: version is out of sync. Run scripts/sync-version.sh." >&2
    exit 1
  fi
  exit 0
fi

echo "Syncing version to $VERSION …"
sed_i "s/^ \* Version: .*/ * Version: ${VERSION}/"                 "$PLUGIN_PHP"
sed_i "s/const VERSION = '[^']*';/const VERSION = '${VERSION}';/"  "$PLUGIN_PHP"
sed_i "s/^Stable tag: .*/Stable tag: ${VERSION}/"                  "$README"

# Rewrite only the first two "version" lines — the lockfile's own root fields.
# npm would do this via `npm version`, but the script must also work without npm
# (e.g. in the CI job that only checks out the repo).
awk -v ver="$VERSION" '
  BEGIN { n = 0 }
  n < 2 && /^[[:space:]]*"version":[[:space:]]*"[^"]*",?[[:space:]]*$/ {
    sub(/"version":[[:space:]]*"[^"]*"/, "\"version\": \"" ver "\"")
    n++
  }
  { print }
' "$LOCK" > "$LOCK.tmp" && mv "$LOCK.tmp" "$LOCK"

echo "Done."
