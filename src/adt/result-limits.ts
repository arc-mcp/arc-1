/** Keep URL limits and response metadata consistent; finite values clamp to [1, 1000]. */
export function clampUrlLimit(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(requested)));
}
