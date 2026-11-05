import { createHash } from 'node:crypto';
import { ABAPObject, MemoryFile, Registry, Tokens } from '@abaplint/core';
import { AdtSafetyError } from './errors.js';
import { findFmHeader, parseFmSignature } from './fm-signature.js';

export function sourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

/** ADT normalizes CRLF and terminal newlines; all other editable source bytes must agree. */
export function editableSourceEquals(left: string, right: string): boolean {
  const comparable = (source: string) => {
    const text = source.replace(/\r\n/g, '\n');
    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 10) end--;
    return text.slice(0, end);
  };
  return comparable(left) === comparable(right);
}

export function assertSourceHash(source: string, expected: string | undefined, sourceUrl: string): void {
  if (expected !== undefined && sourceHash(source) !== expected) {
    throw new AdtSafetyError(
      `Source changed, or expectedSourceHash came from a different object/include. No write was made. Checked ${sourceUrl}. Re-read the same object, include and group with SAPRead(format="editable"), review the changes, and pass its sourceHash.`,
    );
  }
}

const maxSourceBytes = 1024 * 1024;

type Mode = 'code' | 'single' | 'double' | 'block';

/** Preserve literal/comment bytes and code tokens; only empty lines and existing internal space runs vary. */
function proof(input: string): string | undefined {
  if (Buffer.byteLength(input, 'utf8') > maxSourceBytes) return undefined;
  const text = input.replace(/\r\n/g, '\n');
  // Only the established CRLF/LF representation is qualified. Other line/control separators are ambiguous.
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127 || code === 133 || code === 8232 || code === 8233)
      return undefined;
  }
  let mode: Mode = 'code';
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0 && mode === 'code') continue;
    const firstContent = line.search(/[^ \t]/),
      lastContent = line.replace(/[ \t]+$/, '').length,
      parts: string[] = [];
    let copiedThrough = 0;
    for (let index = 0; index < line.length; index++) {
      const char = line[index],
        next = line[index + 1];
      if (mode === 'block') {
        // Nested openers have no qualified boundary contract here; do not guess where their text ends.
        if (char === '/' && next === '*') return undefined;
        if (char === '*' && next === '/') {
          mode = 'code';
          index++;
        }
      } else if (mode === 'single' || mode === 'double') {
        const quote = mode === 'single' ? "'" : '"';
        if (char === '\\') {
          // Do not guess backslash/newline continuation. Preserve other literal characters exactly.
          if (next === undefined) return undefined;
          // The existing CDS lexer differs between single/double quotes for paired backslashes.
          // Refuse this ambiguous quoted-identifier form instead of moving a quote boundary.
          if (mode === 'double' && next === '\\') return undefined;
          if (next === '\\' || next === quote) index++;
        } else if (char === quote) {
          if (next === quote) index++;
          else mode = 'code';
        }
      } else if ((char === ' ' || char === '\t') && index > firstContent && index < lastContent) {
        // Preserve separator presence: never insert/remove a token boundary, indentation or trailing bytes.
        let end = index + 1;
        while (line[end] === ' ' || line[end] === '\t') end++;
        parts.push(line.slice(copiedThrough, index), ' ');
        copiedThrough = end;
        index = end - 1;
      } else if ((char === '/' && next === '/') || (char === '-' && next === '-')) {
        // The complete comment line remains in the proof; only its following empty code lines may differ.
        break;
      } else if (char === '/' && next === '*') {
        mode = 'block';
        index++;
      } else if (char === '*' && next === '/') return undefined;
      else if (char === "'") mode = 'single';
      else if (char === '"') mode = 'double';
      // Backticks are not a qualified DDL literal delimiter. Never normalize around an unknown span.
      else if (char === '`') return undefined;
    }
    parts.push(line.slice(copiedThrough));
    lines.push(parts.join(''));
  }
  return mode === 'code' && text.trim().length > 0 ? lines.join('\n') : undefined;
}

/** Prepare before PUT, without changing the exact optimistic hash or the returned stored-source hash. */
export function prepareDdicDdlSourceVerification(source: string): (stored: string) => boolean {
  const expected = proof(source);
  if (expected === undefined)
    throw new AdtSafetyError(
      'Cannot verify table/structure DDL literal and comment boundaries within the source budget. No source save was sent; inspect the complete DDL source.',
    );
  return (stored) => {
    const actual = proof(stored);
    return actual !== undefined && actual === expected;
  };
}

const functionSourceProofMaxSourceBytes = 1024 * 1024;

const maxFrameBytes = 64 * 1024;

function tokens(text: string) {
  const registry = new Registry();
  registry.addFile(new MemoryFile('zarc1_function_frame.prog.abap', text));
  registry.parse();
  const object = registry.getFirstObject();
  if (!(object instanceof ABAPObject)) return undefined;
  return object.getABAPFiles()[0]?.getTokens();
}

function functionSourceProofProof(input: string, name: string) {
  if (Buffer.byteLength(input, 'utf8') > functionSourceProofMaxSourceBytes) return undefined;
  const source = input.replace(/\r\n/g, '\n');
  const header = findFmHeader(source);
  if (!header) return undefined;
  const { bodyStart, bodyEnd } = parseFmSignature(source);
  if (bodyStart <= header.end || bodyEnd < bodyStart || bodyEnd === source.length) return undefined;
  const signature = source.slice(header.start, bodyStart),
    footer = source.slice(bodyEnd);
  if (Buffer.byteLength(signature + footer, 'utf8') > maxFrameBytes) return undefined;
  const signatureTokens = tokens(signature),
    footerTokens = tokens(footer);
  if (
    !signatureTokens ||
    !footerTokens ||
    signatureTokens[0]?.getStr().toUpperCase() !== 'FUNCTION' ||
    signatureTokens[1]?.getStr().toUpperCase() !== name ||
    signatureTokens.at(-1)?.getStr() !== '.' ||
    signatureTokens.filter((token) => token instanceof Tokens.Punctuation && token.getStr() === '.').length !== 1 ||
    footerTokens[0]?.getStr().toUpperCase() !== 'ENDFUNCTION' ||
    footerTokens[1]?.getStr() !== '.' ||
    footerTokens.slice(2).some((token) => !(token instanceof Tokens.Comment))
  )
    return undefined;
  const canonical = (items: NonNullable<typeof signatureTokens>) =>
    items.map((token) => {
      const text = token.getStr();
      // Only identifiers fold case. Literals, comments and lexer punctuation classes retain identity.
      return [
        token.constructor.name,
        token instanceof Tokens.Identifier && /^[ -~]*$/.test(text) ? text.toUpperCase() : text,
      ];
    });
  return {
    prefix: source.slice(0, header.start),
    signature: canonical(signatureTokens),
    // A4H's converter pads the generated signature with empty lines to retain backend line numbers.
    // Ignore only those leading empty lines; indentation, comments, internal lines and literals stay exact.
    body: source.slice(bodyStart, bodyEnd).replace(/^\n+/, ''),
    footer: canonical(footerTokens),
  };
}

/** Establish a supported comparison before PUT; the returned predicate permits only the documented native framing. */
export function prepareFunctionSourceVerification(source: string, name: string): (stored: string) => boolean {
  const expected = functionSourceProofProof(source, name);
  if (!expected)
    throw new AdtSafetyError(
      'Cannot verify the selected function signature/body boundaries within the source budget. No source save was sent; inspect the complete function source in ADT.',
    );
  const serialized = JSON.stringify(expected);
  return (stored) => {
    const actual = functionSourceProofProof(stored, name);
    return actual !== undefined && JSON.stringify(actual) === serialized;
  };
}
