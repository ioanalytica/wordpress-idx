import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createSearchRouter } from '../src/searcher.js';
import { createReindexRouter } from '../src/reindex.js';
import { createPluginRouter } from '../src/plugin.js';
import { buildTestIndex } from './helpers.js';

// API_PROMPT.md is the API reference handed to agents that use the index for
// research. This suite fails when the code handles an endpoint, a query
// parameter or an auth header that the file does not name, and when the file
// names an endpoint or a parameter the code no longer handles.
//
// What it detects:
//   - a route registered with a literal path in any app/src/*.js file that has
//     no `### METHOD /path` heading in API_PROMPT.md, and a heading without a
//     route;
//   - a query parameter that a handler of the search router reads by name,
//     which is not in the first column of the file's parameter table, and a
//     parameter in that table which no handler reads;
//   - a request header that POST /api/reindex reads, which the file does not
//     name;
//   - `req.query` appearing in a source file other than searcher.js, whose
//     handlers this suite would not run.
//
// What it cannot detect:
//   - whether a description is right: a changed default, type, matching rule,
//     status code or response field passes as long as the names are there;
//   - which endpoint a parameter is documented for: the file has one
//     parameter table, which /api/stats refers to;
//   - a route in index.js whose path is not a string literal, or that is
//     registered in a way the scan does not know (router.route(), a path
//     prefix in use()). The other files' routers are instantiated here and the
//     scan must agree with what they register;
//   - a parameter read without naming it (a loop over the query's keys), read
//     through another name than `req.query`, or read only on a branch the four
//     probe values below do not reach.

const DOC = readFileSync(new URL('../../API_PROMPT.md', import.meta.url), 'utf-8');
const SRC_DIR = new URL('../src/', import.meta.url);
const SOURCES = readdirSync(SRC_DIR)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, text: readFileSync(new URL(name, SRC_DIR), 'utf-8') }));

// Source text without comments, so that a route that is commented out does not
// count. Only comments that start a line are removed: `//` inside a line can
// be part of a string or a regular expression.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Routes that are deliberately not part of the agent reference. A new route
// must be documented in API_PROMPT.md or listed here with the reason.
const NOT_FOR_AGENTS = new Map([
  ['GET /plugin/update-info.json', 'update manifest for the WordPress plugin'],
  ['GET /plugin/wordpress-idx-search.zip', 'plugin package for WordPress'],
]);

const METHODS = 'get|post|put|patch|delete|all';

// `router.get('/path', …)` and friends in one source file. index.js cannot be
// imported here (it starts the server), so its routes are only seen this way.
function scanRoutes(name) {
  const pattern = new RegExp(`\\.(${METHODS})\\(\\s*(['"\`])(/[^'"\`]*)\\2`, 'g');
  const { text } = SOURCES.find((source) => source.name === name);
  return [...withoutComments(text).matchAll(pattern)]
    .map(([, method, , path]) => `${method.toUpperCase()} ${path}`)
    .sort();
}

function scanAllRoutes() {
  return new Set(SOURCES.flatMap(({ name }) => scanRoutes(name)));
}

// The routes a router really registered, to check the scan against.
function registeredRoutes(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map(
        (method) => `${method.replace('_all', 'all').toUpperCase()} ${layer.route.path}`,
      ),
    )
    .sort();
}

// `### GET /api/search` headings.
function documentedRoutes() {
  const pattern = new RegExp(`^#{2,}\\s+(${METHODS})\\s+(/\\S*)\\s*$`, 'gim');
  return new Set([...DOC.matchAll(pattern)].map(([, method, path]) => `${method.toUpperCase()} ${path}`));
}

