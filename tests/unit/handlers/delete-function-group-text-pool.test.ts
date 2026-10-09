import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const lock =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H</LOCK_HANDLE></DATA></asx:values></asx:abap>';
const mutations = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));
const poolPath = (name: string) => `/sap/bc/adt/textelements/functiongroups/${encodeURIComponent(name.toLowerCase())}`;
function setup(name = 'ZTEST', poolUri: string | undefined = poolPath(name)) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/inactiveobjects'))
      return mockResponse(
        200,
        `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"><ioc:entry><ioc:object ioc:user="DEV"><ioc:ref xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/ztest"/></ioc:object></ioc:entry>${poolUri ? `<ioc:entry><ioc:object ioc:user="DEV"><ioc:ref xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="SAPL${name}" adtcore:type="PROG/PX" adtcore:uri="${poolUri}"/></ioc:object></ioc:entry>` : ''}</ioc:inactiveObjects>`,
      );
    // No pool metadata is needed; an unavailable metadata service must not break a source-only delete.
    if (String(url).includes('/textelements/functiongroups/')) return mockResponse(404, 'no metadata');
    expect(init?.method ?? 'GET').not.toBe('PUT');
    return mockResponse(200, String(url).includes('_action=LOCK') ? lock : '', { 'x-csrf-token': 'T' });
  });
}
const del = (client = createClient(), name = 'ZTEST', minimalErrors = false) =>
  handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', { action: 'delete', type: 'FUGR', name });

describe('function-group deletion with text drafts', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['ZTEST', '/ARC/FG'])('activates the feed pool entry before deleting %s', async (name) => {
    setup(name);
    const result = await del(createClient(), name);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Deleted FUGR ${name} and its inactive text pool`);
    const calls = mutations();
    expect(String(calls[0]?.[0])).toContain('/activation?');
    expect(String(calls[0]?.[0])).toContain('preauditRequested=false');
    expect(calls[0]?.[1]?.body).toContain(poolPath(name));
    expect(calls[0]?.[1]?.body).toContain(`SAPL${name}`);
    expect(String(calls[0]?.[1]?.body).match(/<adtcore:objectReference /g)).toHaveLength(1);
    expect(calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it('also matches a raw namespaced URI without decoding unrelated entries', async () => {
    setup('/ARC/FG', '/sap/bc/adt/textelements/functiongroups//arc/fg');
    expect((await del(createClient(), '/ARC/FG')).isError).toBeUndefined();
    expect(mutations()[0]?.[1]?.body).toContain('/functiongroups//arc/fg');
  });

  it.each([
    '',
    '/sap/bc/adt/textelements/programs/ztest',
    '/sap/bc/adt/textelements/functiongroups/other',
    '/malformed/%ZZ',
  ])('does not activate an absent or unrelated pool: %s', async (uri) => {
    setup('ZTEST', uri);
    expect((await del()).isError).toBeUndefined();
    expect(mutations().some(([url]) => String(url).includes('/activation'))).toBe(false);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it.each([true, false])('deletes a source-only draft with discovery loaded=%s', async (loaded) => {
    setup('ZTEST', '');
    const client = createClient();
    if (loaded) client.http.setDiscoveryMap(new Map([['/sap/bc/adt/functions/groups', []]]));
    expect((await del(client)).isError).toBeUndefined();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it.each([false, true])('stops on activation failure, including minimal errors=%s', async (minimalErrors) => {
    setup();
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/activation?') ? Promise.resolve(mockResponse(500, 'activation failed')) : sap(url, init),
    );
    const result = await del(createClient(), 'ZTEST', minimalErrors);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('FUGR ZTEST was not deleted');
    expect(mutations()).toHaveLength(1);
  });

  it.each([false, true])('reports activation if deletion subsequently fails, minimal=%s', async (minimalErrors) => {
    setup();
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve(mockResponse(423, 'delete failed')) : sap(url, init),
    );
    const result = await del(createClient(), 'ZTEST', minimalErrors);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Text-pool activation was requested');
    expect(result.content[0]?.text).toContain('function group');
  });

  it('enforces the write ceiling before activating or deleting', async () => {
    setup();
    const client = createClient();
    client.safety.allowWrites = false;
    expect((await del(client)).isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
});
