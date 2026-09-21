import { describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import {
  addTileToGroup,
  createCatalog,
  createGroup,
  createTile,
  deleteCatalog,
  FLP_SERVICE_PATH,
  listCatalogs,
  listGroups,
  listTiles,
  normalizeCatalogId,
} from '../../../src/adt/flp.js';
import type { AdtHttpClient, AdtResponse } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

function mockHttp(responseBody = '', statusCode = 200): AdtHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ statusCode, headers: {}, body: responseBody } satisfies AdtResponse),
    post: vi.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: responseBody } satisfies AdtResponse),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 204, headers: {}, body: '' } satisfies AdtResponse),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

function odataCollection(results: unknown[]): string {
  return JSON.stringify({ d: { results } });
}

function odataSingle(entity: Record<string, unknown>): string {
  return JSON.stringify({ d: entity });
}

describe('FLP OData client', () => {
  describe('read operations', () => {
    it('listCatalogs returns parsed catalogs', async () => {
      const http = mockHttp(
        odataCollection([
          {
            id: '/UI2/CATALOG_ALL',
            domainId: '/UI2/CATALOG_ALL',
            title: 'Catalog with all Chips',
            type: '',
            scope: '',
            chipCount: '0042',
          },
          {
            id: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST_CAT',
            domainId: 'ZARC1_TEST_CAT',
            title: 'ARC1 Test Catalog',
            type: 'CATALOG_PAGE',
            scope: 'CUSTOMIZING',
            chipCount: '0000',
          },
        ]),
      );

      const result = await listCatalogs(http, unrestrictedSafetyConfig());

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('/UI2/CATALOG_ALL');
      expect(result[1]?.domainId).toBe('ZARC1_TEST_CAT');
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/Catalogs?$format=json&$top=500&$select='),
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });

    it('listCatalogs returns empty array on 404', async () => {
      const http = mockHttp();
      vi.mocked(http.get).mockRejectedValue(new AdtApiError('Not found', 404, '/test'));

      const result = await listCatalogs(http, unrestrictedSafetyConfig());

      expect(result).toEqual([]);
    });

    it('listCatalogs sends Accept: application/json header', async () => {
      const http = mockHttp(odataCollection([]));
      await listCatalogs(http, unrestrictedSafetyConfig());
      expect(http.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });

    it('listGroups filters by catalogId', async () => {
      const http = mockHttp(odataCollection([]));

      await listGroups(http, unrestrictedSafetyConfig());

      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining("$filter=catalogId%20eq%20'/UI2/FLPD_CATALOG'"),
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });

    it('listTiles parses double-serialized configuration', async () => {
      const http = mockHttp(
        odataCollection([
          {
            pageId: 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG',
            instanceId: '00O2TO3741QLWH4GV74AHMWQE',
            chipId: 'X-SAP-UI2-CHIP:/UI2/ACTION',
            title: 'Manage Data Aging Groups',
            configuration:
              '{"tileConfiguration":"{\\"semantic_object\\":\\"DataAgingObjectGroup\\",\\"semantic_action\\":\\"manageDAGrpT\\",\\"display_title_text\\":\\"Manage Data Aging Groups\\"}"}',
          },
        ]),
      );

      const tiles = await listTiles(http, unrestrictedSafetyConfig(), 'MY_CATALOG');

      expect(tiles).toHaveLength(1);
      expect(tiles[0]?.configuration).toMatchObject({
        semantic_object: 'DataAgingObjectGroup',
        display_title_text: 'Manage Data Aging Groups',
      });
    });

    it('listTiles reads via the Page association and never filters on pageId', async () => {
      const http = mockHttp(odataCollection([]));

      await listTiles(http, unrestrictedSafetyConfig(), 'MY_CATALOG');

      const url = vi.mocked(http.get).mock.calls[0]![0] as string;
      // A $filter on pageId short-dumps the backend (/UI2/CL_EDM_DA_V06_USAGE asserts).
      expect(url).not.toContain('$filter');
      expect(url).toContain("/Pages('X-SAP-UI2-CATALOGPAGE%3AMY_CATALOG')/PageChipInstances?");
    });

    it('listTiles encodes slashes in the catalog key', async () => {
      const http = mockHttp(odataCollection([]));

      await listTiles(http, unrestrictedSafetyConfig(), '/UI2/FLP_ADMIN');

      const url = vi.mocked(http.get).mock.calls[0]![0] as string;
      expect(url).toContain("/Pages('X-SAP-UI2-CATALOGPAGE%3A%2FUI2%2FFLP_ADMIN')/PageChipInstances?");
    });

    it('listTiles handles malformed configuration gracefully', async () => {
      const http = mockHttp(
        odataCollection([
          {
            pageId: 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG',
            instanceId: 'TILE1',
            chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
            title: 'Broken',
            configuration: 'C1',
          },
        ]),
      );

      const tiles = await listTiles(http, unrestrictedSafetyConfig(), 'MY_CATALOG');

      expect(tiles[0]?.configuration).toBeNull();
    });
  });

  describe('write operations', () => {
    it('createCatalog sends correct OData POST', async () => {
      const http = mockHttp(
        odataSingle({
          id: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST',
          domainId: 'ZARC1_TEST',
          title: 'Test',
          type: 'CATALOG_PAGE',
          scope: 'CUSTOMIZING',
          chipCount: '0000',
        }),
      );

      await createCatalog(http, unrestrictedSafetyConfig(), 'ZARC1_TEST', 'Test');

      expect(http.post).toHaveBeenCalledWith(
        `${FLP_SERVICE_PATH}/Catalogs`,
        JSON.stringify({ domainId: 'ZARC1_TEST', title: 'Test', type: 'CATALOG_PAGE' }),
        'application/json',
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });

    it('createTile serializes double-JSON configuration', async () => {
      const http = mockHttp(
        odataSingle({
          pageId: 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG',
          instanceId: 'TILE123',
          chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
          title: 'My Tile',
          configuration: '{"tileConfiguration":"{}"}',
        }),
      );

      await createTile(http, unrestrictedSafetyConfig(), 'MY_CATALOG', {
        id: 'tile-1',
        title: 'My Tile',
        semanticObject: 'ZSO',
        semanticAction: 'display',
        icon: 'sap-icon://home',
      });

      const payload = JSON.parse(vi.mocked(http.post).mock.calls[0]![1] as string);
      expect(typeof payload.configuration).toBe('string');

      const outer = JSON.parse(payload.configuration);
      expect(typeof outer.tileConfiguration).toBe('string');

      const inner = JSON.parse(outer.tileConfiguration);
      expect(inner.semantic_object).toBe('ZSO');
      expect(inner.semantic_action).toBe('display');
      expect(inner.display_title_text).toBe('My Tile');
    });

    it('createTile uses correct chipId and pageId', async () => {
      const http = mockHttp(
        odataSingle({
          pageId: 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG',
          instanceId: 'TILE123',
          chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
          title: 'My Tile',
          configuration: '{"tileConfiguration":"{}"}',
        }),
      );

      await createTile(http, unrestrictedSafetyConfig(), 'MY_CATALOG', {
        id: 'tile-1',
        title: 'My Tile',
        semanticObject: 'ZSO',
        semanticAction: 'display',
      });

      const payload = JSON.parse(vi.mocked(http.post).mock.calls[0]![1] as string);
      expect(payload.chipId).toBe('X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER');
      expect(payload.pageId).toBe('X-SAP-UI2-CATALOGPAGE:MY_CATALOG');
    });

    it('addTileToGroup constructs composite chipId', async () => {
      const http = mockHttp(
        odataSingle({
          pageId: 'MY_GROUP',
          instanceId: 'TILE123',
          chipId: 'X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:CATALOG:TILE123',
          title: '',
          configuration: '{"tileConfiguration":"{}"}',
        }),
      );

      await addTileToGroup(http, unrestrictedSafetyConfig(), 'MY_GROUP', 'CATALOG', 'TILE123');

      const payload = JSON.parse(vi.mocked(http.post).mock.calls[0]![1] as string);
      expect(payload.chipId).toBe('X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:CATALOG:TILE123');
      expect(payload.pageId).toBe('MY_GROUP');
    });

    it('deleteCatalog sends DELETE with encoded key', async () => {
      const http = mockHttp('');

      await deleteCatalog(http, unrestrictedSafetyConfig(), 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST');

      expect(http.delete).toHaveBeenCalledWith(
        expect.stringContaining("Catalogs('X-SAP-UI2-CATALOGPAGE%3AZARC1_TEST')"),
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });

    it('createGroup sends correct payload', async () => {
      const http = mockHttp(
        odataSingle({
          id: 'ZARC1_GROUP',
          title: 'ARC1 Group',
          catalogId: '/UI2/FLPD_CATALOG',
          layout: '',
        }),
      );

      await createGroup(http, unrestrictedSafetyConfig(), 'ZARC1_GROUP', 'ARC1 Group');

      expect(http.post).toHaveBeenCalledWith(
        `${FLP_SERVICE_PATH}/Pages`,
        JSON.stringify({ id: 'ZARC1_GROUP', title: 'ARC1 Group', catalogId: '/UI2/FLPD_CATALOG', layout: '' }),
        'application/json',
        expect.objectContaining({ Accept: 'application/json' }),
      );
    });
  });

  describe('normalizeCatalogId', () => {
    it('strips X-SAP-UI2-CATALOGPAGE: prefix', () => {
      expect(normalizeCatalogId('X-SAP-UI2-CATALOGPAGE:MY_CATALOG')).toBe('MY_CATALOG');
    });

    it('passes through domain ID unchanged', () => {
      expect(normalizeCatalogId('MY_CATALOG')).toBe('MY_CATALOG');
    });

    it('handles domain IDs with slashes', () => {
      expect(normalizeCatalogId('/UI2/CATALOG_ALL')).toBe('/UI2/CATALOG_ALL');
    });

    it('strips prefix from IDs with slashes', () => {
      expect(normalizeCatalogId('X-SAP-UI2-CATALOGPAGE:/UI2/CATALOG_ALL')).toBe('/UI2/CATALOG_ALL');
    });
  });

  describe('catalog ID normalization in functions', () => {
    it('listTiles accepts full catalog ID and strips prefix', async () => {
      const http = mockHttp(odataCollection([]));
      await listTiles(http, unrestrictedSafetyConfig(), 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG');

      const calledUrl = vi.mocked(http.get).mock.calls[0]![0] as string;
      expect(calledUrl).toContain("'X-SAP-UI2-CATALOGPAGE%3AMY_CATALOG'");
      expect(calledUrl).not.toContain('CATALOGPAGE%3AX-SAP-UI2-CATALOGPAGE');
    });

    it('createTile accepts full catalog ID and strips prefix', async () => {
      const http = mockHttp(odataSingle({ pageId: '', instanceId: '', chipId: '', title: '', configuration: '' }));
      await createTile(http, unrestrictedSafetyConfig(), 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG', {
        id: 'tile-1',
        title: 'Test',
        semanticObject: 'ZSO',
        semanticAction: 'display',
      });

      const payload = JSON.parse(vi.mocked(http.post).mock.calls[0]![1] as string);
      expect(payload.pageId).toBe('X-SAP-UI2-CATALOGPAGE:MY_CATALOG');
    });

    it('addTileToGroup accepts full catalog ID and strips prefix', async () => {
      const http = mockHttp(odataSingle({ pageId: '', instanceId: '', chipId: '', title: '', configuration: '' }));
      await addTileToGroup(http, unrestrictedSafetyConfig(), 'GRP', 'X-SAP-UI2-CATALOGPAGE:CAT', 'TILE1');

      const payload = JSON.parse(vi.mocked(http.post).mock.calls[0]![1] as string);
      expect(payload.chipId).toBe('X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:CAT:TILE1');
    });
  });
});
