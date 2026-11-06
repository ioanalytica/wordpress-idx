import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ByteWriter, ByteReader } from '../src/bytes.js';
import { encodeSlots, decodeSlots, encodeRun, mergeRuns } from '../src/postings.js';

describe('varint', () => {
  test('reads back what was written, up to the largest safe integer', () => {
    const values = [0, 1, 127, 128, 16383, 16384, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 7, Number.MAX_SAFE_INTEGER];
    const writer = new ByteWriter(1);
    for (const value of values) writer.varint(value);
    const reader = new ByteReader(writer.take());
    assert.deepEqual(values.map(() => reader.varint()), values);
  });

  test('a small number takes one byte, a posting distance seldom more than two', () => {
    const writer = new ByteWriter();
    writer.varint(127);
    assert.equal(writer.length, 1);
    writer.varint(16383);
    assert.equal(writer.length, 3);
  });
});

// A term's postings as FlexSearch holds them: per score a list of ids, with
// holes for the scores no entry has.
function slotsOf(lists) {
  const slots = [];
  for (const [score, list] of Object.entries(lists)) slots[score] = list;
  return slots;
}

describe('postings of a term', () => {
  const roundTrip = (slots, ids) => {
    const writer = new ByteWriter();
    encodeSlots(writer, slots);
    return decodeSlots(writer.take(), 0, ids);
  };

  test('are read back with their holes', () => {
    const slots = slotsOf({ 0: [0, 5, 6], 3: [2], 8: [1, 100000, 100001] });
    const back = roundTrip(slots);
    assert.deepEqual(back, slots);
    assert.equal(back.length, 9);
    assert.ok(!(1 in back), 'a score without entries is a hole, as in FlexSearch');
  });

  test('are read back as ids when the ids of the ordinals are given', () => {
    const ids = [70, 30, 50];
    assert.deepEqual(roundTrip(slotsOf({ 1: [0, 2], 2: [1] }), ids), slotsOf({ 1: [70, 50], 2: [30] }));
  });

  test('null stands for a hole, as in an index that went through JSON', () => {
    assert.deepEqual(roundTrip([null, [4]]), slotsOf({ 1: [4] }));
  });

  test('must be in the order the entries were added', () => {
    assert.throws(() => roundTrip([[3, 2]]), /not in the order/);
    assert.throws(() => roundTrip([[3, 3]]), /not in the order/);
  });

  test('take about a byte per posting when the entries are near each other', () => {
    const list = Array.from({ length: 1000 }, (_, i) => i * 3);
    const writer = new ByteWriter();
    encodeSlots(writer, [list]);
    assert.ok(writer.length < 1010, `${writer.length} bytes for 1000 postings`);
  });
});

function termsOf(run) {
  const terms = [];
  mergeRuns([run], (termBuf, termStart, termEnd, postingsBuf, start) => {
    terms.push([termBuf.toString('utf8', termStart, termEnd), decodeSlots(postingsBuf, start)]);
  });
  return terms;
}

describe('runs', () => {
  test('a run holds the terms in the byte order of their UTF-8 form', () => {
    // U+FF5E sorts after U+20000 by UTF-16 unit and before it by code point.
    const map = new Map([
      ['～', [[1]]],
      ['zebra', [[2]]],
      ['\u{20000}', [[3]]],
      ['a', [[4]]],
      ['äpfel', [[5]]],
      ['ab', [[6]]],
    ]);
    assert.deepEqual(termsOf(encodeRun(map)).map(([term]) => term), ['a', 'ab', 'zebra', 'äpfel', '～', '\u{20000}']);
  });

  test('a term that ends in half a surrogate pair is left out', () => {
    const map = new Map([['\u{20000}'.slice(0, 1), [[1]]], ['x\ud840', [[1]]], ['\u{20000}', [[1]]]]);
    assert.deepEqual(termsOf(encodeRun(map)).map(([term]) => term), ['\u{20000}']);
  });

  test('merging the runs of consecutive parts gives the run of the whole', () => {
    // Three parts; the entries of a part have ordinals above those before.
    const parts = [
      new Map([['haus', slotsOf({ 0: [0], 2: [1, 2] })], ['h', slotsOf({ 0: [0, 1, 2] })], ['alt', slotsOf({ 5: [2] })]]),
      new Map([['haus', slotsOf({ 2: [4], 7: [3] })], ['h', slotsOf({ 1: [3, 4] })], ['neu', slotsOf({ 0: [4] })]]),
      new Map([['haus', slotsOf({ 0: [6] })], ['zug', slotsOf({ 8: [5, 6] })]]),
    ];
    const whole = new Map([
      ['haus', slotsOf({ 0: [0, 6], 2: [1, 2, 4], 7: [3] })],
      ['h', slotsOf({ 0: [0, 1, 2], 1: [3, 4] })],
      ['alt', slotsOf({ 5: [2] })],
      ['neu', slotsOf({ 0: [4] })],
      ['zug', slotsOf({ 8: [5, 6] })],
    ]);

    const merged = [];
    mergeRuns(parts.map(encodeRun), (termBuf, termStart, termEnd, postingsBuf, start) => {
      merged.push([termBuf.toString('utf8', termStart, termEnd), decodeSlots(postingsBuf, start)]);
    });
    assert.deepEqual(merged, termsOf(encodeRun(whole)));
    assert.deepEqual(merged.map(([term]) => term), ['alt', 'h', 'haus', 'neu', 'zug']);
  });

  // The build keeps its runs in a file and reads each through a window.
  test('runs in a file merge like runs in memory, whatever the window', () => {
    const long = 'x'.repeat(300);
    const many = Array.from({ length: 400 }, (_, i) => i * 2);
    const parts = [
      new Map([['a', slotsOf({ 0: [0] })], [long, slotsOf({ 1: [1] })], ['m', slotsOf({ 2: many })]]),
      new Map([['a', slotsOf({ 3: [900] })], ['b', slotsOf({ 0: [901] })], [`${long}y`, slotsOf({ 0: [902] })]]),
      new Map([['m', slotsOf({ 2: [1000, 1001] })], ['z', slotsOf({ 8: [1002] })]]),
    ];
    const runs = parts.map(encodeRun);
    const collect = (sources) => {
      const out = [];
      mergeRuns(sources, (termBuf, termStart, termEnd, postingsBuf, start) => {
        out.push([termBuf.toString('utf8', termStart, termEnd), decodeSlots(postingsBuf, start)]);
      });
      return out;
    };
    const expected = collect(runs);
    assert.equal(expected.length, 6);

    const dir = mkdtempSync(join(tmpdir(), 'idx-runs-'));
    const fd = openSync(join(dir, 'runs'), 'w+');
    try {
      let position = 7;
      const places = runs.map((run) => {
        writeSync(fd, run, 0, run.length, position);
        const place = { fd, position, length: run.length };
        position += run.length + 3;
        return place;
      });
      // A window of one byte grows to each term; the others hold a few terms,
      // one term, or the whole run.
      for (const window of [1, 2, 16, 301, 500, 1 << 16]) {
        assert.deepEqual(collect(places.map((place) => ({ ...place, window }))), expected, `window of ${window} bytes`);
      }
      assert.throws(() => collect([{ ...places[0], length: places[0].length - 1 }]), /in the middle of a term/);
      assert.throws(() => collect([{ fd, position: position + 100, length: 10 }]), /shorter than it was written/);
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('merging no runs, or empty ones, gives no terms', () => {
    const none = [];
    mergeRuns([], () => none.push(1));
    mergeRuns([encodeRun(new Map()), encodeRun(new Map())], () => none.push(1));
    assert.deepEqual(none, []);
  });
});
