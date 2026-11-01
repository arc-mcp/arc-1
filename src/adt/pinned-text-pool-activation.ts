/** One-use internal grants for exact-pool activation after its native lock has been released. */
import { pinnedPostUnlockContext } from './crud.js';
import type { ActivationOptions } from './devtools.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import type { PinnedMutationContext } from './mutation-context.js';
import { pinnedFunctionSelection } from './pinned-function-owner.js';
import { assertPinnedSourceOwner } from './pinned-write-policy.js';
import type { SafetyConfig } from './safety.js';
import { textElementsObject } from './text-pool-identity.js';

const grants = new WeakMap<
  ActivationOptions,
  {
    http: AdtHttpClient;
    context: PinnedMutationContext;
    uri: string;
    claimed: boolean;
  }
>();

export function pinnedTextPoolActivationOptions(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectType: 'CLAS' | 'PROG' | 'FUGR',
  name: string,
  validateOwnerAndPool: () => Promise<void>,
  beforeSubmit: () => void,
): ActivationOptions {
  const context = pinnedPostUnlockContext(http, safety);
  if (objectType !== 'CLAS' && objectType !== 'PROG' && objectType !== 'FUGR')
    throw new AdtSafetyError('The text-pool owner requires its dedicated native ownership adapter.');
  if (objectType === 'FUGR') pinnedFunctionSelection(objectType, name);
  else assertPinnedSourceOwner(objectType, name);
  const uri = textElementsObject(objectType, name);
  const options: ActivationOptions = Object.freeze({
    preaudit: false,
    name,
    validateReferences: async (refs: readonly { uri: string; name?: string }[]) => {
      if (refs.length !== 1 || refs[0].uri !== uri || (refs[0].name !== undefined && refs[0].name !== name))
        throw new AdtSafetyError('Only the exact selected text pool may be activated.');
      await validateOwnerAndPool();
    },
    beforeSubmit: () => {
      throwIfRequestCancelled(context.requestPolicy);
      beforeSubmit();
    },
  });
  grants.set(options, { http, context, uri, claimed: false });
  return options;
}

/** Plain/cloned options, borrowed sessions, another URI and re-use cannot authorize this exception. */
export function assertPinnedActivationOptions(
  http: AdtHttpClient,
  safety: SafetyConfig,
  uri: string,
  options?: ActivationOptions,
): void {
  if (!safety.multiTargetWrite) return;
  if (!safety.multiTargetWrite.enabled || !options?.validateReferences)
    throw new AdtSafetyError('Missing pinned activation validation context.');
  if (options.preaudit !== false) return;
  const grant = grants.get(options);
  if (!grant || grant.http !== http || grant.uri !== uri || grant.claimed)
    throw new AdtSafetyError('Missing pinned activation validation context.');
  if (pinnedPostUnlockContext(http, safety) !== grant.context)
    throw new AdtSafetyError('Mismatched text-pool activation context.');
  grant.claimed = true;
}
