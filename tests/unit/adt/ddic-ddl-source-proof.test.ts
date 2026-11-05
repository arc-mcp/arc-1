import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  editableSourceEquals,
  prepareDdicDdlSourceVerification,
  sourceHash,
} from '../../../src/adt/source-precondition.js';

const native = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/structure-source-a4h-readback.json', import.meta.url), 'utf8'),
);
const table = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/table-source-a4h-readback.json', import.meta.url), 'utf8'),
);
const ddl = "@EndUserText.label : 'Keep Case'\ndefine structure ztest {\n  field : abap.char(4);\n}\n";

describe('DDIC DDL empty-line readback proof', () => {
  it('reproduces the exact native representation without relaxing exact hashes or the generic comparator', () => {
    expect(sourceHash(native.requested)).toBe(native.requestedSha256);
    expect(sourceHash(native.readback)).toBe(native.readbackSha256);
    expect(editableSourceEquals(native.readback, native.requested)).toBe(false);
    expect(prepareDdicDdlSourceVerification(native.requested)(native.readback)).toBe(true);
  });
  it('accepts captured native table field alignment while preserving both distinct raw hashes', () => {
    expect(sourceHash(table.requested)).toBe(table.requestedSha256);
    expect(sourceHash(table.readback)).toBe(table.readbackSha256);
    expect(table.requestedSha256).not.toBe(table.readbackSha256);
    expect(editableSourceEquals(table.readback, table.requested)).toBe(false);
    expect(prepareDdicDdlSourceVerification(table.requested)(table.readback)).toBe(true);
    expect(prepareDdicDdlSourceVerification(table.readback)(table.requested)).toBe(true);
  });
  it.each([' ', '  ', '\t', ' \t  '])('allows an existing internal code separator to be %j', (spacing) => {
    const aligned = ddl.replace('field :', `field${spacing}:`);
    expect(prepareDdicDdlSourceVerification(ddl)(aligned)).toBe(true);
    expect(prepareDdicDdlSourceVerification(aligned)(ddl)).toBe(true);
  });
  it.each([
    "@label : 'Keep  spaces'",
    '@label : "Keep  spaces"',
    '// Keep  spaces',
    '-- Keep  spaces',
    '/* Keep  spaces */',
    '/* block\nKeep  spaces\n*/',
    "@label : 'Keep\n  spaces'",
  ])('preserves every internal space in the opaque span %s', (span) => {
    const source = `${span}\n${ddl}`;
    expect(prepareDdicDdlSourceVerification(source)(source.replace('field :', 'field     :'))).toBe(true);
    expect(prepareDdicDdlSourceVerification(source)(source.replace('  spaces', ' spaces'))).toBe(false);
  });
  it.each([
    ['field', 'fi eld'],
    ['abap.char', 'abap .char'],
    ['field :', 'field:'],
    ['  field', '\tfield'],
    ['char(4);', 'char(4); '],
  ])('never inserts or removes a boundary, indentation, or trailing bytes: %s / %s', (from, to) => {
    expect(prepareDdicDdlSourceVerification(ddl)(ddl.replace(from, to))).toBe(false);
  });
  it.each([0, 1, 7])('allows %i complete empty code lines with CRLF and final-newline normalization', (n) => {
    const saved = ('\n'.repeat(n) + ddl.replace('{\n', '{\n' + '\n'.repeat(n))).trimEnd().replaceAll('\n', '\r\n');
    expect(prepareDdicDdlSourceVerification(ddl)(saved)).toBe(true);
    expect(prepareDdicDdlSourceVerification(saved)(ddl)).toBe(true);
  });
  it.each([
    ["'Keep Case'", "'keep case'"],
    ['ztest', 'zother'],
    ['char(4)', 'char(5)'],
    ['field', 'other'],
    ['structure', 'table'],
    ['  field', ' field'],
    ['char(4)', 'char( 4 )'],
    ['field :', 'field:'],
    ['{\n', '{\n \n'],
    ['{\n', '{\n\t\n'],
    ['label', 'quickInfo'],
    [';\n', '; // changed\n'],
  ])('refuses a nonempty-line change from %s to %s', (from, to) => {
    expect(prepareDdicDdlSourceVerification(ddl)(ddl.replace(from, to))).toBe(false);
  });
  it.each(['/* Keep\n\nthis comment */', "'Keep\n\nthis literal'", '"Keep\n\nthis quoted name"'])(
    'preserves empty lines within %s',
    (span) => {
      const source = span + '\n' + ddl;
      const matches = prepareDdicDdlSourceVerification(source);
      expect(matches(source.replace('}\n', '\n}\n'))).toBe(true);
      expect(matches(source.replace('\n\n', '\n'))).toBe(false);
    },
  );
  it.each(['//', '--'])('preserves %s line comments including quote-like text', (prefix) => {
    const comment = `${prefix} 'unclosed quote and /* text`;
    const source = `${comment}\n${ddl}`;
    expect(prepareDdicDdlSourceVerification(source)(`${comment}\n\n${ddl}`)).toBe(true);
    expect(prepareDdicDdlSourceVerification(source)(source.replace('text', 'other'))).toBe(false);
  });
  it.each([
    "'doubled '' quote /* literal */'",
    '"doubled "" quote // literal"',
    String.raw`'backslash \' quote /* literal */'`,
    String.raw`"backslash \" quote -- literal"`,
    String.raw`'escaped \\ then close'`,
  ])('keeps escaped quote/comment delimiters inside %s', (span) => {
    const source = `@label: ${span}\n${ddl}`;
    const verify = prepareDdicDdlSourceVerification(source);
    expect(verify(source.replace('{\n', '{\n\n'))).toBe(true);
    expect(verify(source.replace('literal', 'changed'))).toBe(span.includes('literal') ? false : true);
  });
  it.each([
    "'unclosed",
    '"unclosed',
    '/* unclosed',
    '/* nested /* opener */',
    String.raw`"paired \\ before quote"`,
    '*/ unmatched',
    '`unknown delimiter`',
    "'backslash at line end\\\n'",
    "'escaped final \\'",
    "'doubled final ''",
    '\r',
    '\u2028',
    '\u2029',
    '\u0085',
    '\u000b',
    '',
    '   ',
  ])('refuses unsupported or unclosed lexical boundaries %j before save', (span) => {
    const source = ['', '   '].includes(span) ? span : `${ddl}${span}`;
    expect(() => prepareDdicDdlSourceVerification(source)).toThrow('No source save was sent');
    expect(prepareDdicDdlSourceVerification(ddl)(source)).toBe(false);
  });
  it('bounds both requested and stored proof work', () => {
    const huge = ddl + 'x'.repeat(1024 * 1024);
    expect(() => prepareDdicDdlSourceVerification(huge)).toThrow('source budget');
    expect(prepareDdicDdlSourceVerification(ddl)(huge)).toBe(false);
  });
});
