import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAgainstObjectSchema } from '../../../src/adt/object-schema.js';

// SAP's schema for SMBC as served by GET <object>/schema on SAP_BASIS 816 (AFF smbc-v1).
const schema = JSON.parse(readFileSync(new URL('../../fixtures/sdo/smbc-schema-816.json', import.meta.url), 'utf8'));

const valid = {
  formatVersion: '1',
  header: { description: 'Demo codes', originalLanguage: 'de', abapLanguageVersion: 'cloudDevelopment' },
  serviceConfiguration: {
    serviceBinding: 'ZUI_DEMO_O4',
    serviceName: 'ZUI_DEMO_O4',
    serviceVersion: '0001',
    rootEntitySet: 'Singleton',
    name: 'Demo codes',
    skipRootEntity: true,
  },
  appConfiguration: {
    listReport: { variantManagement: 'page' },
    objectPages: [{ entitySet: 'Singleton', variantManagement: 'control', showTransportSelectionStrip: true }],
    tableSettings: [{ entitySet: 'DemoCodes', tableType: 'gridTable', rowCountMode: 'fixed', rowCount: 10 }],
  },
};

describe('checkAgainstObjectSchema with the SMBC schema', () => {
  it('accepts a source SAP accepts', () => {
    expect(checkAgainstObjectSchema(schema, valid)).toEqual([]);
  });

  it('refuses a format version that 758 silently rewrites to version 1', () => {
    expect(checkAgainstObjectSchema(schema, { ...valid, formatVersion: '2' })).toEqual([
      '/formatVersion: expected "1"',
    ]);
  });

  it('reports the value SAP dropped silently on 816', () => {
    const source = structuredClone(valid);
    source.appConfiguration.listReport.variantManagement = 'control';
    expect(checkAgainstObjectSchema(schema, source)).toEqual([
      '/appConfiguration/listReport/variantManagement: "control" is not allowed. Allowed values: page, none',
    ]);
  });

  it('reports wrong types, unknown properties and enum values inside arrays', () => {
    const source = structuredClone(valid) as Record<string, any>;
    source.appConfiguration.tableSettings[0].rowCount = '10';
    source.appConfiguration.tableSettings[0].rowCountMod = 'auto';
    source.appConfiguration.objectPages[0].variantManagement = 'page';
    const problems = checkAgainstObjectSchema(schema, source);
    expect(problems).toContain('/appConfiguration/tableSettings/0/rowCount: expected integer');
    expect(problems.some((p) => p.includes('unknown property "rowCountMod"'))).toBe(true);
    expect(problems).toContain(
      '/appConfiguration/objectPages/0/variantManagement: "page" is not allowed. Allowed values: control, none',
    );
  });

  it('caps diagnostics across unknown fields and nested objects', () => {
    const fields = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, true]));
    const problems = checkAgainstObjectSchema(schema, { header: fields, ...fields });
    expect(problems).toHaveLength(20);
    expect(problems.at(-1)).toBe('/header: unknown property "field19"');
  });

  it('stops at the twentieth problem even when an array item breaks two rules', () => {
    const items = { type: 'string', enum: ['a'], maxLength: 1 };
    const values = ['b', ...Array<string>(11).fill('bb')];
    const problems = checkAgainstObjectSchema({ type: 'array', items }, values);
    expect(problems).toHaveLength(20);
    expect(problems.at(-1)).toContain('/10: "bb" is not allowed');
  });

  it('checks numbers and leaves unrecognized types and open object properties to SAP', () => {
    expect(checkAgainstObjectSchema({ type: 'number' }, 1.5)).toEqual([]);
    expect(checkAgainstObjectSchema({ type: 'number' }, '1.5')).toEqual(['/: expected number']);
    expect(checkAgainstObjectSchema({ type: 'future' }, { field: 1 })).toEqual([]);
  });

  it('counts UTF-16 units in maxLength, as SAP does', () => {
    const field = { type: 'string', maxLength: 3 };
    expect(checkAgainstObjectSchema(field, 'AB⌚')).toEqual([]);
    expect(checkAgainstObjectSchema(field, 'A🌍')).toEqual([]);
    expect(checkAgainstObjectSchema(field, 'AB🌍')).toEqual(['/: longer than 3 UTF-16 code units']);
  });

  it('ignores keywords it does not interpret instead of failing', () => {
    expect(checkAgainstObjectSchema({ type: 'string', pattern: '^(a+)+$', format: 'x' }, 'aaaa!')).toEqual([]);
    expect(checkAgainstObjectSchema(undefined, { any: 1 })).toEqual([]);
  });
});
