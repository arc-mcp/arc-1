import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { main } from '../../../src/cli.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import type { StartupAuthPreflightResult } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const logNumber = '00000000000000000042';
const preflight: StartupAuthPreflightResult = {
  status: 'skipped',
  blocking: false,
  endpoint: '/sap/bc/adt/core/discovery',
  checkedAt: '2026-11-16T00:00:00Z',
  reason: 'offline test',
};
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

async function call(
  applicationLog: Record<string, unknown>,
  hyperfocused: boolean,
  settings: Partial<ServerConfig> = {},
  options: { failure?: AdtApiError; detected?: 'btp' | 'onprem' } = {},
) {
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    safety: {
      ...defaultSafetyConfig(),
      allowDataPreview: settings.allowDataPreview ?? true,
      blockedDataSources: settings.blockedDataSources ?? [],
    },
  });
  // Only the native log reader uses client.http.get here; preflight and feature probing are stubs.
  const get = vi.spyOn(client.http, 'get').mockRejectedValue(options.failure ?? new Error('Unexpected SAP I/O'));
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
      authPreflight: vi.fn(async () => preflight),
      probeFeatures: vi.fn(async () => {
        if (options.detected) setCachedFeatures({ systemType: options.detected });
        return {} as never;
      }),
      flushLogger: async () => undefined,
    },
  );
  expect(code).toBe(1);
  return { get, output: stderr.mock.calls.flat().join('\n') };
}

describe.each([false, true])('application-log CLI before native log access (hyperfocused: %s)', (hyperfocused) => {
  it.each(
    [['e'], ['E', 'E'], [], [null], 'E', ['A', 'E', 'W', 'I', 'S', 'E'], ["E' or 1 eq 1"]].map((severities) => ({
      severities,
    })),
  )('rejects invalid severities $severities without a native log request', async ({ severities }) => {
    expect((await call({ logNumber, severities }, hyperfocused)).get).not.toHaveBeenCalled();
  });
  it.each([
    { allowDataPreview: false },
    { denyActions: ['SAPQuery.application_log'] },
    { blockedDataSources: ['UNRELATED_TABLE'] },
    { systemType: 'btp' as const },
  ])('enforces %j before a native log request', async (settings) => {
    expect((await call({ logNumber, severities: ['E'] }, hyperfocused, settings)).get).not.toHaveBeenCalled();
  });
  it('refuses a detected BTP system (SAP_SYSTEM_TYPE=auto) before a native log request', async () => {
    // The BTP guard depends on the CLI feature probe; skipping it would send native GETs to BTP ABAP.
    const { get, output } = await call({ logNumber }, hyperfocused, { systemType: 'auto' }, { detected: 'btp' });
    expect(get).not.toHaveBeenCalled();
    expect(output).toContain('not qualified for BTP ABAP');
  });
  it.each([401, 403])('retains native authentication/authorization refusal %s', async (status) => {
    const failure = new AdtApiError('Native refusal', status, '/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/');
    const { get } = await call({ logNumber, severities: ['E'] }, hyperfocused, {}, { failure, detected: 'onprem' });
    expect(get).toHaveBeenCalledOnce();
  });
});
