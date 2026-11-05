// How the service gets its index when it starts.
//
// An index file of the current format is loaded as it is; the database is
// not needed for that. Without one (a first start, FORCE_UPDATE, a file an
// earlier version wrote, a file that cannot be read) the index is built from
// the database, and the build is tried again until it succeeds: a sidecar
// starts next to a WordPress that may still wait for its database or still
// be installing itself, so the tables can be missing at the first attempt, or
// be there and still empty.

// Pause between two attempts to build the index.
export const RETRY_DELAY_MS = 5000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves with the index data once there is an index to serve.
 *
 *   readIndex()       the parsed index file ({ entries, ... }), or null
 *                     when there is none of the current format
 *   testConnection()  rejects while the database cannot be reached
 *   buildIndex()      extracts from the database and writes the index file
 *   markAlive()       called as soon as the service has something to live
 *                     for: an index, or a database connection to build one
 */
export async function prepareIndex({
  forceUpdate = false,
  startupDelayMs = 0,
  retryDelayMs = RETRY_DELAY_MS,
  readIndex,
  testConnection,
  buildIndex,
  markAlive,
  sleep = pause,
  log = console.log,
}) {
  if (forceUpdate) {
    log('FORCE_UPDATE is set, rebuilding index...');
  } else {
    const existing = await readIndex();
    if (existing) {
      log('FlexSearch index found, skipping extraction.');
      markAlive();
      return existing;
    }
  }

  if (startupDelayMs > 0) {
    log(`Waiting ${startupDelayMs / 1000}s for WordPress to start...`);
    await sleep(startupDelayMs);
  }

  // An index without entries is built a second time before it is accepted:
  // WordPress creates its tables a moment before it fills them, and an index
  // built in between would stay empty until someone rebuilds it. A site that
  // has no public post or page gets its empty index one pause later.
  let emptyOnce = false;

  for (;;) {
    try {
      await testConnection();
      // Connected: signal liveness, so that the service is not restarted
      // while it extracts, or while it waits for WordPress' tables.
      markAlive();
      await buildIndex();
      const built = await readIndex();
      if (!built) throw new Error('the index file that was just written cannot be loaded');
      if (built.entries.length === 0 && !emptyOnce) {
        emptyOnce = true;
        log(`No public posts or pages found. WordPress may still be installing: building once more in ${retryDelayMs / 1000}s.`);
        await sleep(retryDelayMs);
        continue;
      }
      return built;
    } catch (err) {
      log(`Index build failed: ${err.message}. Trying again in ${retryDelayMs / 1000}s.`);
      await sleep(retryDelayMs);
    }
  }
}
