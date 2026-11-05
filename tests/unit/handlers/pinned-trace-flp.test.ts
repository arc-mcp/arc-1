import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPManage } = await import('../../../src/handlers/manage.js');
const { executePrivatePinnedFlp } = await import('../../../src/handlers/pinned-flp.js');
const { executePrivatePinnedTrace, handlePinnedTrace } = await import('../../../src/handlers/pinned-trace.js');
const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const { unrestrictedSafetyConfig } = await import('../../../src/adt/safety.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const policy = {
  enabled: true,
  target: 'A4H/001',
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  serverAllowedTransports: [],
};
const pinnedConfig = {
  ...DEFAULT_CONFIG,
  targetId: policy.target,
  multiTargetEndpoints: true,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  multiTargetWrite: policy,
  client: '001',
};
const BASE = '/sap/bc/adt/runtime/traces/abaptraces';
const ST05 = '/sap/bc/adt/st05/trace/state';
const ST05_TYPE = 'application/vnd.sap.adt.perf.trace.state.v1+xml';
const stateXml = readFileSync(new URL('../../fixtures/xml/st05-trace-state.xml', import.meta.url), 'utf8');
const FLP = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';
const requestId = `${BASE}/requests/vhcala4hci_A4H_00%2c1%2c20260625093701`;
const feed = (user = 'MARIAN', client = '001') =>
  `<?xml version="1.0"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:author trc:role="admin" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>WRITER1</atom:name></atom:author><atom:author trc:role="trace" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>${user}</atom:name></atom:author><atom:id>${requestId}</atom:id><atom:title>x</atom:title><trc:extendedData xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><trc:client trc:role="trace">${client}</trc:client><trc:expires>${new Date(Date.now() + 1000).toISOString()}</trc:expires><trc:processType trc:processTypeId="${BASE}/processtypes/http"/><trc:object trc:objectTypeId="${BASE}/objecttypes/url"/><trc:executions trc:maximal="1" trc:completed="0"/></trc:extendedData></atom:entry></atom:feed>`;

function fixture(overrides: Partial<typeof pinnedConfig> = {}) {
  const config = { ...pinnedConfig, ...overrides };
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    username: 'jwt-display@example.com',
    client: '001',
    safety: { ...unrestrictedSafetyConfig(), allowTransportWrites: false, multiTargetWrite: policy },
  });
  const calls: Array<{ method: string; path: string; search: string; body?: string; headers: Record<string, string> }> =
    [];
  return { config, client, calls };
}

type Fixture = ReturnType<typeof fixture>;

function route(f: Fixture, handler: (method: string, path: string, body?: string) => Response | undefined) {
  mockFetch.mockImplementation(
    async (url: string | URL, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      const parsed = new URL(String(url));
      const method = init?.method ?? 'GET';
      if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
      f.calls.push({
        method,
        path: parsed.pathname,
        search: parsed.search,
        body: init?.body,
        headers: init?.headers ?? {},
      });
      return handler(method, parsed.pathname, init?.body) ?? mockResponse(599, 'Unexpected request');
    },
  );
}

const foreignContext = () =>
  pinnedMutationContext(
    { ...unrestrictedSafetyConfig(), multiTargetWrite: { ...policy } },
    { deadline: Date.now() + 60_000 },
    { unlockFailed: false },
  );
function contextFor(f: Fixture) {
  return pinnedMutationContext(f.client.safety, { deadline: Date.now() + 60_000 }, { unlockFailed: false });
}

beforeEach(() => {
  mockFetch.mockReset();
  resetCachedFeatures();
});

const closedTraceCalls = [
  { action: 'trace_start', traceUser: 'MARIAN' },
  { action: 'trace_cancel', id: requestId, traceUser: 'MARIAN' },
  { action: 'set_sql_trace_state', sqlOn: true, user: 'MARIAN' },
];
const closedFlpCalls = [
  { action: 'flp_list_catalogs' },
  { action: 'flp_list_groups' },
  { action: 'flp_list_tiles', catalogId: 'ZARC1_CAT' },
  { action: 'flp_create_catalog', domainId: 'ZARC1_CAT', title: 'Catalog' },
  { action: 'flp_create_group', groupId: 'ZARC1_GROUP', title: 'Group' },
  {
    action: 'flp_create_tile',
    catalogId: 'ZARC1_CAT',
    tile: { id: 'T', title: 'T', semanticObject: 'S', semanticAction: 'display' },
  },
  { action: 'flp_add_tile_to_group', groupId: 'ZARC1_GROUP', catalogId: 'ZARC1_CAT', tileInstanceId: 'I' },
  { action: 'flp_delete_catalog', catalogId: 'ZARC1_CAT' },
];

