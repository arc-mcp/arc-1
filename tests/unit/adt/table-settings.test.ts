import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTableSettings, parseTableSettingsPatch, patchTableSettingsXml } from '../../../src/adt/table-settings.js';

const fixture = readFileSync(new URL('../../fixtures/table-settings-758.xml', import.meta.url), 'utf8');
const loggingField = '<ts:loggingEnabled>false</ts:loggingEnabled>';

describe('table change logging', () => {
  it.each([true, false])('accepts the explicit JSON boolean %s', (loggingEnabled) => {
    expect(parseTableSettingsPatch(JSON.stringify({ loggingEnabled }))).toEqual({ loggingEnabled });
  });
  it.each(['false', 'true', 0, 1, null])('rejects nonboolean input %j', (loggingEnabled) => {
    expect(() => parseTableSettingsPatch(JSON.stringify({ loggingEnabled }))).toThrow('Invalid TABL/DTT source');
  });
  it.each([
    ['true', true],
    ['false', false],
  ] as const)('reads native %s as a boolean while retaining the raw value', (native, expected) => {
    const xml = fixture.replace(loggingField, `<ts:loggingEnabled>${native}</ts:loggingEnabled>`);
    expect(parseTableSettings(xml, 'ZTEST')).toMatchObject({
      source: { loggingEnabled: expected },
      loggingEnabled: native,
    });
  });
  it.each([true, false])('changes only logging text to %s, preserving attributes and other pending fields', (value) => {
    const before = fixture
      .replace(loggingField, `<ts:loggingEnabled>${!value}</ts:loggingEnabled>`)
      .replace('<ts:sizeCategory>0', '<ts:sizeCategory>2')
      .replaceAll('ts:', 'native:')
      .replace('xmlns:ts=', 'xmlns:native=');
    const after = patchTableSettingsXml(before, 'ZTEST', { loggingEnabled: value });
    expect(after).toBe(before.replace(`>${!value}</native:loggingEnabled>`, `>${value}</native:loggingEnabled>`));
    expect(parseTableSettings(after, 'ZTEST').source).toMatchObject({ loggingEnabled: value, sizeCategory: 2 });
  });
  it.each([
    '',
    `<ts:future>${loggingField}</ts:future>`,
    loggingField + loggingField,
    '<ts:loggingEnabled/>',
    '<ts:loggingEnabled>X</ts:loggingEnabled>',
    '<ts:loggingEnabled>1</ts:loggingEnabled>',
    '<ts:loggingEnabled>0</ts:loggingEnabled>',
    '<ts:loggingEnabled><ts:unexpected/></ts:loggingEnabled>',
    '<ts:loggingEnabled ts:isEditable="false">false</ts:loggingEnabled>',
    '<ts:loggingEnabled ts:isEditable="true">false</ts:loggingEnabled>',
  ])('leaves unfamiliar logging metadata readable but refuses to edit it: %s', (field) => {
    const before = fixture.replace(loggingField, field);
    const read = parseTableSettings(before, 'ZTEST');
    expect(read.source).not.toHaveProperty('loggingEnabled');
    expect(read.source).toMatchObject({ dataClass: 'APPL0', sizeCategory: 0 });
    expect(patchTableSettingsXml(before, 'ZTEST', { sizeCategory: 2 })).toBe(
      before.replace('<ts:sizeCategory>0', '<ts:sizeCategory>2'),
    );
    expect(() => patchTableSettingsXml(before, 'ZTEST', { loggingEnabled: true })).toThrow(/loggingEnabled/);
  });
});

