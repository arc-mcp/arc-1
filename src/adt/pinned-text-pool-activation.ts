import { ActivationEvidenceError, boundedActivationResult } from './activation-evidence-error.js';
import { pinnedPostUnlockContext } from './crud.js';
import { type ActivationOptions, activate } from './devtools.js';
import { AdtError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import type { PinnedMutationContext } from './mutation-context.js';
import { pinnedFunctionSelection } from './pinned-repository-owner.js';
import { assertPinnedSourceOwner } from './pinned-write-policy.js';
import type { SafetyConfig } from './safety.js';
import {
  type PinnedTextPoolWriteProfile,
  readOwnedTextPoolState,
  readTextElementPart,
  type TextElementPart,
  type TextElementWriteResult,
} from './text-elements.js';
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

export async function completePinnedTextPoolWrite(
  session: AdtHttpClient,
  safety: SafetyConfig,
  profile: PinnedTextPoolWriteProfile,
  part: TextElementPart,
  readback: string | undefined,
  result: TextElementWriteResult,
): Promise<void> {
  const { ownerType: type, ownerName: name, ownerPackage: pkg } = profile;
  profile.onPhase('text-activation-preflight');
  let submitted = false;
  const options = pinnedTextPoolActivationOptions(
    session,
    safety,
    type,
    name,
    async () => {
      await profile.validateActivationOwner(session);
      await readOwnedTextPoolState(session, type, name, pkg);
    },
    () => {
      submitted = true;
      profile.onPhase('text-activation', 'text-activation-unknown');
    },
  );
  let activationFailure: { error: unknown } | undefined;
  try {
    result.nativeActivation = boundedActivationResult(
      await activate(session, safety, textElementsObject(type, name), options),
    );
  } catch (error) {
    if (!submitted) throw error;
    activationFailure = { error };
    if (error instanceof ActivationEvidenceError) result.nativeActivation = error.nativeActivation;
  }
  if (!activationFailure && !result.nativeActivation?.success)
    activationFailure = {
      error: new AdtSafetyError(
        'SAP did not affirm text-pool activation execution. Inspect the pool in ADT before continuing.',
      ),
    };
  const unknown =
    activationFailure?.error instanceof AdtError && activationFailure.error.activationOutcome === 'unknown';
  profile.onPhase('text-pool-verification', unknown ? 'text-activation-unknown' : 'text-activation-not-confirmed');
  let verificationFailure: { error: unknown } | undefined;
  try {
    result.state = await readOwnedTextPoolState(session, type, name, pkg);
  } catch (error) {
    result.state = 'unknown';
    (result.verificationFailures ??= []).push('pool-state');
    verificationFailure = { error };
  }
  try {
    const active = await readTextElementPart(session, safety, type, name, part, { version: 'active' });
    result.activePartVerified = readback !== undefined && active === readback;
  } catch (error) {
    (result.verificationFailures ??= []).push('active-part');
    verificationFailure ??= { error };
  }
  // A failed observation must not replace the activation failure, status or unknown-outcome hint.
  if (activationFailure) throw activationFailure.error;
  if (verificationFailure) throw verificationFailure.error;
  if (result.state !== 'active')
    throw new AdtSafetyError(
      `SAP still reports the text pool inactive.${type === 'PROG' ? ' A never-activated program requires an explicit first owner activation.' : ''}`,
    );
  if (!result.activePartVerified)
    throw new AdtSafetyError(
      'Active text-element content does not match the saved readback. Inspect before continuing.',
    );
  profile.onPhase('complete', 'text-saved-active');
}
