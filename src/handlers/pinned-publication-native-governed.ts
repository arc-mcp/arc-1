/** Internal native-governed profile selected by authenticated pinned dispatch or bound qualification. */
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext, pinnedMutationContext } from '../adt/mutation-context.js';
import { executePinnedPublicationBatch } from '../adt/pinned-publication.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { nativeGovernedPublicationRecording } from '../adt/service-publication.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationResult } from './pinned-operation.js';
import { publicationClientResult } from './pinned-publication-result.js';
import type { ToolResult } from './shared.js';

/** Runs at the existing direct/Connectivity send boundary, after queue and authentication awaits. */
class PublicationAttempts extends RequestAttemptBudget {
  constructor(
    private readonly validate: () => void,
    private readonly parent?: RequestAttemptBudget,
  ) {
    super(128);
  }
  override consume(): void {
    this.validate();
    super.consume();
    this.parent?.consume();
  }
}

export async function executePrivatePinnedNativeGovernedPublication(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
  scopes: readonly string[],
  coverage: Readonly<Pick<ServerConfig, 'systemType' | 'abapRelease'>> = config,
): Promise<ToolResult> {
  const target = config.targetId;
  let action = 'invalid';
  try {
    const input = structuredClone(args);
    action = String(input.action);
    const policy = context.recordingPolicy;
    const rawScopes = [...scopes];
    const request = getCurrentContext();
    // Native preflight authorizes these independent package rules. Changing either during an
    // asynchronous wait cannot reuse that older authorization, even while both request lists stay '*'.
    const packages = JSON.stringify([client.safety.allowedPackages, policy.allowedPackages]);
    const validate = () => {
      assertMutationContext(client.safety, context);
      if (
        !rawScopes.includes('write') ||
        !hasRequiredScope(rawScopes, 'read') ||
        !config.multiTargetEndpoints ||
        config.multiTargetAuthorization !== 'xsuaa-attribute' ||
        !pinnedWriteEnabled(config) ||
        !client.safety.allowWrites ||
        !target ||
        !TARGET_ID_PATTERN.test(target) ||
        config.targetId !== target ||
        config.multiTargetWrite !== policy ||
        policy.target !== target ||
        client.sapClient !== target.split('/')[1] ||
        config.client !== client.sapClient ||
        request?.identity === 'shared' ||
        (request?.target !== undefined && request.target !== target) ||
        getCurrentContext() !== request ||
        packages !== JSON.stringify([client.safety.allowedPackages, policy.allowedPackages]) ||
        isActionDenied('SAPActivate', action, [...config.denyActions, ...client.safety.denyActions]) ||
        (action !== 'publish_srvb' && action !== 'unpublish_srvb')
      )
        throw new AdtSafetyError(
          'Private native-governed publication is unavailable for this caller or selected strict-PP target.',
        );
    };
    validate();
    if (context.requestPolicy.deadline > Date.now() + 300_000)
      throw new AdtSafetyError('Private publication requires a deadline of at most five minutes.');
    const responseBudget =
      context.requestPolicy.responseBudget ?? new DataResponseBudget(4 * 1024 * 1024, 'publication', true);
    if (!responseBudget.countAllResponses || responseBudget.limitBytes > 4 * 1024 * 1024)
      throw new AdtSafetyError('Private publication requires an all-response allowance of at most 4 MiB.');
    let assertRecording = validate;
    const scoped = pinnedMutationContext(
      client.safety,
      {
        deadline: context.requestPolicy.deadline,
        signal:
          request?.signal && request.signal !== context.requestPolicy.signal
            ? AbortSignal.any([request.signal, ...(context.requestPolicy.signal ? [context.requestPolicy.signal] : [])])
            : context.requestPolicy.signal,
        responseBudget,
        attemptBudget: new PublicationAttempts(() => assertRecording(), context.requestPolicy.attemptBudget),
      },
      context.cleanup,
    );
    const recording = nativeGovernedPublicationRecording(client.safety, scoped, coverage, validate);
    assertRecording = recording.assert;
    return pinnedOperationResult(
      publicationClientResult(
        await executePinnedPublicationBatch(client, scoped, input, recording),
        config.minimalErrors,
      ),
      { ...config, targetId: target },
      { action },
    );
  } catch (error) {
    return pinnedOperationResult(
      {
        ok: false,
        state: 'unchanged',
        submitted: 0,
        retryable: false,
        recording: 'not-established',
        message:
          error instanceof AdtSafetyError ? error.message : 'Private publication admission could not be established.',
      },
      { ...config, targetId: target },
      { action },
    );
  }
}
