// Reads the index file (index-writer.js) and answers from it.
//
// The sections stay in the Buffers they were read into. The JavaScript heap
// holds one small object per entry (its meta line) and nothing per term: a
// term is found by binary search in its field's dictionary, and its postings
// are decoded when a query asks for them. FlexSearch still runs every query;
// it gets the postings from here instead of from maps of its own.
import { open } from 'node:fs/promises';
import { ByteReader } from './bytes.js';
import { INDEX_FORMAT, INDEX_FIELDS, createIndex, fieldIndex } from './index-format.js';
import { MAGIC, HEADER_SIZE, COMMENTS_KEY } from './index-writer.js';
import { decodeSlots } from './postings.js';

// One read() takes up to 2 GiB; a section may be larger.
const READ_CHUNK = 1 << 30;

/** Thrown for a file that is there and is not an index this version reads. */
export class IndexFileError extends Error {
  constructor(message, { format } = {}) {
    super(message);
    this.name = 'IndexFileError';
    // The format the file names, when it is the format that does not fit.
    this.format = format;
  }
}

async function readSection(file, [start, length]) {
  const buf = Buffer.allocUnsafeSlow(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await file.read(buf, done, Math.min(READ_CHUNK, length - done), start + done);
    if (!bytesRead) throw new IndexFileError('it ends before its last section');
    done += bytesRead;
  }
  return buf;
}

const isSection = (value) =>
  Array.isArray(value) && value.length === 2 && value.every((n) => Number.isSafeInteger(n) && n >= 0);

async function readHeader(file) {
  const { size } = await file.stat();
  const block = Buffer.alloc(HEADER_SIZE);
  const { bytesRead } = await file.read(block, 0, HEADER_SIZE, 0);
  if (bytesRead < HEADER_SIZE || !block.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new IndexFileError('it is not an index file');
  }
  const length = block.readUInt32LE(MAGIC.length);
  let header;
  try {
    header = JSON.parse(block.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + length));
  } catch {
    throw new IndexFileError('its header cannot be read');
  }
  if (!header || header.format !== INDEX_FORMAT) {
    throw new IndexFileError('it has another format', { format: header ? header.format : undefined });
  }

  const sections = [header.records, header.recordLengths, header.meta];
  for (const field of INDEX_FIELDS) {
    const parts = header.fields && header.fields[field];
    if (!parts || !Number.isSafeInteger(parts.terms)) throw new IndexFileError(`it has no index of the field ${field}`);
    sections.push(parts.postings, parts.dict, parts.blocks);
  }
  const complete =
    Number.isSafeInteger(header.entries) &&
    Number.isSafeInteger(header.blockTerms) &&
    header.blockTerms > 0 &&
    header.size === size &&
    sections.every((section) => isSection(section) && section[0] + section[1] <= size);
  if (!complete) throw new IndexFileError('it is incomplete');
  return header;
}

// Strings that many entries share (a type, an author, a category) once.
function interner() {
  const seen = new Map();
  return (value) => {
    if (typeof value !== 'string') return value;
    const known = seen.get(value);
    if (known !== undefined) return known;
    seen.set(value, value);
    return value;
  };
}

function parseMeta(buf, count) {
  const metas = new Array(count);
  const intern = interner();
  let start = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const end = buf.indexOf(0x0a, start);
    if (end === -1) throw new IndexFileError('it has fewer entries than its header says');
    let meta;
    try {
      meta = JSON.parse(buf.toString('utf8', start, end));
    } catch {
      throw new IndexFileError('the description of an entry cannot be read');
    }
    meta.type = intern(meta.type);
    meta.author = intern(meta.author);
    if (Array.isArray(meta.categories)) meta.categories = meta.categories.map(intern);
    if (Array.isArray(meta.tags)) meta.tags = meta.tags.map(intern);
    meta.ordinal = ordinal;
    metas[ordinal] = meta;
    start = end + 1;
  }
  return metas;
}

function recordOffsets(buf, count, total) {
  const offsets = new Float64Array(count + 1);
  const reader = new ByteReader(buf);
  let at = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    offsets[ordinal] = at;
    at += reader.varint();
  }
  offsets[count] = at;
  if (at !== total) throw new IndexFileError('its entries do not have the length its header says');
  return offsets;
}

// A field's dictionary and postings.
class FieldPostings {
  constructor({ terms, blockTerms, dict, blocks, postings }) {
    this.terms = terms;
    this.blockTerms = blockTerms;
    this.dict = dict;
    this.postings = postings;
    this.blockCount = Math.ceil(terms / blockTerms);
    if (blocks.length !== this.blockCount * 16) throw new IndexFileError('the dictionary of a field is incomplete');
    this.dictAt = new Float64Array(this.blockCount);
    this.postingsAt = new Float64Array(this.blockCount);
    for (let b = 0; b < this.blockCount; b++) {
      this.dictAt[b] = blocks.readDoubleLE(b * 16);
      this.postingsAt[b] = blocks.readDoubleLE(b * 16 + 8);
    }
    this.reader = new ByteReader(dict);
  }

