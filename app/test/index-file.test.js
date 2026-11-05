import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIndexFile } from '../src/indexer.js';
import { INDEX_FORMAT } from '../src/index-format.js';

// readIndexFile() decides whether an index file on disk is served or
// rebuilt. Only a file of the current format is served: what an earlier
// version put into its index must not outlive the upgrade.
describe('readIndexFile()', () => {
  let dir;
  const write = (content) => writeFileSync(join(dir, 'wp-index-flex.json'), content);

  // The messages about a file that will be rebuilt are expected here.
  const { log, warn } = console;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'idx-file-'));
    console.log = () => {};
    console.warn = () => {};
  });
  after(() => {
    console.log = log;
    console.warn = warn;
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns null when there is no index file', async () => {
    assert.equal(await readIndexFile(dir), null);
  });

  test('returns the data of a file of the current format', async () => {
    const data = { format: INDEX_FORMAT, entries: [{ id: 1 }], flexIndex: {} };
    write(JSON.stringify(data));
    assert.deepEqual(await readIndexFile(dir), data);
  });

  test('returns null for a file without a format, as earlier versions wrote it', async () => {
    write(JSON.stringify({ entries: [{ id: 1 }], flexIndex: {} }));
    assert.equal(await readIndexFile(dir), null);
  });

  test('returns null for a file of another format', async () => {
    write(JSON.stringify({ format: INDEX_FORMAT + 1, entries: [], flexIndex: {} }));
    assert.equal(await readIndexFile(dir), null);
    write(JSON.stringify({ format: String(INDEX_FORMAT), entries: [], flexIndex: {} }));
    assert.equal(await readIndexFile(dir), null);
  });

  test('returns null for a file that is not valid JSON or lacks its parts', async () => {
    write('{"format": 2, "entries": [');
    assert.equal(await readIndexFile(dir), null);
    write(JSON.stringify({ format: INDEX_FORMAT, entries: 'none', flexIndex: {} }));
    assert.equal(await readIndexFile(dir), null);
    write(JSON.stringify({ format: INDEX_FORMAT, entries: [] }));
    assert.equal(await readIndexFile(dir), null);
    write('null');
    assert.equal(await readIndexFile(dir), null);
  });
});
