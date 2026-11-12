/** Statement evidence only: a WUL name/description is never an extension declaration. */
import { RELATION_NAME, RelationProtocolError } from './relation-objects.js';

const MAX_SOURCE_BYTES = 256 * 1024;

/** A small linear lexer for BDEF declaration heads, not a general BDEF syntax validator.
 * Strings are barriers, comments are whitespace, and only top-level statement heads count.
 */
export function bdefDeclaredEntities(source: string, kind: 'define' | 'extend'): string[] {
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES)
    throw new RelationProtocolError('behavior source exceeds the verification limit.');
  const entities = new Set<string>();
  const head: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (source.startsWith('//', i) || (char === '*' && (i === 0 || source[i - 1] === '\n'))) {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source.startsWith('/*', i)) {
      let comments = 1;
      i += 2;
      while (i < source.length && comments) {
        if (source.startsWith('/*', i)) {
          comments++;
          i += 2;
        } else if (source.startsWith('*/', i)) {
          comments--;
          i += 2;
        } else i++;
      }
      if (comments) break;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '|') {
      const quote = char;
      if (depth === 0 && head.length < 4) head.push('<literal>');
      i++;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i] === quote) {
          if (source[i + 1] === quote) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }
    if (char === '{') {
      if (
        depth === 0 &&
        head[0] === kind.toUpperCase() &&
        head[1] === 'BEHAVIOR' &&
        head[2] === 'FOR' &&
        head[3] &&
        head[3].length <= 120 &&
        RELATION_NAME.test(head[3])
      )
        entities.add(head[3]);
      depth++;
      head.length = 0;
      i++;
      continue;
    }
    if (char === '}') {
      // Malformed closing braces cannot create a fresh valid declaration head.
      if (depth === 0) break;
      depth--;
      head.length = 0;
      i++;
      continue;
    }
    if (char === ';') {
      head.length = 0;
      i++;
      continue;
    }
    const start = i;
    if (/[A-Za-z_/$]/.test(char)) {
      while (
        i < source.length &&
        /[A-Za-z0-9_/$]/.test(source[i]!) &&
        !source.startsWith('//', i) &&
        !source.startsWith('/*', i)
      )
        i++;
      if (depth === 0 && head.length < 4) head.push(source.slice(start, i).toUpperCase());
    } else {
      if (depth === 0 && head.length < 4) head.push('<punctuation>');
      i++;
    }
  }
  return [...entities];
}

export function bdefExtensionTargets(baseSource: string, candidateSource: string): string[] {
  const declared = new Set(bdefDeclaredEntities(baseSource, 'define'));
  return bdefDeclaredEntities(candidateSource, 'extend').filter((entity) => declared.has(entity));
}
