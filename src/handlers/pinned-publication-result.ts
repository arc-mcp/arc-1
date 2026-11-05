import type { executePinnedPublication } from '../adt/pinned-publication.js';

/** Client-only projection: retain operation evidence without exposing native diagnostic text. */
export function publicationClientResult(
  result: Awaited<ReturnType<typeof executePinnedPublication>>,
  minimalErrors: boolean,
) {
  if (!minimalErrors) return result;
  return {
    ...result,
    items: result.items.map(({ nativeStatus, ...item }) => ({
      ...item,
      ...(nativeStatus ? { nativeStatus: { severity: nativeStatus.severity } } : {}),
    })),
  };
}
