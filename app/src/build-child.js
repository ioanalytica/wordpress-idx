// The process that buildIndexInChild() (indexer.js) starts: builds the index
// file in the directory it is given and reports how it went.
import { buildIndexFile } from './indexer.js';

if (!process.send) {
  console.error('build-child.js is started by the service, see buildIndexInChild() in indexer.js.');
  process.exit(2);
}

// The service is gone: nobody waits for this build.
process.on('disconnect', () => process.exit(1));

let result;
try {
  result = { ok: true, summary: await buildIndexFile(process.argv[2]) };
} catch (err) {
  result = { ok: false, message: err.message };
}
process.send(result, () => process.exit(0));
