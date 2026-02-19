import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { Router } from 'express';
import cors from 'cors';
import { Document } from 'flexsearch';
import config from './config.js';
import { testConnection } from './db.js';
import { buildSourceFile } from './indexer.js';
import { createSearchRouter } from './searcher.js';
import { createReindexRouter } from './reindex.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Current search state — replaced on reindex
let searchRouter = null;
let indexReady = false;

// All routes mounted under basePath
const baseRouter = Router();

baseRouter.get('/healthz', (_req, res) => {
  if (indexReady) {
    res.json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'starting', message: 'Index not yet loaded.' });
  }
});

// Delegate search/stats to the current search router
baseRouter.use((req, res, next) => {
  if (searchRouter && (req.path === '/api/search' || req.path === '/api/stats')) {
    return searchRouter(req, res, next);
  }
  next();
});

async function loadIndex() {
  const flexPath = join(config.dataDir, 'wp-index-flex.json');

  console.log('Loading FlexSearch index...');
  const data = JSON.parse(await readFile(flexPath, 'utf-8'));

  const entriesMap = new Map();
  for (const entry of data.entries) {
    entriesMap.set(entry.id, entry);
  }

  const index = new Document({
    document: {
      id: 'id',
      index: ['content'],
      store: true,
    },
    tokenize: 'forward',
    charset: 'latin:advanced',
  });

  for (const [key, value] of Object.entries(data.flexIndex)) {
    await index.import(key, value);
  }

  searchRouter = createSearchRouter(index, entriesMap);
  indexReady = true;
  console.log(`Search API ready. ${entriesMap.size} entries loaded.`);
  return entriesMap.size;
}

// Mount reindex endpoint
baseRouter.use(createReindexRouter(loadIndex));

// Mount all routes under basePath (empty string for local dev, /idx in k8s)
app.use(config.basePath || '/', baseRouter);

const server = app.listen(config.port, async () => {
  console.log(`wordpress-idx listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (config.basePath) console.log(`Base path: ${config.basePath}`);

  try {
    if (config.startupDelay > 0) {
      console.log(`Waiting ${config.startupDelay}s for WordPress to start...`);
      await new Promise((r) => setTimeout(r, config.startupDelay * 1000));
    }

    const flexPath = join(config.dataDir, 'wp-index-flex.json');
    const forceUpdate = process.env.FORCE_UPDATE === 'true';

    if (forceUpdate || !existsSync(flexPath)) {
      if (forceUpdate) console.log('FORCE_UPDATE is set, rebuilding index...');
      console.log(`Connecting to database ${config.db.database} at ${config.db.host}:${config.db.port}...`);
      await testConnection();
      console.log('Database connection successful.');
      await buildSourceFile();
    } else {
      console.log('FlexSearch index found, skipping extraction.');
    }

    await loadIndex();
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
