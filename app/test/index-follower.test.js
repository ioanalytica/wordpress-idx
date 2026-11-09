import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { INDEX_FILE } from '../src/index-format.js';
import { IndexWriter } from '../src/index-writer.js';
import { IndexFileError, loadIndexFile } from '../src/search-index.js';
import { createIndexFollower } from '../src/index-follower.js';
import { SAMPLE_ENTRIES } from './helpers.js';

// Two sidecars on one volume, seen from one of them: it serves the index it
// loaded, and the other one replaces the file underneath it.
describe('createIndexFollower()', () => {
  let dir;
  let path;
  let served;
  let loads;
  let messages;
  let follower;

  // Writes an index file as a build does: under a name of its own, which it
  // gets when it is complete.
  function write(entries) {
    const writer = new IndexWriter(path);
    writer.add(entries);
    writer.finish();
  }

  // Puts something that is not an index in the place of the file.
  function writeJunk() {
    writeFileSync(`${path}.junk`, 'not an index');
    renameSync(`${path}.junk`, path);
  }

  function follow(options = {}) {
    return createIndexFollower({
      path,
      served: () => served,
      activate: (index) => {
        served = index;
      },
      load: async (file) => {
        loads++;
        return loadIndexFile(file);
      },
      log: (line) => messages.push(line),
      warn: (line) => messages.push(line),
      ...options,
    });
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'idx-follow-'));
    path = join(dir, INDEX_FILE);
    write(SAMPLE_ENTRIES);
    served = await loadIndexFile(path);
    loads = 0;
    messages = [];
    follower = follow();
  });

  afterEach(() => {
    follower.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('an index knows the file it was loaded from', () => {
    assert.equal(typeof served.file.ino, 'number');
    assert.equal(typeof served.file.mtimeMs, 'number');
    assert.equal(served.file.size > 0, true);
  });

  test('leaves the served index alone while the file is the one it came from', async () => {
    const before = served;
    assert.equal(await follower.check(), before);
    assert.equal(loads, 0);
    assert.deepEqual(messages, []);
  });

  test('loads the file that another sidecar has written, once', async () => {
    write(SAMPLE_ENTRIES.slice(0, 2));
    const index = await follower.check();
    assert.equal(index.size, 2);
    assert.equal(served, index);
    assert.equal(loads, 1);
    assert.match(messages[0], /has been replaced; loading it/);

    await follower.check();
    assert.equal(loads, 1, 'the file it has loaded is not loaded again');
  });

  test('a file written anew is loaded even when it has the same size', async () => {
    const before = served;
    write(SAMPLE_ENTRIES);
    const index = await follower.check();
    assert.equal(loads, 1);
    assert.notEqual(index, before);
    assert.equal(index.file.size, before.file.size);
  });

  test('keeps the served index when the file cannot be loaded, and tries that file once', async () => {
    const before = served;
    writeJunk();
    assert.equal(await follower.check(), before);
    assert.equal(await follower.check(), before);
    assert.equal(served, before);
    assert.equal(loads, 1);
    assert.equal(messages.filter((line) => /cannot be loaded \(it is not an index file\)/.test(line)).length, 1);

    write(SAMPLE_ENTRIES.slice(0, 1));
    assert.equal((await follower.check()).size, 1, 'a file that can be loaded is loaded again');
  });

  test('keeps the served index when the file has a format this version does not read', async () => {
    const before = served;
    write(SAMPLE_ENTRIES.slice(0, 1));
    follower = follow({
      load: async () => {
        loads++;
        throw new IndexFileError('it has another format', { format: 99 });
      },
    });
    assert.equal(await follower.check(), before);
    assert.equal(loads, 1);
    assert.match(messages.at(-1), /cannot be loaded \(it has format 99, this version reads format \d+\); the index loaded before is served/);
  });

  test('keeps the served index when the file is gone, and says so once', async () => {
    const before = served;
    rmSync(path);
    assert.equal(await follower.check(), before);
    assert.equal(await follower.check(), before);
    assert.equal(loads, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /cannot be read \(ENOENT/);
  });

  test('two checks at once load a replaced file once', async () => {
    write(SAMPLE_ENTRIES.slice(0, 2));
    const [a, b] = await Promise.all([follower.check(), follower.check()]);
    assert.equal(a, b);
    assert.equal(a.size, 2);
    assert.equal(loads, 1);
  });

  describe('after a rebuild of its own (required)', () => {
    test('loads the file the rebuild has written', async () => {
      write(SAMPLE_ENTRIES.slice(0, 2));
      const index = await follower.check({ required: true });
      assert.equal(index.size, 2);
      assert.equal(served, index);
      assert.equal(loads, 1);
    });

    test('does not load the file again when the check every few seconds was first', async () => {
      write(SAMPLE_ENTRIES.slice(0, 2));
      await follower.check();
      const index = await follower.check({ required: true });
      assert.equal(index.size, 2);
      assert.equal(loads, 1);
    });

    test('rejects when the file cannot be loaded, and keeps the served index', async () => {
      const before = served;
      writeJunk();
      await assert.rejects(follower.check({ required: true }), /it is not an index file/);
      assert.equal(served, before);
    });

    test('tries a file that a check every few seconds could not load', async () => {
      writeJunk();
      await follower.check();
      await assert.rejects(follower.check({ required: true }), /it is not an index file/);
      assert.equal(loads, 2);
    });

    test('rejects when the file is gone', async () => {
      rmSync(path);
      await assert.rejects(follower.check({ required: true }), { code: 'ENOENT' });
    });

    test('a check that failed does not hold up the next one', async () => {
      writeJunk();
      await assert.rejects(follower.check({ required: true }));
      write(SAMPLE_ENTRIES.slice(0, 1));
      assert.equal((await follower.check()).size, 1);
    });
  });

  describe('start()', () => {
    test('looks at the file on its own, until stop()', async () => {
      let activated;
      const replaced = new Promise((resolve) => {
        activated = resolve;
      });
      follower = follow({
        activate: (index) => {
          served = index;
          activated(index);
        },
      });
      follower.start(10);
      write(SAMPLE_ENTRIES.slice(0, 2));
      assert.equal((await replaced).size, 2);

      follower.stop();
      write(SAMPLE_ENTRIES.slice(0, 1));
      await sleep(50);
      assert.equal(served.size, 2, 'nothing is loaded after stop()');
    });

    test('an interval of 0 looks at nothing', async () => {
      follower.start(0);
      write(SAMPLE_ENTRIES.slice(0, 2));
      await sleep(30);
      assert.equal(loads, 0);
    });
  });
});
