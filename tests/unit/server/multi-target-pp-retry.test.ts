import type { BTPConfig, Destination } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveRuntimeSubaccountPpDestination = vi.fn();
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  createConnectivityProxy: vi.fn(() => undefined),
}));
vi.mock('../../../src/server/multi-target-destination-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/server/multi-target-destination-runtime.js')>()),
  resolveRuntimeSubaccountPpDestination,
}));

const { AdtClient } = await import('../../../src/adt/client.js');
const { AdtApiError } = await import('../../../src/adt/errors.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const featureProbeModule = await import('../../../src/adt/features.js');
const { featuresOff } = await import('../handlers/handler-test-config.js');
const { getCachedFeatures, resetCachedFeatures, setCachedFeatures } = await import(
  '../../../src/handlers/feature-cache.js'
);
const { canonicalDestinationUrl, opaqueDestinationValue } = await import(
  '../../../src/server/destination-discovery.js'
);
const { DestinationRegistry } = await import('../../../src/server/destination-registry.js');
const { RuntimeDestinationLevelError } = await import('../../../src/server/multi-target-destination-runtime.js');
const { buildAggregateToolSurfaceConfig } = await import('../../../src/server/multi-target-runtime.js');
const { createServer } = await import('../../../src/server/server.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { logger } = await import('../../../src/server/logger.js');
const { getCurrentContext } = await import('../../../src/server/context.js');

type RequestHandler = (
  request: Record<string, unknown>,
  extra: { authInfo?: AuthInfo; signal?: AbortSignal },
) => Promise<Record<string, any>>;

function requestHandler(server: Server): RequestHandler {
  const handlers = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(CallToolRequestSchema.shape.method.value);
  if (!handler) throw new Error('No tools/call handler registered');
  return handler;
}

const BTP_CONFIG: BTPConfig = {
  xsuaaUrl: 'https://xsuaa.example.test',
  xsuaaClientId: 'xsuaa-client',
  xsuaaSecret: 'xsuaa-secret',
  destinationUrl: 'https://destination.example.test',
  destinationClientId: 'destination-client',
  destinationSecret: 'destination-secret',
  destinationTokenUrl: 'https://destination.example.test/oauth/token',
  connectivityProxyHost: '',
  connectivityProxyPort: '',
  connectivityClientId: '',
  connectivitySecret: '',
  connectivityTokenUrl: '',
};

const DESTINATION: Destination = {
  Name: 'ARC1_A4H_100_PP',
  Type: 'HTTP',
  URL: 'http://a4h.internal:50000',
  Authentication: 'PrincipalPropagation',
  ProxyType: 'OnPremise',
  User: '',
  Password: '',
  'sap-client': '100',
  originalProperties: {
    Name: 'ARC1_A4H_100_PP',
    Type: 'HTTP',
    URL: 'http://a4h.internal:50000',
    Authentication: 'PrincipalPropagation',
    ProxyType: 'OnPremise',
    'sap-sysid': 'A4H',
    'sap-client': '100',
    Description: 'A4H development',
    'arc1.enabled': 'true',
    'arc1.allow_data_preview': 'false',
    'arc1.allow_free_sql': 'false',
  },
};

function registry() {
  const canonicalUrl = canonicalDestinationUrl(DESTINATION.URL) as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: DESTINATION.Name,
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(canonicalUrl),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H development',
          hasCloudConnectorLocationId: false,
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'false',
            'arc1.allow_free_sql': 'false',
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    DEFAULT_CONFIG,
  );
}

const READ_AUTH: AuthInfo = {
  token: 'header.payload.signature',
  clientId: 'retry-test-client',
  scopes: ['read'],
  extra: { userName: 'RETRY_TEST_USER' },
};

describe('multi-target principal-propagation retry', () => {
  beforeEach(() => {
    resolveRuntimeSubaccountPpDestination.mockReset();
    resetCachedFeatures();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCachedFeatures();
  });

  it('does not retain a failed lookup and retries successfully on the next call to the same server', async () => {
    const current = registry();
    const instanceConfig = DEFAULT_CONFIG;
    const aggregateConfig = buildAggregateToolSurfaceConfig(instanceConfig, current.targets);
    setCachedFeatures(featuresOff(), 'A4H/100');
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');
    resolveRuntimeSubaccountPpDestination
      .mockRejectedValueOnce(new Error('user mapping not available yet'))
      .mockResolvedValueOnce({
        destination: DESTINATION,
        authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
      });

    const server = createServer(aggregateConfig, {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const call = requestHandler(server);
    const request = {
      method: 'tools/call',
      params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A4H/100' } },
    };

    const first = await call(request, { authInfo: READ_AUTH });
    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'PP_SETUP_FAILED',
      target: 'A4H/100',
      retryable: true,
    });

    const second = await call(request, { authInfo: READ_AUTH });
    expect(second.isError).not.toBe(true);
    expect(second.content[0].text).toBe('{"sid":"A4H","client":"100"}');
    expect(resolveRuntimeSubaccountPpDestination).toHaveBeenCalledTimes(2);
    expect(resolveRuntimeSubaccountPpDestination).toHaveBeenNthCalledWith(
      2,
      BTP_CONFIG,
      DESTINATION.Name,
      READ_AUTH.token,
    );
  });

  it('reports an instance shadow introduced after startup as a non-retryable target change', async () => {
    const current = registry();
    const target = current.targets[0];
    const instanceConfig = DEFAULT_CONFIG;
    resolveRuntimeSubaccountPpDestination.mockRejectedValue(
      new RuntimeDestinationLevelError('INSTANCE_DESTINATION_SHADOW', target.destinationName),
    );
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });

    const result = await requestHandler(server)(
      {
        method: 'tools/call',
        params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: target.target } },
      },
      { authInfo: READ_AUTH },
    );

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'TARGET_CONFIG_CHANGED',
      target: 'A4H/100',
      retryable: false,
    });
  });

  it('retains successful backend evidence while leaving a PP authorization-limited feature unknown', async () => {
    const current = registry();
    const instanceConfig = DEFAULT_CONFIG;
    const aggregateConfig = buildAggregateToolSurfaceConfig(instanceConfig, current.targets);
    resolveRuntimeSubaccountPpDestination.mockResolvedValue({
      destination: DESTINATION,
      authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
    });
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');
    let featureProbes = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
        featureProbes += 1;
        throw new AdtApiError('Forbidden', 403, path, 'Authorization denied');
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/atomsvc+xml' },
        body: '<app:service xmlns:app="urn:test"><app:workspace/></app:service>',
      };
    });
    const server = createServer(aggregateConfig, {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const call = requestHandler(server);
    const request = {
      method: 'tools/call',
      params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A4H/100' } },
    };

    expect((await call(request, { authInfo: READ_AUTH })).isError).not.toBe(true);
    expect((await call(request, { authInfo: READ_AUTH })).isError).not.toBe(true);
    expect(featureProbes).toBe(1);
    expect(getCachedFeatures('A4H/100')?.hana).toBeUndefined();
    expect(getCachedFeatures('A4H/100')?.authProbe).toBeUndefined();
    expect(getCachedFeatures('A4H/100')?.rap?.available).toBe(true);
  });

  it.each(['authorization', 'network'])(
    'retries a full probe after only configuration survived a %s failure',
    async (failure) => {
      const current = registry();
      resolveRuntimeSubaccountPpDestination.mockResolvedValue({
        destination: DESTINATION,
        authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
      });
      vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');
      let recovered = false;
      let fullProbes = 0;
      vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
        if (path === '/sap/bc/adt/ddic/sysinfo/hanainfo') fullProbes++;
        if (!recovered)
          throw failure === 'authorization' ? new AdtApiError('Forbidden', 403, path) : new Error('offline');
        return { statusCode: 200, headers: {}, body: '<root/>' };
      });
      const instanceConfig = { ...DEFAULT_CONFIG, featureGcts: 'off' as const };
      const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
        btpConfig: BTP_CONFIG,
        multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
      });
      const call = requestHandler(server);
      const request = {
        method: 'tools/call',
        params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A4H/100' } },
      };
      await call(request, { authInfo: READ_AUTH });
      expect(getCachedFeatures('A4H/100')).toMatchObject({ systemType: 'onprem', gcts: { mode: 'off' } });
      expect(getCachedFeatures('A4H/100')?.rap).toBeUndefined();
      recovered = true;
      await call(request, { authInfo: { ...READ_AUTH, extra: { userName: 'AUTHORIZED_USER' } } });
      expect(fullProbes).toBe(2);
      expect(getCachedFeatures('A4H/100')?.rap?.available).toBe(true);
    },
  );

  it('still probes all features after a failed full probe followed by a successful source search', async () => {
    const current = registry();
    resolveRuntimeSubaccountPpDestination.mockResolvedValue({
      destination: DESTINATION,
      authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
    });
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue({ statusCode: 200, headers: {}, body: '<root/>' });
    vi.spyOn(AdtClient.prototype, 'searchSource').mockResolvedValue([]);
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');
    const fullProbe = vi.spyOn(featureProbeModule, 'probeFeatures').mockRejectedValueOnce(new Error('probe failed'));
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const call = requestHandler(server);
    await call(
      {
        method: 'tools/call',
        params: { name: 'SAPSearch', arguments: { searchType: 'source_code', query: 'test', target: 'A4H/100' } },
      },
      { authInfo: READ_AUTH },
    );
    expect(getCachedFeatures('A4H/100')?.textSearch?.available).toBe(true);
    await call(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A4H/100' } } },
      { authInfo: READ_AUTH },
    );
    expect(fullProbe).toHaveBeenCalledTimes(2);
    expect(getCachedFeatures('A4H/100')?.rap?.available).toBe(true);
  });

  it.each([
    ['gcts', '/sap/bc/cts_abapvcs/system', 404],
    ['ui5repo', '/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV', 200],
    ['abapGit', '/sap/bc/adt/abapgit/repos', 404],
  ] as const)(
    'retains %s evidence without treating denied ADT probes as complete',
    async (feature, endpoint, status) => {
      const current = registry();
      resolveRuntimeSubaccountPpDestination.mockResolvedValue({
        destination: DESTINATION,
        authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
      });
      vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');
      let authorized = false;
      let fullProbes = 0;
      vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
        if (path === '/sap/bc/adt/ddic/sysinfo/hanainfo') fullProbes++;
        if (path === endpoint && status === 404) throw new AdtApiError('Not found', 404, path);
        if (!authorized && path !== endpoint) throw new AdtApiError('Forbidden', 403, path);
        return { statusCode: 200, headers: {}, body: '<root/>' };
      });
      const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
        btpConfig: BTP_CONFIG,
        multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
      });
      const call = requestHandler(server);
      const request = {
        method: 'tools/call',
        params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A4H/100' } },
      };
      await call(request, { authInfo: READ_AUTH });
      expect(getCachedFeatures('A4H/100')?.[feature]?.available).toBe(status === 200);
      expect(getCachedFeatures('A4H/100')?.rap).toBeUndefined();
      authorized = true;
      await call(request, { authInfo: { ...READ_AUTH, extra: { userName: 'AUTHORIZED_USER' } } });
      expect(fullProbes).toBe(2);
      expect(getCachedFeatures('A4H/100')?.rap?.available).toBe(true);
    },
  );
});

