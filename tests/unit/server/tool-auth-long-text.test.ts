import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { createQueryDefinition, pruneQueryDefinition } from '../../../src/handlers/query-tool.js';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';
import { filterToolsByAuthScope } from '../../../src/server/tool-auth.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const enabled = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
function query(tools: ToolDefinition[]): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === 'SAPQuery');
}
function properties(tool: ToolDefinition): Record<string, unknown> {
  return tool.inputSchema.properties as Record<string, unknown>;
}
function actions(tool: ToolDefinition): unknown {
  return (properties(tool).action as Record<string, unknown>).enum;
}
function expectTextOnly(tool: ToolDefinition): void {
  expect(actions(tool)).toEqual(['long_text']);
  expect(properties(tool)).toHaveProperty('longText');
  expect(properties(tool)).not.toHaveProperty('sql');
  expect(properties(tool)).not.toHaveProperty('maxRows');
  expect(tool.inputSchema.required).toEqual(['action', 'longText']);
  expect(tool.description).not.toMatch(/SQL|SELECT|DD02L|TADIR|ABAP SQL/i);
  expect(JSON.stringify(properties(tool).action)).not.toMatch(/SQL|SELECT/i);
}
function expectSqlOnly(tool: ToolDefinition): void {
  expect(actions(tool)).toEqual(['sql']);
  expect(properties(tool)).toHaveProperty('sql');
  expect(properties(tool)).toHaveProperty('maxRows');
  expect(properties(tool)).not.toHaveProperty('longText');
  expect(tool.inputSchema.required).toEqual(['sql']);
  expect(JSON.stringify(tool)).not.toMatch(/long_text|longText|SO10|SAPscript|stored business long texts/u);
}

describe('SAPQuery action visibility', () => {
  it.each([undefined, 'sql'])('applies the SQL deny rule with action=%s before execution', async (action) => {
    const client = new AdtClient({
      baseUrl: 'https://sap.invalid',
      safety: { ...defaultSafetyConfig(), allowFreeSQL: true },
    });
    const execute = vi.spyOn(client, 'runQueryBatch').mockResolvedValue({ columns: [], rows: [] });
    const result = await handleToolCall(client, { ...enabled, denyActions: ['SAPQuery.sql'] }, 'SAPQuery', {
      ...(action === undefined ? {} : { action }),
      sql: 'SELECT * FROM T000',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/SAP_DENY_ACTIONS/);
    expect(execute).not.toHaveBeenCalled();
  });
  it('omits SAPQuery when both data gates are disabled', () => {
    expect(createQueryDefinition(DEFAULT_CONFIG)).toBeUndefined();
    expect(query(getToolDefinitions(DEFAULT_CONFIG))).toBeUndefined();
  });
  it('exposes only enabled actions and their own fields/requirements', () => {
    expectTextOnly(createQueryDefinition({ ...DEFAULT_CONFIG, allowDataPreview: true })!);
    expectSqlOnly(createQueryDefinition({ ...DEFAULT_CONFIG, allowFreeSQL: true })!);
    const mixed = createQueryDefinition(enabled)!;
    expect(actions(mixed)).toEqual(['sql', 'long_text']);
    expect(mixed.inputSchema.required).toEqual([]);
    expect(properties(mixed)).toHaveProperty('sql');
    expect(properties(mixed)).toHaveProperty('longText');
  });
  it.each(['configured', 'discovered'])('omits long-text contract on %s BTP', (source) => {
    const config = { ...enabled, systemType: source === 'configured' ? ('btp' as const) : ('auto' as const) };
    const resolved = source === 'discovered' ? { systemType: 'btp' as const } : undefined;
    expectSqlOnly(query(getToolDefinitions(config, false, resolved))!);
    expect(createQueryDefinition({ ...config, allowFreeSQL: false }, resolved)).toBeUndefined();
  });
  it.each([['read'], ['write']])('omits data/SQL operations for %j scopes', (...scopes) => {
    expect(query(filterToolsByAuthScope(getToolDefinitions(enabled), scopes))).toBeUndefined();
  });
  it('exposes only long_text for data scope and leaves the original definition intact', () => {
    const original = getToolDefinitions(enabled);
    expectTextOnly(query(filterToolsByAuthScope(original, ['data']))!);
    expect(actions(query(original)!)).toEqual(['sql', 'long_text']);
    expect(query(original)!.inputSchema.required).toEqual([]);
  });
  it.each([['sql'], ['admin']])('exposes both actions for %j scopes', (...scopes) => {
    expect(actions(query(filterToolsByAuthScope(getToolDefinitions(enabled), scopes))!)).toEqual(['sql', 'long_text']);
  });
  it('does not allow scopes to expand the server ceiling', () => {
    expectTextOnly(
      query(filterToolsByAuthScope(getToolDefinitions({ ...DEFAULT_CONFIG, allowDataPreview: true }), ['admin']))!,
    );
    expectSqlOnly(
      query(filterToolsByAuthScope(getToolDefinitions({ ...DEFAULT_CONFIG, allowFreeSQL: true }), ['admin']))!,
    );
  });
  it('removes denied action fields and guidance, including tool/wildcard denial', () => {
    const tools = getToolDefinitions(enabled);
    expectSqlOnly(query(filterToolsByAuthScope(tools, ['admin'], ['SAPQuery.long_text']))!);
    expectTextOnly(query(filterToolsByAuthScope(tools, ['admin'], ['SAPQuery.sql']))!);
    for (const deny of ['SAPQuery', 'SAPQuery.*']) {
      expect(query(filterToolsByAuthScope(tools, ['admin'], [deny]))).toBeUndefined();
    }
    expect(query(filterToolsByAuthScope(tools, ['data'], ['SAPQuery.long_text']))).toBeUndefined();
  });
  it('preserves unrelated target schema/requirements and is idempotent', () => {
    const original = createQueryDefinition(enabled)!;
    original.inputSchema = {
      ...original.inputSchema,
      properties: { ...properties(original), target: { type: 'string' } },
      required: ['target'],
    };
    const pruned = pruneQueryDefinition(original, ['long_text']);
    expect(pruned.inputSchema.required).toEqual(['target', 'action', 'longText']);
    expect(properties(pruned)).toHaveProperty('target');
    expect(pruneQueryDefinition(pruned, ['long_text'])).toEqual(pruned);
    expect(pruneQueryDefinition(pruned, ['sql', 'long_text'])).toEqual(pruned);
  });
});
