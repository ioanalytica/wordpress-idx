import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { extractBatches } from './extractor.js';
import { INDEX_FORMAT, INDEX_FILE, LEGACY_FILES } from './index-format.js';
import { IndexWriter } from './index-writer.js';
import { loadIndexFile, IndexFileError } from './search-index.js';

// A build that died leaves its unfinished file behind. One that is this old
// is not being written any more.
const STALE_TMP_MS = 60 * 60 * 1000;

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The index of the file in `dir`, loaded, or null when there is nothing to
 * load: no file, a file that an earlier version wrote in another format, or
 * one that cannot be read. The caller builds a new index in all three cases,
 * so that what an earlier version put into its index is not served by this
 * one.
 */
export async function readIndexFile(dir = config.dataDir) {
  const path = join(dir, INDEX_FILE);
  try {
    return await loadIndexFile(path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const legacy = LEGACY_FILES.map((name) => join(dir, name)).find(exists);
      if (legacy) {
        console.log(`Index file ${legacy} was written by an earlier version, this version reads format ${INDEX_FORMAT}; it will be rebuilt.`);
      }
      return null;
    }
    if (err instanceof IndexFileError && err.format !== undefined) {
      console.log(`Index file ${path} has format ${err.format}, this version reads format ${INDEX_FORMAT}; it will be rebuilt.`);
      return null;
    }
    console.warn(`Index file ${path} cannot be read (${err.message}); it will be rebuilt.`);
    return null;
  }
}

function removeLeftovers(dir) {
  // The files of formats 1 and 2: this version does not read them, and they
  // hold what was public when they were written.
  for (const name of LEGACY_FILES) {
    const path = join(dir, name);
    if (!exists(path)) continue;
    rmSync(path, { force: true });
    console.log(`Index file ${path} of an earlier version deleted.`);
  }
  // Unfinished files of builds that died.
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${INDEX_FILE}.`) || !name.endsWith('.tmp')) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_TMP_MS) rmSync(path, { force: true });
    } catch {
      // Another sidecar on the same volume removed it first.
    }
  }
}

/**
 * Builds the index file in `dir` from `source`, which yields the entries in
 * batches (by default: from the WordPress database). Indexing occupies the
 * thread it runs in; the service calls buildIndexInChild().
 */
export async function buildIndexFile(dir = config.dataDir, source = extractBatches(), options = {}) {
  console.log('Extracting posts and pages from WordPress database...');
  const path = join(dir, INDEX_FILE);
  const writer = new IndexWriter(path, options);
  let summary;
  try {
    for await (const batch of source) writer.add(batch);
    console.log(`Extracted ${writer.count} entries (posts/pages).`);
    console.log('Building search index...');
    summary = writer.finish();
  } catch (err) {
    writer.abort();
    throw err;
  }
  console.log(`Indexed ${summary.entries} entries.`);
  console.log(`Search index written to ${path} (${(summary.bytes / 1048576).toFixed(1)} MiB).`);
  removeLeftovers(dir);
  return summary;
}

const BUILD_CHILD = fileURLToPath(new URL('./build-child.js', import.meta.url));

/**
 * Builds the index file in a process of its own and resolves with what the
 * file holds. The service keeps answering requests and health checks while
 * the build occupies its own thread, and what the build needed in memory
 * goes back to the system when that process ends. A worker thread would keep
 * the service free as well, but the memory it used stays with the process.
 */
export function buildIndexInChild(dir = config.dataDir) {
  return new Promise((resolve, reject) => {
    const child = fork(BUILD_CHILD, [dir]);
    let result = null;
    // Under `node --watch` the child also reports the files it loads here.
    child.on('message', (message) => {
      if (message && typeof message.ok === 'boolean') result = message;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (result && result.ok) resolve(result.summary);
      else if (result) reject(new Error(result.message));
      else reject(new Error(`the index build ended without a result (${signal ? `signal ${signal}` : `exit code ${code}`})`));
    });
  });
}
