import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodError } from '../../../src/handlers/zod-errors.js';

describe('formatZodError', () => {
  it('formats invalid enum value', () => {
    const schema = z.object({ type: z.enum(['PROG', 'CLAS', 'INTF']) });
    const result = schema.safeParse({ type: 'INVALID' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPRead');
      expect(msg).toContain('Invalid arguments for SAPRead');
      expect(msg).toContain('"type"');
      expect(msg).toContain('PROG');
      expect(msg).toContain('CLAS');
      expect(msg).toContain('Hint:');
    }
  });

  it('formats missing required field', () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPWrite');
      expect(msg).toContain('Invalid arguments for SAPWrite');
      expect(msg).toContain('"name"');
      expect(msg).toContain('required');
    }
  });

  it('formats wrong type error', () => {
    const schema = z.object({ count: z.number() });
    const result = schema.safeParse({ count: 'not-a-number' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPQuery');
      expect(msg).toContain('Invalid arguments for SAPQuery');
      expect(msg).toContain('"count"');
    }
  });

  it('formats multiple issues', () => {
    const schema = z.object({ type: z.enum(['A', 'B']), name: z.string() });
    const result = schema.safeParse({ type: 'X' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPRead');
      const lines = msg.split('\n').filter((l) => l.startsWith('  - '));
      expect(lines.length).toBe(2);
    }
  });

  it('formats unrecognized keys', () => {
    const schema = z.strictObject({ type: z.enum(['A']) });
    const result = schema.safeParse({ type: 'A', foo: 'bar' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPRead');
      expect(msg).toContain('Unknown parameter(s)');
      expect(msg).toContain('foo');
    }
  });

  it('includes tool name in output', () => {
    const schema = z.object({ x: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPNavigate');
      expect(msg).toContain('SAPNavigate');
    }
  });

  it('includes a non-retry hint line (issue #360)', () => {
    const schema = z.object({ x: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error, 'SAPRead');
      // Tells the LLM client to fix the listed fields and NOT resend the same args unchanged,
      // and to omit (not blank/null) optional fields it does not need.
      expect(msg).toContain('do NOT resend the same arguments unchanged');
      expect(msg).toContain('omit optional fields');
    }
  });
});
