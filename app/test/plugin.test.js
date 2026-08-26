import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePluginVersion,
  parseReadmeFields,
  readPluginMeta,
} from '../src/plugin-meta.js';

const PLUGIN_HEADER = `<?php
/**
 * Plugin Name: WordPress IDX Search
 * Version: 2.4.7
 * Update URI: https://ioanalytica.com/wordpress-idx-search
 */

class WordpressIdxSearch {
	const VERSION = '2.4.7';
}
`;

const README = `=== WordPress IDX Search ===
Requires at least: 5.0
Tested up to: 7.1
Stable tag: 2.4.7
Requires PHP: 7.4
`;

describe('plugin header parsing', () => {
  test('reads the version from the plugin header', () => {
    assert.equal(parsePluginVersion(PLUGIN_HEADER), '2.4.7');
  });

  test('does not confuse the VERSION constant for the header', () => {
    const noHeader = "<?php\nclass X {\n\tconst VERSION = '9.9.9';\n}\n";
    assert.equal(parsePluginVersion(noHeader), null);
  });

  test('returns null for missing input', () => {
    assert.equal(parsePluginVersion(null), null);
  });
});

describe('readme parsing', () => {
  test('reads the WordPress compatibility fields', () => {
    assert.deepEqual(parseReadmeFields(README), {
      requires: '5.0',
      tested: '7.1',
      requires_php: '7.4',
    });
  });

  test('omits fields that are absent', () => {
    assert.deepEqual(parseReadmeFields('=== Plugin ===\n'), {});
  });
});

describe('readPluginMeta', () => {
  test('combines header and readme from a plugin directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-plugin-'));
    try {
      writeFileSync(join(dir, 'wordpress-idx-search.php'), PLUGIN_HEADER);
      writeFileSync(join(dir, 'readme.txt'), README);

      assert.deepEqual(readPluginMeta(dir), {
        version: '2.4.7',
        requires: '5.0',
        tested: '7.1',
        requires_php: '7.4',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports no version when the directory is missing', () => {
    assert.deepEqual(readPluginMeta('/nonexistent/plugin/dir'), { version: null });
  });
});

// The regression this guards: the manifest must describe the packaged plugin,
// not the service version. When they diverge, WordPress installs the package,
// re-reads the old header and offers the same update forever.
describe('shipped plugin matches the repo', () => {
  test('manifest version equals the real plugin header version', async () => {
    const { default: config } = await import('../src/config.js');
    const meta = readPluginMeta(config.pluginSrcPath);

    assert.equal(
      meta.version,
      config.version,
      'plugin header and package.json disagree — run scripts/sync-version.sh',
    );
    assert.ok(meta.tested, 'readme.txt must declare "Tested up to"');
  });
});
