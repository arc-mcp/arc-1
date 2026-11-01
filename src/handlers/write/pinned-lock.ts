/** Recheck repository policy under the owning lock for every pinned source adapter. */
import type { AdtClient } from '../../adt/client.js';
import type { MutationLockPolicy } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { type PinnedRecording, pinnedRecording, validatePinnedLock } from '../../adt/pinned-write-policy.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';

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
      const actualPackage = await enforceAllowedPackageForObjectUrl(
        mutationClient(client, context, http),
        owner,
        'Pinned write under lock',
        undefined,
        options,
      );
      if (actualPackage !== pkg) throw new AdtSafetyError('The owner package changed since preflight.');
      const fresh = await pinnedRecording(http, client.safety, owner, pkg, '', recording.request, options);
      if (fresh.local !== recording.local || fresh.request !== recording.request)
        throw new AdtSafetyError('Recording context changed since preflight.');
      await validatePinnedLock(http, client.safety, lock, fresh, options);
    },
  };
}
