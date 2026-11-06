import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchDiscoveryDocument,
  hasNhiWorkspace,
  resolveAcceptType,
  resolveContentType,
} from '../../../src/adt/discovery.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { parseDiscoveryDocument, parseDiscoveryObject, parseXml } from '../../../src/adt/xml-parser.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

describe('ADT Discovery', () => {
  describe('parseDiscoveryDocument', () => {
    it('retains the listed display-only collections without inventing MIME types (#950)', () => {
      const map = parseDiscoveryDocument(loadFixture('discovery-display-only.xml'));
      for (const path of ['/ddic/domains', '/ddic/tabletypes', '/ddic/lockobjects/sources']) {
        expect(map.get(`/sap/bc/adt${path}`)).toEqual([]);
        expect(resolveAcceptType(map, `/sap/bc/adt${path}`)).toBeUndefined();
      }
      expect(map.has('/sap/bc/adt/ddic/tables')).toBe(false);
    });

    it.each(['', '<app:accept/>', '<app:accept>  </app:accept>'])(
      'retains a collection with no usable media type: %s',
      (accept) => {
        const xml = `<app:service><app:workspace><app:collection href="/sap/bc/adt/ddic/domains">${accept}</app:collection></app:workspace></app:service>`;
        expect(parseDiscoveryDocument(xml).get('/sap/bc/adt/ddic/domains')).toEqual([]);
      },
    );

    it.each([true, false])('an empty duplicate preserves the advertised MIME type (empty first: %s)', (emptyFirst) => {
      const empty = '<app:collection href="/sap/bc/adt/ddic/domains"><app:accept/></app:collection>';
      const typed =
        '<app:collection href="/sap/bc/adt/ddic/domains"><app:accept>application/xml</app:accept></app:collection>';
      const xml = `<app:service><app:workspace>${emptyFirst ? empty + typed : typed + empty}</app:workspace></app:service>`;
      expect(parseDiscoveryDocument(xml).get('/sap/bc/adt/ddic/domains')).toEqual(['application/xml']);
    });

    it('maps pre-parsed XML identically, preserving duplicate and MIME normalization behavior', () => {
      const xml = loadFixture('discovery.xml');
      expect(parseDiscoveryObject(parseXml(xml))).toEqual(parseDiscoveryDocument(xml));
      expect(parseDiscoveryObject({})).toEqual(new Map());
      expect(parseDiscoveryObject({ service: { workspace: [null] } })).toEqual(new Map());
    });
    it('parses fixture into expected map size', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.size).toBe(10);
    });

    it('returns multiple accepts in order', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.get('/sap/bc/adt/oo/classes')).toEqual([
        'application/vnd.sap.adt.oo.classes.v2+xml',
        'application/vnd.sap.adt.oo.classes.v4+xml',
        'text/html',
      ]);
    });

    it('retains collection presence without accepts', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.get('/sap/bc/adt/activation')).toEqual([]);
    });

    it('returns single accept as one-element array', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.get('/sap/bc/adt/ddic/domains')).toEqual(['application/vnd.sap.adt.domains.v2+xml']);
    });

    it('normalizes absolute href URLs to ADT paths', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.has('/sap/bc/adt/oo/interfaces')).toBe(true);
    });

    it('returns empty map for empty XML', () => {
      expect(parseDiscoveryDocument('')).toEqual(new Map());
    });

    it('returns empty map for malformed XML without throwing', () => {
      expect(parseDiscoveryDocument('<app:service><app:workspace>')).toEqual(new Map());
    });

    it('skips collections missing href', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.has('')).toBe(false);
      expect(map.size).toBe(10);
    });

    it('preserves MIME types exactly', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      const types = map.get('/sap/bc/adt/functions/groups');
      expect(types).toEqual([
        'application/vnd.sap.adt.functions.groups.v1+xml',
        'application/vnd.sap.adt.functions.groups.v3+xml',
      ]);
    });

    it('overwrites duplicate href with latest collection', () => {
      const xml = loadFixture('discovery.xml');
      const map = parseDiscoveryDocument(xml);
      expect(map.get('/sap/bc/adt/programs/programs')).toEqual([
        'application/vnd.sap.adt.programs.programs.v2+xml',
        'text/plain',
      ]);
    });
  });

  describe('fetchDiscoveryDocument', () => {
    function mockClient(getImpl: (path: string, headers?: Record<string, string>) => Promise<{ body: string }>) {
      return { get: vi.fn().mockImplementation(getImpl) } as unknown as AdtHttpClient;
    }

    it('fetches and parses discovery document successfully', async () => {
      const xml = loadFixture('discovery.xml');
      const client = mockClient(async () => ({ body: xml }));
      const { map } = await fetchDiscoveryDocument(client);
      expect(map.size).toBe(10);
      expect((client as any).get).toHaveBeenCalledWith(
        '/sap/bc/adt/discovery',
        { Accept: 'application/atomsvc+xml' },
        { probe: true },
      );
    });

    it('returns empty map on 404', async () => {
      const client = mockClient(async () => {
        throw { statusCode: 404 };
      });
      const { map } = await fetchDiscoveryDocument(client);
      expect(map).toEqual(new Map());
    });

    it('returns empty map on 406', async () => {
      const client = mockClient(async () => {
        throw { statusCode: 406 };
      });
      const { map } = await fetchDiscoveryDocument(client);
      expect(map).toEqual(new Map());
    });

    it('returns empty map on network errors', async () => {
      const client = mockClient(async () => {
        throw new Error('ECONNRESET');
      });
      const { map } = await fetchDiscoveryDocument(client);
      expect(map).toEqual(new Map());
    });

    it('sets nhiPresent=true when NHI hrefs appear in discovery XML', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <app:workspace>
    <atom:title>HANA-Integration</atom:title>
    <app:collection href="/sap/bc/adt/nhi/repositories">
      <atom:title>NHI Repositories</atom:title>
    </app:collection>
  </app:workspace>
</app:service>`;
      const client = mockClient(async () => ({ body: xml }));
      const { map, nhiPresent } = await fetchDiscoveryDocument(client);
      expect(nhiPresent).toBe(true);
      expect(map.size).toBe(1); // NHI collection presence survives without <app:accept>.
    });

    it('sets nhiPresent=false when NHI hrefs are absent', async () => {
      const xml = loadFixture('discovery.xml');
      const client = mockClient(async () => ({ body: xml }));
      const { nhiPresent } = await fetchDiscoveryDocument(client);
      expect(nhiPresent).toBe(false);
    });

    it('sets nhiPresent=false when discovery fails', async () => {
      const client = mockClient(async () => {
        throw new Error('ECONNRESET');
      });
      const { nhiPresent } = await fetchDiscoveryDocument(client);
      expect(nhiPresent).toBe(false);
    });
  });

  describe('hasNhiWorkspace', () => {
    it('returns true when NHI href is present (relative)', () => {
      expect(hasNhiWorkspace('<app:collection href="/sap/bc/adt/nhi/repositories">')).toBe(true);
    });

    it('returns true for an NHI href with absolute URL prefix', () => {
      // Some SAP servers emit absolute hrefs in the discovery document.
      expect(hasNhiWorkspace('<app:collection href="https://server.example.com/sap/bc/adt/nhi/repos">')).toBe(true);
    });

    it('is namespace-prefix agnostic and tolerates whitespace around the equals sign', () => {
      expect(hasNhiWorkspace('<collection href = "/sap/bc/adt/nhi/repos">')).toBe(true);
      expect(hasNhiWorkspace("<atom:link href='/sap/bc/adt/nhi/repos'/>")).toBe(true);
    });

    it('returns false for standard ADT hrefs', () => {
      expect(hasNhiWorkspace('<app:collection href="/sap/bc/adt/oo/classes">')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasNhiWorkspace('')).toBe(false);
    });

    // ─── False-positive guards (regex anchored to href= attribute context) ─

    it('returns false when the path appears as bare text (not inside an href)', () => {
      // The previous lax substring match would have returned true here.
      expect(hasNhiWorkspace('/sap/bc/adt/nhi/configurations')).toBe(false);
    });

    it('returns false when the path appears in <atom:title> text', () => {
      // Defensive: a workspace title that mentions the NHI path verbatim must not signal HANA.
      expect(hasNhiWorkspace('<atom:title>NHI lives at /sap/bc/adt/nhi/configurations</atom:title>')).toBe(false);
    });

    it('returns false when the path appears in a non-href attribute', () => {
      // `data-path`, `id`, etc. mentioning the path must not count.
      expect(hasNhiWorkspace('<a data-path="/sap/bc/adt/nhi/foo">link</a>')).toBe(false);
    });

    it('returns false when the path is missing the leading slash inside href', () => {
      // Defensive: `href="sap/bc/adt/nhi/..."` is invalid for an absolute server path.
      expect(hasNhiWorkspace('<app:collection href="sap/bc/adt/nhi/repos">')).toBe(false);
    });
  });

  describe('resolveAcceptType / resolveContentType', () => {
    it.each([resolveAcceptType, resolveContentType])(
      'empty entries do not shadow usable parent MIME types',
      (resolve) => {
        const map = new Map<string, string[]>([
          ['/sap/bc/adt/ddic', ['application/xml']],
          ['/sap/bc/adt/ddic/domains', []],
        ]);
        expect(resolve(map, '/sap/bc/adt/ddic/domains')).toBe('application/xml');
        // Parent fallback is still shallow; no MIME type is inferred for an object or its source.
        expect(resolve(map, '/sap/bc/adt/ddic/domains/ZTEST')).toBeUndefined();
        expect(resolve(map, '/sap/bc/adt/ddic/domains/ZTEST/source/main')).toBeUndefined();
      },
    );

    it('resolves exact path matches', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
      ]);
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes')).toBe('application/vnd.sap.adt.oo.classes.v4+xml');
    });

    it('resolves one-level-deep path (object metadata)', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
      ]);
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes/ZCL_FOO')).toBe(
        'application/vnd.sap.adt.oo.classes.v4+xml',
      );
    });

    it('does NOT resolve deep sub-resource paths (source/main)', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
      ]);
      // Discovery MIME types are for collection/metadata, not source code sub-resources
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes/ZCL_FOO/source/main')).toBeUndefined();
    });

    it('uses longest shallow match', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo', ['application/vnd.sap.adt.oo.v1+xml']],
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
      ]);
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes/ZCL_FOO')).toBe(
        'application/vnd.sap.adt.oo.classes.v4+xml',
      );
    });

    it('returns undefined when no collection matches', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
      ]);
      expect(resolveAcceptType(map, '/sap/bc/adt/unknown/path')).toBeUndefined();
    });

    it('returns undefined for an empty discovery map', () => {
      expect(resolveAcceptType(new Map(), '/sap/bc/adt/oo/classes')).toBeUndefined();
    });

    it('resolveContentType returns first type for shallow match', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/ddic/ddl/sources', ['application/vnd.sap.adt.ddic.ddl.sources.v2+xml', 'application/*']],
      ]);
      expect(resolveContentType(map, '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL')).toBe(
        'application/vnd.sap.adt.ddic.ddl.sources.v2+xml',
      );
      // Deep sub-resources should NOT match
      expect(resolveContentType(map, '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL/source/main')).toBeUndefined();
    });

    it('resolves independently across multiple collections', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']],
        ['/sap/bc/adt/programs/programs', ['application/vnd.sap.adt.programs.programs.v2+xml']],
      ]);
      // One level deep (object metadata) — matches
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes/ZCL_FOO')).toBe(
        'application/vnd.sap.adt.oo.classes.v4+xml',
      );
      expect(resolveAcceptType(map, '/sap/bc/adt/programs/programs/ZREP')).toBe(
        'application/vnd.sap.adt.programs.programs.v2+xml',
      );
      // Deep sub-resources — no match
      expect(resolveAcceptType(map, '/sap/bc/adt/oo/classes/ZCL_FOO/source/main')).toBeUndefined();
    });

    it('ignores query parameters during matching', () => {
      const map = new Map<string, string[]>([
        ['/sap/bc/adt/repository/informationsystem/search', ['application/vnd.sap.adt.repository.search.v1+xml']],
      ]);
      expect(
        resolveAcceptType(map, '/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=ZCL*'),
      ).toBe('application/vnd.sap.adt.repository.search.v1+xml');
    });
  });
});
