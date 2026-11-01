import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('API state for namespaced objects', () => {
  beforeEach(() => mockFetch.mockReset());

  it.each([
    ['CLAS', '/IWBEP/CL_CP_FACTORY_REMOTE', 'oo/classes/%2FIWBEP%2FCL_CP_FACTORY_REMOTE', 'CLAS/OC'],
    ['INTF', '/IWBEP/IF_CP_CLIENT_PROXY', 'oo/interfaces/%2FIWBEP%2FIF_CP_CLIENT_PROXY', 'INTF/OI'],
    ['DTEL', '/AIF/IFNAME', 'ddic/dataelements/%2FAIF%2FIFNAME', 'DTEL/DE'],
  ])(
    'reads %s contracts with encoded namespace segments inside the API-release URI',
    async (objectType, name, path, adtType) => {
      const uri = `/sap/bc/adt/${path}`;
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<ars:apiRelease xmlns:ars="http://www.sap.com/adt/ars" xmlns:adtcore="http://www.sap.com/adt/core">
<ars:releasableObject adtcore:uri="${uri}" adtcore:type="${adtType}" adtcore:name="${name}"/>
<ars:c1Release ars:contract="C1"><ars:status ars:state="RELEASED"/></ars:c1Release>
<ars:apiCatalogData ars:isAnyContractReleased="true"/></ars:apiRelease>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        objectType,
        name,
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.objectName).toBe(name);
      expect(parsed.contracts).toEqual([expect.objectContaining({ contract: 'C1', state: 'RELEASED' })]);
      expect(mockFetch.mock.calls).toHaveLength(1);
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain(`/apireleases/${encodeURIComponent(uri)}`);
    },
  );

  const args = {
    action: 'set_api_state',
    objectType: 'CLAS',
    name: '/IWBEP/CL_CP_FACTORY_REMOTE',
    apiState: 'RELEASED',
  };
  const uri = '/sap/bc/adt/oo/classes/%2FIWBEP%2FCL_CP_FACTORY_REMOTE';
  const client = () => createClient().withSafety({ ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] });
  const metadata = (packageName: string) =>
    `<class xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${packageName}"/></class>`;

  it('resolves the encoded object package before writing its API contract', async () => {
    const unreleased = readFileSync(new URL('../../fixtures/xml/api-release-unreleased.xml', import.meta.url), 'utf-8');
    const released = unreleased
      .replace('ars:state="NOT_RELEASED"', 'ars:state="RELEASED"')
      .replace('ars:useInSAPCloudPlatform="false"', 'ars:useInSAPCloudPlatform="true"');
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, metadata('$TMP'), { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(200, unreleased))
      .mockResolvedValueOnce(mockResponse(200, released))
      .mockResolvedValueOnce(mockResponse(200, released));
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBeUndefined();
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(4);
    expect(urls[0]).toContain(uri);
    for (const url of urls.slice(1)) expect(url).toContain(`/apireleases/${encodeURIComponent(uri)}`);
    expect(mockFetch.mock.calls[2]?.[1]?.method).toBe('PUT');
  });

  it('rejects the real SAP package before any API-release request', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, metadata('/IWBEP/CP_RUNTIME')));
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('/IWBEP/CP_RUNTIME');
    expect(result.content[0]?.text).toContain('blocked');
    expect(mockFetch.mock.calls).toHaveLength(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(uri);
    expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/apireleases/'))).toBe(false);
  });
});
