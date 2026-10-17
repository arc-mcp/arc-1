import { type Command, Option } from 'commander';
import type { ReviewMode } from '../adt/transport-diff.js';
import { type CliRuntime, executeCliToolCall } from '../cli.js';
import type { ToolInvoker } from './artifact.js';
import { reserveArtifactDirectory, saveWorkflowArtifact } from './artifact-files.js';
import { registerNotebookCommands } from './notebook-cli.js';
import { collectTransportReview, renderTransportReview } from './transport-review.js';

export function registerWorkflowCommands(program: Command, runtime: CliRuntime) {
  const call: ToolInvoker = async (tool, args) => {
    const outcome = await executeCliToolCall(runtime, tool, args);
    if (outcome.kind === 'usage') throw new Error(outcome.message);
    return outcome.result;
  };
  registerNotebookCommands(program, runtime, call);
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
        await reserveArtifactDirectory(opts.outputDir);
        const artifact = await collectTransportReview(call, request, {
          mode: opts.mode,
          syntax: opts.syntax,
          context: opts.context,
        });
        await saveWorkflowArtifact(opts.outputDir, artifact, renderTransportReview(artifact));
        if (artifact.status !== 'complete') runtime.state.exitCode = 1;
      },
    );
}