  // Where the postings of `term` (UTF-8) start, or -1.
  find(term) {
    const { dict, reader } = this;

    // The last block whose first term is not after the term.
    let low = 0;
    let high = this.blockCount - 1;
    let block = -1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      reader.pos = this.dictAt[mid];
      const length = reader.varint();
      if (dict.compare(term, 0, term.length, reader.pos, reader.pos + length) <= 0) {
        block = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (block === -1) return -1;

    reader.pos = this.dictAt[block];
    let at = this.postingsAt[block];
    const inBlock = Math.min(this.blockTerms, this.terms - block * this.blockTerms);
    for (let i = 0; i < inBlock; i++) {
      const length = reader.varint();
      const order = dict.compare(term, 0, term.length, reader.pos, reader.pos + length);
      if (order === 0) return at;
      if (order > 0) return -1;
      reader.pos += length;
      at += reader.varint();
    }
    return -1;
  }
}

export class SearchIndex {
  constructor({ header, records, recordLengths, meta, fields, file = null }) {
    /** Number of entries. */
    this.size = header.entries;
    /** The file the index was loaded from: dev, ino, size, mtimeMs. */
    this.file = file;
    /** Bytes the index holds in memory outside the JavaScript heap. */
    this.bytes = records.length;
    this.records = records;
    this.offsets = recordOffsets(recordLengths, this.size, records.length);

    /**
     * Per entry, in the order the entries were added: id, type, author, date,
     * categories, tags, titleText, chars and words (of its content), ordinal,
     * and where the content stands in the record (contentAt, contentBytes).
     */
    this.metas = parseMeta(meta, this.size);
    this.byId = new Map();
    this.ids = new Array(this.size);
    for (const entry of this.metas) {
      this.byId.set(entry.id, entry);
      this.ids[entry.ordinal] = entry.id;
    }

    // FlexSearch reads a term's postings with map.get(term); nothing else of
    // an index is used by a search.
    this.flex = createIndex();
    this.fields = {};
    for (const field of INDEX_FIELDS) {
      const postings = new FieldPostings({ ...fields[field], blockTerms: header.blockTerms });
      this.fields[field] = postings;
      this.bytes += postings.dict.length + postings.postings.length;
      fieldIndex(this.flex, field).map = { get: (term) => this.postings(field, term) };
    }
  }

  /**
   * The postings of `term` in `field` as FlexSearch holds them, one list of
   * ids per score, or undefined when the field has no such term.
   */
  postings(field, term) {
    const { [field]: found } = this.fields;
    const at = found.find(Buffer.from(term, 'utf8'));
    return at === -1 ? undefined : decodeSlots(found.postings, at, this.ids);
  }

  /**
   * The ids that match `query`, per field in FlexSearch's order: best score
   * first, within a score in the order the entries were added. Without a
   * limit FlexSearch returns 100 matches per field. Every entry can match, so
   * the number of entries is the limit that cuts nothing off.
   */
  search(query, fields) {
    return this.flex.search(query, { index: fields, limit: Math.max(this.size, 1) });
  }

  /**
   * Gives the memory of the index back at once, instead of when the garbage
   * collector gets to its Buffers: after a reindex that is the difference
   * between one index in memory and two. The index cannot be used afterwards.
   */
  release() {
    const buffers = [this.records];
    for (const field of Object.values(this.fields)) buffers.push(field.dict, field.postings);
    // Each was allocated on its own (readSection), so its ArrayBuffer holds
    // nothing else.
    for (const buf of buffers) buf.buffer.transfer(0);
    this.size = 0;
    this.metas = [];
    this.byId = new Map();
  }

  /** The entry as the API returns it, as the bytes of its JSON. */
  record(meta) {
    return this.records.subarray(this.offsets[meta.ordinal], this.offsets[meta.ordinal + 1]);
  }

  /** The content of the entry, read from its record alone. */
  content(meta) {
    if (!meta.contentBytes) return this.entry(meta).content;
    const start = this.offsets[meta.ordinal] + meta.contentAt;
    return JSON.parse(this.records.toString('utf8', start, start + meta.contentBytes));
  }

  /** The comments of the entry, read from its record alone. */
  comments(meta) {
    if (!meta.contentBytes) return this.entry(meta).comments;
    // They follow the content and end the record: ..."content":"…","comments":[…]}
    const start = this.offsets[meta.ordinal] + meta.contentAt + meta.contentBytes + COMMENTS_KEY.length;
    return JSON.parse(this.records.toString('utf8', start, this.offsets[meta.ordinal + 1] - 1));
  }

  /** The entry as the API returns it. */
  entry(meta) {
    return JSON.parse(this.records.toString('utf8', this.offsets[meta.ordinal], this.offsets[meta.ordinal + 1]));
  }
}

/**
 * Loads the index file at `path`. Rejects with the error of the file system
 * when the file cannot be opened (ENOENT: there is none), and with an
 * IndexFileError when it is not an index of this version's format.
 */
export async function loadIndexFile(path) {
  const file = await open(path, 'r');
  try {
    // Which file this is: index-follower.js compares it with the file at
    // `path` to tell whether another sidecar has replaced it since.
    const { dev, ino, size, mtimeMs } = await file.stat();
    const header = await readHeader(file);
    const fields = {};
    for (const field of INDEX_FIELDS) {
      const parts = header.fields[field];
      fields[field] = {
        terms: parts.terms,
        dict: await readSection(file, parts.dict),
        blocks: await readSection(file, parts.blocks),
        postings: await readSection(file, parts.postings),
      };
    }
    return new SearchIndex({
      header,
      records: await readSection(file, header.records),
      recordLengths: await readSection(file, header.recordLengths),
      meta: await readSection(file, header.meta),
      fields,
      file: { dev, ino, size, mtimeMs },
    });
  } finally {
    await file.close();
  }
}
