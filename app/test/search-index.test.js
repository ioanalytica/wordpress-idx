import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchRouter } from '../src/searcher.js';
import { buildTestIndex, startServer, SAMPLE_ENTRIES } from './helpers.js';

async function serve(entries) {
  const { index, entriesMap } = buildTestIndex(entries);
  const server = await startServer(createSearchRouter(index, entriesMap));
  const get = async (path) => {
    const res = await fetch(server.baseUrl + path);
    return { status: res.status, body: await res.json() };
  };
  return { get, close: server.close };
}

// FlexSearch returns 100 matches per field unless the search names a limit.
// The index of a site with more posts than that has to return them all:
// `total`, the filters and /api/stats are computed from what the index
// returns.
describe('a query that matches more than 100 entries', () => {
  const MATCHING = 130;
  const entries = [];
  for (let id = 1; id <= 250; id++) {
    entries.push({
      id,
      type: id % 2 ? 'post' : 'page',
      author: id % 5 ? 'Alice' : 'Bob',
      title: `Entry ${id}`,
      titleText: `Entry ${id}`,
      date: '2022-01-01T10:00:00Z',
      slug: `/entry-${id}/`,
      categories: [],
      tags: [],
      content: id <= MATCHING ? `Number ${id} is about tomatoes.` : `Number ${id} is about something else.`,
      commentsText: id > 200 ? 'A comment about tomatoes' : '',
      comments: id > 200 ? [{ content: 'A comment about tomatoes' }] : [],
    });
  }

  let api;
  before(async () => {
    api = await serve(entries);
  });
  after(async () => {
    await api.close();
  });

  test('/api/search returns every match', async () => {
    const { body } = await api.get('/api/search?q=tomatoes');
    assert.equal(body.total, MATCHING);
    assert.equal(body.results.length, MATCHING);
  });

  test('/api/search with include_comments returns the matches of both fields', async () => {
    const { body } = await api.get('/api/search?q=tomatoes&include_comments=true');
    assert.equal(body.total, MATCHING + 50);
  });

  test('a filter sees every match, not the first 100', async () => {
    // Bob wrote every fifth entry: 26 of the 130 that match.
    const { body } = await api.get('/api/search?q=tomatoes&author=bob');
    assert.equal(body.total, 26);
  });

  test('a quoted phrase is checked against every match', async () => {
    const { body } = await api.get(`/api/search?q=${encodeURIComponent('"about tomatoes"')}`);
    assert.equal(body.total, MATCHING);
  });

  test('limit still cuts the results, and total stays the number of matches', async () => {
    const { body } = await api.get('/api/search?q=tomatoes&limit=5');
    assert.equal(body.total, MATCHING);
    assert.equal(body.results.length, 5);
  });

  test('/api/stats counts every match', async () => {
    const { body } = await api.get('/api/stats?q=tomatoes');
    assert.equal(body.total, MATCHING);
    assert.equal(body.posts + body.pages, MATCHING);
  });
});

