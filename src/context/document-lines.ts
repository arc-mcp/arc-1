/**
 * Line breaks for single-line JSON and XML documents, so that line-based grep and line-range reads
 * can address them. SAP delivers EDMX, WSDL, ORD and many API specifications as one line (a SEGW
 * OData V2 EDMX is ~500 KB on one line).
 *
 * JSON indentation preserves string and number literals and duplicate keys.
 * XML separates adjacent tags in element-only content.
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

/** Break between whole tags. Direct text, including CDATA, keeps the enclosing subtree verbatim. */
export function breakXmlLines(xml: string): string {
  if (xml.includes('<!DOCTYPE')) return xml;
  const breaks: number[] = [];
  const stack: Array<{ firstBreak: number; preserve: boolean }> = [];
  let previousEnd = 0;
  for (let start = xml.indexOf('<'); start >= 0; start = xml.indexOf('<', previousEnd)) {
    const end = markupEnd(xml, start);
    const parent = stack.at(-1);
    if (parent && (start > previousEnd || xml.startsWith('<![CDATA[', start))) parent.preserve = true;
    if (start > 0 && start === previousEnd) breaks.push(start);
    if (xml.startsWith('</', start)) {
      // Text can follow the last child. Discard any provisional breaks inside this element.
      if (parent?.preserve) breaks.length = parent.firstBreak;
      stack.pop();
    } else if (xml[start + 1] !== '!' && xml[start + 1] !== '?' && xml[end - 2] !== '/') {
      const tag = xml.slice(start, end);
      const preserve =
        tag.includes('xml:space') &&
        /^<(?:[^"'<>]|"[^"]*"|'[^']*')*?\sxml:space\s*=\s*(?:"preserve"|'preserve')/.test(tag);
      stack.push({ firstBreak: breaks.length, preserve });
    }
    previousEnd = end;
  }
  const parts: string[] = [];
  let copied = 0;
  for (const at of breaks) {
    parts.push(xml.slice(copied, at));
    copied = at;
  }
  parts.push(xml.slice(copied));
  return parts.join('\n');
}
