/** Read a 1-based inclusive window of one raw source, retaining its original line numbers. */
export function readLineRange(
  source: string,
  lineStart: number,
  lineEnd: number,
  maxChars = Infinity,
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
  let length = output[0]!.length;
  for (let line = lineStart; line <= end; line++) {
    const numbered = `${String(line).padStart(5)}: ${lines[line - 1]}`;
    length += numbered.length + 1;
    if (length > maxChars)
      return {
        invalidRange: true,
        output: `This line range exceeds ${maxChars} characters. Request fewer lines or use grep for a long line.`,
      };
    output.push(numbered);
  }
  return { output: output.join('\n'), invalidRange: false };
}
