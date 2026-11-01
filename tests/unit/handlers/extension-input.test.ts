import { describe, expect, it } from 'vitest';
import { extensionReadMode } from '../../../src/handlers/extension-read.js';
import { SAPReadSchema, SAPReadSchemaBtp } from '../../../src/handlers/schemas.js';

describe('extension read inputs', () => {
  it.each([SAPReadSchema, SAPReadSchemaBtp])('accepts DDIC modes without adding a tool', (schema) => {
    for (const extensions of ['none', 'summary', 'sources'])
      expect(schema.safeParse({ type: 'TABL', name: 'ZROOT', extensions }).success).toBe(true);
    expect(schema.safeParse({ type: 'TABL', extensions: 'all' }).success).toBe(false);
  });
  it('accepts only an internally addressable main-object context for standalone INCL', () => {
    const context = { type: 'PROG', name: '/ARC/MAIN' };
    expect(
      SAPReadSchema.safeParse({ type: 'INCL', name: 'ZINCL', enhancementContext: context, extensions: 'sources' })
        .success,
    ).toBe(true);
    for (const type of ['CLAS', 'TABL', 'PROG'])
      expect(SAPReadSchema.safeParse({ type, enhancementContext: context }).success).toBe(false);
    for (const name of ['https://evil.invalid', '../other', 'main?client=002'])
      expect(SAPReadSchema.safeParse({ type: 'INCL', enhancementContext: { ...context, name } }).success).toBe(false);
    expect(
      SAPReadSchema.safeParse({ type: 'INCL', enhancementContext: { ...context, uri: '/sap/bc/adt/other' } }).success,
    ).toBe(false);
  });
  it('refuses modes for non-source reads, excluded families, diff and editable envelopes', () => {
    for (const args of [
      { type: 'DDLS' },
      { type: 'TABLE_CONTENTS' },
      { type: 'TABL', include: 'indexes' },
      { type: 'TABL', action: 'diff', name: 'ZROOT' },
      { type: 'CLAS', format: 'editable' },
    ])
      expect(SAPReadSchema.safeParse({ ...args, extensions: 'summary' }).success).toBe(false);
  });
  it('defaults only qualified full DDIC/source-plugin reads to summary', () => {
    for (const type of ['TABL', 'PROG', 'INCL', 'FUNC', 'FUGR']) expect(extensionReadMode({ type })).toBe('summary');
    for (const args of [
      { type: 'CLAS' },
      { type: 'TABL', grep: 'field' },
      { type: 'TABL', lineStart: 1 },
      { type: 'CLAS', method: 'READ' },
      { type: 'CLAS', include: 'definitions' },
    ])
      expect(extensionReadMode(args)).toBe('none');
    expect(extensionReadMode({ type: 'TABL', grep: 'field', extensions: 'sources' })).toBe('sources');
  });
});
