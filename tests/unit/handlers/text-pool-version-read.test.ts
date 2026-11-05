import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextElementPart } from '../../../src/adt/text-elements.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

describe('native text-pool version reads for activation verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(mockResponse(200, '@MaxLength:20\n001=Stored text'));
  });

  it.each(['active', 'inactive'] as const)(
    'selects the explicit %s version with fresh native headers',
    async (version) => {
      const client = createClient();
      expect(await readTextElementPart(client.http, client.safety, 'CLAS', '/NS/ZTEXT', 'symbols', { version })).toBe(
        '@MaxLength:20\n001=Stored text',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, request] = mockFetch.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe('/sap/bc/adt/textelements/classes/%2FNS%2FZTEXT/source/symbols');
      expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({
        version,
        'sap-client': '100',
        'sap-language': 'EN',
      });
      expect(request.method).toBe('GET');
      expect(request.headers).toMatchObject({
        Accept: 'application/vnd.sap.adt.textelements.symbols.v1',
        'Cache-Control': 'no-cache',
      });
    },
  );

  it('preserves an ordinary read without a version or cache directive', async () => {
    const client = createClient();
    await readTextElementPart(client.http, client.safety, 'PROG', 'ZTEXT', 'headings');
    const [url, request] = mockFetch.mock.calls[0];
    expect(new URL(String(url)).searchParams.has('version')).toBe(false);
    expect(request.headers).toMatchObject({ Accept: 'application/vnd.sap.adt.textelements.headings.v1' });
    expect(request.headers).not.toHaveProperty('Cache-Control');
  });

  it('refuses an invalid runtime version before SAP sees it', async () => {
    const client = createClient();
    await expect(
      readTextElementPart(client.http, client.safety, 'PROG', 'ZTEXT', 'symbols', {
        version: 'invalid' as 'active',
      }),
    ).rejects.toThrow('Invalid text-element version');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([{ version: 'active' as const }, { fresh: true }])(
    'bounds fresh verification by UTF-8 bytes: %j',
    async (options) => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, 'ü'.repeat(524_289)));
      await expect(
        readTextElementPart(client.http, client.safety, 'PROG', 'ZTEXT', 'symbols', options),
      ).rejects.toThrow('exceeded the verification bound');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
});
