/** Authorization-safe, success-only feature state for discovered targets. */

const probeFlights = new Map<string, Promise<void>>();

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
