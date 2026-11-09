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
// reported as failed. The end of a rebuild that cannot be written is tried
// again at the same pace until it is written, and the sidecar that ran the
// rebuild reports that end in the meantime.
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const STATE_FILE = 'reindex-state.json';
export const HEARTBEAT_MS = 10 * 1000;
export const STALE_MS = 60 * 1000;

const STOPPED = 'The rebuild stopped without finishing: the sidecar that ran it ended or was restarted.';

// The states a sidecar writes. `idle` is the record before the first
// rebuild, which every sidecar writes at its start when there is none.
const WRITTEN = ['idle', 'running', 'done', 'failed'];

/**
 * The state of the rebuilds in `dir`:
 *
 *   ensure()        writes the idle record when there is no state file
 *   read()          what GET /api/reindex reports: { state, startedAt,
 *                   finishedAt, entries, message }, with state one of idle,
 *                   running, done, failed
 *   start()         a rebuild starts here; resolves with its startedAt,
 *                   rejects when the state cannot be written
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
  writeText = writeFile,
} = {}) {
  const path = () => join(dir, STATE_FILE);
  let current = null;
  let heartbeat = null;
  let retry = null;
  let writing = Promise.resolve();

  /** Writes `state` under a name of its own, then gives it the file's name. */
  async function writeNow(state) {
    const tmp = `${path()}.${host}-${pid}.tmp`;
    try {
      await writeText(tmp, JSON.stringify(state));
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

  /**
   * Ends the rebuild with `fields` and writes it. A write that fails is
   * tried again every `heartbeatMs` until it succeeds or the next rebuild
   * starts: without it, the file would keep saying "running" and go stale,
   * and every sidecar would report a rebuild that succeeded as failed.
   */
  async function end(fields) {
    clearInterval(heartbeat);
    heartbeat = null;
    const at = new Date(now()).toISOString();
    current = { ...current, ...fields, finishedAt: at, updatedAt: at };
    try {
      await write(current);
    } catch (err) {
      console.warn(`The end of the rebuild cannot be written (${err.message}); trying again.`);
      const ended = current;
      let trying = false;
      retry = setInterval(async () => {
        if (trying) return;
        trying = true;
        try {
          // Another sidecar may have started the next rebuild meanwhile: its
          // record is not replaced by the end of this one.
          const onDisk = await readRecord();
          if (onDisk === null || onDisk.state === 'idle' || isRecordOf(onDisk, ended)) {
            await write(ended);
            console.log('The end of the rebuild is written.');
          } else {
            console.log('The end of the rebuild is not written: another rebuild has started since.');
          }
          clearInterval(retry);
          retry = null;
        } catch {
          // Tried again at the next beat.
        } finally {
          trying = false;
        }
      }, heartbeatMs);
      retry.unref();
    }
  }

  /** The record in the state file as it is written, or null when there is none. */
  async function readRecord() {
    try {
      return JSON.parse(await readFile(path(), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Whether `record` is that of the rebuild `of`: same sidecar, same start. */
  function isRecordOf(record, of) {
    return Boolean(record) && record.host === of.host && record.pid === of.pid && record.startedAt === of.startedAt;
  }

  /** What GET reports of a state as it is written. */
  function report({ state, startedAt = null, finishedAt = null, entries = null, message = null }) {
    return { state, startedAt, finishedAt, entries, message };
  }

  /** A state file that cannot be used: failed, which does not block the next rebuild. */
  function unusable(why) {
    return { state: 'failed', startedAt: null, finishedAt: null, entries: null, message: `The state of the last rebuild ${why}.` };
  }

  /** The state of the last rebuild, as GET /api/reindex reports it. */
  async function read() {
    let text;
    try {
      text = await readFile(path(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { state: 'idle' };
      return unusable(`cannot be read (${err.message})`);
    }
    let state;
    try {
      state = JSON.parse(text);
    } catch {
      return unusable('cannot be parsed');
    }
    if (!state || typeof state !== 'object' || Array.isArray(state) || !WRITTEN.includes(state.state)) {
      return unusable('is not a state this version writes');
    }
    if (state.state === 'idle') return { state: 'idle' };
    // The rebuild of this sidecar has ended, and the end is not written yet.
    const ownEnd = current && current.state !== 'running' && state.state === 'running' && isRecordOf(state, current);
    if (ownEnd) return report(current);
    // A time that is not a string is no time: such a state is stale.
    const updated = typeof state.updatedAt === 'string' ? Date.parse(state.updatedAt) : Number.NaN;
    if (state.state === 'running' && !(now() - updated <= staleMs)) {
      return { ...report(state), state: 'failed', message: STOPPED };
    }
    return report(state);
  }

  /**
   * Writes the idle record when there is no state file yet, and leaves one
   * that is there as it is. Every sidecar does it at its start: on a
   * network volume a client that has looked for a file that was not there
   * may go on taking it for absent for a while after another client has
   * created it, and would report the first rebuild as idle. A file that has
   * been there since the start is seen as it changes.
   */
  async function ensure() {
    const tmp = `${path()}.${host}-${pid}.tmp`;
    try {
      await writeText(tmp, JSON.stringify({ state: 'idle' }));
      // link() fails when the name exists, on a network volume as well: of
      // sidecars that start at once, one writes the record.
      await link(tmp, path());
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /** A rebuild starts here: writes `running`, and again every `heartbeatMs`. */
  async function start() {
    // The end of the rebuild before, if it is still being tried, is past.
    clearInterval(retry);
    retry = null;
    const at = new Date(now()).toISOString();
    current = { state: 'running', startedAt: at, updatedAt: at, finishedAt: null, entries: null, message: null, host, pid };
    await write(current);
    heartbeat = setInterval(beat, heartbeatMs);
    heartbeat.unref();
    return at;
  }

  return {
    ensure,
    read,
    start,
    finish: (entries) => end({ state: 'done', entries }),
    fail: (message) => end({ state: 'failed', message }),
  };
}
