/** Real HTTP/MCP → selected-user probe → public pinned FLP adapter; only cloud/SAP I/O is synthetic. */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  identities: new Map<string, AuthInfo>(),
  destination: vi.fn(),
  proxy: false,
  pool: undefined as any,
}));
vi.mock('@arc-mcp/xsuaa-auth', async (original) => ({
  ...(await original<typeof import('@arc-mcp/xsuaa-auth')>()),
  createXsuaaTokenVerifier: () => async (token: string) => {
    const identity = boundary.identities.get(token);
    if (!identity) throw new Error('Unknown synthetic token');
    return identity;
  },
}));
vi.mock('@arc-mcp/xsuaa-auth/btp', async (original) => ({
  ...(await original<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  createConnectivityProxy: () =>
    boundary.proxy
      ? { protocol: 'http', host: 'proxy.invalid', port: 80, getProxyToken: async () => 'synthetic-proxy' }
      : undefined,
}));
vi.mock('../../../src/server/multi-target-destination-runtime.js', async (original) => ({
  ...(await original<typeof import('../../../src/server/multi-target-destination-runtime.js')>()),
  resolveRuntimeSubaccountPpDestination: boundary.destination,
}));
vi.mock('undici', async (original) => ({
  ...(await original<typeof import('undici')>()),
  Client: class {
    request(options: any) {
      const url = new URL(options.path);
      return boundary.pool.request({ ...options, path: url.pathname + url.search });
    }
    async close() {}
  },
}));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
const { parsePinnedBinding, pinnedBindingSelection } = await import('../../../src/adt/pinned-service-binding-owner.js');
const { AdtClient } = await import('../../../src/adt/client.js');
const { getCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { projectMultiTargetDestination } = await import('../../../src/server/destination-discovery.js');
const { DestinationRegistry } = await import('../../../src/server/destination-registry.js');
const { buildMultiTargetConfig, buildAggregateToolSurfaceConfig } = await import(
  '../../../src/server/multi-target-runtime.js'
);
const { createServer, probeClientFeatures } = await import('../../../src/server/server.js');
const { handleSAPManage } = await import('../../../src/handlers/manage.js');
const { startHttpServer } = await import('../../../src/server/http.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { pinnedPublicAuth } = await import('../../helpers/pinned-public-auth.js');

const origin = 'https://sap.invalid';
const flp = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';
const args = { action: 'flp_create_catalog', domainId: 'ZCAT', title: 'Catalog' };
const catalog = {
  id: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
  domainId: 'ZCAT',
  title: 'Catalog',
  type: 'CATALOG_PAGE',
  scope: 'CUSTOMIZING',
  isReadOnly: '',
};
const missing = readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
const components = (release = '758', cloud = false) =>
  `<feed><entry><id>SAP_BASIS</id><title>${release};SAPK;0001;Basis</title></entry>${cloud ? '<entry><id>SAP_CLOUD</id><title>1;CLOUD;0001;Cloud</title></entry>' : ''}</feed>`;
const syntax =
  '<abapsource:syntaxConfigurations xmlns:abapsource="http://www.sap.com/adt/abapsource"><abapsource:syntaxConfiguration><abapsource:language><abapsource:version>X</abapsource:version><atom:link xmlns:atom="http://www.w3.org/2005/Atom" etag="758" rel="http://www.sap.com/adt/relations/abapsource/parser"/></abapsource:language></abapsource:syntaxConfiguration></abapsource:syntaxConfigurations>';
const bindingXml = readFileSync(new URL('../../fixtures/xml/service-binding.xml', import.meta.url), 'utf8')
  .replaceAll('/DMO/UI_TRAVEL_D_D_O4', 'ZBIND')
  .replaceAll('/DMO/UI_TRAVEL_D_D', 'ZDEFINITION')
  .replaceAll('%2fdmo%2fui_travel_d_d', 'zdefinition')
  .replaceAll('/DMO/FLIGHT_DRAFT', '$TMP')
  .replaceAll('%2fdmo%2fflight_draft', '%24tmp')
  .replace('srvb:published="true"', 'srvb:published="false"');
const packageXml = readFileSync(new URL('../../fixtures/xml/package-local-root-native.xml', import.meta.url), 'utf8');
const profiles = [
  { name: 'FLP', tool: 'SAPManage', args, state: 'created', path: `${flp}/Catalogs` },
  {
    name: 'publication',
    tool: 'SAPActivate',
    args: {
      action: 'publish_srvb',
      name: 'ZBIND',
      version: '0001',
      service_type: 'odatav4',
      expectedMetadataHash: parsePinnedBinding(bindingXml, pinnedBindingSelection('ZBIND')).metadataHash,
    },
    state: 'complete',
    path: '/sap/bc/adt/businessservices/odatav4/publishjobs',
  },
  {
    name: 'package',
    tool: 'SAPManage',
    args: { action: 'create_package', name: '$NEW', description: 'Owned root', responsible: 'MARIAN' },
    state: 'created',
    path: '/sap/bc/adt/packages',
  },
];
const previous = getGlobalDispatcher();
let agent: InstanceType<typeof MockAgent>;
let sent: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }>;
let app: express.Express;
let componentReply = { status: 200, body: components() };
let fallback = false;
let denyUser = '';
beforeEach(() => {
  resetCachedFeatures();
  boundary.identities.clear();
  boundary.destination.mockReset();
  boundary.proxy = false;
  componentReply = { status: 200, body: components() };
  fallback = false;
  denyUser = '';
  sent = [];
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  boundary.pool = agent.get(origin);
  vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  let exists = false;
  let packageExists = false;
  let published = false;
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((options) => {
        const headers = Object.fromEntries(
          Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
        );
        sent.push({ method, path: options.path, headers, body: options.body });
        const path = new URL(options.path, origin).pathname;
        if (denyUser && headers.authorization === `Bearer ${denyUser}`) return { statusCode: 403, data: 'denied' };
        if (method === 'GET' && path === '/sap/bc/adt/system/components')
          return { statusCode: componentReply.status, data: componentReply.body };
        if (method === 'GET' && path === '/sap/bc/adt/abapsource/syntax/configurations' && fallback)
          return { statusCode: 200, data: syntax };
        if (method === 'GET' && path === '/sap/bc/adt/discovery')
          return {
            statusCode: 200,
            data: '<app:service><app:workspace><app:collection href="/sap/bc/adt/oo/classes"/></app:workspace></app:service>',
          };
        if (method === 'HEAD' && (path.startsWith(flp) || path.startsWith('/sap/bc/adt/')))
          return { statusCode: 200, data: '', responseOptions: { headers: { 'x-csrf-token': 'TEST' } } };
        if (method === 'POST' && path === `${flp}/Catalogs`) {
          exists = true;
          return { statusCode: 201, data: JSON.stringify({ d: catalog }) };
        }
        if (method === 'GET' && path.startsWith(`${flp}/Catalogs(`))
          return { statusCode: exists ? 200 : 404, data: exists ? JSON.stringify({ d: catalog }) : missing };
        if (method === 'POST' && path === '/sap/bc/adt/businessservices/odatav4/publishjobs') {
          published = true;
          return {
            statusCode: 200,
            data: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Done</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>',
          };
        }
        if (method === 'GET' && path === '/sap/bc/adt/businessservices/bindings/ZBIND')
          return {
            statusCode: 200,
            data: bindingXml.replace('srvb:published="false"', `srvb:published="${published}"`),
          };
        if (method === 'POST' && path === '/sap/bc/adt/packages') {
          packageExists = true;
          return { statusCode: 201, data: '' };
        }
        if (method === 'GET' && path === '/sap/bc/adt/packages/%24NEW')
          return {
            statusCode: packageExists ? 200 : 404,
            data: packageExists
              ? packageXml
              : '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>',
          };
        if (method === 'GET') return { statusCode: 404, data: 'missing' };
        throw new Error(`Unexpected native mutation: ${method} ${path}`);
      })
      .persist();
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  setGlobalDispatcher(previous);
  await agent.close();
});
function identity(name = 'writer', scopes = ['read', 'write'], target = 'A4H/001') {
  const token = `header.${Buffer.from(JSON.stringify({ sub: name, user_name: name, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const auth = { ...pinnedPublicAuth(scopes, target), token, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  boundary.identities.set(token, auth);
  return token;
}
async function setup(
  options: {
    serverRequests?: string[];
    destinationRequests?: string[];
    allowWrites?: boolean;
    destinationWrites?: boolean;
  } = {},
) {
  const base = {
    ...DEFAULT_CONFIG,
    transport: 'http-streamable' as const,
    httpAddr: '127.0.0.1:0',
    xsuaaAuth: true,
    oauthDcrEnabled: false,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: options.allowWrites ?? true,
    allowedPackages: ['$TMP', '$NEW'],
    allowedTransports: options.serverRequests ?? ['*'],
    abapRelease: '758',
    authRateLimit: 0,
    mcpRateLimit: 0,
    rateLimit: 0,
  };
  const destinations = ['A4H', 'OTH'].map((sid) => ({
    Name: `TEST_${sid}`,
    Type: 'HTTP',
    URL: origin,
    Authentication: 'PrincipalPropagation',
    ProxyType: 'OnPremise',
    User: '',
    Password: '',
    'sap-client': '001',
    originalProperties: {
      Name: `TEST_${sid}`,
      Type: 'HTTP',
      URL: origin,
      Authentication: 'PrincipalPropagation',
      ProxyType: 'OnPremise',
      'sap-sysid': sid,
      'sap-client': '001',
      'arc1.enabled': 'true',
      'arc1.allow_writes': String(options.destinationWrites ?? true),
      'arc1.allowed_packages': '$TMP,$NEW',
      'arc1.allowed_transports': (options.destinationRequests ?? ['*']).join(','),
    },
  }));
  const registry = DestinationRegistry.fromDiscovery(
    {
      subaccount: destinations.map((d) => projectMultiTargetDestination(d)!),
      instanceNames: [],
      scannedCount: 2,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    base,
  );
  expect(registry.targets).toHaveLength(2);
  boundary.destination.mockImplementation(async (_btp, name, token) => ({
    destination: destinations.find((d) => d.Name === name),
    authTokens: { bearerToken: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub },
  }));
  const btpConfig = {} as BTPConfig;
  await startHttpServer(
    undefined,
    base,
    {
      url: 'https://tenant.authentication.example.test',
      clientid: 'test-client',
      clientsecret: 'synthetic-only-secret',
      xsappname: 'test!t1',
      uaadomain: 'authentication.example.test',
    },
    undefined,
    {
      registry,
      authorizationMode: 'xsuaa-attribute',
      createPinnedServer: (target, authorization) => {
        const config = buildMultiTargetConfig(base, target, { mode: 'pinned', authorization });
        expect(config.systemType).toBe('onprem');
        expect(config.abapRelease).toBeUndefined();
        return createServer(config, {
          btpConfig,
          multiTarget: { mode: 'pinned', registry, target, instanceConfig: base, authorization },
        });
      },
      aggregateFactory: (authorization) =>
        createServer(buildAggregateToolSurfaceConfig(base, registry.targets), {
          btpConfig,
          multiTarget: { mode: 'aggregate', registry, instanceConfig: base, authorization },
        }),
    },
  );
}
async function rpc(
  token: string,
  method = 'tools/call',
  route = '/A4H/001/mcp',
  parameters: Record<string, unknown> = { name: 'SAPManage', arguments: args },
) {
  const response = await request(app)
    .post(route)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params: parameters });
  expect(response.status).toBe(200);
  const payload =
    response.type === 'text/event-stream'
      ? JSON.parse(
          response.text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
        )
      : response.body;
  expect(payload.error).toBeUndefined();
  return payload.result;
}
const mutations = () => sent.filter((row) => ['POST', 'PUT', 'DELETE'].includes(row.method));
it.each([false, true])(
  'probes native platform through real pinned MCP and creates once; Connectivity=%s',
  async (proxy) => {
    boundary.proxy = proxy;
    await setup();
    const token = identity();
    await rpc(token, 'initialize', '/A4H/001/mcp', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'offline', version: '1' },
    });
    expect(sent).toHaveLength(0);
    await rpc(token, 'tools/list', '/A4H/001/mcp', {});
    expect(sent).toHaveLength(0);
    const result = await rpc(token);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      state: 'created',
      priorExistence: 'unknown',
      recording: 'native-governed-unverified',
      target: 'A4H/001',
    });
    expect(getCachedFeatures('A4H/001')).toMatchObject({
      abapRelease: '758',
      systemType: 'onprem',
      systemTypeSource: 'probe',
    });
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer writer', 'x-csrf-token': 'TEST' },
    });
    expect(mutations()[0].path).toContain('sap-client=001');
    expect(JSON.parse(String(mutations()[0].body))).toMatchObject({ domainId: 'ZCAT', title: 'Catalog' });
    expect(sent.filter((row) => row.path.startsWith('/sap/bc/adt/system/components'))).toHaveLength(1);
  },
);
it.each([
  ['denied', 403, 'denied'],
  ['malformed', 200, '<not-valid'],
  ['missing', 200, '<feed/>'],
  ['750', 200, components('750')],
  ['816', 200, components('816')],
  ['cloud', 200, components('758', true)],
] as const)('refuses native %s evidence despite configured758 and a syntax fallback', async (_label, status, body) => {
  componentReply = { status, body };
  fallback = true;
  await setup();
  for (const profile of profiles) {
    const result = await rpc(identity(), 'tools/call', '/A4H/001/mcp', { name: profile.tool, arguments: profile.args });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('native platform evidence');
    expect(mutations()).toHaveLength(0);
  }
});
it('does not use another target’s native evidence for a target with only syntax/configuration proof', async () => {
  await setup();
  expect((await rpc(identity())).isError).not.toBe(true);
  const count = mutations().length;
  componentReply = { status: 403, body: 'denied' };
  fallback = true;
  const result = await rpc(identity('other', ['read', 'write'], 'OTH/001'), 'tools/call', '/OTH/001/mcp');
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('native platform evidence');
  expect(mutations()).toHaveLength(count);
  expect(getCachedFeatures('OTH/001')?.systemTypeSource).toBeUndefined();
});
it('shares backend facts without borrowing another user’s native authorization', async () => {
  await setup();
  expect((await rpc(identity('first'))).isError).not.toBe(true);
  const count = mutations().length;
  denyUser = 'second';
  const result = await rpc(identity('second'));
  expect(result.isError).toBe(true);
  expect(mutations()).toHaveLength(count);
  expect(sent.at(-1)?.headers.authorization).toBe('Bearer second');
  expect(boundary.destination.mock.calls.at(-1)?.[2]).not.toBe(boundary.destination.mock.calls[0][2]);
});
it.each([
  'read-scope',
  'server-readonly',
  'destination-readonly',
  'server-requests',
  'destination-requests',
  'aggregate',
] as const)('preserves %s denial on the public route', async (mode) => {
  await setup(
    mode === 'server-readonly'
      ? { allowWrites: false }
      : mode === 'destination-readonly'
        ? { destinationWrites: false }
        : mode === 'server-requests'
          ? { serverRequests: ['A4HK900001'] }
          : mode === 'destination-requests'
            ? { destinationRequests: ['A4HK900001'] }
            : {},
  );
  const token = identity('limited', mode === 'read-scope' ? ['read'] : ['read', 'write']);
  const result = await rpc(token, 'tools/call', mode === 'aggregate' ? '/multi/mcp' : '/A4H/001/mcp', {
    name: 'SAPManage',
    arguments: { ...args, ...(mode === 'aggregate' ? { target: 'A4H/001' } : {}) },
  });
  expect(result.isError).toBe(true);
  expect(mutations()).toHaveLength(0);
});
it('retains an explicit single-target platform override', async () => {
  const client = new AdtClient({ baseUrl: origin, client: '001' });
  await probeClientFeatures({ ...DEFAULT_CONFIG, systemType: 'btp' }, client);
  expect(getCachedFeatures()).toMatchObject({ abapRelease: '758', systemType: 'btp', systemTypeSource: 'config' });
  expect(mutations()).toHaveLength(0);
  const manual = await handleSAPManage(client, { ...DEFAULT_CONFIG, systemType: 'btp' }, { action: 'probe' });
  expect(JSON.parse(manual.content[0].text)).toMatchObject({
    systemType: 'btp',
    systemTypeSource: 'config',
    abapRelease: '758',
  });
});

it('keeps native provenance through an explicit selected-target probe refresh', async () => {
  await setup();
  const token = identity();
  const result = await rpc(token, 'tools/call', '/A4H/001/mcp', { name: 'SAPManage', arguments: { action: 'probe' } });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    abapRelease: '758',
    systemType: 'onprem',
    systemTypeSource: 'probe',
  });
  expect(getCachedFeatures('A4H/001')).toMatchObject({ systemTypeSource: 'probe' });
  expect(mutations()).toHaveLength(0);
});
it('retries a later user after an authorization-limited probe without caching that denial', async () => {
  await setup();
  denyUser = 'denied';
  expect((await rpc(identity('denied'))).isError).toBe(true);
  expect(getCachedFeatures('A4H/001')?.authProbe).toBeUndefined();
  expect(getCachedFeatures('A4H/001')?.abapRelease).toBeUndefined();
  expect((await rpc(identity('allowed'))).isError).not.toBe(true);
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].headers.authorization).toBe('Bearer allowed');
});

it.each(
  profiles.flatMap((profile) =>
    [false, true].flatMap((proxy) => [false, true].map((manual) => ({ profile, proxy, manual }))),
  ),
)(
  'passes validated native facts to $profile.name without changing runtime config (proxy=$proxy, refresh=$manual)',
  async ({ profile, proxy, manual }) => {
    boundary.proxy = proxy;
    await setup();
    const token = identity();
    if (manual)
      expect(
        (await rpc(token, 'tools/call', '/A4H/001/mcp', { name: 'SAPManage', arguments: { action: 'probe' } })).isError,
      ).not.toBe(true);
    const result = await rpc(token, 'tools/call', '/A4H/001/mcp', { name: profile.tool, arguments: profile.args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      state: profile.state,
      recording: 'native-governed-unverified',
      target: 'A4H/001',
    });
    expect(mutations()).toHaveLength(1);
    expect(new URL(mutations()[0].path, origin).pathname).toBe(profile.path);
    expect(mutations()[0].headers.authorization).toBe('Bearer writer');
    expect(mutations()[0].headers['x-csrf-token']).toBe('TEST');
  },
);

it.each(profiles)('does not accept caller-supplied native coverage for $name', async (profile) => {
  await setup();
  const result = await rpc(identity(), 'tools/call', '/A4H/001/mcp', {
    name: profile.tool,
    arguments: { ...profile.args, coverage: { systemType: 'onprem', abapRelease: '758' } },
  });
  expect(result.isError).toBe(true);
  expect(mutations()).toHaveLength(0);
});
it.each(profiles)('does not borrow another target write grant for $name', async (profile) => {
  await setup();
  const token = identity();
  const auth = boundary.identities.get(token)!;
  auth.extra!.xsuaaUserAttributes = { arc1_targets: ['A4H/001'], arc1_write_targets: ['OTH/001'] };
  const result = await rpc(token, 'tools/call', '/A4H/001/mcp', { name: profile.tool, arguments: profile.args });
  expect(result.isError).toBe(true);
  expect(mutations()).toHaveLength(0);
});
