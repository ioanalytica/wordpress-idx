// The postings of the search index in bytes.
//
// FlexSearch keeps, for every term of a field, one list of entry ids per
// score ("slot": 0 is the best, the resolution of the index is the number of
// slots). As JavaScript arrays these lists are most of what a large index
// weighs. Here an entry is named by its ordinal, its position in the order
// the entries were added, and a list holds the distances between ordinals:
// one or two bytes per posting.
//
//   postings of a term:  varint mask of the slots that have a list, then per
//                        list: varint count, varint first ordinal, varint
//                        distance to the previous ordinal ...
//   run:                 per term, in the byte order of its UTF-8 form:
//                        varint length, term, varint length, postings
//
// A run holds the terms of the entries of one part of the build. Entries are
// added in ascending ordinals and a term's postings in an entry depend on
// that entry alone, so the runs of all parts merge into the postings of the
// whole index by concatenating the lists of each term and slot.
import { readSync } from 'node:fs';
import { ByteWriter, ByteReader } from './bytes.js';

// The slots of a term fit a bit mask.
const MAX_SLOTS = 30;

export function encodeSlots(writer, slots) {
  if (slots.length > MAX_SLOTS) {
    throw new Error(`A term has ${slots.length} score slots, the index file holds up to ${MAX_SLOTS}.`);
  }
  let mask = 0;
  for (let s = 0; s < slots.length; s++) {
    if (slots[s] && slots[s].length) mask |= 1 << s;
  }
  writer.varint(mask);
  for (let s = 0; s < slots.length; s++) {
    const list = slots[s];
    if (!list || !list.length) continue;
    writer.varint(list.length);
    let previous = 0;
    for (let i = 0; i < list.length; i++) {
      const ordinal = list[i];
      if (i > 0 && ordinal <= previous) {
        throw new Error('The postings of a term are not in the order the entries were added.');
      }
      writer.varint(ordinal - previous);
      previous = ordinal;
    }
  }
}

// The slots as FlexSearch holds them: an array with a list per slot and holes
// in between. With `ids`, a list holds ids[ordinal] instead of the ordinal.
export function decodeSlots(buf, start, ids) {
  const reader = new ByteReader(buf, start);
  const slots = [];
  let mask = reader.varint();
  for (let s = 0; mask; s++, mask >>>= 1) {
    if (!(mask & 1)) continue;
    const count = reader.varint();
    const list = new Array(count);
    let ordinal = 0;
    for (let i = 0; i < count; i++) {
      ordinal += reader.varint();
      list[i] = ids ? ids[ordinal] : ordinal;
    }
    slots[s] = list;
  }
  return slots;
}

// The term map of a FlexSearch index (term -> slots of ordinals) as a run.
export function encodeRun(map) {
  const terms = [];
  for (const [term, slots] of map) {
    // The "forward" tokenizer cuts a term into its prefixes by UTF-16 unit,
    // which leaves half a surrogate pair at the end of some. No query can
    // name such a term, and it has no UTF-8 form to sort by.
    if (!term.isWellFormed()) continue;
    terms.push([Buffer.from(term, 'utf8'), slots]);
  }
  terms.sort((a, b) => Buffer.compare(a[0], b[0]));

  const run = new ByteWriter(1 << 20);
  const postings = new ByteWriter();
  for (const [term, slots] of terms) {
    postings.reset();
    encodeSlots(postings, slots);
    run.varint(term.length);
    run.bytes(term);
    run.varint(postings.length);
    run.bytes(postings.buf, 0, postings.length);
  }
  return run.take();
}

// What a cursor keeps of a run that is in a file.
const WINDOW = 1 << 16;

// Reads a run term by term: from a Buffer, or from a file ({ fd, position,
// length }), of which it holds a window.
class RunCursor {
  constructor(source, order) {
    this.order = order;
    if (Buffer.isBuffer(source)) {
      this.buf = source;
      this.end = source.length;
      this.fd = null;
      this.remaining = 0;
    } else {
      this.buf = Buffer.allocUnsafe(Math.max(1, Math.min(source.window || WINDOW, source.length)));
      this.end = 0;
      this.fd = source.fd;
      this.filePosition = source.position;
      this.remaining = source.length;
    }
    this.pos = 0;
    this.done = false;
    this.next();
  }

  // To the next term. Its bytes stay where they are until the call after.
  next() {
    while (!this.parse()) {
      if (!this.remaining) {
        if (this.pos < this.end) throw new Error('A run of the index build ends in the middle of a term.');
        this.done = true;
        return;
      }
      this.refill();
    }
  }

