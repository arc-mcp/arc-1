import { beforeEach, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const uri = '/sap/bc/adt/ddic/drty/sources/ZDELETE';
const checkPath = '/sap/bc/adt/deletion/check';
const checkMime = 'application/vnd.sap.adt.deletion.check.request.v1+xml';
const allowed = `<del:checkResponse xmlns:del="http://www.sap.com/adt/deletion" xmlns:adtcore="http://www.sap.com/adt/core"><del:object adtcore:uri="${uri}" del:isDeletable="true"/></del:checkResponse>`;
const args = { action: 'delete', type: 'DRTY', name: 'ZDELETE' };
function backend(
  options: { check?: string; checkStatus?: number; readback?: number; advertised?: boolean; packageName?: string } = {},
) {
  let deleted = false;
  const sends: Array<{ method: string; url: URL; body: string; headers: Record<string, string> }> = [];
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method ?? 'GET';
    sends.push({ method, url, body: String(init?.body ?? ''), headers: init?.headers ?? {} });
    const response = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (url.pathname.endsWith('/discovery'))
      return response(
        200,
        `<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="/sap/bc/adt/ddic/drty/sources"><app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept></app:collection>${options.advertised === false ? '' : `<app:collection href="${checkPath}"><app:accept>${checkMime}</app:accept></app:collection>`}</app:workspace></app:service>`,
      );
    if (method === 'HEAD') return response(200);
    if (url.pathname === checkPath) return response(options.checkStatus ?? 200, options.check ?? allowed);
    if (url.searchParams.get('_action') === 'LOCK')
      return response(200, '<asx:abap><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR></asx:abap>');
    if (url.searchParams.get('_action') === 'UNLOCK') return response(200);
    if (method === 'DELETE') {
      deleted = true;
      return response(200);
    }
    if (method === 'GET' && url.pathname === uri) {
      if (deleted) return response(options.readback ?? 404, 'Private SAP detail');
      return response(
        200,
        `<blue:blueSource xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${options.packageName ?? '$TMP'}"/></blue:blueSource>`,
      );
    }
    return response(404);
  });
  return sends;
}
beforeEach(() => vi.resetAllMocks());
it('checks under the lock and confirms absence after DELETE and unlock', async () => {
  const sends = backend();
  const audit = vi.spyOn(logger, 'emitAudit');
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const flow = sends.filter((s) => s.url.pathname === uri || s.url.pathname === checkPath);
  expect(flow.map((s) => s.url.searchParams.get('_action') ?? s.method)).toEqual([
    'LOCK',
    'POST',
    'DELETE',
    'UNLOCK',
    'GET',
  ]);
  expect(flow[1]?.body).toContain('<del:lockHandle>L1</del:lockHandle>');
  expect(flow[1]?.headers['X-sap-adt-sessiontype']).toBe('stateful');
  expect(flow.at(-1)?.headers['Cache-Control']).toBe('no-cache');
  expect(flow.at(-1)?.headers.Accept).toBe('application/vnd.sap.adt.blues.v1+xml');
  expect(audit).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: 'http_request', level: 'warn', statusCode: 404 }),
  );
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'http_request', level: 'debug', statusCode: 404 }),
  );
});
it.each([
  { label: 'dependent object', check: allowed.replace('isDeletable="true"', 'isDeletable="false"') },
  { label: 'different object', check: allowed.replace('ZDELETE', 'ZOTHER') },
  { label: 'missing result', check: '<del:checkResponse/>' },
  { label: 'missing decision', check: allowed.replace('del:isDeletable="true"', '') },
  {
    label: 'duplicate results',
    check: allowed.replace(
      '</del:checkResponse>',
      `<del:object adtcore:uri="${uri}" del:isDeletable="false"/></del:checkResponse>`,
    ),
  },
  { label: 'HTTP refusal', checkStatus: 403 },
])('refuses $label before DELETE and unlocks', async (options) => {
  const sends = backend(options);
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(sends.some((s) => s.method === 'DELETE')).toBe(false);
  expect(sends.some((s) => s.url.searchParams.get('_action') === 'UNLOCK')).toBe(true);
});
it.each([200, 403, 500])(
  'reports readback %s honestly and invalidates caches without another DELETE',
  async (readback) => {
    const sends = backend({ readback });
    const cache = new CachingLayer(new MemoryCache());
    const invalidate = vi.spyOn(cache, 'invalidate');
    const result = await handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, minimalErrors: true },
      'SAPWrite',
      args,
      undefined,
      undefined,
      cache,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(readback === 200 ? 'still exists' : 'could not be verified');
    expect(result.content[0]?.text).not.toContain('Private SAP detail');
    expect(sends.filter((s) => s.method === 'DELETE')).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith('DRTY', 'ZDELETE', 'all');
  },
);
it('still confirms deletion when the precheck is not advertised', async () => {
  const sends = backend({ advertised: false });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
  expect(result.isError).toBeUndefined();
  expect(sends.some((s) => s.url.pathname === checkPath)).toBe(false);
  expect(sends.at(-1)?.method).toBe('GET');
});
it('preserves the outcome and audit if cache cleanup fails', async () => {
  backend({ readback: 200 });
  const cache = new CachingLayer(new MemoryCache());
  vi.spyOn(cache, 'invalidate').mockImplementation(() => {
    throw Error('SQLITE_BUSY');
  });
  const audit = vi.spyOn(logger, 'emitAudit');
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args, undefined, undefined, cache);
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('still exists');
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'tool_call_end' }));
});
it.each(['read-only', 'package'])('keeps the %s gate before the deletion check', async (mode) => {
  const sends = backend({ packageName: 'ZFORBIDDEN' });
  const client = createClient();
  const safety =
    mode === 'read-only' ? { ...client.safety, allowWrites: false } : { ...client.safety, allowedPackages: ['$TMP'] };
  const result = await handleToolCall(client.withSafety(safety), DEFAULT_CONFIG, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(sends.some((s) => s.method === 'POST' || s.method === 'DELETE')).toBe(false);
});

it('refuses deletion when discovery cannot establish precheck availability', async () => {
  mockFetch.mockResolvedValue(mockResponse(200, '<unknown/>', { 'x-csrf-token': 'T' }));
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('availability could not be determined');
  expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});
