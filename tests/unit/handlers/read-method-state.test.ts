import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const SOURCE = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
METHODS execute IMPORTING value TYPE string.
ENDCLASS.
CLASS zcl_demo IMPLEMENTATION.
METHOD execute.
  DATA(copy) = value.
ENDMETHOD.
ENDCLASS.`;
const args = { type: 'CLAS', name: 'ZCL_DEMO', method: 'execute', methodView: 'signature' };
const sourceResult = (source: string) => ({ source, statusCode: 200, notModified: false, etag: 'e1' });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
});

describe('signature reads through the source cache', () => {
  it('retains full source across signature/body/full reads and conditional 304 responses', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '<inactiveObjects/>'))
      .mockResolvedValueOnce(mockResponse(200, SOURCE, { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));
    const client = createClient();
    const memory = new MemoryCache();
    const layer = new CachingLayer(memory);
    const call = (options: Record<string, unknown>) =>
      handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', options, undefined, undefined, layer);
    const signature = await call(args);
    expect(signature.isError).toBeUndefined();
    expect(JSON.parse(signature.content[0]!.text!).signature).toBe('METHODS execute IMPORTING value TYPE string.');
    const body = await call({ ...args, methodView: undefined });
    expect(body.content[0]?.text).toBe('METHOD execute.\n  DATA(copy) = value.\nENDMETHOD.');
    const full = await call({ type: 'CLAS', name: 'ZCL_DEMO', extensions: 'none' });
    expect(full.content[0]?.text).toContain(SOURCE);
    expect(memory.getSource('CLAS', 'ZCL_DEMO')?.source).toBe(SOURCE);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('force_refresh replaces an old declaration instead of extracting cached text', async () => {
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
    const getClass = vi
      .spyOn(client, 'getClass')
      .mockResolvedValue(sourceResult(SOURCE.replace('TYPE string', 'TYPE i')));
    const memory = new MemoryCache();
    memory.putSource('CLAS', 'ZCL_DEMO', SOURCE, { version: 'active', etag: 'old' });
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPRead',
      { ...args, force_refresh: true },
      undefined,
      undefined,
      new CachingLayer(memory),
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text!).signature).toContain('TYPE i');
    expect(getClass).toHaveBeenCalledWith('ZCL_DEMO', undefined, { ifNoneMatch: undefined, version: 'active' });
  });

  it('separates active and inactive declarations while auto selects the draft', async () => {
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([
      { name: 'ZCL_DEMO', type: 'CLAS/OC', uri: '/sap/bc/adt/oo/classes/zcl_demo' },
    ]);
    vi.spyOn(client, 'getClass').mockImplementation(async (_name, _include, options) =>
      sourceResult(options?.version === 'inactive' ? SOURCE.replace('TYPE string', 'TYPE i') : SOURCE),
    );
    const memory = new MemoryCache();
    const layer = new CachingLayer(memory);
    for (const version of ['active', 'inactive', 'auto']) {
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { ...args, version },
        undefined,
        undefined,
        layer,
      );
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]!.text!).signature).toContain(version === 'active' ? 'TYPE string' : 'TYPE i');
    }
    expect(memory.getSource('CLAS', 'ZCL_DEMO', 'active')?.source).toContain('TYPE string');
    expect(memory.getSource('CLAS', 'ZCL_DEMO', 'inactive')?.source).toContain('TYPE i');
  });

  it('revalidates a cached signature with each per-user SAP client', async () => {
    const client = createClient();
    const getClass = vi
      .spyOn(client, 'getClass')
      .mockResolvedValue(sourceResult(SOURCE.replace('TYPE string', 'TYPE i')));
    const memory = new MemoryCache();
    memory.putSource('CLAS', 'ZCL_DEMO', SOURCE, { version: 'active', etag: 'another-user' });
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPRead',
      args,
      { token: 'test', clientId: 'test', scopes: ['read'], extra: { userName: 'alice' } },
      undefined,
      new CachingLayer(memory),
      true,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text!).signature).toContain('TYPE i');
    expect(getClass).toHaveBeenCalledWith('ZCL_DEMO', undefined, { ifNoneMatch: 'another-user', version: 'active' });
    expect(memory.getSource('CLAS', 'ZCL_DEMO')?.source).toContain('TYPE i');
    getClass.mockRejectedValueOnce(new AdtApiError('Not authorized', 403, ''));
    const denied = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPRead',
      args,
      { token: 'test', clientId: 'test', scopes: ['read'], extra: { userName: 'bob' } },
      undefined,
      new CachingLayer(memory),
      true,
    );
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).not.toContain('METHODS execute');
    expect(getClass).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404, 410])(
    'propagates a %i revalidation failure instead of returning a cached signature',
    async (status) => {
      const client = createClient();
      vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
      vi.spyOn(client, 'getClass').mockRejectedValue(new AdtApiError('Source unavailable', status, ''));
      const memory = new MemoryCache();
      memory.putSource('CLAS', 'ZCL_DEMO', SOURCE, { version: 'active', etag: 'old' });
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        args,
        undefined,
        undefined,
        new CachingLayer(memory),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('METHODS execute');
      if (status !== 403) expect(memory.getSource('CLAS', 'ZCL_DEMO')).toBeNull();
    },
  );

  it('enforces the read scope before retrieving a signature', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', args, {
      token: 'test',
      clientId: 'test',
      scopes: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Insufficient scope');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
