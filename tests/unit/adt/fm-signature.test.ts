/**
 * Unit tests for src/adt/fm-signature.ts — pure-function FM signature
 * generator/parser/splicer (issue #252).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildFmSignatureClause,
  type FmParameter,
  parseFmSignature,
  spliceFmSignature,
} from '../../../src/adt/fm-signature.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../fixtures/abap/fm-signatures');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('buildFmSignatureClause', () => {
  it('returns empty string for empty params array', () => {
    expect(buildFmSignatureClause([])).toBe('');
  });

  it('emits IMPORTING by-value parameter with TYPE', () => {
    const out = buildFmSignatureClause([{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true }]);
    expect(out).toContain('IMPORTING');
    expect(out).toContain('VALUE(IV_X) TYPE STRING');
  });

  it('emits IMPORTING by-reference parameter (no VALUE() wrapper)', () => {
    const out = buildFmSignatureClause([{ kind: 'importing', name: 'IV_X', type: 'STRING' }]);
    expect(out).toContain('IMPORTING');
    expect(out).toContain('IV_X TYPE STRING');
    expect(out).not.toContain('VALUE(');
  });

  it('emits IMPORTING with DEFAULT and OPTIONAL', () => {
    const out = buildFmSignatureClause([
      { kind: 'importing', name: 'IV_X', type: 'C', byValue: true, default: "'X'", optional: true },
    ]);
    expect(out).toContain("VALUE(IV_X) TYPE C DEFAULT 'X' OPTIONAL");
  });

  it('emits multi-kind clauses in canonical order', () => {
    const params: FmParameter[] = [
      { kind: 'raising', name: 'CX_ROOT' },
      { kind: 'tables', name: 'IT_LINES', type: 'TYPE STANDARD TABLE' },
      { kind: 'exporting', name: 'EV_OUT', type: 'STRING', byValue: true },
      { kind: 'importing', name: 'IV_IN', type: 'STRING', byValue: true },
      { kind: 'changing', name: 'CV_X', type: 'I' },
      { kind: 'exceptions', name: 'BAD_INPUT' },
    ];
    const out = buildFmSignatureClause(params);
    const importingPos = out.indexOf('IMPORTING');
    const exportingPos = out.indexOf('EXPORTING');
    const changingPos = out.indexOf('CHANGING');
    const tablesPos = out.indexOf('TABLES');
    const exceptionsPos = out.indexOf('EXCEPTIONS');
    const raisingPos = out.indexOf('RAISING');
    expect(importingPos).toBeGreaterThan(-1);
    expect(importingPos).toBeLessThan(exportingPos);
    expect(exportingPos).toBeLessThan(changingPos);
    expect(changingPos).toBeLessThan(tablesPos);
    expect(tablesPos).toBeLessThan(exceptionsPos);
    expect(exceptionsPos).toBeLessThan(raisingPos);
  });

  it('emits TABLES with LIKE syntax verbatim', () => {
    const out = buildFmSignatureClause([{ kind: 'tables', name: 'RETURN', type: 'LIKE BAPIRET2', optional: true }]);
    expect(out).toContain('RETURN LIKE BAPIRET2 OPTIONAL');
  });

  it('emits TABLES with TYPE STANDARD TABLE syntax', () => {
    const out = buildFmSignatureClause([{ kind: 'tables', name: 'IT_X', type: 'TYPE STANDARD TABLE OF BAPIRET2' }]);
    expect(out).toContain('IT_X TYPE STANDARD TABLE OF BAPIRET2');
  });

  it('emits EXCEPTIONS with just the name (no VALUE/TYPE)', () => {
    const out = buildFmSignatureClause([{ kind: 'exceptions', name: 'BAD_INPUT' }]);
    expect(out).toContain('EXCEPTIONS');
    expect(out).toContain('BAD_INPUT');
    expect(out).not.toContain('TYPE');
    expect(out).not.toContain('VALUE');
  });

  it('emits RAISING with class-based exception (uppercase)', () => {
    const out = buildFmSignatureClause([{ kind: 'raising', name: 'CX_ROOT' }]);
    expect(out).toContain('RAISING');
    expect(out).toContain('CX_ROOT');
  });

  it('mixed EXCEPTIONS + RAISING — both clauses emitted', () => {
    const out = buildFmSignatureClause([
      { kind: 'exceptions', name: 'BAD_INPUT' },
      { kind: 'raising', name: 'CX_ROOT' },
    ]);
    expect(out).toContain('EXCEPTIONS');
    expect(out).toContain('RAISING');
  });
});

describe('parseFmSignature', () => {
  it('returns empty arrays for FUNCTION X. ENDFUNCTION.', () => {
    const result = parseFmSignature('FUNCTION X.\nENDFUNCTION.\n');
    expect(result.params).toEqual([]);
  });

  it('parses BAPI_USER_GETLIST fixture from real SAP source', () => {
    const source = readFixture('bapi-user-getlist.abap');
    const result = parseFmSignature(source);
    const importing = result.params.filter((p) => p.kind === 'importing');
    const exporting = result.params.filter((p) => p.kind === 'exporting');
    const tables = result.params.filter((p) => p.kind === 'tables');
    expect(importing.map((p) => p.name)).toEqual(['MAX_ROWS', 'WITH_USERNAME']);
    expect(exporting.map((p) => p.name)).toEqual(['ROWS']);
    expect(tables.map((p) => p.name)).toEqual(['SELECTION_RANGE', 'SELECTION_EXP', 'USERLIST', 'RETURN']);
    // First IMPORTING has DEFAULT 0; second has DEFAULT space (verbatim — SAP
    // emits lowercase, parser preserves case).
    expect(importing[0]?.default).toBe('0');
    expect(importing[1]?.default).toBe('space');
  });

  it('parses POPUP_TO_CONFIRM fixture (LIKE syntax + ##ADT_PARAMETER_UNTYPED pragma)', () => {
    const source = readFixture('popup-to-confirm.abap');
    const result = parseFmSignature(source);
    const importing = result.params.filter((p) => p.kind === 'importing');
    // At least 14 importing parameters expected.
    expect(importing.length).toBeGreaterThanOrEqual(14);
    // TITLEBAR — first param, has the pragma in the type.
    const titlebar = importing.find((p) => p.name === 'TITLEBAR');
    expect(titlebar).toBeDefined();
    // POPUP_TYPE has OPTIONAL (no DEFAULT, no pragma).
    const popupType = importing.find((p) => p.name === 'POPUP_TYPE');
    expect(popupType?.optional).toBe(true);
    // IV_QUICKINFO_BUTTON_1 is by-reference (no VALUE() wrapper in source).
    const ivQuickinfo = importing.find((p) => p.name === 'IV_QUICKINFO_BUTTON_1');
    expect(ivQuickinfo).toBeDefined();
    expect(ivQuickinfo?.byValue).toBeFalsy();
  });

  it('handles mixed-case input (function x importing value(iv_x) type string.)', () => {
    const result = parseFmSignature('function x\n  importing\n    value(iv_x) type string.\nendfunction.\n');
    expect(result.params).toHaveLength(1);
    expect(result.params[0]?.kind).toBe('importing');
    expect(result.params[0]?.name).toBe('IV_X');
    expect(result.params[0]?.byValue).toBe(true);
  });

  it('extracts DEFAULT clauses for IMPORTING parameters', () => {
    const result = parseFmSignature(
      "FUNCTION X\n  IMPORTING\n    VALUE(IV_X) TYPE STRING DEFAULT 'hello'.\nENDFUNCTION.\n",
    );
    expect(result.params[0]?.default).toBe("'hello'");
  });

  it('extracts OPTIONAL flag for parameters', () => {
    const result = parseFmSignature('FUNCTION X\n  IMPORTING\n    VALUE(IV_X) TYPE STRING OPTIONAL.\nENDFUNCTION.\n');
    expect(result.params[0]?.optional).toBe(true);
  });

  it('parses RAISING class-based exceptions', () => {
    const result = parseFmSignature(
      'FUNCTION X\n  IMPORTING\n    VALUE(IV_X) TYPE STRING\n  RAISING\n    CX_SY_NO_HANDLER.\nENDFUNCTION.\n',
    );
    const raising = result.params.filter((p) => p.kind === 'raising');
    expect(raising).toHaveLength(1);
    expect(raising[0]?.name).toBe('CX_SY_NO_HANDLER');
  });

  it('parses EXCEPTIONS classical-style', () => {
    const result = parseFmSignature(
      'FUNCTION X\n  IMPORTING\n    VALUE(IV_X) TYPE STRING\n  EXCEPTIONS\n    BAD_INPUT.\nENDFUNCTION.\n',
    );
    const exceptions = result.params.filter((p) => p.kind === 'exceptions');
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.name).toBe('BAD_INPUT');
  });

  it('returns body bounds that exclude the signature region', () => {
    const source = 'FUNCTION X\n  IMPORTING\n    VALUE(IV_X) TYPE STRING.\n  body line.\nENDFUNCTION.\n';
    const result = parseFmSignature(source);
    expect(source.slice(result.bodyStart, result.bodyEnd)).toContain('body line.');
    expect(source.slice(result.bodyStart, result.bodyEnd)).not.toContain('IMPORTING');
  });
});

describe('spliceFmSignature', () => {
  it('replaces existing signature, preserves body', () => {
    const source = 'FUNCTION x\n  IMPORTING\n    name TYPE c.\n  body line.\nENDFUNCTION.\n';
    const result = spliceFmSignature(source, 'X', [
      { kind: 'importing', name: 'NEW_PARAM', type: 'STRING', byValue: true },
    ]);
    expect(result).toContain('VALUE(NEW_PARAM) TYPE STRING');
    expect(result).toContain('body line.');
    expect(result).not.toContain('name TYPE c');
  });

  it('inserts signature into bare stub', () => {
    const source = 'FUNCTION x.\nENDFUNCTION.\n';
    const result = spliceFmSignature(source, 'X', [{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true }]);
    expect(result).toMatch(/FUNCTION X[\s\n]+IMPORTING/);
    expect(result).toContain('VALUE(IV_X) TYPE STRING');
    expect(result).toContain('ENDFUNCTION.');
  });

  it('preserves body when params array is empty', () => {
    const source = 'FUNCTION x\n  IMPORTING\n    name TYPE c.\n  body line.\nENDFUNCTION.\n';
    const result = spliceFmSignature(source, 'X', []);
    expect(result).toContain('body line.');
    expect(result).not.toContain('IMPORTING');
  });

  it('throws when source has no FUNCTION keyword', () => {
    expect(() => spliceFmSignature('REPORT zfoo.\nWRITE / 1.\n', 'X', [])).toThrow(/FUNCTION/);
  });

  it('does not strip body content that contains the literal word IMPORTING', () => {
    const source = 'FUNCTION x.\n  WRITE / `IMPORTING is the start of a parameter clause`.\nENDFUNCTION.\n';
    const result = spliceFmSignature(source, 'X', []);
    expect(result).toContain('IMPORTING is the start of a parameter clause');
  });
});

describe('round-trip: parseFmSignature(buildFmSignatureClause(p)) === p', () => {
  it('preserves a representative mixed-kind parameter array', () => {
    const seed: FmParameter[] = [
      { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true, default: "'hello'", optional: true },
      { kind: 'importing', name: 'IV_REF', type: 'I' },
      { kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true },
      { kind: 'changing', name: 'CV_FLAG', type: 'I' },
      { kind: 'tables', name: 'IT_LINES', type: 'TYPE STANDARD TABLE', optional: true },
      { kind: 'exceptions', name: 'BAD_INPUT' },
      { kind: 'raising', name: 'CX_ROOT' },
    ];
    const clause = buildFmSignatureClause(seed);
    const wrapped = `FUNCTION X\n${clause}.\nENDFUNCTION.\n`;
    const reparsed = parseFmSignature(wrapped);
    // Names + kinds round-trip exactly.
    expect(reparsed.params.map((p) => ({ kind: p.kind, name: p.name }))).toEqual(
      seed.map((p) => ({ kind: p.kind, name: p.name })),
    );
    // Flags survive: byValue, default, optional.
    const importing = reparsed.params.filter((p) => p.kind === 'importing');
    expect(importing[0]?.byValue).toBe(true);
    expect(importing[0]?.default).toBe("'hello'");
    expect(importing[0]?.optional).toBe(true);
    expect(importing[1]?.byValue).toBeFalsy();
  });
});
