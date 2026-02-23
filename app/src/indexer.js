import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Document } from 'flexsearch';
import config from './config.js';
import { extractAll } from './extractor.js';

const SOURCE_FILE = 'wp-index-source.json';
const FLEX_FILE = 'wp-index-flex.json';

export async function buildSourceFile() {
  console.log('Extracting posts and pages from WordPress database...');
  const entries = await extractAll();
  console.log(`Extracted ${entries.length} entries (posts/pages).`);

  const filePath = join(config.dataDir, SOURCE_FILE);
  await writeFile(filePath, JSON.stringify(entries, null, 2));
  console.log(`Source file written to ${filePath}`);

  await buildFlexIndex();
}

async function buildFlexIndex() {
  const sourcePath = join(config.dataDir, SOURCE_FILE);
  const flexPath = join(config.dataDir, FLEX_FILE);

  console.log('Building FlexSearch index...');
  const entries = JSON.parse(await readFile(sourcePath, 'utf-8'));

  const index = new Document({
    document: {
      id: 'id',
      index: ['content', 'commentsText'],
      store: true,
    },
    tokenize: 'forward',
    charset: 'latin:advanced',
  });

  for (const entry of entries) {
    index.add(entry);
  }
  console.log(`Indexed ${entries.length} entries.`);

  // Export FlexSearch index chunks
  const chunks = {};
  await index.export((key, data) => {
    chunks[key] = data;
  });

  const output = { entries, flexIndex: chunks };
  await writeFile(flexPath, JSON.stringify(output));
  console.log(`FlexSearch index written to ${flexPath}`);

  // Remove source file
  await unlink(sourcePath);
  console.log(`Source file ${sourcePath} deleted.`);
}
