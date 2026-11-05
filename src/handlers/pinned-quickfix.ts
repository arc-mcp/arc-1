/** Private qualification entry only. Public dispatch/capability admission remains closed. */
import type { AdtClient } from '../adt/client.js';
import { AdtApiError, AdtSafetyError } from '../adt/errors.js';
import { pinnedMutationContext } from '../adt/mutation-context.js';
import { parsePinnedQuickfixInput } from '../adt/pinned-quickfix-input.js';
import { applyFixProposal } from '../adt/quickfix.js';
import { deriveUserSafety } from '../adt/safety.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import type { ServerConfig } from '../server/types.js';
import { assertPrivatePinnedRuntime, pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

export async function executePrivatePinnedQuickfix(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  scopes: readonly string[],
): Promise<ToolResult> {
  let admitted = false;
  try {
    const request = getCurrentContext();
    if (
      !config.multiTargetEndpoints ||
      !scopes.includes('write') ||
      !hasRequiredScope([...scopes], 'read') ||
      !config.targetId ||
      client.sapClient !== config.targetId.split('/')[1] ||
      (request?.target !== undefined && request.target !== config.targetId) ||
      request?.identity === 'shared' ||
      isActionDenied('SAPDiagnose', 'apply_quickfix', [...config.denyActions, ...client.safety.denyActions])
    )
      throw new AdtSafetyError('Private quickfix is unavailable for this target or caller.');
    const scoped = client.withSafety(deriveUserSafety(client.safety, [...scopes]));
    const context = pinnedMutationContext(
      scoped.safety,
      { deadline: Date.now() + 60_000, signal: request?.signal },
      { unlockFailed: false },
    );
    assertPrivatePinnedRuntime(scoped, config, 'SAPDiagnose', args, context);
    const input = parsePinnedQuickfixInput(args);
    admitted = true;
    const deltas = await applyFixProposal(
      scoped.http,
      scoped.safety,
      input.proposal,
      input.sourceUri,
      input.source,
      input.line,
      input.column,
      { mode: 'pinned-pp', context, owner: input.owner },
    );
    return pinnedOperationResult({ ok: true, state: 'computed', sourceSaved: false, deltas }, config, {
      action: 'apply_quickfix',
    });
  } catch (error) {
    return pinnedOperationResult(
      {
        ok: false,
        state: admitted ? 'computation-unverified' : 'unchanged',
        sourceSaved: false,
        reason: error instanceof AdtSafetyError ? error.message : 'Native quickfix computation could not be verified.',
        ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
      },
      config,
      { action: 'apply_quickfix' },
    );
  }
}
