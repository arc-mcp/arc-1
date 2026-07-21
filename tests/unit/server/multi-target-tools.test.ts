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
    expect(property(diagnose, 'action').enum).toEqual(expect.arrayContaining(['atc', 'unittest']));

    const transport = tools.find((tool) => tool.name === 'SAPTransport') as ToolDefinition;
    expect(property(transport, 'action').enum).toEqual(['list', 'get', 'check', 'history']);
    expect(transport.inputSchema.properties).not.toHaveProperty('target');
    expect(transport.inputSchema.properties).not.toHaveProperty('transportLayer');
  });

  it('adds data and SQL only when the effective target/union policy permits them', () => {
    const config = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
    const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
    expect(tools.map((tool) => tool.name)).toContain('SAPQuery');
    const read = tools.find((tool) => tool.name === 'SAPRead') as ToolDefinition;
    expect(property(read, 'type').enum).toEqual(expect.arrayContaining(['TABLE_CONTENTS', 'TABLE_QUERY']));
    const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose') as ToolDefinition;
    expect(property(diagnose, 'action').enum).toEqual(expect.arrayContaining(['odata_perf', 'authorization_trace']));
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
    expect(multiTargetInvocationDecision('SAPWrite', { action: 'update' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPLint', { action: 'lint' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPLint', { action: 'format' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'list' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'create' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPTransport', { action: 'layers' }, DEFAULT_CONFIG)).toBe('forbidden');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'atc' }, DEFAULT_CONFIG)).toBe('allowed');
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'unittest' }, DEFAULT_CONFIG)).toBe('allowed');
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
