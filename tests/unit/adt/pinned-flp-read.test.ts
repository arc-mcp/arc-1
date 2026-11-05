import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import { FLP_SERVICE_PATH, listCatalogs } from '../../../src/adt/flp.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import {
  listPinnedFlpCatalogs,
  listPinnedFlpGroups,
  PINNED_FLP_LIST_BYTES,
  readPinnedFlpTilePage,
} from '../../../src/adt/pinned-flp-entity.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const safety = defaultSafetyConfig();
const readers = [
  listPinnedFlpCatalogs,
  listPinnedFlpGroups,
  (http: AdtHttpClient) => readPinnedFlpTilePage(http, safety, 'ZGROUP'),
];
const client = (body: unknown) => ({
  get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: JSON.stringify(body) }),
});

describe('bounded pinned FLP collections', () => {
  it.each(readers)('requires a successful collection to report an empty list', async (read) => {
    const http = client({ d: { results: [] } });
    expect(await read(http as unknown as AdtHttpClient, safety)).toEqual({ items: [], truncated: false });
    expect(http.get.mock.calls[0][2].responseBudget.limitBytes).toBe(PINNED_FLP_LIST_BYTES);
    for (const body of ['<html>ICF unavailable</html>', '{"error":{"code":"NOT_FOUND"}}']) {
      const error = new AdtApiError('Not found', 404, FLP_SERVICE_PATH, body);
      http.get.mockRejectedValueOnce(error);
      await expect(read(http as unknown as AdtHttpClient, safety)).rejects.toBe(error);
    }
  });

  it('leaves the single-target catalog 404 behavior unchanged', async () => {
    const http = {
      get: vi.fn().mockRejectedValue(new AdtApiError('Not found', 404, FLP_SERVICE_PATH, '<html>404</html>')),
    };
    await expect(listCatalogs(http as unknown as AdtHttpClient, safety)).resolves.toEqual([]);
  });

  it.each(readers)('caps output and exposes native continuation or count without following it', async (read) => {
    for (const page of [
      {
        results: Array.from({ length: 500 }, (_, index) => ({
          pageId: 'ZGROUP',
          instanceId: `I${index}`,
          chipId: 'C',
        })),
      },
      {
        results: Array.from({ length: 501 }, (_, index) => ({
          pageId: 'ZGROUP',
          instanceId: `I${index}`,
          chipId: 'C',
        })),
      },
      { results: [{ pageId: 'ZGROUP', instanceId: 'I', chipId: 'C' }], __next: 'https://untrusted.example/next' },
      { results: [{ pageId: 'ZGROUP', instanceId: 'I', chipId: 'C' }], __count: '2' },
    ]) {
      const http = client({ d: page });
      const result = await read(http as unknown as AdtHttpClient, safety);
      expect(result.truncated).toBe(true);
      expect(result.items.length).toBeLessThanOrEqual(500);
      expect(http.get).toHaveBeenCalledTimes(1);
    }
  });

  it.each([{ __next: null }, { __next: '' }, { __count: 'NaN' }, { __count: '0' }])(
    'refuses ambiguous pagination %j',
    async (markers) => {
      const http = client({ d: { results: [{}], ...markers } });
      await expect(listPinnedFlpCatalogs(http as unknown as AdtHttpClient, safety)).rejects.toThrow('FLP collection');
    },
  );

  it('rejects an oversized body before parsing even when a mocked transport ignores its budget', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: ' '.repeat(PINNED_FLP_LIST_BYTES + 1) }),
    };
    await expect(listPinnedFlpCatalogs(http as unknown as AdtHttpClient, safety)).rejects.toBeInstanceOf(
      AdtResponseLimitError,
    );
  });

  it.each([
    null,
    'row',
    [],
    {},
    { pageId: 'OTHER', instanceId: 'I', chipId: 'C' },
    { instanceId: 'I', chipId: 'C' },
    { pageId: 'ZGROUP', instanceId: '', chipId: 'C' },
    { pageId: 'ZGROUP', instanceId: 7, chipId: 'C' },
    { pageId: 'ZGROUP', instanceId: 'I', chipId: '' },
    { pageId: 'ZGROUP', instanceId: 'I', chipId: {} },
  ])('refuses an unowned or malformed tile row %j before mapping it', async (row) => {
    const http = client({ d: { results: [row] } });
    await expect(readPinnedFlpTilePage(http as unknown as AdtHttpClient, safety, 'ZGROUP')).rejects.toThrow(
      'owned by the requested page',
    );
  });

  it('refuses duplicate native tile identities rather than selecting an arbitrary match', async () => {
    const http = client({
      d: {
        results: [
          { pageId: 'ZGROUP', instanceId: 'I', chipId: 'C' },
          { pageId: 'ZGROUP', instanceId: 'I', chipId: 'OTHER' },
        ],
      },
    });
    await expect(readPinnedFlpTilePage(http as unknown as AdtHttpClient, safety, 'ZGROUP')).rejects.toThrow(
      'unambiguous',
    );
  });

  it('uses the page association without the unsupported tile filter', async () => {
    const http = client({ d: { results: [] } });
    await readPinnedFlpTilePage(http as unknown as AdtHttpClient, safety, 'X-SAP-UI2-CATALOGPAGE:ZCAT');
    expect(http.get.mock.calls[0][0]).toContain("Pages('X-SAP-UI2-CATALOGPAGE%3AZCAT')/PageChipInstances?");
    expect(http.get.mock.calls[0][0]).not.toContain('$filter');
  });
});
