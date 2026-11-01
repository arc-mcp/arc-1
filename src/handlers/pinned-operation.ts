/** Common context and result boundary for admitted pinned native adapters. */
import type { AdtClient } from '../adt/client.js';
import { AdtSafetyError } from '../adt/errors.js';
import { type MutationCleanupState, pinnedMutationContext } from '../adt/mutation-context.js';
import { getCurrentContext } from '../server/context.js';
import { pinnedCompanionAllowed, pinnedMutationAllowed } from '../server/multi-target-write-surface.js';
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
    operation.timeoutMs > 300_000
  )
    throw new AdtSafetyError('Operation is unavailable for this pinned target, caller policy or request budget.');
  return pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + operation.timeoutMs, signal: getCurrentContext()?.signal },
    operation.cleanup ?? { unlockFailed: false },
  );
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
