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
const { featuresOff } = await import('../handlers/handler-test-config.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { canonicalDestinationUrl, opaqueDestinationValue } = await import(
  '../../../src/server/destination-discovery.js'
);
const { DestinationRegistry } = await import('../../../src/server/destination-registry.js');
const { RuntimeDestinationLevelError } = await import('../../../src/server/multi-target-destination-runtime.js');
const { buildAggregateToolSurfaceConfig } = await import('../../../src/server/multi-target-runtime.js');
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

  it('does not cache authorization-limited feature evidence across per-user PP calls', async () => {
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
    expect(featureProbes).toBe(2);
  });
});
