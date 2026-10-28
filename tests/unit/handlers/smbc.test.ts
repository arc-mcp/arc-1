import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const readOnlyClient = () => createClient().withSafety(defaultSafetyConfig());
const uri = '/sap/bc/adt/bct/smbctyp/%2Fns%2Fconfig';
const source = '{"formatVersion":"1","header":{"description":"Native configuration"}}';
beforeEach(() => vi.resetAllMocks());

function backend(returnedVersion = 'active', status = 200) {
  const requests: Array<{ url: URL; headers: Record<string, string> }> = [];
  mockFetch.mockImplementation(async (url, init) => {
    requests.push({ url: new URL(String(url)), headers: init.headers });
    const body = String(url).includes('/source/main')
      ? source
      : `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:version="${returnedVersion}"/>`;
    return mockResponse(status, body);
  });
  return requests;
}

it.each([undefined, 'auto', 'active', 'inactive'])('reads native SMBC JSON with version %s', async (version) => {
  const requests = backend(version === 'inactive' ? 'inactive' : 'active');
  const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'SMBC/TYP',
    name: '/NS/CONFIG',
    version,
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(result.content[0]?.text).toBe(source);
  const explicit = version === 'active' || version === 'inactive';
  expect(requests).toHaveLength(explicit ? 2 : 1);
  expect(requests.at(-1)?.url.pathname).toBe(`${uri}/source/main`);
  expect(requests.at(-1)?.headers.Accept).toBe('application/json');
  for (const request of requests) expect(request.url.searchParams.get('version')).toBe(explicit ? version : null);
});

it.each(['active', ''])('refuses unconfirmed inactive metadata (%s) before reading source', async (returnedVersion) => {
  const requests = backend(returnedVersion);
  const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'SMBC',
    name: '/NS/CONFIG',
    version: 'inactive',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/Cannot confirm inactive/);
  expect(requests.map((r) => r.url.pathname)).toEqual([uri]);
});

it.each([403, 404])('propagates native read failure %s', async (status) => {
  backend('active', status);
  const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'SMBC',
    name: '/NS/CONFIG',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain(String(status));
});

it.each(['check', 'history'])('routes read-only transport %s to the namespaced SMBC', async (action) => {
  const sends: Array<{ url: string; body: string }> = [];
  mockFetch.mockImplementation(async (url, init) => {
    sends.push({ url: String(url), body: String(init?.body ?? '') });
    return mockResponse(
      200,
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><DEVCLASS>$TMP</DEVCLASS><RESULT>S</RESULT><CORRNR>A4HK900123</CORRNR></DATA></asx:values></asx:abap>',
      { 'x-csrf-token': 'T' },
    );
  });
  const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPTransport', {
    action,
    type: 'SMBC/TYP',
    name: '/NS/CONFIG',
    package: '$TMP',
    operation: 'modify',
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(sends.some((r) => (action === 'check' ? r.body.includes(uri) : r.url.includes(`${uri}/transports`)))).toBe(
    true,
  );
});

const LOCK = (corrNr = '') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR>${corrNr}</CORRNR></DATA></asx:values></asx:abap>`;

// The 816 discovery advertises the SMBC collection with blues v1 and the deletion check without
// its request type (so the engine skips the check and relies on the post-delete absence read).
const DISCOVERY = `<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"><app:workspace>
<app:collection href="/sap/bc/adt/bct/smbctyp"><app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept></app:collection>
<app:collection href="/sap/bc/adt/deletion/check"><app:accept>application/xml</app:accept></app:collection>
</app:workspace></app:service>`;

/** Records every SAP send except discovery; answers lock, unlock, source PUT and DELETE. */
function writeBackend(opts: { corrNr?: string } = {}) {
  const sends: Array<{ method: string; path: string; body: string; contentType?: string }> = [];
  let deleted = false;
  mockFetch.mockImplementation(async (url, init) => {
    const parsed = new URL(String(url));
    const method = String(init?.method ?? 'GET');
    const path = `${parsed.pathname}${parsed.search}`;
    if (parsed.pathname.endsWith('/discovery')) return mockResponse(200, DISCOVERY, { 'x-csrf-token': 'T' });
    if (method !== 'HEAD') {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sends.push({ method, path, body: String(init?.body ?? ''), contentType: headers['Content-Type'] });
    }
    if (path.includes('_action=LOCK')) return mockResponse(200, LOCK(opts.corrNr), { 'x-csrf-token': 'T' });
    if (method === 'DELETE') deleted = true;
    if (method === 'GET' && deleted && parsed.pathname === uri) return mockResponse(404, 'Not Found');
    return mockResponse(200, '', { 'x-csrf-token': 'T' });
  });
  return sends;
}

it('updates the SMBC source under one lock with JSON content and the lock transport', async () => {
  const sends = writeBackend({ corrNr: 'A4HK900123' });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'update',
    type: 'SMBC/TYP',
    name: '/NS/CONFIG',
    source,
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(result.content[0]?.text).toContain('SAPActivate(type="SMBC"');
  const lock = sends.findIndex((r) => r.path.includes('_action=LOCK'));
  const put = sends.findIndex((r) => r.method === 'PUT');
  const unlock = sends.findIndex((r) => r.path.includes('_action=UNLOCK'));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(lock).toBeLessThan(put);
  expect(put).toBeLessThan(unlock);
  expect(sends[lock]?.path).toMatch(new RegExp(`^${uri}\\?_action=LOCK`));
  expect(sends[put]?.path).toMatch(new RegExp(`^${uri}/source/main\\?lockHandle=LH1&corrNr=A4HK900123(&|$)`));
  expect(sends[put]?.contentType).toMatch(/^application\/json/);
  expect(sends[put]?.body).toBe(source);
});

it('refuses an update with invalid JSON before contacting SAP', async () => {
  const sends = writeBackend();
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'update',
    type: 'SMBC',
    name: '/NS/CONFIG',
    source: '{"formatVersion":',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('valid AFF JSON');
  expect(sends).toEqual([]);
});

it('refuses SMBC create and points to the generator', async () => {
  const sends = writeBackend();
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'SMBC',
    name: 'ZCONFIG',
    package: '$TMP',
    source,
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('generator');
  expect(sends).toEqual([]);
});

it('deletes the SMBC under a lock', async () => {
  const sends = writeBackend();
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'delete',
    type: 'SMBC',
    name: '/NS/CONFIG',
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const del = sends.find((r) => r.method === 'DELETE');
  expect(del?.path).toMatch(new RegExp(`^${uri}\\?lockHandle=LH1`));
});

it('keeps SMBC writes behind the write gate', async () => {
  const sends = writeBackend();
  const result = await handleToolCall(readOnlyClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'update',
    type: 'SMBC',
    name: '/NS/CONFIG',
    source,
  });
  expect(result.isError).toBe(true);
  expect(sends.some((r) => r.method === 'PUT')).toBe(false);
});
