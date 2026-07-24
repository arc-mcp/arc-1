/** Authorization-safe, success-only feature state for discovered targets. */

import type { ResolvedFeatures } from '../adt/types.js';

const probeFlights = new Map<string, Promise<void>>();

export function hasAuthorizationLimitedFeatureEvidence(features: ResolvedFeatures): boolean {
  const authMarker = /(authorization|auth failure|forbidden|\b401\b|\b403\b)/i;
  const featureStatuses = [
    features.hana,
    features.abapGit,
    features.gcts,
    features.rap,
    features.amdp,
    features.ui5,
    features.transport,
    features.ui5repo,
    features.flp,
  ];
  if (featureStatuses.some((status) => !status.available && authMarker.test(status.message ?? ''))) return true;
  if (!features.textSearch?.available && authMarker.test(features.textSearch?.reason ?? '')) return true;
  return [features.authProbe?.searchReason, features.authProbe?.transportReason].some((reason) =>
    authMarker.test(reason ?? ''),
  );
}

/** One in-flight probe per target. Rejections are observed, cleared, and never cached. */
export async function ensureMultiTargetFeatureProbe(
  target: string | undefined,
  alreadyKnown: boolean,
  probe: () => Promise<void>,
  clearFailedEvidence: () => void,
): Promise<void> {
  if (!target || alreadyKnown) return;
  let flight = probeFlights.get(target);
  if (!flight) {
    flight = probe();
    probeFlights.set(target, flight);
    const cleanup = () => {
      if (probeFlights.get(target) === flight) probeFlights.delete(target);
    };
    flight.then(cleanup, () => {
      clearFailedEvidence();
      cleanup();
    });
  }
  await flight;
}
