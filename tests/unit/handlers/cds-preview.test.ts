import { describe, expect, it } from 'vitest';
import { getActionPolicy } from '../../../src/authz/policy.js';
import { SAPReadSchema, SAPReadSchemaBtp } from '../../../src/handlers/schemas.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { multiTargetInvocationDecision, multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('CDS preview surface', () => {
  const input = { type: 'CDS_PREVIEW', name: 'Z_DDL' };
  it('uses the data policy and only the single-target on-premise schema', () => {
    expect(SAPReadSchema.safeParse(input).success).toBe(true);
    expect(SAPReadSchemaBtp.safeParse(input).success).toBe(false);
    expect(getActionPolicy('SAPRead', 'CDS_PREVIEW')?.scope).toBe('data');
    const tools = multiTargetToolDefinitions(getToolDefinitions(DEFAULT_CONFIG), DEFAULT_CONFIG);
    const read = tools.find((tool) => tool.name === 'SAPRead')!;
    expect(JSON.stringify((read.inputSchema.properties as Record<string, unknown>).type)).not.toContain('CDS_PREVIEW');
    expect(multiTargetInvocationDecision('SAPRead', input, { ...DEFAULT_CONFIG, allowDataPreview: true })).toBe(
      'forbidden',
    );
  });
  it.each([
    { sqlFilter: "CARRID = 'LH'" },
    { source: 'SELECT * FROM SCARR' },
    { version: 'inactive' },
    { include: 'elements' },
    { columns: Array(101).fill('CARRID') },
    { where: [{ field: 'CARRID', op: '=', value: 'x'.repeat(4097) }] },
    { columns: ['@(execute)'] },
  ])('rejects unsupported or unbounded inputs: %j', (extra) => {
    expect(SAPReadSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('accepts structured filters and harmless strict-client filler', () => {
    expect(
      SAPReadSchema.safeParse({
        ...input,
        columns: ['CARRID'],
        where: [{ field: 'CARRID', op: '=', value: 'LH' }],
        includeSignature: false,
        force_refresh: false,
        expand_includes: false,
        format: 'text',
        maxResults: 0,
        maxRows: 0,
      }).success,
    ).toBe(true);
  });
});
