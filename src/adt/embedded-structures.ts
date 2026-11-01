export interface EmbeddedStructureRef {
  name: string;
  attribute: string | null;
  kind: 'include' | 'append';
  suffix?: string;
}

export function parseEmbeddedStructures(source: string): EmbeddedStructureRef[] {
  const refs: EmbeddedStructureRef[] = [];
  if (!source) return refs;

  for (const rawLine of source.split(/\r?\n/)) {
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

function includeSuffix(line: string): { suffix?: string } {
  const suffix = /\bwith\s+suffix\s+([a-z0-9_]+)/i.exec(line)?.[1];
  return suffix ? { suffix: suffix.toLowerCase() } : {};
}
