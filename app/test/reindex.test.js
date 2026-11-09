import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createReindexRouter } from '../src/reindex.js';
import { createReindexState, STATE_FILE } from '../src/reindex-state.js';
import { startServer } from './helpers.js';

let server;
const origKey = process.env.REINDEX_API_KEY;

afterEach(async () => {
  if (server) await server.close();
  server = null;
  if (origKey === undefined) delete process.env.REINDEX_API_KEY;
  else process.env.REINDEX_API_KEY = origKey;
});

async function post(path, headers = {}) {
  const res = await fetch(server.baseUrl + path, { method: 'POST', headers });
  return { status: res.status, body: await res.json() };
}

// The auth guards all return before buildSourceFile()/onReindexComplete() run,
// so a callback that throws proves those guards short-circuit without touching the DB.
function guardRouter() {
  return createReindexRouter(() => {
    throw new Error('onReindexComplete should not be called on failed auth');
  });
}

test('POST /api/reindex is disabled (503) when no API key is configured', async () => {
  delete process.env.REINDEX_API_KEY;
  server = await startServer(guardRouter());
  const { status, body } = await post('/api/reindex');
  assert.equal(status, 503);
  assert.match(body.error, /disabled/);
});

test('POST /api/reindex rejects a missing key with 401', async () => {
  process.env.REINDEX_API_KEY = 'secret';
  server = await startServer(guardRouter());
  const { status, body } = await post('/api/reindex');
  assert.equal(status, 401);
  assert.match(body.error, /Invalid or missing/);
});

test('POST /api/reindex rejects a wrong bearer token with 401', async () => {
  process.env.REINDEX_API_KEY = 'secret';
  server = await startServer(guardRouter());
  const { status } = await post('/api/reindex', { authorization: 'Bearer wrong' });
  assert.equal(status, 401);
});

test('GET /api/reindex asks for the key as POST does', async () => {
  delete process.env.REINDEX_API_KEY;
  server = await startServer(guardRouter());
  assert.equal((await fetch(`${server.baseUrl}/api/reindex`)).status, 503);
  await server.close();
  process.env.REINDEX_API_KEY = 'secret';
  server = await startServer(guardRouter());
  assert.equal((await fetch(`${server.baseUrl}/api/reindex`)).status, 401);
});

