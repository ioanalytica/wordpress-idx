import { test, describe, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, truncateSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIndexFile, buildIndexInChild, readIndexFile, removeDeadBuilds } from '../src/indexer.js';
import { INDEX_FILE, INDEX_FORMAT } from '../src/index-format.js';
import { HEADER_SIZE, MAGIC } from '../src/index-writer.js';
import { SAMPLE_ENTRIES } from './helpers.js';
import { generateEntries } from './corpus.js';

async function* inBatches(entries, size = 2) {
  for (let i = 0; i < entries.length; i += size) yield entries.slice(i, i + size);
}

// The header of an index file, and a way to put a changed one back.
function header(path) {
  const block = Buffer.alloc(HEADER_SIZE);
  const fd = openSync(path, 'r+');
  readSync(fd, block, 0, HEADER_SIZE, 0);
  const length = block.readUInt32LE(MAGIC.length);
  return {
    value: JSON.parse(block.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + length)),
    write(value) {
      const json = Buffer.from(JSON.stringify(value));
      block.fill(0, MAGIC.length);
      block.writeUInt32LE(json.length, MAGIC.length);
      json.copy(block, MAGIC.length + 4);
      writeSync(fd, block, 0, HEADER_SIZE, 0);
      closeSync(fd);
    },
  };
}

