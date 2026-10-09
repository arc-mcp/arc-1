import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { featuresOff } = await import('./handler-test-config.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const config = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
const object = { type: 'TTYP', name: 'ZROWS', rowType: 'CHAR', rowTypeKind: 'builtin', rowTypeLength: 32 };
const single = { action: 'create', package: '$TMP', ...object };
const batch = { action: 'batch_create', package: '$TMP', objects: [object] };
const mutations = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));

describe('Cloud TTYP uses the existing write boundaries', () => {
  afterEach(resetCachedFeatures);
  beforeEach(() => {
    resetCachedFeatures();
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(
      mockResponse(200, '<object><packageRef name="ZOTHER"/></object>', { 'x-csrf-token': 'T' }),
    );
  });
  it.each([single, batch])('requires write scope before HTTP for $action', async (args) => {
    const result = await handleToolCall(createClient(), config, 'SAPWrite', args, {
      token: 'test',
      clientId: 'reader',
      scopes: ['read'],
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([single, batch])('honors action denial before HTTP for $action', async (args) => {
    const result = await handleToolCall(createClient(), { ...config, denyActions: ['SAPWrite.*'] }, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([single, batch])('honors the write ceiling for $action', async (args) => {
    const client = createClient();
    const result = await handleToolCall(
      client.withSafety({ ...client.safety, allowWrites: false }),
      config,
      'SAPWrite',
      args,
    );
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
  it.each([single, batch, { action: 'update', type: 'TTYP', name: 'ZROWS', package: '$TMP', rowTypeLength: 33 }])(
    'enforces the package allowlist before mutation for $action',
    async (args) => {
      const client = createClient();
      const result = await handleToolCall(
        client.withSafety({ ...client.safety, allowedPackages: ['ZALLOWED'] }),
        config,
        'SAPWrite',
        args,
      );
      expect(result.isError).toBe(true);
      expect(mutations()).toHaveLength(0);
    },
  );
  it.each([single, batch])('refuses a discovery map without TTYP for $action', async (args) => {
    const client = createClient();
    setCachedFeatures({
      ...featuresOff(),
      systemType: 'btp',
      discoveryMap: new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]),
    });
    const result = await handleToolCall(client, config, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
});
