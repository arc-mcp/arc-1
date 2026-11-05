/** Internal qualification entry only; no public tool dispatch, capability or schema admits publication. */
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import { pinnedMutationContext } from '../adt/mutation-context.js';
import { executePinnedPublicationBatch, type PublicationConfigurationReader } from '../adt/pinned-publication.js';
import { deriveUserSafety } from '../adt/safety.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationResult } from './pinned-operation.js';
import { publicationClientResult } from './pinned-publication-result.js';

export async function handlePrivatePinnedPublication(
  original: AdtClient,
  config: ServerConfig,
  input: Record<string, unknown>,
  scopes: readonly string[],
  reader?: PublicationConfigurationReader,
) {
  try {
    const request = getCurrentContext(),
      safety = deriveUserSafety(original.safety, [...scopes]);
    const action = input.action;
    if (
      (action !== 'publish_srvb' && action !== 'unpublish_srvb') ||
      !scopes.includes('write') ||
      !hasRequiredScope([...scopes], 'read') ||
      !pinnedWriteEnabled(config) ||
      !config.multiTargetEndpoints ||
      config.multiTargetAuthorization !== 'xsuaa-attribute' ||
      !config.targetId ||
      config.multiTargetWrite?.target !== config.targetId ||
      safety.multiTargetWrite?.target !== config.targetId ||
      !safety.multiTargetWrite?.enabled ||
      !safety.allowWrites ||
      original.sapClient !== config.targetId.split('/')[1] ||
      request?.identity === 'shared' ||
      (request?.target !== undefined && request.target !== config.targetId) ||
      isActionDenied('SAPActivate', action, [...config.denyActions, ...safety.denyActions])
    )
      throw new AdtSafetyError('Private publication is unavailable for this caller or selected strict-PP target.');
    const client = original.withSafety(safety);
    const context = pinnedMutationContext(
      safety,
      {
        deadline: Date.now() + 300_000,
        signal: request?.signal,
        responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'publication', true),
      },
      { unlockFailed: false },
    );
    return pinnedOperationResult(
      publicationClientResult(
        await executePinnedPublicationBatch(client, context, input, reader),
        config.minimalErrors,
      ),
      config,
      {
        action,
      },
    );
  } catch (error) {
    return pinnedOperationResult(
      {
        ok: false,
        state: 'unchanged',
        submitted: 0,
        message: error instanceof AdtSafetyError ? error.message : 'Publication admission failed.',
      },
      config,
      { action: typeof input.action === 'string' ? input.action : 'unknown' },
    );
  }
}
