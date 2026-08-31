import { describe, expect, it, vi } from 'vitest';
import { AUNIT_PACKAGE_SEARCH_LIMIT, resolveAunitPackageSelection } from '../../../src/adt/aunit-package.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

function searchXml(rows: Array<{ type: string; name: string; packageName: string; uri: string }>): string {
  return `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${rows
    .map(
      (row) =>
        `<adtcore:objectReference adtcore:type="${row.type}" adtcore:name="${row.name}" adtcore:packageName="${row.packageName}" adtcore:uri="${row.uri}"/>`,
    )
    .join('')}</adtcore:objectReferences>`;
}

function httpFor(xml: string): AdtHttpClient {
  return {
    get: vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '<package/>' })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: xml }),
  } as unknown as AdtHttpClient;
}

describe('AUnit package selection', () => {
  const rows = [
    {
      type: 'CLAS/OC',
      name: 'ZCL_ROOT',
      packageName: 'ZROOT',
      uri: '/sap/bc/adt/oo/classes/zcl_root',
    },
    {
      type: 'PROG/P',
      name: 'ZSUB_REPORT',
      packageName: 'ZSUB',
      uri: '/sap/bc/adt/programs/programs/zsub_report',
    },
    {
      type: 'INTF/OI',
      name: 'ZIF_ROOT',
      packageName: 'ZROOT',
      uri: '/sap/bc/adt/oo/interfaces/zif_root',
    },
  ];

  it('keeps only exact-package executable roots by default', async () => {
    const http = httpFor(searchXml(rows));
    const selection = await resolveAunitPackageSelection(http, unrestrictedSafetyConfig(), 'zroot', false);

    expect(selection).toMatchObject({ packageName: 'ZROOT', includeSubpackages: false, complete: true });
    expect(selection.objects).toEqual([
      {
        type: 'CLAS',
        name: 'ZCL_ROOT',
        packageName: 'ZROOT',
        uri: '/sap/bc/adt/oo/classes/zcl_root',
      },
    ]);
    expect(vi.mocked(http.get).mock.calls[0]?.[0]).toBe('/sap/bc/adt/packages/ZROOT');
    expect(vi.mocked(http.get).mock.calls[1]?.[0]).toContain('packageName=ZROOT');
  });

  it('applies one request deadline to package metadata and search', async () => {
    const http = httpFor(searchXml(rows));
    const requestOptions = { deadline: 12_345 };

    await resolveAunitPackageSelection(http, unrestrictedSafetyConfig(), 'ZROOT', false, requestOptions);

    expect(vi.mocked(http.get).mock.calls[0]?.[2]).toBe(requestOptions);
    expect(vi.mocked(http.get).mock.calls[1]?.[2]).toBe(requestOptions);
  });

  it('includes supported subtree rows only when explicitly requested', async () => {
    const selection = await resolveAunitPackageSelection(
      httpFor(searchXml(rows)),
      unrestrictedSafetyConfig(),
      'ZROOT',
      true,
    );

    expect(selection.objects.map((object) => `${object.type}:${object.name}`)).toEqual([
      'CLAS:ZCL_ROOT',
      'PROG:ZSUB_REPORT',
    ]);
    expect(selection.membership).toHaveLength(3);
  });

  it('accepts canonical encoded namespace separators while matching the object name', async () => {
    const http = httpFor(
      searchXml([
        {
          type: 'FUGR/F',
          name: '/NS/FG',
          packageName: '/NS/PKG',
          uri: '/sap/bc/adt/functions/groups/%2fNS%2fFG',
        },
      ]),
    );
    const selection = await resolveAunitPackageSelection(http, unrestrictedSafetyConfig(), '/NS/PKG', false);

    expect(selection).toMatchObject({
      complete: true,
      objects: [{ type: 'FUGR', name: '/NS/FG', uri: '/sap/bc/adt/functions/groups/%2fNS%2fFG' }],
    });
    expect(vi.mocked(http.get).mock.calls[0]?.[0]).toBe('/sap/bc/adt/packages/%2FNS%2FPKG');
  });

  it('marks a full bounded response incomplete instead of claiming whole-package enumeration', async () => {
    const boundedRows = Array.from({ length: AUNIT_PACKAGE_SEARCH_LIMIT }, (_, index) => ({
      type: 'INTF/OI',
      name: `ZIF_${index}`,
      packageName: 'ZROOT',
      uri: `/sap/bc/adt/oo/interfaces/zif_${index}`,
    }));
    const selection = await resolveAunitPackageSelection(
      httpFor(searchXml(boundedRows)),
      unrestrictedSafetyConfig(),
      'ZROOT',
      false,
    );

    expect(selection.complete).toBe(false);
    expect(selection.incompleteReason).toContain('1,000-row repository-search bound');
  });

  it.each([
    { label: 'type', uri: '/sap/bc/adt/programs/programs/zcl_wrong' },
    { label: 'object name', uri: '/sap/bc/adt/oo/classes/zcl_other' },
  ])('rejects executable rows whose SAP-provided URI does not match their $label', async ({ uri }) => {
    const selection = await resolveAunitPackageSelection(
      httpFor(
        searchXml([
          {
            type: 'CLAS/OC',
            name: 'ZCL_WRONG',
            packageName: 'ZROOT',
            uri,
          },
        ]),
      ),
      unrestrictedSafetyConfig(),
      'ZROOT',
      false,
    );

    expect(selection.objects).toEqual([]);
    expect(selection.complete).toBe(false);
    expect(selection.incompleteReason).toContain('non-canonical ADT URI');
  });
});
