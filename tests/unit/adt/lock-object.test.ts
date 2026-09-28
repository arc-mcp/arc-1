import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildLockObjectXml,
  type LockObjectInfo,
  mergeLockObjectDefinition,
  parseLockObject,
  parseLockObjectDefinition,
} from '../../../src/adt/lock-object.js';

// Real GET of the SAP-standard lock object EMEKKOE (primary EKKO + secondary EKPO), S/4HANA SAP_BASIS 8.16.
const EMEKKOE = readFileSync(new URL('../../fixtures/xml/lockobject-emekkoe.xml', import.meta.url), 'utf8');

const EXISTING: LockObjectInfo = {
  name: 'EZTEST',
  description: 'Test',
  package: '$TMP',
  version: 'active',
  allowRFC: false,
  primaryTable: { tableName: 'ZTAB', lockMode: 'E' },
  secondaryTables: [],
  lockParameters: [
    { parameterName: 'CLIENT', tableName: 'ZTAB', fieldName: 'CLIENT', parameterWanted: true },
    { parameterName: 'DOCID', tableName: 'ZTAB', fieldName: 'DOCID', parameterWanted: true },
  ],
  lockModules: ['ENQUEUE_EZTEST', 'DEQUEUE_EZTEST'],
};

describe('parseLockObject', () => {
  it('parses tables, lock parameters and generated modules from a live response', () => {
    const info = parseLockObject(EMEKKOE);
    expect(info).toMatchObject({
      name: 'EMEKKOE',
      package: 'ME',
      version: 'active',
      allowRFC: false,
      primaryTable: { tableName: 'EKKO', lockMode: 'E' },
      secondaryTables: [{ tableName: 'EKPO', lockMode: 'E' }],
      lockModules: ['ENQUEUE_EMEKKOE', 'DEQUEUE_EMEKKOE'],
    });
    expect(info.lockParameters).toEqual([
      { parameterName: 'MANDT', tableName: 'EKKO', fieldName: 'MANDT', parameterWanted: true },
      { parameterName: 'EBELN', tableName: 'EKKO', fieldName: 'EBELN', parameterWanted: true },
      // The secondary-table copy of EBELN is not passed to ENQUEUE_ (parameterWanted=false).
      { parameterName: 'EBELN', tableName: 'EKPO', fieldName: 'EBELN', parameterWanted: false },
      { parameterName: 'EBELP', tableName: 'EKPO', fieldName: 'EBELP', parameterWanted: true },
    ]);
  });

  it('keeps single-entry and empty lists as arrays', () => {
    const xml =
      '<enqu:lockobject xmlns:enqu="http://www.sap.com/adt/ddic/enqu" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="EZ" adtcore:type="ENQU/DL" adtcore:version="inactive"><adtcore:packageRef adtcore:name="$TMP"/><enqu:content><enqu:allowRFC>true</enqu:allowRFC><enqu:primaryTable><enqu:tableName>ZT</enqu:tableName><enqu:lockMode>S</enqu:lockMode></enqu:primaryTable><enqu:secondaryTables/><enqu:lockParameters><enqu:lockParameter><enqu:parameterWanted>true</enqu:parameterWanted><enqu:parameterName>K</enqu:parameterName><enqu:tableName>ZT</enqu:tableName><enqu:fieldName>K</enqu:fieldName></enqu:lockParameter></enqu:lockParameters><enqu:lockModules/></enqu:content></enqu:lockobject>';
    const info = parseLockObject(xml);
    expect(info.allowRFC).toBe(true);
    expect(info.secondaryTables).toEqual([]);
    expect(info.lockParameters).toHaveLength(1);
    expect(info.lockModules).toEqual([]);
  });

  it('rejects a response that is not a lock object', () => {
    expect(() => parseLockObject('<foo/>')).toThrow(/expected <enqu:lockobject>/);
  });
});