describe('transport review through selected BTP identity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCachedFeatures();
    resolveRuntimeSubaccountPpDestination.mockReset();
  });
  it.each([
    { mode: 'aggregate', forbidden: false },
    { mode: 'pinned', forbidden: false },
    { mode: 'aggregate', forbidden: true },
  ] as const)(
    'keeps $mode review identity/bounds and sanitizes part failures ($forbidden)',
    async ({ mode, forbidden }) => {
      const audit = vi.spyOn(logger, 'emitAudit');
      const current = registry();
      const target = current.targets[0];
      setCachedFeatures(featuresOff(), target.target);
      resolveRuntimeSubaccountPpDestination.mockResolvedValue({
        destination: DESTINATION,
        authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
      });
      const signal = new AbortController().signal;
      const get = vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path, _headers, options) => {
        expect(getCurrentContext()).toMatchObject({ target: 'A4H/100', identity: 'per-user', user: 'RETRY_TEST_USER' });
        expect(options).toMatchObject({
          signal,
          deadline: expect.any(Number),
          responseBudget: expect.anything(),
          attemptBudget: expect.anything(),
        });
        if (forbidden && path.endsWith('/versions'))
          throw new AdtApiError('SECRET_CONNECTOR_BODY', 403, path, 'SECRET_SAP_BODY');
        let body: string;
        if (path.includes('/cts/transportrequests/'))
          body =
            '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:status="R" tm:owner="T" tm:type="K"><tm:task tm:number="A4HK900002" tm:status="R"><tm:abap_object_list><tm:abap_object tm:pgmid="LIMU" tm:type="REPS" tm:name="ZDEMO" tm:wbtype="PROG/P"/></tm:abap_object_list></tm:task></tm:request></tm:root>';
        else if (path.endsWith('/versions'))
          body =
            '<feed><entry><id>00002</id><updated>2026-10-17</updated><link rel="http://www.sap.com/adt/relations/transport/request" name="A4HK900001"/><content src="/sap/bc/adt/programs/programs/zdemo/source/main/versions/20261017/00002/content"/></entry><entry><id>00001</id><updated>2026-10-16</updated><content src="/sap/bc/adt/programs/programs/zdemo/source/main/versions/20261016/00001/content"/></entry></feed>';
        else if (path.includes('/00002/content')) body = 'WRITE 2.';
        else if (path.includes('/00001/content')) body = 'WRITE 1.';
        else throw new Error(`Unexpected review read: ${path}`);
        return { statusCode: 200, headers: {}, body };
      });
      const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
        btpConfig: BTP_CONFIG,
        multiTarget: {
          mode,
          registry: current,
          instanceConfig: DEFAULT_CONFIG,
          ...(mode === 'pinned' ? { target } : {}),
        },
      });
      try {
        const result = await requestHandler(server)(
          {
            method: 'tools/call',
            params: {
              name: 'SAPTransport',
              arguments: {
                action: 'diff',
                id: 'A4HK900001',
                limit: 1,
                ...(mode === 'aggregate' ? { target: target.target } : {}),
              },
            },
          },
          { authInfo: READ_AUTH, signal },
        );
        expect(result.isError).not.toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
          shown: 1,
          objects: [
            {
              parts: [
                forbidden
                  ? { baselineStatus: 'baseline-unavailable', note: expect.stringContaining('status 403') }
                  : { baselineStatus: 'prior-revision', added: 1, removed: 1 },
              ],
            },
          ],
        });
        expect(result.content[0].text).not.toContain('SECRET_');
        expect(get).toHaveBeenCalledTimes(forbidden ? 2 : 4);
        expect(audit).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'tool_call_end',
            tool: 'SAPTransport',
            target: 'A4H/100',
            identity: 'per-user',
          }),
        );
        expect(resolveRuntimeSubaccountPpDestination).toHaveBeenCalledWith(
          BTP_CONFIG,
          DESTINATION.Name,
          READ_AUTH.token,
        );
      } finally {
        await server.close();
      }
    },
  );
  it.each([
    { args: { action: 'diff' }, scopes: ['read'], deny: [], error: 'TARGET_REQUIRED' },
    { args: { target: 'A4H/100', action: 'diff' }, scopes: [], deny: [], error: 'INSUFFICIENT_SCOPE' },
    {
      args: { target: 'A4H/100', action: 'diff' },
      scopes: ['read'],
      deny: ['SAPTransport.diff'],
      error: 'MULTI_TARGET_OPERATION_FORBIDDEN',
    },
    { args: { target: 'MISSING/100', action: 'diff' }, scopes: ['read'], deny: [], error: 'UNKNOWN_TARGET' },
    {
      args: { target: 'A4H/100', action: 'release' },
      scopes: ['admin'],
      deny: [],
      error: 'MULTI_TARGET_OPERATION_FORBIDDEN',
    },
  ])('refuses $error before resolving SAP identity', async ({ args, scopes, deny, error }) => {
    const current = registry();
    const instanceConfig = { ...DEFAULT_CONFIG, denyActions: deny };
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    try {
      const result = await requestHandler(server)(
        { method: 'tools/call', params: { name: 'SAPTransport', arguments: { ...args, id: 'A4HK900001' } } },
        { authInfo: { ...READ_AUTH, scopes } },
      );
      expect(JSON.parse(result.content[0].text)).toMatchObject({ error });
      expect(resolveRuntimeSubaccountPpDestination).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});

describe('syntax batches through selected BTP identity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCachedFeatures();
    resolveRuntimeSubaccountPpDestination.mockReset();
  });
  it.each(['aggregate', 'pinned'] as const)('keeps %s identity, cancellation, read policy and audit', async (mode) => {
    const current = registry();
    const target = current.targets[0];
    setCachedFeatures(featuresOff(), target.target);
    resolveRuntimeSubaccountPpDestination.mockResolvedValue({
      destination: DESTINATION,
      authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
    });
    const audit = vi.spyOn(logger, 'emitAudit');
    const signal = new AbortController().signal;
    const post = vi
      .spyOn(AdtHttpClient.prototype, 'post')
      .mockImplementation(async (path, body, _contentType, _headers, options) => {
        expect(path).toBe('/sap/bc/adt/checkruns');
        expect(getCurrentContext()).toMatchObject({ target: 'A4H/100', identity: 'per-user', user: 'RETRY_TEST_USER' });
        expect(options).toMatchObject({ signal, deadline: expect.any(Number), responseBudget: expect.anything() });
        expect(body).toContain('ZCL_BATCH_A');
        expect(body).toContain('ZCL_BATCH_B');
        return {
          statusCode: 200,
          headers: {},
          body: '<checkRunReports><checkReport reporter="abapCheckRun" triggeringUri="/sap/bc/adt/oo/classes/ZCL_BATCH_A" status="processed"/><checkReport reporter="abapCheckRun" triggeringUri="/sap/bc/adt/oo/classes/ZCL_BATCH_B" status="processed"/></checkRunReports>',
        };
      });
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: {
        mode,
        registry: current,
        instanceConfig: DEFAULT_CONFIG,
        ...(mode === 'pinned' ? { target } : {}),
      },
    });
    try {
      const result = await requestHandler(server)(
        {
          method: 'tools/call',
          params: {
            name: 'SAPDiagnose',
            arguments: {
              action: 'syntax',
              objects: [
                { type: 'CLAS', name: 'ZCL_BATCH_A' },
                { type: 'CLAS', name: 'ZCL_BATCH_B' },
              ],
              ...(mode === 'aggregate' ? { target: target.target } : {}),
            },
          },
        },
        { authInfo: READ_AUTH, signal },
      );
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'passed', checkedObjectCount: 2 });
      expect(post).toHaveBeenCalledTimes(1);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tool_call_end',
          tool: 'SAPDiagnose',
          target: 'A4H/100',
          identity: 'per-user',
        }),
      );
      expect(resolveRuntimeSubaccountPpDestination).toHaveBeenCalledWith(BTP_CONFIG, DESTINATION.Name, READ_AUTH.token);
    } finally {
      await server.close();
    }
  });
});
