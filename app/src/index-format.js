import { Document } from 'flexsearch';

// Version of what wp-index-flex.json holds: the fields of the search index
// and what the extractor puts into an entry. Raise it with every change to
// either, and an index file written by an earlier version is rebuilt from the
// database at the next start instead of being loaded (see startup.js).
//
//   1  (files without a format) content and comment text
//   2  titles are indexed, as plain text (titleText); entries without a
//      WordPress user are included; only entries that are public without a
//      password
export const INDEX_FORMAT = 2;

// The entry fields a query is matched against. titleText and commentsText
// exist for the search only and are not part of an entry in a response.
export const TEXT_FIELDS = ['titleText', 'content'];
export const COMMENT_FIELD = 'commentsText';

// The one definition of the index, for building, loading and the tests: an
// index is imported into the same shape it was exported from.
export function createIndex() {
  return new Document({
    document: {
      id: 'id',
      index: [...TEXT_FIELDS, COMMENT_FIELD],
      store: true,
    },
    tokenize: 'forward',
    charset: 'latin:advanced',
  });
}
