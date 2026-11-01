/** Recheck repository policy under the owning lock for every pinned source adapter. */
import type { AdtClient } from '../../adt/client.js';
import type { MutationLockPolicy } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { readPinnedFunctionOwner } from '../../adt/pinned-function-owner.js';
import { verifyPinnedProgramOwner } from '../../adt/pinned-program-owner.js';
import { type PinnedRecording, pinnedRecording, validatePinnedLock } from '../../adt/pinned-write-policy.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';

/** Fresh native owner/package/recording proof, shared by locked saves and post-unlock activation. */
export async function revalidatePinnedOwnerRecording(
  client: AdtClient,
  http: AdtHttpClient,
  context: PinnedMutationContext,
  owner: string,
  pkg: string,
  recording: PinnedRecording,
): Promise<PinnedRecording> {
  const options = context.requestPolicy;
  const active = mutationClient(client, context, http);
  const nativePackage =
    (await readPinnedFunctionOwner(active, owner))?.packageName ?? (await verifyPinnedProgramOwner(active, owner));
  const actualPackage =
    nativePackage ?? (await enforceAllowedPackageForObjectUrl(active, owner, 'Pinned mutation', undefined, options));
  if (actualPackage !== pkg) throw new AdtSafetyError('The owner package changed since preflight.');
  const fresh = await pinnedRecording(http, client.safety, owner, pkg, '', recording.request, options);
  if (fresh.local !== recording.local || fresh.request !== recording.request)
    throw new AdtSafetyError('Recording context changed since preflight.');
  return fresh;
}

export function pinnedSourceLockPolicy(
  client: AdtClient,
  context: PinnedMutationContext,
  owner: string,
  pkg: string,
  recording: PinnedRecording,
  onPhase: (phase: 'lock' | 'locked-policy') => void,
): MutationLockPolicy {
  const options = context.requestPolicy;
  return {
    beforeLock: () => {
      onPhase('lock');
      throwIfRequestCancelled(options);
    },
    validateLock: async (http, lock) => {
      onPhase('locked-policy');
      const fresh = await revalidatePinnedOwnerRecording(client, http, context, owner, pkg, recording);
      await validatePinnedLock(http, client.safety, lock, fresh, options);
    },
  };
}
