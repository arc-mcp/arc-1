import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { main } from '../../../src/cli.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const logNumber = '00000000000000000042';
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

async function call(
  applicationLog: Record<string, unknown>,
  hyperfocused: boolean,
  settings: Partial<ServerConfig> = {},
  failure?: AdtApiError,
) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    safety: {
      ...defaultSafetyConfig(),
      allowDataPreview: settings.allowDataPreview ?? true,
      blockedDataSources: settings.blockedDataSources ?? [],
    },
  });
  const get = vi.spyOn(client.http, 'get').mockRejectedValue(failure ?? new Error('Unexpected SAP I/O'));
  const authPreflight = vi.fn();
  const probeFeatures = vi.fn();
  const args = { action: 'application_log', applicationLog };
  const code = await main(
    [
      'call',
      hyperfocused ? 'SAP' : 'SAPQuery',
      '--json',
      JSON.stringify(hyperfocused ? { action: 'query', params: args } : args),
    ],
    {
      resolveConfiguration: () => ({
        config: {
          ...DEFAULT_CONFIG,
          url: 'https://sap.invalid',
          systemType: 'onprem',
          allowDataPreview: true,
          cacheMode: 'none',
          toolMode: hyperfocused ? 'hyperfocused' : 'standard',
          ...settings,
        },
        sources: {},
      }),
      createClient: () => client,
      createCache: async () => undefined,
      authPreflight,
      probeFeatures,
      flushLogger: async () => undefined,
    },
  );
  expect(code).toBe(1);
  expect(authPreflight).not.toHaveBeenCalled();
  expect(probeFeatures).not.toHaveBeenCalled();
  return get;
}

describe.each([false, true])('application-log CLI before SAP I/O (hyperfocused: %s)', (hyperfocused) => {
  it.each(
    [['e'], ['E', 'E'], [], [null], 'E', ['A', 'E', 'W', 'I', 'S', 'E'], ["E' or 1 eq 1"]].map((severities) => ({
      severities,
    })),
  )('rejects invalid severities $severities without bootstrap or native requests', async ({ severities }) => {
    expect(await call({ logNumber, severities }, hyperfocused)).not.toHaveBeenCalled();
  });
  it.each([
    { allowDataPreview: false },
    { denyActions: ['SAPQuery.application_log'] },
    { blockedDataSources: ['UNRELATED_TABLE'] },
    { systemType: 'btp' as const },
  ])('enforces %j before any SAP request', async (settings) => {
    expect(await call({ logNumber, severities: ['E'] }, hyperfocused, settings)).not.toHaveBeenCalled();
  });
  it.each([401, 403])('retains native authentication/authorization refusal %s', async (status) => {
    const get = await call(
      { logNumber, severities: ['E'] },
      hyperfocused,
      {},
      new AdtApiError('Native refusal', status, '/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/'),
    );
    expect(get).toHaveBeenCalledOnce();
  });
});
