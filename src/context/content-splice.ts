/**
 * SNOTE-style content-anchored splice over source text for token-efficient SAPWrite edits.
 *
 * `spliceContent` replaces exactly one occurrence of `oldContent` with `newContent`, optionally
 * scoped to a `[lineStart, lineEnd]` window, instead of requiring the whole enclosing unit to be
 * reproduced. Fail-closed on 0 or >1 matches — mirrors `src/context/unit-surgery.ts` (`spliceUnit`)
 * in shape and conventions (pure, no I/O, CRLF-preserving).
 */

import { validateLineWindow } from './line-range.js';

export type ContentSpliceOutcome = 'spliced' | 'already-applied' | 'error';

export interface ContentSpliceResult {
  outcome: ContentSpliceOutcome;
  /** Present when outcome === 'spliced'. */
  newSource?: string;
  /** Present when outcome === 'error'. */
  error?: string;
}

/** Non-overlapping match start offsets of `needle` within `haystack`. */
function findMatches(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const offsets: number[] = [];
  let idx = 0;
  for (;;) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    offsets.push(found);
    idx = found + needle.length;
  }
  return offsets;
}

/** 1-based line number containing character offset `absOffset` in `normalized`. */
function lineNumberAtOffset(normalized: string, absOffset: number): number {
  return normalized.slice(0, absOffset).split('\n').length;
}

/**
 * Replace exactly one occurrence of `oldContent` with `newContent` in `source`.
 *
 * When `lineStart`/`lineEnd` (1-based, inclusive) are given, the search is scoped to that window
 * only — this is a disambiguation *scope* for where the anchor is searched, not a "replace these
 * lines" instruction; matches partially outside the window are not found.
 *
 * Matching rules (fail-closed):
 * - Exactly 1 match for `oldContent` → splice, outcome 'spliced'.
 * - >1 matches → outcome 'error', listing each match's starting line.
 * - 0 matches for `oldContent`, but `newContent` (non-empty) found exactly once → the edit already
 *   holds; outcome 'already-applied' (idempotent no-op, no write should be performed by the caller).
 * - 0 matches for `oldContent` and `newContent` not confirmable → outcome 'error'.
 */
export function spliceContent(
  source: string,
  oldContent: string,
  newContent: string,
  lineStart?: number,
  lineEnd?: number,
): ContentSpliceResult {
  if (!oldContent) {
    return { outcome: 'error', error: '"oldContent" must be non-empty.' };
  }

  const hasCRLF = source.includes('\r\n');
  const normalized = source.replace(/\r\n/g, '\n');
  const normalizedOld = oldContent.replace(/\r\n/g, '\n');
  const normalizedNew = newContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const totalLines = lines.length;

  let windowStart = 0;
  let windowEnd = normalized.length;
  let scopeLabel = 'the source';

  if (lineStart !== undefined || lineEnd !== undefined) {
    if (lineStart === undefined || lineEnd === undefined) {
      return { outcome: 'error', error: 'Both lineStart and lineEnd are required together when scoping the search.' };
    }
    const validation = validateLineWindow(totalLines, lineStart, lineEnd);
    if (!validation.valid) return { outcome: 'error', error: validation.error };
    const clampedEnd = validation.clampedEnd!;
    windowStart = lines.slice(0, lineStart - 1).reduce((n, l) => n + l.length + 1, 0);
    windowEnd = lines.slice(0, clampedEnd).reduce((n, l) => n + l.length + 1, 0) - 1;
    scopeLabel = `lines ${lineStart}-${clampedEnd}`;
  }

  const haystack = normalized.slice(windowStart, windowEnd);
  const oldMatches = findMatches(haystack, normalizedOld);

  if (oldMatches.length === 1) {
    const abs = windowStart + oldMatches[0]!;
    let newSource = normalized.slice(0, abs) + normalizedNew + normalized.slice(abs + normalizedOld.length);
    if (hasCRLF) newSource = newSource.replace(/\n/g, '\r\n');
    return { outcome: 'spliced', newSource };
  }

  if (oldMatches.length > 1) {
    const matchLines = oldMatches.map((off) => lineNumberAtOffset(normalized, windowStart + off));
    return {
      outcome: 'error',
      error:
        `"oldContent" is ambiguous within ${scopeLabel}: found ${oldMatches.length} matches, ` +
        `at line(s) ${matchLines.join(', ')}. Narrow with lineStart/lineEnd, or add more surrounding context to oldContent.`,
    };
  }

  // 0 matches for oldContent — check whether the edit already holds (idempotent no-op).
  if (normalizedNew) {
    const newMatches = findMatches(haystack, normalizedNew);
    if (newMatches.length === 1) {
      return { outcome: 'already-applied' };
    }
  }

  return {
    outcome: 'error',
    error:
      `"oldContent" not found within ${scopeLabel}. Re-copy it verbatim from a plain SAPRead ` +
      '(no grep/lineStart decoration — those prefix lines with "NNN: ") — whitespace and line endings must match exactly.',
  };
}
