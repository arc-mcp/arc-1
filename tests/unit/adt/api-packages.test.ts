import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseApiPackageAssignment } from '../../../src/adt/api-package-assignment.js';
import {
  apiCatalogAvailable,
  applyApiCatalogDefinition,
  buildApiCatalogCreateXml,
  needsFollowUpSave,
  parseApiCatalogSource,
  parseApiPackage,
  parseApiPackageAssignments,
} from '../../../src/adt/api-packages.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { parseDiscoveryDocument } from '../../../src/adt/xml-parser.js';

// Anonymized Eclipse ADT 3.60 captures (SAP_BASIS 8.16) after editing an API package and an
// OData V4 API package assignment. docs/research/abap-types/types/sod1.md and sod2.md.
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');
const SOD1 = fixture('sod1-metadata.xml');
const SOD2 = fixture('sod2-metadata-odatav4.xml');

describe('parseApiPackage', () => {
  it('returns the API package fields without tag and URL ids', () => {
    expect(parseApiPackage(SOD1)).toEqual({
      name: 'Z_DEMO_API_PACKAGE',
      description: 'ARC-1 Demo',
      package: 'Z_DEMO_APIS',
      abbreviation: 'ZX',
      alias: 'Sab',
      namespace: 'sap.s4',
      type: '1',
      isScopeDependent: true,
      tags: [
        { category: '2', value: 'Demo' },
        { category: '3', value: 'Demo/Finance' },
      ],
      urls: [
        {
          technicalName: 'test',
          displayName: 'TestName',
          value: 'https://example.com/docs',
          version: '1.0.0',
          text: 'Long text',
        },
      ],
    });
  });

  it('lists the assignments of an API package', () => {
    const xml =
      '<sod1:packageAssignments xmlns:sod1="http://www.sap.com/oda/sod1"><sod1:packageAssignment><sod1:name>Z_A_0001</sod1:name><sod1:description>test</sod1:description><sod1:apiWbObjectType>G4BA</sod1:apiWbObjectType><sod1:apiWbObjectName>Z_A</sod1:apiWbObjectName><sod1:apiSubWbObjectName>Z_A                                0001</sod1:apiSubWbObjectName><sod1:isVirtual>false</sod1:isVirtual></sod1:packageAssignment></sod1:packageAssignments>';
    expect(parseApiPackageAssignments(xml)).toEqual([
      {
        name: 'Z_A_0001',
        description: 'test',
        apiObject: { type: 'G4BA', name: 'Z_A', subName: 'Z_A                                0001' },
        isVirtual: false,
      },
    ]);
    expect(parseApiPackageAssignments('<sod1:packageAssignments xmlns:sod1="http://www.sap.com/oda/sod1"/>')).toEqual(
      [],
    );
  });
});

describe('parseApiCatalogSource', () => {
  it('accepts a SAPRead answer and skips its read-only keys', () => {
    const read = { ...parseApiPackage(SOD1), assignments: [] };
    const { definition, ignored } = parseApiCatalogSource('SOD1', JSON.stringify(read), 'update');
    expect(ignored).toEqual(['name', 'package', 'assignments']);
    expect(definition).toMatchObject({ abbreviation: 'ZX', isScopeDependent: true });
  });

  it('treats the API reference of an assignment as fixed on update', () => {
    const read = parseApiPackageAssignment(SOD2);
    const { definition, ignored } = parseApiCatalogSource('SOD2', JSON.stringify(read), 'update');
    expect(ignored).toEqual(expect.arrayContaining(['apiPackage', 'apiObject', 'apiKind', 'apiDetails']));
    expect(definition).not.toHaveProperty('apiObject');
    expect(definition.leadingBusinessObjectType).toBe('BusinessUser');
  });

  it.each([
    ['{"color":"red"}', 'Unknown SOD1 field "color"'],
    ['{"isScopeDependent":"yes"}', '"isScopeDependent" must be true or false'],
    ['{"tags":{"category":"2"}}', '"tags" must be an array'],
    ['{"tags":[{"category":"2","id":"x"}]}', 'Unknown field(s) in "tags": id'],
    ['{"alias":1}', '"alias" must be a string'],
    ['[1]', 'must be a JSON object'],
    ['not json', 'must be a JSON object'],
  ])('refuses %s', (source, message) => {
    expect(() => parseApiCatalogSource('SOD1', source, 'update')).toThrow(message);
  });
});

describe('buildApiCatalogCreateXml', () => {
  it('posts the minimal API package document', () => {
    const xml = buildApiCatalogCreateXml('SOD1', 'Z_PKG', 'Z_DEV', 'Demo & <test>', { abbreviation: 'ZX' });
    expect(xml).toContain('<sod1:sod1 xmlns:sod1="http://www.sap.com/oda/sod1"');
    expect(xml).toContain('adtcore:type="SOD1" adtcore:name="Z_PKG" adtcore:description="Demo &amp; &lt;test&gt;"');
    expect(xml).toContain('<adtcore:packageRef adtcore:name="Z_DEV"/>');
    expect(xml).toContain('<sod1:content><sod1:abbreviation>ZX</sod1:abbreviation></sod1:content>');
  });

  it('posts the API reference of an assignment verbatim, including the padded sub-object name', () => {
    const xml = buildApiCatalogCreateXml('SOD2', 'Z_A_0001', 'Z_DEV', 'test', {
      apiPackage: 'Z_PKG',
      apiObject: { type: 'G4BA', name: 'Z_A', subType: 'G4S', subName: 'Z_A                                0001' },
    });
    expect(xml).toContain(
      '<sod2:content><sod2:packageID>Z_PKG</sod2:packageID><sod2:apiWbObjectType>G4BA</sod2:apiWbObjectType><sod2:apiWbObjectName>Z_A</sod2:apiWbObjectName><sod2:apiSubWbObjectType>G4S</sod2:apiSubWbObjectType><sod2:apiSubWbObjectName>Z_A                                0001</sod2:apiSubWbObjectName></sod2:content>',
    );
  });

  it.each([
    ['SOD1', {}, 'requires "abbreviation"'],
    ['SOD2', { apiPackage: 'Z_PKG' }, 'requires "apiPackage" and "apiObject"'],
  ] as const)('requires the create fields of %s', (type, definition, message) => {
    expect(() => buildApiCatalogCreateXml(type, 'Z_X', 'Z_DEV', 'x', definition)).toThrow(message);
  });
});

