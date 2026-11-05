/** Pinned routing for runtime trace controls. The public entry stays closed until its capability row is admitted. */
import type { AdtClient } from '../adt/client.js';
import type { PinnedMutationContext } from '../adt/mutation-context.js';
import { mutationHttp } from '../adt/mutation-http.js';
import { cancelPinnedProfilerTrace, setPinnedSqlTraceState, startPinnedProfilerTrace } from '../adt/pinned-trace.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationContext, pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

const TRACE_MUTATIONS: readonly unknown[] = ['trace_start', 'trace_cancel', 'set_sql_trace_state'];

export function isPinnedTraceRoute(client: AdtClient, config: ServerConfig, action: unknown): boolean {
  return (
    TRACE_MUTATIONS.includes(action) && !!(config.targetId || config.multiTargetWrite || client.safety.multiTargetWrite)
  );
}

async function runPinnedTrace(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
): Promise<ToolResult> {
  const http = mutationHttp(client.http, client.safety, context);
  const action = args.action as string;
  const details = { action };
  if (action === 'trace_start')
    return pinnedOperationResult(
      await startPinnedProfilerTrace(http, client.safety, context, client.sapClient, args),
      config,
      details,
    );
  if (action === 'trace_cancel')
    return pinnedOperationResult(
      await cancelPinnedProfilerTrace(http, client.safety, context, client.sapClient, args),
      config,
      details,
    );
  return pinnedOperationResult(await setPinnedSqlTraceState(http, client.safety, context, args), config, details);
}

export async function handlePinnedTrace(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const context = pinnedOperationContext(client, config, { tool: 'SAPDiagnose', args, timeoutMs: 60_000 });
  return runPinnedTrace(client, args, config, context);
}
