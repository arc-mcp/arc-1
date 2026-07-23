import type { BTPConfig, Destination } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveRuntimeSubaccountDestination = vi.fn();
const resolveRuntimeSubaccountPpDestination = vi.fn();
const createConnectivityProxy = vi.fn(() => ({
  host: 'proxy.internal',
  port: 20003,
  protocol: 'http' as const,
  getProxyToken: async () => 'proxy-token',
}));
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  createConnectivityProxy,
}));
vi.mock('../../../src/server/multi-target-destination-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/server/multi-target-destination-runtime.js')>()),
  resolveRuntimeSubaccountDestination,
  resolveRuntimeSubaccountPpDestination,
}));

const { AdtClient } = await import('../../../src/adt/client.js');
const { AdtApiError } = await import('../../../src/adt/errors.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { featuresOff } = await import('../handlers/handler-test-config.js');
const { getCachedDiscovery, getCachedFeatures, resetCachedFeatures, setCachedDiscovery, setCachedFeatures } =
  await import('../../../src/handlers/feature-cache.js');
const { canonicalDestinationUrl, opaqueDestinationValue } = await import(
  '../../../src/server/destination-discovery.js'
);
const { DestinationRegistry } = await import('../../../src/server/destination-registry.js');
const { logger } = await import('../../../src/server/logger.js');
const { RuntimeDestinationLevelError } = await import('../../../src/server/multi-target-destination-runtime.js');
const { buildAggregateToolSurfaceConfig, buildMultiTargetConfig } = await import(
  '../../../src/server/multi-target-runtime.js'
);
const { prepareSharedBasicClient } = await import('../../../src/server/multi-target-basic-auth.js');
const { MultiTargetSharedAuthState } = await import('../../../src/server/multi-target-shared-auth-state.js');
const { createServer } = await import('../../../src/server/server.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');

type RequestHandler = (
  request: Record<string, unknown>,
  extra: { authInfo?: AuthInfo },
) => Promise<Record<string, any>>;

function requestHandler(server: Server): RequestHandler {
  const handlers = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(CallToolRequestSchema.shape.method.value);
  if (!handler) throw new Error('No tools/call handler registered');
  return handler;
}

function listToolsHandler(server: Server): RequestHandler {
  const handlers = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(ListToolsRequestSchema.shape.method.value);
  if (!handler) throw new Error('No tools/list handler registered');
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
  connectivityProxyHost: 'proxy.internal',
  connectivityProxyPort: '20003',
  connectivityClientId: 'connectivity-client',
  connectivitySecret: 'connectivity-secret',
  connectivityTokenUrl: 'https://connectivity.example.test/oauth/token',
};

const BASE_DESTINATION: Destination = {
  Name: 'ARC1_A4H_100_BASIC',
  Type: 'HTTP',
  URL: 'http://a4h.internal:50000',
  Authentication: 'BasicAuthentication',
  ProxyType: 'OnPremise',
  CloudConnectorLocationId: 'SCC_A4H',
  User: 'ARC1_READER',
  Password: 'GOOD_PASSWORD',
  'sap-client': '100',
  originalProperties: {
    Name: 'ARC1_A4H_100_BASIC',
    Type: 'HTTP',
    URL: 'http://a4h.internal:50000',
    Authentication: 'BasicAuthentication',
    ProxyType: 'OnPremise',
    CloudConnectorLocationId: 'SCC_A4H',
    Preemptive: 'true',
    'sap-sysid': 'A4H',
    'sap-client': '100',
    Description: 'A4H shared read target',
    'arc1.enabled': 'true',
    'arc1.allow_data_preview': 'false',
    'arc1.allow_free_sql': 'false',
  },
};

const PP_DESTINATION: Destination = {
  Name: 'ARC1_B7H_100_PP',
  Type: 'HTTP',
  URL: 'http://b7h.internal:50000',
  Authentication: 'PrincipalPropagation',
  ProxyType: 'OnPremise',
  User: '',
  Password: '',
  'sap-client': '100',
  originalProperties: {
    Name: 'ARC1_B7H_100_PP',
    Type: 'HTTP',
    URL: 'http://b7h.internal:50000',
    Authentication: 'PrincipalPropagation',
    ProxyType: 'OnPremise',
    'sap-sysid': 'B7H',
    'sap-client': '100',
    Description: 'B7H propagated-user target',
    'arc1.enabled': 'true',
    'arc1.allow_data_preview': 'false',
    'arc1.allow_free_sql': 'false',
  },
};

const INSTANCE_CONFIG = {
  ...DEFAULT_CONFIG,
  multiTargetEndpoints: true,
  multiTargetAllowBasicAuth: true,
};

function registry(policy = { data: false, sql: false }, instanceConfig = INSTANCE_CONFIG) {
  const canonicalUrl = canonicalDestinationUrl(BASE_DESTINATION.URL) as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: BASE_DESTINATION.Name,
          type: 'HTTP',
          urlState: 'valid' as const,
          urlFingerprint: opaqueDestinationValue(canonicalUrl),
          authentication: 'BasicAuthentication',
          proxyType: 'OnPremise',
          preemptive: 'true',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H shared read target',
          hasCloudConnectorLocationId: true,
          cloudConnectorLocationIdFingerprint: opaqueDestinationValue('SCC_A4H'),
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': String(policy.data),
            'arc1.allow_free_sql': String(policy.sql),
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    instanceConfig,
  );
}

