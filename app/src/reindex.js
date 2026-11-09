import { Router } from 'express';
import config from './config.js';
import { buildIndexInChild } from './indexer.js';
import { createReindexState } from './reindex-state.js';

/**
 * POST /api/reindex rebuilds the index; GET /api/reindex reports the last
 * rebuild. `onReindexComplete` loads the index that was built and resolves
 * with its number of entries. `state` keeps the state of the rebuilds where
 * every sidecar on the volume sees it (reindex-state.js); `build` builds the
 * index file. Tests give their own.
 */
export function createReindexRouter(
  onReindexComplete,
  { state = createReindexState({ dir: config.dataDir }), build = buildIndexInChild } = {},
) {
  const router = Router();
  let reindexing = false;

  /** Answers the request itself and returns false unless it carries the key. */
  function authorized(req, res) {
    const apiKey = process.env.REINDEX_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Reindex endpoint is disabled (no API key configured).' });
      return false;
    }
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const headerKey = req.headers['x-api-key'];
    if ((bearer || headerKey) !== apiKey) {
      res.status(401).json({ error: 'Invalid or missing API key.' });
      return false;
    }
    return true;
  }

  /** The rebuild, from the start to the index in service. */
  async function rebuild() {
    try {
      console.log('Reindex triggered via API...');
      await build();
      const entries = await onReindexComplete();
      await state.finish(entries);
      console.log('Reindex complete.');
      return entries;
    } catch (err) {
      console.error('Reindex failed:', err.message);
      await state.fail(err.message);
      throw err;
    } finally {
      reindexing = false;
    }
  }

  router.post('/api/reindex', async (req, res) => {
    if (!authorized(req, res)) return;

    // A rebuild of this sidecar, or of another one on the same volume.
    // Two calls at the same moment to two sidecars can both start one: this
    // is no lock, and two rebuilds at once do no harm.
    if (reindexing || (await state.read()).state === 'running') {
      return res.status(409).json({ error: 'Reindex already in progress.' });
    }

    reindexing = true;
    try {
      await state.start();
    } catch (err) {
      reindexing = false;
      console.error('Reindex not started:', err.message);
      return res.status(500).json({ error: 'Reindex failed', message: `Its state cannot be written: ${err.message}` });
    }
    const running = rebuild();

    // Prefer: respond-async answers at once; GET /api/reindex reports the end.
    if (/\brespond-async\b/i.test(req.headers.prefer || '')) {
      running.catch(() => {});
      return res.status(202).set('Preference-Applied', 'respond-async').json({ status: 'running' });
    }
    try {
      res.json({ status: 'ok', entries: await running });
    } catch (err) {
      res.status(500).json({ error: 'Reindex failed', message: err.message });
    }
  });

  router.get('/api/reindex', async (req, res) => {
    if (!authorized(req, res)) return;
    res.json(await state.read());
  });

  return router;
}
