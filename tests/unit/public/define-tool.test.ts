import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { OperationType } from '../../../src/adt/safety.js';
import { defineTool } from '../../../src/public/index.js';

const base = {
  name: 'Custom_Foo' as const,
  description: 'does a thing',
  schema: z.object({ x: z.string() }),
  policy: { scope: 'read' as const, opType: OperationType.Read },
  handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
};

describe('defineTool', () => {
  it('returns a valid definition unchanged', () => {
    expect(defineTool(base)).toBe(base);
  });

  it('rejects a name outside the Custom_ namespace', () => {
    expect(() => defineTool({ ...base, name: 'Foo' as `Custom_${string}` })).toThrow(/Custom_/);
  });

  it('rejects a missing description', () => {
    expect(() => defineTool({ ...base, description: '' })).toThrow(/description/);
  });

  it('rejects a missing schema', () => {
    expect(() => defineTool({ ...base, schema: undefined as unknown as typeof base.schema })).toThrow(/schema/);
  });

  it('rejects a policy missing opType', () => {
    expect(() => defineTool({ ...base, policy: { scope: 'read' } as unknown as typeof base.policy })).toThrow(/opType/);
  });

  it('rejects a non-function handler', () => {
    expect(() => defineTool({ ...base, handler: undefined as unknown as typeof base.handler })).toThrow(/handler/);
  });
});
