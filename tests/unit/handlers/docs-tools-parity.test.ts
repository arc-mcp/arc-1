import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { features, fullConfig } from './handler-test-config.js';

const TOOLS_DOC = readFileSync(new URL('../../../docs_page/tools.md', import.meta.url), 'utf8');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toolSection(markdown: string, toolName: string): string | undefined {
  const heading = new RegExp(`^##[ \\t]+${escapeRegExp(toolName)}(?:[ \\t].*)?$`, 'm');
  const match = heading.exec(markdown);
  if (!match) return undefined;

  const start = match.index;
  const afterHeading = start + match[0].length;
  const nextHeading = /^##[ \t]+/m.exec(markdown.slice(afterHeading));
  const end = nextHeading ? afterHeading + nextHeading.index : markdown.length;
  return markdown.slice(start, end);
}

function normalizeTableCell(cell: string): string {
  return cell
    .replace(/[`*]/g, '')
    .replace(/\\([|`*_])/g, '$1')
    .trim();
}

function parameterRows(section: string): Map<string, string> | undefined {
  const lines = section.split(/\r?\n/);
  const marker = lines.findIndex((line) => /^(?:\*\*)?Parameters:?(?:\*\*)?\s*$/i.test(line.trim()));
  if (marker === -1) return undefined;

  const header = lines.findIndex((line, index) => {
    if (index <= marker) return false;
    const firstCell = /^\s*\|\s*([^|]+?)\s*\|/.exec(line)?.[1];
    return firstCell !== undefined && normalizeTableCell(firstCell).toLowerCase() === 'parameter';
  });
  if (header === -1) return undefined;

  const rows = new Map<string, string>();
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!/^\s*\|/.test(line)) {
      if (rows.size > 0) break;
      continue;
    }
    const firstCell = /^\s*\|\s*([^|]+?)\s*\|/.exec(line)?.[1];
    if (!firstCell) continue;
    const name = normalizeTableCell(firstCell);
    if (/^:?-{3,}:?$/.test(name)) continue;
    rows.set(name, line);
  }
  return rows;
}

function containsToken(text: string, token: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(token)}(?:$|[^A-Za-z0-9_])`).test(text);
}

describe('docs_page/tools.md public-schema parity', () => {
  it('documents every top-level parameter and every advertised action', () => {
    const definitions = getToolDefinitions(fullConfig(false), true, features());
    const gaps: string[] = [];

    for (const definition of definitions) {
      const section = toolSection(TOOLS_DOC, definition.name);
      if (!section) {
        gaps.push(`${definition.name}: missing level-2 tool section`);
        continue;
      }

      const rows = parameterRows(section);
      if (!rows) {
        gaps.push(`${definition.name}: missing Parameters table`);
        continue;
      }

      const properties = (definition.inputSchema as Record<string, any>).properties as Record<string, any>;
      const schemaParams = Object.keys(properties);
      const documentedParams = [...rows.keys()];
      const missingParams = schemaParams.filter((name) => !rows.has(name));
      const staleParams = documentedParams.filter((name) => !(name in properties));
      if (missingParams.length > 0) gaps.push(`${definition.name} missing params: ${missingParams.join(', ')}`);
      if (staleParams.length > 0) gaps.push(`${definition.name} stale params: ${staleParams.join(', ')}`);

      const actions = properties.action?.enum as string[] | undefined;
      if (actions) {
        const actionRow = rows.get('action') ?? '';
        const missingActions = actions.filter((action) => !containsToken(actionRow, action));
        if (missingActions.length > 0) gaps.push(`${definition.name} missing actions: ${missingActions.join(', ')}`);
      }
    }

    expect(gaps, `docs_page/tools.md drifted from the full on-prem public schema:\n${gaps.join('\n')}`).toEqual([]);
  });
});