describe('applyApiCatalogDefinition', () => {
  it('patches only the addressed elements and keeps the rest byte for byte', () => {
    const out = applyApiCatalogDefinition('SOD1', SOD1, { alias: 'New & alias', isScopeDependent: false });
    expect(out).toContain('<sod1:alias>New &amp; alias</sod1:alias>');
    expect(out).toContain('<sod1:isScopeDependent>false</sod1:isScopeDependent>');
    const untouched = (xml: string) =>
      xml
        .replace(/<sod1:alias>[^<]*<\/sod1:alias>/, '')
        .replace(/<sod1:isScopeDependent>[^<]*<\/sod1:isScopeDependent>/, '');
    expect(untouched(out)).toBe(untouched(SOD1));
  });

  it('replaces a whole list and the root description', () => {
    const out = applyApiCatalogDefinition('SOD1', SOD1, {
      description: 'Changed "quoted"',
      tags: [{ category: '2', value: 'Demo/New' }],
      urls: [],
    });
    expect(out).toContain('adtcore:description="Changed &quot;quoted&quot;"');
    expect(out).toContain(
      '<sod1:tags><sod1:tag><sod1:value>Demo/New</sod1:value><sod1:category>2</sod1:category></sod1:tag></sod1:tags>',
    );
    expect(out).toContain('<sod1:urls></sod1:urls>');
    expect(out).not.toContain('Demo/Finance');
  });

  it('writes the documentation link into the element Eclipse uses and fills empty elements', () => {
    const out = applyApiCatalogDefinition('SOD2', SOD2, {
      documentationLink: 'https://example.com/new',
      leadingBusinessObjectType: 'Currency',
    });
    expect(out).toContain(
      '<sod2:documentationLinkReplacement>https://example.com/new</sod2:documentationLinkReplacement>',
    );
    // The derived element is SAP's; it is not touched.
    expect(out).toContain('<sod2:documentationLink>https://example.com/docs</sod2:documentationLink>');
    expect(out).toContain('<sod2:leadingBusinessObjectType>Currency</sod2:leadingBusinessObjectType>');
  });

  it('refuses a document that lacks the addressed element or the root', () => {
    const noAlias = SOD1.replace(/<sod1:alias>[^<]*<\/sod1:alias>/, '');
    expect(() => applyApiCatalogDefinition('SOD1', noAlias, { alias: 'x' })).toThrow('has no <sod1:alias> element');
    expect(() => applyApiCatalogDefinition('SOD2', SOD1, { tags: [] })).toThrow('no SOD2 metadata document');
  });
});

describe('needsFollowUpSave', () => {
  it('is false when the create POST carries everything', () => {
    expect(needsFollowUpSave('SOD1', { abbreviation: 'ZX', description: 'd' })).toBe(false);
    expect(needsFollowUpSave('SOD2', { apiPackage: 'P', apiObject: { type: 'G4BA', name: 'N' } })).toBe(false);
  });

  it('is true for fields the create POST does not carry', () => {
    expect(needsFollowUpSave('SOD1', { abbreviation: 'ZX', tags: [] })).toBe(true);
    expect(needsFollowUpSave('SOD2', { apiPackage: 'P', leadingBusinessObjectType: 'X' })).toBe(true);
  });
});

describe('apiCatalogAvailable', () => {
  // Shape of the API-Management workspace that SAP_BASIS 8.16 returns to a display-only user:
  // the collections are listed, but with an empty <app:accept/>.
  const discovery = (accept: string) => `<?xml version="1.0" encoding="utf-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <app:workspace>
    <atom:title>API-Management</atom:title>
    <app:collection href="/sap/bc/adt/aps/com/sod1">${accept}</app:collection>
    <app:collection href="/sap/bc/adt/aps/com/sod2">${accept}</app:collection>
  </app:workspace>
  <app:workspace>
    <atom:title>Sources</atom:title>
    <app:collection href="/sap/bc/adt/oo/classes"><app:accept>application/vnd.sap.adt.oo.classes.v4+xml</app:accept></app:collection>
  </app:workspace>
</app:service>`;
  const http = (xml: string) => {
    const client = new AdtHttpClient({ baseUrl: 'https://sap.example.test', username: 'test', password: 'test' });
    client.setDiscoveryMap(parseDiscoveryDocument(xml));
    return client;
  };

  it('accepts collections listed with an empty accept element', () => {
    const client = http(discovery('<app:accept/>'));
    expect(apiCatalogAvailable(client, 'SOD1')).toBe(true);
    expect(apiCatalogAvailable(client, 'SOD2')).toBe(true);
  });

  it('accepts collections listed with media types', () => {
    expect(
      apiCatalogAvailable(http(discovery('<app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept>')), 'SOD2'),
    ).toBe(true);
  });

  it('refuses when discovery is loaded and does not list the collection', () => {
    const client = http(discovery('').replace(/aps\/com\/sod[12]/g, 'other/collection'));
    expect(apiCatalogAvailable(client, 'SOD2')).toBe(false);
  });
});
