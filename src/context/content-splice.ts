/** Replace one exact anchor without changing bytes outside the matched span. */
export function spliceContent(
  source: string,
  oldContent: string,
  newContent: string,
): { success: true; newSource: string } | { success: false; error: string } {
  const crlf = source.includes('\r\n');
  const mixed = crlf && source.replace(/\r\n/g, '').includes('\n');
  const normalize = (text: string) => (mixed ? text : text.replace(/\r?\n/g, crlf ? '\r\n' : '\n'));
  const oldText = normalize(oldContent);
  const newText = normalize(newContent);
  if (!oldText) return { success: false, error: 'oldContent must not be empty.' };
  const start = source.indexOf(oldText);
  if (start < 0)
    return {
      success: false,
      error: 'oldContent was not found. Re-read with format="editable" and copy the exact text.',
    };
  if (source.indexOf(oldText, start + 1) >= 0) {
    return {
      success: false,
      error: 'oldContent is ambiguous. Include more surrounding text so it matches exactly once.',
    };
  }
  if (oldText === newText) return { success: false, error: 'oldContent and newContent make no source change.' };
  return { success: true, newSource: source.slice(0, start) + newText + source.slice(start + oldText.length) };
}