describe('a query matches titles', () => {
  let api;
  before(async () => {
    api = await serve(SAMPLE_ENTRIES);
  });
  after(async () => {
    await api.close();
  });

  test('a word that is only in the title finds the entry', async () => {
    // "Hello World" is the title of entry 1; its content does not say hello.
    const { body } = await api.get('/api/search?q=hello');
    assert.deepEqual(body.results.map((r) => r.id), [1]);
  });

  test('an entry that matches in title and content is returned once', async () => {
    const both = [
      { ...SAMPLE_ENTRIES[0], title: 'Tomatoes in spring', titleText: 'Tomatoes in spring', content: 'How to grow tomatoes.' },
      SAMPLE_ENTRIES[2],
    ];
    const local = await serve(both);
    try {
      const { body } = await local.get('/api/search?q=tomatoes');
      assert.equal(body.total, 1);
      assert.equal(body.results.length, 1);
    } finally {
      await local.close();
    }
  });

  test('a quoted phrase is found in a title', async () => {
    const { body } = await api.get(`/api/search?q=${encodeURIComponent('"second post"')}`);
    assert.deepEqual(body.results.map((r) => r.id), [3]);
  });

  test('a quoted phrase must be in one field, not spread over title and content', async () => {
    // "world" ends the title of entry 1, "welcome" starts its content.
    const { body } = await api.get(`/api/search?q=${encodeURIComponent('"world welcome"')}`);
    assert.equal(body.total, 0);
  });

  // A title is stored with entities and may hold a few tags; the extractor
  // adds its plain text as titleText, and that is what a query matches.
  test('a title is matched as it reads, and returned as it is stored', async () => {
    const stored = 'Tom &amp; <em>Jerry</em>';
    const local = await serve([
      { ...SAMPLE_ENTRIES[0], title: stored, titleText: 'Tom & Jerry' },
      SAMPLE_ENTRIES[2],
    ]);
    try {
      const phrase = await local.get(`/api/search?q=${encodeURIComponent('"tom & jerry"')}`);
      assert.deepEqual(phrase.body.results.map((r) => r.id), [1]);
      assert.equal(phrase.body.results[0].title, stored);
      assert.equal(phrase.body.results[0].titleText, undefined);

      // Neither the entity nor the tag is a word of the title.
      assert.equal((await local.get('/api/search?q=amp')).body.total, 0);
      assert.equal((await local.get('/api/search?q=em')).body.total, 0);

      const entry = await local.get('/api/entry/1');
      assert.equal(entry.body.title, stored);
      assert.equal(entry.body.titleText, undefined);
      assert.equal(entry.body.commentsText, undefined);
    } finally {
      await local.close();
    }
  });

  test('context=true returns the start of the content when only the title matches', async () => {
    const { body } = await api.get('/api/search?q=hello&context=true');
    assert.equal(body.results[0].content, SAMPLE_ENTRIES[0].content);
  });

  test('/api/stats counts a title match', async () => {
    const { body } = await api.get('/api/stats?q=hello');
    assert.equal(body.total, 1);
  });
});

// The extractor gives an entry without a WordPress user an empty author.
describe('an entry without an author', () => {
  const entries = [
    SAMPLE_ENTRIES[0],
    { ...SAMPLE_ENTRIES[2], id: 7, author: '', content: 'Imported text about orchards.' },
  ];

  let api;
  before(async () => {
    api = await serve(entries);
  });
  after(async () => {
    await api.close();
  });

  test('is found by a query, with an empty author', async () => {
    const { body } = await api.get('/api/search?q=orchards');
    assert.equal(body.total, 1);
    assert.equal(body.results[0].author, '');
  });

  test('is not matched by an author filter', async () => {
    const { body } = await api.get('/api/search?author=alice');
    assert.deepEqual(body.results.map((r) => r.id), [1]);
  });

  test('is counted by /api/stats, but adds no nameless author to topAuthors', async () => {
    const { body } = await api.get('/api/stats');
    assert.equal(body.total, 2);
    assert.deepEqual(body.topAuthors, [{ name: 'Alice', count: 1 }]);
  });
});

describe('a query of several words', () => {
  let api;
  before(async () => {
    api = await serve(SAMPLE_ENTRIES);
  });
  after(async () => {
    await api.close();
  });

  test('matches when one field holds all of them', async () => {
    const title = await api.get('/api/search?q=hello%20world');
    assert.deepEqual(title.body.results.map((r) => r.id), [1]);
    const content = await api.get('/api/search?q=gardening%20weekends');
    assert.deepEqual(content.body.results.map((r) => r.id), [2]);
  });

  // "hello" is in the title of entry 1 and "gardening" in its content. The
  // fields are searched one by one; API_PROMPT.md says so.
  test('does not match when the words are spread over title and content', async () => {
    const { body } = await api.get('/api/search?q=hello%20gardening');
    assert.equal(body.total, 0);
  });
});
