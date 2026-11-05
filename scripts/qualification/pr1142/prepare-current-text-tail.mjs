import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTextTailRun } from './run-manifest.mjs';
import { HarnessError } from './safe-io.mjs';

// No root, owners, marker, origin run, or resume selection is accepted here.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new HarnessError('EXACT_TEXT_TAIL_BINDINGS_PATH_REQUIRED');
    await prepareTextTailRun(args[0]);
  })().catch((error) => {
    console.error(error instanceof HarnessError ? error.code : 'TEXT_TAIL_PREPARATION_FAILED');
    process.exitCode = 1;
  });
