import { describe, expect, it } from 'vitest';
import type { GraphImport } from '../types.js';
import { validateGraphImport } from './import-validation.js';

const graph = (): GraphImport => ({
  systemKey: 'TEST',
  scope: 'test',
  extractorVersion: '1',
  nodes: [{ name: 'ZTEST', type: 'CLAS', systemKey: 'TEST' }],
  observations: [],
});
describe('portable graph import limits', () => {
  it('accepts scoped metadata and rejects oversized or cross-system nodes', () => {
    expect(validateGraphImport(graph())).toBe('TEST');
    for (const patch of [{ description: 'x'.repeat(1025) }, { systemKey: 'OTHER' }, { locator: 'bad\u0000value' }]) {
      const input = graph();
      Object.assign(input.nodes[0]!, patch);
      expect(() => validateGraphImport(input)).toThrow();
    }
  });
  it('rejects invalid evidence and publication limits', () => {
    const input = graph();
    input.observations = [
      {
        source: input.nodes[0]!,
        target: input.nodes[0]!,
        relation: 'references',
        evidenceMethod: 'm',
        evidenceOwner: '',
        sourceResource: 'r',
      },
    ];
    expect(() => validateGraphImport(input)).toThrow();
    expect(() => validateGraphImport({ ...graph(), nodes: Array(100_001).fill(graph().nodes[0]) })).toThrow('limits');
  });
});
