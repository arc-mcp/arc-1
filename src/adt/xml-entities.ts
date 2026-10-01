/** Decode raw XML text once; never call on a value returned by parseXml. No DTD expansion. */
export function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  // One replacement pass preserves literal references: &amp;lt; becomes &lt;, never <.
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (reference, name: string) => {
    if (name[0] !== '#') return named[name]!;
    const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    // XML 1.0 Char production; retain malformed references rather than throwing on an SAP error.
    const valid =
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    return valid ? String.fromCodePoint(code) : reference;
  });
}