describe('the index file', () => {
  let dir;
  let messages;
  const file = () => join(dir, INDEX_FILE);
  const build = (entries = SAMPLE_ENTRIES, options) => buildIndexFile(dir, inBatches(entries), options);

  // The build and the reader say what they do; the tests read some of it.
  const { log, warn } = console;
  before(() => {
    console.log = (line) => messages.push(line);
    console.warn = (line) => messages.push(line);
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'idx-file-'));
    messages = [];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  after(() => {
    console.log = log;
    console.warn = warn;
  });

  describe('buildIndexFile()', () => {
    test('writes one file, which readIndexFile() loads', async () => {
      const summary = await build();
      assert.equal(summary.entries, SAMPLE_ENTRIES.length);
      assert.deepEqual(readdirSync(dir), [INDEX_FILE], 'nothing but the index file is left behind');
      assert.equal(summary.bytes, readFileSync(file()).length);

      const index = await readIndexFile(dir);
      assert.equal(index.size, SAMPLE_ENTRIES.length);
      assert.deepEqual(index.metas.map((meta) => meta.id), SAMPLE_ENTRIES.map((entry) => entry.id));
      // Best score first: in entry 2 the word stands nearer to the start.
      assert.deepEqual(index.search('tomatoes', ['content']), [{ field: 'content', result: [2, 1] }]);
    });

    test('an entry is stored as the API returns it, a Date as its ISO string', async () => {
      const date = new Date('2021-03-15T10:00:00Z');
      await build([{ ...SAMPLE_ENTRIES[0], date, comments: [{ author: 'Carol', date, content: 'Nice post about tomatoes' }] }]);
      const index = await readIndexFile(dir);
      const [meta] = index.metas;
      const entry = index.entry(meta);
      assert.equal(entry.date, '2021-03-15T10:00:00.000Z');
      assert.equal(entry.comments[0].date, '2021-03-15T10:00:00.000Z');
      assert.equal(meta.date, '2021-03-15T10:00:00.000Z');
      assert.deepEqual(Object.keys(entry), ['id', 'type', 'author', 'title', 'date', 'slug', 'categories', 'tags', 'content', 'comments']);
      assert.deepEqual(JSON.parse(index.record(meta).toString()), entry);
      assert.equal(index.content(meta), SAMPLE_ENTRIES[0].content);
      assert.deepEqual(index.comments(meta), entry.comments);
    });

    // A snippet and a phrase match read the content or the comments of an
    // entry out of its record, without the rest.
    test('the content and the comments are found in any record', async () => {
      const awkward = [
        { ...SAMPLE_ENTRIES[0], id: 1, title: 'A "content":"decoy" in the title', content: 'Quotes " and \\ backslashes,\n"content":"x","comments":[] too – „ß“ 𠀀' },
        { ...SAMPLE_ENTRIES[0], id: 2, content: '', comments: [] },
        { ...SAMPLE_ENTRIES[0], id: 3, content: 'No comments key', comments: undefined },
        { id: 4, content: 'Only an id and a content' },
        { id: 5, title: 'No content at all', comments: [{ content: 'A comment' }] },
        { ...SAMPLE_ENTRIES[0], id: 6, categories: ['"content":"decoy"'], comments: [{ author: '"}]', content: 'Brackets ]} in a comment' }] },
      ];
      await build(awkward);
      const index = await readIndexFile(dir);
      for (const meta of index.metas) {
        const entry = index.entry(meta);
        assert.equal(index.content(meta), entry.content, `content of entry ${meta.id}`);
        assert.deepEqual(index.comments(meta), entry.comments, `comments of entry ${meta.id}`);
      }
      assert.equal(index.content(index.byId.get(1)), awkward[0].content);
      assert.deepEqual(index.comments(index.byId.get(6)), awkward[5].comments);
      assert.deepEqual(index.comments(index.byId.get(3)), []);
      assert.equal(index.content(index.byId.get(5)), undefined);
    });

    test('counts the characters and words of a content as /api/stats did', async () => {
      const content = '  Zwei  Wörter\n';
      await build([{ ...SAMPLE_ENTRIES[0], content }]);
      const [meta] = (await readIndexFile(dir)).metas;
      assert.equal(meta.chars, content.length);
      assert.equal(meta.words, 2);
    });

    test('a loaded index gives its memory back when it is released', async () => {
      await build(generateEntries(50));
      const index = await readIndexFile(dir);
      assert.ok(index.bytes > 10000);
      const buffers = [index.records, index.fields.content.dict, index.fields.content.postings];
      assert.ok(buffers.every((buf) => buf.length > 0));
      index.release();
      assert.ok(buffers.every((buf) => buf.length === 0 && buf.buffer.detached), 'the Buffers are detached');
      assert.equal(index.size, 0);
    });

    test('a site without entries gets an index without entries', async () => {
      const summary = await build([]);
      assert.equal(summary.entries, 0);
      const index = await readIndexFile(dir);
      assert.equal(index.size, 0);
      assert.deepEqual(index.search('anything', ['titleText', 'content', 'commentsText']), []);
    });

    // The parts the build indexes one after the other are merged into the
    // same file that one part gives.
    test('the file does not depend on how many parts the build indexed', async () => {
      const entries = generateEntries(150, { seed: 3 });
      await build(entries);
      const whole = readFileSync(file());
      await build(entries, { runChars: 2000 });
      assert.ok(whole.equals(readFileSync(file())), 'built in parts of 2000 characters');
      await build(entries, { runTerms: 500 });
      assert.ok(whole.equals(readFileSync(file())), 'built in parts of 500 terms');
      await build(entries, { runChars: 1 });
      assert.ok(whole.equals(readFileSync(file())), 'built entry by entry');
    });

    test('a build that fails leaves the previous index in place, and no unfinished file', async () => {
      await build();
      const before = readFileSync(file());
      async function* failing() {
        yield [SAMPLE_ENTRIES[0]];
        throw new Error("Table 'wp_comments' doesn't exist");
      }
      await assert.rejects(buildIndexFile(dir, failing()), /wp_comments/);
      assert.deepEqual(readdirSync(dir), [INDEX_FILE]);
      assert.ok(before.equals(readFileSync(file())));
    });

    // Formats 1 and 2 kept everything in wp-index-flex.json, and
    // wp-index-source.json while they built.
    test('removes the files of earlier formats once the new index is written', async () => {
      writeFileSync(join(dir, 'wp-index-flex.json'), '{"format":2,"entries":[],"flexIndex":{}}');
      writeFileSync(join(dir, 'wp-index-source.json'), '[]');
      await build();
      assert.deepEqual(readdirSync(dir), [INDEX_FILE]);
      assert.ok(messages.some((line) => /wp-index-flex\.json of an earlier version deleted/.test(line)));
    });

    test('removes the unfinished file of a build that died, not one that is being written', async () => {
      const dead = join(dir, `${INDEX_FILE}.other-host-1.tmp`);
      const running = join(dir, `${INDEX_FILE}.other-host-2.tmp`);
      writeFileSync(dead, 'x');
      writeFileSync(running, 'x');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(dead, twoHoursAgo, twoHoursAgo);
      await build();
      assert.deepEqual(readdirSync(dir).sort(), [INDEX_FILE, `${INDEX_FILE}.other-host-2.tmp`]);
    });

    // A process ID that no process has: that of a process that has ended.
    const endedPid = () => spawnSync(process.execPath, ['-e', '']).pid;

    test('first removes the files of a build on this host whose process is gone, not those of one that runs', async () => {
      const dead = [`${INDEX_FILE}.${hostname()}-${endedPid()}.tmp`, `${INDEX_FILE}.${hostname()}-${endedPid()}.runs.tmp`];
      // Not this process: the build below runs in it, and writes under its ID.
      const running = `${INDEX_FILE}.${hostname()}-${process.ppid}.tmp`;
      for (const name of [...dead, running]) writeFileSync(join(dir, name), 'x');
      let seen;
      async function* source() {
        seen = readdirSync(dir).sort();
        yield SAMPLE_ENTRIES;
      }
      await buildIndexFile(dir, source());
      // When the build starts: the files of the build that died are gone, the
      // running build's file stays, and the build has opened its own two.
      assert.equal(seen.some((name) => dead.includes(name)), false);
      assert.ok(seen.includes(running));
      assert.deepEqual(readdirSync(dir).sort(), [INDEX_FILE, running]);
      assert.ok(messages.some((line) => /files of index builds that did not finish/.test(line)));
    });
  });

  describe('removeDeadBuilds()', () => {
    test('removes what a build on this host left when its process is gone, and what one on another host left after an hour', () => {
      const names = {
        deadHere: `${INDEX_FILE}.pod-a-7.tmp`,
        deadHereRuns: `${INDEX_FILE}.pod-a-7.runs.tmp`,
        runningHere: `${INDEX_FILE}.pod-a-8.tmp`,
        // Its process ID is in use again, by another process.
        oldRunningHere: `${INDEX_FILE}.pod-a-9.tmp`,
        recentElsewhere: `${INDEX_FILE}.pod-b-7.tmp`,
        oldElsewhere: `${INDEX_FILE}.pod-b-9.runs.tmp`,
        index: INDEX_FILE,
        other: 'notes.tmp',
      };
      for (const name of Object.values(names)) writeFileSync(join(dir, name), 'x');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      for (const name of [names.oldElsewhere, names.oldRunningHere]) utimesSync(join(dir, name), twoHoursAgo, twoHoursAgo);

      const removed = removeDeadBuilds(dir, { host: 'pod-a', runs: (pid) => pid === 8 || pid === 9 });
      assert.deepEqual(
        removed.sort(),
        [names.deadHere, names.deadHereRuns, names.oldRunningHere, names.oldElsewhere].sort(),
      );
      assert.deepEqual(readdirSync(dir).sort(), [names.index, names.other, names.recentElsewhere, names.runningHere].sort());
    });

    test('keeps a file of this host unless the system says that its process does not exist', () => {
      // Process 1 runs, under another user (EPERM) unless the test runs as
      // root; a process ID too large for kill() gets an error that is not
      // ESRCH. Neither proves that the build is gone.
      const names = [`${INDEX_FILE}.${hostname()}-1.tmp`, `${INDEX_FILE}.${hostname()}-99999999999.tmp`];
      for (const name of names) writeFileSync(join(dir, name), 'x');
      assert.deepEqual(removeDeadBuilds(dir), []);
      assert.deepEqual(readdirSync(dir).sort(), names.sort());
    });

    test('says nothing when there is nothing to remove', () => {
      writeFileSync(file(), 'x');
      assert.deepEqual(removeDeadBuilds(dir), []);
      assert.deepEqual(messages, []);
    });
  });

  describe('buildIndexInChild()', () => {
    test('removes the files of a build whose process was killed', async () => {
      // A build that has written its first entries when the kernel ends it.
      const scripts = mkdtempSync(join(tmpdir(), 'idx-child-'));
      const script = join(scripts, 'killed-build.mjs');
      const src = (name) => pathToFileURL(join(import.meta.dirname, '..', 'src', name)).href;
      writeFileSync(
        script,
        [
          `import { join } from 'node:path';`,
          `import { INDEX_FILE } from '${src('index-format.js')}';`,
          `import { IndexWriter } from '${src('index-writer.js')}';`,
          `const writer = new IndexWriter(join(process.argv[2], INDEX_FILE));`,
          `writer.add(${JSON.stringify(SAMPLE_ENTRIES)});`,
          `process.kill(process.pid, 'SIGKILL');`,
        ].join('\n'),
      );
      try {
        await assert.rejects(buildIndexInChild(dir, { child: script }), /ended without a result \(signal SIGKILL\)/);
        assert.deepEqual(readdirSync(dir), []);
      } finally {
        rmSync(scripts, { recursive: true, force: true });
      }
    });
  });

  // readIndexFile() decides whether an index file on disk is served or
  // rebuilt. Only a file of the current format is served: what an earlier
  // version put into its index must not outlive the upgrade.
  describe('readIndexFile()', () => {
    test('returns null when there is no index file, and says nothing', async () => {
      assert.equal(await readIndexFile(dir), null);
      assert.deepEqual(messages, []);
    });

    test('returns null when there is only the file of an earlier format', async () => {
      writeFileSync(join(dir, 'wp-index-flex.json'), JSON.stringify({ format: 2, entries: [{ id: 1 }], flexIndex: {} }));
      assert.equal(await readIndexFile(dir), null);
      assert.match(messages.join('\n'), /wp-index-flex\.json was written by an earlier version.*it will be rebuilt/);
    });

    test('returns null for a file of another format', async () => {
      await build();
      const h = header(file());
      h.write({ ...h.value, format: INDEX_FORMAT + 1 });
      messages = [];
      assert.equal(await readIndexFile(dir), null);
      assert.match(messages.join('\n'), new RegExp(`has format ${INDEX_FORMAT + 1}, this version reads format ${INDEX_FORMAT}; it will be rebuilt`));

      const again = header(file());
      again.write({ ...again.value, format: String(INDEX_FORMAT) });
      assert.equal(await readIndexFile(dir), null);
    });

    test('returns null for a file that is cut off', async () => {
      await build(generateEntries(30));
      const { length } = readFileSync(file());
      for (const size of [length - 1, Math.floor(length / 2), HEADER_SIZE, 100, 0]) {
        truncateSync(file(), size);
        messages = [];
        assert.equal(await readIndexFile(dir), null, `cut to ${size} bytes`);
        assert.match(messages.join('\n'), /cannot be read.*it will be rebuilt/);
      }
    });

    test('returns null for a file that is not an index file', async () => {
      for (const content of ['', 'null', '{"format": 3, "entries": [', Buffer.alloc(HEADER_SIZE * 2, 1)]) {
        writeFileSync(file(), content);
        assert.equal(await readIndexFile(dir), null);
      }
    });

    test('returns null for a file whose header and sections disagree', async () => {
      await build();
      const good = header(file());
      const broken = [
        { ...good.value, entries: good.value.entries + 1 },
        { ...good.value, records: [good.value.records[0], good.value.records[1] - 1] },
        { ...good.value, meta: [good.value.size, 10] },
        { ...good.value, fields: { ...good.value.fields, content: undefined } },
        { ...good.value, blockTerms: 0 },
      ];
      good.write(good.value);
      for (const value of broken) {
        header(file()).write(value);
        assert.equal(await readIndexFile(dir), null, JSON.stringify(value).slice(0, 80));
      }
      header(file()).write(good.value);
      assert.equal((await readIndexFile(dir)).size, SAMPLE_ENTRIES.length);
    });
  });
});
