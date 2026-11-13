/**
 * Line breaks for single-line JSON and XML documents, so that line-based grep and line-range reads
 * can address them. SAP delivers EDMX, WSDL, ORD and many API specifications as one line (a SEGW
 * OData V2 EDMX is ~500 KB on one line).
 *
 * Only whitespace that the format ignores is added: JSON gets indentation between tokens (strings,
 * numbers and literals are copied verbatim — no JSON.parse round trip that would round large
 * integers or drop duplicate keys); XML gets a line break only where one tag directly follows
 * another, so text content and attribute values stay byte-identical. Pure functions, no I/O.
 */
import { MAX_GREP_LINE_LENGTH } from './grep.js';

const INDENT = '  ';

/** True when some line is too long for grep to show in full — the reason to add line breaks. */
export function needsLineBreaks(document: string): boolean {
  return document.split('\n').some((line) => line.length > MAX_GREP_LINE_LENGTH);
}

/** Re-indent JSON outside of string literals. Input that is not JSON comes back re-spaced but intact. */
export function breakJsonLines(json: string): string {
  let out = '';
  let depth = 0;
  let inString = false;
  const newline = () => `\n${INDENT.repeat(depth)}`;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += json[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      let next = i + 1;
      while (/\s/.test(json[next] ?? '')) next++;
      if (json[next] === close) {
        out += ch + close;
        i = next;
      } else {
        depth++;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      out += newline() + ch;
    } else if (ch === ',') {
      out += ch + newline();
    } else if (ch === ':') {
      out += ': ';
    } else {
      out += ch;
    }
  }
  return out;
}

/** End index (exclusive) of the markup token starting at `start` (which points at '<'). */
function markupEnd(xml: string, start: number): number {
  const closeAfter = (marker: string) => {
    const at = xml.indexOf(marker, start);
    return at < 0 ? xml.length : at + marker.length;
  };
  if (xml.startsWith('<!--', start)) return closeAfter('-->');
  if (xml.startsWith('<![CDATA[', start)) return closeAfter(']]>');
  if (xml.startsWith('<?', start)) return closeAfter('?>');
  // Element tags (and a DOCTYPE without internal subset): '>' inside a quoted attribute value is legal.
  let quote = '';
  for (let i = start + 1; i < xml.length; i++) {
    const ch = xml[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return xml.length;
}

/** Break XML between directly adjacent tags and indent by element depth. Text runs are not touched. */
export function breakXmlLines(xml: string): string {
  let out = '';
  let depth = 0;
  let previousWasMarkup = false;
  let i = 0;
  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const end = next < 0 ? xml.length : next;
      out += xml.slice(i, end);
      i = end;
      previousWasMarkup = false;
      continue;
    }
    const end = markupEnd(xml, i);
    const token = xml.slice(i, end);
    // CDATA is element text: whitespace next to it would change the content.
    if (token.startsWith('<![CDATA[')) {
      out += token;
      i = end;
      previousWasMarkup = false;
      continue;
    }
    const isClosing = token.startsWith('</');
    const isOpening = !isClosing && !/^<[?!]/.test(token) && !token.endsWith('/>');
    if (isClosing) depth = Math.max(0, depth - 1);
    if (previousWasMarkup) out += `\n${INDENT.repeat(depth)}`;
    out += token;
    if (isOpening) depth++;
    previousWasMarkup = true;
    i = end;
  }
  return out;
}
