import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prepareIndex } from '../src/startup.js';

// What readIndex() resolves with: a loaded index, of which prepareIndex()
// looks at the number of entries.
const INDEX = { size: 1 };
const EMPTY = { size: 0 };

// Records what prepareIndex() does, with stand-ins for the file, the
// database and the clock.
function harness({ files = [], connect = [], build = [] } = {}) {
  const calls = [];
  const next = (list, fallback) => (list.length ? list.shift() : fallback);
  return {
    calls,
    deps: {
      readIndex: async () => {
        calls.push('read');
        return next(files, null);
      },
      testConnection: async () => {
        calls.push('connect');
        const err = next(connect, null);
        if (err) throw new Error(err);
      },
      buildIndex: async () => {
        calls.push('build');
        const err = next(build, null);
        if (err) throw new Error(err);
      },
      markAlive: () => calls.push('alive'),
      sleep: async (ms) => calls.push(`sleep ${ms}`),
      log: () => {},
    },
  };
}

describe('prepareIndex()', () => {
  test('loads an existing index without touching the database', async () => {
    const h = harness({ files: [INDEX] });
    assert.equal(await prepareIndex(h.deps), INDEX);
    assert.deepEqual(h.calls, ['read', 'alive']);
  });

  test('builds the index when there is no index file', async () => {
    const h = harness({ files: [null, INDEX] });
    assert.equal(await prepareIndex(h.deps), INDEX);
    assert.deepEqual(h.calls, ['read', 'connect', 'alive', 'build', 'read']);
  });

  test('FORCE_UPDATE rebuilds without reading the existing file first', async () => {
    const h = harness({ files: [INDEX] });
    assert.equal(await prepareIndex({ ...h.deps, forceUpdate: true }), INDEX);
    assert.deepEqual(h.calls, ['connect', 'alive', 'build', 'read']);
  });

  test('waits the startup delay only before a build', async () => {
    const building = harness({ files: [null, INDEX] });
    await prepareIndex({ ...building.deps, startupDelayMs: 30000 });
    assert.deepEqual(building.calls, ['read', 'sleep 30000', 'connect', 'alive', 'build', 'read']);

    const loading = harness({ files: [INDEX] });
    await prepareIndex({ ...loading.deps, startupDelayMs: 30000 });
    assert.deepEqual(loading.calls, ['read', 'alive']);
  });

  // WordPress has not created its tables yet: the connection works, the
  // extraction fails. The build is tried again until it succeeds.
  test('tries the build again until the tables are there', async () => {
    const h = harness({
      files: [null, INDEX],
      build: ["Table 'wp_posts' doesn't exist", "Table 'wp_posts' doesn't exist"],
    });
    assert.equal(await prepareIndex({ ...h.deps, retryDelayMs: 5000 }), INDEX);
    assert.deepEqual(h.calls, [
      'read',
      'connect', 'alive', 'build', 'sleep 5000',
      'connect', 'alive', 'build', 'sleep 5000',
      'connect', 'alive', 'build', 'read',
    ]);
  });

  // The database is not up yet: nothing to live for until it answers.
  test('tries again while the database cannot be reached, and is not alive until it can', async () => {
    const h = harness({ files: [null, INDEX], connect: ['connect ECONNREFUSED', 'connect ECONNREFUSED'] });
    assert.equal(await prepareIndex({ ...h.deps, retryDelayMs: 5000 }), INDEX);
    assert.deepEqual(h.calls, [
      'read',
      'connect', 'sleep 5000',
      'connect', 'sleep 5000',
      'connect', 'alive', 'build', 'read',
    ]);
  });

  // WordPress creates its tables a moment before it fills them.
  test('builds an empty index a second time before it accepts it', async () => {
    const filled = harness({ files: [null, EMPTY, INDEX] });
    assert.equal(await prepareIndex({ ...filled.deps, retryDelayMs: 5000 }), INDEX);
    assert.deepEqual(filled.calls, [
      'read',
      'connect', 'alive', 'build', 'read', 'sleep 5000',
      'connect', 'alive', 'build', 'read',
    ]);

    // A site without a public post or page: empty both times, then served.
    const empty = harness({ files: [null, EMPTY, EMPTY] });
    assert.equal(await prepareIndex({ ...empty.deps, retryDelayMs: 5000 }), EMPTY);
    assert.deepEqual(empty.calls, [
      'read',
      'connect', 'alive', 'build', 'read', 'sleep 5000',
      'connect', 'alive', 'build', 'read',
    ]);
  });

  // The first, empty build is in the file already when the pause begins. A
  // start that finds such a file does not take it for an index.
  test('builds again when the index file has no entries', async () => {
    const h = harness({ files: [EMPTY, INDEX] });
    assert.equal(await prepareIndex(h.deps), INDEX);
    assert.deepEqual(h.calls, ['read', 'connect', 'alive', 'build', 'read']);
  });

  test('tries again when the file it has just written cannot be loaded', async () => {
    const h = harness({ files: [null, null, INDEX] });
    assert.equal(await prepareIndex({ ...h.deps, retryDelayMs: 5000 }), INDEX);
    assert.deepEqual(h.calls, [
      'read',
      'connect', 'alive', 'build', 'read', 'sleep 5000',
      'connect', 'alive', 'build', 'read',
    ]);
  });
});
