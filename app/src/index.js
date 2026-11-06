import express, { Router } from 'express';
import cors from 'cors';
import config from './config.js';
import { testConnection } from './db.js';
import { buildIndexInChild, readIndexFile } from './indexer.js';
import { prepareIndex } from './startup.js';
import { createSearchRouter } from './searcher.js';
import { createReindexRouter } from './reindex.js';
import { createPluginRouter } from './plugin.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Request logging (skip health/readiness probes)
app.use((req, res, next) => {
  const skip = /\/(healthz|readyz)$/.test(req.path);
  if (skip) return next();

  const start = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  // Called with the number of results when the response has one. A handler
  // that sends JSON as bytes instead of through res.json() calls it itself.
  res.locals.logResponse = (total) => {
    const ms = Date.now() - start;
    const results = total != null ? ` results=${total}` : '';
    console.log(`${new Date().toISOString()} ${ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${results}`);
  };
  const origJson = res.json.bind(res);
  res.json = (body) => {
    res.locals.logResponse(body?.total);
    return origJson(body);
  };
  next();
});

// Current search state — replaced on reindex
let searchRouter = null;
let indexReady = false;
let alive = false; // true once past delay and DB connected or index found

// All routes mounted under basePath
const baseRouter = Router();

// Liveness: ok as soon as DB connected or existing index found (keeps pod alive during build)
baseRouter.get('/healthz', (_req, res) => {
  if (alive) {
    res.json({ status: 'ok', ready: indexReady });
  } else {
    res.status(503).json({ status: 'starting', message: 'Waiting for startup.' });
  }
});

// Readiness: ok only when the search API can serve requests
baseRouter.get('/readyz', (_req, res) => {
  if (indexReady) {
    res.json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'starting', message: 'Index not yet loaded.' });
  }
});

// Delegate search/stats to the current search router
baseRouter.use((req, res, next) => {
  if (searchRouter && (req.path === '/api/search' || req.path === '/api/stats' || req.path.startsWith('/api/entry/'))) {
    return searchRouter(req, res, next);
  }
  next();
});

// Puts a loaded index into service: replaces the search router, and lets go
// of the index it served before. A request is answered within one turn of
// the event loop, so none is still reading the previous index here.
let currentIndex = null;
function activateIndex(index) {
  const previous = currentIndex;
  currentIndex = index;
  searchRouter = createSearchRouter(index);
  indexReady = true;
  if (previous) previous.release();
  console.log(`Search API ready. ${index.size} entries loaded (${(index.bytes / 1048576).toFixed(1)} MiB).`);
  return index.size;
}

// After a reindex: the file that was just written.
async function loadIndex() {
  const index = await readIndexFile();
  if (!index) throw new Error('The index file that was just written cannot be loaded.');
  return activateIndex(index);
}

// Mount reindex endpoint
baseRouter.use(createReindexRouter(loadIndex));

// Serve the bundled WordPress plugin + update manifest (self-hosted auto-updates)
baseRouter.use(createPluginRouter());

// Mount all routes under basePath (empty string for local dev, /idx in k8s)
app.use(config.basePath || '/', baseRouter);

const server = app.listen(config.port, async () => {
  console.log(`wordpress-idx listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (config.basePath) console.log(`Base path: ${config.basePath}`);

  try {
    const index = await prepareIndex({
      forceUpdate: process.env.FORCE_UPDATE === 'true',
      startupDelayMs: config.startupDelay * 1000,
      readIndex: () => readIndexFile(),
      testConnection: async () => {
        console.log(`Connecting to database ${config.db.database} at ${config.db.host}:${config.db.port}...`);
        await testConnection();
        console.log('Database connection successful.');
      },
      // In a process of its own: this one keeps answering the health checks.
      buildIndex: () => buildIndexInChild(),
      // An index to load, or a database connection to build one from: signal
      // liveness, so that k8s does not kill the service during the build.
      markAlive: () => {
        alive = true;
      },
    });
    activateIndex(index);
  } catch (err) {
    console.error(`Startup error: ${err.message}`);
  }
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