describe('parseLockObjectDefinition', () => {
  it('accepts SAPRead output unchanged (read-only keys are ignored)', () => {
    const def = parseLockObjectDefinition(JSON.stringify(parseLockObject(EMEKKOE)));
    expect(def.primaryTable).toEqual({ tableName: 'EKKO', lockMode: 'E' });
    expect(def.secondaryTables).toEqual([{ tableName: 'EKPO', lockMode: 'E' }]);
    expect(def.lockParameters).toHaveLength(4);
    expect(def).not.toHaveProperty('lockModules');
  });

  it('normalizes case, defaults lockMode to E and parameterWanted to true', () => {
    const def = parseLockObjectDefinition(
      JSON.stringify({
        primaryTable: { tableName: 'ztab' },
        lockParameters: [{ tableName: 'ztab', fieldName: 'docid' }],
      }),
    );
    expect(def.primaryTable).toEqual({ tableName: 'ZTAB', lockMode: 'E' });
    expect(def.lockParameters).toEqual([
      { parameterName: 'DOCID', tableName: 'ZTAB', fieldName: 'DOCID', parameterWanted: true },
    ]);
  });

  it.each([
    ['not JSON', 'nope', /expected a JSON object/],
    ['an array', '[]', /expected a JSON object/],
    ['a typo key', '{"primarytable":{}}', /unknown key\(s\) "primarytable"/],
    ['an unknown lock mode', '{"primaryTable":{"tableName":"ZT","lockMode":"Q"}}', /lockMode "Q" must be one of/],
    ['an invalid table name', '{"primaryTable":{"tableName":"Z-T"}}', /not a valid DDIC name/],
    ['a non-array secondaryTables', '{"secondaryTables":{}}', /secondaryTables must be an array/],
    ['a non-boolean allowRFC', '{"allowRFC":"yes"}', /allowRFC must be true or false/],
  ])('rejects %s', (_label, source, message) => {
    expect(() => parseLockObjectDefinition(source)).toThrow(message);
  });
});

describe('mergeLockObjectDefinition', () => {
  it('keeps stored values for omitted keys', () => {
    const merged = mergeLockObjectDefinition(EXISTING, {
      allowRFC: true,
      primaryTable: { tableName: 'ZTAB', lockMode: 'S' },
    });
    expect(merged).toEqual({
      allowRFC: true,
      primaryTable: { tableName: 'ZTAB', lockMode: 'S' },
      secondaryTables: [],
      lockParameters: EXISTING.lockParameters,
    });
  });

  // Live 8.16: an UPDATE with an empty parameter list makes SAP re-derive the parameters with
  // parameterWanted=false, i.e. ENQUEUE_ loses its key parameters. Refuse instead of guessing.
  it('requires lockParameters when the table set changes', () => {
    expect(() => mergeLockObjectDefinition(EXISTING, { primaryTable: { tableName: 'ZOTHER', lockMode: 'E' } })).toThrow(
      /requires "lockParameters"/,
    );
    expect(() =>
      mergeLockObjectDefinition(EXISTING, { secondaryTables: [{ tableName: 'ZITEM', lockMode: 'E' }] }),
    ).toThrow(/requires "lockParameters"/);
    const params = [{ parameterName: 'K', tableName: 'ZOTHER', fieldName: 'K', parameterWanted: true }];
    expect(
      mergeLockObjectDefinition(EXISTING, {
        primaryTable: { tableName: 'ZOTHER', lockMode: 'E' },
        lockParameters: params,
      }).lockParameters,
    ).toEqual(params);
  });
});

describe('buildLockObjectXml', () => {
  const base = { name: 'EZTEST', description: 'A & "B"', package: '$TMP', masterLanguage: 'EN', responsibleAttr: '' };

  it('emits the content in SAP order and escapes attributes', () => {
    const xml = buildLockObjectXml({
      ...base,
      definition: {
        allowRFC: true,
        primaryTable: { tableName: 'EKKO', lockMode: 'E' },
        secondaryTables: [{ tableName: 'EKPO', lockMode: 'S' }],
        lockParameters: [{ parameterName: 'EBELN', tableName: 'EKKO', fieldName: 'EBELN', parameterWanted: false }],
      },
    });
    expect(xml).toContain('adtcore:type="ENQU/DL"');
    expect(xml).toContain('adtcore:description="A &amp; &quot;B&quot;"');
    expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(xml).toMatch(
      /<enqu:allowRFC>true<\/enqu:allowRFC><enqu:primaryTable>.*<enqu:secondaryTables>.*<enqu:lockParameters>/,
    );
    expect(xml).toContain('<enqu:secondaryTable><enqu:tableName>EKPO</enqu:tableName><enqu:lockMode>S</enqu:lockMode>');
    expect(xml).toContain(
      '<enqu:parameterWanted>false</enqu:parameterWanted><enqu:parameterName>EBELN</enqu:parameterName>',
    );
    // Generated modules are read-only and never sent.
    expect(xml).not.toContain('lockModules');
  });

  it('round-trips through parseLockObject', () => {
    const info = parseLockObject(EMEKKOE);
    const xml = buildLockObjectXml({
      ...base,
      name: info.name,
      definition: parseLockObjectDefinition(JSON.stringify(info)),
    });
    const again = parseLockObject(xml);
    expect(again.primaryTable).toEqual(info.primaryTable);
    expect(again.secondaryTables).toEqual(info.secondaryTables);
    expect(again.lockParameters).toEqual(info.lockParameters);
  });

  it('requires a primary table (SAP refuses the create otherwise)', () => {
    expect(() => buildLockObjectXml({ ...base, definition: {} })).toThrow(/primaryTable is required/);
  });
});
