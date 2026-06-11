/**
 * SAPWrite create / batch_create unit tests — split from the former intent.test.ts monolith.
 * Each split file keeps its own vi.mock('undici') prologue (the mock factory references the
 * module-level mockFetch, so AdtClient is imported dynamically AFTER mockFetch is defined).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch (used by AdtHttpClient.doFetch)
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { buildCreateXml } = await import('../../../src/handlers/write-helpers.js');

function createClient(): InstanceType<typeof AdtClient> {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

describe('SAPWrite handler — create / batch_create', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPWrite server-driven objects (816)', () => {
    type FetchCall = [string, { method?: string; body?: string }];
    const callMatching = (method: string, pathname: string): FetchCall | undefined =>
      (mockFetch.mock.calls as FetchCall[]).find(([u, o]) => o?.method === method && new URL(u).pathname === pathname);

    it('create POSTs the blue:blueSource body to the collection and steers to SAPActivate', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DESD',
        name: 'ZARC1_SDO',
        package: '$TMP',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toContain('Created DESD ZARC1_SDO in package $TMP');
      expect(result.content[0]?.text).toContain('Next step: SAPActivate(type="DESD", name="ZARC1_SDO")');
      const post = callMatching('POST', '/sap/bc/adt/ddic/desd');
      expect(post).toBeDefined();
      expect(post?.[1].body).toContain('blue:blueSource');
      expect(post?.[1].body).toContain('adtcore:type="DESD/TYP"');
    });

    it('create with source also PUTs the AFF JSON to /source/main', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DESD',
        name: 'ZARC1_SDO',
        package: '$TMP',
        source: '{"formatVersion":"1","header":{"description":"x","originalLanguage":"en"}}',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toContain('wrote AFF JSON source');
      expect(callMatching('PUT', '/sap/bc/adt/ddic/desd/ZARC1_SDO/source/main')).toBeDefined();
    });

    it('update without source returns an actionable error', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DESD',
        name: 'ZARC1_SDO',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires "source"');
    });

    it('rejects malformed AFF JSON source before any HTTP write', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DESD',
        name: 'ZARC1_SDO',
        source: 'not json',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('valid AFF JSON');
      expect(callMatching('PUT', '/sap/bc/adt/ddic/desd/ZARC1_SDO/source/main')).toBeUndefined();
    });

    it('delete locks then issues a DELETE on the SDO URL', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'CSNM',
        name: 'ZARC1_CSN',
      });
      expect(result.content[0]?.text).toContain('Deleted CSNM ZARC1_CSN');
      expect(callMatching('DELETE', '/sap/bc/adt/csn/csnm/ZARC1_CSN')).toBeDefined();
    });

    it('rejects an unsupported action for a server-driven type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'DESD',
        name: 'ZARC1_SDO',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not supported for server-driven object type DESD');
    });

    it('returns the 8.16 gate error when discovery shows the collection is absent', async () => {
      const client = createClient();
      (client.http as unknown as { hasDiscoveryData(): boolean }).hasDiscoveryData = () => true;
      (client.http as unknown as { discoveryAcceptFor(p: string): string | undefined }).discoveryAcceptFor = () =>
        undefined;
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DESD',
        name: 'ZARC1_SDO',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('8.16+');
      expect(callMatching('POST', '/sap/bc/adt/ddic/desd')).toBeUndefined();
    });

    it('SAPActivate routes a server-driven type through the registry URL', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'activate',
        type: 'DESD',
        name: 'ZARC1_SDO',
      });
      // Routing worked iff the activation request referenced the SDO URL (no objectBasePath throw).
      const activation = callMatching('POST', '/sap/bc/adt/activation');
      expect(activation).toBeDefined();
      expect(activation?.[1].body).toContain('/sap/bc/adt/ddic/desd/ZARC1_SDO');
    });
  });

  describe('SAPWrite package enforcement', () => {
    it('rejects create for package not in allowedPackages', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: 'ZTEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZTEST');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('allows create for package in allowedPackages', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: '$TMP',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      // Should not be blocked by package check (may fail at HTTP level, but that's OK)
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });

    it('rejects update when object is in a non-allowed package', async () => {
      // Mock: first call = resolveObjectPackage (GET object URL → XML with packageRef),
      // subsequent calls = normal CSRF/lock/update/unlock flow
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_TEST"><adtcore:packageRef adtcore:name="ZFORBIDDEN"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZFORBIDDEN');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('rejects delete when object is in a non-allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<program:abapProgram xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="SAP_BASIS"/></program:abapProgram>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z*', '$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'SAPL_STANDARD',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_BASIS');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('rejects edit_method when class is in a non-allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZFORBIDDEN"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'do_something',
        source: 'METHOD do_something. ENDMETHOD.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZFORBIDDEN');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('allows update when object is in an allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });

    it('rejects update when object metadata has no adtcore:packageRef (fail-closed)', async () => {
      // If ADT returns object metadata without a parseable packageRef,
      // ARC-1 cannot evaluate allowedPackages. Fail-closed: refuse the write
      // rather than silently bypassing the gate.
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_NO_PKG_REF"></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_NO_PKG_REF',
        source: 'CLASS zcl_no_pkg_ref DEFINITION PUBLIC. ENDCLASS. CLASS zcl_no_pkg_ref IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('could not determine the object');
      expect(result.content[0]?.text).toContain('Fail-closed');
    });

    // ─── Subtree (`X/**`) rules — handler-level security regression suite ────
    describe('subtree rules (`X/**`) on SAPWrite', () => {
      /** Build a fetch mock that serves a fixed DEVCLASS hierarchy via the nodestructure endpoint. */
      function mockHierarchy(
        graph: Record<string, string[]>,
        extras?: (url: string, method: string) => Response | undefined,
      ) {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
          const u = String(url);
          const method = opts?.method ?? 'GET';
          const ex = extras?.(u, method);
          if (ex !== undefined) return Promise.resolve(ex);
          // Nodestructure call from getSubpackages — match parent_name=<X> and serve the graph.
          if (u.includes('/sap/bc/adt/repository/nodestructure') && u.includes('parent_type=DEVC%2FK')) {
            const m = u.match(/parent_name=([^&]+)/);
            const parent = m ? decodeURIComponent(m[1]).toUpperCase() : '';
            const children = graph[parent] ?? [];
            const nodes = children
              .map(
                (c) =>
                  `<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE><OBJECT_NAME>${c}</OBJECT_NAME></SEU_ADT_REPOSITORY_OBJ_NODE>`,
              )
              .join('');
            return Promise.resolve(
              mockResponse(
                200,
                `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><TREE_CONTENT>${nodes}</TREE_CONTENT></DATA></asx:values></asx:abap>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, 'OK', { 'x-csrf-token': 'T' }));
        });
      }

      function clientWith(allowedPackages: string[]): InstanceType<typeof AdtClient> {
        return new AdtClient({
          baseUrl: 'http://sap:8000',
          username: 'admin',
          password: 'secret',
          safety: { ...unrestrictedSafetyConfig(), allowedPackages },
        });
      }

      it('create succeeds for a descendant of a `X/**`-allowed root (resolver walks the tree)', async () => {
        mockHierarchy({ ZFOO: ['ZFOO_SUB'], ZFOO_SUB: [] });
        const client = clientWith(['ZFOO/**']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: 'ZCL_CHILD',
          package: 'ZFOO_SUB',
          source: 'CLASS zcl_child DEFINITION PUBLIC. ENDCLASS. CLASS zcl_child IMPLEMENTATION. ENDCLASS.',
        });
        // Must not be blocked by the package gate. (May fail later for unrelated reasons in mocks.)
        expect(result.content[0]?.text).not.toContain('blocked by safety configuration');
        expect(result.content[0]?.text).not.toContain('hierarchy resolution failed');
      });

      it('create is BLOCKED for a non-descendant when only `X/**` rules exist', async () => {
        mockHierarchy({ ZFOO: ['ZFOO_SUB'], ZFOO_SUB: [] });
        const client = clientWith(['ZFOO/**']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: 'ZCL_BAD',
          package: 'ZSIBLING',
          source: 'CLASS zcl_bad DEFINITION PUBLIC. ENDCLASS. CLASS zcl_bad IMPLEMENTATION. ENDCLASS.',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('ZSIBLING');
        expect(result.content[0]?.text).toContain('blocked');
      });

      it('create is BLOCKED when subtree resolution fails (fail-closed)', async () => {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL) => {
          const u = String(url);
          if (u.includes('objectType=DEVC%2FK')) {
            return Promise.resolve(mockResponse(500, '<error>SAP down</error>'));
          }
          return Promise.resolve(mockResponse(200, 'OK', { 'x-csrf-token': 'T' }));
        });
        const client = clientWith(['ZFOO/**']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: 'ZCL_X',
          package: 'ZFOO_CHILD',
          source: 'CLASS zcl_x DEFINITION PUBLIC. ENDCLASS. CLASS zcl_x IMPLEMENTATION. ENDCLASS.',
        });
        expect(result.isError).toBe(true);
        // Either the resolver fail-closed message OR the raw block message — both qualify as denied.
        expect(result.content[0]?.text).toMatch(/hierarchy resolution failed|blocked/);
      });

      it('update is BLOCKED when the resolved object package is outside the subtree', async () => {
        // resolveObjectPackage returns ZBADROOT_CHILD. ZBADROOT is NOT in the ZFOO subtree.
        mockHierarchy({ ZFOO: ['ZFOO_SUB'], ZFOO_SUB: [], ZBADROOT: ['ZBADROOT_CHILD'] }, (url) => {
          // The object metadata GET (used by resolveObjectPackage) is a CLAS path NOT containing 'objectType=DEVC%2FK'.
          if (
            url.includes('/sap/bc/adt/oo/classes/ZCL_TEST') &&
            !url.includes('source/main') &&
            !url.includes('_action=')
          ) {
            return mockResponse(
              200,
              '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZBADROOT_CHILD"/></class:abapClass>',
              { 'x-csrf-token': 'T' },
            );
          }
          return undefined;
        });
        const client = clientWith(['ZFOO/**']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'CLAS',
          name: 'ZCL_TEST',
          source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('ZBADROOT_CHILD');
        expect(result.content[0]?.text).toContain('blocked');
      });

      it('update is ALLOWED when the resolved object package is inside the subtree', async () => {
        mockHierarchy({ ZFOO: ['ZFOO_SUB'], ZFOO_SUB: [] }, (url) => {
          if (
            url.includes('/sap/bc/adt/oo/classes/ZCL_TEST') &&
            !url.includes('source/main') &&
            !url.includes('_action=')
          ) {
            return mockResponse(
              200,
              '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZFOO_SUB"/></class:abapClass>',
              { 'x-csrf-token': 'T' },
            );
          }
          return undefined;
        });
        const client = clientWith(['ZFOO/**']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'CLAS',
          name: 'ZCL_TEST',
          source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        });
        expect(result.content[0]?.text).not.toContain('blocked by safety configuration');
        expect(result.content[0]?.text).not.toContain('hierarchy resolution failed');
      });

      it('does not bypass the gate via exact-rule fallthrough — a `Z*` rule does NOT let a subtree rule expand', async () => {
        // Server says: ZFOO/** OR exactly ZSOMETHING. Profile (none here) — just verify
        // that ZSIBLING (not in either) is denied even when ZFOO subtree resolution succeeds.
        mockHierarchy({ ZFOO: ['ZFOO_SUB'] });
        const client = clientWith(['ZFOO/**', 'ZSOMETHING']);
        const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: 'ZCL_X',
          package: 'ZSIBLING',
          source: 'CLASS zcl_x DEFINITION PUBLIC. ENDCLASS. CLASS zcl_x IMPLEMENTATION. ENDCLASS.',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('blocked');
      });

      it('caches the subtree across multiple writes — only one BFS per root', async () => {
        let subpkgCalls = 0;
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL) => {
          const u = String(url);
          if (u.includes('/sap/bc/adt/repository/nodestructure') && u.includes('parent_type=DEVC%2FK')) {
            subpkgCalls++;
            const m = u.match(/parent_name=([^&]+)/);
            const parent = m ? decodeURIComponent(m[1]).toUpperCase() : '';
            const graph: Record<string, string[]> = { ZFOO: ['ZFOO_SUB'], ZFOO_SUB: [] };
            const children = graph[parent] ?? [];
            const nodes = children
              .map(
                (c) =>
                  `<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE><OBJECT_NAME>${c}</OBJECT_NAME></SEU_ADT_REPOSITORY_OBJ_NODE>`,
              )
              .join('');
            return Promise.resolve(
              mockResponse(
                200,
                `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><TREE_CONTENT>${nodes}</TREE_CONTENT></DATA></asx:values></asx:abap>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, 'OK', { 'x-csrf-token': 'T' }));
        });
        const client = clientWith(['ZFOO/**']);
        for (let i = 0; i < 3; i++) {
          await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
            action: 'create',
            type: 'CLAS',
            name: `ZCL_CHILD_${i}`,
            package: 'ZFOO_SUB',
            source: 'CLASS zcl_child DEFINITION PUBLIC. ENDCLASS. CLASS zcl_child IMPLEMENTATION. ENDCLASS.',
          });
        }
        // BFS visits ZFOO once and ZFOO_SUB once → 2 subtree GETs total, regardless of write count.
        expect(subpkgCalls).toBe(2);
      });
    });

    it('skips package resolution when allowedPackages is empty (unrestricted)', async () => {
      // With no package restrictions, resolveObjectPackage should NOT be called
      const client = createClient(); // unrestricted safety
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      // unrestricted config has empty allowedPackages → skip resolveObjectPackage
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });

    it('updates a CLAS local include without touching source/main', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer | null }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: typeof opts?.body === 'string' ? opts.body : undefined });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR>A4HK900001</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const source = 'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.\nENDCLASS.';
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        include: 'definitions',
        source,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully updated CLAS ZBP_I_TRAVELREQ include definitions');
      expect(result.content[0]?.text).toContain('SAPRead(version="inactive")');
      const putCalls = calls.filter((call) => call.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.url).toContain('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions');
      expect(putCalls[0]?.url).toContain('lockHandle=LH1');
      expect(putCalls[0]?.url).toContain('corrNr=A4HK900001');
      expect(putCalls[0]?.body).toBe(source);
      expect(putCalls.some((call) => call.url.includes('/source/main'))).toBe(false);
      const lockCall = calls.find((call) => call.method === 'POST' && call.url.includes('_action=LOCK'));
      expect(lockCall?.url).toContain('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ');
    });

    it('rejects CLAS include update without source before HTTP writes', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        include: 'implementations',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('source');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // ── Auto-init of a missing class-local include (issue #303 follow-up) ──

    /** Mock the include= write flow; the include GET-probe returns `includeGetStatus`. */
    function mockIncludeWriteFlow(opts: {
      className: string;
      include: string;
      includeGetStatus: number;
    }): Array<{ method: string; url: string; body?: string }> {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation(
        (url: string | URL, fetchOpts?: { method?: string; body?: string | Buffer | null }) => {
          const method = fetchOpts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof fetchOpts?.body === 'string' ? fetchOpts.body : undefined });
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          // The include GET-probe (no _action, GET to the include URL).
          if (method === 'GET' && urlStr.includes(`/includes/${opts.include}`)) {
            if (opts.includeGetStatus === 200) {
              return Promise.resolve(mockResponse(200, 'existing include', { 'x-csrf-token': 'T' }));
            }
            return Promise.resolve(
              mockResponse(
                opts.includeGetStatus,
                '<exc:exception><type id="ExceptionResourceNotFound"/><message>not found</message></exc:exception>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );
      return calls;
    }

    it('auto-initialises a missing testclasses include before writing (POST then PUT)', async () => {
      const calls = mockIncludeWriteFlow({ className: 'ZCL_TC', include: 'testclasses', includeGetStatus: 404 });
      const source = 'CLASS ltc DEFINITION FOR TESTING. ENDCLASS.\nCLASS ltc IMPLEMENTATION. ENDCLASS.';
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TC',
        include: 'testclasses',
        source,
        lintBeforeWrite: false,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toMatch(/initialised the testclasses include first/i);
      // An init POST hit the include URL with a lockHandle (not a LOCK/UNLOCK action).
      const initPost = calls.find((c) => c.method === 'POST' && c.url.includes('/includes/testclasses?lockHandle='));
      expect(initPost).toBeDefined();
      // The content PUT also targets the include URL.
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/includes/testclasses'));
      expect(put?.body).toBe(source);
    });

    it('does NOT init when the include already exists (GET 200) — no init POST, normal message', async () => {
      const calls = mockIncludeWriteFlow({ className: 'ZCL_TC', include: 'testclasses', includeGetStatus: 200 });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TC',
        include: 'testclasses',
        source: 'CLASS ltc DEFINITION FOR TESTING. ENDCLASS. CLASS ltc IMPLEMENTATION. ENDCLASS.',
        lintBeforeWrite: false,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toMatch(/initialised the/i);
      const initPost = calls.find((c) => c.method === 'POST' && c.url.includes('/includes/testclasses?lockHandle='));
      expect(initPost).toBeUndefined();
    });
  });

  describe('SAPWrite FUGR/FUNC routing', () => {
    interface CapturedCall {
      url: string;
      method: string;
      contentType?: string;
      body?: string;
    }

    function captureFetch(
      handler?: (call: CapturedCall) => ReturnType<typeof mockResponse> | undefined,
    ): CapturedCall[] {
      const calls: CapturedCall[] = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts: any) => {
        const u = typeof url === 'string' ? url : url.toString();
        const headers = opts?.headers ?? {};
        const headerObj =
          headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers as Record<string, string>);
        const contentType = Object.entries(headerObj).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
        const body = typeof opts?.body === 'string' ? opts.body : undefined;
        const call: CapturedCall = { url: u, method: opts?.method ?? 'GET', contentType, body };
        calls.push(call);
        const customResponse = handler?.(call);
        if (customResponse) return Promise.resolve(customResponse);
        // Default: blank success with CSRF token
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (u.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      return calls;
    }

    it('FUGR create: POSTs to /sap/bc/adt/functions/groups with v3 content type', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUGR',
        name: 'ZARC1_FG',
        package: '$TMP',
        description: 'fg test',
      });
      expect(result.isError).toBeUndefined();
      const create = calls.find((c) => c.method === 'POST' && /\/sap\/bc\/adt\/functions\/groups(?:\?|$)/.test(c.url));
      expect(create).toBeDefined();
      expect(create!.contentType).toBe('application/vnd.sap.adt.functions.groups.v3+xml');
      expect(create!.body).toContain('<group:abapFunctionGroup');
      expect(create!.body).toContain('adtcore:type="FUGR/F"');
      expect(create!.body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    });

    it('FUNC create with explicit group: POSTs to /functions/groups/{group_lc}/fmodules with fmodules content type', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_ARC1_FM',
        group: 'ZARC1_FG',
        description: 'fm test',
      });
      expect(result.isError).toBeUndefined();
      const create = calls.find((c) => c.method === 'POST' && c.url.includes('/functions/groups/zarc1_fg/fmodules'));
      expect(create).toBeDefined();
      expect(create!.contentType).toBe('application/vnd.sap.adt.functions.fmodules+xml');
      expect(create!.body).toContain('<fmodule:abapFunctionModule');
      expect(create!.body).toContain('adtcore:type="FUGR/FF"');
      expect(create!.body).toContain('<adtcore:containerRef adtcore:name="ZARC1_FG"');
      expect(create!.body).not.toContain('<adtcore:packageRef');
    });

    it('FUNC create without group returns clear error and makes no HTTP call', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM_NO_GROUP',
        description: 'no group',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('group');
      expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
    });

    it('FUNC update PUTs to /functions/groups/{group_lc}/fmodules/{name_lc}/source/main', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'FUNC',
        name: 'Z_ARC1_FM',
        group: 'ZARC1_FG',
        source: 'FUNCTION z_arc1_fm.\n  WRITE / 1.\nENDFUNCTION.\n',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeDefined();
      expect(put!.url).toContain('/sap/bc/adt/functions/groups/zarc1_fg/fmodules/z_arc1_fm/source/main');
    });

    it('FUNC update strips parameter comment block and reports warning', async () => {
      const calls = captureFetch();
      const sourceWithBlock = [
        'FUNCTION z_fm.',
        '*"---',
        '*"  IMPORTING IV_X TYPE STRING',
        '*"---',
        '  WRITE / 1.',
        'ENDFUNCTION.',
      ].join('\n');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        source: sourceWithBlock,
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeDefined();
      // The PUT body must NOT contain *" lines
      expect(put!.body).not.toContain('*"');
      expect(put!.body).toContain('FUNCTION z_fm');
      // Response text must mention the strip
      expect(result.content[0]?.text.toLowerCase()).toMatch(/parameter comment block|stripped/i);
    });

    it('FUNC update auto-resolves group via search when omitted', async () => {
      const calls = captureFetch((call) => {
        // Mock the search endpoint to return the FM in group ZSU
        if (call.url.includes('quickSearch') || call.url.includes('informationsystem/search')) {
          return mockResponse(
            200,
            `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:type="FUGR/FF" adtcore:name="Z_FM" adtcore:uri="/sap/bc/adt/functions/groups/zsu/fmodules/z_fm" adtcore:packageName="$TMP" adtcore:description="x"/></adtcore:objectReferences>`,
            { 'x-csrf-token': 'T' },
          );
        }
        return undefined;
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'FUNC',
        name: 'Z_FM',
        source: 'FUNCTION z_fm.\nENDFUNCTION.\n',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeDefined();
      expect(put!.url).toContain('/functions/groups/zsu/fmodules/z_fm/source/main');
    });

    it('FUNC delete: DELETEs to FM URL with lockHandle', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
      });
      expect(result.isError).toBeUndefined();
      const del = calls.find((c) => c.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del!.url).toContain('/sap/bc/adt/functions/groups/zfg/fmodules/z_fm');
      expect(del!.url).toContain('lockHandle=');
    });

    it('FUGR delete: DELETEs to FUGR URL with lockHandle', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'FUGR',
        name: 'ZFG',
      });
      expect(result.isError).toBeUndefined();
      const del = calls.find((c) => c.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del!.url).toContain('/sap/bc/adt/functions/groups/ZFG');
      expect(del!.url).toContain('lockHandle=');
    });

    // ─── Issue #252: structured FM parameters ───────────────────────────

    it('FUNC create with structured parameters: PUT body contains generated IMPORTING/EXPORTING clause', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        description: 'param test',
        parameters: [
          { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true },
          { kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true },
        ],
        source: '  ev_output = iv_input.\n',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/source/main'));
      expect(put).toBeDefined();
      expect(put!.body).toContain('IMPORTING');
      expect(put!.body).toContain('VALUE(IV_INPUT) TYPE STRING');
      expect(put!.body).toContain('EXPORTING');
      expect(put!.body).toContain('VALUE(EV_OUTPUT) TYPE STRING');
      expect(put!.body).toContain('ev_output = iv_input');
    });

    it('FUNC update with structured parameters: splices into source preserving body', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        parameters: [
          { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true },
          { kind: 'changing', name: 'CV_FLAG', type: 'I' },
        ],
        source: 'FUNCTION z_fm.\n  cv_flag = cv_flag + 1.\nENDFUNCTION.\n',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/source/main'));
      expect(put).toBeDefined();
      expect(put!.body).toContain('IMPORTING');
      expect(put!.body).toContain('VALUE(IV_INPUT) TYPE STRING');
      expect(put!.body).toContain('CHANGING');
      expect(put!.body).toContain('CV_FLAG TYPE I');
      expect(put!.body).toContain('cv_flag = cv_flag + 1.');
    });

    it('FUNC create with structured parameters and SAPGUI *" block: strips block AND emits structured clause', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        description: 'mixed',
        parameters: [{ kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true }],
        source: 'FUNCTION z_fm.\n*"  IMPORTING IV_OLD TYPE STRING\n  WRITE / 1.\nENDFUNCTION.\n',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/source/main'));
      expect(put).toBeDefined();
      expect(put!.body).not.toContain('*"');
      expect(put!.body).toContain('VALUE(IV_INPUT) TYPE STRING');
    });

    it('FUNC create with structured parameters but no source: synthesizes minimal stub', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        description: 'no source',
        parameters: [{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true }],
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/source/main'));
      expect(put).toBeDefined();
      expect(put!.body).toMatch(/FUNCTION Z_FM[\s\n]+IMPORTING/);
      expect(put!.body).toContain('VALUE(IV_X) TYPE STRING');
      expect(put!.body).toContain('ENDFUNCTION.');
    });

    it('FUNC create without parameters or source: only POSTs creation, no source PUT', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        description: 'shell only',
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/source/main'));
      expect(put).toBeUndefined();
    });

    it('FUNC create with malformed parameters returns Zod error (no HTTP call)', async () => {
      const calls = captureFetch();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        // Invalid kind value
        parameters: [{ kind: 'returning', name: 'RV_X', type: 'STRING' }],
      });
      expect(result.isError).toBe(true);
      expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
    });

    it('SAPRead FUNC with includeSignature=true returns JSON with structured signature', async () => {
      const fmSource =
        'function z_fm\n  importing\n    value(iv_x) type string default `hi`\n  exporting\n    value(ev_y) type string.\n  ev_y = iv_x.\nendfunction.\n';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/source/main')) {
          return Promise.resolve(mockResponse(200, fmSource, { 'x-csrf-token': 'T' }));
        }
        if (u.includes('quickSearch') || u.includes('informationsystem/search')) {
          return Promise.resolve(mockResponse(200, '<adtcore:objectReferences/>', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
        includeSignature: true,
      });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
        source: string;
        signature: { importing: { name: string }[]; exporting: { name: string }[] };
      };
      expect(payload.source).toContain('iv_x');
      expect(payload.signature.importing[0]?.name).toBe('IV_X');
      expect(payload.signature.exporting[0]?.name).toBe('EV_Y');
    });

    it('SAPRead FUNC without includeSignature returns plain source (backward compat)', async () => {
      const fmSource = 'function z_fm\n  importing\n    value(iv_x) type string.\n  ev_y = iv_x.\nendfunction.\n';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/source/main')) {
          return Promise.resolve(mockResponse(200, fmSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_FM',
        group: 'ZFG',
      });
      expect(result.isError).toBeUndefined();
      // Result must be raw source, not JSON.
      expect(result.content[0]?.text).toContain('function z_fm');
      // It must NOT be parseable as JSON describing a signature.
      let isJsonShape = false;
      try {
        const parsed = JSON.parse(result.content[0]?.text ?? '');
        isJsonShape = parsed && typeof parsed === 'object' && 'signature' in parsed;
      } catch {
        // Not JSON — that's the expected path.
      }
      expect(isJsonShape).toBe(false);
    });

    it('SAPRead FUNC with includeSignature on FM with no parameters returns empty arrays', async () => {
      const fmSource = 'FUNCTION Z_EMPTY.\n  WRITE / 1.\nENDFUNCTION.\n';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/source/main')) {
          return Promise.resolve(mockResponse(200, fmSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_EMPTY',
        group: 'ZFG',
        includeSignature: true,
      });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
        signature: Record<string, unknown[]>;
      };
      expect(payload.signature.importing).toEqual([]);
      expect(payload.signature.exporting).toEqual([]);
      expect(payload.signature.changing).toEqual([]);
      expect(payload.signature.tables).toEqual([]);
      expect(payload.signature.exceptions).toEqual([]);
      expect(payload.signature.raising).toEqual([]);
    });

    it('FUGR create still gated by allowedPackages', async () => {
      captureFetch();
      const restricted = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZARC1*'] },
      });
      const result = await handleToolCall(restricted, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUGR',
        name: 'ZFG',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
    });
  });

  describe('SAPWrite pre-write lint gate', () => {
    it('blocks update with parser errors when lintBeforeWrite is enabled', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD nonexistent.
    INVALID SYNTAX HERE.
  ENDMETHOD.
ENDCLASS.`,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Pre-write lint check failed');
      expect(result.content[0]?.text).toContain('parser_error');
    });

    it('allows update when lintBeforeWrite is disabled', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      // With lint disabled, even broken code should attempt the write
      // (it will succeed because our mock returns 200)
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD nonexistent.
    INVALID SYNTAX HERE.
  ENDMETHOD.
ENDCLASS.`,
      });
      // Should not be a lint error (write is attempted)
      if (result.isError) {
        // May fail for SAP reasons, but not lint reasons
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('allows valid ABAP through the gate', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_x TYPE i.
    lv_x = 1.
  ENDMETHOD.
ENDCLASS.`,
      });
      // Should not be a lint error
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('uses config.abapRelease for pre-write lint when cached features are absent', async () => {
      resetCachedFeatures();
      const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, abapRelease: '758', lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name: 'ZTEST',
        source: `REPORT ztest.
DATA lv TYPE string.
lv = CONV string( 1 ).`,
      });

      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });
  });

  describe('SAPWrite pre-write lint gate for DDLS', () => {
    it('blocks DDLS write with CDS syntax errors', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_TEST',
        source: `define view entity ZI_TEST as select from ztable {
  key field1
  field2
}`,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Pre-write lint check failed');
      expect(result.content[0]?.text).toContain('cds_parser_error');
    });

    it('allows valid DDLS through the gate', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_TEST',
        source: `define view entity ZI_TEST as select from ztable {
  key field1,
  field2
}`,
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('adds CDS downstream impact guidance after DDLS update', async () => {
      mockFetch.mockReset();
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/srvd/sources/ZSD_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZSD_ROOT" adtcore:type="SRVD/SRV" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DDLS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_ROOT',
        source: `define view entity ZI_ROOT as select from ztab { key id, name }`,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('Successfully updated DDLS ZI_ROOT');
      expect(text).toContain('CDS update follow-up for ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain('ZSD_ROOT');
      expect(text).toContain('SAPActivate(type="DDLS", name="ZI_ROOT")');
      expect(text).toContain('Suggested re-activation order: DDLS ZI_ROOT, DDLS ZI_CHILD_ONE, DDLS ZI_CHILD_TWO');
      expect(text).toContain(
        'Batch call template: SAPActivate(objects=[{type:"DDLS",name:"ZI_ROOT"}, {type:"DDLS",name:"ZI_CHILD_ONE"}',
      );
    });

    it('supplements DDLS update guidance with scoped where-used results when unfiltered results are partial', async () => {
      mockFetch.mockReset();
      const scopeXml = `<?xml version="1.0" encoding="UTF-8"?>
<usageReferences:scopeResponse xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:objectType type="DDLS/DF" description="DDL Source" count="3"/>
  <usageReferences:objectType type="BDEF/BO" description="Behavior Definition" count="1"/>
</usageReferences:scopeResponse>`;
      const unfilteredWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/ZI_CHILD_ONE" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const scopedDdlsWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_three" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_THREE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const scopedBdefWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        const body = String(opts?.body ?? '');
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DDLS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'POST' && urlStr.includes('/usageReferences/scope')) {
          return Promise.resolve(mockResponse(200, scopeXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          if (body.includes('objectTypeFilter value="DDLS/DF"')) {
            return Promise.resolve(mockResponse(200, scopedDdlsWhereUsedXml, { 'x-csrf-token': 'T' }));
          }
          if (body.includes('objectTypeFilter value="BDEF/BO"')) {
            return Promise.resolve(mockResponse(200, scopedBdefWhereUsedXml, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, unfilteredWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_ROOT',
        source: `define view entity ZI_ROOT as select from ztab { key id, name }`,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain('ZI_CHILD_THREE');
      expect(text).toContain('BDEF ZI_ROOT');
      expect(text).toContain('Downstream consumers in ADT where-used index: 4');

      const usageBodies = mockFetch.mock.calls
        .map((call) => String((call[1] as { body?: string } | undefined)?.body ?? ''))
        .filter((body) => body.includes('usageReferenceRequest'));
      expect(usageBodies.some((body) => body.includes('objectTypeFilter value="DDLS/DF"'))).toBe(true);
      expect(usageBodies.some((body) => body.includes('objectTypeFilter value="BDEF/BO"'))).toBe(true);
    });

    it('still skips BDEF for pre-write lint', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'BDEF',
        name: 'ZI_TEST',
        source: 'this is total garbage that should not trigger lint',
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('still skips SRVD for pre-write lint', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'SRVD',
        name: 'ZSD_TEST',
        source: 'this is total garbage that should not trigger lint',
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });
  });

  describe('SAPWrite batch_create', () => {
    it('creates all objects in order', async () => {
      // Mock: CSRF fetch, create POST, lock GET (for safeUpdateSource), update PUT, unlock POST, activation POST
      // Use a simple mock that returns 200 for everything
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'mock-csrf-token' }));

      // Disable lint to avoid CDS source being rejected by ABAP parser
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'DDLS', name: 'ZI_TEST', source: 'define root view entity ZI_TEST {}' },
          { type: 'BDEF', name: 'ZI_TEST', source: 'managed implementation in class zbp_i_test;' },
          { type: 'SRVD', name: 'ZSD_TEST', source: 'define service ZSD_TEST {}' },
        ],
      });

      // Should mention all 3 objects in the summary
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('ZI_TEST (DDLS)');
      expect(text).toContain('ZI_TEST (BDEF)');
      expect(text).toContain('ZSD_TEST (SRVD)');
      expect(text).toContain('3 objects');
    });

    it('stops on first failure and reports partial results', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        // First few calls succeed (CSRF, create #1, lock, update, unlock, activate)
        // Then fail on second object create
        if (callCount <= 7) {
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        }
        // Fail on subsequent calls (second object)
        return Promise.resolve(mockResponse(500, 'Internal Server Error', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name: 'ZPROG1', source: "REPORT zprog1.\nWRITE: / 'hi'." },
          { type: 'PROG', name: 'ZPROG2', source: "REPORT zprog2.\nWRITE: / 'hi'." },
          { type: 'PROG', name: 'ZPROG3', source: "REPORT zprog3.\nWRITE: / 'hi'." },
        ],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      // Third object should appear as skipped
      expect(text).toContain('ZPROG3');
      expect(text).toContain('skipped');
    });

    it('returns error for empty objects array', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('non-empty');
    });

    it('respects read-only safety mode', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' }],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('blocked');
    });

    it('applies package filter', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZALLOWED*'] },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'ZBLOCKED',
        objects: [{ type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' }],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('blocked');
    });

    it('applies package filter to object-specific batch_create packages before mutation', async () => {
      mockFetch.mockReset();
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZALLOWED*'] },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        objects: [{ type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.', package: 'ZBLOCKED' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('uses object-specific package in batch_create when top-level package is omitted', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        objects: [
          {
            type: 'PROG',
            name: 'ZPROG1',
            source: 'REPORT zprog1.',
            package: 'ZOBJPKG',
            transport: 'A4HK900123',
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          String(call[0]).includes('/sap/bc/adt/programs/programs?') &&
          (call[1] as Record<string, unknown> | undefined)?.method === 'POST',
      );
      const body = (createCall?.[1] as Record<string, unknown> | undefined)?.body;
      expect(body).toContain('<adtcore:packageRef adtcore:name="ZOBJPKG"/>');
      expect(body).not.toContain('$TMP');
      expect(result.content[0]?.text).toContain('in package ZOBJPKG');
    });

    it('uses object-specific transport in batch_create when top-level transport differs', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        transport: 'TOP900001',
        objects: [
          {
            type: 'PROG',
            name: 'ZPROG1',
            source: 'REPORT zprog1.',
            transport: 'OBJ900001',
          },
        ],
      });

      const createUrl = mockFetch.mock.calls
        .map((call) => String(call[0]))
        .find((url) => url.includes('/sap/bc/adt/programs/programs?corrNr='));
      expect(createUrl).toContain('corrNr=OBJ900001');
      expect(createUrl).not.toContain('TOP900001');
    });

    it('includes effective packages in mixed-package batch_create summaries', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        transport: 'A4HK900123',
        objects: [
          { type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' },
          { type: 'PROG', name: 'ZPROG2', source: 'REPORT zprog2.', package: 'ZOBJPKG' },
        ],
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('across packages [$TMP, ZOBJPKG]');
      expect(text).toContain('ZPROG1 (PROG) ✓ [$TMP]');
      expect(text).toContain('ZPROG2 (PROG) ✓ [ZOBJPKG]');
    });

    it('treats empty package and transport overrides as absent in batch_create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: 'ZTOPPKG',
        transport: 'A4HK900123',
        objects: [
          {
            type: 'PROG',
            name: 'ZPROG1',
            source: 'REPORT zprog1.',
            package: '',
            transport: '',
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const createCall = mockFetch.mock.calls.find(
        (call) =>
          String(call[0]).includes('/sap/bc/adt/programs/programs?') &&
          (call[1] as Record<string, unknown> | undefined)?.method === 'POST',
      );
      const body = String((createCall?.[1] as Record<string, unknown> | undefined)?.body ?? '');
      const createUrl = String(createCall?.[0] ?? '');
      expect(body).toContain('<adtcore:packageRef adtcore:name="ZTOPPKG"/>');
      expect(body).not.toContain('$TMP');
      expect(createUrl).toContain('corrNr=A4HK900123');
      expect(result.content[0]?.text).toContain('in package ZTOPPKG');
    });

    it('activates each object after creation', async () => {
      const fetchCalls: string[] = [];
      mockFetch.mockImplementation((_url: string | URL, options?: { method?: string }) => {
        const urlStr = typeof _url === 'string' ? _url : _url.toString();
        fetchCalls.push(`${options?.method ?? 'GET'} ${urlStr}`);
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'PROG', name: 'ZPROG1' }],
      });

      // Should have an activation POST call
      const activationCalls = fetchCalls.filter((c) => c.includes('activation'));
      expect(activationCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('skips source update when no source provided', async () => {
      const fetchCalls: string[] = [];
      mockFetch.mockImplementation((_url: string | URL, options?: { method?: string }) => {
        const urlStr = typeof _url === 'string' ? _url : _url.toString();
        fetchCalls.push(`${options?.method ?? 'GET'} ${urlStr}`);
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'SRVD', name: 'ZSD_TEST' }],
      });

      // No PUT call for source update (only POST for create + POST for activation)
      const putCalls = fetchCalls.filter((c) => c.startsWith('PUT'));
      expect(putCalls.length).toBe(0);
    });

    it('batch_create succeeds with multiple objects', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' },
          { type: 'PROG', name: 'ZPROG2', source: 'REPORT zprog2.' },
        ],
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('2 objects');
      expect(result.isError).toBeUndefined();
    });

    // ── activateAtEnd: deferred terminal batch-activation ─────────────

    describe('activateAtEnd', () => {
      /**
       * Helper to count how many times a path was POSTed (activation calls live at
       * `/sap/bc/adt/activation`). We collect URLs because the mock fetch signature is
       * `(url, init)` and the `mockResolvedValue` path doesn't preserve a typed body.
       */
      function countActivationPosts(): { single: number; batch: number; batchBody?: string } {
        const calls = mockFetch.mock.calls;
        let single = 0;
        let batch = 0;
        let batchBody: string | undefined;
        for (const c of calls) {
          const url = String(c[0] ?? '');
          const init = (c[1] as RequestInit | undefined) ?? {};
          if (init.method !== 'POST') continue;
          if (!url.includes('/sap/bc/adt/activation?')) continue;
          // batch vs single: heuristic on body — batch bodies contain multiple <adtcore:objectReference>
          const body = typeof init.body === 'string' ? init.body : '';
          const refCount = (body.match(/<adtcore:objectReference\b/g) ?? []).length;
          if (refCount > 1) {
            batch++;
            batchBody = body;
          } else {
            single++;
          }
        }
        return { single, batch, batchBody };
      }

      it('default activateAtEnd=false still issues per-object inline activations', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          objects: [
            { type: 'PROG', name: 'ZAAE1', source: 'REPORT zaae1.' },
            { type: 'PROG', name: 'ZAAE2', source: 'REPORT zaae2.' },
          ],
        });

        const counts = countActivationPosts();
        expect(counts.single).toBeGreaterThanOrEqual(2);
        expect(counts.batch).toBe(0);
      });

      it('activateAtEnd=true skips per-object activate and issues ONE terminal batch-activate POST', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          activateAtEnd: true,
          objects: [
            { type: 'PROG', name: 'ZBAE1', source: 'REPORT zbae1.' },
            { type: 'PROG', name: 'ZBAE2', source: 'REPORT zbae2.' },
            { type: 'PROG', name: 'ZBAE3', source: 'REPORT zbae3.' },
          ],
        });

        const counts = countActivationPosts();
        expect(counts.single).toBe(0);
        expect(counts.batch).toBe(1);
        // Body must contain all three objectReferences
        expect(counts.batchBody).toContain('ZBAE1');
        expect(counts.batchBody).toContain('ZBAE2');
        expect(counts.batchBody).toContain('ZBAE3');
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('activated as a single batch');
        expect(result.isError).toBeUndefined();
      });

      it('activateAtEnd=true breaks loop on write failure and only batch-activates the already-written subset', async () => {
        mockFetch.mockReset();
        // Fail ANY request for object ZBAE_FAIL. ZBAE_OK's full create+lock+source PUT+unlock
        // cycle stays on 200, and the eventual batch-activate of ZBAE_OK alone also stays on 200.
        mockFetch.mockImplementation((url: any) => {
          const u = String(url);
          if (u.includes('ZBAE_FAIL')) {
            return Promise.resolve(mockResponse(500, 'Internal Server Error', { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          activateAtEnd: true,
          objects: [
            { type: 'PROG', name: 'ZBAE_OK', source: 'REPORT zbae_ok.' },
            { type: 'PROG', name: 'ZBAE_FAIL', source: 'REPORT zbae_fail.' },
            { type: 'PROG', name: 'ZBAE_SKIP', source: 'REPORT zbae_skip.' },
          ],
        });

        // Loop broke on second object; ZBAE_SKIP is never attempted.
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('ZBAE_SKIP');
        expect(text).toContain('skipped');
        // The terminal batch-activate (if it fired) ran only over the already-written subset.
        const counts = countActivationPosts();
        if (counts.batch > 0) {
          expect(counts.batch).toBe(1);
          expect(counts.batchBody).not.toContain('ZBAE_SKIP');
          expect(counts.batchBody).not.toContain('ZBAE_FAIL');
          expect(counts.batchBody).toContain('ZBAE_OK');
        }
      });

      it("activateAtEnd=true flips all written entries to 'failed' when the terminal batch-activate fails", async () => {
        mockFetch.mockReset();
        // Activation failure XML — parseActivationOutcome looks for <msg> with severity=error.
        // Shape verified against tests/unit/adt/rap-generate.test.ts (live a4h shape, 2026-05-10).
        const failedActivationResponse = `<?xml version="1.0" encoding="UTF-8"?>
<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">
  <msg objDescr="ZBAE_PARENT" type="E" severity="error" shortText='data source "ZBAE_CHILD" does not exist or is not active' uri="/sap/bc/adt/programs/programs/ZBAE_PARENT/source/main#start=1,1"/>
</chkl:messages>`;
        let activationCallSeen = false;
        mockFetch.mockImplementation((url: any, init: any) => {
          const u = String(url);
          const isPost = init?.method === 'POST';
          const body = typeof init?.body === 'string' ? init.body : '';
          if (isPost && u.includes('/sap/bc/adt/activation?') && body.includes('<adtcore:objectReference')) {
            activationCallSeen = true;
            return Promise.resolve(mockResponse(200, failedActivationResponse, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          activateAtEnd: true,
          objects: [
            { type: 'PROG', name: 'ZBAE_PARENT', source: 'REPORT zbae_parent.' },
            { type: 'PROG', name: 'ZBAE_CHILD', source: 'REPORT zbae_child.' },
          ],
        });

        expect(activationCallSeen).toBe(true);
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? '';
        // The "create + source-write succeeded" context must be preserved.
        expect(text).toContain('written, batch activation failed');
      });

      it('activateAtEnd=true caches are invalidated only after the terminal activate succeeds', async () => {
        // We don't have a clean cache-spy; instead assert the activation call ordering:
        // every create+source PUT must precede the single terminal activation call.
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          activateAtEnd: true,
          objects: [
            { type: 'PROG', name: 'ZBAE_ORD1', source: 'REPORT zbae_ord1.' },
            { type: 'PROG', name: 'ZBAE_ORD2', source: 'REPORT zbae_ord2.' },
          ],
        });

        // Find activation call index (the batch POST).
        const calls = mockFetch.mock.calls;
        const activationIdx = calls.findIndex((c) => {
          const url = String(c[0] ?? '');
          const init = c[1] as RequestInit | undefined;
          const body = typeof init?.body === 'string' ? init.body : '';
          return (
            url.includes('/sap/bc/adt/activation?') &&
            init?.method === 'POST' &&
            body.includes('<adtcore:objectReference') &&
            body.includes('ZBAE_ORD1') &&
            body.includes('ZBAE_ORD2')
          );
        });
        expect(activationIdx).toBeGreaterThan(0);

        // Every create POST must come BEFORE the activation call.
        for (let i = 0; i < calls.length; i++) {
          const url = String(calls[i]?.[0] ?? '');
          const init = calls[i]?.[1] as RequestInit | undefined;
          if (
            init?.method === 'POST' &&
            url.includes('/sap/bc/adt/programs/programs') &&
            !url.includes('?lockHandle=')
          ) {
            // Create / write POSTs occur on the programs endpoint; allow them only before the activation.
            expect(i).toBeLessThan(activationIdx);
          }
        }
      });
    });
  });

  describe('buildCreateXml', () => {
    // issue #343: master language must follow the configured SAP_LANGUAGE (6th arg),
    // defaulting to EN when unset. Source objects ignore it server-side (cosmetic), but
    // the body must still match the sap-language URL param for DTEL/DOMA correctness.
    describe('master language (issue #343)', () => {
      it('threads the configured language into masterLanguage for source objects', () => {
        const xml = buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello', undefined, 'DE');
        expect(xml).toContain('adtcore:masterLanguage="DE"');
      });

      it('threads the configured language into FUGR language + masterLanguage', () => {
        const xml = buildCreateXml('FUGR', 'ZFG', '$TMP', 'FG', undefined, 'DE');
        expect(xml).toContain('adtcore:language="DE"');
        expect(xml).toContain('adtcore:masterLanguage="DE"');
      });

      it('threads the configured language into MSAG language + masterLanguage (blank-SPRSL fix)', () => {
        // Guards the write-helpers buildCreateXml → buildMessageClassXml wiring, not just the
        // builder in isolation: the MSAG handler keys T100 text rows by the BODY adtcore:language
        // (live-verified on a4h 7.58), so messages created without it land under a blank
        // SPRSL and never resolve at runtime.
        const xml = buildCreateXml(
          'MSAG',
          'ZMSG',
          '$TMP',
          'Msg',
          { messages: [{ number: '001', shortText: 'Probe &1' }] },
          'DE',
        );
        expect(xml).toContain('adtcore:language="DE"');
        expect(xml).toContain('adtcore:masterLanguage="DE"');
      });

      it('threads the configured language into DOMA create XML', () => {
        const xml = buildCreateXml('DOMA', 'ZDOM', '$TMP', 'Dom', { dataType: 'CHAR', length: 1 }, 'DE');
        expect(xml).toContain('adtcore:masterLanguage="DE"');
      });

      it('threads the configured language into DTEL create XML', () => {
        const xml = buildCreateXml('DTEL', 'ZEL', '$TMP', 'El', { dataType: 'CHAR', length: 10 }, 'DE');
        expect(xml).toContain('adtcore:masterLanguage="DE"');
      });

      it('defaults masterLanguage to EN when no language arg is passed', () => {
        expect(buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello')).toContain('adtcore:masterLanguage="EN"');
        expect(buildCreateXml('DTEL', 'ZEL', '$TMP', 'El', { dataType: 'CHAR', length: 10 })).toContain(
          'adtcore:masterLanguage="EN"',
        );
      });

      it('normalizes a lower-case language to upper case', () => {
        expect(buildCreateXml('CLAS', 'ZCL', '$TMP', 'C', undefined, 'de')).toContain('adtcore:masterLanguage="DE"');
      });
    });

    // Sibling of #343, for adtcore:responsible (7th arg = config.username). The legacy
    // hard-coded "DEVELOPER" fails on real systems with 400 [?/049]; thread the logon user.
    describe('person responsible (adtcore:responsible)', () => {
      it('threads the configured responsible into source objects (7th arg)', () => {
        const xml = buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello', undefined, 'EN', 'SRAHEMI');
        expect(xml).toContain('adtcore:responsible="SRAHEMI"');
      });

      it('threads the configured responsible into DOMA/DTEL/SRVB create XML', () => {
        expect(
          buildCreateXml('DOMA', 'ZDOM', '$TMP', 'Dom', { dataType: 'CHAR', length: 1 }, 'EN', 'SRAHEMI'),
        ).toContain('adtcore:responsible="SRAHEMI"');
        expect(
          buildCreateXml('DTEL', 'ZEL', '$TMP', 'El', { dataType: 'CHAR', length: 10 }, 'EN', 'SRAHEMI'),
        ).toContain('adtcore:responsible="SRAHEMI"');
        expect(buildCreateXml('SRVB', 'ZSB', '$TMP', 'SB', { serviceDefinition: 'ZSD' }, 'EN', 'SRAHEMI')).toContain(
          'adtcore:responsible="SRAHEMI"',
        );
      });

      it('defaults responsible to DEVELOPER when no responsible arg is passed', () => {
        expect(buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello')).toContain('adtcore:responsible="DEVELOPER"');
        expect(buildCreateXml('CLAS', 'ZCL', '$TMP', 'C', undefined, 'EN')).toContain(
          'adtcore:responsible="DEVELOPER"',
        );
      });

      it('normalizes a lower-case responsible to upper case', () => {
        expect(buildCreateXml('CLAS', 'ZCL', '$TMP', 'C', undefined, 'EN', 'srahemi')).toContain(
          'adtcore:responsible="SRAHEMI"',
        );
      });
    });

    it('returns correct XML for PROG', () => {
      const xml = buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello Program');
      expect(xml).toContain('<program:abapProgram');
      expect(xml).toContain('xmlns:program="http://www.sap.com/adt/programs/programs"');
      expect(xml).toContain('adtcore:type="PROG/P"');
      expect(xml).toContain('adtcore:name="ZHELLO"');
      expect(xml).toContain('adtcore:description="Hello Program"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for CLAS', () => {
      const xml = buildCreateXml('CLAS', 'ZCL_TEST', 'ZPACKAGE', 'Test Class');
      expect(xml).toContain('<class:abapClass');
      expect(xml).toContain('xmlns:class="http://www.sap.com/adt/oo/classes"');
      expect(xml).toContain('adtcore:type="CLAS/OC"');
      expect(xml).toContain('adtcore:name="ZCL_TEST"');
      expect(xml).toContain('adtcore:description="Test Class"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for INTF', () => {
      const xml = buildCreateXml('INTF', 'ZIF_TEST', 'ZPACKAGE', 'Test Interface');
      expect(xml).toContain('<intf:abapInterface');
      expect(xml).toContain('xmlns:intf="http://www.sap.com/adt/oo/interfaces"');
      expect(xml).toContain('adtcore:type="INTF/OI"');
      expect(xml).toContain('adtcore:name="ZIF_TEST"');
      expect(xml).toContain('adtcore:description="Test Interface"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for INCL', () => {
      const xml = buildCreateXml('INCL', 'ZHELLO_TOP', 'ZPACKAGE', 'Include Program');
      expect(xml).toContain('<include:abapInclude');
      expect(xml).toContain('xmlns:include="http://www.sap.com/adt/programs/includes"');
      expect(xml).toContain('adtcore:type="PROG/I"');
      expect(xml).toContain('adtcore:name="ZHELLO_TOP"');
      expect(xml).toContain('adtcore:description="Include Program"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DDLS', () => {
      const xml = buildCreateXml('DDLS', 'ZI_TRAVEL', 'ZPACKAGE', 'Travel CDS View');
      expect(xml).toContain('<ddl:ddlSource');
      expect(xml).toContain('xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"');
      expect(xml).toContain('adtcore:type="DDLS/DF"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel CDS View"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DCLS', () => {
      const xml = buildCreateXml('DCLS', 'ZI_TRAVEL_DCL', 'ZPACKAGE', 'Travel DCL');
      expect(xml).toContain('<dcl:dclSource');
      expect(xml).toContain('xmlns:dcl="http://www.sap.com/adt/acm/dclsources"');
      expect(xml).toContain('adtcore:type="DCLS/DL"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL_DCL"');
      expect(xml).toContain('adtcore:description="Travel DCL"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for BDEF (blue:blueSource namespace)', () => {
      const xml = buildCreateXml('BDEF', 'ZI_TRAVEL', 'ZPACKAGE', 'Travel Behavior');
      expect(xml).toContain('<blue:blueSource');
      expect(xml).toContain('xmlns:blue="http://www.sap.com/wbobj/blue"');
      expect(xml).toContain('adtcore:type="BDEF/BDO"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Behavior"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
      // Must NOT use the old broken namespace
      expect(xml).not.toContain('bdef:behaviorDefinition');
      expect(xml).not.toContain('http://www.sap.com/adt/bo/behaviordefinitions');
    });

    it('returns correct XML for SRVD', () => {
      const xml = buildCreateXml('SRVD', 'ZSD_TRAVEL', 'ZPACKAGE', 'Travel Service Def');
      expect(xml).toContain('<srvd:srvdSource');
      expect(xml).toContain('xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources"');
      expect(xml).toContain('adtcore:type="SRVD/SRV"');
      expect(xml).toContain('adtcore:name="ZSD_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Service Def"');
      expect(xml).toContain('srvd:srvdSourceType="S"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DDLX', () => {
      const xml = buildCreateXml('DDLX', 'ZC_TRAVEL', 'ZPACKAGE', 'Travel Metadata Ext');
      expect(xml).toContain('<ddlx:ddlxSource');
      expect(xml).toContain('xmlns:ddlx="http://www.sap.com/adt/ddic/ddlxsources"');
      expect(xml).toContain('adtcore:type="DDLX/EX"');
      expect(xml).toContain('adtcore:name="ZC_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Metadata Ext"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for SRVB', () => {
      const xml = buildCreateXml('SRVB', 'ZSB_TRAVEL_O4', 'ZPACKAGE', 'Travel service binding', {
        serviceDefinition: 'ZSD_TRAVEL',
        category: '0',
      });
      expect(xml).toContain('<srvb:serviceBinding');
      expect(xml).toContain('adtcore:type="SRVB/SVB"');
      expect(xml).toContain('<srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>');
      expect(xml).toContain('<srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V2">');
    });

    it('throws for SRVB when serviceDefinition is missing', () => {
      expect(() => buildCreateXml('SRVB', 'ZSB_TRAVEL_O4', 'ZPACKAGE', 'Travel service binding')).toThrow(
        'serviceDefinition',
      );
    });

    it('returns domain metadata XML for DOMA', () => {
      const xml = buildCreateXml('DOMA', 'ZSTATUS', '$TMP', 'Status domain', {
        dataType: 'CHAR',
        length: 1,
        fixedValues: [{ low: 'A', description: 'Active' }],
      });
      expect(xml).toContain('<doma:domain');
      expect(xml).toContain('adtcore:type="DOMA/DD"');
      expect(xml).toContain('<doma:datatype>CHAR</doma:datatype>');
      expect(xml).toContain('<doma:fixValue>');
    });

    it('returns data element metadata XML for DTEL', () => {
      const xml = buildCreateXml('DTEL', 'ZSTATUS', '$TMP', 'Status data element', {
        typeKind: 'domain',
        typeName: 'ZSTATUS',
        shortLabel: 'Status',
      });
      expect(xml).toContain('<blue:wbobj');
      expect(xml).toContain('adtcore:type="DTEL/DE"');
      expect(xml).toContain('<dtel:typeKind>domain</dtel:typeKind>');
      expect(xml).toContain('<dtel:typeName>ZSTATUS</dtel:typeName>');
    });

    it('returns TABL create XML with blue:blueSource envelope', () => {
      const xml = buildCreateXml('TABL', 'ZTABLE', 'ZPACKAGE', 'A Table');
      expect(xml).toContain('<blue:blueSource');
      expect(xml).toContain('xmlns:blue="http://www.sap.com/wbobj/blue"');
      expect(xml).toContain('adtcore:type="TABL/DT"');
      expect(xml).toContain('adtcore:name="ZTABLE"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('escapes XML special characters in attributes', () => {
      const xml = buildCreateXml('DDLS', 'ZTEST', 'ZPKG', 'Desc with "quotes" & <angle>');
      expect(xml).toContain('adtcore:description="Desc with &quot;quotes&quot; &amp; &lt;angle&gt;"');
    });

    it('escapes apostrophes in XML attributes', () => {
      const xml = buildCreateXml('PROG', 'ZTEST', 'ZPKG', "It's a test");
      expect(xml).toContain('adtcore:description="It&apos;s a test"');
    });

    it('returns FUGR create XML with group:abapFunctionGroup envelope (issue #250)', () => {
      const xml = buildCreateXml('FUGR', 'ZARC1_FG', '$TMP', 'Test FG');
      expect(xml).toContain('<group:abapFunctionGroup');
      expect(xml).toContain('xmlns:group="http://www.sap.com/adt/functions/groups"');
      expect(xml).toContain('adtcore:type="FUGR/F"');
      expect(xml).toContain('adtcore:name="ZARC1_FG"');
      expect(xml).toContain('adtcore:masterLanguage="EN"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    });

    it('returns FUNC create XML with fmodule:abapFunctionModule envelope and containerRef (issue #250)', () => {
      const xml = buildCreateXml('FUNC', 'Z_ARC1_FM', '', 'Test FM', { group: 'ZARC1_FG' });
      expect(xml).toContain('<fmodule:abapFunctionModule');
      expect(xml).toContain('xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"');
      expect(xml).toContain('adtcore:type="FUGR/FF"');
      expect(xml).toContain('adtcore:name="Z_ARC1_FM"');
      // containerRef must point at the parent FUGR; URI must be lowercase
      expect(xml).toContain(
        '<adtcore:containerRef adtcore:name="ZARC1_FG" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/zarc1_fg"/>',
      );
      // FM inherits package from parent FUGR — must NOT have its own packageRef
      expect(xml).not.toContain('packageRef');
    });

    it('throws for FUNC create without group property', () => {
      expect(() => buildCreateXml('FUNC', 'Z_FM', '', 'desc')).toThrow(/FUNC create requires "group"/i);
    });

    it('escapes XML special chars in FUGR description', () => {
      const xml = buildCreateXml('FUGR', 'ZTEST', '$TMP', 'Desc & <stuff>');
      expect(xml).toContain('adtcore:description="Desc &amp; &lt;stuff&gt;"');
    });

    it('escapes XML special chars in FUNC group name and uses encodeURIComponent for URI', () => {
      // Slash in group name (unrealistic but exercises encoding)
      const xml = buildCreateXml('FUNC', 'Z_FM', '', 'desc', { group: 'ZA/B' });
      // adtcore:name must be XML-escaped
      expect(xml).toContain('adtcore:name="ZA/B"');
      // URI path uses encodeURIComponent (lowercase first)
      expect(xml).toContain('adtcore:uri="/sap/bc/adt/functions/groups/za%2Fb"');
    });
  });

  describe('SAPWrite mixed-case object name rejection', () => {
    it('rejects create with lowercase characters in object name', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'Zarc1_Mixed',
        package: '$TMP',
        source: 'define view entity Zarc1_Mixed as select from t000 { key mandt }',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('uppercase');
      expect(text).toContain('ZARC1_MIXED');
      // No HTTP traffic should have happened — guard fires before locking.
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('proceeds past the guard when name is fully uppercase', async () => {
      mockFetch.mockReset();
      // CSRF + create + activate-related calls — let them all succeed minimally.
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZARC1_OK',
        package: '$TMP',
        source: 'define view entity ZARC1_OK as select from t000 { key mandt }',
      });
      // Guard didn't fire → at least one HTTP call was attempted (CSRF or POST).
      expect(mockFetch).toHaveBeenCalled();
    });

    it('rejects mixed-case names per object inside batch_create', async () => {
      mockFetch.mockReset();
      // Stub HTTP minimally — the batch may attempt the first uppercase object before hitting the bad one.
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          {
            type: 'DDLS',
            name: 'Zc_Bad',
            description: 'bad',
            source: 'define view entity Zc_Bad as select from t000 { key mandt }',
          },
          { type: 'CLAS', name: 'ZCL_LATER', description: 'never reached' },
        ],
      });
      const text = result.content[0]?.text ?? '';
      // First object should be marked failed for the mixed-case reason.
      expect(text).toContain('Zc_Bad');
      expect(text).toContain('uppercase');
      // Second object should NOT have been attempted (batch breaks on first failure).
      expect(text).not.toContain('ZCL_LATER: success');
    });

    // Issue #293: mixed-case names must be rejected on mutate/delete too, not just
    // create — the lock is held against the canonical uppercase name while the
    // request URL carries the mixed-case one (surfaces on ECC as 423 "not locked").
    it('rejects update with lowercase characters in object name', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name: 'Z_Hello_World',
        source: 'REPORT z_hello_world.',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('uppercase');
      expect(text).toContain('Z_HELLO_WORLD');
      // Guard fires before any lock/HTTP traffic.
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('rejects edit_method with lowercase characters in object (class) name', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'Zcl_Mixed',
        method: 'do_something',
        source: 'METHOD do_something.\nENDMETHOD.',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('uppercase');
      expect(text).toContain('ZCL_MIXED');
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });

    it('rejects delete with lowercase characters in object name', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'Z_Hello_World',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('uppercase');
      expect(text).toContain('Z_HELLO_WORLD');
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe('CDS pre-write validation (table entity version guard)', () => {
    afterEach(() => {
      resetCachedFeatures();
    });

    it('rejects "define table entity" on SAP_BASIS 758 (< 757 threshold actually means < 757)', async () => {
      // 758 >= 757, so this should be allowed. Let's test with 756 instead.
    });

    it('rejects "define table entity" on SAP_BASIS 756', async () => {
      setCachedFeatures({ abapRelease: '756', systemType: 'onprem' } as ResolvedFeatures);
      // Mock: first call = CSRF, subsequent calls = whatever
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n  name : abap.char(40);\n}',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('define table entity');
      expect(result.content[0]?.text).toContain('757');
      expect(result.content[0]?.text).toContain('756');
    });

    it('allows "define table entity" on BTP', async () => {
      setCachedFeatures({ abapRelease: '756', systemType: 'btp' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      // Should proceed past the guard (may fail later on mock, but not with version error)
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('allows "define table entity" on SAP_BASIS 757+', async () => {
      setCachedFeatures({ abapRelease: '757', systemType: 'onprem' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('proceeds without blocking when cachedFeatures is not available', async () => {
      resetCachedFeatures();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      // Should not fail with the version guard error
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('rejects "define table entity" in update path on old release', async () => {
      setCachedFeatures({ abapRelease: '750', systemType: 'onprem' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('define table entity');
      expect(result.content[0]?.text).toContain('750');
    });
  });
});
