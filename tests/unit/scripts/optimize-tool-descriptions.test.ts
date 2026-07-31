/**
 * The optimizer's one load-bearing guard: a rewritten tool may differ from the original in
 * `description` strings and nothing else. An LLM that drops an enum value or renames a property
 * would still pass the eval (evals cover a fraction of call paths) while breaking every path they
 * miss — so this walker is what actually keeps the loop safe. Test it, not the loop.
 */

import { describe, expect, it } from 'vitest';
import { descriptionsOnlyDiff } from '../../../scripts/optimize-tool-descriptions.js';

const TOOL = {
  name: 'SAPRead',
  description: 'Read an ABAP object.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['CLAS', 'PROG', 'DDLS'], description: 'Object type.' },
      name: { type: 'string', description: 'Object name.' },
    },
    required: ['type', 'name'],
  },
};

const clone = () => JSON.parse(JSON.stringify(TOOL));

describe('descriptionsOnlyDiff', () => {
  it('accepts a rewrite that only shortens descriptions', () => {
    const after = clone();
    after.description = 'Read ABAP object.';
    after.inputSchema.properties.type.description = 'Type.';
    expect(descriptionsOnlyDiff(TOOL, after)).toBeNull();
  });

  it('rejects a dropped enum value', () => {
    const after = clone();
    after.inputSchema.properties.type.enum = ['CLAS', 'PROG'];
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/array length/);
  });

  it('rejects a reordered enum', () => {
    const after = clone();
    after.inputSchema.properties.type.enum = ['PROG', 'CLAS', 'DDLS'];
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/enum\[0\]: string changed/);
  });

  it('rejects a renamed property', () => {
    const after = clone();
    after.inputSchema.properties.objectName = after.inputSchema.properties.name;
    delete after.inputSchema.properties.name;
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/keys differ/);
  });

  it('rejects a dropped required entry', () => {
    const after = clone();
    after.inputSchema.required = ['type'];
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/array length/);
  });

  it('rejects a changed tool name', () => {
    const after = clone();
    after.name = 'SAPReadFast';
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/string changed/);
  });

  it('rejects a flipped boolean or type', () => {
    const after = clone();
    after.inputSchema.properties.name.type = 'number';
    expect(descriptionsOnlyDiff(TOOL, after)).toMatch(/string changed/);
  });
});
