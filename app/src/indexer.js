import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import config from './config.js';
import { extractAll } from './extractor.js';

const SOURCE_FILE = 'wp-index-source.json';

export async function buildSourceFile() {
  console.log('Extracting posts and pages from WordPress database...');
  const entries = await extractAll();
  console.log(`Extracted ${entries.length} entries (posts/pages).`);

  const filePath = join(config.dataDir, SOURCE_FILE);
  await writeFile(filePath, JSON.stringify(entries, null, 2));
  console.log(`Source file written to ${filePath}`);

  return entries.length;
}
