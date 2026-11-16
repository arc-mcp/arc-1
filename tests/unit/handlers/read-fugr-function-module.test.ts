/**
 * SAPRead FUGR handed a function module name (tracker A25): the hint must name the real group.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — keep src-module imports dynamic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

beforeEach(() => {
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

  it('keeps the original not-found error when the name is no function module', async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(notFound(404, '/sap/bc/adt/functions/groups/Z_NOPE/source/main'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'FUGR',
      name: 'Z_NOPE',
      expand_includes: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).not.toContain('is a function module');
    expect(result.content[0]?.text).toContain('was not found');
  });
});
