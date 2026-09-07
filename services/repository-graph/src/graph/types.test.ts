import { describe, expect, it } from 'vitest';
import { normalizeNodeRef, validateTraversalOptions } from './types.js';

describe('graph contract', () => {
  it('normalizes system-scoped repository identities', () => {
    expect(normalizeNodeRef({ systemKey: 'trial-001', type: 'clas', name: '/demo/cl_example' })).toEqual({
      systemKey: 'TRIAL-001',
      type: 'CLAS',
      name: '/DEMO/CL_EXAMPLE',
    });
  });

  it('rejects unsafe or ambiguous identities', () => {
    expect(() => normalizeNodeRef({ systemKey: '../other', type: 'CLAS', name: 'ZCL_A' })).toThrow('systemKey');
    expect(() => normalizeNodeRef({ systemKey: 'TRIAL', type: 'CLAS?', name: 'ZCL_A' })).toThrow('type');
    expect(() => normalizeNodeRef({ systemKey: 'TRIAL', type: 'CLAS', name: 'A\nB' })).toThrow('name');
  });

  it('bounds traversal work', () => {
    expect(() => validateTraversalOptions({ maxHops: 4 })).toThrow('maxHops');
    expect(() => validateTraversalOptions({ edgeBudget: 10_001 })).toThrow('edgeBudget');
    expect(() => validateTraversalOptions({ maxEdges: 301 })).toThrow('maxEdges');
    expect(() => validateTraversalOptions({ maxNodes: 101 })).toThrow('maxNodes');
    expect(() => validateTraversalOptions({ statementTimeoutMs: 2_001 })).toThrow('statementTimeoutMs');
    expect(validateTraversalOptions({ maxHops: 3 })).toMatchObject({ maxHops: 3, maxNodes: 100 });
  });
});
