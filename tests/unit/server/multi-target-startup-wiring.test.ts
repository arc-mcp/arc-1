/** Exercise real startup orchestration, not only its exported authorization helpers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/server/logger.js';
import { createAndStartServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const boundary = vi.hoisted(() => ({
  list: vi.fn(),
  resolveSingle: vi.fn(),
  http: vi.fn(),
}));
vi.mock('@arc-mcp/xsuaa-auth/btp', async (original) => ({
  ...(await original<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  parseVCAPServices: () => ({
    destinationUrl: 'https://dest.invalid',
    destinationClientId: 'test',
    destinationSecret: 'fixture',
    connectivityProxyHost: 'proxy.invalid',
    connectivityClientId: 'test',
  }),
  listDestinationsAtLevel: boundary.list,
  resolveBTPDestination: boundary.resolveSingle,
}));
vi.mock('@sap/xsenv', () => ({
  getServices: () => ({
    uaa: {
      url: 'https://auth.invalid',
      clientid: 'fixture',
      clientsecret: 'fixture',
      xsappname: 'test',
      uaadomain: 'auth.invalid',
    },
  }),
}));
vi.mock('../../../src/server/http.js', () => ({ startHttpServer: boundary.http }));
vi.mock('../../../src/server/shutdown.js', () => ({ registerShutdownHandlers: vi.fn(), closeHttpServer: vi.fn() }));

const config = {
  ...DEFAULT_CONFIG,
  multiTargetEndpoints: true,
  transport: 'http-streamable' as const,
  xsuaaAuth: true,
  cacheMode: 'none' as const,
};

describe('target-authorization startup wiring', () => {
  beforeEach(() => {
    for (const key of ['SAP_BTP_DESTINATION', 'SAP_BTP_PP_DESTINATION', 'VCAP_SERVICES']) vi.stubEnv(key, '');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No live network allowed');
      }),
    );
    for (const method of ['info', 'warn', 'error', 'emitAudit'] as const)
      vi.spyOn(logger, method).mockImplementation(() => {});
    boundary.list.mockReset();
    boundary.resolveSingle.mockReset();
    boundary.http.mockReset();
    boundary.http.mockResolvedValue({});
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(['legacy', 'xsuaa-attribute'] as const)(
    'passes %s through discovery, registry and HTTP routing',
    async (multiTargetAuthorization) => {
      // Marker-missing candidates count only under the stricter enforced-mode bound.
      boundary.list.mockImplementation(async (_config, level) =>
        level === 'subaccount'
          ? Array.from({ length: 257 }, (_, i) => ({
              Name: `DEST_${i}`,
              originalProperties: { 'arc1.disabled': 'true' },
            }))
          : [],
      );
      const server = await createAndStartServer({ ...config, multiTargetAuthorization });
      try {
        expect(boundary.list).toHaveBeenCalledTimes(2);
        expect(boundary.resolveSingle).not.toHaveBeenCalled();
        expect(boundary.http).toHaveBeenCalledOnce();
        const [single, , , , routing] = boundary.http.mock.calls[0];
        expect(single).toBeUndefined();
        expect(routing.authorizationMode).toBe(multiTargetAuthorization);
        if (multiTargetAuthorization === 'xsuaa-attribute') {
          expect(routing.registry.failure?.code).toBe('TARGET_LIMIT_EXCEEDED');
          expect(routing.registry.arcRelatedAtLeast).toBe(257);
          expect(routing.registry.diagnostics).toEqual([]);
        } else {
          expect(routing.registry.available).toBe(true);
          expect(routing.registry.diagnostics).toHaveLength(257);
        }
      } finally {
        await server.close();
      }
    },
  );

  it.each(['SAP_BTP_DESTINATION', 'SAP_BTP_PP_DESTINATION'])('refuses %s before any destination API', async (name) => {
    vi.stubEnv(name, 'SINGLE_DESTINATION');
    await expect(createAndStartServer({ ...config, multiTargetAuthorization: 'xsuaa-attribute' })).rejects.toThrow(
      'multi-only',
    );
    expect(boundary.resolveSingle).not.toHaveBeenCalled();
    expect(boundary.list).not.toHaveBeenCalled();
    expect(boundary.http).not.toHaveBeenCalled();
  });
});
