import { Version } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { listEditableUnits, spliceUnit } from '../../../src/context/unit-surgery.js';

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
