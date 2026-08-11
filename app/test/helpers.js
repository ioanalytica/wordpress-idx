import express from 'express';
import { Document } from 'flexsearch';

// Sample entries shaped like the real index payload (see indexer.js / index.js).
export const SAMPLE_ENTRIES = [
  {
    id: 1,
    type: 'post',
    author: 'Alice',
    title: 'Hello World',
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
    date: '2023-01-20T10:00:00Z',
    slug: 'second-post',
    categories: ['News'],
    tags: ['update'],
    content: 'A follow up story about software and testing practices.',
    commentsText: '',
    comments: [],
  },
];

// Builds a FlexSearch Document + entriesMap identical in shape to production loadIndex().
export function buildTestIndex(entries = SAMPLE_ENTRIES) {
  const index = new Document({
    document: {
      id: 'id',
      index: ['content', 'commentsText'],
      store: true,
    },
    tokenize: 'forward',
    charset: 'latin:advanced',
  });

  const entriesMap = new Map();
  for (const entry of entries) {
    index.add(entry);
    entriesMap.set(entry.id, entry);
  }
  return { index, entriesMap };
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
