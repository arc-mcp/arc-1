import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('SAPManage set_api_state for namespaced function modules', () => {
  const args = { action: 'set_api_state', name: '/NS/MY_FUNC', objectType: 'FUGR/FF', apiState: 'RELEASED' };
  const searchXml =
    '<objectReferences><objectReference type="FUGR/FF" name="/NS/MY_FUNC" uri="/sap/bc/adt/functions/groups/%2fns%2fgroup/fmodules/%2fns%2fmy_func"/></objectReferences>';
  const metadata = (packageName: string) =>
    `<abapFunctionModule xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:containerRef adtcore:packageName="${packageName}"/></abapFunctionModule>`;
  const client = () => createClient().withSafety({ ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] });

  beforeEach(() => mockFetch.mockReset());

  it('checks the encoded metadata URI before PUT and preserves its nested encoding in API release requests', async () => {
    const unreleased = readFileSync(new URL('../../fixtures/xml/api-release-unreleased.xml', import.meta.url), 'utf-8');
    const released = unreleased
      .replace('ars:state="NOT_RELEASED"', 'ars:state="RELEASED"')
      .replace('ars:useInSAPCloudPlatform="false"', 'ars:useInSAPCloudPlatform="true"');
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, searchXml, { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(200, metadata('$TMP')))
      .mockResolvedValueOnce(mockResponse(200, unreleased))
      .mockResolvedValueOnce(mockResponse(200, released))
      .mockResolvedValueOnce(mockResponse(200, released));

    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBeUndefined();
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(5);
    expect(urls[1]).toContain('/functions/groups/%2Fns%2Fgroup/fmodules/%2Fns%2Fmy_func');
    for (const url of urls.slice(2)) {
      expect(url).toContain(
        '/apireleases/%2Fsap%2Fbc%2Fadt%2Ffunctions%2Fgroups%2F%252Fns%252Fgroup%2Ffmodules%2F%252Fns%252Fmy_func',
      );
    }
    expect(mockFetch.mock.calls[3]?.[1]?.method).toBe('PUT');
  });

  it.each([
    ['disallowed', metadata('SAP_BASIS'), 'blocked'],
    ['missing', '<abapFunctionModule/>', 'could not determine'],
  ])('refuses a %s package before any API-release request', async (_label, response, message) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, searchXml)).mockResolvedValueOnce(mockResponse(200, response));
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
    expect(mockFetch.mock.calls).toHaveLength(2);
    expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/apireleases/'))).toBe(false);
  });

  it('refuses read-only clients before any API-release request', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, searchXml));
    const readOnly = client().withSafety({ ...unrestrictedSafetyConfig(), allowWrites: false });
    const result = await handleToolCall(readOnly, DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('allowWrites=false');
    expect(mockFetch.mock.calls).toHaveLength(1);
    expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/apireleases/'))).toBe(false);
  });
});
