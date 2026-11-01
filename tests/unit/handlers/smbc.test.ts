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

it('does not add SMBC source mutation support', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'update',
    type: 'SMBC/TYP',
    name: '/NS/CONFIG',
    source,
  });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
