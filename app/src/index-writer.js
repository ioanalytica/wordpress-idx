// Writes the index file.
//
//   header        4096 bytes: magic, length, and a JSON document that says
//                 where the sections are
//   records       every entry as the API returns it, as JSON, one after the
//                 other in the order the entries were added
//   recordLengths varint length of each record
//   meta          per entry one line of JSON with what the filters, the
//                 statistics and the phrase match of a title need, and
//                 where the content stands in the entry's record
//   per field     postings (see postings.js), then the dictionary: per term
//                 varint length, term, varint length of its postings; then
//                 for every BLOCK_TERMS-th term where it starts in the
//                 dictionary and where its postings start, as two doubles
//
// Nothing of this is ever held as one string or one object, so the build
// needs memory for one part of the site at a time, and neither the build nor
// the file has a size at which it stops working:
//
//   1. add(): entries arrive in batches (extractor.js); their records go to
//      the file at once.
//   2. finish(): the records are read back one by one and indexed by
//      FlexSearch. After RUN_CHARS characters of text or RUN_TERMS terms its
//      term maps are packed into a run, which goes to a file of its own, and
//      emptied.
//   3. The runs are merged into the index file, term by term, and their
//      file is removed.
//
// Step 2 is one synchronous pass with one FlexSearch index, like the single
// loop over all entries it replaces, and for a reason: FlexSearch's encoder
// caches the terms it has seen, a term from the cache skips the check for
// duplicates, and the cache is emptied by a timer. The score of a term
// therefore depends on which entries were indexed before, and on whether the
// event loop ran in between. Indexing between two database queries, or with
// a new FlexSearch index per part, ranks some results differently than a
// build in one loop does (test/search-parity.test.js).
//
// The calls are synchronous, file access included: indexing occupies its
// thread anyway, which is why the service builds in a process of its own
// (build-child.js).
import { openSync, readSync, writeSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { ByteWriter, ByteReader } from './bytes.js';
import { INDEX_FORMAT, INDEX_FIELDS, createIndex, fieldIndex, commentsTextOf } from './index-format.js';
import { encodeRun, mergeRuns } from './postings.js';

export const MAGIC = Buffer.from('WPIDX\r\n\0', 'latin1');
export const HEADER_SIZE = 4096;

// Terms per block of a dictionary: a lookup finds the block by binary search
// and reads at most this many terms in it.
const BLOCK_TERMS = 64;

// What FlexSearch indexes before its term maps are packed into a run: this
// many characters of text, or this many terms in its maps, whichever comes
// first. Both bound the heap of the build. A posting takes a character of
// text at least, and as JavaScript objects a term weighs a few hundred bytes
// before its first posting: ordinary prose reaches the characters first, text
// in which few words repeat reaches the terms.
const RUN_CHARS = 2_000_000;
const RUN_TERMS = 300_000;

// An entry as the API returns it. titleText and commentsText are there for
// the search only.
function publicEntry(entry) {
  return {
    id: entry.id,
    type: entry.type,
    author: entry.author,
    title: entry.title,
    date: entry.date,
    slug: entry.slug,
    categories: entry.categories,
    tags: entry.tags,
    content: entry.content,
    comments: entry.comments || [],
  };
}

// What a request needs of every entry it looks at, without reading the
// entry's record: the fields the filters compare, the numbers /api/stats
// adds up, the title as a query is matched against it, and where the content
// stands in the record (see contentRange()).
function metaOf(entry, titleText, json) {
  const content = typeof entry.content === 'string' ? entry.content : '';
  return {
    id: entry.id,
    type: entry.type,
    author: entry.author,
    date: entry.date,
    categories: entry.categories,
    tags: entry.tags,
    titleText,
    chars: content.length,
    words: content.split(/\s+/).filter(Boolean).length,
    ...contentRange(json, entry),
  };
}

// The bytes of the record `json` that hold the content, as a JSON string. A
// phrase match and a snippet read these alone, and a response with snippets
// replaces them. Inside a JSON string a quote is escaped, so the first
// `"content":"` of a record is the key itself. The comments follow the
// content and end the record, which lets a reader take them without the rest.
const CONTENT_KEY = '"content":';
export const COMMENTS_KEY = ',"comments":';
function contentRange(json, entry) {
  if (typeof entry.content !== 'string') return null;
  const at = json.indexOf(`${CONTENT_KEY}"`);
  const value = JSON.stringify(entry.content);
  const valueAt = at + CONTENT_KEY.length;
  if (at === -1 || !json.startsWith(value, valueAt) || !json.startsWith(COMMENTS_KEY, valueAt + value.length)) return null;
  return {
    contentAt: Buffer.byteLength(json.slice(0, valueAt), 'utf8'),
    contentBytes: Buffer.byteLength(value, 'utf8'),
  };
}

const textLength = (value) => (typeof value === 'string' ? value.length : 0);

// Appends to the file through a buffer.
class FileSink {
  constructor(fd, position) {
    this.fd = fd;
    this.position = position;
    this.buf = Buffer.allocUnsafeSlow(1 << 20);
    this.fill = 0;
  }

  write(source, start = 0, end = source.length) {
    const length = end - start;
    if (length > this.buf.length - this.fill) this.flush();
    if (length > this.buf.length) {
      writeAll(this.fd, source, start, length, this.position);
    } else {
      source.copy(this.buf, this.fill, start, end);
      this.fill += length;
    }
    this.position += length;
  }

  flush() {
    if (!this.fill) return;
    writeAll(this.fd, this.buf, 0, this.fill, this.position - this.fill);
    this.fill = 0;
  }
}

function readAll(fd, buf, length, position) {
  let done = 0;
  while (done < length) {
    const read = readSync(fd, buf, done, length - done, position + done);
    if (!read) throw new Error('The index file ends before its last entry.');
    done += read;
  }
}

function writeAll(fd, buf, offset, length, position) {
  let done = 0;
  while (done < length) {
    done += writeSync(fd, buf, offset + done, length - done, position + done);
  }
}

export class IndexWriter {
  /**
   * `path` is the index file. It is written under a name of its own and gets
   * its name when it is complete, so a reader never sees half a file and a
   * build that fails leaves the previous index in place.
   */
  constructor(path, { runChars = RUN_CHARS, runTerms = RUN_TERMS } = {}) {
    this.path = path;
    this.tmpPath = `${path}.${hostname()}-${process.pid}.tmp`;
    this.runsPath = `${path}.${hostname()}-${process.pid}.runs.tmp`;
    this.runChars = runChars;
    this.runTerms = runTerms;
    this.fd = openSync(this.tmpPath, 'w+');
    this.runsFd = openSync(this.runsPath, 'w+');
    this.sink = new FileSink(this.fd, HEADER_SIZE);
    this.count = 0;
    this.recordLengths = new ByteWriter(1 << 16);
    this.meta = new ByteWriter(1 << 16);
  }

  /**
   * Adds entries as the extractor yields them, in the order a search without
   * a query returns them. Of the fields that exist for the search only,
   * titleText is taken as given; the text of the comments is taken from
   * `comments`.
   */
  add(entries) {
    for (const given of entries) {
      // As JSON, and read from it: what a response will hold. A Date is its
      // ISO string there, and what JSON does not know is gone.
      const json = JSON.stringify(publicEntry(given));
      const record = Buffer.from(json, 'utf8');
      this.sink.write(record);
      this.recordLengths.varint(record.length);
      this.meta.bytes(Buffer.from(`${JSON.stringify(metaOf(JSON.parse(json), given.titleText, json))}\n`, 'utf8'));
      this.count++;
    }
  }

  // Step 2: the records, read back and indexed. Returns, per field, where
  // the run of each part is in the file of the runs.
  indexRecords() {
    const runs = Object.fromEntries(INDEX_FIELDS.map((field) => [field, []]));
    const flex = createIndex();
    const maps = INDEX_FIELDS.map((field) => fieldIndex(flex, field).map);
    let runsLength = 0;
    const closePart = () => {
      INDEX_FIELDS.forEach((field, i) => {
        const run = encodeRun(maps[i]);
        maps[i].clear();
        if (!run.length) return;
        writeAll(this.runsFd, run, 0, run.length, runsLength);
        runs[field].push({ fd: this.runsFd, position: runsLength, length: run.length });
        runsLength += run.length;
      });
    };

    this.sink.flush();
    const lengths = new ByteReader(this.recordLengths.view());
    const meta = this.meta.view();
    let metaAt = 0;
    let position = HEADER_SIZE;
    let buf = Buffer.allocUnsafeSlow(1 << 16);
    let partChars = 0;
    for (let ordinal = 0; ordinal < this.count; ordinal++) {
      const length = lengths.varint();
      if (length > buf.length) buf = Buffer.allocUnsafeSlow(Math.max(length, buf.length * 2));
      readAll(this.fd, buf, length, position);
      position += length;
      const entry = JSON.parse(buf.toString('utf8', 0, length));

      const metaEnd = meta.indexOf(0x0a, metaAt);
      const { titleText } = JSON.parse(meta.toString('utf8', metaAt, metaEnd));
      metaAt = metaEnd + 1;

      // FlexSearch gets the entry's ordinal as its id: ordinals ascend, which
      // is what the postings are packed by.
      const commentsText = commentsTextOf(entry.comments);
      flex.add({ id: ordinal, titleText, content: entry.content, commentsText });
      partChars += textLength(titleText) + textLength(entry.content) + commentsText.length;
      if (partChars >= this.runChars || maps.reduce((terms, map) => terms + map.size, 0) >= this.runTerms) {
        closePart();
        partChars = 0;
      }
    }
    closePart();
    return runs;
  }

  section(buf) {
    const start = this.sink.position;
    this.sink.write(buf);
    return [start, buf.length];
  }

  /** Completes the file and gives it its name. Returns what it holds. */
  finish() {
    const runs = this.indexRecords();

    const { sink } = this;
    const header = {
      format: INDEX_FORMAT,
      entries: this.count,
      blockTerms: BLOCK_TERMS,
      records: [HEADER_SIZE, sink.position - HEADER_SIZE],
      recordLengths: this.section(this.recordLengths.view()),
      meta: this.section(this.meta.view()),
      fields: {},
    };

    for (const field of INDEX_FIELDS) {
      const postingsStart = sink.position;
      const dict = new ByteWriter(1 << 20);
      const blocks = [];
      let terms = 0;
      let postingsLength = 0;
      mergeRuns(runs[field], (termBuf, termStart, termEnd, postingsBuf, start, end) => {
        if (terms % BLOCK_TERMS === 0) blocks.push(dict.length, postingsLength);
        dict.varint(termEnd - termStart);
        dict.bytes(termBuf, termStart, termEnd);
        dict.varint(end - start);
        sink.write(postingsBuf, start, end);
        postingsLength += end - start;
        terms++;
      });
      runs[field] = null;

      const blockTable = Buffer.allocUnsafe(blocks.length * 8);
      blocks.forEach((value, i) => blockTable.writeDoubleLE(value, i * 8));
      header.fields[field] = {
        terms,
        postings: [postingsStart, postingsLength],
        dict: this.section(dict.view()),
        blocks: this.section(blockTable),
      };
    }

    closeSync(this.runsFd);
    this.runsFd = null;
    rmSync(this.runsPath, { force: true });

    sink.flush();
    header.size = sink.position;

    const json = Buffer.from(JSON.stringify(header), 'utf8');
    if (MAGIC.length + 4 + json.length > HEADER_SIZE) {
      throw new Error('The header of the index file does not fit its block.');
    }
    const block = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(block, 0);
    block.writeUInt32LE(json.length, MAGIC.length);
    json.copy(block, MAGIC.length + 4);
    writeAll(this.fd, block, 0, block.length, 0);

    fsyncSync(this.fd);
    closeSync(this.fd);
    this.fd = null;
    renameSync(this.tmpPath, this.path);
    return { entries: this.count, bytes: header.size };
  }

  /** Gives up: closes and removes what was written so far. */
  abort() {
    for (const key of ['fd', 'runsFd']) {
      if (this[key] === null) continue;
      try {
        closeSync(this[key]);
      } catch {
        // The files are removed below either way.
      }
      this[key] = null;
    }
    rmSync(this.tmpPath, { force: true });
    rmSync(this.runsPath, { force: true });
  }
}
