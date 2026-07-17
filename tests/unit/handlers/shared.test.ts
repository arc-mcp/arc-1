import { describe, expect, it } from 'vitest';
import { errorResult, textResult, toolJson } from '../../../src/handlers/shared.js';

describe('toolJson', () => {
  it('emits compact JSON — no pretty-print whitespace', () => {
    const json = toolJson({ total: 2, refs: [{ name: 'A' }, { name: 'B' }] });
    expect(json).toBe('{"total":2,"refs":[{"name":"A"},{"name":"B"}]}');
    expect(json).not.toContain('\n');
    expect(json).not.toContain('  ');
  });

  it('stays valid, round-trippable JSON', () => {
    const value = { a: 1, b: [1, 2], c: { d: null }, e: 'x"y', f: 'ü' };
    expect(JSON.parse(toolJson(value))).toEqual(value);
  });

  it('is materially smaller than pretty-printed output', () => {
    // The whole point: 2-space indent + newlines cost 15-37% of every JSON result.
    // Measured live post-bounding: where-used 11,856 -> 8,781 tokens, transport 5,689 -> 3,581.
    const rows = Array.from({ length: 100 }, (_, i) => ({
      uri: `/sap/bc/adt/oo/classes/zcl_${i}`,
      type: 'CLAS/OC',
      name: `ZCL_${i}`,
      line: 0,
      column: 0,
      packageName: '$TMP',
    }));
    const compact = toolJson({ total: 100, references: rows }).length;
    const pretty = JSON.stringify({ total: 100, references: rows }, null, 2).length;
    expect(compact).toBeLessThan(pretty * 0.8);
  });

  it('preserves falsy values that carry meaning', () => {
    // Pruning ""/0/false was rejected: isResult:false distinguishes a real where-used hit from a
    // structural tree node, and line:0 means "no line info". Absent would not mean the same thing.
    const json = toolJson({ isResult: false, line: 0, snippet: '' });
    expect(JSON.parse(json)).toEqual({ isResult: false, line: 0, snippet: '' });
  });
});

describe('textResult / errorResult', () => {
  it('wraps text in the MCP content shape', () => {
    expect(textResult('hi')).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('flags errors with isError', () => {
    expect(errorResult('bad')).toEqual({ content: [{ type: 'text', text: 'bad' }], isError: true });
  });
});
