/** Internal native-governed profile selected by authenticated pinned dispatch or bound qualification. */
import type { AdtClient } from '../adt/client.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext } from '../adt/mutation-context.js';
import { executePinnedPublication } from '../adt/pinned-publication.js';
import { nativeGovernedPublicationRecording } from '../adt/service-publication.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationResult, revalidatedPinnedContext } from './pinned-operation.js';
import { publicationClientResult } from './pinned-publication-result.js';
import type { ToolResult } from './shared.js';

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
    let assertRecording = validate;
    const scoped = revalidatedPinnedContext(
      client,
      context,
      { timeoutMs: 300000, responseMiB: 4, attempts: 128, label: 'publication', resource: 'publication' },
      () => assertRecording(),
    );
    const recording = nativeGovernedPublicationRecording(client.safety, scoped, coverage, validate);
    assertRecording = recording.assert;
    return pinnedOperationResult(
      publicationClientResult(await executePinnedPublication(client, scoped, input, recording), config.minimalErrors),
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
