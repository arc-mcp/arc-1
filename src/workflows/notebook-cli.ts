import { constants } from 'node:fs';
import { open, rmdir, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import type { CliRuntime } from '../cli.js';
import type { ToolInvoker } from './artifact.js';
import { reserveArtifactDirectory, saveWorkflowArtifact } from './artifact-files.js';
import { importAbapSql, MAX_NOTEBOOK_BYTES } from './notebook-document.js';
import { renderNotebookRun, runNotebook } from './sql-notebook.js';

async function readDocument(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_NOTEBOOK_BYTES)
      throw new Error('Notebook must be a regular file of at most 1 MiB.');
    const buffer = Buffer.alloc(MAX_NOTEBOOK_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_NOTEBOOK_BYTES) throw new Error('Notebook input exceeds 1 MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
  } finally {
    await file.close();
  }
}

export function registerNotebookCommands(program: Command, runtime: CliRuntime, call: ToolInvoker) {
  const notebook = program.command('notebook').description('Import or explicitly execute a reusable SQL notebook');
  notebook
    .command('import <file>')
    .requiredOption('--destination <name>', 'SAP editor destination being mapped')
    .requiredOption('--target <name>', 'Logical ARC-1 target name')
    .requiredOption('--out <file>', 'New notebook JSON file')
    .action(async (file: string, opts: { destination: string; target: string; out: string }) => {
      const imported = importAbapSql(await readDocument(file), { [opts.destination]: opts.target });
      const output = `${JSON.stringify(imported, null, 2)}\n`;
      if (Buffer.byteLength(output) > MAX_NOTEBOOK_BYTES)
        throw new Error('Formatted notebook exceeds the 1-MiB runner input limit.');
      await writeFile(opts.out, output, { flag: 'wx', mode: 0o600 });
      console.log(`Imported ${opts.out}; no SQL executed.`);
    });
  notebook
    .command('run <file>')
    .requiredOption('--target <name>', 'Map this logical name to the existing configured connection')
    .option('--include-results', 'Explicitly export result rows and actual assertion values')
    .requiredOption('--output-dir <directory>', 'New local report directory')
    .action(async (file: string, opts: { target: string; outputDir: string; includeResults?: boolean }) => {
      const input = await readDocument(file);
      const { config } = runtime.getResolvedConfig();
      const identity = config.targetId ?? `${config.url ? new URL(config.url).origin : 'local'}/${config.client}`;
      await reserveArtifactDirectory(opts.outputDir);
      const result = await runNotebook(
        input,
        { [opts.target]: { identity, client: config.client, call } },
        { includeResults: opts.includeResults },
      ).catch(async (error: unknown) => {
        // Remove only our empty reservation. Never delete files if another process populated it.
        await rmdir(opts.outputDir).catch(() => undefined);
        throw error;
      });
      await saveWorkflowArtifact(opts.outputDir, result, renderNotebookRun(result));
      if (result.status !== 'success') runtime.state.exitCode = 1;
    });
}
