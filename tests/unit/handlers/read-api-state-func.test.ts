/**
 * SAPRead type=API_STATE for function modules (#928): the function module URI needs its parent
 * function group, so the handler takes the FUNC-aware path instead of objectBasePath.
 * Kept apart from read.test.ts, which is at its file-size budget.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('SAPRead API_STATE for function modules', () => {
  const fmApiReleaseXml = `<?xml version="1.0" encoding="utf-8"?>
<apirelease:apiReleaseInfos xmlns:apirelease="http://www.sap.com/adt/apirelease" xmlns:adtcore="http://www.sap.com/adt/core">
<apirelease:releasableObject adtcore:uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" adtcore:type="FUGR/FF" adtcore:name="Z_MY_FUNC"/>
<apirelease:apiCatalogData apirelease:isAnyAssignmentPossible="false" apirelease:isAnyContractReleased="false"/>
</apirelease:apiReleaseInfos>`;
  const fmSearchXml = `<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" packageName="ZTEST" description="Test FM"/></objectReferences>`;

  it('API_STATE for FUNC with explicit group builds the function module URI without a search', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, fmApiReleaseXml));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'API_STATE',
      name: 'Z_MY_FUNC',
      objectType: 'FUNC',
      group: 'ZGROUP',
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text).objectName).toBe('Z_MY_FUNC');
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/sap/bc/adt/apireleases/');
    expect(urls[0]).toContain('functions%2Fgroups%2Fzgroup%2Ffmodules%2Fz_my_func');
  });

  it('API_STATE for FUNC without group resolves the function group through search', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, fmSearchXml));
    mockFetch.mockResolvedValueOnce(mockResponse(200, fmApiReleaseXml));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'API_STATE',
      name: 'Z_MY_FUNC',
      objectType: 'FUNC',
    });
    expect(result.isError).toBeUndefined();
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/sap/bc/adt/repository/informationsystem/search');
    expect(urls[1]).toContain('functions%2Fgroups%2Fzgroup%2Ffmodules%2Fz_my_func');
  });

  it('API_STATE accepts the ADT slash type FUGR/FF for a function module', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, fmApiReleaseXml));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'API_STATE',
      name: 'Z_MY_FUNC',
      objectType: 'FUGR/FF',
      group: 'ZGROUP',
    });
    expect(result.isError).toBeUndefined();
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('functions%2Fgroups%2Fzgroup%2Ffmodules%2Fz_my_func');
  });

  it('API_STATE for FUNC returns a clear error and sends no apireleases request when the group is unknown', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'API_STATE',
      name: 'Z_NONEXIST_FM',
      objectType: 'FUNC',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Cannot resolve function group');
    expect(result.content[0]?.text).not.toContain('objectBasePath');
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/apireleases/'))).toBe(false);
  });

  it('API_STATE for a namespaced FUNC encodes the function module URI exactly once', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, fmApiReleaseXml));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'API_STATE',
      name: '/NS/MY_FUNC',
      objectType: 'FUNC',
      group: '/NS/GROUP',
    });
    expect(result.isError).toBeUndefined();
    const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('groups%2F%2Fns%2Fgroup%2Ffmodules%2F%2Fns%2Fmy_func');
    expect(calledUrl).not.toContain('%252F');
  });
});
