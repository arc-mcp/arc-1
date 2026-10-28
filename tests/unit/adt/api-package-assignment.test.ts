import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyResourceDefinition,
  mergeResourceDefinitions,
  parseApiPackageAssignment,
} from '../../../src/adt/api-package-assignment.js';

// Anonymized Eclipse ADT 3.60 captures from S/4HANA (SAP_BASIS 8.16): an RFC-based and an event-based
// API package assignment. docs/research/abap-types/types/sod2.md.
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');

const EDMX_V4 =
  '<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices/></edmx:Edmx>';
const EDMX_V2 =
  '<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices/></edmx:Edmx>';
const WSDL =
  '<?xml version="1.0" encoding="utf-8"?><wsdl:definitions targetNamespace="urn:demo" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"/>';
const RFC = '<?xml version="1.0" encoding="utf-8"?><aco:rfcSignature xmlns:aco="http://www.sap.com/aco"/>';

describe('parseApiPackageAssignment', () => {
  it('returns the RFC assignment with only the filled API details', () => {
    expect(parseApiPackageAssignment(fixture('sod2-metadata-rfc.xml'))).toEqual({
      name: 'Z_DEMO_RFC_BUPA_SEARCH',
      description: 'RFC Test',
      package: 'Z_DEMO_APIS',
      apiPackage: 'Z_DEMO',
      apiObject: { type: 'SRFC', name: '/US4G/BUPA_SEARCH_2' },
      apiKind: 'rfc',
      apiDetails: { rfcFunctionModuleName: '/US4G/BUPA_SEARCH_2', rfcFunctionGroupName: '/US4G/EXCP_RFC' },
      leadingBusinessObjectType: 'BusinessPartner',
      released: false,
      tags: [],
    });
  });

  it('derives the event kind and keeps tags as category code and value', () => {
    const info = parseApiPackageAssignment(fixture('sod2-metadata-event.xml'));
    expect(info.apiKind).toBe('event');
    expect(info.apiObject).toEqual({ type: 'RONT', name: 'Z_DEMO_BATCH' });
    expect(info.apiDetails).toEqual({
      eventRapBusinessObjectName: 'Z_DEMO_BATCH',
      eventRapBusinessObjectDescription: 'Batch',
    });
    expect(info.tags).toEqual([
      { category: '2', value: 'Demo/LineOfBusiness' },
      { category: '3', value: 'Demo/Industry' },
      { category: '5', value: 'GDPR/No Personal Data' },
    ]);
  });

  it.each([
    ['apiOdataV2ServiceName', 'odata-v2'],
    ['apiOdataV4ServiceGroupName', 'odata-v4'],
    ['apiSoapServiceName', 'soap-inbound'],
    ['apiSoapOutboundServiceName', 'soap-outbound'],
    ['apiSqlServiceName', 'sql'],
  ])('derives the API kind from %s', (field, kind) => {
    const xml = `<sod2:sod2 xmlns:sod2="http://www.sap.com/oda/sod2" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="Z_A"><sod2:content><sod2:apiWbObjectType>X</sod2:apiWbObjectType></sod2:content><sod2:apiDetails><sod2:${field}>Z_S</sod2:${field}></sod2:apiDetails></sod2:sod2>`;
    expect(parseApiPackageAssignment(xml).apiKind).toBe(kind);
  });

  it('names class-based APIs custom', () => {
    const xml =
      '<sod2:sod2 xmlns:sod2="http://www.sap.com/oda/sod2" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="Z_A"><sod2:content><sod2:apiWbObjectType>CLAS</sod2:apiWbObjectType></sod2:content><sod2:apiDetails/></sod2:sod2>';
    expect(parseApiPackageAssignment(xml).apiKind).toBe('custom');
  });

  it('rejects a document that is not an API package assignment', () => {
    expect(() => parseApiPackageAssignment('<other/>')).toThrow(/not an API package assignment/);
  });
});

describe('classifyResourceDefinition', () => {
  it.each([
    ['{"openapi":"3.0.0","info":{}}', 'openapi', '3.0.0', 'application/json'],
    // SAP labels the Swagger-shaped SOAP description "openapi": "2.0".
    ['{\n  "openapi": "2.0"\n}', 'openapi', '2.0', 'application/json'],
    ['{"swagger":"2.0"}', 'openapi', '2.0', 'application/json'],
    ['{"asyncapi":"2.0.0"}', 'asyncapi', '2.0.0', 'application/json'],
    ['{\n "sqlapi":"1.0.2"}', 'sqlapi', '1.0.2', 'application/json'],
    [EDMX_V4, 'edmx', '4.0', 'application/xml'],
    [EDMX_V2, 'edmx', '1.0', 'application/xml'],
    [WSDL, 'wsdl', '1.1', 'application/xml'],
    [RFC, 'rfc', '', 'application/xml'],
    ['{"other":1}', 'unknown', '', 'application/json'],
    ['<x:y xmlns:x="urn:other"/>', 'unknown', '', 'application/xml'],
    ['{broken', 'unknown', '', 'text/plain'],
    ['plain', 'unknown', '', 'text/plain'],
  ])('classifies %s', (content, kind, version, mediaType) => {
    expect(classifyResourceDefinition(content)).toEqual({ kind, version, mediaType });
  });

  it('does not take an Edmx element of a foreign namespace for EDMX', () => {
    expect(classifyResourceDefinition('<e:Edmx xmlns:e="urn:fake" Version="4.0"/>').kind).toBe('unknown');
  });
});

describe('mergeResourceDefinitions', () => {
  it('keeps one document per tab when the formats differ (OData V4, SOAP)', () => {
    const merged = mergeResourceDefinitions('{"openapi":"3.0.0"}', EDMX_V4);
    expect(merged.map((d) => [d.kind, d.slot])).toEqual([
      ['openapi', 'JSON'],
      ['edmx', 'EDMX'],
    ]);
  });

  it('collapses identical copies (RFC, SQL, custom class)', () => {
    expect(mergeResourceDefinitions(RFC, RFC)).toEqual([
      { kind: 'rfc', version: '', mediaType: 'application/xml', slot: 'JSON', otherSlotDiffers: false, content: RFC },
    ]);
  });

  it('serves the JSON tab and flags a differing variant of the same kind (events)', () => {
    const merged = mergeResourceDefinitions('{"asyncapi":"2.0.0","maxLength":64}', '{"asyncapi":"2.0.0"}');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'asyncapi', slot: 'JSON', otherSlotDiffers: true });
    expect(merged[0]!.content).toContain('maxLength');
  });

  it.each(['', '   ', 'null'])('skips an empty slot %j (SEGW OData V2 has no OpenAPI)', (empty) => {
    expect(mergeResourceDefinitions(empty, EDMX_V2).map((d) => d.kind)).toEqual(['edmx']);
  });

  it('returns nothing when SAP has no document', () => {
    expect(mergeResourceDefinitions('', '')).toEqual([]);
  });
});
