/** Manual discover/read/batch/search interface. All output artifacts remain private. */
import { readFile, stat } from 'node:fs/promises';
import { Command } from 'commander';
import { withStoredTextSession } from './adt-text-source.js';
import { TextReadError } from './errors.js';
import { liveContext } from './live-client.js';
import { findTextMatches, readClassicText, readClassicTextBatch } from './stored-text.js';

interface KeyOptions {
  object: string;
  name: string;
  id: string;
  language: string;
}
const keyFrom = (options: KeyOptions) => ({
  TDOBJECT: options.object,
  TDNAME: options.name,
  TDID: options.id,
  TDSPRAS: options.language,
});

async function inputKeys(path: string): Promise<unknown[]> {
  if ((await stat(path)).size > 64 * 1024) throw new TextReadError('LIMIT_EXCEEDED', 'key file exceeds 64 KiB');
  let keys: unknown;
  const content = await readFile(path, 'utf8');
  try {
    keys = JSON.parse(content);
  } catch {
    throw new TextReadError('INVALID_KEY', 'key file is not valid JSON');
  }
  if (!Array.isArray(keys)) throw new TextReadError('INVALID_KEY', 'key file must contain a JSON array');
  return keys;
}

async function execute<T>(name: string, operation: Parameters<typeof withStoredTextSession<T>>[2]) {
  const context = liveContext();
  await withStoredTextSession(context.client, process.env.TEST_SAP_CLIENT!, async (source) => {
    const result = await operation(source);
    // Keep admission and cumulative response allowance through serialization and file output.
    await context.save(`texts-${name}.json`, result);
  });
  process.stderr.write(
    `${JSON.stringify({ action: name, status: 'saved', artifact: `${context.label}-texts-${name}.json` })}\n`,
  );
}

const command = new Command()
  .name('arc1-stored-text')
  .description('Read classic persisted SAPscript ITF through ADT. No RFC or SAPscript rendering.');

command
  .command('discover')
  .description('Find exact stored keys under an object and literal name prefix; no decoded-content search.')
  .requiredOption('--object <object>', 'SAP text object from target-system metadata')
  .requiredOption('--prefix <prefix>', 'Literal TDNAME prefix, including any leading spaces')
  .option('--id <id>', 'Exact configured text ID')
  .option('--language <language>', 'Exact one-character SAP language key, such as E or D')
  .option('--limit <count>', 'Maximum headers (1–50)', '20')
  .action(async (options) =>
    execute('discover', (source) =>
      source.discover({
        object: options.object,
        namePrefix: options.prefix,
        id: options.id,
        language: options.language,
        limit: Number(options.limit),
      }),
    ),
  );

command
  .command('read')
  .description('Read one exact key, follow stored references, and verify a matching reread.')
  .requiredOption('--object <object>', 'SAP text object')
  .requiredOption('--name <name>', 'Exact TDNAME; leading and internal spaces matter')
  .requiredOption('--id <id>', 'Configured text ID')
  .requiredOption('--language <language>', 'One-character SAP language; no automatic fallback')
  .action(async (options: KeyOptions) => execute('read', (source) => readClassicText(source, keyFrom(options))));

command
  .command('batch')
  .description('Read 1–25 exact keys; preserve input order and report individual semantic failures.')
  .requiredOption('--keys <file>', 'JSON array of TDOBJECT, TDNAME, TDID, TDSPRAS objects')
  .action(async (options) => {
    const keys = await inputKeys(options.keys);
    await execute('batch', (source) => readClassicTextBatch(source, keys));
  });

command
  .command('search')
  .description('Find a case-sensitive literal phrase in a supplied key list; no global full-text scan.')
  .requiredOption('--keys <file>', 'JSON array of 1–25 exact text keys')
  .requiredOption('--phrase <text>', 'Literal phrase, 1–200 characters')
  .action(async (options) => {
    const keys = await inputKeys(options.keys);
    // Validate before contacting SAP.
    findTextMatches([], options.phrase);
    await execute('search', async (source) => {
      const results = await readClassicTextBatch(source, keys);
      return {
        ...findTextMatches(results, options.phrase),
        requested: results.length,
        succeeded: results.filter((item) => item.status === 'ok').length,
        errors: results.filter((item) => item.status === 'error'),
      };
    });
  });

try {
  await command.parseAsync();
} catch (error) {
  // Unlike MCP dispatch, this manual CLI has no central diagnostic redactor.
  const semantic = error instanceof TextReadError;
  process.stderr.write(
    `${JSON.stringify({
      status: 'error',
      code: semantic ? error.code : 'READ_FAILED',
      message: semantic ? error.message : 'Stored-text operation failed; verify connection, authorization and input.',
    })}\n`,
  );
  process.exitCode = 1;
}
