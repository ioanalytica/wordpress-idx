import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEX_FILE } from '../src/index-format.js';
import { IndexWriter } from '../src/index-writer.js';
import { loadIndexFile } from '../src/search-index.js';

// Sample entries shaped like those the extractor yields (see extractor.js).
export const SAMPLE_ENTRIES = [
  {
    id: 1,
    type: 'post',
    author: 'Alice',
    title: 'Hello World',
    titleText: 'Hello World',
    date: '2021-03-15T10:00:00Z',
    slug: 'hello-world',
    categories: ['News'],
    tags: ['intro', 'welcome'],
    content: 'Welcome to the blog. This is the first post about gardening tomatoes.',
    commentsText: 'Nice post about tomatoes',
    comments: [{ content: 'Nice post about tomatoes' }],
  },
  {
    id: 2,
    type: 'page',
    author: 'Bob',
    title: 'About Us',
    titleText: 'About Us',
    date: '2022-07-01T10:00:00Z',
    slug: 'about-us',
    categories: ['Info'],
    tags: ['company'],
    content: 'We build tools. Our team loves gardening and green tomatoes on weekends.',
    commentsText: '',
    comments: [],
  },
  {
    id: 3,
    type: 'post',
    author: 'Alice',
    title: 'Second Post',
    titleText: 'Second Post',
    date: '2023-01-20T10:00:00Z',
    slug: 'second-post',
    categories: ['News'],
    tags: ['update'],
    content: 'A follow up story about software and testing practices.',
    commentsText: '',
    comments: [],
  },
];

// Writes `entries` into an index file, as a build does, and returns the index
// the service loads from it. `options` are those of the IndexWriter.
export async function buildTestIndex(entries = SAMPLE_ENTRIES, options) {
  const dir = mkdtempSync(join(tmpdir(), 'idx-test-'));
  try {
    const path = join(dir, INDEX_FILE);
    const writer = new IndexWriter(path, options);
    writer.add(entries);
    writer.finish();
    // A loaded index holds everything in memory; the file can go.
    return await loadIndexFile(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Mounts a router on a throwaway server and returns { baseUrl, close }.
export async function startServer(router) {
  const app = express();
  app.use(router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
