/**
 * SAPRead FUGR handed a function module name (tracker A25): the hint must name the real group.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — keep src-module imports dynamic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPRead } = await import('../../../src/handlers/read.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  resetCachedFeatures();
});

describe('FUGR read given a function module name (A25)', () => {
  const notFound = (status: number, path: string) => new AdtApiError('not found', status, path);

  it.each([
    ['plain read (422 from objectstructure)', {}, 422, '/sap/bc/adt/functions/groups/Z_MY_FUNC/objectstructure'],
    [
      'expand_includes (404 from source/main)',
      { expand_includes: true },
      404,
      '/sap/bc/adt/functions/groups/Z_MY_FUNC/source/main',
    ],
    ['grep (404 from source/main)', { grep: 'FUNCTION' }, 404, '/sap/bc/adt/functions/groups/Z_MY_FUNC/source/main'],
  ])('names the real group when the name is a function module: %s', async (_label, extra, status, path) => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(notFound(status, path));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        200,
        '<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" packageName="ZTEST" description="x"/></objectReferences>',
      ),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'FUGR',
      name: 'Z_MY_FUNC',
      ...extra,
    });
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('"Z_MY_FUNC" is a function module in function group ZGROUP');
    expect(text).toContain('SAPRead(type="FUNC", group="ZGROUP", name="Z_MY_FUNC")');
  });

  // NW 7.50: no per-group objectstructure (404), the generic fallback answers 200 with an empty
  // tree for a name that is no group, and quick search is case-sensitive. Live-verified on npl.
  const EMPTY_TREE =
    '<projectexplorer:objectstructure xmlns:projectexplorer="http://www.sap.com/adt/projectexplorer"/>';

  it.each([
    [
      'names the group for a lowercase function module name',
      '<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func"/></objectReferences>',
      '"z_my_func" is a function module in function group ZGROUP',
    ],
    [
      'reports a missing group instead of an empty one',
      '<objectReferences/>',
      'Hint: Object "z_my_func" (type FUGR) was not found.',
    ],
  ])('7.50 plain read: %s', async (_label, searchXml, expected) => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(404, 'No suitable resource found'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, EMPTY_TREE));
    mockFetch.mockResolvedValueOnce(mockResponse(200, searchXml));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'FUGR', name: 'z_my_func' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(expected);
    expect(result.content[0]?.text).not.toContain('SICF');
    expect(String(mockFetch.mock.calls[2]?.[0])).toContain('query=Z_MY_FUNC');
  });

  const read = (client: ReturnType<typeof createClient>, extra = {}) =>
    handleSAPRead(client, { type: 'FUGR', name: 'Z_MY_FUNC', ...extra }, undefined, { isPerUserClient: false }, false);

  it.each([403, 500])('does not resolve a module after HTTP %i', async (status) => {
    const client = createClient();
    const error = new AdtApiError(
      'Original group error',
      status,
      '/sap/bc/adt/functions/groups/Z_MY_FUNC/objectstructure',
    );
    vi.spyOn(client, 'getFunctionGroup').mockRejectedValue(error);
    const lookup = vi.spyOn(client, 'resolveFunctionGroup');

    await expect(read(client)).rejects.toBe(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not resolve a module after a non-API error', async () => {
    const client = createClient();
    const error = new Error('Connection unavailable');
    vi.spyOn(client, 'getFunctionGroupExpanded').mockRejectedValue(error);
    const lookup = vi.spyOn(client, 'resolveFunctionGroup');

    await expect(read(client, { expand_includes: true })).rejects.toBe(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['missing', 'same name', 'lookup failed'])(
    'preserves the original error when resolution is %s',
    async (outcome) => {
      const client = createClient();
      const error = notFound(422, '/sap/bc/adt/functions/groups/Z_MY_FUNC/objectstructure');
      vi.spyOn(client, 'getFunctionGroup').mockRejectedValue(error);
      const lookup = vi.spyOn(client, 'resolveFunctionGroup');
      if (outcome === 'lookup failed') lookup.mockRejectedValue(new Error('Search unavailable'));
      else lookup.mockResolvedValue(outcome === 'same name' ? 'z_my_func' : null);

      await expect(read(client)).rejects.toBe(error);
      expect(lookup).toHaveBeenCalledExactlyOnceWith('Z_MY_FUNC');
    },
  );
});
