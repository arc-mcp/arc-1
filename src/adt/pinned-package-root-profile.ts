/** Private package CREATE source coverage; distinct from FLP recording and verified CTS receipts. */

import { hasExplicitUnrestrictedRequestPolicy } from './allowlist-policy.js';
import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { checkOperation, isPackageAllowed, OperationType } from './safety.js';

export interface PinnedLocalRootProfile {
  readonly kind: 'native-governed-unverified';
  readonly name: string;
  readonly context: PinnedMutationContext;
  readonly assert: () => void;
}
const profiles = new WeakMap<PinnedLocalRootProfile, AdtClient>();

export function createPinnedLocalRootProfile(
  client: AdtClient,
  context: PinnedMutationContext,
  name: string,
  coverage: { systemType: string; abapRelease?: string },
  validateInvocation: () => void,
): PinnedLocalRootProfile {
  const safety = client.safety;
  const assert = () => {
    assertMutationContext(safety, context);
    throwIfRequestCancelled(context.requestPolicy);
    checkOperation(safety, OperationType.Create, 'PinnedCreatePackage');
    if (
      coverage.systemType !== 'onprem' ||
      coverage.abapRelease !== '758' ||
      name === '$TMP' ||
      name.length > 30 ||
      !/^\$[A-Z0-9_]+$/.test(name) ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.allowedTransports) ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.serverAllowedTransports)
    )
      throw new AdtSafetyError(
        'Private LOCAL root creation requires on-premise 758 and explicit unrestricted "*" on both request policies.',
      );
    // No ancestor can be established for an absent root. Exact/name-prefix/self-root grants only.
    if (!isPackageAllowed(safety, name))
      throw new AdtSafetyError('Both package policies must authorize the future root name without assumed ancestry.');
    validateInvocation();
  };
  assert();
  const profile: PinnedLocalRootProfile = Object.freeze({ kind: 'native-governed-unverified', name, context, assert });
  profiles.set(profile, client);
  return profile;
}

export function assertPinnedLocalRootProfile(
  client: AdtClient,
  context: PinnedMutationContext,
  name: string,
  profile?: PinnedLocalRootProfile,
): void {
  if (!profile || profiles.get(profile) !== client || profile.context !== context || profile.name !== name)
    throw new AdtSafetyError('Missing or mismatched private LOCAL root profile.');
  assertMutationContext(client.safety, context);
  profile.assert();
}
