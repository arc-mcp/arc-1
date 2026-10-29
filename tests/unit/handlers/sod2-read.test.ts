import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { SOD2_MAX_DOCUMENT_CHARS } = await import('../../../src/handlers/api-package-assignment-read.js');

// Anonymized Eclipse ADT 3.60 captures (SAP_BASIS 8.16), see docs/research/abap-types/types/sod2.md.
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');
const NAME = 'Z_DEMO_RFC_BUPA_SEARCH';
const BASE = '/sap/bc/adt/aps/com/sod2';

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const swaggerFile = (json: string, edmx: string) =>
  `<?xml version="1.0" encoding="utf-8"?><sod2:swaggerFile xmlns:sod2="http://www.sap.com/oda/sod2">${
    json ? `<sod2:jsonFile>${escapeXml(json)}</sod2:jsonFile>` : '<sod2:jsonFile/>'
  }<sod2:edmxFile>${escapeXml(edmx)}</sod2:edmxFile></sod2:swaggerFile>`;

const entityTypes = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `<EntityType Name="E${i}"><Key><PropertyRef Name="Id"/></Key></EntityType>`,
  ).join('');
const edmxV2 = (count: number) =>
  `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices><Schema Namespace="Z">${entityTypes(count)}</Schema></edmx:DataServices></edmx:Edmx>`;

const readOnlyClient = () => createClient().withSafety(defaultSafetyConfig());
const read = (args: Record<string, unknown>) =>
  handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SOD2', name: NAME, ...args });
const text = (result: Awaited<ReturnType<typeof read>>) => result.content.map((c) => c.text).join('');

function backend(swagger: string = fixture('sod2-swaggerfile-rfc.xml'), ord = fixture('sod2-ordfile-rfc.xml')) {
  const requests: Array<{ url: URL; accept: string }> = [];
  mockFetch.mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    requests.push({ url: u, accept: init.headers.Accept });
    if (u.pathname === `${BASE}/$swaggerfile`) return mockResponse(200, swagger);
    if (u.pathname === `${BASE}/$ordfile`) return mockResponse(200, ord);
    if (u.pathname === `${BASE}/z_demo_rfc_bupa_search`) return mockResponse(200, fixture('sod2-metadata-rfc.xml'));
    return mockResponse(404, 'not found');
  });
  return requests;
}

beforeEach(() => vi.resetAllMocks());

