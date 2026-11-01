import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { supportsPackageFilteredSearch } from '../../../src/adt/package-contents.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});
const { AdtClient } = await import('../../../src/adt/client.js');
function createClient() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

const discovery = readFileSync(new URL('../../fixtures/xml/package-search-discovery.xml', import.meta.url), 'utf8');

describe('package-filtered search discovery', () => {
  it('accepts SAP packageName and packageName* query parameters', () => {
    expect(supportsPackageFilteredSearch(discovery)).toBe(true);
    expect(supportsPackageFilteredSearch(discovery.replace('packageName*', 'packageName'))).toBe(true);
  });

  it('accepts absolute collection/template URLs and a later workspace', () => {
    const xml = discovery
      .replaceAll('="/sap/', '="https://sap.example/sap/')
      .replace('<app:workspace>', '<app:workspace><app:collection href="/other"/></app:workspace><app:workspace>');
    expect(supportsPackageFilteredSearch(xml)).toBe(true);
  });

  it.each([
    discovery.replace('{&amp;packageName*}', ''), // Captured 750 quicksearch contract.
    discovery.replace('packageName*', 'packageNameSuffix*'),
    discovery.replace('/search/quicksearch', '/search/whitelisting'),
    discovery.replace('href="/sap/bc/adt/repository/informationsystem/search"', 'href="/other"'),
    discovery.replace('template="/sap/bc/adt/repository/informationsystem/search', 'template="/other'),
    '<service><description>packageName</description></service>',
    '',
  ])('does not enable the filter from absent or unrelated metadata: %s', (xml) => {
    expect(supportsPackageFilteredSearch(xml)).toBe(false);
  });
});

describe('getPackageContents (search-endpoint based)', () => {
  /**
   * Hand-crafted minimal `adtcore:objectReferences` XML covering the case
   * the legacy `nodestructure` endpoint got wrong: a sub-package whose own
   * description was attributed to a contained class. Each reference here
   * has its description correctly attached to its own name.
   */
  const PACKAGE_DISCOVERY = discovery;
  const SEARCH_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:objectReference adtcore:uri="/sap/bc/adt/packages/zsubpkg" adtcore:type="DEVC/K" adtcore:name="ZSUBPKG" adtcore:packageName="ZSUBPKG" adtcore:description="Sub-package own description"/>
<adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_one" adtcore:type="CLAS/OC" adtcore:name="ZCL_ONE" adtcore:packageName="ZPARENT" adtcore:description="First class"/>
<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zreport" adtcore:type="PROG/P" adtcore:name="ZREPORT" adtcore:packageName="ZPARENT" adtcore:description="A report"/>
</adtcore:objectReferences>`;

  it('hits the search endpoint, NOT nodestructure', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    await client.getPackageContents('ZPARENT');
    const url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('/sap/bc/adt/repository/informationsystem/search');
    expect(url).toContain('packageName=ZPARENT');
    expect(url).toContain('operation=quickSearch');
    expect(url).toContain('query=*');
    expect(url).not.toContain('/nodestructure');
    // Discovery and search are GETs; no CSRF round-trip is needed.
    const method = (mockFetch.mock.calls[1]?.[1] as RequestInit)?.method ?? 'GET';
    expect(method).toBe('GET');
  });

  it('returns objects with descriptions correctly aligned to names', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    const contents = await client.getPackageContents('ZPARENT');
    expect(contents).toHaveLength(3);
    const sub = contents.find((c) => c.name === 'ZSUBPKG');
    const clas = contents.find((c) => c.name === 'ZCL_ONE');
    const prog = contents.find((c) => c.name === 'ZREPORT');
    // The bug we are fixing: each row's description must be its OWN, not a sibling's.
    expect(sub?.description).toBe('Sub-package own description');
    expect(clas?.description).toBe('First class');
    expect(prog?.description).toBe('A report');
  });

  it('maps search field names to DEVC contract (objectType→type, objectName→name)', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    const contents = await client.getPackageContents('ZPARENT');
    // Public contract is { type, name, description, uri } — verify the rename happened
    // and that no `objectType`/`objectName`/`packageName` leak through.
    for (const c of contents) {
      expect(c).toHaveProperty('type');
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('description');
      expect(c).toHaveProperty('uri');
      expect(c).not.toHaveProperty('objectType');
      expect(c).not.toHaveProperty('objectName');
      expect(c).not.toHaveProperty('packageName');
    }
    const clas = contents.find((c) => c.name === 'ZCL_ONE');
    expect(clas?.type).toBe('CLAS/OC');
    expect(clas?.uri).toBe('/sap/bc/adt/oo/classes/zcl_one');
  });

  it('honors maxResults parameter (passed through to query string)', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    await client.getPackageContents('ZPARENT', 50);
    const url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('maxResults=50');
  });

  it('clamps maxResults to [1, 1000]', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    await client.getPackageContents('ZPARENT', 5000);
    let url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('maxResults=1000');

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    await client.getPackageContents('ZPARENT', 0);
    url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('maxResults=1');

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    await client.getPackageContents('ZPARENT', -1);
    url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('maxResults=1');
  });

  it('uses default maxResults=200 when not specified', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    await client.getPackageContents('ZPARENT');
    const url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('maxResults=200');
  });

  it('floors a fractional maxResults and falls back to default on NaN (no float reaches the URL)', async () => {
    // SAPReadSchema now accepts any number (the advertised `type: number` contract); flooring +
    // range handling is this sink's job — see docs/research/2026-06-12-maxresults-contract-asymmetry.md.
    // NOTE: 'maxResults=50' is a SUBSTRING of the un-floored 'maxResults=50.5', so each row also
    // pins the absence of the raw input — without that, the toContain is vacuous for floats.
    const client = createClient();
    for (const [input, expected, mustNotContain] of [
      [50.5, 'maxResults=50', 'maxResults=50.5'],
      [0.4, 'maxResults=1', 'maxResults=0.4'],
      [Number.NaN, 'maxResults=200', 'maxResults=NaN'],
    ] as const) {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
        .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
      await client.getPackageContents('ZPARENT', input);
      const url = String(mockFetch.mock.calls[1]?.[0] ?? '');
      expect(url).toContain(expected);
      expect(url).not.toContain(mustNotContain);
    }
  });

  it('encodes special characters in package names', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(200, SEARCH_RESPONSE));
    const client = createClient();
    await client.getPackageContents('/NAMESPACE/PKG');
    const url = String(mockFetch.mock.calls[1]?.[0] ?? '');
    expect(url).toContain('packageName=%2FNAMESPACE%2FPKG');
  });
  it.each(['SABP_UNIT', 'ZNONEXISTENT_PKG_99X'])('refuses %s before an unsupported global search', async (name) => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, PACKAGE_DISCOVERY.replace('{&amp;packageName*}', '')));
    await expect(createClient().getPackageContents(name, 3)).rejects.toThrow(
      'does not advertise package-filtered ADT search',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/sap/bc/adt/discovery');
  });

  it('propagates discovery authorization errors without issuing a package search', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(403, 'Forbidden'));
    await expect(createClient().getPackageContents('ZPARENT')).rejects.toMatchObject({ statusCode: 403 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves native invalid-package errors when filtered search is supported', async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, PACKAGE_DISCOVERY))
      .mockResolvedValue(mockResponse(400, 'Package is invalid'));
    await expect(createClient().getPackageContents('ZNONEXISTENT_PKG_99X')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
