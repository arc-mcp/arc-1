import { describe, expect, it, vi } from 'vitest';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import {
  createAggregateMcpHandler,
  createPinnedTargetMcpHandler,
  MULTI_TARGET_SCOPES_SUPPORTED,
  multiTargetHealthStatus,
  resolveMcpHttpRateLimit,
} from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function registry() {
  const url = canonicalDestinationUrl('http://a4h.internal:50000') as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'ARC1_A4H_100_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(url),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H dev',
          hasCloudConnectorLocationId: false,
          arcProperties: { 'arc1.enabled': 'true' },
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

function mockRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

describe('multi-target HTTP helpers', () => {
  it('advertises only the scopes usable on read-only multi-target routes', () => {
    expect(MULTI_TARGET_SCOPES_SUPPORTED).toEqual(['read', 'data', 'sql', 'admin']);
    expect(MULTI_TARGET_SCOPES_SUPPORTED).not.toContain('write');
    expect(MULTI_TARGET_SCOPES_SUPPORTED).not.toContain('transports');
    expect(MULTI_TARGET_SCOPES_SUPPORTED).not.toContain('git');
  });

  it('preserves the derived MCP edge cap and supports an explicit override or disable', () => {
    expect(resolveMcpHttpRateLimit({ authRateLimit: 20 })).toBe(600);
    expect(resolveMcpHttpRateLimit({ authRateLimit: 40 })).toBe(1200);
    expect(resolveMcpHttpRateLimit({ authRateLimit: 0 })).toBe(600);
    expect(resolveMcpHttpRateLimit({ authRateLimit: 40, mcpHttpRateLimit: 1000 })).toBe(1000);
    expect(resolveMcpHttpRateLimit({ authRateLimit: 40, mcpHttpRateLimit: 0 })).toBe(0);
  });

  it('keeps valid empty or quarantined snapshots ready and reports registry-wide failure', () => {
    expect(multiTargetHealthStatus(registry())).toBe('ready');
    expect(
      multiTargetHealthStatus(
        DestinationRegistry.fromDiscovery(
          {
            subaccount: [],
            instanceNames: [],
            scannedCount: 0,
            unrelatedCount: 0,
            arcAdjacentWithoutMarkerCount: 0,
          },
          DEFAULT_CONFIG,
        ),
      ),
    ).toBe('ready');
    expect(
      multiTargetHealthStatus(
        DestinationRegistry.unavailable({ code: 'REGISTRY_DISCOVERY_ERROR', message: 'safe failure' }),
      ),
    ).toBe('error');
  });

  it('returns a generic 404 for a valid but absent target without enumerating membership', async () => {
    const pinnedFactory = vi.fn();
    const handler = createPinnedTargetMcpHandler({
      registry: registry(),
      aggregateFactory: vi.fn() as never,
      pinnedFactory,
    });
    const res = mockRes();
    await handler({ path: '/A4H/200/mcp', method: 'POST', body: {}, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(pinnedFactory).not.toHaveBeenCalled();
  });

  it('serves an accepted pinned target', async () => {
    const serverFactory = vi.fn(() => ({
      connect: vi.fn(async () => {
        throw new Error('sentinel: connect reached');
      }),
    }));
    const pinnedFactory = vi.fn(() => serverFactory as never);
    const handler = createPinnedTargetMcpHandler({
      registry: registry(),
      aggregateFactory: vi.fn() as never,
      pinnedFactory,
    });
    const res = mockRes();
    await handler({ path: '/A4H/100/mcp', method: 'POST', body: {}, headers: {} } as never, res as never);
    expect(pinnedFactory).toHaveBeenCalledWith(expect.objectContaining({ target: 'A4H/100' }));
    expect(res.statusCode).toBe(500);
  });

  it('keeps aggregate diagnostics reachable but returns 503 for pinned routes when discovery is unavailable', async () => {
    const unavailable = DestinationRegistry.unavailable({
      code: 'REGISTRY_DISCOVERY_ERROR',
      message: 'safe failure',
    });
    const aggregateFactory = vi.fn(() => ({
      connect: vi.fn(async () => {
        throw new Error('sentinel: aggregate diagnostics reached');
      }),
    }));
    const multi = {
      registry: unavailable,
      aggregateFactory: aggregateFactory as never,
      pinnedFactory: vi.fn() as never,
    };
    const pinnedRes = mockRes();
    await createPinnedTargetMcpHandler(multi)(
      { path: '/A4H/100/mcp', method: 'POST', body: {}, headers: {} } as never,
      pinnedRes as never,
    );
    expect(pinnedRes.statusCode).toBe(503);
    expect(pinnedRes.body).toEqual({ error: 'Multi-target registry unavailable' });

    const aggregateRes = mockRes();
    await createAggregateMcpHandler(multi)(
      { path: '/multi/mcp', method: 'POST', body: {}, headers: {} } as never,
      aggregateRes as never,
    );
    expect(aggregateFactory).toHaveBeenCalledOnce();
    expect(aggregateRes.statusCode).toBe(500);
  });
});