// The rebuild with a build and a load that the test lets finish, and a state
// in a directory of its own: what the sidecars on one volume share.
describe('rebuilds and their state', () => {
  const KEY = { authorization: 'Bearer secret' };
  let dir;
  let servers;
  const quiet = { log: console.log, error: console.error, warn: console.warn };

  before(() => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  });
  after(() => Object.assign(console, quiet));

  beforeEach(() => {
    process.env.REINDEX_API_KEY = 'secret';
    dir = mkdtempSync(join(tmpdir(), 'idx-reindex-'));
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) await s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A build that ends when the test says so. */
  function gate() {
    let open;
    let fail;
    const done = new Promise((resolve, reject) => {
      open = resolve;
      fail = reject;
    });
    return { build: () => done, open, fail };
  }

  /** A sidecar on the shared directory, with `build` and `entries` after the load. */
  async function sidecar({ build = async () => {}, entries = 3, host = 'pod-a', stateOptions = {} } = {}) {
    const state = createReindexState({ dir, host, ...stateOptions });
    const s = await startServer(createReindexRouter(async () => entries, { state, build }));
    servers.push(s);
    return s;
  }

  async function call(s, method, headers = {}) {
    const res = await fetch(`${s.baseUrl}/api/reindex`, { method, headers: { ...KEY, ...headers } });
    return { status: res.status, headers: res.headers, body: await res.json() };
  }

  /** The state GET reports, once it is no longer `running`. */
  async function settled(s) {
    for (let i = 0; i < 100; i++) {
      const { body } = await call(s, 'GET');
      if (body.state !== 'running') return body;
      await sleep(10);
    }
    throw new Error('the rebuild did not end');
  }

  test('ensure() writes the idle record once, and leaves a state that is there', async () => {
    const a = createReindexState({ dir, host: 'pod-a' });
    const b = createReindexState({ dir, host: 'pod-b' });
    await Promise.all([a.ensure(), b.ensure()]);
    assert.deepEqual(readdirSync(dir), [STATE_FILE], 'one record, no temporary file');
    assert.deepEqual(await b.read(), { state: 'idle' });

    await a.start();
    await b.ensure();
    assert.equal((await b.read()).state, 'running', 'a sidecar that starts later does not reset a running rebuild');
    await a.finish(1);
  });

  test('a rebuild that starts while ensure() runs is not disturbed by it', async () => {
    // ensure() is held after it has written its temporary file, until the
    // rebuild has written and renamed its own: the order in which a shared
    // temporary file would be linked away or removed.
    let release;
    let written;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const idleWritten = new Promise((resolve) => {
      written = resolve;
    });
    const writeText = async (file, text) => {
      await writeFile(file, text);
      if (JSON.parse(text).state !== 'idle') return;
      written();
      await held;
    };
    const state = createReindexState({ dir, host: 'pod-a', writeText });
    const ensured = state.ensure();
    await idleWritten;
    const startedAt = await state.start();
    release();
    await ensured;
    const read = await state.read();
    assert.equal(read.state, 'running');
    assert.equal(read.startedAt, startedAt);
    assert.deepEqual(readdirSync(dir), [STATE_FILE], 'no temporary file is left');
    await state.finish(1);
  });

  test('nothing rebuilt yet: idle', async () => {
    const s = await sidecar();
    assert.deepEqual((await call(s, 'GET')).body, { state: 'idle' });
  });

  test('POST waits for the rebuild and answers with the entries; GET reports it done', async () => {
    const s = await sidecar({ entries: 7 });
    const { status, body } = await call(s, 'POST');
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'ok', entries: 7 });
    const state = (await call(s, 'GET')).body;
    assert.equal(state.state, 'done');
    assert.equal(state.entries, 7);
    assert.equal(state.message, null);
    assert.ok(Date.parse(state.startedAt) <= Date.parse(state.finishedAt));
  });

  test('Prefer: respond-async answers 202 at once; GET reports running, then done', async () => {
    const g = gate();
    const s = await sidecar({ build: g.build, entries: 5 });
    const started = await call(s, 'POST', { prefer: 'respond-async' });
    assert.equal(started.status, 202);
    assert.equal(started.body.status, 'running');
    assert.equal(started.headers.get('preference-applied'), 'respond-async');
    const running = (await call(s, 'GET')).body;
    assert.equal(running.state, 'running');
    assert.equal(running.startedAt, started.body.startedAt, 'the 202 names the rebuild that GET reports');

    g.open();
    const state = await settled(s);
    assert.equal(state.state, 'done');
    assert.equal(state.entries, 5);
    assert.equal(state.startedAt, started.body.startedAt);
  });

  test('a failed rebuild: 500 to the call that waits, failed with the message to GET', async () => {
    const s = await sidecar({
      build: async () => {
        throw new Error('the database does not answer');
      },
    });
    const { status, body } = await call(s, 'POST');
    assert.equal(status, 500);
    assert.equal(body.message, 'the database does not answer');
    const state = (await call(s, 'GET')).body;
    assert.equal(state.state, 'failed');
    assert.equal(state.message, 'the database does not answer');
  });

  test('another sidecar on the volume reports the rebuild, and refuses a second one with 409', async () => {
    const g = gate();
    const a = await sidecar({ build: g.build, host: 'pod-a' });
    const b = await sidecar({ host: 'pod-b' });
    assert.equal((await call(a, 'POST', { prefer: 'respond-async' })).status, 202);

    assert.equal((await call(b, 'GET')).body.state, 'running');
    assert.equal((await call(b, 'POST')).status, 409);
    assert.equal((await call(a, 'POST')).status, 409);

    g.open();
    assert.equal((await settled(b)).state, 'done');
    assert.equal((await call(b, 'POST')).status, 200, 'once it is done, another one may start');
  });

  test('two calls at once to one sidecar start one rebuild', async () => {
    const g = gate();
    let builds = 0;
    const s = await sidecar({
      build: () => {
        builds++;
        return g.build();
      },
    });
    const statuses = (
      await Promise.all([call(s, 'POST', { prefer: 'respond-async' }), call(s, 'POST', { prefer: 'respond-async' })])
    ).map((r) => r.status);
    assert.deepEqual(statuses.sort(), [202, 409]);
    g.open();
    assert.equal((await settled(s)).state, 'done');
    assert.equal(builds, 1);
  });

  for (const [what, content] of [
    ['cannot be parsed', '{"state": "runn'],
    ['is not a state this version writes', 'null'],
    ['is not a state this version writes', '["running"]'],
    ['is not a state this version writes', '{"state": "paused"}'],
  ]) {
    test(`a state file that ${what} (${content}) is reported failed and does not block the next one`, async () => {
      writeFileSync(join(dir, STATE_FILE), content);
      const s = await sidecar();
      const state = (await call(s, 'GET')).body;
      assert.equal(state.state, 'failed');
      assert.equal(state.message, `The state of the last rebuild ${what}.`);
      assert.equal((await call(s, 'POST')).status, 200);
    });
  }

  test('a running state whose time is not a string is stale, and reading it does not throw', async () => {
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ state: 'running', updatedAt: { toString: 1, valueOf: 1 } }));
    const s = await sidecar();
    assert.equal((await call(s, 'GET')).body.state, 'failed');
    assert.equal((await call(s, 'POST')).status, 200);
  });

  test('a state that cannot be read: 500, and the next call may start a rebuild', async () => {
    const real = createReindexState({ dir });
    let fails = 1;
    const state = {
      ...real,
      read: async () => {
        if (fails-- > 0) throw new Error('the volume does not answer');
        return real.read();
      },
    };
    const s = await startServer(createReindexRouter(async () => 2, { state, build: async () => {} }));
    servers.push(s);
    const first = await call(s, 'POST');
    assert.equal(first.status, 500);
    assert.match(first.body.message, /the volume does not answer/);
    assert.equal((await call(s, 'POST')).status, 200, 'the sidecar is not left believing it rebuilds');
  });

  test('a state file that cannot be read is reported failed, not idle', async () => {
    mkdirSync(join(dir, STATE_FILE));
    const state = await createReindexState({ dir }).read();
    assert.equal(state.state, 'failed');
    assert.match(state.message, /cannot be read \(EISDIR/);
  });

  test('a rebuild whose sidecar stopped is reported failed and does not block the next one', async () => {
    writeFileSync(
      join(dir, STATE_FILE),
      JSON.stringify({ state: 'running', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const s = await sidecar();
    const state = (await call(s, 'GET')).body;
    assert.equal(state.state, 'failed');
    assert.match(state.message, /ended or was restarted/);
    assert.equal((await call(s, 'POST')).status, 200);
  });

  test('an end that cannot be written is reported by its sidecar, and written once it can be', async () => {
    let broken = false;
    const writeText = async (file, text) => {
      if (broken) throw new Error('no space left on device');
      return writeFile(file, text);
    };
    const own = createReindexState({ dir, host: 'pod-a', heartbeatMs: 5, writeText });
    const other = createReindexState({ dir, host: 'pod-b' });
    await own.start();
    broken = true;
    await own.finish(4);

    assert.equal((await own.read()).state, 'done', 'the sidecar that ran the rebuild knows its end');
    assert.equal((await own.read()).entries, 4);
    assert.equal((await other.read()).state, 'running', 'the file still says running');

    broken = false;
    for (let i = 0; i < 100 && (await other.read()).state === 'running'; i++) await sleep(5);
    const state = await other.read();
    assert.equal(state.state, 'done');
    assert.equal(state.entries, 4);
  });

  test('an end written late does not replace the record of a rebuild that started since', async () => {
    let broken = false;
    const writeText = async (file, text) => {
      if (broken) throw new Error('no space left on device');
      return writeFile(file, text);
    };
    const own = createReindexState({ dir, host: 'pod-a', heartbeatMs: 5, writeText });
    const other = createReindexState({ dir, host: 'pod-b' });
    await own.start();
    broken = true;
    await own.finish(4);
    await other.start();

    broken = false;
    await sleep(50);
    const state = await own.read();
    assert.equal(state.state, 'running', 'the rebuild of pod-b is what the file says');
    assert.equal(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')).host, 'pod-b');
    await other.finish(6);
  });

  test('a running rebuild writes its state again, so that it does not go stale', async () => {
    const g = gate();
    let clock = Date.now();
    const s = await sidecar({ build: g.build, stateOptions: { heartbeatMs: 5, staleMs: 1000, now: () => clock } });
    await call(s, 'POST', { prefer: 'respond-async' });
    clock += 5000;
    await sleep(30);
    assert.equal((await call(s, 'GET')).body.state, 'running');
    g.open();
    assert.equal((await settled(s)).state, 'done');
  });

  test('the state file holds nothing but the state, and no temporary file is left', async () => {
    const s = await sidecar();
    await call(s, 'POST');
    assert.deepEqual(readdirSync(dir), [STATE_FILE]);
  });
});
