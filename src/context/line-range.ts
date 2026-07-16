/**
 * Pure line-range slicing over source text for token-efficient SAPRead reads.
 *
 * `readLineRange` returns only lines `lineStart..lineEnd` (1-based, inclusive) with
 * line-number prefixes, instead of the full object source — the "read the lines an
 * ATC finding or a prior grep pointed at" half of the read→edit loop. Mirrors
 * `src/context/grep.ts` in shape and conventions (pure, no I/O, same line-number format).
 */

export interface LineRangeResult {
  /** Formatted, LLM-friendly numbered-line listing (or an error message). */
  output: string;
  /** True when lineStart/lineEnd are not usable against this source. */
  invalidRange: boolean;
}

export interface LineWindowValidation {
  valid: boolean;
  /** Present when !valid. */
  error?: string;
  /** Present when valid — lineEnd clamped to totalLines. */
  clampedEnd?: number;
}

/**
 * Shared validation for a 1-based, inclusive `[lineStart, lineEnd]` window against a source of
 * `totalLines` lines. `lineEnd` is clamped to `totalLines` rather than treated as an error, since
 * callers commonly pass a generous upper bound. Shared by `readLineRange` (read-side) and
 * `spliceContent` (write-side anchor scoping, `src/context/content-splice.ts`) so the two can't
 * drift apart on what counts as a valid window.
 */
export function validateLineWindow(totalLines: number, lineStart: number, lineEnd: number): LineWindowValidation {
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) {
    return { valid: false, error: 'lineStart and lineEnd must be integers.' };
  }
  if (lineStart < 1) {
    return { valid: false, error: `lineStart must be >= 1 (got ${lineStart}).` };
  }
  if (lineStart > lineEnd) {
    return { valid: false, error: `lineStart (${lineStart}) must be <= lineEnd (${lineEnd}).` };
  }
  if (lineStart > totalLines) {
    return { valid: false, error: `lineStart (${lineStart}) is past the end of the source (${totalLines} line(s)).` };
  }
  return { valid: true, clampedEnd: Math.min(lineEnd, totalLines) };
}

/**
 * Slice `source` to the 1-based, inclusive line range `[lineStart, lineEnd]`.
 *
 * `lineEnd` is clamped to the last line of the source (noted in the output header)
 * rather than treated as an error, since callers commonly pass a generous upper
 * bound. `lineStart` past the end of the source, `lineStart < 1`, or
 * `lineStart > lineEnd` are reported as an invalid range.
 */
export function readLineRange(source: string, lineStart: number, lineEnd: number): LineRangeResult {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const totalLines = lines.length;

  const validation = validateLineWindow(totalLines, lineStart, lineEnd);
  if (!validation.valid) {
    return { output: validation.error!, invalidRange: true };
  }

  const clampedEnd = validation.clampedEnd!;
  const clampNote = lineEnd > totalLines ? ` (lineEnd clamped to ${totalLines}, the last line)` : '';

  const out: string[] = [`Lines ${lineStart}-${clampedEnd} of ${totalLines} total${clampNote}:`];
  for (let i = lineStart; i <= clampedEnd; i++) {
    out.push(`${String(i).padStart(5)}: ${lines[i - 1]}`);
  }

  return { output: out.join('\n'), invalidRange: false };
}