// Names in the first column of the `| Param | … |` tables.
function documentedParams() {
  const params = new Set();
  let inTable = false;
  for (const line of DOC.split('\n')) {
    if (/^\|\s*Param\s*\|/i.test(line)) {
      inTable = true;
    } else if (inTable && line.startsWith('|')) {
      const firstCell = line.split('|')[1];
      for (const [, name] of firstCell.matchAll(/`([^`]+)`/g)) params.add(name);
    } else {
      inTable = false;
    }
  }
  return params;
}

// An object that answers every property with `value` and remembers the names.
function recorder(value) {
  const seen = new Set();
  const target = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === 'string') seen.add(key);
        return value;
      },
    },
  );
  return { target, seen };
}

const fakeResponse = () => ({
  locals: {},
  status() {
    return this;
  },
  set() {
    return this;
  },
  json() {
    return this;
  },
  send() {
    return this;
  },
});

// Handlers branch on what a parameter holds, so each one runs with nothing
// set, with a plain value, with the literal the boolean switches compare
// against, and with a quoted phrase.
const PROBE_VALUES = [undefined, '1', 'true', '"a b"'];

// Runs every handler of `router` and returns the query parameters they read.
async function queryParamsRead(router) {
  const read = new Set();
  for (const layer of router.stack.filter((l) => l.route)) {
    for (const value of PROBE_VALUES) {
      const { target, seen } = recorder(value);
      const req = { query: target, params: { id: '1' }, headers: {} };
      for (const { handle } of layer.route.stack) {
        await handle(req, fakeResponse(), () => {});
      }
      for (const name of seen) read.add(name);
    }
  }
  return read;
}

async function searchRouter() {
  return createSearchRouter(await buildTestIndex());
}

describe('API_PROMPT.md endpoints', () => {
  const inCode = scanAllRoutes();
  const inDoc = documentedRoutes();

  test('the source scan agrees with the routes the routers register', async () => {
    const routers = {
      'searcher.js': await searchRouter(),
      'reindex.js': createReindexRouter(() => 0),
      'plugin.js': createPluginRouter(),
    };
    for (const [name, router] of Object.entries(routers)) {
      assert.deepEqual(
        scanRoutes(name),
        registeredRoutes(router),
        `the scan of ${name} in this test and the routes its router registers differ`,
      );
    }
  });

  test('every endpoint the code handles has a heading', () => {
    for (const route of inCode) {
      if (NOT_FOR_AGENTS.has(route)) continue;
      assert.ok(
        inDoc.has(route),
        `${route} is handled by the code but API_PROMPT.md has no "### ${route}" heading`,
      );
    }
  });

  test('every heading names an endpoint the code handles', () => {
    for (const route of inDoc) {
      assert.ok(inCode.has(route), `API_PROMPT.md documents ${route}, which the code does not handle`);
    }
  });

  test('the routes left out on purpose still exist and stay out', () => {
    for (const route of NOT_FOR_AGENTS.keys()) {
      assert.ok(inCode.has(route), `${route} is listed in NOT_FOR_AGENTS but the code does not handle it`);
      assert.ok(!inDoc.has(route), `${route} is documented, remove it from NOT_FOR_AGENTS`);
    }
  });
});

describe('API_PROMPT.md query parameters', () => {
  test('every query parameter the handlers read is in the table', async () => {
    const read = await queryParamsRead(await searchRouter());
    const documented = documentedParams();
    assert.ok(read.size > 0, 'the handlers read no query parameter: the probe no longer works');
    for (const name of read) {
      assert.ok(
        documented.has(name),
        `the code reads the query parameter "${name}" but the parameter table in API_PROMPT.md does not list it`,
      );
    }
  });

  test('every parameter in the table is read by a handler', async () => {
    const read = await queryParamsRead(await searchRouter());
    const documented = documentedParams();
    assert.ok(documented.size > 0, 'found no parameter table in API_PROMPT.md');
    for (const name of documented) {
      assert.ok(read.has(name), `API_PROMPT.md documents the query parameter "${name}", which no handler reads`);
    }
  });

  test('query parameters are read in searcher.js only', () => {
    const readers = SOURCES.filter(({ text }) => /\breq\.query\b/.test(text)).map(({ name }) => name);
    assert.deepEqual(
      readers,
      ['searcher.js'],
      'another source file reads req.query: run its handlers in this suite too',
    );
  });
});

describe('API_PROMPT.md reindex authentication', () => {
  test('every header POST /api/reindex reads is named', async () => {
    const original = process.env.REINDEX_API_KEY;
    process.env.REINDEX_API_KEY = 'key-for-the-api-prompt-test';
    try {
      const router = createReindexRouter(() => {
        throw new Error('the reindex must not run: no key was sent');
      });
      const { target, seen } = recorder(undefined);
      const [layer] = router.stack.filter((l) => l.route);
      await layer.route.stack[0].handle({ headers: target, query: {} }, fakeResponse(), () => {});

      assert.ok(seen.size > 0, 'the handler read no header: the probe no longer works');
      for (const name of seen) {
        assert.ok(
          DOC.toLowerCase().includes(`\`${name}: `),
          `POST /api/reindex reads the header "${name}" but API_PROMPT.md does not name it`,
        );
      }
    } finally {
      if (original === undefined) delete process.env.REINDEX_API_KEY;
      else process.env.REINDEX_API_KEY = original;
    }
  });
});
