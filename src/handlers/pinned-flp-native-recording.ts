/** Internal native-governed profile selected by authenticated pinned dispatch or bound qualification. */
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext, pinnedMutationContext } from '../adt/mutation-context.js';
import { createNativeGovernedFlpRecording, executePinnedFlpMutation } from '../adt/pinned-flp.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import type { ServerConfig } from '../server/types.js';
import { assertPrivatePinnedRuntime, pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

/** The existing final-send allowance runs after CSRF, authentication, session and semaphore awaits. */
class FlpAttempts extends RequestAttemptBudget {
  constructor(
    private readonly validate: () => void,
    private readonly parent?: RequestAttemptBudget,
  ) {
    super(32);
  }
  override consume(): void {
    this.validate();
    super.consume();
    this.parent?.consume();
  }
}

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
    if (context.requestPolicy.deadline > Date.now() + 300_000)
      throw new AdtSafetyError('Private FLP requires a deadline of at most five minutes.');
    const responseBudget =
      context.requestPolicy.responseBudget ?? new DataResponseBudget(8 * 1024 * 1024, 'flp-native', true);
    if (!responseBudget.countAllResponses || responseBudget.limitBytes > 8 * 1024 * 1024)
      throw new AdtSafetyError('Private FLP requires an all-response allowance of at most 8 MiB.');
    // The child keeps the original deadline/cancellation/cleanup and charges any parent send allowance.
    // Its own guarded allowance cannot be replaced by nested create/read options.
    let assertRecording = validate;
    const attempts = new FlpAttempts(() => assertRecording(), context.requestPolicy.attemptBudget);
    const scoped = pinnedMutationContext(
      client.safety,
      {
        deadline: context.requestPolicy.deadline,
        signal:
          request?.signal && request.signal !== context.requestPolicy.signal
            ? AbortSignal.any([request.signal, ...(context.requestPolicy.signal ? [context.requestPolicy.signal] : [])])
            : context.requestPolicy.signal,
        responseBudget,
        attemptBudget: attempts,
      },
      context.cleanup,
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
