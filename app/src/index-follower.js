// Keeps the index a sidecar serves in step with the index file.
//
// Sidecars that share one volume, as the replicas of a Deployment do with a
// sidecar each, share one index file. A rebuild replaces that file, and the
// sidecar that ran it loads the new index; the others would go on serving the
// index they loaded before, until they restart. A follower looks at the file
// now and then and loads it when it is no longer the file the served index
// came from: another inode, size or modification time.
//
// A follower never builds. A file it cannot load, such as one that a sidecar
// of another version wrote during a rolling update, leaves the served index
// in place, and so does a file that is gone.
import { stat as statFile } from 'node:fs/promises';
import { INDEX_FORMAT } from './index-format.js';
import { loadIndexFile } from './search-index.js';

/**
 * Whether `stats` (of a stat with `bigint: true`) describe the file that
 * `file` (SearchIndex#file) names.
 */
export function sameFile(file, stats) {
  return (
    Boolean(file) &&
    file.dev === stats.dev &&
    file.ino === stats.ino &&
    file.size === stats.size &&
    file.mtimeNs === stats.mtimeNs
  );
}

/** What sameFile() compares, taken from `stats`. */
function identity({ dev, ino, size, mtimeNs }) {
  return { dev, ino, size, mtimeNs };
}

/** Why a file could not be loaded, for the log. */
function reason(err) {
  if (err.format !== undefined) return `it has format ${err.format}, this version reads format ${INDEX_FORMAT}`;
  return err.message;
}

/**
 *   path             the index file
 *   served()         the index in service, or null while there is none
 *   activate(index)  puts a loaded index into service
 *
 * check() loads the file when it is not the one the served index came from,
 * and resolves with the index in service afterwards. With `required` (after
 * a rebuild of this sidecar) it rejects when the file cannot be loaded;
 * without, it says so once and keeps the served index. Checks run one after
 * the other, so a file is not loaded twice. start() checks every
 * `intervalMs`, stop() ends that.
 */
export function createIndexFollower({
  path,
  served,
  activate,
  load = loadIndexFile,
  stat = statFile,
  log = console.log,
  warn = console.warn,
}) {
  // The file that could not be loaded last: not tried again until it changes.
  let refused = null;
  // What was said last about a file that is gone or cannot be loaded, so
  // that a check every few seconds does not say it every time.
  let said = null;
  let queue = Promise.resolve();
  let timer = null;
  let ticking = null;

  /** Warns with `message`, unless it was the last thing said. */
  function tell(message) {
    if (message !== said) warn(message);
    said = message;
  }

  /** One check, see check(). */
  async function sync(required) {
    const current = served();
    let stats;
    try {
      stats = await stat(path, { bigint: true });
    } catch (err) {
      if (required) throw err;
      tell(`Index file ${path} cannot be read (${err.message}); the index loaded before is served.`);
      return current;
    }
    if (current && sameFile(current.file, stats)) return current;
    if (!required && sameFile(refused, stats)) return current;

    if (!required) log(`Index file ${path} has been replaced; loading it.`);
    let index;
    try {
      index = await load(path);
    } catch (err) {
      if (required) throw err;
      refused = identity(stats);
      tell(`Index file ${path} cannot be loaded (${reason(err)}); the index loaded before is served.`);
      return current;
    }
    refused = null;
    said = null;
    activate(index);
    return index;
  }

  /** Queues a check behind the one that runs, if any. */
  function check({ required = false } = {}) {
    const run = queue.then(() => sync(required));
    queue = run.catch(() => {});
    return run;
  }

  /** Checks every `intervalMs`; does nothing for 0, or when it checks already. */
  function start(intervalMs) {
    if (timer || !(intervalMs > 0)) return;
    timer = setInterval(() => {
      // A load that takes longer than the interval does not queue up checks.
      if (ticking) return;
      ticking = check()
        .catch((err) => warn(`Checking the index file failed: ${err.message}`))
        .finally(() => {
          ticking = null;
        });
    }, intervalMs);
    // The check does not keep the process alive.
    timer.unref();
  }

  /** Ends the checks that start() began. */
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { check, start, stop };
}
