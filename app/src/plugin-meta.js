import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reads the plugin's own header and readme so the update manifest describes
// exactly the build that /plugin/wordpress-idx-search.zip contains.
//
// Deriving the advertised version from anywhere else (app/package.json, say)
// lets it drift from the packaged one, and that drift is self-perpetuating:
// WordPress offers the update, installs the package, still finds the old
// version in the header, and offers the very same update again forever.

const VERSION_HEADER = /^[\s*]*Version:[ \t]*(.+)$/im;

const README_FIELDS = {
  requires: /^Requires at least:[ \t]*(.+)$/im,
  tested: /^Tested up to:[ \t]*(.+)$/im,
  requires_php: /^Requires PHP:[ \t]*(.+)$/im,
};

/** Version from the plugin file's "Version:" header, or null. */
export function parsePluginVersion(php) {
  const match = typeof php === 'string' ? php.match(VERSION_HEADER) : null;
  return match ? match[1].trim() : null;
}

/** WordPress compatibility fields from readme.txt; missing ones are omitted. */
export function parseReadmeFields(readme) {
  const fields = {};
  if (typeof readme !== 'string') return fields;

  for (const [key, pattern] of Object.entries(README_FIELDS)) {
    const match = readme.match(pattern);
    if (match) fields[key] = match[1].trim();
  }
  return fields;
}

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

/**
 * Plugin metadata read from `dir` (the tree that was zipped into the image).
 * Returns { version: null } when the files are not present.
 */
export function readPluginMeta(dir) {
  if (!dir || !existsSync(dir)) {
    return { version: null };
  }

  const php = readIfPresent(join(dir, 'wordpress-idx-search.php'));
  const readme = readIfPresent(join(dir, 'readme.txt'));

  return {
    version: parsePluginVersion(php),
    ...parseReadmeFields(readme),
  };
}
