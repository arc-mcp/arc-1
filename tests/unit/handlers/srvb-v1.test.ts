import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const v2 = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';
const v1 = 'application/vnd.sap.adt.businessservices.servicebinding.v1+xml';
const binding = '/sap/bc/adt/businessservices/bindings/ZSB_TEST';
let published = false;
let packageName = '$TMP';
let v1Status = 200;
const metadata = () => `<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
 xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_TEST" srvb:published="${published}">
 <adtcore:packageRef adtcore:name="${packageName}"/>
 <srvb:binding srvb:type="ODATA" srvb:version="V2"/>
</srvb:serviceBinding>`;
const client = () =>
  new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'test',
    password: 'test',
    safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
  });

describe('v1-only service-binding metadata (#991)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    published = false;
    packageName = '$TMP';
    v1Status = 200;
    mockFetch.mockImplementation(async (url, options) => {
      const path = new URL(String(url)).pathname;
      const method = options?.method ?? 'GET';
      const headers = options?.headers as Record<string, string>;
      if (method === 'GET' && path.toUpperCase() === binding.toUpperCase()) {
        return headers.Accept === v1
          ? mockResponse(v1Status, v1Status === 200 ? metadata() : 'Unavailable')
          : mockResponse(406, '<exception><message>The message content is not acceptable</message></exception>');
      }
      if (method === 'POST' && /\/(un)?publishjobs$/.test(path)) {
        published = !path.endsWith('/unpublishjobs');
        return mockResponse(
          200,
          '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Done</SHORT_TEXT></DATA></asx:values></asx:abap>',
        );
      }
      return mockResponse(200, '', { 'x-csrf-token': 'csrf-test' });
    });
  });

  it('reads binding metadata through v2 → v1 XML negotiation', async () => {
    const result = await client().getSrvb('ZSB_TEST');
    expect(JSON.parse(result.source)).toMatchObject({ name: 'ZSB_TEST', odataVersion: 'V2' });
    const reads = mockFetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === binding);
    expect(reads.map(([, options]) => (options?.headers as Record<string, string> | undefined)?.Accept)).toEqual([
      v2,
      v1,
    ]);
  });

  it.each(['publish_srvb', 'unpublish_srvb'])('%s resolves the package and reads back using v1', async (action) => {
    published = action === 'unpublish_srvb';
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPActivate', { action, name: 'ZSB_TEST' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(
      action === 'publish_srvb' ? 'Successfully published' : 'Successfully unpublished',
    );
    expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it.each([
    ['Z_DENIED', "Operations on package 'Z_DENIED' are blocked"],
    ['', "could not determine the object's package"],
  ])('refuses publication with package evidence %j', async (pkg, reason) => {
    packageName = pkg;
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPActivate', {
      action: 'publish_srvb',
      name: 'ZSB_TEST',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(reason);
    expect(mockFetch.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ Accept: v1 });
    expect(mockFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('propagates a failed v1 retry without publishing', async () => {
    v1Status = 403;
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPActivate', {
      action: 'publish_srvb',
      name: 'ZSB_TEST',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('403');
    expect(mockFetch.mock.calls).toHaveLength(2);
    expect(mockFetch.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ Accept: v1 });
    expect(mockFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('keeps the active-version query and extra headers on the v1 retry', async () => {
    const response = await client().http.get(`${binding}?version=active`, { Accept: v2, 'Cache-Control': 'no-cache' });
    expect(response.body).toContain('srvb:serviceBinding');
    const [, options] = mockFetch.mock.calls.at(-1)!;
    expect(options?.headers).toMatchObject({ Accept: v1, 'Cache-Control': 'no-cache' });
    expect(String(mockFetch.mock.calls.at(-1)?.[0])).toContain('version=active');
  });
});
