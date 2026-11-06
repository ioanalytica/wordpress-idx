import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchRouter } from '../src/searcher.js';
import { INDEX_FIELDS, fieldIndex } from '../src/index-format.js';
import { buildTestIndex, startServer } from './helpers.js';
import { generateEntries, generateQueries } from './corpus.js';
import { createReference } from './reference-searcher.js';

// The index file replaces what FlexSearch held in memory: the entries and
// the postings. FlexSearch still tokenizes, scores and matches. These tests
// hold the service against the search API of 1.3.8 (reference-searcher.js),
// which let FlexSearch do all of it, over a generated site: the same
// postings, and for every request the same response, byte by byte.
//
// The index is built in parts of a few thousand characters here, so that
// every frequent term is spread over many parts and merged.
const ENTRIES = generateEntries(400);
const RUN_CHARS = 5000;

describe('the index file holds what FlexSearch would hold in memory', () => {
  let index;
  let reference;
  before(async () => {
    index = await buildTestIndex(ENTRIES, { runChars: RUN_CHARS });
    reference = createReference(ENTRIES);
  });

  test('every term of every field has the same postings, in the same order', () => {
    for (const field of INDEX_FIELDS) {
      const expected = fieldIndex(reference.index, field).map;
      let terms = 0;
      for (const [term, slots] of expected) {
        // Half a surrogate pair: no query can name it (see postings.js).
        if (!term.isWellFormed()) continue;
        terms++;
        const found = index.postings(field, term);
        assert.ok(found, `${field}: the term "${term}" is missing`);
        assert.equal(found.length, slots.length, `${field}: "${term}" has other scores`);
        for (let s = 0; s < slots.length; s++) {
          assert.deepEqual(found[s] || [], slots[s] || [], `${field}: "${term}", score ${s}`);
        }
      }
      assert.ok(terms > 500, `${field}: the generated site has too few terms to test with`);
      assert.equal(index.fields[field].terms, terms, `${field}: the index file has other terms`);
    }
  });

  test('a term that is not in the index is not found', () => {
    for (const field of INDEX_FIELDS) {
      const expected = fieldIndex(reference.index, field).map;
      // Before the first term, after the last one, and next to terms that
      // are there.
      const absent = ['', '!', '\u{10ffff}', 'zzzzzzzzzz', 'a\u0000'];
      for (const term of [...expected.keys()].slice(0, 300)) absent.push(`${term}\u0001`, `${term}zq`, term.slice(0, -1) + '\u0000');
      let checked = 0;
      for (const term of absent) {
        if (expected.has(term)) continue;
        checked++;
        assert.equal(index.postings(field, term), undefined, `${field}: ${JSON.stringify(term)}`);
      }
      assert.ok(checked > 600);
    }
  });

  test('a search returns the ids FlexSearch returns, in its order', () => {
    const fields = INDEX_FIELDS;
    for (const query of generateQueries(ENTRIES, 300, { seed: 11 })) {
      const term = query.replace(/^"|"$/g, '');
      const expected = reference.index.search(term, { index: fields, limit: ENTRIES.length });
      assert.deepEqual(index.search(term, fields), expected, `query "${term}"`);
    }
  });

  test('a query of nothing but punctuation, or of half a character, finds nothing', () => {
    for (const query of ['', ' ', '…', '"', '\ud83d', '\udc00x']) {
      const total = index.search(query, INDEX_FIELDS).reduce((n, field) => n + field.result.length, 0);
      const expected = reference.index
        .search(query, { index: INDEX_FIELDS, limit: ENTRIES.length })
        .reduce((n, field) => n + field.result.length, 0);
      assert.equal(total, expected, JSON.stringify(query));
    }
  });
});

