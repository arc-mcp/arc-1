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
 * Drop trailing blanks and settle the final newline.
 *
 * Review-only (opt-in): the ABAP pretty-printer and a save round-trip can flip trailing
 * spaces across a whole include, which renders as a full-file rewrite in a transport
 * review. SAP's own diff compares lines with plain `String.equals` and shows that noise;
 * `SAPRead action="diff"` keeps SAP's byte-exact behaviour by default.
 */
function normalizeCosmetics(text: string): string {
  const trimmed = text.replace(/[ \t]+$/gm, '');
  if (!trimmed) return '';
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
}

/**
 * Produce a unified diff between two source strings.
 *
 * Line endings are normalized before comparison (SAP can return CRLF). When the
 * normalized sources are equal, returns `identical: true` with an empty diff —
 * callers should render "no differences" rather than an empty patch.
 *
 * `ignoreCosmetics` additionally drops trailing blanks and normalizes the final newline —
 * opt-in, for review diffs (see `normalizeCosmetics`).
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string,
  context = 3,
  ignoreCosmetics = false,
): UnifiedDiffResult {
  const prep = (text: string) =>
    ignoreCosmetics ? normalizeCosmetics(normalizeNewlines(text)) : normalizeNewlines(text);
  const a = prep(oldText);
  const b = prep(newText);
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
