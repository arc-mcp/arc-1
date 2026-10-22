import { describe, expect, it } from 'vitest';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';
import type { TargetDescriptor } from '../../../src/server/destination-registry.js';
import {
  injectTargetSchema,
  multiTargetInvocationDecision,
  multiTargetToolDefinitions,
  normalizeTarget,
  sapTargetsDefinition,
} from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function target(index: number): TargetDescriptor {
  const sid = `A${Math.floor(index / 10) % 10}${index % 10}`;
  const client = String(index).padStart(3, '0');
  return {
    target: `${sid}/${client}`,
    sid,
    client,
    description: `Target ${index}`,
    language: 'EN',
    destinationName: `DEST_${index}`,
    authentication: 'PrincipalPropagation',
    identity: 'per-user',
    proxyType: 'OnPremise',
    hasCloudConnectorLocationId: false,
    requestedPolicy: { allowDataPreview: false, allowFreeSQL: false },
    effectivePolicy: { allowDataPreview: false, allowFreeSQL: false },
    connectionFingerprint: `connection-${index}`,
    fingerprint: `fingerprint-${index}`,
  };
}

function property(tool: ToolDefinition, name: string): Record<string, unknown> {
  return ((tool.inputSchema.properties as Record<string, unknown>)[name] ?? {}) as Record<string, unknown>;
}

