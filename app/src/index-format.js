import { Document } from 'flexsearch';

// Version of what the index file holds: its layout, the fields of the search
// index and what the extractor puts into an entry. Raise it with every change
// to one of them, and an index file written by an earlier version is rebuilt
// from the database at the next start instead of being loaded (see
// startup.js).
//
//   1  (wp-index-flex.json without a format) content and comment text
//   2  (wp-index-flex.json) titles are indexed, as plain text (titleText);
//      entries without a WordPress user are included; only entries that are
//      public without a password
//   3  (wp-index.bin) the same entries and the same search index in a binary
//      file that is written and read in parts, see index-writer.js
export const INDEX_FORMAT = 3;

// The index file, and the files that formats 1 and 2 left in the data
// directory.
export const INDEX_FILE = 'wp-index.bin';
export const LEGACY_FILES = ['wp-index-flex.json', 'wp-index-source.json'];

// The entry fields a query is matched against. titleText and commentsText
// exist for the search only and are not part of an entry in a response.
export const TEXT_FIELDS = ['titleText', 'content'];
export const COMMENT_FIELD = 'commentsText';
export const INDEX_FIELDS = [...TEXT_FIELDS, COMMENT_FIELD];

// commentsText: what the comments of an entry say, as one text. The index
// file holds the comments once, in the entry's record.
export function commentsTextOf(comments) {
  return comments.map((c) => c.content).join(' ');
}

// The one definition of the index, for building, searching and the tests.
// FlexSearch does the tokenizing, the scoring and the matching; the entries
// and the postings it would hold in memory are kept in the index file's
// compact form instead (index-writer.js, search-index.js).
export function createIndex() {
  return new Document({
    document: {
      id: 'id',
      index: INDEX_FIELDS,
    },
    tokenize: 'forward',
    charset: 'latin:advanced',
  });
}

// The index of one field inside a FlexSearch Document, whose `map` holds the
// postings: term -> one list of ids per score. Both are internals of
// FlexSearch that the build reads and the search replaces, so their shape is
// checked here, and test/search-parity.test.js compares the results with an
// index that FlexSearch built and searched on its own.
export function fieldIndex(document, field) {
  const index = document.index instanceof Map ? document.index.get(field) : null;
  if (!index || !(index.map instanceof Map)) {
    throw new Error(`FlexSearch has no index with a term map for the field "${field}": its internals have changed.`);
  }
  return index;
}
