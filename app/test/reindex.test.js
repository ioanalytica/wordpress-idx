import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReindexRouter } from '../src/reindex.js';
import { startServer } from './helpers.js';

let server;
const origKey = process.env.REINDEX_API_KEY;

afterEach(async () => {
  if (server) await server.close();
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
