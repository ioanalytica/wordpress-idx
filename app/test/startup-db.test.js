import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENABLED, DB, connect, createTables, dropTables } from './db-helpers.js';
import { generateEntries } from './corpus.js';

// Starts the service itself, as a process, against a real MySQL. Opt-in via
// IDX_TEST_DB=1, like db.test.js, and under table prefixes of its own.
const RUN = `${process.pid}_${Date.now()}`;
const SKIP = ENABLED ? false : 'set IDX_TEST_DB=1 and provide a MySQL';
const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `url` until it answers with `status`, or gives up after `timeoutMs`.
async function waitForStatus(url, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      last = res.status;
      if (res.status === status) return true;
    } catch (err) {
      last = err.message;
    }
    await sleep(250);
  }
  throw new Error(`${url} did not answer ${status} within ${timeoutMs} ms (last: ${last})`);
}

// Starts src/index.js with its data directory and its tables' prefix.
async function startService(dataDir, prefix) {
  const port = await freePort();
  // An empty directory: the service reads .env from where it is started.
  const cwd = mkdtempSync(join(tmpdir(), 'idx-cwd-'));
  const service = { baseUrl: `http://127.0.0.1:${port}`, output: '', cwd };
  service.child = spawn(process.execPath, [ENTRY], {
    cwd,
    env: {
      PATH: process.env.PATH,
      DB_HOST: DB.host,
      DB_PORT: String(DB.port),
      DB_USER: DB.user,
      DB_PASS: DB.password,
      DB_NAME: DB.database,
      DB_PREFIX: prefix,
      DATA_DIR: dataDir,
      PORT: String(port),
      STARTUP_DELAY: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.child.stdout.on('data', (chunk) => (service.output += chunk));
  service.child.stderr.on('data', (chunk) => (service.output += chunk));
  return service;
}

async function stopService(service) {
  if (service && service.child.exitCode === null) {
    service.child.kill('SIGTERM');
    await new Promise((resolve) => service.child.once('exit', resolve));
  }
  if (service) rmSync(service.cwd, { recursive: true, force: true });
}

async function waitUntilReady(service, timeoutMs) {
  try {
    await waitForStatus(`${service.baseUrl}/readyz`, 200, timeoutMs);
  } catch (err) {
    throw new Error(`${err.message}\n--- service output ---\n${service.output}`);
  }
}

async function search(service, q) {
  const res = await fetch(`${service.baseUrl}/api/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

async function withConnection(fn) {
  const conn = await connect();
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

async function seedHelloWorld(conn, prefix) {
  await createTables(conn, prefix);
  await conn.query(`INSERT INTO ${prefix}users (ID, display_name) VALUES (1,'Alice')`);
  await conn.query(
    `INSERT INTO ${prefix}posts (ID, post_author, post_date, post_content, post_title, post_name)
     VALUES (1,1,'2024-01-01 10:00:00','Welcome to WordPress.','Hello world!','hello-world')`,
  );
}

// WordPress has not created its tables yet: the state a sidecar finds when it
// starts next to a WordPress that still waits for its database or is still
// installing itself.
describe('start before WordPress has created its tables', { skip: SKIP }, () => {
  const PREFIX = `idx_start_${RUN}_`;
  let service;
  let dataDir;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'idx-start-'));
    service = await startService(dataDir, PREFIX);
  });

  after(async () => {
    await stopService(service);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (ENABLED) await withConnection((conn) => dropTables(conn, PREFIX));
  });

  test('the service builds its index once the tables are there, without a restart', async () => {
    // The database answers, so the service is alive; it has no index yet.
    await waitForStatus(`${service.baseUrl}/healthz`, 200, 10_000);
    assert.equal((await fetch(`${service.baseUrl}/readyz`)).status, 503);

    // WordPress installs itself.
    await withConnection((conn) => seedHelloWorld(conn, PREFIX));

    await waitUntilReady(service, 20_000);
    const body = await search(service, 'hello');
    assert.equal(body.total, 1);
    assert.equal(body.results[0].title, 'Hello world!');
  });
});

// An index file written before the format had a number: built by a version
// that indexed other fields and selected other entries, under the file name
// of formats 1 and 2.
describe('start with an index file of an earlier format', { skip: SKIP }, () => {
  const PREFIX = `idx_format_${RUN}_`;
  let service;
  let dataDir;

  before(async () => {
    await withConnection((conn) => seedHelloWorld(conn, PREFIX));
    dataDir = mkdtempSync(join(tmpdir(), 'idx-format-'));
    const stale = {
      entries: [
        {
          id: 99,
          type: 'post',
          author: 'Alice',
          title: 'From the old index',
          date: '2020-01-01T10:00:00.000Z',
          slug: '/from-the-old-index/',
          categories: [],
          tags: [],
          content: 'Text that only the old index file holds.',
          comments: [],
          commentsText: '',
        },
      ],
      flexIndex: {},
    };
    writeFileSync(join(dataDir, 'wp-index-flex.json'), JSON.stringify(stale));
    service = await startService(dataDir, PREFIX);
  });

  after(async () => {
    await stopService(service);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (ENABLED) await withConnection((conn) => dropTables(conn, PREFIX));
  });

  test('the index is rebuilt from the database and the old entries are gone', async () => {
    await waitUntilReady(service, 20_000);

    assert.equal((await fetch(`${service.baseUrl}/api/entry/99`)).status, 404);
    const all = await (await fetch(`${service.baseUrl}/api/search`)).json();
    assert.deepEqual(all.results.map((r) => r.id), [1]);
    assert.equal((await search(service, 'hello')).total, 1);

    // The index is in this version's file, and the old file is gone. The
    // state of the rebuilds is written at every start (reindex-state.js).
    assert.deepEqual(readdirSync(dataDir).sort(), ['reindex-state.json', 'wp-index.bin']);
    assert.match(service.output, /it will be rebuilt/);
  });
});

// Indexing occupies the thread it runs in for as long as the site is large.
// The kubelet restarts a container whose liveness probe gets no answer, so
// the build must not be in the thread that answers it.
describe('start with a site that takes a while to index', { skip: SKIP }, () => {
  const PREFIX = `idx_large_${RUN}_`;
  const POSTS = 3000;
  let service;
  let dataDir;

  before(async () => {
    // About twelve million characters of generated text.
    const entries = generateEntries(POSTS, { seed: 5, words: 370 });
    await withConnection(async (conn) => {
      await createTables(conn, PREFIX);
      for (let i = 0; i < entries.length; i += 200) {
        const rows = entries.slice(i, i + 200).map((e) => [e.id, 0, e.date, `<p>${e.content}</p>`, e.title, `post-${e.id}`]);
        await conn.query(
          `INSERT INTO ${PREFIX}posts (ID, post_author, post_date, post_content, post_title, post_name) VALUES ?`,
          [rows],
        );
      }
    });
    dataDir = mkdtempSync(join(tmpdir(), 'idx-large-'));
    service = await startService(dataDir, PREFIX);
  });

  after(async () => {
    await stopService(service);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (ENABLED) await withConnection((conn) => dropTables(conn, PREFIX));
  });

  test('the service answers its liveness probe while it builds the index', async () => {
    await waitForStatus(`${service.baseUrl}/healthz`, 200, 10_000);

    // Probe until the index is served, and keep the slowest answer.
    const deadline = Date.now() + 120_000;
    let probes = 0;
    let slowest = 0;
    for (;;) {
      const started = Date.now();
      const res = await fetch(`${service.baseUrl}/healthz`);
      const { ready } = await res.json();
      assert.equal(res.status, 200);
      if (ready) break;
      probes++;
      slowest = Math.max(slowest, Date.now() - started);
      assert.ok(Date.now() < deadline, `the index was not built in time\n--- service output ---\n${service.output}`);
      await sleep(50);
    }

    assert.ok(slowest < 1000, `a liveness probe waited ${slowest} ms for its answer during the build`);
    // A probe every 50 ms: a build that blocks the service lets few through.
    assert.ok(
      probes >= 5,
      `only ${probes} probes were answered before the index was served: the build held them up, or the site is too small to show it`,
    );

    const all = await (await fetch(`${service.baseUrl}/api/search?limit=1`)).json();
    assert.equal(all.total, POSTS);
  });
});