  // Reads the term at `pos`. False when the buffer ends before the term
  // does; `needed` then says how many bytes from `pos` are known to be
  // missing at least.
  parse() {
    const { buf, end } = this;
    let at = this.pos;
    const lengths = [0, 0];
    let termStart = 0;
    for (let i = 0; i < 2; i++) {
      let factor = 1;
      let byte;
      do {
        if (at >= end) {
          this.needed = at - this.pos + 1;
          return false;
        }
        byte = buf[at++];
        lengths[i] += (byte & 127) * factor;
        factor *= 128;
      } while (byte > 127);
      if (i === 0) {
        termStart = at;
        at += lengths[0];
      }
    }
    if (at + lengths[1] > end) {
      this.needed = at + lengths[1] - this.pos;
      return false;
    }
    this.termStart = termStart;
    this.termEnd = termStart + lengths[0];
    this.postingsStart = at;
    this.postingsEnd = at + lengths[1];
    this.pos = this.postingsEnd;
    return true;
  }

  // Moves what is not read yet to the start of the buffer, which grows when
  // a term does not fit it, and fills the rest from the file.
  refill() {
    const kept = this.end - this.pos;
    if (this.needed > this.buf.length) {
      const grown = Buffer.allocUnsafe(Math.max(this.needed, this.buf.length * 2));
      this.buf.copy(grown, 0, this.pos, this.end);
      this.buf = grown;
    } else {
      this.buf.copyWithin(0, this.pos, this.end);
    }
    this.pos = 0;
    this.end = kept;
    const wanted = Math.min(this.buf.length - kept, this.remaining);
    let done = 0;
    while (done < wanted) {
      const read = readSync(this.fd, this.buf, kept + done, wanted - done, this.filePosition + done);
      if (!read) throw new Error('A run of the index build is shorter than it was written.');
      done += read;
    }
    this.end += wanted;
    this.filePosition += wanted;
    this.remaining -= wanted;
  }
}

function compareTerms(a, b) {
  return a.buf.compare(b.buf, b.termStart, b.termEnd, a.termStart, a.termEnd);
}

// By term, and for the same term by the order of the runs.
function before(a, b) {
  const byTerm = compareTerms(a, b);
  return byTerm ? byTerm < 0 : a.order < b.order;
}

function siftUp(heap, at) {
  const item = heap[at];
  while (at > 0) {
    const parent = (at - 1) >> 1;
    if (!before(item, heap[parent])) break;
    heap[at] = heap[parent];
    at = parent;
  }
  heap[at] = item;
}

function siftDown(heap, at) {
  const item = heap[at];
  const half = heap.length >> 1;
  while (at < half) {
    let child = 2 * at + 1;
    if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
    if (!before(heap[child], item)) break;
    heap[at] = heap[child];
    at = child;
  }
  heap[at] = item;
}

function pop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    siftDown(heap, 0);
  }
  return top;
}

/**
 * Merges runs, given in the order their entries were added, each a Buffer or
 * the place of the run in a file ({ fd, position, length }), and calls
 *
 *   emit(termBuf, termStart, termEnd, postingsBuf, postingsStart, postingsEnd)
 *
 * once per term, in the byte order of the terms. The buffers are valid during
 * the call only.
 */
export function mergeRuns(runs, emit) {
  const heap = [];
  runs.forEach((buf, order) => {
    const cursor = new RunCursor(buf, order);
    if (!cursor.done) {
      heap.push(cursor);
      siftUp(heap, heap.length - 1);
    }
  });

  const merged = new ByteWriter();
  const group = [];
  while (heap.length) {
    const first = pop(heap);
    group.length = 0;
    while (heap.length && compareTerms(heap[0], first) === 0) group.push(pop(heap));

    if (group.length === 0) {
      emit(first.buf, first.termStart, first.termEnd, first.buf, first.postingsStart, first.postingsEnd);
    } else {
      // The same term in several runs: one list per slot, run after run.
      const slots = decodeSlots(first.buf, first.postingsStart);
      for (const cursor of group) {
        const more = decodeSlots(cursor.buf, cursor.postingsStart);
        for (let s = 0; s < more.length; s++) {
          if (!more[s]) continue;
          if (!slots[s]) {
            slots[s] = more[s];
          } else {
            const list = slots[s];
            for (let i = 0; i < more[s].length; i++) list.push(more[s][i]);
          }
        }
      }
      merged.reset();
      encodeSlots(merged, slots);
      emit(first.buf, first.termStart, first.termEnd, merged.buf, 0, merged.length);
    }

    first.next();
    if (!first.done) {
      heap.push(first);
      siftUp(heap, heap.length - 1);
    }
    for (const cursor of group) {
      cursor.next();
      if (!cursor.done) {
        heap.push(cursor);
        siftUp(heap, heap.length - 1);
      }
    }
  }
}
