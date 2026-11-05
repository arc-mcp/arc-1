import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { parseDiscoveryDocument } = await import('../../../src/adt/xml-parser.js');
const { requestContext } = await import('../../../src/server/context.js');
const { fetchDiscoveryDocument } = await import('../../../src/adt/discovery.js');
const LOCK =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>OWNER</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values></asx:abap>';
// Synthetic minimal shape from #1189's report, not a captured native document.
const LEGACY_DISCOVERY =
  '<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="/sap/bc/adt/programs/programs"/><app:collection href="/sap/bc/adt/functions/groups"/></app:workspace></app:service>';
const ESR_DISCOVERY =
  '<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="/sap/bc/esproxy/types"/></app:workspace></app:service>';

function contextClient() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    client: '800',
    language: 'EN',
    safety: unrestrictedSafetyConfig(),
  });
}
const collection = (type: string) => `/sap/bc/adt/textelements/${type === 'PROG' ? 'programs' : 'functiongroups'}`;
const calls = () => mockFetch.mock.calls as [string, RequestInit][];
const discovery = (path: string, mime?: string, owner?: string) =>
  `<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="${path}">${mime ? `<app:accept>${mime}</app:accept>` : ''}</app:collection>${owner ? `<app:collection href="${owner}"/>` : ''}</app:workspace></app:service>`;

function mockDelete(
  discoveryBody: string,
  discoveryStatus = 200,
  poolLocked = false,
  contentType = 'application/atomsvc+xml',
) {
  mockFetch.mockImplementation((url: string) => {
    if (new URL(url).pathname === '/sap/bc/adt/discovery')
      return Promise.resolve(mockResponse(discoveryStatus, discoveryBody, { 'content-type': contentType }));
    if (poolLocked && String(url).includes('/textelements/') && String(url).includes('_action=LOCK'))
      return Promise.resolve(mockResponse(423, '<exception><message>Pool locked</message></exception>'));
    return Promise.resolve(
      mockResponse(
        200,
        String(url).includes('_action=LOCK')
          ? LOCK
          : String(url).includes('?version=inactive')
            ? '<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:type="PROG/PX" adtcore:version="inactive"/>'
            : '',
        { 'x-csrf-token': 'T' },
      ),
    );
  });
}