describe('SAPRead type=SOD2', () => {
  it('reads the assignment metadata from the lowercase object path', async () => {
    const requests = backend();
    const result = await read({});
    expect(result.isError, text(result)).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ name: NAME, apiKind: 'rfc', apiPackage: 'Z_DEMO' });
    expect(requests.map((r) => [r.url.pathname, r.accept])).toEqual([
      [`${BASE}/z_demo_rfc_bupa_search`, 'application/vnd.sap.adt.blues.v1+xml'],
    ]);
  });

  it('returns the ORD document decoded and line-broken', async () => {
    const requests = backend();
    const result = await read({ include: 'ord' });
    const ord = text(result);
    expect(result.isError, ord).toBeUndefined();
    expect(JSON.parse(ord).apiResources[0].apiProtocol).toBe('sap-rfc');
    // The wrapper's &amp; is decoded to the document's own '&'.
    expect(ord).toContain('type=XML&sap-client=100');
    expect(ord.split('\n').length).toBeGreaterThan(10);
    expect(requests[0]!.url.searchParams.get('packageAssignmentId')).toBe(NAME);
    expect(requests[0]!.accept).toBe('application/vnd.sap.adt.oda.ordfile+xml');
  });

  it('reports an empty ORD document as a normal answer', async () => {
    backend(
      undefined,
      '<?xml version="1.0" encoding="utf-8"?><sod2:ordFile xmlns:sod2="http://www.sap.com/oda/sod2"><sod2:ordDocumentFile/></sod2:ordFile>',
    );
    const result = await read({ include: 'ord' });
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe(`SAP returned no ORD document for API package assignment ${NAME}.`);
  });

  it('lists the resource definitions once per kind', async () => {
    const requests = backend();
    const result = await read({ include: 'specs' });
    expect(result.isError, text(result)).toBeUndefined();
    const specs = JSON.parse(text(result));
    expect(specs.resourceDefinitions).toEqual([
      expect.objectContaining({ kind: 'rfc', mediaType: 'application/xml', eclipseTab: 'JSON', lineBreaksAdded: true }),
    ]);
    expect(requests[0]!.accept).toBe('application/vnd.sap.adt.oda.swaggerfile+xml');
  });

  it('returns a spec whose added whitespace is the only difference to the SAP document', async () => {
    backend();
    const result = await read({ include: 'rfc' });
    const doc = text(result);
    expect(result.isError, doc).toBeUndefined();
    const slot = /<sod2:jsonFile>(.*?)<\/sod2:jsonFile>/s.exec(fixture('sod2-swaggerfile-rfc.xml'))![1]!;
    const original = slot
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    expect(doc.replace(/>\n *</g, '><')).toBe(original);
    expect(doc).toContain('<FUNCTIONNAME>/US4G/BUPA_SEARCH_2</FUNCTIONNAME>');
  });

  it('separates the tabs of an OData V4 assignment and refuses a missing kind', async () => {
    backend(swaggerFile('{"openapi":"3.0.0"}', edmxV2(1).replace('Version="1.0"', 'Version="4.0"')));
    expect(
      JSON.parse(text(await read({ include: 'specs' }))).resourceDefinitions.map((d: { kind: string }) => d.kind),
    ).toEqual(['openapi', 'edmx']);
    const missing = await read({ include: 'wsdl' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('has no wsdl resource definition. Available: openapi, edmx.');
  });

  it('guards a large single-line EDMX and serves it through grep and line ranges', async () => {
    backend(swaggerFile('', edmxV2(2000)));
    const full = await read({ include: 'edmx' });
    expect(full.isError).toBeUndefined();
    expect(text(full)).toMatch(new RegExp(`above the ${SOD2_MAX_DOCUMENT_CHARS}-character limit`));
    expect(text(full)).toContain('grep="EntityType Name="');

    const grep = await read({ include: 'edmx', grep: 'EntityType Name="E1999"' });
    expect(grep.isError, text(grep)).toBeUndefined();
    expect(text(grep)).toContain('<EntityType Name="E1999">');
    expect(text(grep).length).toBeLessThan(2000);

    const range = await read({ include: 'edmx', lineStart: 1, lineEnd: 3 });
    expect(range.isError, text(range)).toBeUndefined();
    expect(text(range)).toMatch(/^Lines 1-3 of \d+ total:/);

    const openapi = await read({ include: 'openapi' });
    expect(text(openapi)).toContain('has no openapi resource definition. Available: edmx.');
  });

  it('reports an assignment without resource definitions', async () => {
    backend('');
    const result = await read({ include: 'specs' });
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe(`SAP returned no resource definition for API package assignment ${NAME}.`);
  });

  it('maps a missing assignment to a not-found message', async () => {
    backend();
    const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SOD2', name: 'Z_NONE' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('API package assignment (SOD2) Z_NONE not found.');
  });

  it.each([
    [{ include: 'yaml' }, 'Invalid include value "yaml" for type SOD2'],
    [{ grep: 'x' }, 'grep and lineStart/lineEnd need include="ord" or a resource definition kind'],
    [{ include: 'specs', lineStart: 1, lineEnd: 2 }, 'grep and lineStart/lineEnd need include="ord"'],
    [{ version: 'inactive' }, 'version is not supported for SAPRead type=SOD2.'],
    [{ format: 'structured' }, 'format="structured" is not supported for SAPRead type=SOD2.'],
    [{ name: '' }, '"name" is required for SAPRead type=SOD2.'],
  ])('rejects %j before calling SAP', async (args, message) => {
    backend();
    const result = await read(args);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads when discovery lists the SOD2 collection without media types (display-only user)', async () => {
    backend();
    const client = readOnlyClient();
    client.http.setDiscoveryMap(
      new Map([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
        ['/sap/bc/adt/aps/com/sod2', []],
      ]),
    );
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'SOD2', name: NAME });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('"apiKind":"rfc"');
  });

  it('refuses when discovery is loaded and lacks the SOD2 collection', async () => {
    backend();
    const client = readOnlyClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'SOD2', name: NAME });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('API package assignments (SOD2) are not available on this system');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
