/**
 * Pure text-diff helper. Kept free of any ADT/HTTP concern so it can be unit-tested
 * in isolation and reused. Backs SAPRead action="diff" (single-system version diff):
 * the server fetches two source versions and returns only the unified-diff hunks,
 * instead of shipping both full sources to the LLM.
 *
 * NOTE: this is line-level *text* diff. It is unrelated to `class-structure.ts`
 * `diffMethodSets`, which compares method *sets* for class surgery.
 */
import { createTwoFilesPatch } from 'diff';

export interface UnifiedDiffResult {
  /** True when the two sources are byte-equal after line-ending normalization. */
  identical: boolean;
  /** Unified-diff text. Empty string when identical. */
  diff: string;
  /** Number of added lines (lines present only on the "new" side). */
  added: number;
  /** Number of removed lines (lines present only on the "old" side). */
  removed: number;
}

/** Normalize CRLF/CR to LF so line-ending differences never show up as spurious hunks. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Produce a unified diff between two source strings.
 *
 * Line endings are normalized before comparison (SAP can return CRLF). When the
 * normalized sources are equal, returns `identical: true` with an empty diff —
 * callers should render "no differences" rather than an empty patch.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string,
  context = 3,
): UnifiedDiffResult {
  const a = normalizeNewlines(oldText);
  const b = normalizeNewlines(newText);
  if (a === b) {
    return { identical: true, diff: '', added: 0, removed: 0 };
  }
  const patch = createTwoFilesPatch(oldLabel, newLabel, a, b, '', '', { context });
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { identical: false, diff: patch, added, removed };
}