function mixedRegistry() {
  const basicUrl = canonicalDestinationUrl(BASE_DESTINATION.URL) as string;
  const ppUrl = canonicalDestinationUrl(PP_DESTINATION.URL) as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: BASE_DESTINATION.Name,
          type: 'HTTP',
          urlState: 'valid' as const,
          urlFingerprint: opaqueDestinationValue(basicUrl),
          authentication: 'BasicAuthentication',
          proxyType: 'OnPremise',
          preemptive: 'true',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H shared read target',
          hasCloudConnectorLocationId: true,
          cloudConnectorLocationIdFingerprint: opaqueDestinationValue('SCC_A4H'),
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'false',
            'arc1.allow_free_sql': 'false',
          },
        },
        {
          name: PP_DESTINATION.Name,
          type: 'HTTP',
          urlState: 'valid' as const,
          urlFingerprint: opaqueDestinationValue(ppUrl),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'B7H',
          sapClient: '100',
          description: 'B7H propagated-user target',
          hasCloudConnectorLocationId: false,
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'false',
            'arc1.allow_free_sql': 'false',
          },
        },
      ],
      instanceNames: [],
      scannedCount: 2,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    INSTANCE_CONFIG,
  );
}

const READ_AUTH: AuthInfo = {
  token: 'header.payload.signature',
  clientId: 'basic-test-client',
  scopes: ['read'],
  extra: { userName: 'HUMAN_CALLER' },
};

const ADMIN_AUTH: AuthInfo = { ...READ_AUTH, scopes: ['admin'] };
const DISCOVERY_RESPONSE = {
  statusCode: 200,
  headers: { 'content-type': 'application/atomsvc+xml' },
  body: '<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="/sap/bc/adt/oo/classes"/></app:workspace></app:service>',
};

function toolRequest(mode: 'pinned' | 'aggregate') {
  return {
    method: 'tools/call',
    params: {
      name: 'SAPRead',
      arguments: { type: 'SYSTEM', ...(mode === 'aggregate' ? { target: 'A4H/100' } : {}) },
    },
  };
}