describe('text-pool discovery before owner deletion (#1189)', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['PROG', 'FUGR'])('uses legacy discovery to avoid an unsupported %s pool lock', async (type) => {
    mockFetch.mockImplementation((url: string) => {
      if (new URL(url).pathname === '/sap/bc/adt/discovery')
        return Promise.resolve(
          mockResponse(200, new URL(url).search ? ESR_DISCOVERY : LEGACY_DISCOVERY, {
            'content-type': 'application/atomsvc+xml',
            'x-csrf-token': 'T',
          }),
        );
      if (String(url).includes('/textelements/'))
        return Promise.resolve(mockResponse(200, '', { 'content-type': 'text/html' }));
      return Promise.resolve(
        mockResponse(200, String(url).includes('_action=LOCK') ? LOCK : '', { 'x-csrf-token': 'T' }),
      );
    });
    const client = contextClient();
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type, name: 'ZTEST' });
    expect(result.isError).toBeUndefined();
    const ownerLock = calls().findIndex(([url]) => String(url).includes('_action=LOCK'));
    const discovery = calls().findIndex(
      ([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET',
    );
    const deletion = calls().findIndex(([, init]) => init.method === 'DELETE');
    expect(discovery).toBeGreaterThan(ownerLock);
    expect(deletion).toBeGreaterThan(discovery);
    expect(calls().some(([url]) => String(url).includes('/textelements/'))).toBe(false);
    expect(client.http.hasDiscoveryData()).toBe(false);
  });

  it('uses a startup-loaded no-Accept catalog for legacy deletion', async () => {
    mockDelete('');
    const backend = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init: RequestInit) => {
      if (new URL(url).pathname === '/sap/bc/adt/discovery')
        return Promise.resolve(mockResponse(200, new URL(url).search ? ESR_DISCOVERY : LEGACY_DISCOVERY));
      return backend(url, init);
    });
    const client = contextClient();
    const { map } = await fetchDiscoveryDocument(client.http);
    expect(map.has('/sap/bc/adt/programs/programs')).toBe(true);
    client.http.setDiscoveryMap(map);
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: 'ZTEST',
    });
    expect(result.isError).toBeUndefined();
    expect(
      calls().filter(([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET'),
    ).toHaveLength(1);
    expect(calls().some(([url]) => String(url).includes('/textelements/'))).toBe(false);
    expect(calls().filter(([, init]) => init.method === 'DELETE')).toHaveLength(1);
  });

  it.each(['PROG', 'FUGR'])('retains the %s draft guard when discovery lists the pool without Accept', async (type) => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('_action=LOCK')
            ? LOCK
            : String(url).includes('?version=inactive')
              ? `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:type="${type}/PX" adtcore:version="inactive"/>`
              : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
    const client = createClient();
    const owner = type === 'PROG' ? '/sap/bc/adt/programs/programs' : '/sap/bc/adt/functions/groups';
    client.http.setDiscoveryMap(
      new Map([
        [collection(type), []],
        [owner, []],
      ]),
    );
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type, name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('text pool is inactive');
    expect(
      calls().some(([url]) => String(url).includes('/textelements/') && String(url).includes('_action=LOCK')),
    ).toBe(true);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
  });

  it('retains collection presence without inventing Accept types', () => {
    const map = parseDiscoveryDocument(LEGACY_DISCOVERY);
    expect(map.size).toBe(2);
    expect(map.get('/sap/bc/adt/programs/programs')).toEqual([]);
    expect(map.has('/sap/bc/adt/textelements/programs')).toBe(false);
  });

  it.each([
    ['empty document', 200, '', 'application/atomsvc+xml'],
    ['empty service', 200, '<app:service xmlns:app="http://www.w3.org/2007/app"/>', 'application/atomsvc+xml'],
    [
      'truncated discovery',
      200,
      '<app:service><app:workspace><app:collection href="/sap/bc/adt/programs/programs"/>',
      'application/atomsvc+xml',
    ],
    ['HTML', 200, '<html><body>Login</body></html>', 'text/html'],
    ['foreign XML', 200, '<response><status>OK</status></response>', 'application/xml'],
    ['foreign AtomPub', 200, discovery('/sap/bc/adt/oo/classes'), 'application/atomsvc+xml'],
    ...[401, 403, 404, 500, 503].map((status) => [String(status), status, '<exception/>', 'application/xml'] as const),
  ] as const)(
    'does not turn %s discovery into permission to skip a pool lock',
    async (_label, status, body, contentType) => {
      mockDelete(body, status, true, contentType);
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(
        calls().filter(([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET'),
      ).toHaveLength(1);
      expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
    },
  );

  it.each([
    ['listed without MIME', discovery(collection('PROG'), undefined, '/sap/bc/adt/programs/programs')],
    ['listed with MIME', discovery(collection('PROG'), 'application/xml', '/sap/bc/adt/programs/programs')],
    ['parent MIME', discovery('/sap/bc/adt/textelements', 'application/xml', '/sap/bc/adt/programs/programs')],
  ])('keeps the draft guard for freshly discovered %s support', async (_label, body) => {
    mockDelete(body);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: 'ZTEST',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('text pool is inactive');
    expect(
      calls().some(([url]) => String(url).includes('/textelements/') && String(url).includes('_action=LOCK')),
    ).toBe(true);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
  });

  it('keeps the existing guard when only a cached parent MIME is advertised', async () => {
    mockDelete(LEGACY_DISCOVERY);
    const client = createClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/textelements', ['application/xml']]]));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: 'ZTEST',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('text pool is inactive');
    expect(calls().some(([url]) => new URL(url).pathname === '/sap/bc/adt/discovery')).toBe(false);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
  });

  it('uses known no-Accept absence without another discovery request', async () => {
    mockDelete('');
    const client = createClient();
    client.http.setDiscoveryMap(parseDiscoveryDocument(LEGACY_DISCOVERY));
    expect(
      (await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type: 'PROG', name: 'ZTEST' }))
        .isError,
    ).toBeUndefined();
    expect(
      calls().some(
        ([url]) => String(url).includes('/textelements/') || new URL(url).pathname === '/sap/bc/adt/discovery',
      ),
    ).toBe(false);
    expect(calls().filter(([, init]) => init.method === 'DELETE')).toHaveLength(1);
  });

  it.each([
    ['exact pool', discovery(collection('PROG'), undefined, '/sap/bc/adt/programs/programs'), true, 0],
    [
      'absolute pool',
      discovery(`https://sap.example${collection('PROG')}/`, undefined, '/sap/bc/adt/programs/programs'),
      true,
      0,
    ],
    ['parent MIME', discovery('/sap/bc/adt/textelements', 'application/xml', '/sap/bc/adt/programs/programs'), true, 0],
    ['owner only', discovery('/sap/bc/adt/programs/programs'), false, 0],
    ['empty catalog', '<app:service xmlns:app="http://www.w3.org/2007/app"/>', true, 1],
    ['foreign owner', discovery('/sap/bc/adt/functions/groups'), true, 1],
    ['deeper MIME', discovery(`${collection('PROG')}/source`, 'application/xml'), true, 1],
  ] as const)('makes the same cached/fresh decision for %s evidence', async (_label, body, guarded, cachedGets) => {
    for (const mode of ['cached', 'fresh']) {
      vi.resetAllMocks();
      mockDelete(body);
      const client = createClient();
      if (mode === 'cached') client.http.setDiscoveryMap(parseDiscoveryDocument(body));
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(Boolean(result.isError), mode).toBe(guarded);
      expect(
        calls().filter(([url]) => String(url).includes('/textelements/') && String(url).includes('_action=LOCK')),
        mode,
      ).toHaveLength(Number(guarded));
      expect(
        calls().filter(([, init]) => init.method === 'DELETE'),
        mode,
      ).toHaveLength(Number(!guarded));
      expect(
        calls().filter(([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET'),
        mode,
      ).toHaveLength(mode === 'fresh' ? 1 : cachedGets);
      expect(client.http.hasDiscoveryData(), mode).toBe(mode === 'cached' && parseDiscoveryDocument(body).size > 0);
    }
  });

  it('does not use the program owner collection as proof of FUGR service absence', async () => {
    mockDelete(discovery('/sap/bc/adt/programs/programs'), 200, true);
    const client = createClient();
    client.http.setDiscoveryMap(parseDiscoveryDocument(discovery('/sap/bc/adt/programs/programs')));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'FUGR',
      name: 'ZTEST',
    });
    expect(result.isError).toBe(true);
    expect(
      calls().filter(([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET'),
    ).toHaveLength(1);
    expect(
      calls().some(
        ([url]) => String(url).includes('/textelements/functiongroups/') && String(url).includes('_action=LOCK'),
      ),
    ).toBe(true);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
  });

  it.each(['PROG', 'FUGR', 'CLAS'])('allows a %s symbols read when the collection has no Accept', async (type) => {
    const path = type === 'CLAS' ? '/sap/bc/adt/textelements/classes' : collection(type);
    mockFetch.mockResolvedValue(mockResponse(200, '001=Text'));
    const client = createClient();
    client.http.setDiscoveryMap(new Map([[path, []]]));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'TEXT_ELEMENTS',
      objectType: type,
      name: 'ZTEST',
      include: 'symbols',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('001=Text');
    expect(calls()).toHaveLength(1);
    expect(String(calls()[0]?.[0])).toContain(`${path}/ZTEST/source/symbols`);
  });

  it('keeps the owner security session and context across discovery and deletion', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (new URL(url).pathname === '/sap/bc/adt/core/discovery')
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SAP_SESSIONID_TEST_001=SEC; Path=/']));
      if (String(url).includes('_action=LOCK'))
        return Promise.resolve(mockResponse(200, LOCK, {}, ['sap-contextid=OWNER_CONTEXT; Path=/']));
      if (new URL(url).pathname === '/sap/bc/adt/discovery')
        return Promise.resolve(mockResponse(200, LEGACY_DISCOVERY, { 'content-type': 'application/atomsvc+xml' }));
      return Promise.resolve(mockResponse(200, ''));
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: 'ZTEST',
    });
    expect(result.isError).toBeUndefined();
    const ownerLock = calls().find(([url]) => String(url).includes('_action=LOCK'))!;
    const catalog = calls().find(
      ([url, init]) => new URL(url).pathname === '/sap/bc/adt/discovery' && init.method === 'GET',
    )!;
    const deletion = calls().find(([, init]) => init.method === 'DELETE')!;
    for (const [, init] of [ownerLock, catalog, deletion]) {
      const headers = new Headers(init.headers);
      expect(headers.get('cookie')).toContain('SAP_SESSIONID_TEST_001=SEC');
      expect(headers.get('x-sap-adt-sessiontype')).toBe('stateful');
    }
    for (const [, init] of [catalog, deletion])
      expect(new Headers(init.headers).get('cookie')).toContain('sap-contextid=OWNER_CONTEXT');
  });

  it('does not send a pool lock or DELETE after caller cancellation during discovery', async () => {
    const controller = new AbortController();
    mockDelete(LEGACY_DISCOVERY);
    const backend = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init: RequestInit) => {
      if (new URL(url).pathname === '/sap/bc/adt/discovery') {
        controller.abort();
        throw new DOMException('Cancelled by caller', 'AbortError');
      }
      return backend(url, init);
    });
    const result = await requestContext.run({ requestId: '1189-abort', signal: controller.signal }, () =>
      handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type: 'PROG', name: 'ZTEST' }),
    );
    expect(result.isError).toBe(true);
    expect(calls().some(([url]) => String(url).includes('/textelements/'))).toBe(false);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
    expect(calls().some(([url]) => String(url).includes('_action=UNLOCK'))).toBe(true);
  });

  it('keeps the guard and cleanup after its own discovery timeout', async () => {
    const controller = new AbortController();
    let timedOut = false;
    mockDelete('');
    const backend = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init: RequestInit) => {
      if (new URL(url).pathname === '/sap/bc/adt/core/discovery')
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SAP_SESSIONID_TEST_001=SEC; Path=/']));
      if (String(url).includes('_action=LOCK') && !String(url).includes('/textelements/'))
        return Promise.resolve(mockResponse(200, LOCK, {}, ['sap-contextid=OWNER_CONTEXT; Path=/']));
      if (new URL(url).pathname === '/sap/bc/adt/discovery') {
        const signal = init.signal!;
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              timedOut = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      }
      return backend(url, init);
    });
    const result = await requestContext.run({ requestId: '1189-timeout', signal: controller.signal }, () =>
      handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type: 'PROG', name: 'ZTEST' }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('text pool is inactive');
    expect(timedOut).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(
      calls().some(([url]) => String(url).includes('/textelements/') && String(url).includes('_action=LOCK')),
    ).toBe(true);
    expect(calls().some(([, init]) => init.method === 'DELETE')).toBe(false);
    expect(calls().some(([url]) => String(url).includes('_action=UNLOCK'))).toBe(true);
    expect(
      calls().some(([url]) => String(url).includes('/textelements/') && String(url).includes('version=inactive')),
    ).toBe(true);
    const afterTimeout = calls().filter(
      ([url]) => String(url).includes('/textelements/') || String(url).includes('_action=UNLOCK'),
    );
    for (const [, init] of afterTimeout) {
      const headers = new Headers(init.headers);
      expect(headers.get('cookie')).toContain('SAP_SESSIONID_TEST_001=SEC');
      expect(headers.get('cookie')).toContain('sap-contextid=OWNER_CONTEXT');
      expect(headers.get('x-sap-adt-sessiontype')).toBe('stateful');
    }
  }, 20000);
});
