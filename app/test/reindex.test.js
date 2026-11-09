import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    assert.deepEqual(started.body, { status: 'running' });
    assert.equal(started.headers.get('preference-applied'), 'respond-async');
    assert.equal((await call(s, 'GET')).body.state, 'running');

    g.open();
    const state = await settled(s);
    assert.equal(state.state, 'done');
    assert.equal(state.entries, 5);
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