describe('multi-target shared Basic authentication', () => {
  beforeEach(() => {
    resolveRuntimeSubaccountDestination.mockReset();
    resolveRuntimeSubaccountPpDestination.mockReset();
    createConnectivityProxy.mockReset();
    createConnectivityProxy.mockReturnValue({
      host: 'proxy.internal',
      port: 20003,
      protocol: 'http',
      getProxyToken: async () => 'proxy-token',
    });
    resetCachedFeatures();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCachedFeatures();
  });

  it('shares one guard across fresh pinned and aggregate servers', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    setCachedFeatures(featuresOff(), target.target);
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H","client":"100"}');

    let releaseFirst!: () => void;
    const firstCanary = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path !== '/sap/bc/adt/core/discovery') return DISCOVERY_RESPONSE;
      canaries += 1;
      if (canaries === 1) await firstCanary;
      return DISCOVERY_RESPONSE;
    });

    const pinned = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const aggregate = createServer(buildAggregateToolSurfaceConfig(INSTANCE_CONFIG, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: INSTANCE_CONFIG, sharedAuthState },
    });

    const first = requestHandler(pinned)(toolRequest('pinned'), { authInfo: READ_AUTH });
    await vi.waitFor(() => expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledTimes(1));
    const second = requestHandler(aggregate)(toolRequest('aggregate'), { authInfo: READ_AUTH });
    await Promise.resolve();
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledTimes(1);

    releaseFirst();
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.isError !== true)).toBe(true);
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledTimes(2);
    expect(canaries).toBe(2);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('healthy');
  });

  it('builds a fresh Basic-only client with current credentials and no inherited user auth state', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);

    await sharedAuthState.runExclusive(target.target, async (lease) => {
      const prepared = await prepareSharedBasicClient({
        instanceConfig: INSTANCE_CONFIG,
        btpConfig: BTP_CONFIG,
        target,
        lease,
        buildClientConfig: () => ({
          cookies: { SECRET_COOKIE: 'must-not-survive' },
          cookieFile: '/tmp/must-not-survive',
          cookieString: 'SECRET_COOKIE=must-not-survive',
          bearerTokenProvider: async () => 'must-not-survive',
          sapConnectivityAuth: 'must-not-survive',
          ppProxyAuth: 'must-not-survive',
          samlAuthorization: 'must-not-survive',
        }),
      });
      const httpConfig = (
        prepared.client.http as unknown as {
          config: Record<string, unknown>;
        }
      ).config;

      expect(httpConfig).toMatchObject({
        baseUrl: canonicalDestinationUrl(BASE_DESTINATION.URL),
        username: BASE_DESTINATION.User,
        password: BASE_DESTINATION.Password,
        cookies: {},
        disableSaml: true,
        retryUnauthorized: false,
        btpProxy: expect.objectContaining({ host: 'proxy.internal', port: 20003 }),
      });
      expect(httpConfig.cookieFile).toBeUndefined();
      expect(httpConfig.cookieString).toBeUndefined();
      expect(httpConfig.bearerTokenProvider).toBeUndefined();
      expect(httpConfig.sapConnectivityAuth).toBeUndefined();
      expect(httpConfig.ppProxyAuth).toBeUndefined();
      expect(httpConfig.samlAuthorization).toBeUndefined();
      expect(createConnectivityProxy).toHaveBeenCalledWith(BTP_CONFIG, 'SCC_A4H', expect.anything());
    });
  });

  it('keeps mixed PP and Basic identities isolated without serializing PP behind the Basic guard', async () => {
    const current = mixedRegistry();
    const sharedAuthState = new MultiTargetSharedAuthState();
    setCachedFeatures(featuresOff(), 'A4H/100');
    setCachedFeatures(featuresOff(), 'B7H/100');
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    resolveRuntimeSubaccountPpDestination.mockResolvedValue({
      destination: PP_DESTINATION,
      authTokens: { sapConnectivityAuth: 'Bearer per-user-assertion' },
    });
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"ok":true}');

    let releaseBasic!: () => void;
    const basicBlocked = new Promise<void>((resolve) => {
      releaseBasic = resolve;
    });
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path === '/sap/bc/adt/core/discovery') await basicBlocked;
      return DISCOVERY_RESPONSE;
    });

    const server = createServer(buildAggregateToolSurfaceConfig(INSTANCE_CONFIG, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: INSTANCE_CONFIG, sharedAuthState },
    });
    const call = requestHandler(server);
    const basicCall = call(toolRequest('aggregate'), { authInfo: READ_AUTH });
    await vi.waitFor(() => expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce());

    const ppResult = await call(
      {
        method: 'tools/call',
        params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'B7H/100' } },
      },
      { authInfo: READ_AUTH },
    );

    expect(ppResult.isError).not.toBe(true);
    expect(resolveRuntimeSubaccountPpDestination).toHaveBeenCalledOnce();
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce();
    releaseBasic();
    expect((await basicCall).isError).not.toBe(true);
    expect(resolveRuntimeSubaccountPpDestination).toHaveBeenCalledWith(
      BTP_CONFIG,
      PP_DESTINATION.Name,
      READ_AUTH.token,
    );
  });

  it('rejects API-key provenance before resolving a shared Basic destination', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    const config = {
      ...INSTANCE_CONFIG,
      apiKeys: [{ key: 'basic-api-key', profile: 'viewer' }],
    };
    const audit = vi.spyOn(logger, 'emitAudit');
    const server = createServer(buildMultiTargetConfig(config, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: config, target, sharedAuthState },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), {
      authInfo: {
        token: 'basic-api-key',
        clientId: 'api-key:viewer',
        scopes: ['read'],
        extra: { userName: 'API_KEY_CALLER' },
      },
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'BASIC_XSUAA_REQUIRED',
      identity: 'shared',
      retryable: false,
    });
    expect(resolveRuntimeSubaccountDestination).not.toHaveBeenCalled();
    expect(resolveRuntimeSubaccountPpDestination).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'shared_auth_failed',
        errorCode: 'BASIC_XSUAA_REQUIRED',
        identity: 'shared',
      }),
    );
  });

  it('fails safely before destination lookup when Basic BTP runtime state is missing', async () => {
    const current = registry();
    const target = current.targets[0];
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'DESTINATION_AUTH_SETUP_FAILED',
      identity: 'shared',
      retryable: true,
    });
    expect(resolveRuntimeSubaccountDestination).not.toHaveBeenCalled();
    expect(resolveRuntimeSubaccountPpDestination).not.toHaveBeenCalled();
  });

  it('applies the XSUAA role, instance ceiling, and Basic target policy before destination lookup', async () => {
    const instanceConfig = {
      ...INSTANCE_CONFIG,
      allowDataPreview: true,
      allowFreeSQL: true,
    };
    const current = registry({ data: true, sql: true }, instanceConfig);
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: {
        mode: 'aggregate',
        registry: current,
        instanceConfig,
        sharedAuthState: new MultiTargetSharedAuthState(),
      },
    });
    const list = listToolsHandler(server);
    const names = async (scopes: string[]) => {
      const result = await list({ method: 'tools/list', params: {} }, { authInfo: { ...READ_AUTH, scopes } });
      return result.tools.map((tool: { name: string }) => tool.name);
    };

    expect(await names(['read'])).not.toContain('SAPQuery');
    expect(await names(['read', 'data'])).not.toContain('SAPQuery');
    expect(await names(['read', 'data', 'sql'])).toContain('SAPQuery');
    expect(await names(['admin'])).toContain('SAPQuery');
    for (const scopes of [['read'], ['read', 'data'], ['read', 'data', 'sql'], ['admin']]) {
      const listed = await names(scopes);
      expect(listed).toEqual(expect.arrayContaining(['SAPLint', 'SAPTransport']));
      expect(listed).not.toEqual(expect.arrayContaining(['SAPWrite', 'SAPActivate', 'SAPGit']));
    }

    const directWrite = await requestHandler(server)(
      {
        method: 'tools/call',
        params: { name: 'SAPWrite', arguments: { action: 'update', target: 'A4H/100' } },
      },
      { authInfo: ADMIN_AUTH },
    );
    expect(JSON.parse(directWrite.content[0].text)).toMatchObject({
      error: 'MULTI_TARGET_OPERATION_FORBIDDEN',
      target: 'A4H/100',
      identity: 'shared',
    });
    for (const [name, action] of [
      ['SAPLint', 'format'],
      ['SAPTransport', 'create'],
      ['SAPTransport', 'layers'],
    ]) {
      const directOmittedAction = await requestHandler(server)(
        {
          method: 'tools/call',
          params: { name, arguments: { action, target: 'A4H/100' } },
        },
        { authInfo: ADMIN_AUTH },
      );
      expect(JSON.parse(directOmittedAction.content[0].text)).toMatchObject({
        error: 'MULTI_TARGET_OPERATION_FORBIDDEN',
        target: 'A4H/100',
        identity: 'shared',
      });
    }
    expect(resolveRuntimeSubaccountDestination).not.toHaveBeenCalled();
  });

  it('returns SAP_TARGET_BUSY without contacting Destination Service for a full target queue', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    setCachedFeatures(featuresOff(), target.target);
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async () => {
      canaries += 1;
      if (canaries === 1) await firstBlocked;
      return DISCOVERY_RESPONSE;
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);
    const calls = Array.from({ length: 34 }, () => call(toolRequest('pinned'), { authInfo: READ_AUTH }));
    await vi.waitFor(() => expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce());

    const overflow = await calls[33];
    expect(JSON.parse(overflow.content[0].text)).toMatchObject({
      error: 'SAP_TARGET_BUSY',
      identity: 'shared',
      retryable: true,
    });
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce();

    releaseFirst();
    const completed = await Promise.all(calls.slice(0, 33));
    expect(completed.every((result) => result.isError !== true)).toBe(true);
  });

  it('times out a queued server call before any second destination or SAP request', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState({ acquisitionTimeoutMs: 10 });
    setCachedFeatures(featuresOff(), target.target);
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async () => {
      canaries += 1;
      if (canaries === 1) await firstBlocked;
      return DISCOVERY_RESPONSE;
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);
    const active = call(toolRequest('pinned'), { authInfo: READ_AUTH });
    await vi.waitFor(() => expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce());
    const queued = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(queued.content[0].text)).toMatchObject({ error: 'SAP_TARGET_BUSY', identity: 'shared' });
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledOnce();
    expect(canaries).toBe(1);
    releaseFirst();
    expect((await active).isError).not.toBe(true);
  });

  it('fails queued calls locally after the active call rejects the same credential generation', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    let releaseCanary!: () => void;
    const canaryBlocked = new Promise<void>((resolve) => {
      releaseCanary = resolve;
    });
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path !== '/sap/bc/adt/core/discovery') return DISCOVERY_RESPONSE;
      canaries += 1;
      await canaryBlocked;
      throw new AdtApiError('Unauthorized', 401, path, 'SECRET_SAP_BODY');
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);
    const first = call(toolRequest('pinned'), { authInfo: READ_AUTH });
    await vi.waitFor(() => expect(canaries).toBe(1));
    const second = call(toolRequest('pinned'), { authInfo: READ_AUTH });
    releaseCanary();

    const results = await Promise.all([first, second]);
    expect(results.map((result) => JSON.parse(result.content[0].text).error)).toEqual([
      'SAP_AUTHENTICATION_FAILED',
      'SAP_AUTHENTICATION_FAILED',
    ]);
    expect(canaries).toBe(1);
    expect(resolveRuntimeSubaccountDestination).toHaveBeenCalledTimes(2);
  });

  it('blocks a rejected credential generation and recovers after destination password rotation', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    setCachedFeatures(featuresOff(), target.target);
    let password = 'BAD_PASSWORD';
    resolveRuntimeSubaccountDestination.mockImplementation(async () => ({ ...BASE_DESTINATION, Password: password }));
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path !== '/sap/bc/adt/core/discovery') return DISCOVERY_RESPONSE;
      canaries += 1;
      if (password === 'BAD_PASSWORD') {
        throw new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'SECRET_SAP_BODY');
      }
      return DISCOVERY_RESPONSE;
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'SAP_AUTHENTICATION_FAILED',
      target: 'A4H/100',
      retryable: false,
    });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'SAP_AUTHENTICATION_FAILED' });
    expect(canaries).toBe(1);

    password = 'GOOD_PASSWORD';
    const recovered = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(recovered.isError).not.toBe(true);
    expect(canaries).toBe(2);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('healthy');
  });

  it('caches authorization-limited shared feature evidence and reprobes after credential rotation', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    let password = 'FIRST_PASSWORD';
    resolveRuntimeSubaccountDestination.mockImplementation(async () => ({ ...BASE_DESTINATION, Password: password }));
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    let featureProbes = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
        featureProbes += 1;
        throw new AdtApiError('Forbidden', 403, path, 'Authorization denied');
      }
      return DISCOVERY_RESPONSE;
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    expect((await call(toolRequest('pinned'), { authInfo: READ_AUTH })).isError).not.toBe(true);
    expect((await call(toolRequest('pinned'), { authInfo: READ_AUTH })).isError).not.toBe(true);
    expect(featureProbes).toBe(1);

    password = 'ROTATED_PASSWORD';
    expect((await call(toolRequest('pinned'), { authInfo: READ_AUTH })).isError).not.toBe(true);
    expect(featureProbes).toBe(2);
  });

  it('recovers from missing destination credentials on the next call without restart', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    let password = '';
    resolveRuntimeSubaccountDestination.mockImplementation(async () => ({ ...BASE_DESTINATION, Password: password }));
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue(DISCOVERY_RESPONSE);
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const missing = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(JSON.parse(missing.content[0].text)).toMatchObject({ error: 'BASIC_CREDENTIALS_MISSING' });
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('configuration_invalid');
    expect(AdtHttpClient.prototype.get).not.toHaveBeenCalled();

    password = 'GOOD_PASSWORD';
    const recovered = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(recovered.isError).not.toBe(true);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('healthy');
  });

  it.each([
    [
      'the empty prefixed AtomPub service returned by SAP_BASIS 758',
      '<?xml version="1.0"?><app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"/>',
      'application/atomsvc+xml; charset=utf-8',
    ],
    ['an empty default-namespace AtomPub service', '<service xmlns="http://www.w3.org/2007/app"/>', 'application/xml'],
    [
      'an empty AtomPub workspace',
      '<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace/></app:service>',
      'text/xml',
    ],
    [
      'an AtomPub extension child',
      '<app:service xmlns:app="http://www.w3.org/2007/app"><ext:metadata xmlns:ext="urn:extension"/></app:service>',
      '',
    ],
  ])('accepts %s as authenticated ADT core discovery', async (_label, body, contentType) => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue({
      statusCode: 200,
      headers: contentType ? { 'content-type': contentType } : {},
      body,
    });
    vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockResolvedValue('{"sid":"A4H"}');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(result.isError).not.toBe(true);
    expect(sharedAuthState.getHealth(target.target).status).toBe('healthy');
  });

  it.each([
    ['an empty body', '', { 'content-type': 'application/atomsvc+xml' }],
    ['JSON', '{"service":{"workspace":{}}}', { 'content-type': 'application/json' }],
    ['a non-login HTML fragment', '<h4>Gateway diagnostic</h4>', { 'content-type': 'text/html' }],
    [
      'malformed XML',
      '<app:service xmlns:app="urn:test"><app:workspace></app:service>',
      { 'content-type': 'application/atomsvc+xml' },
    ],
    ['a wrong XML root', '<root><service><workspace/></service></root>', { 'content-type': 'application/xml' }],
    [
      'a wrong service namespace',
      '<app:service xmlns:app="urn:not-atom-pub"/>',
      { 'content-type': 'application/atomsvc+xml' },
    ],
    [
      'a fake XML media type',
      '<app:service xmlns:app="http://www.w3.org/2007/app"/>',
      { 'content-type': 'application/notxml' },
    ],
  ])('rejects %s as temporary invalid ADT discovery evidence', async (_label, body, headers) => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue({ statusCode: 200, headers, body });
    const tool = vi.spyOn(AdtClient.prototype, 'getSystemInfo');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const call = requestHandler(server);
    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'SAP_TARGET_TEMPORARILY_UNAVAILABLE',
      identity: 'shared',
      retryable: true,
    });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'SAP_TARGET_TEMPORARILY_UNAVAILABLE' });
    expect(AdtHttpClient.prototype.get).toHaveBeenCalledTimes(2);
    expect(tool).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth(target.target).status).toBe('temporarily_unavailable');
  });

  it('does not poison target health after an action-specific 403', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue(DISCOVERY_RESPONSE);
    const authorizationBody =
      '<exc:exception><type id="ExceptionNotAuthorized"/>' +
      '<localizedMessage>No authorization for S_DEVELOP</localizedMessage></exc:exception>';
    vi.spyOn(AdtClient.prototype, 'getSystemInfo')
      .mockRejectedValueOnce(new AdtApiError('Forbidden', 403, '/sap/bc/adt/systeminformation', authorizationBody))
      .mockResolvedValueOnce('{"sid":"A4H"}');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const denied = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(JSON.parse(denied.content[0].text)).toMatchObject({ error: 'SAP_AUTHORIZATION_DENIED' });
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('healthy');

    const recovered = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    expect(recovered.isError).not.toBe(true);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('healthy');
  });

  it('blocks a credential generation only for a structured authorization 403 from the canary', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    const authorizationBody =
      '<exc:exception><type id="ExceptionNotAuthorized"/>' +
      '<localizedMessage>Not authorized for S_ADT_RES</localizedMessage></exc:exception>';
    const canary = vi
      .spyOn(AdtHttpClient.prototype, 'get')
      .mockRejectedValue(new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', authorizationBody));
    const tool = vi.spyOn(AdtClient.prototype, 'getSystemInfo');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'SAP_AUTHORIZATION_DENIED',
      retryable: false,
    });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'SAP_AUTHORIZATION_DENIED' });
    expect(canary).toHaveBeenCalledOnce();
    expect(tool).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('authorization_failed');
  });

  it('preserves the verified Cloud Connector denial code without poisoning the credential generation', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    const connectivityBody =
      'Access denied to system a4h.internal:50000. Ensure to expose the system correctly in your Cloud Connector.';
    const canary = vi
      .spyOn(AdtHttpClient.prototype, 'get')
      .mockRejectedValue(new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', connectivityBody));
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'CLOUD_CONNECTOR_ACCESS_DENIED',
      target: 'A4H/100',
      retryable: true,
    });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'CLOUD_CONNECTOR_ACCESS_DENIED' });
    expect(canary).toHaveBeenCalledTimes(2);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('temporarily_unavailable');
  });

  it.each([
    ['an inactive ICF page', '<html><title>Service cannot be reached</title><body>Inactive</body></html>'],
    ['an ambiguous response', 'Forbidden'],
  ])('keeps %s from a canary 403 temporary and retryable', async (_label, body) => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    const canary = vi
      .spyOn(AdtHttpClient.prototype, 'get')
      .mockRejectedValue(new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', body));
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'SAP_TARGET_TEMPORARILY_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'SAP_TARGET_TEMPORARILY_UNAVAILABLE' });
    expect(canary).toHaveBeenCalledTimes(2);
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('temporarily_unavailable');
  });

  it('overrides a handler success when the request-local client observed a swallowed backend 401', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    setCachedFeatures(featuresOff(), target.target);
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    let canaries = 0;
    vi.spyOn(AdtHttpClient.prototype, 'get').mockImplementation(async (path) => {
      if (path === '/sap/bc/adt/core/discovery') canaries += 1;
      return DISCOVERY_RESPONSE;
    });
    const tool = vi.spyOn(AdtClient.prototype, 'getSystemInfo').mockImplementation(async function (
      this: InstanceType<typeof AdtClient>,
    ) {
      const httpConfig = (
        this.http as unknown as {
          config: { onUnauthorized?: (context: { path: string; statusCode: 401 }) => void };
        }
      ).config;
      httpConfig.onUnauthorized?.({ path: '/sap/bc/adt/systeminformation', statusCode: 401 });
      return '{"sid":"A4H"}';
    });
    const audit = vi.spyOn(logger, 'emitAudit');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });
    const call = requestHandler(server);

    const first = await call(toolRequest('pinned'), { authInfo: READ_AUTH });
    const second = await call(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(first.content[0].text)).toMatchObject({
      error: 'SAP_AUTHENTICATION_FAILED',
      retryable: false,
    });
    expect(JSON.parse(second.content[0].text)).toMatchObject({ error: 'SAP_AUTHENTICATION_FAILED' });
    expect(canaries).toBe(1);
    expect(tool).toHaveBeenCalledOnce();
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('authentication_failed');
    expect(
      audit.mock.calls
        .map(([event]) => event)
        .filter((event) => event.event === 'tool_call_end')
        .map((event) => event.status),
    ).toEqual(['error']);
  });

  it('marks immutable destination drift as configuration invalid without contacting SAP', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue({
      ...BASE_DESTINATION,
      URL: 'http://changed.internal:50000',
    });
    const canary = vi.spyOn(AdtHttpClient.prototype, 'get');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const audit = vi.spyOn(logger, 'emitAudit');
    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'TARGET_CONFIG_CHANGED',
      target: 'A4H/100',
      identity: 'shared',
    });
    expect(canary).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('configuration_invalid');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'shared_auth_failed',
        errorCode: 'TARGET_CONFIG_CHANGED',
        target: 'A4H/100',
        identity: 'shared',
      }),
    );
  });

  it('rejects a Basic instance shadow introduced after startup', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockRejectedValue(
      new RuntimeDestinationLevelError('INSTANCE_DESTINATION_SHADOW', target.destinationName),
    );
    const canary = vi.spyOn(AdtHttpClient.prototype, 'get');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'TARGET_CONFIG_CHANGED',
      target: 'A4H/100',
      retryable: false,
    });
    expect(canary).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('configuration_invalid');
  });

  it('marks Cloud Connector proxy construction failures as retryable setup failures', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue(BASE_DESTINATION);
    createConnectivityProxy.mockImplementationOnce(() => {
      throw new Error('SENTINEL_PROXY_FAILURE_DETAIL');
    });
    const canary = vi.spyOn(AdtHttpClient.prototype, 'get');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });
    const serialized = JSON.stringify(result);

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'DESTINATION_AUTH_SETUP_FAILED',
      identity: 'shared',
      retryable: true,
    });
    expect(serialized).not.toContain('SENTINEL_PROXY_FAILURE_DETAIL');
    expect(canary).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth(target.target).status).toBe('temporarily_unavailable');
  });

  it('clears stale feature evidence when rotated credentials fail during client setup', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    await sharedAuthState.runExclusive(target.target, (lease) => {
      lease.bindCredentials('ARC1_READER', 'OLD_PASSWORD');
      lease.markHealthy();
    });
    setCachedFeatures(featuresOff(), target.target);
    setCachedDiscovery(new Map([['stale', ['application/xml']]]), target.target);
    resolveRuntimeSubaccountDestination.mockResolvedValue({ ...BASE_DESTINATION, Password: 'ROTATED_PASSWORD' });
    createConnectivityProxy.mockImplementationOnce(() => {
      throw new Error('proxy temporarily unavailable');
    });
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const failed = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(failed.content[0].text)).toMatchObject({ error: 'DESTINATION_AUTH_SETUP_FAILED' });
    expect(getCachedFeatures(target.target)).toBeUndefined();
    expect(getCachedDiscovery(target.target).size).toBe(0);
  });

  it.each([
    ['INVALID:USER', 'BASIC_CREDENTIALS_INVALID'],
    [' INVALID', 'BASIC_CREDENTIALS_INVALID'],
    ['INVALID ', 'BASIC_CREDENTIALS_INVALID'],
    ['   ', 'BASIC_CREDENTIALS_MISSING'],
  ])('rejects invalid Basic username %j before contacting SAP', async (username, errorCode) => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    resolveRuntimeSubaccountDestination.mockResolvedValue({ ...BASE_DESTINATION, User: username });
    const canary = vi.spyOn(AdtHttpClient.prototype, 'get');
    const server = createServer(buildMultiTargetConfig(INSTANCE_CONFIG, target), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: INSTANCE_CONFIG, target, sharedAuthState },
    });

    const result = await requestHandler(server)(toolRequest('pinned'), { authInfo: READ_AUTH });

    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: errorCode });
    expect(canary).not.toHaveBeenCalled();
    expect(sharedAuthState.getHealth('A4H/100').status).toBe('configuration_invalid');
  });

  it('shows passive shared-auth health only in the admin catalog', async () => {
    const current = registry();
    const target = current.targets[0];
    const sharedAuthState = new MultiTargetSharedAuthState();
    await sharedAuthState.runExclusive(target.target, (lease) => {
      lease.bindCredentials('SENTINEL_TECHNICAL_USER', 'SENTINEL_TECHNICAL_PASSWORD');
      lease.markHealthy();
    });
    const server = createServer(buildAggregateToolSurfaceConfig(INSTANCE_CONFIG, current.targets), {
      btpConfig: BTP_CONFIG,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: INSTANCE_CONFIG, sharedAuthState },
    });

    const result = await requestHandler(server)(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: ADMIN_AUTH },
    );
    const payload = JSON.parse(result.content[0].text);

    expect(payload.targets[0]).toMatchObject({ target: 'A4H/100', identity: 'shared' });
    expect(payload.targets[0]).not.toHaveProperty('runtimeAuth');
    expect(payload.admin.sharedAuthentication).toEqual({ targets: 1, statusCounts: { healthy: 1 } });
    expect(JSON.stringify(payload)).not.toContain('SENTINEL_TECHNICAL_USER');
    expect(JSON.stringify(payload)).not.toContain('SENTINEL_TECHNICAL_PASSWORD');
  });
});
