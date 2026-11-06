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

  it('ignores keywords it does not interpret instead of failing', () => {
    expect(checkAgainstObjectSchema({ type: 'string', pattern: '^(a+)+$', format: 'x' }, 'aaaa!')).toEqual([]);
    expect(checkAgainstObjectSchema(undefined, { any: 1 })).toEqual([]);
  });
});
