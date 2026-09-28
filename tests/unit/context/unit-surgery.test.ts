import { Version } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { insertUnit, listEditableUnits, spliceUnit } from '../../../src/context/unit-surgery.js';

const PROGRAM = `REPORT zunit_surgery.

FORM alpha USING iv_value TYPE i.
  WRITE iv_value.
ENDFORM.

FORM beta.
  WRITE 'old beta'.
ENDFORM.

MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
ENDMODULE.

START-OF-SELECTION.
  PERFORM alpha USING 1.`;

describe('procedural ABAP unit surgery', () => {
  it('lists FORM and MODULE blocks with exact ranges, excluding event blocks', () => {
    const units = listEditableUnits(PROGRAM, 'ZUNIT_SURGERY');
    expect(units).toEqual([
      { name: 'alpha', kind: 'FORM', startLine: 3, endLine: 5 },
      { name: 'beta', kind: 'FORM', startLine: 7, endLine: 9 },
      { name: 'status_0100', kind: 'MODULE', startLine: 11, endLine: 13 },
    ]);
    expect(units.some((unit) => unit.name.toUpperCase() === 'START-OF-SELECTION')).toBe(false);
  });

  it('finds procedural structures with both supported 7.50 and 7.58 grammars', () => {
    for (const version of [Version.v750, Version.v758]) {
      expect(listEditableUnits(PROGRAM, 'ZUNIT_SURGERY', version).map((unit) => unit.kind)).toEqual([
        'FORM',
        'FORM',
        'MODULE',
      ]);
    }
  });

  it('replaces one FORM and leaves sibling units unchanged', () => {
    const result = spliceUnit(
      PROGRAM,
      'ZUNIT_SURGERY',
      'BETA',
      `FORM beta.
  WRITE 'new beta'.
ENDFORM.`,
    );
    expect(result.success).toBe(true);
    expect(result.unit).toMatchObject({ name: 'beta', kind: 'FORM' });
    expect(result.oldUnitSource).toContain("WRITE 'old beta'.");
    expect(result.newSource).toContain("WRITE 'new beta'.");
    expect(result.newSource).toContain('FORM alpha USING iv_value TYPE i.');
    expect(result.newSource).toContain("SET PF-STATUS 'MAIN'.");
    expect(result.newSource).not.toContain("WRITE 'old beta'.");
  });

  it('replaces a MODULE block', () => {
    const result = spliceUnit(
      PROGRAM,
      'ZUNIT_SURGERY',
      'status_0100',
      `MODULE status_0100 OUTPUT.
  SET PF-STATUS 'DETAIL'.
ENDMODULE.`,
    );
    expect(result.success).toBe(true);
    expect(result.unit?.kind).toBe('MODULE');
    expect(result.newSource).toContain("SET PF-STATUS 'DETAIL'.");
    expect(result.newSource).not.toContain("SET PF-STATUS 'MAIN'.");
  });

  it('parses bare include fragments and preserves CRLF line endings', () => {
    const include = "FORM first.\r\n  WRITE 'one'.\r\nENDFORM.\r\n\r\nFORM second.\r\nENDFORM.";
    const result = spliceUnit(include, 'ZUNIT_INCLUDE', 'first', "FORM first.\n  WRITE 'changed'.\nENDFORM.");
    expect(result.success).toBe(true);
    expect(result.newSource).toContain("FORM first.\r\n  WRITE 'changed'.\r\nENDFORM.");
    expect(result.newSource.replace(/\r\n/g, '')).not.toContain('\n');
    expect(result.newSource).toContain('FORM second.');
  });

  it('returns available units when the requested name is absent', () => {
    const result = spliceUnit(PROGRAM, 'ZUNIT_SURGERY', 'missing', 'FORM missing.\nENDFORM.');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unit "missing" not found');
    expect(result.error).toContain('FORM alpha');
    expect(result.error).toContain('MODULE status_0100');
  });

  it('rejects replacement blocks with a different name or kind', () => {
    const wrongName = spliceUnit(PROGRAM, 'ZUNIT_SURGERY', 'beta', 'FORM other.\nENDFORM.');
    expect(wrongName.success).toBe(false);
    expect(wrongName.error).toContain('declares FORM "other"');

    const wrongKind = spliceUnit(PROGRAM, 'ZUNIT_SURGERY', 'beta', 'MODULE beta OUTPUT.\nENDMODULE.');
    expect(wrongKind.success).toBe(false);
    expect(wrongKind.error).toContain('replacement starts with MODULE');
  });

  it('requires a complete replacement block', () => {
    const bodyOnly = spliceUnit(PROGRAM, 'ZUNIT_SURGERY', 'beta', "WRITE 'new'.");
    expect(bodyOnly.success).toBe(false);
    expect(bodyOnly.error).toContain('complete FORM beta');

    const missingEnd = spliceUnit(PROGRAM, 'ZUNIT_SURGERY', 'beta', "FORM beta.\n  WRITE 'new'.");
    expect(missingEnd.success).toBe(false);
    expect(missingEnd.error).toContain('must end with ENDFORM');
  });

  it('rejects replacement payloads containing an additional procedural block', () => {
    const result = spliceUnit(
      PROGRAM,
      'ZUNIT_SURGERY',
      'beta',
      "FORM beta.\n  WRITE 'new'.\nENDFORM.\n\nFORM injected.\nENDFORM.",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('exactly one complete FORM beta');
  });
});

describe('insertUnit', () => {
  const addition = 'FORM gamma.\n  WRITE 3.\nENDFORM.';
  it.each([
    { placement: {}, marker: PROGRAM, direction: 'after' },
    { placement: { beforeUnit: 'BETA' }, marker: 'FORM beta.', direction: 'before' },
    { placement: { afterUnit: 'beta' }, marker: "WRITE 'old beta'.\nENDFORM.", direction: 'after' },
  ])('inserts at $placement without changing existing lines', ({ placement, marker, direction }) => {
    const result = insertUnit(PROGRAM, 'ZUNIT', 'gamma', addition, placement);
    expect(result.success, result.error).toBe(true);
    expect(result.newSource.replace(`${addition}\n`, '')).toBe(
      placement.beforeUnit || placement.afterUnit ? PROGRAM : `${PROGRAM}\n`,
    );
    expect(result.newSource.indexOf(addition) < result.newSource.indexOf(marker)).toBe(direction === 'before');
  });

  it('appends the first MODULE and leaves trailing INCLUDEs in place, preserving CRLF', () => {
    const original = 'PROGRAM zmod.\r\nINCLUDE zmod_forms.\r\n';
    const result = insertUnit(original, 'ZMOD', 'status', 'MODULE status OUTPUT.\nENDMODULE.');
    expect(result.success, result.error).toBe(true);
    expect(result.newSource).toContain(original);
    expect(result.newSource.replace(/\r\n/g, '')).not.toContain('\n');
    expect(result.newSource.indexOf('MODULE status')).toBeGreaterThan(result.newSource.indexOf('INCLUDE'));
  });

  it.each([
    { label: 'duplicate', source: PROGRAM, name: 'ALPHA', block: 'FORM alpha.\nENDFORM.', placement: {} },
    { label: 'different name', source: PROGRAM, name: 'gamma', block: 'FORM other.\nENDFORM.', placement: {} },
    {
      label: 'two units',
      source: PROGRAM,
      name: 'gamma',
      block: 'FORM gamma.\nENDFORM.\nFORM delta.\nENDFORM.',
      placement: {},
    },
    { label: 'missing end', source: PROGRAM, name: 'gamma', block: 'FORM gamma.\nWRITE 1.', placement: {} },
    { label: 'non-unit', source: PROGRAM, name: 'gamma', block: 'WRITE 1.', placement: {} },
    { label: 'unclosed original', source: 'FORM alpha.\nWRITE 1.', name: 'gamma', block: addition, placement: {} },
    { label: 'missing anchor', source: PROGRAM, name: 'gamma', block: addition, placement: { afterUnit: 'absent' } },
    {
      label: 'ambiguous anchor',
      source: 'FORM a.\nENDFORM.\nMODULE a OUTPUT.\nENDMODULE.',
      name: 'gamma',
      block: addition,
      placement: { beforeUnit: 'a' },
    },
    {
      label: 'two anchors',
      source: PROGRAM,
      name: 'gamma',
      block: addition,
      placement: { beforeUnit: 'alpha', afterUnit: 'beta' },
    },
    {
      label: 'shared boundary line',
      source: 'FORM a. ENDFORM. WRITE 1.',
      name: 'gamma',
      block: addition,
      placement: { afterUnit: 'a' },
    },
  ])('refuses $label without producing replacement source', (row) => {
    const result = insertUnit(row.source, 'ZUNIT', row.name, row.block, row.placement);
    expect(result.success).toBe(false);
    expect(result.newSource).toBe('');
    expect(result.error).toBeTruthy();
  });
});