describe('technical settings partial edits', () => {
  it('reads native values and separates the writable source from state and other settings', () => {
    expect(parseTableSettings(fixture, 'ZTEST')).toMatchObject({
      name: 'ZTEST',
      type: 'TABL/DTT',
      version: 'inactive',
      storageType: '',
      source: { dataClass: 'APPL0', sizeCategory: 0, buffering: { allowed: 'N', type: '', areaKeyFields: 0 } },
    });
  });
  it('changes only supplied text, preserving pending settings, future fields and attributes', () => {
    const before = fixture
      .replace('<ts:sizeCategory>0', '<ts:sizeCategory>2')
      .replace(
        '<ts:storageType/>',
        '<future:setting xmlns:future="urn:future" readOnly="true">keep &amp; retain</future:setting><ts:storageType/>',
      );
    const after = patchTableSettingsXml(before, 'ZTEST', { dataClass: 'APPL1' });
    expect(after).toBe(before.replace('<ts:dataClassCategory>APPL0', '<ts:dataClassCategory>APPL1'));
    expect(parseTableSettings(after, 'ZTEST').source.sizeCategory).toBe(2);
  });
  it('scopes buffering edits and preserves attributes of self-closing elements', () => {
    const before = fixture.replace('<ts:type/>', '<ts:type custom="retained"/>');
    const after = patchTableSettingsXml(before, 'ZTEST', { buffering: { allowed: 'X', type: 'P' } });
    expect(after).toContain('<ts:type custom="retained">P</ts:type>');
    expect(after).toContain('adtcore:type="TABL/DTT"');
    expect(parseTableSettings(after, 'ZTEST').source.buffering).toEqual({ allowed: 'X', type: 'P', areaKeyFields: 0 });
  });
  it('does not assume the XML namespace prefix', () => {
    const before = fixture.replaceAll('ts:', 'native.settings:').replace('xmlns:ts=', 'xmlns:native.settings=');
    expect(patchTableSettingsXml(before, 'ZTEST', { buffering: { type: 'G', areaKeyFields: 1 } })).toContain(
      '<native.settings:type>G</native.settings:type>',
    );
  });
  it.each([
    {},
    { unknown: true },
    { storageType: 'R' },
    { sizeCategory: '1' },
    { sizeCategory: -1 },
    { sizeCategory: 10 },
    { dataClass: '<bad>' },
    { dataClass: 'TOOLONG' },
    { buffering: {} },
    { buffering: { type: 'L' } },
    { buffering: { allowed: 'false' } },
    { buffering: { areaKeyFields: 1.5 } },
    { buffering: { areaKeyFields: 1000 } },
    { buffering: { ignored: true } },
    null,
    [],
  ])('rejects invalid or silently ignored edits %j', (value) => {
    expect(() => parseTableSettingsPatch(JSON.stringify(value))).toThrow(/Invalid TABL\/DTT source/);
  });
  it.each([
    fixture.replace('<ts:sizeCategory>0</ts:sizeCategory>', ''),
    fixture.replace(
      '<ts:sizeCategory>0</ts:sizeCategory>',
      '<ts:sizeCategory>0</ts:sizeCategory><ts:sizeCategory>1</ts:sizeCategory>',
    ),
    fixture.replace('adtcore:type="TABL/DTT"', 'adtcore:type="TABL/DT"'),
    fixture.replace('adtcore:name="ZTEST"', 'adtcore:name="OTHER"'),
    fixture.replace('<ts:type/>', '<ts:type/><ts:type>P</ts:type>'),
    fixture.replace('adtcore:version="inactive"', 'adtcore:version="unknown"'),
    fixture.replace('<ts:sizeCategory>0</ts:sizeCategory>', '<ts:sizeCategory/>'),
    fixture.replace('<ts:type/>', '<ts:type><unexpected/></ts:type>'),
    fixture.replace('</ts:tableSettings>', ''),
    fixture.replace('<ts:sizeCategory>0</ts:sizeCategory>', '<!--<ts:sizeCategory>0</ts:sizeCategory>-->'),
  ])('refuses unverified native metadata before rebuilding anything', (xml) => {
    expect(() => patchTableSettingsXml(xml, 'ZTEST', { sizeCategory: 1 })).toThrow();
  });
});

it('refuses a lexical edit that would break a quoted attribute', () => {
  const input = fixture.replace('<ts:sizeCategory>', '<ts:sizeCategory note=">">');
  expect(() => patchTableSettingsXml(input, 'ZTEST', { sizeCategory: 3 })).toThrow('Cannot safely edit');
});
