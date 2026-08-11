import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchRouter } from '../src/searcher.js';
import { buildTestIndex, startServer, SAMPLE_ENTRIES } from './helpers.js';

let server;

before(async () => {
  const { index, entriesMap } = buildTestIndex();
  server = await startServer(createSearchRouter(index, entriesMap));
});

after(async () => {
  await server.close();
});

async function get(path) {
  const res = await fetch(server.baseUrl + path);
  return { status: res.status, body: await res.json() };
}

test('GET /api/search without query returns all entries', async () => {
  const { status, body } = await get('/api/search');
  assert.equal(status, 200);
  assert.equal(body.total, SAMPLE_ENTRIES.length);
  assert.equal(body.results.length, SAMPLE_ENTRIES.length);
});

test('GET /api/search full-text query matches content', async () => {
  const { status, body } = await get('/api/search?q=gardening');
  assert.equal(status, 200);
  assert.equal(body.total, 2);
  const ids = body.results.map((r) => r.id).sort();
  assert.deepEqual(ids, [1, 2]);
});

test('GET /api/search phrase query narrows to exact phrase', async () => {
  const { body: loose } = await get('/api/search?q=green%20tomatoes');
  const { body: phrase } = await get('/api/search?q=%22green%20tomatoes%22');
  // The quoted phrase only appears verbatim in entry 2.
  assert.equal(phrase.total, 1);
  assert.equal(phrase.results[0].id, 2);
  assert.ok(loose.total >= phrase.total);
});

test('GET /api/search limit slices results but total stays full', async () => {
  const { body } = await get('/api/search?limit=1');
  assert.equal(body.total, SAMPLE_ENTRIES.length);
  assert.equal(body.results.length, 1);
});

test('GET /api/search filters by type', async () => {
  const { body } = await get('/api/search?type=page');
  assert.equal(body.total, 1);
  assert.equal(body.results[0].type, 'page');
});

test('GET /api/search filters by author (case-insensitive substring)', async () => {
  const { body } = await get('/api/search?author=alice');
  assert.equal(body.total, 2);
  assert.ok(body.results.every((r) => r.author === 'Alice'));
});

test('GET /api/search filters by category and tag', async () => {
  const { body: cat } = await get('/api/search?category=news');
  assert.equal(cat.total, 2);
  const { body: tag } = await get('/api/search?tag=company');
  assert.equal(tag.total, 1);
  assert.equal(tag.results[0].id, 2);
});

test('GET /api/search filters by date range', async () => {
  const { body } = await get('/api/search?from=2022-01-01&to=2022-12-31');
  assert.equal(body.total, 1);
  assert.equal(body.results[0].id, 2);
});

test('GET /api/search with context returns a snippet around the match', async () => {
  const { body } = await get('/api/search?q=tomatoes&context=true');
  const hit = body.results.find((r) => r.id === 1);
  assert.ok(hit.content.toLowerCase().includes('tomatoes'));
});

test('GET /api/entry/:id returns the entry without commentsText', async () => {
  const { status, body } = await get('/api/entry/1');
  assert.equal(status, 200);
  assert.equal(body.id, 1);
  assert.equal(body.commentsText, undefined);
});

test('GET /api/entry/:id rejects non-integer id with 400', async () => {
  const { status, body } = await get('/api/entry/abc');
  assert.equal(status, 400);
  assert.equal(body.error, 'Invalid ID');
});

test('GET /api/entry/:id returns 404 for unknown id', async () => {
  const { status, body } = await get('/api/entry/999');
  assert.equal(status, 404);
  assert.equal(body.error, 'Not found');
});

test('GET /api/stats aggregates counts and date range', async () => {
  const { status, body } = await get('/api/stats');
  assert.equal(status, 200);
  assert.equal(body.total, 3);
  assert.equal(body.posts, 2);
  assert.equal(body.pages, 1);
  assert.equal(body.topAuthors[0].name, 'Alice');
  assert.equal(body.topAuthors[0].count, 2);
  assert.ok(body.dateRange.earliest.startsWith('2021'));
  assert.ok(body.dateRange.latest.startsWith('2023'));
});
