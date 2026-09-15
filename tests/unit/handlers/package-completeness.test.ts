import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

function packageResponse(count: number) {
  return mockResponse(
    200,
    `<objectReferences>${Array.from(
      { length: count },
      (_, i) =>
        `<objectReference type="CLAS/OC" name="ZCL_${i}" description="Class ${i}" uri="/sap/bc/adt/oo/classes/zcl_${i}"/>`,
    ).join('')}</objectReferences>`,
  );
}

describe('DEVC completeness through dispatch', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    { count: 1, cap: 2, effective: 2, reached: false },
    { count: 2, cap: 2, effective: 2, reached: true },
    { count: 1, cap: 0, effective: 1, reached: true },
  ])(
    'keeps the legacy array and reports the effective cap: $count/$cap',
    async ({ count, cap, effective, reached }) => {
      mockFetch.mockResolvedValue(packageResponse(count));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DEVC',
        name: 'ZPKG',
        maxResults: cap,
      });
      expect(result.isError).toBeUndefined();
      const objects = JSON.parse(result.content[0].text);
      expect(Array.isArray(objects)).toBe(true);
      expect(objects).toHaveLength(count);
      const { listing } = JSON.parse(result.content[1].text);
      expect(listing).toMatchObject({
        returned: count,
        effectiveLimit: effective,
        limitReached: reached,
        possiblyTruncated: reached,
        completeness: 'unknown',
        total: null,
        coverage: 'adt-search',
      });
      expect(listing.note).toContain('omit');
      if (reached) expect(listing.note).toContain('may be truncated');
      expect(new URL(String(mockFetch.mock.calls[0][0])).searchParams.get('maxResults')).toBe(String(effective));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('offers one JSON envelope for structured consumers', async () => {
    mockFetch.mockResolvedValue(packageResponse(1));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'DEVC',
      name: 'ZPKG',
      maxResults: 1,
      format: 'structured',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const body = JSON.parse(result.content[0].text);
    expect(body.objects).toHaveLength(1);
    expect(body.listing).toMatchObject({ limitReached: true, completeness: 'unknown', total: null });
  });
});
