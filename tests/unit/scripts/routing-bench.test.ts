/**
 * The routing bench's load-bearing guard: a generated prompt that names the tool or the literal
 * enum value tests string matching, not routing — and every case that slips through inflates the
 * score of whatever description is being judged. Test the filter, not the LLM.
 */

import { describe, expect, it } from 'vitest';
import { enumTargets, FULL_CONFIG, leaks } from '../../../scripts/routing-bench.js';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';

describe('leaks', () => {
  it('rejects a prompt naming the tool', () => {
    expect(leaks('Use SAPTransport to release my request', 'SAPTransport', 'release')).toBe(true);
    expect(leaks('use saptransport here', 'SAPTransport')).toBe(true);
  });

  it('rejects technical identifiers, which never occur in natural phrasing', () => {
    expect(leaks('run edit_method on ZCL_ORDER', 'SAPWrite', 'edit_method')).toBe(true);
    expect(leaks('Read DOMA BUKRS', 'SAPRead', 'DOMA')).toBe(true);
  });

  it('rejects schema-shaped mentions of an ordinary word', () => {
    expect(leaks('Call it with action=release for A4HK900123', 'SAPTransport', 'release')).toBe(true);
    expect(leaks('use action: format on this code', 'SAPLint', 'format')).toBe(true);
    expect(leaks('run the "activate" step on ZHELLO', 'SAPActivate', 'activate')).toBe(true);
  });

  it('accepts natural developer phrasing that happens to use the word', () => {
    // The first filter rejected these, which threw away coverage for every value that is an
    // ordinary English verb — activate, format, syntax — i.e. exactly the common paths.
    expect(leaks('Format this ABAP code properly', 'SAPLint', 'format')).toBe(false);
    expect(leaks('Activate ZHELLO for me', 'SAPActivate', 'activate')).toBe(false);
    expect(leaks('Check the syntax of ZCL_ORDER', 'SAPDiagnose', 'syntax')).toBe(false);
    expect(leaks('Ship transport A4HK900123 to QA', 'SAPTransport', 'release')).toBe(false);
  });

  it('does not false-positive a type code on an ordinary word containing it', () => {
    expect(leaks('Show me the domain behind field BUKRS', 'SAPRead', 'DOMA')).toBe(false);
    expect(leaks('What columns does the table T001 have', 'SAPRead', 'TABL')).toBe(false);
  });
});

describe('enumTargets', () => {
  const tools = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];
  const targets = enumTargets(tools);

  it('emits one target per enum value across action and type', () => {
    const read = targets.filter((t) => t.tool.name === 'SAPRead');
    const sapRead = tools.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const props = (sapRead as ToolDefinition).inputSchema as {
      properties: Record<string, { enum?: unknown[] }>;
    };
    expect(read).toHaveLength(props.properties.type.enum?.length ?? 0);
  });

  it('covers every tool, including ones with no enum discriminator', () => {
    expect(new Set(targets.map((t) => t.tool.name)).size).toBe(tools.length);
    expect(targets.filter((t) => t.tool.name === 'SAPQuery')).toHaveLength(1);
  });

  it('ignores single-value enums that carry no routing weight', () => {
    // SAPRead.action has one value and is never passed explicitly; counting it would read as 0/1.
    expect(targets.some((t) => t.tool.name === 'SAPRead' && t.key === 'action')).toBe(false);
  });
});
