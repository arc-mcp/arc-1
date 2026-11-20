/**
 * Line breaks for single-line JSON and XML documents, so that line-based grep and line-range reads
 * can address them. SAP delivers EDMX, WSDL, ORD and many API specifications as one line (a SEGW
 * OData V2 EDMX is ~500 KB on one line).
 *
 * Only whitespace that the format ignores is added: JSON gets indentation between tokens (strings,
 * numbers and literals are copied verbatim — no JSON.parse round trip that would round large
 * integers or drop duplicate keys); XML breaks inside markup, preserving every text node. Pure functions, no I/O.
 */
import { MAX_GREP_LINE_LENGTH } from './grep.js';

const INDENT = '  ';

/** True when some line is too long for grep to show in full — the reason to add line breaks. */
export function needsLineBreaks(document: string): boolean {
  let start = 0;
  for (let end = document.indexOf('\n'); end >= 0; end = document.indexOf('\n', start)) {
    if (end - start > MAX_GREP_LINE_LENGTH) return true;
    start = end + 1;
  }
  return document.length - start > MAX_GREP_LINE_LENGTH;
}

/** Re-indent JSON outside of string literals. Input that is not JSON comes back re-spaced but intact. */
export function breakJsonLines(json: string): string {
  let out = '';
  let depth = 0;
  let inString = false;
  const newline = () => `\n${INDENT.repeat(Math.min(depth, 8))}`;
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

/** Split adjacent markup inside tag delimiters. Whitespace between tags can be mixed content. */
export function breakXmlLines(xml: string): string {
  // Internal DTD subsets have their own markup grammar. Keep them and their references verbatim.
  if (xml.includes('<!DOCTYPE')) return xml;
  const parts: string[] = [];
  let copied = 0;
  for (let start = xml.indexOf('<'); start >= 0; ) {
    const end = markupEnd(xml, start);
    if (xml[end] === '<' && xml[end - 1] === '>') {
      if (xml.startsWith('<?xml ', start)) {
        parts.push(xml.slice(copied, end), '\n');
        copied = end;
      } else if (xml[start + 1] !== '!' && xml[start + 1] !== '?') {
        const split = xml[end - 2] === '/' ? end - 2 : end - 1;
        parts.push(xml.slice(copied, split), '\n');
        copied = split;
      }
    }
    start = xml.indexOf('<', end);
  }
  parts.push(xml.slice(copied));
  return parts.join('');
}
