export interface EmbeddedStructureRef {
  name: string;
  attribute: string | null;
  kind: 'include' | 'append';
  suffix?: string;
}

export function parseEmbeddedStructures(source: string, issues: string[] = []): EmbeddedStructureRef[] {
  const refs: EmbeddedStructureRef[] = [];
  if (!source) return refs;

  for (const rawLine of structureCode(source, issues).split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@') || line.startsWith('*')) continue;

    const classicInclude = line.match(/^\.include\s+([a-z0-9_/]+)/i);
    if (classicInclude?.[1]) {
      refs.push({ name: classicInclude[1].toUpperCase(), attribute: null, kind: 'include', ...includeSuffix(line) });
      continue;
    }

    // Table key includes carry a leading `key` (`key include zkey_inc not null;`).
    const namedInclude = line.match(/^(?:key\s+)?([a-z][a-z0-9_]*)\s*:\s*include\s+([a-z0-9_/]+)\s*;?/i);
    if (namedInclude?.[1] && namedInclude[2]) {
      refs.push({
        name: namedInclude[2].toUpperCase(),
        attribute: namedInclude[1].toLowerCase(),
        kind: 'include',
        ...includeSuffix(line),
      });
      continue;
    }

    const anonymousInclude = line.match(/^(?:key\s+)?include\s+([a-z0-9_/]+)\s*;?/i);
    if (anonymousInclude?.[1]) {
      refs.push({ name: anonymousInclude[1].toUpperCase(), attribute: null, kind: 'include', ...includeSuffix(line) });
    }
  }

  return refs;
}

/** Comments and literals cannot introduce references; preserve whitespace between real tokens. */
function structureCode(source: string, issues: string[]): string {
  const issue = (reason: string) => {
    if (!issues.includes(reason)) issues.push(reason);
  };
  let result = '',
    index = 0,
    lineStart = true;
  while (index < source.length) {
    const start = index;
    const char = source[index]!;
    if (source.startsWith('//', index) || source.startsWith('--', index) || (char === '*' && lineStart)) {
      while (index < source.length && source[index] !== '\n') index++;
    } else if (source.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) {
          issue('unqualified_nested_block_comment');
          depth++;
          index += 2;
        } else if (source.startsWith('*/', index)) {
          depth--;
          index += 2;
        } else index++;
      }
      if (depth) issue('unterminated_block_comment');
    } else if (char === "'" || char === '"') {
      let closed = false;
      index++;
      while (index < source.length) {
        if (source[index++] === char) {
          if (source[index] === char) index++;
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) issue('unterminated_literal');
      lineStart = false;
    } else {
      result += char;
      lineStart = char === '\n' || (lineStart && /\s/.test(char));
      index++;
      continue;
    }
    const skipped = source.slice(start, index);
    result += skipped.replace(/[^\r\n]/g, ' ');
    if (char !== "'" && char !== '"' && skipped.includes('\n')) lineStart = true;
  }
  return result;
}

function includeSuffix(line: string): { suffix?: string } {
  const suffix = /\bwith\s+suffix\s+([a-z0-9_]+)/i.exec(line)?.[1];
  return suffix ? { suffix: suffix.toLowerCase() } : {};
}
