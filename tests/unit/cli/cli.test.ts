import { describe, expect, it } from 'vitest';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import { detectFilename } from '../../../src/lint/lint.js';
import { VERSION } from '../../../src/server/server.js';

describe('CLI', () => {
  it('has a valid version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('detectFilename works for CLI lint command', () => {
    expect(detectFilename('REPORT ztest.', 'ZTEST')).toBe('ztest.prog.abap');
    expect(detectFilename('CLASS zcl_test DEFINITION.', 'ZCL_TEST')).toBe('zcl_test.clas.abap');
  });

  // Pins the arg shapes the `sql` / `search` shortcuts must send. The schemas have
  // no `action` field and SAPQuery's query field is `sql` (not `query`) — passing the
  // old `{ action, query }` shape made `arc1-cli sql "..."` always fail Zod validation.
  it('sql shortcut arg shape satisfies SAPQuerySchema', () => {
    const schema = getToolSchema('SAPQuery', false)!;
    expect(schema.safeParse({ sql: 'SELECT mandt FROM t000' }).success).toBe(true);
    expect(schema.safeParse({ action: 'sql', query: 'SELECT mandt FROM t000' }).success).toBe(false);
  });

  it('search shortcut arg shape satisfies SAPSearchSchema', () => {
    const schema = getToolSchema('SAPSearch', false)!;
    expect(schema.safeParse({ query: 'ZCL_FOO*', maxResults: 50 }).success).toBe(true);
  });
});
