import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { batchFailureMessage } from '../../../src/handlers/write/batch-results.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const root = '/sap/bc/adt/functions/groups/z_recovery/fmodules/z_recovery_fm';
const sensitive = 'SENSITIVE_SAP_DIAGNOSTIC';
const args = {
  action: 'create',
  type: 'FUNC',
  name: 'Z_RECOVERY_FM',
  group: 'Z_RECOVERY',
  processingType: 'rfc',
  source: 'FUNCTION Z_RECOVERY_FM.\nENDFUNCTION.',
  lintBeforeWrite: false,
};
type Failure = 'source' | 'unlock' | 'source-and-unlock' | 'timeout' | 'metadata' | 'verification';
function fixture(failure: Failure) {
  let metadata =
    '<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" fmodule:processingType="normal"/>';
  let sourceAttempted = false;
  const calls: Array<{ method: string; url: URL }> = [];
  mockFetch.mockImplementation(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const method = options?.method ?? 'GET';
    calls.push({ method, url });
    const ok = (body = '') => mockResponse(200, body, { 'x-csrf-token': 'T' });
    if (url.searchParams.get('_action') === 'LOCK')
      return ok(
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
      );
    if (url.searchParams.get('_action') === 'UNLOCK') {
      return sourceAttempted && (failure === 'unlock' || failure === 'source-and-unlock')
        ? mockResponse(400, 'UNLOCK_DIAGNOSTIC', { 'x-csrf-token': 'T' })
        : ok();
    }
    if (method === 'GET' && url.pathname.endsWith('/groups/z_recovery'))
      return ok(
        '<group:abapFunctionGroup xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></group:abapFunctionGroup>',
      );
    if (method === 'PUT' && url.pathname === root) {
      if (failure === 'metadata') return mockResponse(403, sensitive, { 'x-csrf-token': 'T' });
      if (failure !== 'verification') metadata = String(options.body);
      return ok();
    }
    if (method === 'GET' && url.pathname === root)
      return mockResponse(200, metadata, {
        'content-type': 'application/vnd.sap.adt.functions.fmodules.v3+xml',
        'x-csrf-token': 'T',
      });
    if (method === 'PUT' && url.pathname === `${root}/source/main`) {
      sourceAttempted = true;
      if (failure === 'timeout') throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
      if (failure === 'source' || failure === 'source-and-unlock')
        return mockResponse(400, sensitive, { 'x-csrf-token': 'T' });
    }
    return ok();
  });
  return calls;
}
describe('FUNC creation recovery after accepted POST', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    resetCachedFeatures();
  });
  for (const minimalErrors of [false, true]) {
    it.each<Failure>(['source', 'unlock', 'source-and-unlock', 'timeout', 'metadata', 'verification'])(
      `reports %s truthfully (minimal errors ${minimalErrors})`,
      async (failure) => {
        const calls = fixture(failure);
        const client = createClient();
        const cache = new CachingLayer(new MemoryCache());
        cache.cache.putSource('FUNC', 'Z_RECOVERY_FM', 'stale');
        vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
        await cache.inactiveLists.getOrFetch(client);
        const result = await handleToolCall(
          client,
          { ...DEFAULT_CONFIG, minimalErrors },
          'SAPWrite',
          args,
          undefined,
          undefined,
          cache,
        );
        const text = String(result.content[0]?.text);
        expect(result.isError).toBe(true);
        expect(text).toContain('was created');
        expect(text).toContain('unconfirmed');
        expect(text).toContain('do not repeat create');
        expect(text).toContain('name="Z_RECOVERY_FM"');
        expect(text).toContain('group="Z_RECOVERY"');
        expect(text).toContain('version="inactive"');
        if (failure === 'metadata' || failure === 'verification') expect(text).toContain('SAP GUI');
        else expect(text).toContain('action="update"');
        expect(text).not.toMatch(/source was not (written|saved)|normal function-module shell/);
        expect(
          calls.filter(
            (c) =>
              c.method === 'POST' &&
              c.url.pathname === root.replace(/\/[^/]+$/, '') &&
              !c.url.searchParams.has('_action'),
          ),
        ).toHaveLength(1);
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        expect(calls.some((c) => c.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
        expect(cache.cache.getSource('FUNC', 'Z_RECOVERY_FM')).toBeNull();
        expect(cache.inactiveLists.getCached('admin')).toBeNull();
        if (failure === 'source' || failure === 'source-and-unlock' || failure === 'metadata') {
          expect(text).toContain(`status ${failure === 'metadata' ? 403 : 400}`);
          if (minimalErrors) expect(text).not.toContain(sensitive);
          else expect(text).toContain(failure === 'source-and-unlock' ? 'UNLOCK_DIAGNOSTIC' : sensitive);
        }
        if (failure === 'timeout') expect(text).toContain('time limit');
        if (minimalErrors) expect(text).not.toContain('UNLOCK_DIAGNOSTIC');
        if (failure === 'verification') {
          if (minimalErrors) expect(text).not.toContain('retained processingType');
          else expect(text).toContain('retained processingType="normal"');
        }
      },
    );
  }
  it('preserves an existing remediation hint and the primary error if cache invalidation fails', async () => {
    fixture('source');
    const client = createClient();
    const cause = new AdtApiError(sensitive, 400, `${root}/source/main`);
    cause.extraHint = 'EXISTING_SAFE_HINT';
    vi.spyOn(client, 'getObjectMetadata').mockRejectedValue(cause);
    const cache = new CachingLayer(new MemoryCache());
    vi.spyOn(cache, 'invalidate').mockImplementation(() => {
      throw new Error('CACHE_FAILURE');
    });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', args, undefined, undefined, cache);
    expect(result.isError).toBe(true);
    const text = String(result.content[0]?.text);
    expect(text).toContain('EXISTING_SAFE_HINT');
    expect(text).toContain('was created');
    expect(text).toContain('status 400');
    expect(text).not.toContain('CACHE_FAILURE');
  });
  it('keeps the existing batch partial-result contract', async () => {
    fixture('source');
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'batch_create',
      objects: [{ ...args, action: undefined }],
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[1]?.text));
    expect(payload.batch.results[0]).toMatchObject({ creation: 'confirmed', write: 'unknown', failedPhase: 'write' });
  });
  it('does not describe a confirmed FUNC create as absent after a follow-up 404', async () => {
    fixture('source');
    const client = createClient();
    vi.spyOn(client, 'getObjectMetadata').mockRejectedValue(new AdtApiError(sensitive, 404, root));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    const message = result.content[0].text;
    expect(message).toContain('status 404');
    expect(message).toContain('was created');
    expect(message).not.toContain('was not found');
  });
  it('keeps the batch manifest when deferred activation cache invalidation fails', async () => {
    const calls = fixture('metadata');
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
    const cache = new CachingLayer(new MemoryCache());
    vi.spyOn(cache, 'invalidate').mockImplementation(() => {
      throw new Error('CACHE_FAILURE');
    });
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'batch_create',
        activateAtEnd: true,
        objects: [
          {
            ...args,
            action: undefined,
            name: 'Z_RECOVERY_OK',
            processingType: undefined,
            source: 'FUNCTION Z_RECOVERY_OK.\nENDFUNCTION.',
          },
          { ...args, action: undefined },
        ],
      },
      undefined,
      undefined,
      cache,
    );
    const entries = JSON.parse(String(result.content[1]?.text)).batch.results;
    expect(entries[0]).toMatchObject({ creation: 'confirmed', write: 'confirmed' });
    expect(entries[1]).toMatchObject({ creation: 'confirmed', write: 'unknown', failedPhase: 'write' });
    expect(entries[1].error).toContain('do not repeat create');
    expect(JSON.stringify(result)).not.toContain('CACHE_FAILURE');
    expect(calls.some((call) => call.method === 'POST' && call.url.pathname.endsWith('/activation'))).toBe(true);
  });
  it('keeps recovery guidance when a long SAP diagnostic is truncated', () => {
    const error = new AdtApiError(
      `<exc:exception><localizedMessage>${'LONG_SAP_DETAIL '.repeat(250)}</localizedMessage></exc:exception>`,
      403,
      root,
    );
    error.extraHint = 'The object exists; inspect it and do not repeat create.';
    const message = batchFailureMessage(error, false);
    expect(message).toContain('do not repeat create');
    expect(message).toContain('LONG_SAP_DETAIL');
    expect(message).toContain('[diagnostic truncated]');
  });
  for (const minimalErrors of [false, true]) {
    it.each<Failure>(['metadata', 'verification'])(
      `preserves batch metadata recovery for %s (minimal=${minimalErrors})`,
      async (failure) => {
        const calls = fixture(failure);
        const cache = new CachingLayer(new MemoryCache());
        vi.spyOn(cache, 'invalidate').mockImplementation(() => {
          throw new Error('CACHE_FAILURE');
        });
        const result = await handleToolCall(
          createClient(),
          { ...DEFAULT_CONFIG, minimalErrors },
          'SAPWrite',
          {
            action: 'batch_create',
            objects: [{ ...args, action: undefined }],
          },
          undefined,
          undefined,
          cache,
        );
        expect(result.isError).toBe(true);
        const payload = JSON.parse(String(result.content[1]?.text));
        const entry = payload.batch.results[0];
        expect(entry).toMatchObject({ creation: 'confirmed', write: 'unknown', failedPhase: 'write' });
        expect(entry.error).toContain('processing metadata step failed');
        expect(entry.error).toContain('includeSignature=true');
        expect(entry.error).toContain('Update cannot change processing attributes');
        expect(entry.error).toContain('Source writing has not started');
        expect(entry.error).toContain('SAP GUI');
        expect(entry.error).not.toContain('CACHE_FAILURE');
        expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/source/main'))).toBe(false);
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        if (failure === 'metadata') {
          expect(entry.error).toContain(minimalErrors ? 'HTTP 403' : 'status 403');
          if (minimalErrors) expect(entry.error).not.toContain(sensitive);
          else expect(entry.error).toContain(sensitive);
        } else if (minimalErrors) expect(entry.error).not.toContain('retained processingType');
      },
    );
  }
});
