/** Common context and result boundary for admitted pinned native adapters. */

import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import {
  assertMutationContext,
  type MutationCleanupState,
  type PinnedMutationContext,
  pinnedMutationContext,
} from '../adt/mutation-context.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { getCurrentContext } from '../server/context.js';
import {
  pinnedCompanionAllowed,
  pinnedMutationAllowed,
  pinnedRuntimeCandidateAllowed,
} from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

export function pinnedOperationContext(
  client: AdtClient,
  config: ServerConfig,
  operation: {
    tool: string;
    args: Record<string, unknown>;
    kind?: 'mutation' | 'companion';
    timeoutMs: number;
    cleanup?: MutationCleanupState;
    responseBytes?: number;
    attempts?: number;
  },
) {
  const allowed = operation.kind === 'companion' ? pinnedCompanionAllowed : pinnedMutationAllowed;
  if (
    !allowed(operation.tool, operation.args, config) ||
    !config.targetId ||
    !client.safety.allowWrites ||
    client.safety.multiTargetWrite?.target !== config.targetId ||
    config.multiTargetWrite?.target !== config.targetId ||
    !client.safety.multiTargetWrite?.enabled ||
    !Number.isFinite(operation.timeoutMs) ||
    operation.timeoutMs <= 0 ||
    operation.timeoutMs > 300_000 ||
    !Number.isSafeInteger(operation.responseBytes ?? 8 * 1024 * 1024) ||
    (operation.responseBytes ?? 1) < 1 ||
    (operation.responseBytes ?? 0) > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(operation.attempts ?? 128) ||
    (operation.attempts ?? 1) < 1 ||
    (operation.attempts ?? 0) > 128
  )
    throw new AdtSafetyError('Operation is unavailable for this pinned target, caller policy or request budget.');
  return pinnedMutationContext(
    client.safety,
    {
      deadline: Date.now() + operation.timeoutMs,
      signal: getCurrentContext()?.signal,
      responseBudget: new DataResponseBudget(operation.responseBytes ?? 8 * 1024 * 1024, 'pinned-mutation', true),
      attemptBudget: new RequestAttemptBudget(operation.attempts ?? 128),
    },
    operation.cleanup ?? { unlockFailed: false },
  );
}

/**
 * Internal runtime boundary shared by admitted dispatch and native qualification. Its registered
 * context and exact candidate input contract cannot be supplied by tool arguments.
 */
export function assertPrivatePinnedRuntime(
  client: AdtClient,
  config: ServerConfig,
  tool: string,
  args: Record<string, unknown>,
  context: PinnedMutationContext,
): void {
  assertMutationContext(client.safety, context);
  if (
    context.mode !== 'pinned-pp' ||
    !config.targetId ||
    !client.safety.allowWrites ||
    client.safety.multiTargetWrite?.target !== config.targetId ||
    config.multiTargetWrite?.target !== config.targetId ||
    !pinnedRuntimeCandidateAllowed(tool, args, config)
  )
    throw new AdtSafetyError('Operation is unavailable for this pinned target, caller policy or input.');
}

export function pinnedOperationResult<T extends { ok: boolean; state: string }>(
  result: T,
  config: ServerConfig,
  details: { action: string; type?: string; name?: string },
): ToolResult {
  const payload = toolJson({
    ...result,
    ...(result.ok
      ? {}
      : {
          error:
            result.state === 'unchanged' || result.state.endsWith('-rejected')
              ? 'PINNED_WRITE_REFUSED'
              : 'PINNED_WRITE_INCOMPLETE',
        }),
    ...details,
    target: config.targetId,
    requestId: getCurrentContext()?.requestId,
  });
  return result.ok ? textResult(payload) : errorResult(payload);
}
