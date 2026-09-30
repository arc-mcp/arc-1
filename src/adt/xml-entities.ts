/**
 * Decode the five predefined XML entities. It runs exactly once, where raw markup becomes text:
 * in `parseXml` (every attribute and text value) and in the error-body scanner of errors.ts. A
 * second call on the result would turn a literal `&lt;` into `<`, so those two stay the only
 * importers (tests/unit/adt/xml-entities.test.ts).
 *
 * `&amp;` is decoded LAST so chained entities like `&amp;lt;` resolve to the
 * literal `&lt;` rather than `<`. Closes CodeQL alert `js/double-escaping`
 * (alert #8).
 *
 * A module of its own because errors.ts needs it too, and xml-parser.ts already imports errors.ts.
 */
export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
