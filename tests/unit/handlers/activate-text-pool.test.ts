import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const pool = '/sap/bc/adt/textelements/programs/ZTEXT';
const isPoolUrl = (url: unknown) => new URL(String(url)).pathname.toLowerCase() === pool.toLowerCase();
const metadata = (pkg = '$TMP') =>
  `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="PROG/PX"><adtcore:packageRef adtcore:name="${pkg}"/></rept:textElement>`;
const activationCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/activation?'));

describe('SAPActivate program text pools (#940)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockImplementation((url) =>
      Promise.resolve(
        mockResponse(200, String(url).includes('/activation?') ? '' : metadata(), { 'x-csrf-token': 'T' }),
      ),
    );
  });

  it.each(['REPT', 'prog/px'])('routes %s to the pool and retains first-activation guidance', async (type) => {
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type, name: 'ZTEXT' });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain('Text-pool activation requested');
    expect(result.content[0]?.text).toContain('SAPActivate(type="PROG", name="ZTEXT")');
    expect(result.content[0]?.text).not.toContain('Successfully activated');
    expect(mockFetch.mock.calls.some(([url]) => isPoolUrl(url))).toBe(true);
    expect(activationCalls()).toHaveLength(1);
    expect(activationCalls()[0]?.[1].body).toContain(`adtcore:uri="${pool}"`);
    expect(activationCalls()[0]?.[1].body).not.toContain('/programs/programs/');
  });

  it('routes both spellings in a mixed batch and distinguishes requested from active', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
      preaudit: false,
      objects: [
        { type: 'REPT', name: 'ZTEXT' },
        { type: 'PROG/PX', name: 'ZSECOND' },
        { type: 'PROG', name: 'ZPROGRAM' },
      ],
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain('ZTEXT (REPT): requested');
    expect(result.content[0]?.text).toContain('ZSECOND (REPT): requested');
    expect(result.content[0]?.text).toContain('ZPROGRAM (PROG): active');
    expect(result.content[0]?.text).not.toContain('Successfully activated 3');
    expect(result.content[0]?.text).toContain('SAPActivate(type="PROG", name="ZSECOND")');
    expect(activationCalls()).toHaveLength(1);
    expect(String(activationCalls()[0]?.[0])).toContain('preauditRequested=false');
    expect(activationCalls()[0]?.[1].body).toContain(pool);
    expect(activationCalls()[0]?.[1].body).toContain('/textelements/programs/ZSECOND');
    expect(activationCalls()[0]?.[1].body).toContain('/programs/programs/ZPROGRAM');
  });

  it('encodes a namespaced pool name as one URL segment', async () => {
    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { type: 'REPT', name: '/NS/ZTEXT' });
    expect(activationCalls()[0]?.[1].body).toContain('/textelements/programs/%2FNS%2FZTEXT');
  });

  it.each(['single', 'batch'])('checks the pool package before %s activation', async (mode) => {
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    mockFetch.mockImplementation((url) =>
      Promise.resolve(mockResponse(200, metadata(isPoolUrl(url) ? 'ZDENIED' : '$TMP'), { 'x-csrf-token': 'T' })),
    );
    const target = { type: 'REPT', name: 'ZTEXT' };
    const args = mode === 'single' ? target : { objects: [{ type: 'PROG', name: 'ZALLOWED' }, target] };
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ZDENIED');
    expect(activationCalls()).toHaveLength(0);
  });

  it.each(['single', 'batch'])('fails closed with unresolved metadata in %s activation', async (mode) => {
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    mockFetch.mockResolvedValue(mockResponse(200, '<rept:textElement/>', { 'x-csrf-token': 'T' }));
    const target = { type: 'REPT', name: 'ZTEXT' };
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPActivate',
      mode === 'single' ? target : { objects: [target] },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('could not determine');
    expect(activationCalls()).toHaveLength(0);
  });

  it.each(['single', 'batch'])('refuses %s activation when discovery says the service is missing', async (mode) => {
    const client = createClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['application/xml']]]));
    const target = { type: 'PROG/PX', name: 'ZTEXT' };
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPActivate',
      mode === 'single' ? target : { objects: [target] },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available on this system');
    expect(activationCalls()).toHaveLength(0);
  });

  it.each(['write', 'deny'])('keeps the %s gate', async (gate) => {
    const client = createClient();
    if (gate === 'write') client.safety.allowWrites = false;
    const config = gate === 'deny' ? { ...DEFAULT_CONFIG, denyActions: ['SAPActivate'] } : DEFAULT_CONFIG;
    const result = await handleToolCall(client, config, 'SAPActivate', { type: 'REPT', name: 'ZTEXT' });
    expect(result.isError).toBe(true);
    expect(activationCalls()).toHaveLength(0);
  });

  it('preserves native activation failures', async () => {
    mockFetch.mockImplementation((url) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('/activation?')
            ? '<messages><msg severity="error"><shortText><txt>Text pool refused</txt></shortText></msg></messages>'
            : metadata(),
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { type: 'REPT', name: 'ZTEXT' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Text pool refused');
    expect(result.content[0]?.text).not.toContain('activation requested');
  });

  it('invalidates the inactive list without promoting the parent program draft', async () => {
    const cache = new CachingLayer(new MemoryCache());
    const promoted = vi.spyOn(cache, 'markActivated');
    const invalidated = vi.spyOn(cache, 'invalidate');
    const inactive = vi.spyOn(cache.inactiveLists, 'invalidate');
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPActivate',
      { type: 'REPT', name: 'ZTEXT' },
      undefined,
      undefined,
      cache,
    );
    expect(result.isError).not.toBe(true);
    expect(promoted.mock.calls.some(([type]) => type === 'PROG')).toBe(false);
    expect(invalidated).toHaveBeenCalledWith('REPT', 'ZTEXT', 'all');
    expect(inactive).toHaveBeenCalledWith('admin');
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/source/main'))).toBe(false);
  });
});
