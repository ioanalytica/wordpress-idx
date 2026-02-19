import { Router } from 'express';
import { buildSourceFile } from './indexer.js';

export function createReindexRouter(onReindexComplete) {
  const router = Router();
  let reindexing = false;

  router.post('/api/reindex', async (req, res) => {
    // Check if API key is configured
    const apiKey = process.env.REINDEX_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Reindex endpoint is disabled (no API key configured).' });
    }

    // Validate request auth
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const headerKey = req.headers['x-api-key'];
    const providedKey = bearer || headerKey;

    if (providedKey !== apiKey) {
      return res.status(401).json({ error: 'Invalid or missing API key.' });
    }

    // Prevent concurrent reindex
    if (reindexing) {
      return res.status(409).json({ error: 'Reindex already in progress.' });
    }

    reindexing = true;
    try {
      console.log('Reindex triggered via API...');
      await buildSourceFile();
      const entries = await onReindexComplete();
      console.log('Reindex complete.');
      res.json({ status: 'ok', entries });
    } catch (err) {
      console.error('Reindex failed:', err.message);
      res.status(500).json({ error: 'Reindex failed', message: err.message });
    } finally {
      reindexing = false;
    }
  });

  return router;
}
