/**
 * SAPWrite / SAPActivate handler tests for BAdI enhancement implementations (ENHO/XHB).
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const XHB = readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8');
const SPOT = readFileSync(new URL('../../fixtures/xml/enhancement-spot.xml', import.meta.url), 'utf8');
const FILTERED = readFileSync(
  new URL('../../fixtures/xml/enhancement-implementation-filter.xml', import.meta.url),
  'utf8',
);
const ENHO_URL = '/sap/bc/adt/enhancements/enhoxhb';
const ENHO_CT = 'application/vnd.sap.adt.enh.enhoxhb.v4+xml';

interface Call {
  method: string;
  url: string;
  body?: string;
  accept?: string;
  contentType?: string;
}

/** Mock SAP: GET returns `metadata`, LOCK returns a handle, everything else 201. Records every call. */
function mockSap(metadata = XHB): Call[] {
  const calls: Call[] = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(
    (url: string | URL, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const method = opts?.method ?? 'GET';
      const headers = (opts?.headers ?? {}) as Record<string, string>;
      const urlStr = String(url);
      calls.push({
        method,
        url: urlStr,
        body: typeof opts?.body === 'string' ? opts.body : undefined,
        accept: headers.Accept ?? headers.accept,
        contentType: headers['Content-Type'] ?? headers['content-type'],
      });
      if (method === 'POST' && urlStr.includes('_action=LOCK')) {
        return Promise.resolve(
          mockResponse(200, '<asx:values><LOCK_HANDLE>LH_ENHO</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
            'x-csrf-token': 'T',
          }),
        );
      }
      // Only the synthetic spot is served; other spots get a non-spot body, so the check is skipped.
      if (method === 'GET' && urlStr.includes('/enhancements/enhsxsb/es_my_spot')) {
        return Promise.resolve(mockResponse(200, SPOT, { 'x-csrf-token': 'T' }));
      }
      if (method === 'GET' && urlStr.includes(ENHO_URL)) {
        return Promise.resolve(mockResponse(200, metadata, { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(mockResponse(201, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
    },
  );
  return calls;
}

const createSource = JSON.stringify({
  enhancementSpot: 'ES_SD_SLS_EXTEND',
  badiImplementations: [
    {
      name: 'ZMY_BADI_APPROVAL_REASON',
      badiDefinition: 'SD_APM_SET_APPROVAL_REASON',
      implementingClass: 'ZCL_MY_APPROVAL_REASON',
    },
  ],
});

describe('ENHO (BAdI implementation) write handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  it('SAPWrite create POSTs the container, saves the BAdI implementations with a PUT and hints activation', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENHO',
      name: 'ZMY_ENH_APPROVAL_REASON',
      package: '$TMP',
      description: 'Approval Reason BAdI',
      source: createSource,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('SAPActivate(type="ENHO", name="ZMY_ENH_APPROVAL_REASON")');
    const post = calls.find((c) => c.method === 'POST' && c.url.includes(ENHO_URL) && !c.url.includes('_action'));
    expect(post?.url).not.toContain('ZMY_ENH_APPROVAL_REASON');
    expect(post?.contentType).toContain(ENHO_CT);
    expect(post?.body).toContain('adtcore:type="ENHO/XHB"');
    expect(post?.body).toContain('adtcore:description="Approval Reason BAdI"');
    expect(post?.body).toContain('adtcore:name="ES_SD_SLS_EXTEND"');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain(`${ENHO_URL}/ZMY_ENH_APPROVAL_REASON?lockHandle=LH_ENHO`);
    expect(put?.contentType).toContain(ENHO_CT);
    expect(put?.body).toContain('enho:name="ZMY_BADI_APPROVAL_REASON"');
    expect(put?.body).toContain('adtcore:type="CLAS/OC" adtcore:name="ZCL_MY_APPROVAL_REASON"');
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
  });

  it('reports an existing container when the follow-up PUT fails after the create POST', async () => {
    const calls = mockSap();
    const base = mockFetch.getMockImplementation();
    if (!base) throw new Error('mockSap did not install an implementation');
    mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) =>
      opts?.method === 'PUT'
        ? Promise.resolve(mockResponse(400, '<exc:exception><message>BAdI not in spot</message></exc:exception>'))
        : base(url, opts),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENHO',
      name: 'ZMY_ENH_APPROVAL_REASON',
      package: '$TMP',
      source: createSource,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Created ENHO ZMY_ENH_APPROVAL_REASON');
    expect(result.content[0].text).toContain('do not retry create');
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
  });

  it.each([
    [{}, 'enhancementSpot is required'],
    [{ enhancementSpot: 'ES_X', badiImplementations: [{ name: 'ZI', badiDefinition: 'B' }] }, 'implementingClass'],
    [{ enhancementSpot: 'ES_X', badiimplementations: [] }, 'unknown key(s) "badiimplementations"'],
    [{ technology: 'HOOK_IMPL', enhancementSpot: 'ES_X' }, 'only BAdI implementations'],
  ])('SAPWrite create with an invalid definition fails before any write: %j', async (definition, message) => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENHO',
      name: 'ZTEST_ENHO',
      package: '$TMP',
      source: JSON.stringify(definition),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(calls.filter((c) => (c.method === 'POST' && !c.url.includes('_action')) || c.method === 'PUT')).toHaveLength(
      0,
    );
  });

  it('SAPWrite update keeps stored flags and the spot when only the class changes', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
      source: JSON.stringify({
        badiImplementations: [
          { name: 'SFW_TCD', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'ZCL_OTHER' },
          { name: 'SFW_TCD_B', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'CL_SFW_TCD_B' },
        ],
      }),
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain(`${ENHO_URL}/SFW_BCF_TCD?lockHandle=LH_ENHO`);
    expect(put?.body).toContain('adtcore:name="ZCL_OTHER"');
    // Stored values survive: second entry stays default + inactive, spot and description unchanged.
    expect(put?.body).toContain(
      'enho:name="SFW_TCD_B" enho:shortText="Second impl" enho:example="false" enho:default="true" enho:active="false"',
    );
    expect(put?.body).toContain('adtcore:name="BCF_REMOTE_TCD"');
    expect(put?.body).toContain('adtcore:description="TCD Lookup, Assignment..."');
  });

  it.each(['create', 'batch_create'] as const)(
    '%s POSTs only the container and saves the implementations with the transport, like Eclipse',
    async (action) => {
      const calls = mockSap();
      const entry = { type: 'ENHO', name: 'ZMY_ENH_APPROVAL_REASON', source: createSource };
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action,
        package: 'ZMY_PKG',
        transport: 'A4HK900123',
        ...(action === 'create' ? entry : { objects: [entry] }),
      });
      expect(result.content[0].text).toContain('ZMY_ENH_APPROVAL_REASON');
      // Live 816: implementations in the create POST of a transportable object → HTTP 500 from a SAP dialog.
      const post = calls.find((c) => c.method === 'POST' && /enhoxhb\?/.test(c.url) && !c.url.includes('_action'));
      expect(post?.url).toContain('corrNr=A4HK900123');
      expect(post?.body).toContain('adtcore:name="ES_SD_SLS_EXTEND"');
      expect(post?.body).not.toContain('<enho:badiImplementation ');
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url).toContain('corrNr=A4HK900123');
      expect(put?.body).toContain('enho:name="ZMY_BADI_APPROVAL_REASON"');
    },
  );

  it('batch_create reports the post-create save as a write step', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [{ type: 'ENHO', name: 'ZMY_ENH_APPROVAL_REASON', source: createSource }],
    });
    expect(result.content[0].text).toContain('ZMY_ENH_APPROVAL_REASON');
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    // ENHO activation needs the name in the reference (live 816: 403 "Resource   could not be locked" without it).
    const activation = calls.find((c) => c.method === 'POST' && c.url.includes('/activation'));
    expect(activation?.body).toContain('adtcore:name="ZMY_ENH_APPROVAL_REASON"');
  });

  it('SAPWrite update takes the spot from the usages when the implementation list is empty', async () => {
    const empty = XHB.replace(
      /<enho:badiImplementations>[\s\S]*<\/enho:badiImplementations>/,
      '<enho:badiImplementations/>',
    );
    const calls = mockSap(empty);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
      source: JSON.stringify({
        badiImplementations: [{ name: 'ZNEW', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'ZCL_NEW' }],
      }),
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toContain('enho:name="ZNEW"');
    expect(put?.body).toContain('adtcore:type="ENHS/XSB" adtcore:name="BCF_REMOTE_TCD"');
  });

  it('SAPWrite update refuses a non-BAdI enhancement and never PUTs', async () => {
    const calls = mockSap(XHB.replace('enho:toolType="BADI_IMPL"', 'enho:toolType="HOOK_IMPL"'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
      source: '{}',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('only BAdI implementations are writable');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('SAPWrite update keeps filter trees, customizingLock and example that the JSON does not model', async () => {
    const calls = mockSap(FILTERED);
    const read = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'ENHO',
      name: 'ZMY_ENH_FILTERED',
    });
    const json = JSON.parse(read.content[0].text);
    json.badiImplementations[1].active = false;
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'ZMY_ENH_FILTERED',
      source: JSON.stringify(json),
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((c) => c.method === 'PUT');
    // Live 816: a rebuilt document without these resets them, so they are re-sent as stored.
    expect(put?.body).toContain('enho:value="1000"');
    expect(put?.body).toContain('enho:value="2000"');
    expect(put?.body).toContain('enho:value="BE"');
    expect(put?.body).toContain('enho:name="ZMY_IMPL_WAREHOUSE" enho:shortText="Per warehouse" enho:example="true"');
    expect((put?.body ?? '').match(/enho:customizingLock="X"/g)).toHaveLength(2);
    expect(put?.body).toContain(
      'enho:name="ZMY_IMPL_COUNTRY" enho:shortText="" enho:example="false" enho:default="false" enho:active="false"',
    );
  });

  const updateFiltered = async (entries: Record<string, unknown>[]) => {
    const calls = mockSap(FILTERED);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'ZMY_ENH_FILTERED',
      source: JSON.stringify({ badiImplementations: entries }),
    });
    return { result, put: calls.find((c) => c.method === 'PUT') };
  };
  const warehouse = {
    name: 'ZMY_IMPL_WAREHOUSE',
    badiDefinition: 'BADI_MY_FILTERED',
    implementingClass: 'ZCL_MY_WAREHOUSE',
  };
  const country = { name: 'ZMY_IMPL_COUNTRY', badiDefinition: 'BADI_MY_FILTERED', implementingClass: 'ZCL_MY_COUNTRY' };

  it('SAPWrite update rebuilds a changed filter and keeps the unchanged one verbatim', async () => {
    const { result, put } = await updateFiltered([
      warehouse,
      { ...country, filter: "country = 'DE' or country = 'AT'" },
    ]);
    expect(result.isError).toBeUndefined();
    const body = put?.body ?? '';
    expect(body).toContain('enho:value="1000"'); // warehouse tree untouched
    expect(body).not.toContain('enho:value="BE"');
    expect(body).toContain(
      '<enho:filterToken xsi:type="enho:Or" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><enho:filterToken xsi:type="enho:Filter" enho:filterName="COUNTRY" enho:comparator="=" enho:value="DE"',
    );
    expect(body).toContain('filterProperty.COUNTRY');
    expect(body).toContain('adtcore:name="LAND1"'); // DDIC check copied from the spot's BAdI definition
  });

  it('SAPWrite update removes a filter with "filter": ""', async () => {
    const { result, put } = await updateFiltered([warehouse, { ...country, filter: '' }]);
    expect(result.isError).toBeUndefined();
    const body = put?.body ?? '';
    expect(body).not.toContain('enho:value="BE"');
    expect(body.match(/<enho:filterTree>/g)).toHaveLength(1);
  });

  it('SAPWrite update adds a new implementation with a filter', async () => {
    const { result, put } = await updateFiltered([
      warehouse,
      country,
      {
        name: 'ZMY_IMPL_NEW',
        badiDefinition: 'BADI_MY_FILTERED',
        implementingClass: 'ZCL_NEW',
        filter: "LGNUM = '3000'",
      },
    ]);
    expect(result.isError).toBeUndefined();
    expect(put?.body).toContain('filterProperty.LGNUM" xmlns:xsi');
    expect(put?.body).toContain('#//badi/contentSpecific///ZMY_IMPL_NEW/filterTree/filterProperty.LGNUM');
  });

  it.each([
    [{ ...country, filter: "REGION = 'EU'" }, 'declares no filter REGION'],
    [{ ...country, filter: "COUNTRY 'DE'" }, 'expected one of'],
    [{ ...country, badiDefinition: 'BADI_MY_PLAIN' }, 'Give the filter for the new BAdI definition'],
    [
      { name: 'ZMY_X', badiDefinition: 'BADI_NOT_THERE', implementingClass: 'ZCL_X' },
      'not defined in enhancement spot',
    ],
    [
      { name: 'ZMY_X', badiDefinition: 'BADI_MY_PLAIN', implementingClass: 'ZCL_X', filter: "COUNTRY = 'DE'" },
      'declares no filter COUNTRY',
    ],
  ])('SAPWrite update refuses %j before writing', async (entry, message) => {
    const { result, put } = await updateFiltered([warehouse, entry]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(put).toBeUndefined();
  });

  it('SAPWrite create builds the filter tree into the PUT, not the container POST', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENHO',
      name: 'ZMY_ENH_NEW',
      package: '$TMP',
      source: JSON.stringify({
        enhancementSpot: 'ES_MY_SPOT',
        badiImplementations: [{ ...country, filter: "COUNTRY = 'BE'" }],
      }),
    });
    expect(result.isError).toBeUndefined();
    const post = calls.find((c) => c.method === 'POST' && /enhoxhb\?/.test(c.url));
    expect(post?.body).not.toContain('filterTree');
    expect(calls.find((c) => c.method === 'PUT')?.body).toContain('enho:value="BE"');
  });

  it('SAPWrite update refuses a spot change and never PUTs', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
      source: JSON.stringify({ enhancementSpot: 'ES_OTHER' }),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('enhancement spot cannot change');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    const locked = calls.some((c) => c.url.includes('_action=LOCK'));
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(locked);
  });

  it('SAPWrite delete locks and deletes the XHB object URL', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
    });
    expect(result.isError).toBeUndefined();
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toContain(`${ENHO_URL}/SFW_BCF_TCD`);
  });

  it('SAPActivate routes ENHO to the XHB object URL, not the program endpoint', async () => {
    const calls = mockSap();
    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
      type: 'ENHO',
      name: 'ZMY_ENH_APPROVAL_REASON',
    });
    const activation = calls.find((c) => c.method === 'POST' && c.url.includes('/activation'));
    expect(activation?.body).toContain(`adtcore:uri="${ENHO_URL}/ZMY_ENH_APPROVAL_REASON"`);
    expect(calls.some((c) => c.url.includes('/programs/programs/'))).toBe(false);
  });

  it.each(['create', 'batch_create'] as const)(
    'refuses ENHO %s when discovery does not advertise the enhoxhb collection',
    async (action) => {
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      mockFetch.mockReset();
      const entry = { type: 'ENHO', name: 'ZTEST_ENHO', source: createSource };
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action,
        package: '$TMP',
        ...(action === 'create' ? entry : { objects: [entry] }),
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('BAdI implementation (ENHO) writes are not available');
      expect(mockFetch.mock.calls).toHaveLength(0);
    },
  );

  it.each([
    [
      'create',
      { action: 'create', type: 'ENHO', name: 'ZTEST_ENHO', package: 'ZOTHER', source: createSource },
      'ZOTHER',
    ],
    [
      'batch_create',
      {
        action: 'batch_create',
        package: 'ZOTHER',
        objects: [{ type: 'ENHO', name: 'ZTEST_ENHO', source: createSource }],
      },
      'ZOTHER',
    ],
    // Update is checked against the stored package (SFWTOOLS in the fixture), not an argument.
    ['update', { action: 'update', type: 'ENHO', name: 'SFW_BCF_TCD', source: '{}' }, 'SFWTOOLS'],
  ])('refuses ENHO %s outside the package allowlist before any write', async (_action, args, pkg) => {
    const calls = mockSap();
    const client = createClient();
    const restricted = client.withSafety({ ...client.safety, allowedPackages: ['$TMP'] });
    const result = await handleToolCall(restricted, DEFAULT_CONFIG, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`'${pkg}'`);
    expect(calls.filter((c) => c.method === 'POST' || c.method === 'PUT')).toHaveLength(0);
  });
});
