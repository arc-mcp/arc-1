/** Read a 1-based inclusive window of one raw source, retaining its original line numbers. */
export function readLineRange(
  source: string,
  lineStart: number,
  lineEnd: number,
): { output: string; invalidRange: boolean } {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const totalLines = lines.length;
  let error: string | undefined;
  if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd))
    error = 'lineStart and lineEnd must be integers.';
  else if (lineStart < 1) error = `lineStart must be >= 1 (got ${lineStart}).`;
  else if (lineStart > lineEnd) error = `lineStart (${lineStart}) must be <= lineEnd (${lineEnd}).`;
  else if (lineStart > totalLines)
    error = `lineStart (${lineStart}) is past the end of the source (${totalLines} line(s)).`;
  if (error) return { output: error, invalidRange: true };

  const end = Math.min(lineEnd, totalLines);
  const clampNote = lineEnd > totalLines ? ` (lineEnd clamped to ${totalLines}, the last line)` : '';
  const output = [`Lines ${lineStart}-${end} of ${totalLines} total${clampNote}:`];
  for (let line = lineStart; line <= end; line++) output.push(`${String(line).padStart(5)}: ${lines[line - 1]}`);
  return { output: output.join('\n'), invalidRange: false };
}