describe('every response is the response of 1.3.8', () => {
  let service;
  let reference;
  before(async () => {
    service = await startServer(createSearchRouter(await buildTestIndex(ENTRIES, { runChars: RUN_CHARS })));
    reference = await startServer(createReference(ENTRIES).router);
  });
  after(async () => {
    await service.close();
    await reference.close();
  });

  async function get(server, path) {
    const res = await fetch(server.baseUrl + path);
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      etag: res.headers.get('etag'),
      length: res.headers.get('content-length'),
      body: await res.text(),
    };
  }

  async function same(path) {
    const [actual, expected] = await Promise.all([get(service, path), get(reference, path)]);
    // Compared as text first: a difference then shows where it is.
    assert.equal(actual.body, expected.body, path);
    assert.deepEqual(actual, expected, path);
    return actual;
  }

  const author = encodeURIComponent('bob');
  const category = encodeURIComponent('über uns');
  const tag = encodeURIComponent(ENTRIES.find((e) => e.tags.length).tags[0]);

  test('without a query: all entries, limits, filters, statistics', async () => {
    const paths = [
      '/api/search',
      '/api/search?limit=7',
      '/api/search?limit=0',
      '/api/search?limit=x',
      '/api/search?type=page',
      '/api/search?type=post&limit=3',
      `/api/search?author=${author}`,
      `/api/search?category=${category}`,
      `/api/search?tag=${tag}`,
      '/api/search?from=2023&to=2023',
      '/api/search?from=2023-06&to=2023-08-15',
      '/api/search?from_year=2022&from_month=3&to_year=2023&to_month=2&to_day=9',
      '/api/search?from=2090',
      '/api/search?context=true&limit=5',
      '/api/stats',
      '/api/stats?type=page',
      `/api/stats?author=${author}&from=2022`,
      `/api/stats?category=${category}`,
      '/api/stats?from=2090',
    ];
    for (const path of paths) await same(path);
    assert.equal(JSON.parse((await same('/api/search')).body).total, ENTRIES.length);
  });

  test('entries by id', async () => {
    for (const entry of ENTRIES.slice(0, 40)) await same(`/api/entry/${entry.id}`);
    await same('/api/entry/1');
    await same('/api/entry/abc');
    await same(`/api/entry/${ENTRIES[0].id}.7`);
  });

  test('queries: words, prefixes, several words and quoted phrases, with every option', async () => {
    const queries = [
      ...generateQueries(ENTRIES, 160),
      // Frequent words, among them pairs the encoder maps to one term.
      'der', 'das', 'dass', 'das dass', 'den denn', 'Mann', 'man', '"dass der"', '"und"', 'd', 'e', 's',
      // Other scripts, and a character beyond the Basic Multilingual Plane.
      'Κίρκη', 'κιρκ', '𠀀𠀁', '𠀀', 'x𠀂y', 'Straße', 'strasse', 'naive', 'ödipus',
      // Numbers and punctuation.
      '1993', '19', '"."', '–', 'nichts-davon-steht-im-index',
    ];
    let matches = 0;
    let phrases = 0;
    for (const query of queries) {
      const q = encodeURIComponent(query);
      const found = await same(`/api/search?q=${q}`);
      const { total } = JSON.parse(found.body);
      if (total > 0) matches++;
      if (total > 0 && query.startsWith('"')) phrases++;
      await same(`/api/search?q=${q}&include_comments=true`);
      await same(`/api/search?q=${q}&context=true`);
      await same(`/api/search?q=${q}&context=true&include_comments=true&limit=9`);
      await same(`/api/search?q=${q}&limit=3`);
      await same(`/api/search?q=${q}&type=post&author=${author}`);
      await same(`/api/search?q=${q}&include_comments=true&from=2022-04&to=2023-11`);
      await same(`/api/stats?q=${q}`);
      await same(`/api/stats?q=${q}&include_comments=true&category=${category}`);
    }
    assert.ok(matches > 150, `only ${matches} of ${queries.length} queries match: the comparison says little`);
    assert.ok(phrases > 20, `only ${phrases} quoted phrases match`);
  });
});
