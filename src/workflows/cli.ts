import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Command, Option } from 'commander';
import type { ReviewMode } from '../adt/transport-diff.js';
import { type CliRuntime, executeCliToolCall } from '../cli.js';
import type { ToolInvoker } from './artifact.js';
import { collectTransportReview, renderTransportReview } from './transport-review.js';

async function save(directory: string, json: unknown, html: string) {
  // Never silently overwrite an earlier review or exported customer evidence.
  await writeFile(join(directory, 'evidence.json'), `${JSON.stringify(json, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'report.html'), html, { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${join(directory, 'evidence.json')} and ${join(directory, 'report.html')}`);
}
export function registerWorkflowCommands(program: Command, runtime: CliRuntime) {
  const call: ToolInvoker = async (tool, args) => {
    const outcome = await executeCliToolCall(runtime, tool, args);
    if (outcome.kind === 'usage') throw new Error(outcome.message);
    return outcome.result;
  };
  program
    .command('review <request>')
    .description('Collect bounded transport evidence and an HTML report')
    .addOption(
      new Option('--mode <mode>', 'Source comparison intent')
        .choices(['released', 'active', 'draft', 'legacy'])
        .default('released'),
    )
    .option('--syntax', 'Check up to ten changed objects against current active source')
    .option('--context', 'Collect current dependency context for up to three changed or uncertain objects')
    .requiredOption('--output-dir <directory>', 'New local evidence directory')
    .action(
      async (request: string, opts: { mode: ReviewMode; syntax?: boolean; context?: boolean; outputDir: string }) => {
        // Reserve a new private directory before SAP work; never mix a new JSON file with an old HTML report.
        await mkdir(dirname(opts.outputDir), { recursive: true });
        await mkdir(opts.outputDir, { mode: 0o700 });
        const artifact = await collectTransportReview(call, request, {
          mode: opts.mode,
          syntax: opts.syntax,
          context: opts.context,
        });
        await save(opts.outputDir, artifact, renderTransportReview(artifact));
        if (artifact.status !== 'complete') runtime.state.exitCode = 1;
      },
    );
}
