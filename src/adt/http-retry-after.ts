/**
 * Parse RFC 7231 `Retry-After` header into a delay in milliseconds.
 *
 * Accepts both forms allowed by the spec:
 * - delta-seconds (e.g. `"5"`)
 * - HTTP-date (e.g. `"Wed, 12 May 2026 14:30:00 GMT"`)
 *
 * On missing, NaN, malformed, past-date, or negative input, falls back to `fallbackMs`.
 * Always clamps to `[0, 60_000]` ms so a misbehaving gateway can't stall us indefinitely
 * and a too-small/past value can't degenerate into a hot retry loop.
 *
 * Returns `{ delayMs, source }` — `source: 'header' | 'fallback'` lets audit events
 * record whether the delay came from the server or from our jitter floor (useful for
 * capacity tuning).
 */
export function parseRetryAfter(
  header: string | null | undefined,
  fallbackMs: number,
): { delayMs: number; source: 'header' | 'fallback' } {
  const clamp = (ms: number): number => Math.max(0, Math.min(60_000, ms));
  if (header == null || header === '') {
    return { delayMs: clamp(fallbackMs), source: 'fallback' };
  }
  const trimmed = header.trim();
  // delta-seconds form: integer (and only digits, optionally signed)
  if (/^-?\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds)) {
      return { delayMs: clamp(seconds * 1000), source: 'header' };
    }
    return { delayMs: clamp(fallbackMs), source: 'fallback' };
  }
  // HTTP-date form
  const epochMs = Date.parse(trimmed);
  if (Number.isFinite(epochMs)) {
    return { delayMs: clamp(epochMs - Date.now()), source: 'header' };
  }
  return { delayMs: clamp(fallbackMs), source: 'fallback' };
}