describe('public trace and FLP entries stay closed until admission', () => {
  it.each(closedTraceCalls)('refuses %j through shared dispatch with no SAP I/O', async (args) => {
    const f = fixture();
    route(f, () => undefined);
    const result = await handleToolCall(f.client, f.config, 'SAPDiagnose', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(closedFlpCalls)('refuses %j through shared dispatch with no SAP I/O', async (args) => {
    const f = fixture();
    route(f, () => undefined);
    const result = await handleToolCall(f.client, f.config, 'SAPManage', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never falls back to the legacy adapter for a read-only multi-target route without a write policy', async () => {
    const f = fixture({ multiTargetWrite: undefined as never, allowWrites: false });
    f.client.safety.multiTargetWrite = undefined;
    f.client.safety.allowWrites = false;
    route(f, () => undefined);
    for (const args of closedFlpCalls)
      await expect(handleSAPManage(f.client, f.config, args)).rejects.toThrow('unavailable');
    for (const args of closedTraceCalls)
      await expect(handlePinnedTrace(f.client, args, f.config)).rejects.toThrow('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retains the unchanged single-target FLP and trace adapters', async () => {
    const f = fixture({
      targetId: undefined as never,
      multiTargetEndpoints: false,
      multiTargetWrite: undefined as never,
      ppEnabled: false,
      ppStrict: false,
    });
    f.client.safety.multiTargetWrite = undefined;
    route(f, (method, path) => {
      if (method === 'GET' && path === `${FLP}/Catalogs`)
        return mockResponse(200, JSON.stringify({ d: { results: [{ domainId: 'ZA', chipCount: '0001' }] } }));
      if (method === 'POST' && path.endsWith('/parameters'))
        return mockResponse(200, '', { location: `${BASE}/parameters/AB` });
      if (method === 'POST' && path.endsWith('/requests')) return mockResponse(200, feed('JWT-DISPLAY@EXAMPLE.COM'));
      if (method === 'GET' && path.endsWith('/requests')) return mockResponse(200, feed('JWT-DISPLAY@EXAMPLE.COM'));
      return undefined;
    });
    const list = await handleToolCall(f.client, f.config, 'SAPManage', { action: 'flp_list_catalogs' });
    expect(list.content[0].text).toContain('1 catalogs (1 custom Z/Y)');
    const armed = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_start' });
    expect(JSON.parse(armed.content[0].text)).toMatchObject({ armed: true });
    expect(new URLSearchParams(f.calls[2].search).get('traceUser')).toBe('JWT-DISPLAY@EXAMPLE.COM');
    const requests = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_requests' });
    expect(requests.isError).toBeUndefined();
    expect(f.calls.at(-1)?.search).toContain('user=JWT-DISPLAY');
  });
});

describe('trace_requests attribution on Principal Propagation routes', () => {
  it('preserves the single-target empty username query instead of reporting a PP requirement', async () => {
    const f = fixture({
      targetId: undefined as never,
      multiTargetEndpoints: false,
      multiTargetWrite: undefined as never,
      ppEnabled: false,
      ppStrict: false,
    });
    f.client = new AdtClient({ baseUrl: 'https://sap.example', client: '001', safety: unrestrictedSafetyConfig() });
    route(f, () => mockResponse(200, feed()));
    const result = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_requests' });
    expect(result.isError).toBeUndefined();
    expect(f.calls[0].search).toBe('?user=&sap-client=001&sap-language=EN');
  });

  it('requires an explicit SAP user instead of sending the JWT display name', async () => {
    const f = fixture();
    route(f, () => undefined);
    const result = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_requests' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('requires "traceUser"');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([{ traceUser: 'MARIAN' }, { user: 'MARIAN' }])('lists for the explicit user in %j', async (input) => {
    const f = fixture();
    route(f, () => mockResponse(200, feed()));
    const result = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_requests', ...input });
    expect(result.isError).toBeUndefined();
    expect(f.calls[0].search).toBe('?user=MARIAN&sap-client=001&sap-language=EN');
  });

  it('keeps the destination user as the default on a shared Basic route', async () => {
    const f = fixture({ ppEnabled: false, ppStrict: false });
    route(f, () => mockResponse(200, feed()));
    const result = await handleToolCall(f.client, f.config, 'SAPDiagnose', { action: 'trace_requests' });
    expect(result.isError).toBeUndefined();
    expect(f.calls[0].search).toContain('user=JWT-DISPLAY');
  });
});

describe('private qualification entries', () => {
  it('runs the shared adapter and reports target, request id and no-replay wire behavior', async () => {
    const f = fixture();
    route(f, (method, path) => {
      if (method === 'POST' && path.endsWith('/parameters'))
        return mockResponse(200, '', { location: `${BASE}/parameters/AB` });
      if (method === 'POST' && path.endsWith('/requests')) return mockResponse(200, feed());
      if (method === 'GET' && path.endsWith('/requests')) return mockResponse(200, feed());
      return undefined;
    });
    const result = await executePrivatePinnedTrace(f.client, closedTraceCalls[0], f.config, contextFor(f));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      state: 'armed',
      action: 'trace_start',
      target: 'A4H/001',
      scope: { traceUser: 'MARIAN', traceClient: '001' },
      request: { actingUser: 'WRITER1' },
      readback: 'confirmed',
    });
    expect(f.calls.map((call) => call.method)).toEqual(['POST', 'POST', 'GET']);
    expect(new URLSearchParams(f.calls[1].search).get('traceClient')).toBe('001');
  });

  it('does not replay a stale-token 403 on the wire', async () => {
    const f = fixture();
    route(f, () => mockResponse(403, 'CSRF token validation failed', { 'x-csrf-token': 'Required' }));
    const result = await executePrivatePinnedTrace(f.client, closedTraceCalls[0], f.config, contextFor(f));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'PINNED_WRITE_REFUSED',
      state: 'parameters-rejected',
    });
    expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('does not replay a 5xx on the wire and reports it as uncertain', async () => {
    const f = fixture();
    route(f, () => mockResponse(503, 'busy'));
    const result = await executePrivatePinnedTrace(f.client, closedTraceCalls[0], f.config, contextFor(f));
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'parameters-unconfirmed',
    });
    expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('changes ST05 through the private entry with exact-user readback', async () => {
    const f = fixture();
    let current = stateXml;
    route(f, (method, path, body) => {
      if (path !== ST05) return undefined;
      if (method === 'PUT') current = body as string;
      return mockResponse(200, method === 'GET' ? current : '', { 'content-type': ST05_TYPE });
    });
    const result = await executePrivatePinnedTrace(f.client, closedTraceCalls[2], f.config, contextFor(f));
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      state: 'updated',
      scope: { clientIsolated: false },
    });
    expect(current).toContain('<ts:traceUser>MARIAN</ts:traceUser>');
  });

  it('runs tile mutations and lists through the private entry with a typed recording acknowledgement', async () => {
    const f = fixture();
    const entity = {
      id: 'X-SAP-UI2-CATALOGPAGE:ZARC1_CAT',
      domainId: 'ZARC1_CAT',
      title: 'Catalog',
      type: 'CATALOG_PAGE',
      scope: 'CUSTOMIZING',
      isReadOnly: false,
      chipCount: '0000',
    };
    const tile = {
      pageId: entity.id,
      instanceId: 'I',
      chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
      title: 'T',
      configuration: JSON.stringify({
        tileConfiguration: JSON.stringify({
          id: 'T',
          display_title_text: 'T',
          semantic_object: 'S',
          semantic_action: 'display',
        }),
      }),
    };
    let exists = false;
    route(f, (method, path) => {
      if (method === 'GET' && path.startsWith(`${FLP}/Catalogs(`))
        return mockResponse(200, JSON.stringify({ d: entity }));
      if (method === 'POST' && path === `${FLP}/PageChipInstances`) {
        exists = true;
        return mockResponse(201, JSON.stringify({ d: tile }));
      }
      if (method === 'GET' && path.endsWith('/PageChipInstances'))
        return mockResponse(200, JSON.stringify({ d: { results: exists ? [tile] : [] } }));
      if (method === 'GET' && path === `${FLP}/Catalogs`)
        return mockResponse(200, JSON.stringify({ d: { results: [entity] } }));
      return undefined;
    });
    const created = await executePrivatePinnedFlp(
      f.client,
      closedFlpCalls[5],
      f.config,
      contextFor(f),
      'disposable-client-observation',
    );
    expect(JSON.parse(created.content[0].text)).toMatchObject({
      ok: true,
      state: 'created',
      recording: 'not-established',
      tile: { instanceId: 'I', pageId: entity.id },
    });
    expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const listed = await executePrivatePinnedFlp(
      f.client,
      closedFlpCalls[0],
      f.config,
      contextFor(f),
      'disposable-client-observation',
    );
    expect(listed.content[0].text).toContain('1 catalogs');
  });

  it.each(['catalog', 'group'])('runs the private %s create through the real HTTP client', async (kind) => {
    const f = fixture();
    const args = kind === 'catalog' ? closedFlpCalls[3] : closedFlpCalls[4];
    const entity =
      kind === 'catalog'
        ? {
            id: 'X-SAP-UI2-CATALOGPAGE:ZARC1_CAT',
            domainId: 'ZARC1_CAT',
            title: 'Catalog',
            type: 'CATALOG_PAGE',
            scope: 'CUSTOMIZING',
            isReadOnly: '',
          }
        : {
            id: 'ZARC1_GROUP',
            title: 'Group',
            catalogId: '/UI2/FLPD_CATALOG',
            layout: '',
            scope: 'CUSTOMIZING',
            isReadOnly: '',
            isCatalogPage: '',
          };
    const missing = readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
    let created = false;
    route(f, (method, path) => {
      const set = kind === 'catalog' ? 'Catalogs' : 'Pages';
      if (method === 'POST' && path === `${FLP}/${set}`) {
        created = true;
        return mockResponse(201, JSON.stringify({ d: entity }));
      }
      if (method === 'GET' && path.startsWith(`${FLP}/${set}(`))
        return created ? mockResponse(200, JSON.stringify({ d: entity })) : mockResponse(404, missing);
      return undefined;
    });
    const result = await executePrivatePinnedFlp(
      f.client,
      args,
      f.config,
      contextFor(f),
      'disposable-client-observation',
    );
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      state: 'created',
      priorExistence: 'unknown',
      recording: 'not-established',
    });
    expect(f.calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
  });

  it('does not refresh CSRF and replay a submitted private create after a403 challenge', async () => {
    const f = fixture();
    const missing = readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
    route(f, (method, path) => {
      if (method === 'GET' && path.startsWith(`${FLP}/Catalogs(`)) return mockResponse(404, missing);
      if (method === 'POST') return mockResponse(403, 'CSRF challenge', { 'x-csrf-token': 'required' });
      return undefined;
    });
    const result = await executePrivatePinnedFlp(
      f.client,
      closedFlpCalls[3],
      f.config,
      contextFor(f),
      'disposable-client-observation',
    );
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: false,
      state: 'create-unconfirmed',
      phase: 'write',
      priorExistence: 'unknown',
      statusCode: 403,
    });
    expect(f.calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(mockFetch.mock.calls.filter(([_url, init]) => init?.method === 'HEAD')).toHaveLength(1);
  });

  it.each([closedFlpCalls[3], closedFlpCalls[4]])(
    'refuses private creation %j when its native lookup is unavailable',
    async (input) => {
      const f = fixture();
      route(f, () => undefined);
      const result = await executePrivatePinnedFlp(
        f.client,
        input,
        f.config,
        contextFor(f),
        'disposable-client-observation',
      );
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: false,
        state: 'unchanged',
        phase: 'preflight',
        message: expect.stringContaining('No classic FLP change was submitted'),
      });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].method).toBe('GET');
    },
  );

  it.each([
    ['read-only global ceiling', { allowWrites: false }],
    ['non-strict PP', { ppStrict: false }],
    ['PP off', { ppEnabled: false }],
    ['missing target', { targetId: '' }],
    ['wrong target', { targetId: 'B4H/001' }],
    ['no destination write policy', { multiTargetWrite: undefined as never }],
    ['wrong-target write policy', { multiTargetWrite: { ...policy, target: 'B4H/001' } }],
    ['a denied exact action', { denyActions: ['SAPDiagnose.trace_start', 'SAPManage.flp_create_catalog'] }],
    ['a denied action glob', { denyActions: ['SAPDiagnose.trace_*', 'SAPManage.flp_*'] }],
  ] as const)('refuses %s before SAP I/O', async (_label, overrides) => {
    const f = fixture(overrides as never);
    route(f, () => undefined);
    await expect(executePrivatePinnedTrace(f.client, closedTraceCalls[0], f.config, contextFor(f))).rejects.toThrow(
      'unavailable',
    );
    await expect(
      executePrivatePinnedFlp(f.client, closedFlpCalls[3], f.config, contextFor(f), 'disposable-client-observation'),
    ).rejects.toThrow('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a read-only client ceiling, feature-off FLP and a foreign context', async () => {
    const readOnly = fixture();
    readOnly.client.safety.allowWrites = false;
    route(readOnly, () => undefined);
    await expect(
      executePrivatePinnedTrace(readOnly.client, closedTraceCalls[0], readOnly.config, contextFor(readOnly)),
    ).rejects.toThrow('unavailable');
    const off = fixture({ featureFlp: 'off' } as never);
    route(off, () => undefined);
    await expect(
      executePrivatePinnedFlp(
        off.client,
        closedFlpCalls[3],
        off.config,
        contextFor(off),
        'disposable-client-observation',
      ),
    ).rejects.toThrow('unavailable');
    const foreign = fixture();
    route(foreign, () => undefined);
    await expect(
      executePrivatePinnedTrace(foreign.client, closedTraceCalls[0], foreign.config, foreignContext()),
    ).rejects.toThrow('mutation context');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['SAPDiagnose', { action: 'trace_start' }],
    ['SAPDiagnose', { action: 'trace_start', traceUser: '*' }],
    ['SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', maxExecutions: 101 }],
    ['SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', expiresHours: 25 }],
    ['SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', target: 'B4H/001' }],
    ['SAPDiagnose', { action: 'trace_cancel', traceUser: 'MARIAN', id: '/sap/bc/adt/oo/classes/zcl_victim' }],
    ['SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: true }],
    ['SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: true, user: 'MAR*' }],
    ['SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: true, allUsers: true }],
    ['SAPDiagnose', { action: 'trace_requests', traceUser: 'MARIAN' }],
    ['SAPDiagnose', { action: 'apply_quickfix' }],
  ] as const)('refuses invalid or unlisted %s input %j', async (tool, args) => {
    const f = fixture();
    route(f, () => undefined);
    expect(tool).toBe('SAPDiagnose');
    await expect(executePrivatePinnedTrace(f.client, args, f.config, contextFor(f))).rejects.toThrow('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'flp_create_catalog', domainId: "Z')", title: 'x' },
    { action: 'flp_create_catalog', domainId: 'Z', title: 'x', transport: 'A4HK900001' },
    { action: 'flp_delete_catalog', catalogId: 'Z', package: '$TMP' },
    { action: 'create_package', name: 'Z', description: 'x' },
    { action: 'features' },
    {
      action: 'flp_create_tile',
      catalogId: 'Z',
      tile: { id: 'T', title: 'T', semanticObject: 'S', semanticAction: 'a', url: 'javascript:alert(1)' },
    },
  ])('refuses invalid or unlisted FLP input %j', async (args) => {
    const f = fixture();
    route(f, () => undefined);
    await expect(
      executePrivatePinnedFlp(f.client, args, f.config, contextFor(f), 'disposable-client-observation'),
    ).rejects.toThrow('unavailable');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('handler conventions', () => {
  it('uses the shared mutation facade and never reaches a raw transport for candidate writes', async () => {
    const f = fixture();
    const post = vi.spyOn(f.client.http, 'post').mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    await executePrivatePinnedTrace(f.client, closedTraceCalls[0], f.config, contextFor(f));
    expect(post.mock.calls[0][4]).toMatchObject({ noReplay: true, retryTransientErrors: false });
  });
});
