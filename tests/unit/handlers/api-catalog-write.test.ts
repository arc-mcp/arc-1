/**
 * SAPRead type=SOD1 and SAPWrite create/update/delete for API packages (SOD1) and API package
 * assignments (SOD2), plus KTD creation on both. Wire format from anonymized Eclipse ADT 3.60 logs
 * (SAP_BASIS 8.16), see docs/research/abap-types/types/sod1.md.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');
const SOD1_URL = '/sap/bc/adt/aps/com/sod1/z_demo_api_package';
const SOD2_URL = '/sap/bc/adt/aps/com/sod2/z_ui_demo_doc_o4_0001';
const BLUES = 'application/vnd.sap.adt.blues.v1+xml';

const deletionResult = (uri: string, deleted: boolean, text = '') =>
  `<?xml version="1.0" encoding="utf-8"?><del:deletionResult xmlns:del="http://www.sap.com/adt/deletion"><del:object del:isDeleted="${deleted}" adtcore:uri="${uri}" xmlns:adtcore="http://www.sap.com/adt/core"><del:message del:type="${deleted ? 'S' : 'E'}"><del:text>${text}</del:text></del:message></del:object></del:deletionResult>`;
const deletionCheck = (uri: string, deletable = true) =>
  `<?xml version="1.0" encoding="utf-8"?><del:checkResponse xmlns:del="http://www.sap.com/adt/deletion"><del:object del:isDeletable="${deletable}" adtcore:uri="${uri}" xmlns:adtcore="http://www.sap.com/adt/core"><del:lockingTransport><del:lockingTransport><del:trkorr>DEVK900001</del:trkorr></del:lockingTransport></del:lockingTransport><del:message del:type="${deletable ? 'S' : 'E'}"><del:text>${deletable ? '' : 'Object is in use'}</del:text></del:message></del:object></del:checkResponse>`;

interface Call {
  method: string;
  url: string;
  body: string;
  contentType?: string;
}

function mockSap(
  routes: {
    check?: string;
    deleted?: string;
    assignments?: string;
    putError?: string;
    putStatus?: number;
    metadataStatus?: number;
    search?: string;
    checkRun?: string;
  } = {},
): Call[] {
  const calls: Call[] = [];
  mockFetch.mockImplementation(
    async (url: string | URL, opts: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const method = opts?.method ?? 'GET';
      const u = new URL(String(url));
      // The client adds sap-client/sap-language to every request; they are not part of the contract under test.
      u.searchParams.delete('sap-client');
      u.searchParams.delete('sap-language');
      const headers = opts?.headers ?? {};
      if (method !== 'HEAD')
        calls.push({
          method,
          url: u.pathname + u.search,
          body: typeof opts?.body === 'string' ? opts.body : '',
          contentType: headers['Content-Type'],
        });
      const csrf = { 'x-csrf-token': 'T' };
      if (method === 'POST' && u.search.includes('_action=LOCK'))
        return mockResponse(
          200,
          '<asx:values><DATA><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values>',
          csrf,
        );
      if (u.pathname === '/sap/bc/adt/deletion/check')
        return mockResponse(200, routes.check ?? deletionCheck(SOD2_URL), csrf);
      if (u.pathname === '/sap/bc/adt/deletion/delete')
        return mockResponse(200, routes.deleted ?? deletionResult(SOD2_URL, true), csrf);
      if (method === 'PUT' && routes.putError) return mockResponse(routes.putStatus ?? 400, routes.putError, csrf);
      if (u.pathname === '/sap/bc/adt/checkruns' && routes.checkRun) return mockResponse(200, routes.checkRun, csrf);
      if (method === 'GET' && u.pathname === SOD1_URL) return mockResponse(200, fixture('sod1-metadata.xml'), csrf);
      if (u.pathname.endsWith('/informationsystem/search')) return mockResponse(200, routes.search ?? '', csrf);
      if (method === 'GET' && u.pathname === SOD2_URL && routes.metadataStatus)
        return mockResponse(routes.metadataStatus, 'The constructor of the class CL_TEST is PRIVATE', csrf);
      if (method === 'GET' && u.pathname === SOD2_URL)
        return mockResponse(200, fixture('sod2-metadata-odatav4.xml'), csrf);
      if (method === 'GET' && u.pathname === '/sap/bc/adt/aps/com/sod1/$packageassignments')
        return mockResponse(
          200,
          routes.assignments ?? '<sod1:packageAssignments xmlns:sod1="http://www.sap.com/oda/sod1"/>',
          csrf,
        );
      if (method === 'POST' && !u.search.includes('_action')) return mockResponse(201, '', csrf);
      return mockResponse(200, '', csrf);
    },
  );
  return calls;
}

const write = (args: Record<string, unknown>) => handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
const text = (r: Awaited<ReturnType<typeof write>>) => r.content.map((c) => c.text).join('');
const mutations = (calls: Call[]) =>
  calls.filter(
    (c) => c.method !== 'GET' && !c.url.includes('_action=') && !c.url.startsWith('/sap/bc/adt/deletion/check'),
  );

beforeEach(() => vi.resetAllMocks());

describe('SAPRead type=SOD1', () => {
  it('returns the API package with its assignments', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'SOD1',
      name: 'Z_DEMO_API_PACKAGE',
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(JSON.parse(text(result))).toMatchObject({ name: 'Z_DEMO_API_PACKAGE', abbreviation: 'ZX', assignments: [] });
    expect(calls.map((c) => c.url)).toEqual([
      SOD1_URL,
      '/sap/bc/adt/aps/com/sod1/$packageassignments?name=Z_DEMO_API_PACKAGE',
    ]);
  });
});

describe('SAPWrite type=SOD1/SOD2', () => {
  it('creates an API package with the minimal document Eclipse posts', async () => {
    const calls = mockSap();
    const result = await write({
      action: 'create',
      type: 'SOD1',
      name: 'Z_DEMO_API_PACKAGE',
      package: '$TMP',
      description: 'ARC-1 Demo',
      source: '{"abbreviation":"ZX"}',
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      'Created SOD1 Z_DEMO_API_PACKAGE in package $TMP. It is active; no activation is needed.',
    );
    const posts = mutations(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ method: 'POST', url: '/sap/bc/adt/aps/com/sod1', contentType: BLUES });
    expect(posts[0]!.body).toContain('<sod1:abbreviation>ZX</sod1:abbreviation>');
    expect(posts[0]!.body).toContain('adtcore:description="ARC-1 Demo"');
  });

  it('saves the fields the create POST does not carry in a locked follow-up PUT', async () => {
    const calls = mockSap();
    const result = await write({
      action: 'create',
      type: 'SOD1',
      name: 'Z_DEMO_API_PACKAGE',
      package: '$TMP',
      transport: 'DEVK900001',
      source: '{"abbreviation":"ZX","namespace":"demo.ns","tags":[{"category":"2","value":"Demo/New"}]}',
    });
    expect(result.isError, text(result)).toBeUndefined();
    const writes = mutations(calls);
    expect(writes.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /sap/bc/adt/aps/com/sod1?corrNr=DEVK900001',
      `PUT ${SOD1_URL}?lockHandle=LH&corrNr=DEVK900001`,
    ]);
    expect(writes[1]!.body).toContain('<sod1:namespace>demo.ns</sod1:namespace>');
    expect(writes[1]!.body).toContain('<sod1:value>Demo/New</sod1:value>');
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
  });

  it.each([400, 404, 500])('preserves confirmed creation after a %i follow-up save', async (putStatus) => {
    const calls = mockSap({ putStatus, putError: 'Follow-up save failed' });
    const result = await write({
      action: 'create',
      type: 'SOD1',
      name: 'Z_DEMO_API_PACKAGE',
      package: '$TMP',
      source: '{"abbreviation":"ZX","alias":"demo"}',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('was created in package $TMP');
    expect(text(result)).toContain('Do not repeat create');
    expect(text(result)).toContain(`status ${putStatus}`);
    expect(text(result)).not.toMatch(/often transient|SAPSearch.*verify|then retry|check the object name/i);
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/sap/bc/adt/aps/com/sod1')).toHaveLength(1);
  });

  it.each([400, 404, 500])(
    'marks a %i follow-up as confirmed and invalidates the caller’s cache',
    async (putStatus) => {
      mockSap({ putStatus, putError: 'Save failed' });
      const { handleSAPWrite } = await import('../../../src/handlers/write.js');
      const cache = new CachingLayer(new MemoryCache());
      const object = vi.spyOn(cache, 'invalidate');
      const inactive = vi.spyOn(cache.inactiveLists, 'invalidate');
      await expect(
        handleSAPWrite(
          createClient(),
          {
            type: 'SOD1',
            name: 'Z_DEMO_API_PACKAGE',
            action: 'create',
            package: '$TMP',
            source: '{"abbreviation":"CX","alias":"Demo"}',
          },
          DEFAULT_CONFIG,
          cache,
          { isPerUserClient: true, userKey: 'caller' },
        ),
      ).rejects.toMatchObject({ statusCode: putStatus, creationOutcome: 'confirmed' });
      expect(object).toHaveBeenCalledWith('SOD1', 'Z_DEMO_API_PACKAGE', 'all');
      expect(inactive).toHaveBeenCalledWith('caller');
    },
  );

  it('updates an assignment by patching the fresh SAP document under a lock', async () => {
    const calls = mockSap();
    const result = await write({
      action: 'update',
      type: 'SOD2',
      name: 'Z_UI_DEMO_DOC_O4_0001',
      source: '{"leadingBusinessObjectType":"Currency","apiPackage":"Z_OTHER"}',
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain('Saved SOD2 Z_UI_DEMO_DOC_O4_0001. The change is active');
    expect(text(result)).toContain('Read-only fields were not changed: apiPackage.');
    const sequence = calls.map(
      (c) =>
        `${c.method} ${c.url.split('?')[0]}${c.url.includes('_action=') ? ` ${/_action=(\w+)/.exec(c.url)![1]}` : ''}`,
    );
    expect(sequence).toEqual([
      `POST ${SOD2_URL} LOCK`,
      `GET ${SOD2_URL}`,
      `PUT ${SOD2_URL}`,
      `POST ${SOD2_URL} UNLOCK`,
    ]);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('corrNr=DEVK900001');
    expect(put.body).toContain('<sod2:leadingBusinessObjectType>Currency</sod2:leadingBusinessObjectType>');
    // The read-only API package stays as SAP has it.
    expect(put.body).toContain('<sod2:packageID>Z_DEMO_API_PACKAGE</sod2:packageID>');
  });

  it("names the findings of SAP's check run when SAP refuses the save", async () => {
    const calls = mockSap({
      putError:
        '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceInvalidData"/><message lang="EN">API package assignment Z_UI_DEMO_DOC_O4_0001 contains errors and cannot be saved</message><properties><entry key="T100KEY-ID">SWB_TOOL</entry><entry key="T100KEY-NO">036</entry></properties></exc:exception>',
      checkRun:
        '<?xml version="1.0" encoding="utf-8"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="/sap/bc/adt/aps/com/sod2/z_ui_demo_doc_o4_0001" chkrun:status="processed"><chkrun:checkMessageList><chkrun:checkMessage chkrun:uri="/sap/bc/adt/aps/com/sod2/z_ui_demo_doc_o4_0001" chkrun:type="E" chkrun:shortText="Leading business object type Nope does not exist"/></chkrun:checkMessageList></chkrun:checkReport></chkrun:checkRunReports>',
    });
    const result = await write({
      action: 'update',
      type: 'SOD2',
      name: 'Z_UI_DEMO_DOC_O4_0001',
      source: '{"leadingBusinessObjectType":"Nope"}',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('contains errors and cannot be saved');
    expect(text(result)).toContain(
      "SAP's check of the document reports: Leading business object type Nope does not exist",
    );
    const put = calls.find((c) => c.method === 'PUT')!;
    const check = calls.find((c) => c.url.startsWith('/sap/bc/adt/checkruns'))!;
    // Eclipse's shape: the edited metadata document as artifact of the object URI itself.
    expect(check.body).toContain(`chkrun:uri="${SOD2_URL}"`);
    expect(check.body).toContain('chkrun:contentType="application/vnd.sap.adt.blues.v1+xml; charset=utf-8"');
    expect(check.body).toContain(Buffer.from(put.body, 'utf-8').toString('base64'));
    expect(calls.at(-1)!.url).toContain('_action=UNLOCK');
  });

  it.each([
    [true, 'SWB_TOOL', '036'],
    [false, 'OTHER', '036'],
    [false, 'SWB_TOOL', '099'],
  ] as const)(
    'skips checkrun diagnostics for minimal errors or a different SAP refusal (%s, %s/%s)',
    async (minimalErrors, id, no) => {
      const calls = mockSap({
        putError: `<exception><message>Rejected field</message><properties><entry key="T100KEY-ID">${id}</entry><entry key="T100KEY-NO">${no}</entry></properties></exception>`,
      });
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', {
        type: 'SOD2',
        action: 'update',
        name: 'Z_UI_DEMO_DOC_O4_0001',
        source: '{"description":"changed"}',
      });
      expect(result.isError).toBe(true);
      expect(calls.some((c) => c.url.includes('/checkruns'))).toBe(false);
      if (minimalErrors) expect(text(result)).not.toContain('Rejected field');
    },
  );
  it('refuses an update that changes nothing', async () => {
    const calls = mockSap();
    const result = await write({
      action: 'update',
      type: 'SOD2',
      name: 'Z_UI_DEMO_DOC_O4_0001',
      source: '{"apiKind":"x"}',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('source changes nothing');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('reports a confirmed but unreadable assignment and preserves the metadata cause', async () => {
    mockSap({ metadataStatus: 500 });
    const input = { type: 'SOD2', name: 'Z_UI_DEMO_DOC_O4_0001' };
    const result = await write({
      ...input,
      action: 'create',
      package: '$TMP',
      source: '{"apiPackage":"P","apiObject":{"type":"CLAS","name":"CL_TEST"}}',
    });
    expect(text(result)).toContain('was created in package $TMP');
    expect(text(result)).toContain('SAP cannot read its metadata');
    expect(text(result)).toContain('is PRIVATE');
    const read = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', input);
    expect(read.isError).toBe(true);
    expect(text(read)).toContain('is PRIVATE');
    expect(text(read)).not.toMatch(/often transient/);
  });

  it.each([
    [500, '$TMP', SOD2_URL, 'SOD2', 1, true],
    [500, 'Z_OTHER', SOD2_URL, 'SOD2', 1, false],
    [500, '$TMP', SOD1_URL, 'SOD2', 1, false],
    [500, '$TMP', SOD2_URL, 'SOD1', 1, false],
    [500, '', SOD2_URL, 'SOD2', 1, false],
    [500, '$TMP', SOD2_URL, 'SOD2', 0, false],
    [500, '$TMP', SOD2_URL, 'SOD2', 2, false],
    [403, '$TMP', SOD2_URL, 'SOD2', 1, false],
  ] as const)('verifies delete evidence %j %s %s %s %i', async (status, pkg, uri, type, count, allowed) => {
    const ref = (p: string) =>
      `<objectReference type="${type}" name="Z_UI_DEMO_DOC_O4_0001" uri="${uri}" packageName="${p}"/>`;
    const calls = mockSap({
      metadataStatus: status,
      search: `<objectReferences>${count ? ref(pkg) : ''}${count === 2 ? ref('CONFLICT') : ''}</objectReferences>`,
    });
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'SOD2',
      name: 'Z_UI_DEMO_DOC_O4_0001',
      package: '$TMP',
    });
    expect(!result.isError, text(result)).toBe(allowed);
    expect(calls.some((c) => c.url.includes('informationsystem/search'))).toBe(status === 500);
    expect(calls.some((c) => c.url === '/sap/bc/adt/deletion/check')).toBe(allowed);
  });

  it('deletes through the deletion framework with the transport SAP reports', async () => {
    const calls = mockSap();
    const result = await write({ action: 'delete', type: 'SOD2', name: 'Z_UI_DEMO_DOC_O4_0001' });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toBe('Deleted SOD2 Z_UI_DEMO_DOC_O4_0001 (transport DEVK900001).');
    const del = calls.find((c) => c.url === '/sap/bc/adt/deletion/delete')!;
    expect(del.body).toContain(
      `<del:object adtcore:uri="${SOD2_URL}"><del:transportNumber>DEVK900001</del:transportNumber></del:object>`,
    );
    expect(calls.some((c) => c.method === 'DELETE' || c.url.includes('_action=LOCK'))).toBe(false);
  });

  it('adds current assignment names to a refused package deletion', async () => {
    mockSap({
      check: deletionCheck(SOD1_URL),
      deleted: deletionResult(SOD1_URL, false, 'Prerequisites not met'),
      assignments:
        '<packageAssignments><packageAssignment><name>Z_ONE</name></packageAssignment><packageAssignment><name>Z_TWO</name></packageAssignment></packageAssignments>',
    });
    const result = await write({ action: 'delete', type: 'SOD1', name: 'Z_DEMO_API_PACKAGE' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Prerequisites not met Current assignments: Z_ONE, Z_TWO.');
  });

  it('does not report another object’s deletion as success', async () => {
    mockSap({ deleted: deletionResult(SOD1_URL, true) });
    const result = await write({ action: 'delete', type: 'SOD2', name: 'Z_UI_DEMO_DOC_O4_0001' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('did not confirm');
  });

  it('refuses to delete an assignment that still has a KTD', async () => {
    const calls = mockSap({ check: fixture('sod2-deletion-check-with-ktd.xml') });
    const result = await write({ action: 'delete', type: 'SOD2', name: 'Z_UI_DEMO_DOC_O4_0001' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'dependent objects that SAP deletes only together with it: SKTD/TYP Z_UI_DEMO_DOC_O4_0001',
    );
    expect(calls.some((c) => c.url === '/sap/bc/adt/deletion/delete')).toBe(false);
  });

  it.each([
    [
      { check: deletionCheck(SOD2_URL, false) },
      'SAP does not allow deleting SOD2 Z_UI_DEMO_DOC_O4_0001: Object is in use',
    ],
    [
      { deleted: deletionResult(SOD2_URL, false, 'Prerequisites not met') },
      'SAP did not delete SOD2 Z_UI_DEMO_DOC_O4_0001: Prerequisites not met',
    ],
  ])('reports a refused deletion', async (routes, message) => {
    mockSap(routes);
    const result = await write({ action: 'delete', type: 'SOD2', name: 'Z_UI_DEMO_DOC_O4_0001' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
  });

  it('enforces the package allowlist against the real package before any change', async () => {
    const calls = mockSap();
    const client = createClient();
    client.safety.allowedPackages = ['Z_OTHER'];
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SOD1',
      name: 'Z_DEMO_API_PACKAGE',
      source: '{"alias":"x"}',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Z_DEMO_APIS');
    expect(calls.some((c) => c.method === 'PUT' || c.url.includes('_action=LOCK'))).toBe(false);
  });

  it.each(['SOD1', 'SOD2'])('directs a batch %s to single create', async (type) => {
    mockSap();
    const result = await write({
      action: 'batch_create',
      package: '$TMP',
      objects: [{ type, name: 'Z_X', source: '{"abbreviation":"ZX"}' }],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`single SAPWrite(action="create", type="${type}", name="Z_X")`);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SAPWrite type=SKTD on SOD1/SOD2 parents', () => {
  it.each(['btp', 'onprem'] as const)('refuses unavailable catalog parents on %s before create', async (systemType) => {
    const calls = mockSap();
    const client = createClient();
    if (systemType === 'onprem') client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', []]]));
    const result = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType }, 'SAPWrite', {
      type: 'SKTD',
      action: 'create',
      name: 'ZTEST',
      package: '$TMP',
      refObjectType: 'SOD2',
    });
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    if (systemType === 'btp') {
      for (const tool of ['SAPRead', 'SAPWrite']) {
        const denied = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType }, tool, {
          type: 'SOD2',
          name: 'ZTEST',
          ...(tool === 'SAPWrite' ? { action: 'delete' } : {}),
        });
        expect(denied.isError).toBe(true);
      }
      expect(calls).toHaveLength(0);
    }
  });
  it.each([
    ['SOD1', 'Z_DEMO_API_PACKAGE', SOD1_URL],
    ['SOD2', 'Z_UI_DEMO_DOC_O4_0001', SOD2_URL],
  ])('references a %s parent with its plain type and lowercase URI', async (refType, name, uri) => {
    const calls = mockSap();
    const result = await write({ action: 'create', type: 'SKTD', name, refObjectType: refType, package: '$TMP' });
    expect(result.isError, text(result)).toBeUndefined();
    const post = calls.find(
      (c) =>
        c.method === 'POST' &&
        c.url.startsWith('/sap/bc/adt/documentation/ktd/documents') &&
        !c.url.includes('_action'),
    )!;
    expect(post.body).toContain(
      `<sktd:refObject adtcore:name="${name}" adtcore:type="${refType}" adtcore:uri="${uri}"/>`,
    );
  });
});
