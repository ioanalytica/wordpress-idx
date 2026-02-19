import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import { Document } from 'flexsearch';
import config from './config.js';
import { testConnection } from './db.js';
import { buildSourceFile } from './indexer.js';
import { createSearchRouter } from './searcher.js';

const app = express();

app.get('/healthz', async (_req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'error', message: err.message });
  }
});

app.listen(config.port, async () => {
  console.log(`wordpress-idx listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);

  console.log(`Connecting to database ${config.db.database} at ${config.db.host}:${config.db.port}...`);
  try {
    await testConnection();
    console.log('Database connection successful.');

    const flexPath = join(config.dataDir, 'wp-index-flex.json');
    const forceUpdate = process.env.FORCE_UPDATE === 'true';

    if (forceUpdate || !existsSync(flexPath)) {
      if (forceUpdate) console.log('FORCE_UPDATE is set, rebuilding index...');
      await buildSourceFile();
    } else {
      console.log('FlexSearch index found, skipping extraction.');
    }

    // Load index and mount search API
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

    app.use(createSearchRouter(index, entriesMap));
    console.log(`Search API ready. ${entriesMap.size} entries loaded.`);
  } catch (err) {
    console.error(`Startup error: ${err.message}`);
  }
});
