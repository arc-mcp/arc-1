/** Internal native-governed profile selected by authenticated pinned dispatch or bound qualification. */
import type { AdtClient } from '../adt/client.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext } from '../adt/mutation-context.js';
import { createNativeGovernedFlpRecording, executePinnedFlpMutation } from '../adt/pinned-flp.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import type { ServerConfig } from '../server/types.js';
import { assertPrivatePinnedRuntime, pinnedOperationResult, revalidatedPinnedContext } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

/** Scopes and the factory-registered context belong to the authenticated invocation, never its args. */
export async function executePrivatePinnedNativeGovernedFlp(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
  scopes: readonly string[],
  coverage: Readonly<Pick<ServerConfig, 'systemType' | 'abapRelease'>> = config,
): Promise<ToolResult> {
  let action = 'invalid';
  const selectedTarget = config.targetId;
  try {
    const input = structuredClone(args);
    action = String(input.action);
    const target = selectedTarget;
    const policy = context.recordingPolicy;
    const rawScopes = [...scopes];
    const request = getCurrentContext();
    const validate = () => {
      assertMutationContext(client.safety, context);
      if (
        !rawScopes.includes('write') ||
        !hasRequiredScope(rawScopes, 'read') ||
        !config.multiTargetEndpoints ||
        !target ||
        !TARGET_ID_PATTERN.test(target) ||
        config.targetId !== target ||
        config.multiTargetWrite !== policy ||
        policy.target !== target ||
        client.sapClient !== target.split('/')[1] ||
        config.client !== client.sapClient ||
        (request?.target !== undefined && request.target !== target) ||
        request?.identity === 'shared' ||
        getCurrentContext() !== request ||
        isActionDenied('SAPManage', action, [...config.denyActions, ...client.safety.denyActions]) ||
        !action.startsWith('flp_') ||
        action.startsWith('flp_list_')
      )
        throw new AdtSafetyError('Private native-governed FLP is unavailable for this caller or selected target.');
      assertPrivatePinnedRuntime(client, config, 'SAPManage', input, context);
    };
    validate();
    let assertRecording = validate;
    const scoped = revalidatedPinnedContext(
      client,
      context,
      { timeoutMs: 300000, responseMiB: 8, attempts: 32, label: 'FLP', resource: 'flp-native' },
      () => assertRecording(),
    );
    const profile = createNativeGovernedFlpRecording(client.safety, scoped, coverage, validate);
    assertRecording = profile.assert;
    return pinnedOperationResult(
      await executePinnedFlpMutation(client.http, client.safety, scoped, input, profile),
      { ...config, targetId: selectedTarget },
      { action },
    );
  } catch (error) {
    return pinnedOperationResult(
      {
        ok: false,
        state: 'unchanged',
        phase: 'validation',
        retryable: false,
        resource: 'classic-flp-client-content',
        recording: 'not-established',
        message: error instanceof AdtSafetyError ? error.message : 'Private FLP admission could not be established.',
      },
      { ...config, targetId: selectedTarget },
      { action },
    );
  }
}
