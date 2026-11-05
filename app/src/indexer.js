import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import config from './config.js';
import { extractAll } from './extractor.js';
import { INDEX_FORMAT, createIndex } from './index-format.js';

const SOURCE_FILE = 'wp-index-source.json';
const FLEX_FILE = 'wp-index-flex.json';

/**
 * The parsed index file, or null when there is nothing to load: no file, a
 * file that an earlier version wrote in another format, or one that cannot be
 * read. The caller builds a new index in all three cases, so that what an
 * earlier version put into its index is not served by this one.
 */
export async function readIndexFile(dir = config.dataDir) {
  const flexPath = join(dir, FLEX_FILE);
  let text;
  try {
    text = await readFile(flexPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`Index file ${flexPath} cannot be read (${err.message}); it will be rebuilt.`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.warn(`Index file ${flexPath} is not valid JSON (${err.message}); it will be rebuilt.`);
    return null;
  }

  if (!data || data.format !== INDEX_FORMAT || !Array.isArray(data.entries) || !data.flexIndex) {
    const found = data && data.format !== undefined ? data.format : 'none';
    console.log(`Index file ${flexPath} has format ${found}, this version reads format ${INDEX_FORMAT}; it will be rebuilt.`);
    return null;
  }
  return data;
}

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

  const index = createIndex();

  for (const entry of entries) {
    index.add(entry);
  }
  console.log(`Indexed ${entries.length} entries.`);

  // Export FlexSearch index chunks
  const chunks = {};
  await index.export((key, data) => {
    chunks[key] = data;
  });

  const output = { format: INDEX_FORMAT, entries, flexIndex: chunks };
  await writeFile(flexPath, JSON.stringify(output));
  console.log(`FlexSearch index written to ${flexPath}`);

  // Remove source file
  await unlink(sourcePath);
  console.log(`Source file ${sourcePath} deleted.`);
}
