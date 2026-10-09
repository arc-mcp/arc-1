import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const lock =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H</LOCK_HANDLE></DATA></asx:values></asx:abap>';
const metadata = (version: string, user = 'DEV') =>
  `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="FUGR/PX" adtcore:version="${version}" adtcore:changedBy="${user}"/>`;
const mutations = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));
function setup(pool: string, name = 'ZTEST', listed = true) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/inactiveobjects'))
      return mockResponse(
        200,
        `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">${listed ? `<ioc:entry><ioc:object ioc:user="DEV"><ioc:ref xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/ztest"/></ioc:object></ioc:entry>` : ''}</ioc:inactiveObjects>`,
      );
    if (String(url).includes('/textelements/functiongroups/')) return mockResponse(200, pool);
    return mockResponse(200, String(url).includes('_action=LOCK') ? lock : '', { 'x-csrf-token': 'T' });
  });
}
const del = (client = createClient(), name = 'ZTEST', minimalErrors = false) =>
  handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', { action: 'delete', type: 'FUGR', name });

describe('function-group deletion with text drafts', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['ZTEST', '/ARC/FG'])('activates only the inactive pool before deleting %s', async (name) => {
    setup(metadata('inactive'), name);
    const result = await del(createClient(), name);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Deleted FUGR ${name} and its inactive text pool`);
    const calls = mutations();
    expect(String(calls[0]?.[0])).toContain('/activation?');
    expect(String(calls[0]?.[0])).toContain('preauditRequested=false');
    expect(calls[0]?.[1]?.body).toContain(`/textelements/functiongroups/${encodeURIComponent(name)}`);
    expect(String(calls[0]?.[1]?.body).match(/<adtcore:objectReference /g)).toHaveLength(1);
    expect(calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('does not activate an active pool when only source is inactive', async () => {
    setup(metadata('active'));
    expect((await del()).isError).toBeUndefined();
    expect(mutations().some(([url]) => String(url).includes('/activation'))).toBe(false);
  });

  it('does not inspect the pool of an unlisted group', async () => {
    setup(metadata('inactive'), 'ZTEST', false);
    expect((await del()).isError).toBeUndefined();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it('preserves deletion on systems without the text-elements collection', async () => {
    setup(metadata('inactive'));
    const client = createClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/functions/groups', []]]));
    expect((await del(client)).isError).toBeUndefined();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it.each([metadata(''), '<html>not metadata</html>', metadata('inactive', 'OTHER')])(
    'refuses inconclusive or another user’s metadata',
    async (pool) => {
      setup(pool);
      expect((await del()).isError).toBe(true);
      expect(mutations()).toHaveLength(0);
    },
  );

  it.each([403, 404, 500])('refuses deletion if the pool probe fails with %s', async (status) => {
    setup(metadata('inactive'));
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/textelements/') ? Promise.resolve(mockResponse(status, 'unavailable')) : sap(url, init),
    );
    expect((await del()).isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it.each([false, true])('stops on activation failure, including minimal errors=%s', async (minimalErrors) => {
    setup(metadata('inactive'));
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/activation?') ? Promise.resolve(mockResponse(500, 'activation failed')) : sap(url, init),
    );
    const result = await del(createClient(), 'ZTEST', minimalErrors);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('FUGR ZTEST was not deleted');
    expect(mutations()).toHaveLength(1);
  });

  it('enforces the write ceiling before activating or deleting', async () => {
    setup(metadata('inactive'));
    const client = createClient();
    client.safety.allowWrites = false;
    expect((await del(client)).isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
});
