// The state of the last rebuild that POST /api/reindex started, kept in
// DATA_DIR next to the index file.
//
// Sidecars that share the volume (the replicas of a Deployment) share it as
// they share the index: a rebuild runs in the sidecar that got the call, and
// GET /api/reindex reports it from any of them. WordPress' "Rebuild index"
// asks through admin-ajax, which can reach another replica than the one that
// started the rebuild.
//
// While a rebuild runs, its sidecar writes the state again every few seconds.
// A state that says "running" and has not been written for a minute belongs
// to a sidecar that ended or was restarted during the rebuild, and is
// reported as failed.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const STATE_FILE = 'reindex-state.json';
export const HEARTBEAT_MS = 10 * 1000;
export const STALE_MS = 60 * 1000;

const STOPPED = 'The rebuild stopped without finishing: the sidecar that ran it ended or was restarted.';

/**
 * The state of the rebuilds in `dir`:
 *
 *   read()          what GET /api/reindex reports: { state, startedAt,
 *                   finishedAt, entries, message }, with state one of idle,
 *                   running, done, failed
 *   start()         a rebuild starts here; rejects when the state cannot be
 *                   written
 *   finish(entries) it is done, with that many entries
 *   fail(message)   it failed
 */
export function createReindexState({
  dir,
  host = hostname(),
  pid = process.pid,
  now = () => Date.now(),
  heartbeatMs = HEARTBEAT_MS,
  staleMs = STALE_MS,
} = {}) {
  const path = () => join(dir, STATE_FILE);
  let current = null;
  let heartbeat = null;
  let writing = Promise.resolve();

  /** Writes `state` under a name of its own, then gives it the file's name. */
  async function writeNow(state) {
    const tmp = `${path()}.${host}-${pid}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, path());
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /**
   * Writes one state after the other: a heartbeat that is still being
   * written does not land after the end of the rebuild.
   */
  function write(state) {
    const run = writing.then(() => writeNow(state));
    writing = run.catch(() => {});
    return run;
  }

  /** Writes the state again while the rebuild runs, so it does not go stale. */
  function beat() {
    current = { ...current, updatedAt: new Date(now()).toISOString() };
    write(current).catch((err) => console.warn(`The state of the rebuild cannot be written: ${err.message}`));
  }

  /** Ends the rebuild with `fields` and writes it; a failed write is logged. */
  async function end(fields) {
    clearInterval(heartbeat);
    heartbeat = null;
    const at = new Date(now()).toISOString();
    current = { ...current, ...fields, finishedAt: at, updatedAt: at };
    try {
      await write(current);
    } catch (err) {
      console.warn(`The state of the rebuild cannot be written: ${err.message}`);
    }
  }

  async function read() {
    let state;
    try {
      state = JSON.parse(await readFile(path(), 'utf8'));
    } catch {
      return { state: 'idle' };
    }
    const { startedAt = null, finishedAt = null, entries = null, message = null } = state;
    const report = { state: state.state, startedAt, finishedAt, entries, message };
    if (state.state === 'running' && !(now() - Date.parse(state.updatedAt) <= staleMs)) {
      return { ...report, state: 'failed', message: STOPPED };
    }
    return report;
  }

  async function start() {
    const at = new Date(now()).toISOString();
    current = { state: 'running', startedAt: at, updatedAt: at, finishedAt: null, entries: null, message: null, host, pid };
    await write(current);
    heartbeat = setInterval(beat, heartbeatMs);
    heartbeat.unref();
  }

  return {
    read,
    start,
    finish: (entries) => end({ state: 'done', entries }),
    fail: (message) => end({ state: 'failed', message }),
  };
}