describe('multi-target tool surface', () => {
  it('narrows SAPQuery fields and guidance to the effective target data gates', () => {
    const both = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
    const definitions = getToolDefinitions(both);
    expect(
      multiTargetToolDefinitions(definitions, DEFAULT_CONFIG).find((tool) => tool.name === 'SAPQuery'),
    ).toBeUndefined();
    const text = multiTargetToolDefinitions(definitions, { ...DEFAULT_CONFIG, allowDataPreview: true }).find(
      (tool) => tool.name === 'SAPQuery',
    )!;
    expect(property(text, 'action').enum).toEqual(['long_text']);
    expect(text.inputSchema.properties).toHaveProperty('longText');
    expect(text.inputSchema.properties).not.toHaveProperty('sql');
    expect(text.inputSchema.properties).not.toHaveProperty('maxRows');
    expect(text.inputSchema.required).toEqual(['action', 'longText']);
    expect(text.description).not.toMatch(/SQL|SELECT|TADIR/i);
    const sql = multiTargetToolDefinitions(definitions, { ...DEFAULT_CONFIG, allowFreeSQL: true }).find(
      (tool) => tool.name === 'SAPQuery',
    )!;
    expect(property(sql, 'action').enum).toEqual(['sql']);
    expect(sql.inputSchema.properties).toHaveProperty('sql');
    expect(sql.inputSchema.required).toEqual(['sql']);
    expect(JSON.stringify(sql)).not.toMatch(/long_text|longText|SO10|SAPscript/u);
    const mixed = multiTargetToolDefinitions(definitions, both).find((tool) => tool.name === 'SAPQuery')!;
    expect(property(mixed, 'action').enum).toEqual(['sql', 'long_text']);
    expect(mixed.inputSchema.required).toEqual([]);
    const btp = multiTargetToolDefinitions(definitions, { ...both, systemType: 'btp' }).find(
      (tool) => tool.name === 'SAPQuery',
    )!;
    expect(property(btp, 'action').enum).toEqual(['sql']);
    expect(btp.inputSchema.properties).not.toHaveProperty('longText');
  });
  it('keeps only the explicitly reviewed mutation-free tools and actions', () => {
    const tools = multiTargetToolDefinitions(getToolDefinitions(DEFAULT_CONFIG), DEFAULT_CONFIG);
    expect(tools.map((tool) => tool.name)).toEqual([
      'SAPRead',
      'SAPSearch',
      'SAPNavigate',
      'SAPLint',
      'SAPDiagnose',
      'SAPContext',
      'SAPTransport',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);

    const lint = tools.find((tool) => tool.name === 'SAPLint') as ToolDefinition;
    expect(property(lint, 'action').enum).toEqual(['lint', 'lint_and_fix', 'list_rules']);
    expect(lint.inputSchema.properties).not.toHaveProperty('indentation');
    expect(lint.inputSchema.properties).not.toHaveProperty('style');

    const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose') as ToolDefinition;
    expect(diagnose.inputSchema.properties).toHaveProperty('includeSubpackages');
    expect(property(diagnose, 'action').enum).toEqual([
      'syntax',
      'unittest',
      'atc',
      'atc_variants',
      'cds_testcases',
      'dumps',
      'feed_schema',
      'traces',
      'trace_requests',
      'system_messages',
      'gateway_errors',
      'object_state',
      'quickfix',
      'cds_sql',
      'sql_trace_state',
      'sql_trace_directory',
    ]);

    const transport = tools.find((tool) => tool.name === 'SAPTransport') as ToolDefinition;
    expect(property(transport, 'action').enum).toEqual(['list', 'get', 'diff', 'check', 'history']);
    expect(transport.inputSchema.properties).not.toHaveProperty('target');
    expect(transport.inputSchema.properties).not.toHaveProperty('transportLayer');
    expect(transport.inputSchema.properties).not.toHaveProperty('resultFormat');
    expect(transport.inputSchema.properties).toHaveProperty('offset');
    expect(transport.inputSchema.properties).toHaveProperty('limit');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'diff' }, DEFAULT_CONFIG)).toBe('allowed');
  });

  it('adds data and SQL only when the effective target/union policy permits them', () => {
    const config = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
    const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
    expect(tools.map((tool) => tool.name)).toContain('SAPQuery');
    const read = tools.find((tool) => tool.name === 'SAPRead') as ToolDefinition;
    expect(property(read, 'type').enum).toEqual(expect.arrayContaining(['TABLE_CONTENTS', 'TABLE_QUERY']));
    const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose') as ToolDefinition;
    expect(property(diagnose, 'action').enum).toEqual([
      'syntax',
      'unittest',
      'atc',
      'atc_variants',
      'cds_testcases',
      'dumps',
      'feed_schema',
      'traces',
      'trace_requests',
      'system_messages',
      'gateway_errors',
      'object_state',
      'quickfix',
      'odata_perf',
      'cds_sql',
      'sql_trace_state',
      'sql_trace_directory',
      'authorization_trace',
    ]);
  });

  it('explicitly permits bounded ATC batches within one pinned or aggregate target', () => {
    const tools = multiTargetToolDefinitions(getToolDefinitions(DEFAULT_CONFIG), DEFAULT_CONFIG);
    const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose')!;
    const objects = property(diagnose, 'objects');
    expect(objects).toMatchObject({
      minItems: 1,
      maxItems: 20,
      items: { additionalProperties: false, required: ['type', 'name'] },
    });
    expect(diagnose.annotations?.readOnlyHint).toBe(true);
    const aggregate = injectTargetSchema(diagnose, [target(1)]);
    expect(property(aggregate, 'objects')).toEqual(objects);
    expect(aggregate.inputSchema.required).toContain('target');
    const selection = [{ type: 'CLAS', name: 'ZCL_A' }];
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'atc', objects: selection }, DEFAULT_CONFIG)).toBe(
      'allowed',
    );
  });

  it.each([1, 16])('uses an exact target enum for %i targets', (count) => {
    const targets = Array.from({ length: count }, (_, index) => target(index));
    const injected = injectTargetSchema(getToolDefinitions(DEFAULT_CONFIG)[0], targets);
    expect(property(injected, 'target').enum).toEqual(targets.map((entry) => entry.target));
    expect(property(injected, 'target')).not.toHaveProperty('pattern');
    expect(injected.inputSchema.required).toContain('target');
  });

  it.each([17, 256])('uses the compact pattern for %i targets', (count) => {
    const targets = Array.from({ length: count }, (_, index) => target(index));
    const injected = injectTargetSchema(getToolDefinitions(DEFAULT_CONFIG)[0], targets);
    expect(property(injected, 'target')).toMatchObject({
      pattern: '^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]\\/[0-9]{3}$',
    });
    expect(property(injected, 'target')).not.toHaveProperty('enum');
  });

  it('normalizes the system segment and accepts a configured-alias shape', () => {
    expect(normalizeTarget(' a4h/100 ')).toEqual({ ok: true, target: 'A4H/100' });
    expect(normalizeTarget(' a4h-2025/001 ')).toEqual({ ok: true, target: 'A4H-2025/001' });
    expect(normalizeTarget('')).toMatchObject({ ok: false, code: 'TARGET_REQUIRED' });
    expect(normalizeTarget(null)).toMatchObject({ ok: false, code: 'TARGET_REQUIRED' });
    expect(normalizeTarget('A4H/10')).toMatchObject({ ok: false, code: 'INVALID_TARGET' });
    expect(normalizeTarget('A4H/abc')).toMatchObject({ ok: false, code: 'INVALID_TARGET' });
    expect(normalizeTarget('A4H_2025/001')).toMatchObject({ ok: false, code: 'INVALID_TARGET' });
  });

  it('distinguishes target policy denial from the v1 hard ceiling', () => {
    expect(multiTargetInvocationDecision('SAPQuery', {}, DEFAULT_CONFIG)).toBe('target-policy-denied');
    expect(multiTargetInvocationDecision('SAPQuery', { action: 'long_text' }, DEFAULT_CONFIG)).toBe(
      'target-policy-denied',
    );
    expect(multiTargetInvocationDecision('SAPQuery', { action: 'future_read_action' }, DEFAULT_CONFIG)).toBe(
      'forbidden',
    );
    expect(
      multiTargetInvocationDecision('SAPQuery', { action: 'long_text' }, { ...DEFAULT_CONFIG, allowDataPreview: true }),
    ).toBe('allowed');
    expect(
      multiTargetInvocationDecision(
        'SAPQuery',
        { action: 'long_text' },
        { ...DEFAULT_CONFIG, allowDataPreview: true, systemType: 'btp' },
      ),
    ).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPWrite', { action: 'update' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPLint', { action: 'lint' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPLint', { action: 'format' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'list' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'create' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'layers' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'atc' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'atc_ci' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'unittest' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'unittest_ci' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'trace_start' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'trace_cancel' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'apply_quickfix' }, DEFAULT_CONFIG)).toBe(
      'forbidden',
    );
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'set_sql_trace_state' }, DEFAULT_CONFIG)).toBe(
      'forbidden',
    );
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'future_read_action' }, DEFAULT_CONFIG)).toBe(
      'forbidden',
    );
    expect(multiTargetInvocationDecision('SAP', { action: 'read' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('Custom_Read', {}, DEFAULT_CONFIG)).toBe('forbidden');
  });

  it('points target discovery at SAPTargets and keeps its schema strict', () => {
    const injected = injectTargetSchema(getToolDefinitions(DEFAULT_CONFIG)[0], [target(0)]);
    expect(property(injected, 'target').description).toContain('Call SAPTargets');
    const definition = sapTargetsDefinition();
    expect(definition.name).toBe('SAPTargets');
    expect(definition.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(definition.inputSchema).toMatchObject({ additionalProperties: false });
    expect(property(definition, 'query')).toMatchObject({ type: 'string', maxLength: 160 });
    expect(property(definition, 'offset')).toMatchObject({ type: 'integer', minimum: 0, maximum: 1_000_000 });
  });
});
