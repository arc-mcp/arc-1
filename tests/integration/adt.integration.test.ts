/**
 * Integration tests for ARC-1 ADT client.
 *
 * These tests run against a live SAP system.
 * Missing credentials are treated as setup errors and fail the suite.
 *
 * Run: npm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyCdsImpact } from '../../src/adt/cds-impact.js';
import type { AdtClient } from '../../src/adt/client.js';
import { findWhereUsed } from '../../src/adt/codeintel.js';
import {
  getDump,
  getGatewayErrorDetail,
  listDumps,
  listGatewayErrors,
  listSystemMessages,
  listTraces,
} from '../../src/adt/diagnostics.js';
import { fetchDiscoveryDocument, resolveAcceptType } from '../../src/adt/discovery.js';
import { AdtApiError } from '../../src/adt/errors.js';
import {
  createCatalog,
  deleteCatalog,
  FLP_SERVICE_PATH,
  listCatalogs,
  listGroups,
  listTiles,
} from '../../src/adt/flp.js';
import {
  applyRapHandlerSignatures,
  extractRapHandlerRequirements,
  findMissingRapHandlerRequirements,
} from '../../src/adt/rap-handlers.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('ADT Integration Tests', () => {
  let client: AdtClient;
  let hasFlightAmdp = false;
  let hasDmoDdlx = false;
  let hasDmoSrvb = false;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    // Probe SAP demo fixture availability once — /DMO/* and I_ABAPPACKAGE are
    // shipped on S/4 boxes only; plain NetWeaver systems won't have them.
    try {
      await client.getClass('/DMO/CL_FLIGHT_AMDP');
      hasFlightAmdp = true;
    } catch {
      hasFlightAmdp = false;
    }
    try {
      await client.getDdlx('/DMO/C_AGENCYTP');
      hasDmoDdlx = true;
    } catch {
      hasDmoDdlx = false;
    }
    try {
      await client.getSrvb('/DMO/UI_AGENCY_O4');
      hasDmoSrvb = true;
    } catch {
      hasDmoSrvb = false;
    }
  });

  function requireFlightAmdp(ctx: import('vitest').TaskContext): void {
    if (!hasFlightAmdp) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (/DMO/CL_FLIGHT_AMDP) — S/4 AMDP demo`);
    }
  }
  function requireDmoDdlx(ctx: import('vitest').TaskContext): void {
    if (!hasDmoDdlx) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (/DMO/ DDLX) — S/4 metadata extensions`);
    }
  }
  function requireDmoSrvb(ctx: import('vitest').TaskContext): void {
    if (!hasDmoSrvb) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (/DMO/ SRVB) — S/4 service bindings`);
    }
  }

  // ─── System Information ─────────────────────────────────────────

  describe('system info', () => {
    it('gets structured system info with user', async () => {
      const info = await client.getSystemInfo();
      expect(info).toBeTruthy();
      // Response is structured JSON
      const parsed = JSON.parse(info);
      expect(parsed.user).toBeTruthy();
      expect(Array.isArray(parsed.collections)).toBe(true);
      // Collections may be empty on minimal SAP systems — that's OK
    });

    it('gets installed components', async () => {
      const components = await client.getInstalledComponents();
      expect(components.length).toBeGreaterThan(0);
      const basis = components.find((c) => c.name === 'SAP_BASIS');
      expect(basis).toBeDefined();
      expect(basis?.release).toBeTruthy();
    });

    it('installed components have valid structure', async () => {
      const components = await client.getInstalledComponents();
      for (const comp of components) {
        expect(comp.name).toBeTruthy();
        expect(comp.release).toBeTruthy();
        // description may be empty for some components
        expect(typeof comp.description).toBe('string');
      }
    });
  });

  // ─── ADT Discovery (MIME Negotiation) ─────────────────────────

  describe('discovery MIME negotiation', () => {
    it('fetches discovery map with key ADT endpoints and MIME types', async (ctx) => {
      const { map: discoveryMap } = await fetchDiscoveryDocument(client.http);
      const nonEmptyMap = discoveryMap.size > 0 ? discoveryMap : undefined;
      requireOrSkip(ctx, nonEmptyMap, SkipReason.BACKEND_UNSUPPORTED);

      expect(nonEmptyMap.has('/sap/bc/adt/oo/classes')).toBe(true);
      expect(nonEmptyMap.has('/sap/bc/adt/programs/programs')).toBe(true);

      const classesTypes = nonEmptyMap.get('/sap/bc/adt/oo/classes') ?? [];
      expect(classesTypes.length).toBeGreaterThan(0);
      expect(classesTypes[0]).toMatch(/^application\/vnd\.sap\.adt\./);
    });

    it('resolveAcceptType returns sensible MIME type for known endpoints', async (ctx) => {
      const { map: discoveryMap } = await fetchDiscoveryDocument(client.http);
      const nonEmptyMap = discoveryMap.size > 0 ? discoveryMap : undefined;
      requireOrSkip(ctx, nonEmptyMap, SkipReason.BACKEND_UNSUPPORTED);

      // Shallow match: object-level metadata paths resolve to discovered MIME types
      const classes = resolveAcceptType(nonEmptyMap, '/sap/bc/adt/oo/classes/CL_ABAP_CHAR_UTILITIES');
      const programs = resolveAcceptType(nonEmptyMap, '/sap/bc/adt/programs/programs/RSHOWTIM');
      const ddls = resolveAcceptType(nonEmptyMap, '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL');
      const transports = resolveAcceptType(nonEmptyMap, '/sap/bc/adt/cts/transportrequests?user=DEVELOPER');

      // Deep sub-resource paths (source/main) should NOT resolve — different Accept needed
      const classSource = resolveAcceptType(nonEmptyMap, '/sap/bc/adt/oo/classes/CL_ABAP_CHAR_UTILITIES/source/main');
      expect(classSource).toBeUndefined();

      expect(classes).toBeTruthy();
      expect(programs).toBeTruthy();
      expect(classes).toMatch(/^application\/vnd\.sap\.adt\./);
      expect(programs).toMatch(/^application\/vnd\.sap\.adt\./);

      // DDL/transports may be missing depending on backend release/authorizations.
      if (ddls) {
        expect(ddls).toMatch(/^application\/vnd\.sap\.adt\./);
      }
      if (transports) {
        expect(transports).toMatch(/^application\/vnd\.sap\.adt\./);
      }
    });
  });

  // ─── FLP (PAGE_BUILDER_CUST) ────────────────────────────────────

  describe('FLP (PAGE_BUILDER_CUST)', () => {
    let serviceAvailable: true | undefined;

    beforeAll(async () => {
      try {
        await client.http.get(`${FLP_SERVICE_PATH}/`, { Accept: 'application/json' });
        serviceAvailable = true;
      } catch (err) {
        if (err instanceof AdtApiError && err.statusCode === 404) {
          serviceAvailable = undefined;
          return;
        }
        throw err;
      }
    });

    it('probes FLP service availability', async (ctx) => {
      requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED);
      expect(serviceAvailable).toBe(true);
    });

    it('lists catalogs', async (ctx) => {
      requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED);
      const catalogs = await listCatalogs(client.http, unrestrictedSafetyConfig());
      expect(Array.isArray(catalogs)).toBe(true);
      expect(catalogs.length).toBeGreaterThan(0);
      expect(catalogs.some((c) => c.id.length > 0 && c.domainId.length > 0)).toBe(true);
    }, 60000);

    it('lists groups', async (ctx) => {
      requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED);
      const groups = await listGroups(client.http, unrestrictedSafetyConfig());
      expect(Array.isArray(groups)).toBe(true);
      for (const group of groups) {
        expect(group.catalogId).toBe('/UI2/FLPD_CATALOG');
      }
    }, 60000);

    it('lists tiles for a catalog (returns array, may be empty)', async (ctx) => {
      requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED);
      const catalogs = await listCatalogs(client.http, unrestrictedSafetyConfig());
      const catalogWithPrefix = catalogs.find((c) => c.id.startsWith('X-SAP-UI2-CATALOGPAGE:'));
      requireOrSkip(ctx, catalogWithPrefix, SkipReason.NO_FIXTURE);
      // Use full ID to verify normalization handles it correctly. On older
      // releases the PageChipInstances OData service can ABAP-dump (500) for
      // some catalogs — that's a backend bug, not an ARC-1 bug, skip cleanly.
      try {
        const result = await listTiles(client.http, unrestrictedSafetyConfig(), catalogWithPrefix.id);
        expect(Array.isArray(result.tiles)).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [500], [/ASSERT condition/i, /RABAX/i, /Internal Server Error/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: PageChipInstances service unstable on this release`,
        );
      }
    }, 60000);

    it('CRUD lifecycle — create and delete catalog', async (ctx) => {
      requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED);
      const domainId = `ZARC1_INTTEST_${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
      let createdCatalogId: string | undefined;

      try {
        const created = await createCatalog(
          client.http,
          unrestrictedSafetyConfig(),
          domainId,
          'ARC1 Integration Catalog',
        );
        createdCatalogId = created.id;
        expect(created.id.startsWith('X-SAP-UI2-CATALOGPAGE:')).toBe(true);
      } finally {
        if (createdCatalogId) {
          await deleteCatalog(client.http, unrestrictedSafetyConfig(), createdCatalogId);
        }
      }
    }, 120000);
  });

  // ─── Search ─────────────────────────────────────────────────────

  describe('search', () => {
    it('searches for objects by pattern', async () => {
      const results = await client.searchObject('CL_ABAP_*', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.objectName).toMatch(/^CL_ABAP_/);
    });

    it('returns empty results for non-existent pattern', async () => {
      const results = await client.searchObject('ZZZNONEXISTENT999*', 10);
      expect(results).toHaveLength(0);
    });

    it('respects maxResults limit', async () => {
      const results = await client.searchObject('CL_*', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns correct object structure', async () => {
      const results = await client.searchObject('CL_ABAP_CHAR*', 5);
      expect(results.length).toBeGreaterThan(0);
      const first = results[0]!;
      expect(first.objectName).toBeTruthy();
      expect(first.objectType).toBeTruthy();
      expect(first.uri).toBeTruthy();
    });

    it('finds programs by pattern', async (ctx) => {
      const results = await client.searchObject('RSHOWTIM*', 5);
      // RSHOWTIM is not on every SAP release — skip if it isn't indexed here.
      const match = results.find((r) => r.objectName === 'RSHOWTIM');
      requireOrSkip(ctx, match, `${SkipReason.NO_FIXTURE} (RSHOWTIM) — not on this system`);
      expect(results.length).toBeGreaterThan(0);
      expect(match).toBeDefined();
    });
  });

  // ─── Package Listing (search-endpoint based) ────────────────────
  //
  // Regression coverage for the description-misalignment fix: pre-fix,
  // SAPRead(type=DEVC) returned descriptions attributed to wrong objects
  // (verified server-side bug in /repository/nodestructure?withShortDescriptions=true).
  // The fix routes getPackageContents through informationsystem/search,
  // which returns descriptions correctly aligned to names.
  //
  // Depends on the demo package ZDEMO_MIG existing on the test system
  // (created by the SEGW->RAP migration demo). If the package isn't there,
  // the test skips cleanly. See `demo/setup/` in the related demo workspace
  // for how to create it.
  describe('getPackageContents (search-endpoint based)', () => {
    it('returns objects with descriptions correctly aligned to names', async (ctx) => {
      const contents = await client.getPackageContents('ZDEMO_MIG');
      const proj = contents.find((c) => c.name === 'ZDM_PROJECT');
      requireOrSkip(
        ctx,
        proj,
        `${SkipReason.NO_FIXTURE} (ZDEMO_MIG.ZDM_PROJECT) — demo package not on test system; see SEGW->RAP demo setup`,
      );
      // Anchor 1: DDIC table description (we set it during demo creation).
      expect(proj.description).toBe('Demo: Project (legacy SEGW era)');
      expect(proj.type).toBe('TABL/DT');
      expect(proj.uri).toContain('/sap/bc/adt/ddic/tables/zdm_project');
    });

    it('aligns sub-package description with the sub-package name (the original bug)', async (ctx) => {
      const contents = await client.getPackageContents('ZDEMO_MIG');
      const sub = contents.find((c) => c.name === 'ZDEMO_MIG_RAP');
      requireOrSkip(ctx, sub, `${SkipReason.NO_FIXTURE} (ZDEMO_MIG_RAP sub-package) — demo workspace not fully set up`);
      expect(sub.type).toBe('DEVC/K');
      // The sub-package's OWN description must be on its OWN row — pre-fix,
      // this string showed up on a CLAS row instead.
      expect(sub.description).toBe('Demo: RAP migration outputs from migrate-segw-to-rap skill');
    });

    it('aligns SEGW-generated CLAS descriptions with their own names', async (ctx) => {
      const contents = await client.getPackageContents('ZDEMO_MIG');
      const dpc = contents.find((c) => c.name === 'ZCL_ZDEMO_MIG_PROJECTS_DPC');
      requireOrSkip(
        ctx,
        dpc,
        `${SkipReason.NO_FIXTURE} (ZCL_ZDEMO_MIG_PROJECTS_DPC) — SEGW project not built on test system`,
      );
      // SEGW's auto-generated description for the base DPC class.
      // Pre-fix this row received the sub-package's description — that bug must stay dead.
      expect(dpc.description).toBe('Data Provider Base Class');
      expect(dpc.type).toBe('CLAS/OC');
    });

    it('returns an empty array for an existing but empty package', async (ctx) => {
      // ZDEMO_MIG_RAP is the migration target package — empty until skill output lands.
      // Skip if it isn't there (separate fixture from ZDEMO_MIG itself).
      const contents = await client.getPackageContents('ZDEMO_MIG_RAP');
      // The package itself may show up as a parent reference, plus there might be 0 contained objects.
      // Either way, the response must be a typed array with zero or one entries — never an exception.
      expect(Array.isArray(contents)).toBe(true);
      // If the package isn't on the system at all, we'd hit the 400 error path tested below; tolerate that.
      requireOrSkip(
        ctx,
        contents.length <= 1 ? true : null,
        `${SkipReason.NO_FIXTURE} (ZDEMO_MIG_RAP empty) — package has ${contents.length} children, expected 0 or 1`,
      );
    });

    it('throws AdtApiError 400 for a non-existent package name', async () => {
      // The search endpoint validates package names server-side: invalid → 400.
      // This is the documented behaviour we propagate to callers (don't silently swallow).
      await expect(client.getPackageContents('ZNONEXISTENT_PKG_99X')).rejects.toThrow(AdtApiError);
    });

    it('honors maxResults parameter', async (ctx) => {
      // ZDEMO_MIG has roughly 17 objects via the search endpoint.
      // Asking for 3 must cap at 3.
      const contents = await client.getPackageContents('ZDEMO_MIG', 3);
      requireOrSkip(
        ctx,
        contents.length > 0 ? contents : null,
        `${SkipReason.NO_FIXTURE} (ZDEMO_MIG) — demo package not on test system`,
      );
      expect(contents.length).toBeLessThanOrEqual(3);
    });
  });

  // ─── Read Operations ────────────────────────────────────────────

  describe('read operations', () => {
    it('reads a standard SAP program', async () => {
      // RSHOWTIM is a standard SAP report available on most systems
      const { source } = await client.getProgram('RSHOWTIM');
      expect(source).toBeTruthy();
      // Standard SAP programs start with a comment header
      expect(source.length).toBeGreaterThan(10);
    });

    it('reads a standard SAP class', async () => {
      const { source } = await client.getClass('CL_ABAP_CHAR_UTILITIES');
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(0);
    });

    it('reads table contents', async (ctx) => {
      let result: Awaited<ReturnType<typeof client.getTableContents>>;
      try {
        result = await client.getTableContents('T000', 5);
      } catch (err) {
        // /datapreview/ddic was not yet active on NW 7.50 (added in a later SP).
        expectSapFailureClass(err, [404], [/No suitable resource/i, /not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview/ddic endpoint not available on this release`,
        );
        return;
      }
      expect(result.columns).toContain('MANDT');
      expect(result.rows.length).toBeGreaterThan(0);
      // Each row should have all columns
      for (const row of result.rows) {
        for (const col of result.columns) {
          expect(col in row).toBe(true);
        }
      }
    });

    it('reads table contents with row limit', async (ctx) => {
      let result: Awaited<ReturnType<typeof client.getTableContents>>;
      try {
        result = await client.getTableContents('T000', 1);
      } catch (err) {
        expectSapFailureClass(err, [404], [/No suitable resource/i, /not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview/ddic endpoint not available on this release`,
        );
        return;
      }
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-existent program', async () => {
      await expect(client.getProgram('ZZZNOTEXIST999')).rejects.toThrow();
    });
  });

  describe('Version history (VERSIONS / VERSION_SOURCE)', () => {
    it('lists revisions for PROG ZARC1_TEST_REPORT', async (ctx) => {
      try {
        const result = await client.getRevisions('PROG', 'ZARC1_TEST_REPORT');
        const hasRevisions = result.revisions.length > 0 ? result : undefined;
        requireOrSkip(ctx, hasRevisions, 'Persistent fixture ZARC1_TEST_REPORT has no revisions on this system');
        expect(result.object.name).toBe('ZARC1_TEST_REPORT');
        for (const revision of result.revisions) {
          expect(revision.uri.startsWith('/sap/bc/adt/')).toBe(true);
        }
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(ctx, undefined, 'Persistent fixture ZARC1_TEST_REPORT is missing on this system');
      }
    });

    it('lists revisions for CLAS ZCL_ARC1_TEST include=main', async (ctx) => {
      try {
        const result = await client.getRevisions('CLAS', 'ZCL_ARC1_TEST', { include: 'main' });
        const first = result.revisions[0];
        requireOrSkip(ctx, first, 'No CLAS revisions available for ZCL_ARC1_TEST include=main');
        // Release-specific URI shape:
        //   newer: .../includes/main/versions/<id>
        //   older: .../source/main  (NW 7.50 — no /versions/ segment)
        // Both are valid ADT paths — assert the anchor that's invariant.
        expect(first.uri.startsWith('/sap/bc/adt/oo/classes/ZCL_ARC1_TEST')).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(ctx, undefined, 'Persistent fixture ZCL_ARC1_TEST is missing on this system');
      }
    });

    it('lists revisions for CLAS ZCL_ARC1_TEST include=definitions', async (ctx) => {
      try {
        const result = await client.getRevisions('CLAS', 'ZCL_ARC1_TEST', { include: 'definitions' });
        const first = result.revisions[0];
        requireOrSkip(ctx, first, 'No CLAS definition revisions available for ZCL_ARC1_TEST');
        // Older releases return just the class-level URI; newer ones drill into /includes/definitions/versions/.
        expect(first.uri.startsWith('/sap/bc/adt/oo/classes/ZCL_ARC1_TEST')).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: CLAS include=definitions revision endpoint unavailable or fixture has no definitions include`,
        );
      }
    });

    it('lists revisions for INTF ZIF_ARC1_TEST (source/main endpoint)', async (ctx) => {
      try {
        const result = await client.getRevisions('INTF', 'ZIF_ARC1_TEST');
        const first = result.revisions[0];
        requireOrSkip(ctx, first, 'No INTF revisions available for ZIF_ARC1_TEST');
        // URI shape varies by release — /source/main (7.50) vs /source/main/versions/<id> (newer).
        expect(first.uri).toContain('/oo/interfaces/ZIF_ARC1_TEST');
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(ctx, undefined, 'Persistent fixture ZIF_ARC1_TEST is missing on this system');
      }
    });

    it('fetches version source for the first PROG revision', async (ctx) => {
      try {
        const revisions = await client.getRevisions('PROG', 'ZARC1_TEST_REPORT');
        const first = revisions.revisions[0];
        requireOrSkip(ctx, first, 'No PROG revisions available for ZARC1_TEST_REPORT');
        const source = await client.getRevisionSource(first.uri);
        expect(source).toMatch(/report/i);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(ctx, undefined, 'Version source endpoint unavailable or fixture missing');
      }
    });

    it('rejects non-ADT URIs for VERSION_SOURCE', async () => {
      await expect(client.getRevisionSource('https://evil.example/foo')).rejects.toThrow(/\/sap\/bc\/adt\//);
    });

    it('handles DDLS revision endpoint gaps gracefully', async (ctx) => {
      try {
        const result = await client.getRevisions('DDLS', 'ZI_TRAVEL');
        expect(Array.isArray(result.revisions)).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: DDLS revisions endpoint is not available on this backend`,
        );
      }
    });
  });

  // ─── DDIC Operations (Structures, Domains, Data Elements) ─────

  describe('DDIC operations', () => {
    it('reads structure definition (BAPIRET2)', async () => {
      const { source } = await client.getStructure('BAPIRET2');
      expect(source).toBeTruthy();
      expect(source).toContain('bapiret2');
      expect(source).toContain('message');
    });

    it('reads structure definition (SYST)', async () => {
      const { source } = await client.getStructure('SYST');
      expect(source).toBeTruthy();
      expect(source).toContain('syst');
      expect(source).toContain('subrc');
    });

    it('reads BAPIRET2 via unified getTabl() — falls back from /tables/ to /structures/', async () => {
      const { source } = await client.getTabl('BAPIRET2');
      expect(source).toBeTruthy();
      expect(source).toContain('bapiret2');
      expect(source).toContain('message');
      // After the fallback resolves, the URL is cached so resolveTablObjectUrl() returns the structures URL.
      const resolvedUrl = await client.resolveTablObjectUrl('BAPIRET2');
      expect(resolvedUrl).toContain('/sap/bc/adt/ddic/structures/');
    });

    it('reads T000 via unified getTabl() — transparent table (URL release-dependent)', async () => {
      // T000 is a transparent table (DD02L-TABCLASS=TRANSP). On modern S/4HANA
      // releases the source is served from /sap/bc/adt/ddic/tables/T000; on
      // some 7.5x systems only /sap/bc/adt/ddic/structures/T000 returns 200.
      // getTabl() handles either path via its 404 fallback, so we assert the
      // source content rather than the resolved URL prefix.
      const { source } = await client.getTabl('T000');
      expect(source).toBeTruthy();
      expect(source.toLowerCase()).toContain('t000');
      // Transparent-table marker — appears on both /tables/ and /structures/ readbacks.
      expect(source).toMatch(/@AbapCatalog\.tableCategory\s*:\s*#TRANSPARENT/i);
      const resolvedUrl = await client.resolveTablObjectUrl('T000');
      expect(resolvedUrl).toMatch(/\/sap\/bc\/adt\/ddic\/(tables|structures)\/T000$/);
    });

    it('resolveTablObjectUrlForWrite returns /tables/ for TABL/DT when /tables/ endpoint is available (issue #285)', async () => {
      // The write-path resolver MUST decide endpoint by adtcore:type (TABL/DT vs
      // TABL/DS), not by 404 probing. On a4h S/4HANA 2023 the /ddic/tables/
      // endpoint exists, so transparent-table writes go to /tables/. On NPL 7.50
      // /ddic/tables/ is absent — the resolver throws AdtSafetyError (covered by
      // the next test).
      const url = await client.resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: true });
      // T000 is a transparent table on every release.
      expect(url).toBe('/sap/bc/adt/ddic/tables/T000');
    });

    it('resolveTablObjectUrlForWrite refuses TABL/DT writes when /tables/ is unavailable (issue #285)', async () => {
      // Simulates the NW 7.50 case explicitly by passing tablesEndpointAvailable=false.
      // Live evidence: on NPL 7.50 the ADT discovery feed lists /ddic/structures but
      // NOT /ddic/tables. Pre-fix the resolver fell back to /structures/ silently;
      // post-fix it refuses with the SE11 hint.
      let captured: Error | undefined;
      try {
        await client.resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: false });
      } catch (err) {
        captured = err as Error;
      }
      expect(captured).toBeDefined();
      expect(captured?.message).toContain('Transparent table writes via ADT REST are not available');
      expect(captured?.message).toContain('SE11');
      expect(captured?.message).toContain('NW 7.52');
    });

    it('resolveTablObjectUrlForWrite returns /structures/ for TABL/DS regardless of tables availability', async () => {
      // BAPIRET2 is a TABL/DS structure on every release. Even if /tables/ is unavailable,
      // structure writes route to /structures/ — that's their canonical endpoint.
      const url = await client.resolveTablObjectUrlForWrite('BAPIRET2', { tablesEndpointAvailable: false });
      expect(url).toBe('/sap/bc/adt/ddic/structures/BAPIRET2');
    });

    it('reads DDIC view metadata via the VIT URL (V_USR_NAME)', async (ctx) => {
      // Regression test for the "VIEW silently broken" bug fixed in PR #222
      // follow-up. Pre-fix: getView used /sap/bc/adt/ddic/views/{name}/source/main
      // which returns HTTP 404 on a4h S/4HANA 2023 and HTTP 500 on npl 7.50.
      // Real route is the VIT generic-object endpoint
      // /sap/bc/adt/vit/wb/object_type/viewdv/object_name/{name}, returning
      // metadata XML with adtcore:type="VIEW/DV". V_USR_NAME is a SAP-shipped
      // standard view available on every release (verified on a4h + npl
      // 2026-05-08).
      let result: Awaited<ReturnType<typeof client.getView>>;
      try {
        result = await client.getView('V_USR_NAME');
      } catch (err) {
        expectSapFailureClass(err, [404], [/does not exist/i, /not found/i]);
        requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (V_USR_NAME) — view not on this system`);
        return;
      }
      expect(result.source).toBeTruthy();
      // Metadata XML — root element is adtcore:mainObject with view attrs.
      expect(result.source).toMatch(/adtcore:type="VIEW\/DV"/);
      expect(result.source).toMatch(/adtcore:name="V_USR_NAME"/);
    });

    // Note (codex P2 follow-up, PR #223): these tests assert the slash codes
    // ADT *emits* in `<adtcore:type>` for known objects — not that ADT
    // honours an `objectType` filter. `client.searchObject(name, max)`
    // does not pass `objectType` (the parameter doesn't exist on the
    // client), and the ADT informationsystem/search endpoint silently
    // ignores unknown filters anyway. So these are emitted-type
    // assertions. They still serve as regression guards for the four
    // SLASH_TYPE_MAP fixes (VIEW/DV, TRAN/T, FUGR/FF — and implicitly
    // confirm CLAS/LI / FUNC/FM are not what real ADT ever returns).
    // A future PR can add object-search filtering + a deliberate
    // bogus-objectType test once `client.searchObject` grows that
    // parameter.

    it('SAPSearch result for V_USR_NAME emits adtcore:type="VIEW/DV"', async () => {
      const results = await client.searchObject('V_USR_NAME', 5);
      const view = results.find((r) => r.objectName === 'V_USR_NAME');
      expect(view).toBeDefined();
      expect(view!.objectType).toBe('VIEW/DV');
    });

    it('SAPSearch result for SE38 emits adtcore:type="TRAN/T"', async () => {
      const results = await client.searchObject('SE38', 5);
      const tcode = results.find((r) => r.objectName === 'SE38');
      expect(tcode).toBeDefined();
      expect(tcode!.objectType).toBe('TRAN/T');
    });

    it('SAPSearch result for BAPI_USER_GETLIST emits adtcore:type="FUGR/FF"', async () => {
      // Confirms FUGR/FF is the live slash code for function modules. The map
      // entry FUGR/FF → FUNC routes correctly to client.getFunction at the
      // handler layer (covered by unit tests).
      const results = await client.searchObject('BAPI_USER_GETLIST', 5);
      const fm = results.find((r) => r.objectName === 'BAPI_USER_GETLIST');
      expect(fm).toBeDefined();
      expect(fm!.objectType).toBe('FUGR/FF');
    });

    it('reads domain metadata (MANDT)', async (ctx) => {
      let domain: Awaited<ReturnType<typeof client.getDomain>>;
      try {
        domain = await client.getDomain('MANDT');
      } catch (err) {
        // DOMA ADT endpoint doesn't exist on NW 7.50 (added in a later release).
        expectSapFailureClass(err, [404], [/does not exist/i, /not found/i]);
        requireOrSkip(ctx, undefined, `${SkipReason.BACKEND_UNSUPPORTED}: DOMA reads not supported on this release`);
        return;
      }
      expect(domain.name).toBe('MANDT');
      expect(domain.dataType).toBe('CLNT');
      expect(domain.length).toBe('000003');
      expect(domain.package).toBeTruthy();
    });

    it('reads domain metadata with value table (BUKRS)', async (ctx) => {
      let domain: Awaited<ReturnType<typeof client.getDomain>>;
      try {
        domain = await client.getDomain('BUKRS');
      } catch (err) {
        expectSapFailureClass(err, [404], [/does not exist/i, /not found/i]);
        requireOrSkip(ctx, undefined, `${SkipReason.BACKEND_UNSUPPORTED}: DOMA reads not supported on this release`);
        return;
      }
      expect(domain.name).toBe('BUKRS');
      expect(domain.dataType).toBe('CHAR');
      expect(domain.length).toBe('000004');
      expect(domain.valueTable).toBe('T001');
    });

    it('reads data element metadata (MANDT)', async () => {
      const dtel = await client.getDataElement('MANDT');
      expect(dtel.name).toBe('MANDT');
      expect(dtel.typeKind).toBe('domain');
      expect(dtel.typeName).toBe('MANDT');
      expect(dtel.dataType).toBe('CLNT');
      expect(dtel.package).toBeTruthy();
    });

    it('reads data element metadata with labels (BUKRS)', async () => {
      const dtel = await client.getDataElement('BUKRS');
      expect(dtel.name).toBe('BUKRS');
      expect(dtel.typeKind).toBe('domain');
      expect(dtel.typeName).toBe('BUKRS');
      expect(dtel.dataType).toBe('CHAR');
      expect(dtel.mediumLabel).toBeTruthy();
      expect(dtel.searchHelp).toBe('C_T001');
    });

    it('reads authorization field metadata (AUTH/BUKRS)', async (ctx) => {
      try {
        const auth = await client.getAuthorizationField('BUKRS');
        expect(auth.name).toBe('BUKRS');
        expect(auth.checkTable).toBe('T001');
        expect(Array.isArray(auth.orgLevelInfo)).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: Auth Fields ADT endpoint not available on this kernel`,
        );
      }
    });

    it('reads feature toggle state (FEATURE_TOGGLE) when available', async (ctx) => {
      // Renamed from FTG2 in audit Plan B (research/abap-types/types/ftg2.md). The
      // endpoint is unchanged: /sap/bc/adt/sfw/featuretoggles/<name>/states.
      const toggleName = process.env.TEST_FEATURE_TOGGLE || 'SAP_PARA_DCFK_SUPP_GENERAL';
      try {
        const toggle = await client.getFeatureToggle(toggleName);
        expect(toggle.name).toBeTruthy();
        expect(Array.isArray(toggle.states)).toBe(true);
      } catch (err) {
        // Feature toggles are often unavailable or empty on plain A4H systems.
        expectSapFailureClass(err, [404, 403], [/not found/i, /no authorization/i, /forbidden/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: Feature toggle endpoint unavailable or unauthorized on this system`,
        );
      }
    });

    it('reads message class via MSAG canonical type (audit Plan B)', async () => {
      // MSAG was added to SAPREAD_TYPES_* by docs/plans/completed/audit-symmetry-and-ftg2-rename.md.
      // Endpoint /sap/bc/adt/messageclass/{name} verified live (2026-05-08) on:
      //   - a4h S/4HANA 2023 (returns adtcore:type="MSAG/N")
      //   - npl NW 7.50 SP02 (returns adtcore:type="MSAG/N")
      // SY is a SAP-shipped message class present on every release.
      const info = await client.getMessageClassInfo('SY');
      expect(info.name).toBe('SY');
      expect(typeof info.description).toBe('string');
      expect(Array.isArray(info.messages)).toBe(true);
      expect(info.messages.length).toBeGreaterThan(0);
    });

    it('reads enhancement implementation metadata (ENHO) when a fixture exists', async (ctx) => {
      const byName = process.env.TEST_ENHO_NAME?.trim();
      const candidateNames: string[] = [];

      if (byName) {
        candidateNames.push(byName);
      } else {
        try {
          const candidates = await client.searchObject('ENHO*', 20);
          for (const row of candidates) {
            if (String(row.objectType).startsWith('ENHO') && row.objectName) {
              candidateNames.push(row.objectName);
            }
          }
        } catch (err) {
          expectSapFailureClass(err, [404, 403, 500], [/search/i, /not found/i]);
          requireOrSkip(
            ctx,
            undefined,
            `${SkipReason.BACKEND_UNSUPPORTED}: Could not search ENHO objects on this backend`,
          );
        }
        // Append known-good SAP-delivered ENHO names as fallbacks.
        // The A4H developer trial system has many malformed ENHO_ADT_TEST* fixtures
        // that return SAP server-side defects; SFW_BCF_TCD is a clean SAP example.
        for (const wellKnown of ['SFW_BCF_TCD']) {
          if (!candidateNames.includes(wellKnown)) {
            candidateNames.push(wellKnown);
          }
        }
      }

      requireOrSkip(ctx, candidateNames[0], 'No enhancement implementation fixture found for ENHO read test');

      // Try each candidate — some ENHO objects exist in TADIR but fail with
      // "Dereferencing of the NULL reference" (HTTP 500) or similar SAP server-side
      // defects. Accept the first one that parses cleanly.
      let parsed = false;
      let lastErr: unknown;
      for (const name of candidateNames) {
        try {
          const enho = await client.getEnhancementImplementation(name);
          expect(enho.name).toBeTruthy();
          expect(Array.isArray(enho.badiImplementations)).toBe(true);
          parsed = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!parsed) {
        // No usable fixture — classify the last error and skip if backend-unsupported.
        // Accept a wide range of SAP server-side defects that certain malformed ENHO
        // fixtures throw (NULL ref, type conflicts, activation state issues, etc.).
        expectSapFailureClass(
          lastErr,
          [400, 403, 404, 500],
          [
            /not found/i,
            /forbidden/i,
            /no authorization/i,
            /null reference/i,
            /application server error/i,
            /type conflict/i,
            /parameter passing/i,
          ],
        );
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: No readable ENHO fixture on this system (all candidates returned server errors)`,
        );
      }
    });

    it('reads transaction metadata (SE38)', async () => {
      const tran = await client.getTransaction('SE38');
      expect(tran.code).toBe('SE38');
      expect(tran.description).toBeTruthy();
      expect(tran.package).toBeTruthy();
    });

    it('returns 404 for non-existent domain', async () => {
      await expect(client.getDomain('ZZZNOTEXIST999')).rejects.toThrow();
    });

    it('returns 404 for non-existent data element', async () => {
      await expect(client.getDataElement('ZZZNOTEXIST999')).rejects.toThrow();
    });

    it('returns empty metadata for non-existent transaction', async () => {
      // SAP's vit endpoint returns 200 with empty data for non-existent transactions
      // (unlike other ADT endpoints that return 404)
      const tran = await client.getTransaction('ZZZNOTEXIST999');
      expect(tran.code).toBe('ZZZNOTEXIST999');
      expect(tran.description).toBe('');
    });
  });

  // ─── Class Operations ───────────────────────────────────────────

  describe('class operations', () => {
    it('reads class main source', async () => {
      const { source } = await client.getClass('CL_ABAP_CHAR_UTILITIES');
      expect(source).toBeTruthy();
    });

    it('reads class with specific include', async () => {
      // Try reading definitions include
      try {
        const { source } = await client.getClass('CL_ABAP_CHAR_UTILITIES', 'definitions');
        expect(typeof source).toBe('string');
        expect(source.length).toBeGreaterThan(0);
      } catch (err) {
        // Include may not be available on all systems — expect 404 or similar
        expectSapFailureClass(err, [404, 500], [/not found/i, /does not exist/i]);
      }
    });

    it('returns error for non-existent class', async () => {
      await expect(client.getClass('ZCL_NONEXISTENT_999')).rejects.toThrow();
    });

    it('reads class local definitions include', async (ctx) => {
      requireFlightAmdp(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_AMDP', 'definitions');
      expect(typeof source).toBe('string');
      expect(source).toContain('=== definitions ===');
    });

    it('reads class local implementations include', async (ctx) => {
      requireFlightAmdp(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_AMDP', 'implementations');
      expect(typeof source).toBe('string');
      expect(source).toContain('=== implementations ===');
    });

    it('reads class with multiple includes', async (ctx) => {
      requireFlightAmdp(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_AMDP', 'definitions,implementations');
      expect(source).toContain('=== definitions ===');
      expect(source).toContain('=== implementations ===');
    });

    it('gracefully handles non-existent testclasses include', async (ctx) => {
      requireFlightAmdp(ctx);
      // If the class has no test classes, should return a helpful note rather than throwing
      const { source } = await client.getClass('/DMO/CL_FLIGHT_AMDP', 'testclasses');
      expect(typeof source).toBe('string');
      expect(source).toContain('testclasses');
    });

    it('reads full class source without include (default)', async (ctx) => {
      requireFlightAmdp(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_AMDP');
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(0);
    });
  });

  // ─── Interface Operations ───────────────────────────────────────

  describe('interface operations', () => {
    it('reads a standard SAP interface', async () => {
      // IF_SERIALIZABLE_OBJECT exists on all systems
      try {
        const { source } = await client.getInterface('IF_SERIALIZABLE_OBJECT');
        expect(typeof source).toBe('string');
        expect(source.length).toBeGreaterThan(0);
      } catch (err) {
        // Interface may not exist on minimal systems — expect 404 or not-found
        expectSapFailureClass(err, [404], [/not found/i, /does not exist/i]);
      }
    });
  });

  // ─── Function Module Operations ─────────────────────────────────

  describe('function module operations', () => {
    it('reads function group structure', async () => {
      // Try a standard function group
      try {
        const results = await client.searchObject('FUNCTION_EXISTS', 1);
        expect(Array.isArray(results)).toBe(true);
      } catch (err) {
        // Search may fail on restricted systems — expect known error shape
        expectSapFailureClass(err, [404, 403, 500], [/not found/i, /search/i]);
      }
    });
  });

  // CRUD lifecycle test moved to tests/integration/crud.lifecycle.integration.test.ts
  // This section previously only verified search — full create/read/update/activate/delete
  // lifecycle is now covered by the dedicated suite.

  // ─── Safety Checks ──────────────────────────────────────────────

  describe('safety', () => {
    it('safe-default client can still read', async () => {
      const { AdtClient } = await import('../../src/adt/client.js');
      const roClient = new AdtClient({
        baseUrl: process.env.TEST_SAP_URL || process.env.SAP_URL || '',
        username: process.env.TEST_SAP_USER || process.env.SAP_USER || '',
        password: process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD || '',
        client: process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT || '100',
        insecure: (process.env.TEST_SAP_INSECURE || process.env.SAP_INSECURE) === 'true',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false, allowFreeSQL: false },
      });

      // Read should work
      const source = await roClient.getProgram('RSHOWTIM');
      expect(source).toBeTruthy();
    });

    it('safe-default client can search', async () => {
      const { AdtClient } = await import('../../src/adt/client.js');
      const roClient = new AdtClient({
        baseUrl: process.env.TEST_SAP_URL || process.env.SAP_URL || '',
        username: process.env.TEST_SAP_USER || process.env.SAP_USER || '',
        password: process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD || '',
        client: process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT || '100',
        insecure: (process.env.TEST_SAP_INSECURE || process.env.SAP_INSECURE) === 'true',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false, allowFreeSQL: false },
      });

      const results = await roClient.searchObject('CL_ABAP_*', 3);
      expect(results.length).toBeGreaterThan(0);
    });

    it('safe-default client blocks free SQL', async () => {
      const { AdtClient } = await import('../../src/adt/client.js');
      const roClient = new AdtClient({
        baseUrl: process.env.TEST_SAP_URL || process.env.SAP_URL || '',
        username: process.env.TEST_SAP_USER || process.env.SAP_USER || '',
        password: process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD || '',
        client: process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT || '100',
        insecure: (process.env.TEST_SAP_INSECURE || process.env.SAP_INSECURE) === 'true',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false, allowFreeSQL: false },
      });

      await expect(roClient.runQuery('SELECT * FROM T000')).rejects.toThrow();
    });
  });

  // ─── HTTP Cookie Jar (CSRF + Session) ───────────────────────────

  describe('HTTP session management', () => {
    it('maintains session cookies across requests', async () => {
      // This test verifies the cookie jar fix — CSRF token + session cookie correlation
      // First request (GET) should establish a session, POST should reuse it
      const { source } = await client.getProgram('RSHOWTIM');
      expect(source).toBeTruthy();

      // Second request should work with the same session
      const { source: source2 } = await client.getClass('CL_ABAP_CHAR_UTILITIES');
      expect(source2).toBeTruthy();
    });

    it('POST requests work (CSRF + cookie correlation)', async (ctx) => {
      // getTableContents uses POST — tests CSRF token + session cookie
      let result: Awaited<ReturnType<typeof client.getTableContents>>;
      try {
        result = await client.getTableContents('T000', 2);
      } catch (err) {
        expectSapFailureClass(err, [404], [/No suitable resource/i, /not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview/ddic endpoint not available on this release`,
        );
        return;
      }
      expect(result.columns).toContain('MANDT');
    });

    it('multiple POST requests work in sequence', async (ctx) => {
      // Ensure cookies persist across multiple POST calls
      let r1: Awaited<ReturnType<typeof client.getTableContents>>;
      try {
        r1 = await client.getTableContents('T000', 1);
      } catch (err) {
        expectSapFailureClass(err, [404], [/No suitable resource/i, /not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview/ddic endpoint not available on this release`,
        );
        return;
      }
      expect(r1.rows.length).toBeGreaterThan(0);

      const r2 = await client.getTableContents('T000', 2);
      expect(r2.rows.length).toBeGreaterThan(0);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles special characters in search query', async () => {
      // Search with asterisk wildcard
      const results = await client.searchObject('*', 3);
      expect(results.length).toBeGreaterThan(0);
    });

    it('handles empty search query', async () => {
      // Edge case: both outcomes are acceptable, but we assert the shape of whichever occurs
      try {
        const results = await client.searchObject('', 1);
        expect(Array.isArray(results)).toBe(true);
      } catch (err) {
        // SAP may reject empty search — assert it's a known error shape
        expectSapFailureClass(err, [400, 404, 500], [/search/i, /invalid/i, /empty/i]);
      }
    });

    it('table contents with maxRows=0 returns something', async () => {
      // Edge case: both outcomes are acceptable, but we assert the shape of whichever occurs
      try {
        const result = await client.getTableContents('T000', 0);
        expect(result.columns).toContain('MANDT');
      } catch (err) {
        // Some systems may reject 0 as invalid — assert known error shape
        expectSapFailureClass(err, [400, 404, 500], [/invalid/i, /rows/i]);
      }
    });
  });

  // ─── Runtime Diagnostics ──────────────────────────────────────────

  describe('runtime diagnostics', () => {
    describe('short dumps', () => {
      it('lists dumps (may be empty)', async () => {
        const dumps = await listDumps(client.http, unrestrictedSafetyConfig());
        expect(Array.isArray(dumps)).toBe(true);
        if (dumps.length > 0) {
          // Verify structure
          expect(dumps[0]).toHaveProperty('id');
          expect(dumps[0]).toHaveProperty('timestamp');
          expect(dumps[0]).toHaveProperty('user');
          expect(dumps[0]).toHaveProperty('error');
          expect(dumps[0]).toHaveProperty('program');
        }
      });

      it('lists dumps with maxResults limit', async () => {
        const dumps = await listDumps(client.http, unrestrictedSafetyConfig(), { maxResults: 2 });
        expect(Array.isArray(dumps)).toBe(true);
        expect(dumps.length).toBeLessThanOrEqual(2);
      });

      it('lists dumps filtered by current user', async (ctx) => {
        const user = (process.env.TEST_SAP_USER || process.env.SAP_USER || '').toUpperCase();
        requireOrSkip(ctx, user || undefined, SkipReason.NO_CREDENTIALS);
        const dumps = await listDumps(client.http, unrestrictedSafetyConfig(), { user, maxResults: 5 });
        expect(Array.isArray(dumps)).toBe(true);
        // All returned dumps should be for this user
        for (const dump of dumps) {
          expect(dump.user.toUpperCase()).toBe(user);
        }
      });

      it('gets dump detail if dumps exist', async (ctx) => {
        const dumps = await listDumps(client.http, unrestrictedSafetyConfig(), { maxResults: 1 });
        if (dumps.length === 0) {
          ctx.skip(SkipReason.NO_DUMPS);
          return;
        }
        const detail = await getDump(client.http, unrestrictedSafetyConfig(), dumps[0]!.id);
        expect(detail.error).toBeTruthy();
        // exception may be empty for system-level dumps (not all dumps are ABAP exceptions)
        expect(typeof detail.exception).toBe('string');
        expect(detail.program).toBeTruthy();
        expect(detail.formattedText).toBeTruthy();
        expect(detail.formattedText).toContain(detail.error);
        expect(detail.chapters.length).toBeGreaterThan(0);
      });
    });

    describe('ABAP traces', () => {
      it('lists traces (may be empty)', async () => {
        const traces = await listTraces(client.http, unrestrictedSafetyConfig());
        expect(Array.isArray(traces)).toBe(true);
        if (traces.length > 0) {
          expect(traces[0]).toHaveProperty('id');
          expect(traces[0]).toHaveProperty('title');
          expect(traces[0]).toHaveProperty('timestamp');
        }
      });
    });

    describe('runtime feeds', () => {
      it('lists system messages when supported', async (ctx) => {
        try {
          const messages = await listSystemMessages(client.http, unrestrictedSafetyConfig(), { maxResults: 5 });
          expect(Array.isArray(messages)).toBe(true);
        } catch (err) {
          expectSapFailureClass(err, [400, 403, 404, 500], [/systemmessages|not found|unsupported|forbidden/i]);
          requireOrSkip(
            ctx,
            undefined,
            `${SkipReason.BACKEND_UNSUPPORTED}: /runtime/systemmessages endpoint not available on this system`,
          );
        }
      });

      it('lists gateway errors on on-prem systems', async (ctx) => {
        try {
          const errors = await listGatewayErrors(client.http, unrestrictedSafetyConfig(), { maxResults: 5 });
          expect(Array.isArray(errors)).toBe(true);
        } catch (err) {
          expectSapFailureClass(err, [400, 403, 404, 500], [/gw\/errorlog|not found|unsupported|forbidden/i]);
          requireOrSkip(
            ctx,
            undefined,
            `${SkipReason.BACKEND_UNSUPPORTED}: /gw/errorlog endpoint not available on this system`,
          );
        }
      });

      it('reads gateway error detail when entries are available', async (ctx) => {
        let errors: Awaited<ReturnType<typeof listGatewayErrors>> | undefined;
        try {
          errors = await listGatewayErrors(client.http, unrestrictedSafetyConfig(), { maxResults: 5 });
        } catch (err) {
          expectSapFailureClass(err, [400, 403, 404, 500], [/gw\/errorlog|not found|unsupported|forbidden/i]);
          requireOrSkip(
            ctx,
            undefined,
            `${SkipReason.BACKEND_UNSUPPORTED}: /gw/errorlog endpoint not available on this system`,
          );
          return;
        }

        if (!errors || errors.length === 0 || !errors[0]?.detailUrl) {
          ctx.skip(`${SkipReason.NO_FIXTURE}: no gateway error detail URL available`);
          return;
        }

        const detail = await getGatewayErrorDetail(client.http, unrestrictedSafetyConfig(), {
          detailUrl: errors[0].detailUrl,
        });
        expect(detail).toHaveProperty('transactionId');
        expect(detail).toHaveProperty('shortText');
      });
    });
  });

  // ─── Structured Class Read (AFF) ─────────────────────────────────

  describe('structured class read', () => {
    it('reads class metadata', async () => {
      const metadata = await client.getClassMetadata('CL_ABAP_CHAR_UTILITIES');
      expect(metadata.description).toBeTruthy();
      expect(metadata.language).toBeTruthy();
      expect(metadata.package).toBeTruthy();
      expect(metadata.name).toBe('CL_ABAP_CHAR_UTILITIES');
      expect(typeof metadata.fixPointArithmetic).toBe('boolean');
    });

    it('reads class with structured format', async () => {
      const result = await client.getClassStructured('CL_ABAP_CHAR_UTILITIES');
      // Metadata should be populated
      expect(result.metadata.description).toBeTruthy();
      expect(result.metadata.package).toBeTruthy();
      // Main source should be non-empty
      expect(result.main).toBeTruthy();
      expect(result.main.length).toBeGreaterThan(0);
      // Includes should be string or null
      for (const include of ['testclasses', 'definitions', 'implementations', 'macros'] as const) {
        expect(result[include] === null || typeof result[include] === 'string').toBe(true);
      }
    });

    it('returns error for non-existent class metadata', async () => {
      await expect(client.getClassMetadata('ZCL_NONEXISTENT_999')).rejects.toThrow();
    });
  });

  // ─── Batch Create (AFF) ─────────────────────────────────────────

  describe('batch create in $TMP', () => {
    const suffix = Date.now().toString(36).toUpperCase();
    const prog1 = `ZARC1_BAT1_${suffix}`;
    const prog2 = `ZARC1_BAT2_${suffix}`;
    const createdPrograms: string[] = [];

    afterAll(async () => {
      // Clean up: delete any programs created during the test
      const { deleteObject, lockObject } = await import('../../src/adt/crud.js');
      const { unrestrictedSafetyConfig } = await import('../../src/adt/safety.js');
      const safety = unrestrictedSafetyConfig();
      for (const name of createdPrograms) {
        try {
          const objectUrl = `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}`;
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, safety, objectUrl);
            await deleteObject(session, safety, objectUrl, lock.lockHandle);
          });
        } catch {
          // best-effort-cleanup
        }
      }
    });

    it('creates multiple programs in sequence', async () => {
      const { createObject } = await import('../../src/adt/crud.js');
      const { buildCreateXml } = await import('../../src/handlers/intent.js');
      const { unrestrictedSafetyConfig } = await import('../../src/adt/safety.js');
      const safety = unrestrictedSafetyConfig();

      // Create first program
      const xml1 = buildCreateXml('PROG', prog1, '$TMP', 'ARC1 batch test 1');
      await createObject(client.http, safety, '/sap/bc/adt/programs/programs', xml1);
      createdPrograms.push(prog1);

      // Create second program
      const xml2 = buildCreateXml('PROG', prog2, '$TMP', 'ARC1 batch test 2');
      await createObject(client.http, safety, '/sap/bc/adt/programs/programs', xml2);
      createdPrograms.push(prog2);

      // Verify both exist by reading them
      const { source: source1 } = await client.getProgram(prog1);
      expect(typeof source1).toBe('string');

      const { source: source2 } = await client.getProgram(prog2);
      expect(typeof source2).toBe('string');
    });
  });

  // ─── CDS Impact Analysis ──────────────────────────────────────────

  describe('CDS impact analysis', () => {
    it('classifies downstream consumers for I_ABAPPACKAGE', async (ctx) => {
      let results: Awaited<ReturnType<typeof findWhereUsed>>;
      try {
        results = await findWhereUsed(client.http, client.safety, '/sap/bc/adt/ddic/ddl/sources/i_abappackage');
      } catch (err) {
        expectSapFailureClass(err, [403, 404, 500], [/not found/i, /forbidden/i, /usageReferences/i]);
        requireOrSkip(ctx, undefined, SkipReason.BACKEND_UNSUPPORTED);
        return;
      }
      const downstream = classifyCdsImpact(results);
      // I_ABAPPACKAGE is an S/4-only CDS view; on systems that don't ship it,
      // findWhereUsed returns an empty where-used graph. Skip rather than
      // fabricate expectations.
      if (downstream.summary.total === 0) {
        requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (I_ABAPPACKAGE) — S/4 CDS view not on this system`);
      }
      expect(downstream.accessControls.length).toBeGreaterThanOrEqual(1);
      expect(
        downstream.accessControls.some((entry) => entry.name === 'I_ABAPPACKAGE' && entry.type === 'DCLS/DL'),
      ).toBe(true);
      expect(downstream.summary.total).toBeGreaterThanOrEqual(2);
    });

    it('includeIndirect=true returns at least as many entries as default', async (ctx) => {
      try {
        const results = await findWhereUsed(client.http, client.safety, '/sap/bc/adt/ddic/ddl/sources/i_abappackage');
        const directOnly = classifyCdsImpact(results);
        const withIndirect = classifyCdsImpact(results, { includeIndirect: true });

        if (directOnly.summary.total === 0) {
          requireOrSkip(ctx, undefined, SkipReason.BACKEND_UNSUPPORTED);
        }
        expect(withIndirect.summary.total).toBeGreaterThanOrEqual(directOnly.summary.total);
      } catch (err) {
        expectSapFailureClass(err, [403, 404, 500], [/not found/i, /forbidden/i, /usageReferences/i]);
        requireOrSkip(ctx, undefined, SkipReason.BACKEND_UNSUPPORTED);
      }
    });
  });

  // ─── RAP Handler Scaffolding Helpers ───────────────────────────────

  describe('RAP handler scaffolding helpers', () => {
    const bdefFixture = '/DMO/I_CARRIERSLOCKSINGLETON_S';

    async function readRapFixture(ctx: import('vitest').TaskContext): Promise<{
      bdefSource: string;
      behaviorPoolClass: string;
      classStructured: Awaited<ReturnType<AdtClient['getClassStructured']>>;
    }> {
      try {
        const { source: bdefSource } = await client.getBdef(bdefFixture);
        const behaviorPoolClass = bdefSource.match(/implementation\s+in\s+class\s+([^\s;]+)/i)?.[1];
        requireOrSkip(ctx, behaviorPoolClass, `${SkipReason.NO_FIXTURE} (${bdefFixture}) — no implementation class`);
        const classStructured = await client.getClassStructured(behaviorPoolClass);
        return { bdefSource, behaviorPoolClass, classStructured };
      } catch (err) {
        expectSapFailureClass(err, [403, 404], [/not found/i, /forbidden/i]);
        requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (${bdefFixture}) — RAP demo fixture not available`);
      }
    }

    it('extracts handler requirements from live BDEF source', async (ctx) => {
      const { bdefSource } = await readRapFixture(ctx);
      const requirements = extractRapHandlerRequirements(bdefSource);
      const firstRequirement = requirements[0];
      requireOrSkip(
        ctx,
        firstRequirement,
        `${SkipReason.NO_FIXTURE} (${bdefFixture}) — no action/validation/auth requirements in BDEF`,
      );

      expect(requirements.length).toBeGreaterThan(0);
      expect(requirements.some((req) => req.kind === 'validation' || req.kind === 'action')).toBe(true);
    });

    it('matches requirements against live class source across includes', async (ctx) => {
      const { bdefSource, classStructured } = await readRapFixture(ctx);
      const requirements = extractRapHandlerRequirements(bdefSource);
      const firstRequirement = requirements[0];
      requireOrSkip(
        ctx,
        firstRequirement,
        `${SkipReason.NO_FIXTURE} (${bdefFixture}) — no requirements to match against class source`,
      );

      const combinedClassSource = [
        classStructured.main,
        classStructured.definitions ?? '',
        classStructured.implementations ?? '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const missing = findMissingRapHandlerRequirements(requirements, combinedClassSource);

      expect(missing.length).toBeLessThanOrEqual(requirements.length);
      expect(
        missing.every((missingReq) =>
          requirements.some(
            (requirement) =>
              requirement.targetHandlerClass === missingReq.targetHandlerClass &&
              requirement.methodName === missingReq.methodName,
          ),
        ),
      ).toBe(true);
    });

    // Regression baseline: SAP demo class BP_DEMO_RAP_STRICT (package SABAPDEMOS) is the
    // canonical-layout reference for handler-class includes — empty CCDEF, full
    // DEFINITION+IMPLEMENTATION pair in CCIMP. Captured live on a4h S/4HANA 2023 (ABAP 7.58)
    // as fixtures in tests/fixtures/abap/bp-demo-rap-strict-{ccdef,ccimp}.abap. If this test
    // fails, either the fixture has drifted from the live system or the demo class is not
    // available on the test target.
    it('SAP demo BP_DEMO_RAP_STRICT shows canonical CCDEF-empty + CCIMP-full layout', async (ctx) => {
      let structured: Awaited<ReturnType<AdtClient['getClassStructured']>>;
      try {
        structured = await client.getClassStructured('BP_DEMO_RAP_STRICT');
      } catch (err) {
        expectSapFailureClass(err, [403, 404], [/not found/i, /forbidden/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.NO_FIXTURE} (BP_DEMO_RAP_STRICT) — SAP RAP demo class not on this system`,
        );
      }

      // CCDEF: only the SAP-generated placeholder comment, no class declarations.
      const ccdef = structured!.definitions ?? '';
      expect(ccdef.length).toBeGreaterThan(0);
      expect(ccdef).not.toMatch(/CLASS\s+lhc_/i);
      expect(ccdef).not.toMatch(/cl_abap_behavior_handler/i);
      // CCIMP: the full handler class — DEFINITION block followed by IMPLEMENTATION block.
      const ccimp = structured!.implementations ?? '';
      expect(ccimp).toMatch(/CLASS\s+lhc_demo_rap_strict\s+DEFINITION\s+INHERITING\s+FROM\s+cl_abap_behavior_handler/i);
      expect(ccimp).toMatch(/CLASS\s+lhc_demo_rap_strict\s+IMPLEMENTATION/i);
      // ABAP forward-reference rule: DEFINITION must come before IMPLEMENTATION in CCIMP.
      const defIdx = ccimp.search(/CLASS\s+lhc_demo_rap_strict\s+DEFINITION/i);
      const implIdx = ccimp.search(/CLASS\s+lhc_demo_rap_strict\s+IMPLEMENTATION/i);
      expect(defIdx).toBeGreaterThanOrEqual(0);
      expect(implIdx).toBeGreaterThan(defIdx);
    });

    it('can re-insert a deliberately removed signature in the live implementation include', async (ctx) => {
      const { bdefSource, classStructured } = await readRapFixture(ctx);
      const requirements = extractRapHandlerRequirements(bdefSource);
      const implementationSource = classStructured.implementations;
      requireOrSkip(
        ctx,
        implementationSource,
        `${SkipReason.NO_FIXTURE} (${bdefFixture}) — no implementations include available`,
      );

      const requirement = requirements.find(
        (req) =>
          req.targetHandlerClass.toLowerCase() === 'lhc_carrier' &&
          (req.kind === 'validation' || req.kind === 'action'),
      );
      requireOrSkip(
        ctx,
        requirement,
        `${SkipReason.NO_FIXTURE} (${bdefFixture}) — expected handler requirement not found`,
      );

      const declarationRegex = new RegExp(
        `(^|\\n)\\s*METHODS\\s+${requirement.methodName}\\b[\\s\\S]*?\\.\\s*(?=\\n\\s*(?:METHODS\\b|ENDCLASS\\.))`,
        'i',
      );
      if (!declarationRegex.test(implementationSource)) {
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.NO_FIXTURE} (${bdefFixture}) — method declaration ${requirement.methodName} not present in fixture`,
        );
      }
      const stripped = implementationSource.replace(declarationRegex, '\n');

      const apply = applyRapHandlerSignatures(stripped, [requirement]);
      expect(apply.changed).toBe(true);
      expect(apply.inserted).toHaveLength(1);
      expect(apply.updatedSource.toLowerCase()).toContain(`methods ${requirement.methodName}`);
    });
  });

  // ─── edit_method against class includes (CCIMP) — PR-D ───────────
  //
  // Smoke test for SAPWrite(action="edit_method", method="<localclass>~<method>")
  // routing to /sap/bc/adt/oo/classes/{name}/includes/implementations.
  // Uses the same lock+PUT+unlock flow PR #257 verified for `case 'update'`,
  // so the URL contract on NW 7.50 is already covered there. This test just
  // proves the edit_method dispatch picks the right include and the splice
  // round-trips through ADT.
  //
  // Verified URL pattern against a4h on 2026-05-10 (manual curl):
  //   GET  /sap/bc/adt/oo/classes/{name}/includes/implementations
  //   POST /sap/bc/adt/oo/classes/{name}?_action=LOCK&accessMode=MODIFY
  //   PUT  /sap/bc/adt/oo/classes/{name}/includes/implementations?lockHandle=...
  //   POST /sap/bc/adt/oo/classes/{name}?_action=UNLOCK&lockHandle=...

  describe('edit_method against class includes (CCIMP)', () => {
    it('round-trips a local handler method body through /includes/implementations', async (ctx) => {
      requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.NO_CREDENTIALS);
      const { generateUniqueName } = await import('./crud-harness.js');
      const { handleToolCall } = await import('../../src/handlers/intent.js');
      const className = generateUniqueName('ZARC1_PRD');
      const config = {
        arc1Port: 8080,
        arc1HttpAddr: '0.0.0.0:8080',
        toolMode: 'standard',
      } as unknown as Parameters<typeof handleToolCall>[1];

      // Track whether the class was created so cleanup runs even if
      // intermediate steps fail.
      let created = false;
      try {
        // 1. Create empty CLAS in $TMP (auto-generated MAIN + empty includes)
        const createResult = await handleToolCall(client, config, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: className,
          description: 'PR-D edit_method smoke test (transient)',
          package: '$TMP',
        });
        expect(createResult.isError).toBeUndefined();
        created = true;

        // 2. Populate CCDEF (declarations) and CCIMP (implementation) so the
        // class compiles. ABAP requires both halves of the local class.
        const ccdefSource =
          'CLASS lcl_helper DEFINITION.\n' +
          '  PUBLIC SECTION.\n' +
          '    METHODS hello\n' +
          '      EXPORTING ev_text TYPE string.\n' +
          'ENDCLASS.';
        const ccimpSourceOld =
          'CLASS lcl_helper IMPLEMENTATION.\n' +
          '  METHOD hello.\n' +
          "    ev_text = 'old'.\n" +
          '  ENDMETHOD.\n' +
          'ENDCLASS.';

        const writeDef = await handleToolCall(client, config, 'SAPWrite', {
          action: 'update',
          type: 'CLAS',
          name: className,
          include: 'definitions',
          source: ccdefSource,
          lintBeforeWrite: false,
        });
        expect(writeDef.isError).toBeUndefined();

        const writeImpl = await handleToolCall(client, config, 'SAPWrite', {
          action: 'update',
          type: 'CLAS',
          name: className,
          include: 'implementations',
          source: ccimpSourceOld,
          lintBeforeWrite: false,
        });
        expect(writeImpl.isError).toBeUndefined();

        // 3. Activate so the class compiles cleanly.
        const activateResult = await handleToolCall(client, config, 'SAPActivate', {
          objects: [{ type: 'CLAS', name: className }],
        });
        expect(activateResult.isError).toBeUndefined();

        // 4. The actual PR-D test: surgically replace lcl_helper~hello.
        const editResult = await handleToolCall(client, config, 'SAPWrite', {
          action: 'edit_method',
          type: 'CLAS',
          name: className,
          method: 'lcl_helper~hello',
          source: "    ev_text = 'new'.",
        });
        expect(editResult.isError).toBeUndefined();
        expect(editResult.content[0]?.text).toContain('include: implementations');

        // 5. Read CCIMP back and confirm the body changed.
        const readResult = await handleToolCall(client, config, 'SAPRead', {
          type: 'CLAS',
          name: className,
          include: 'implementations',
          version: 'inactive', // include writes create an inactive draft
        });
        expect(readResult.isError).toBeUndefined();
        const text = readResult.content[0]?.text ?? '';
        expect(text).toContain("ev_text = 'new'");
        expect(text).not.toContain("ev_text = 'old'");
      } finally {
        // best-effort-cleanup
        if (created) {
          try {
            await handleToolCall(client, config, 'SAPWrite', {
              action: 'delete',
              type: 'CLAS',
              name: className,
            });
          } catch {
            // best-effort-cleanup; transient $TMP class will time out eventually
          }
        }
      }
    });
  });

  // ─── DDLX (Metadata Extension) Operations ─────────────────────────

  describe('DDLX read operations', () => {
    it('reads a DDLX metadata extension source', async (ctx) => {
      requireDmoDdlx(ctx);
      // /DMO/C_AGENCYTP is a standard demo DDLX from the Flight Reference Scenario
      const { source } = await client.getDdlx('/DMO/C_AGENCYTP');
      expect(source).toBeTruthy();
      expect(source).toContain('@Metadata.layer');
      expect(source).toContain('annotate');
    });

    it('reads DDLX with UI annotations', async (ctx) => {
      requireDmoDdlx(ctx);
      const { source } = await client.getDdlx('/DMO/C_TRAVEL_A_D');
      expect(source).toBeTruthy();
      expect(source).toContain('@UI');
    });

    it('returns 404 for non-existent DDLX', async () => {
      await expect(client.getDdlx('ZZZNOTEXIST_DDLX_999')).rejects.toThrow();
    });
  });

  // ─── SRVB (Service Binding) Operations ─────────────────────────────

  describe('SRVB read operations', () => {
    it('reads a service binding and returns parsed JSON', async (ctx) => {
      requireDmoSrvb(ctx);
      // /DMO/UI_AGENCY_O4 is a standard demo SRVB from the Flight Reference Scenario
      const { source } = await client.getSrvb('/DMO/UI_AGENCY_O4');
      const parsed = JSON.parse(source);
      expect(parsed.name).toBe('/DMO/UI_AGENCY_O4');
      expect(parsed.type).toBe('SRVB/SVB');
      expect(parsed.odataVersion).toBe('V4');
      expect(parsed.bindingType).toBe('ODATA');
      expect(parsed.bindingCategory).toBe('UI');
      expect(parsed.serviceDefinition).toBeTruthy();
    });

    it('reads a V2 service binding', async (ctx) => {
      requireDmoSrvb(ctx);
      const { source } = await client.getSrvb('/DMO/UI_TRAVEL_U_V2');
      const parsed = JSON.parse(source);
      expect(parsed.name).toBe('/DMO/UI_TRAVEL_U_V2');
      expect(parsed.odataVersion).toBe('V2');
    });

    it('returns 404 for non-existent SRVB', async () => {
      await expect(client.getSrvb('ZZZNOTEXIST_SRVB_999')).rejects.toThrow();
    });
  });

  // ─── SAPSearch tadir_lookup source variants ─────────────────────────
  //
  // Coverage for the SAPSearch tadir_lookup split-brain fix.
  // - source='adt' (default) preserves today's ADT info-system behavior.
  // - source='db' issues SQL against TADIR — also surfaces orphan/ghost rows.
  // - source='both' merges results and emits a `splitBrain` array.
  //
  // The post-delete test asserts only on response shape, not on the presence of a ghost
  // (whether SAP leaves a ghost behind after delete is release-/auth-dependent).

  describe('SAPSearch tadir_lookup source variants', () => {
    it('source=adt|db|both all find a freshly-created Z DDLS in $TMP (no splitBrain)', async (ctx) => {
      requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.NO_CREDENTIALS);
      const { generateUniqueName } = await import('./crud-harness.js');
      const { handleToolCall } = await import('../../src/handlers/intent.js');
      const ddlsName = generateUniqueName('ZRES_TADIR_');
      const config = {
        arc1Port: 8080,
        arc1HttpAddr: '0.0.0.0:8080',
        toolMode: 'standard',
      } as unknown as Parameters<typeof handleToolCall>[1];

      let created = false;
      try {
        // 1. Create a simple Z DDLS view in $TMP
        const createResult = await handleToolCall(client, config, 'SAPWrite', {
          action: 'create',
          type: 'DDLS',
          name: ddlsName,
          package: '$TMP',
          description: 'tadir_lookup source variants smoke test (transient)',
          source:
            `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
            `define view entity ${ddlsName} as select from t000 { key mandt as Client }`,
          lintBeforeWrite: false,
        });
        expect(createResult.isError).toBeUndefined();
        created = true;

        // 2. Activate the view so ADT can resolve it (info-system filters drafts).
        const activateResult = await handleToolCall(client, config, 'SAPActivate', {
          objects: [{ type: 'DDLS', name: ddlsName }],
        });
        expect(activateResult.isError).toBeUndefined();

        // 3. Lookup via adt — should find the activated view.
        const adtLookup = await handleToolCall(client, config, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: [ddlsName],
          source: 'adt',
        });
        expect(adtLookup.isError).toBeUndefined();
        const adtPayload = JSON.parse(adtLookup.content[0]?.text ?? '{}');
        expect(adtPayload.lookups[0]?.found).toBe(true);

        // 4. Lookup via db — should find the TADIR row.
        const dbLookup = await handleToolCall(client, config, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: [ddlsName],
          source: 'db',
        });
        expect(dbLookup.isError).toBeUndefined();
        const dbPayload = JSON.parse(dbLookup.content[0]?.text ?? '{}');
        expect(dbPayload.lookups[0]?.found).toBe(true);
        expect(dbPayload.lookups[0]?.matches[0]?._origin).toBe('db');

        // 5. Lookup via both — both sources agree; no splitBrain reported.
        const bothLookup = await handleToolCall(client, config, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: [ddlsName],
          source: 'both',
        });
        expect(bothLookup.isError).toBeUndefined();
        const bothPayload = JSON.parse(bothLookup.content[0]?.text ?? '{}');
        expect(bothPayload.lookups[0]?.found).toBe(true);
        expect(bothPayload.splitBrain).toBeUndefined();
      } finally {
        // best-effort-cleanup
        if (created) {
          try {
            await handleToolCall(client, config, 'SAPWrite', {
              action: 'delete',
              type: 'DDLS',
              name: ddlsName,
            });
          } catch {
            // best-effort-cleanup; $TMP DDLS will time out eventually
          }
        }
      }
    });

    it('source variants stay shape-consistent after delete (ghost or clean)', async (ctx) => {
      requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.NO_CREDENTIALS);
      const { generateUniqueName } = await import('./crud-harness.js');
      const { handleToolCall } = await import('../../src/handlers/intent.js');
      const ddlsName = generateUniqueName('ZRES_TGHOST_');
      const config = {
        arc1Port: 8080,
        arc1HttpAddr: '0.0.0.0:8080',
        toolMode: 'standard',
      } as unknown as Parameters<typeof handleToolCall>[1];

      // Create + delete cycle, then probe all three sources. Either outcome is a passing test:
      //  (a) ADT and DB both report `found:false` → clean delete, no splitBrain.
      //  (b) DB reports `found:true`, ADT reports `found:false` → TADIR ghost; splitBrain=[name].
      // The contract under test is response shape + consistency, not the presence of a ghost.
      const createResult = await handleToolCall(client, config, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: ddlsName,
        package: '$TMP',
        description: 'tadir_lookup ghost-probe transient',
        source:
          `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
          `define view entity ${ddlsName} as select from t000 { key mandt as Client }`,
        lintBeforeWrite: false,
      });
      expect(createResult.isError).toBeUndefined();
      // Delete without activating — SAP's draft cleanup is the most likely ghost-producer path.
      const deleteResult = await handleToolCall(client, config, 'SAPWrite', {
        action: 'delete',
        type: 'DDLS',
        name: ddlsName,
      });
      // The delete may still report an error if the draft is in a tricky state — but the
      // post-condition we care about is the lookup shape.
      void deleteResult;

      const bothLookup = await handleToolCall(client, config, 'SAPSearch', {
        searchType: 'tadir_lookup',
        names: [ddlsName],
        source: 'both',
      });
      expect(bothLookup.isError).toBeUndefined();
      const payload = JSON.parse(bothLookup.content[0]?.text ?? '{}');

      // Shape invariants — same regardless of ghost-vs-clean outcome:
      expect(Array.isArray(payload.lookups)).toBe(true);
      expect(payload.lookups[0]?.name).toBe(ddlsName);
      // Either splitBrain reports the ghost OR both sources agree (no splitBrain field).
      if (payload.splitBrain) {
        expect(payload.splitBrain).toEqual([ddlsName]);
        expect(Array.isArray(payload.warnings)).toBe(true);
        expect(payload.warnings[0]).toContain(ddlsName);
      } else {
        expect(payload.lookups[0]?.found).toBe(false);
      }
    });
  });

  // ─── SAPWrite batch_create activateAtEnd ────────────────────────────
  //
  // Coverage for the deferred-activation fix on composition-linked DDLS:
  // - With default activateAtEnd=false, per-object inline activate fails on the parent
  //   because the child sibling is still inactive.
  // - With activateAtEnd=true, ARC-1 writes inactive drafts for both objects then issues
  //   one terminal activateBatch — SAP resolves the cross-reference internally.

  describe('SAPWrite batch_create activateAtEnd', () => {
    it('default (activateAtEnd=false) fails on composition-linked DDLS — documents the failure mode', async (ctx) => {
      requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.NO_CREDENTIALS);
      const { generateUniqueName } = await import('./crud-harness.js');
      const { handleToolCall } = await import('../../src/handlers/intent.js');
      const parentName = generateUniqueName('ZRES_BCPAR_');
      const childName = generateUniqueName('ZRES_BCCHD_');
      const config = {
        arc1Port: 8080,
        arc1HttpAddr: '0.0.0.0:8080',
        toolMode: 'standard',
      } as unknown as Parameters<typeof handleToolCall>[1];

      try {
        const result = await handleToolCall(client, config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          lintBeforeWrite: false,
          objects: [
            {
              type: 'DDLS',
              name: parentName,
              description: 'composition parent (transient)',
              source:
                `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
                `define root view entity ${parentName} as select from t000 ` +
                `composition [0..*] of ${childName} as _Child ` +
                `{ key mandt as Client, _Child }`,
            },
            {
              type: 'DDLS',
              name: childName,
              description: 'composition child (transient)',
              source:
                `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
                `define view entity ${childName} ` +
                `as select from t000 association to parent ${parentName} as _Parent ` +
                `on $projection.Client = _Parent.Client ` +
                `{ key mandt as Client, _Parent }`,
            },
          ],
        });
        // Per-object inline activate fails on the parent — well-known message family.
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? '';
        // Either the parent's activation hit the unresolved sibling, or the SAP backend
        // refused the composition outright. Both confirm the failure mode this PR fixes.
        expect(text).toMatch(/does not exist or is not active|activation failed|Composition target/i);
      } finally {
        for (const name of [parentName, childName]) {
          try {
            await handleToolCall(client, config, 'SAPWrite', {
              action: 'delete',
              type: 'DDLS',
              name,
            });
          } catch {
            // best-effort-cleanup
          }
        }
      }
    });

    it('activateAtEnd=true activates a composition-linked DDLS pair in a single terminal batch', async (ctx) => {
      requireOrSkip(ctx, process.env.TEST_SAP_URL, SkipReason.NO_CREDENTIALS);
      const { generateUniqueName } = await import('./crud-harness.js');
      const { handleToolCall } = await import('../../src/handlers/intent.js');
      const parentName = generateUniqueName('ZRES_AAPAR_');
      const childName = generateUniqueName('ZRES_AACHD_');
      const config = {
        arc1Port: 8080,
        arc1HttpAddr: '0.0.0.0:8080',
        toolMode: 'standard',
      } as unknown as Parameters<typeof handleToolCall>[1];

      try {
        const result = await handleToolCall(client, config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          activateAtEnd: true,
          lintBeforeWrite: false,
          objects: [
            {
              type: 'DDLS',
              name: parentName,
              description: 'composition parent (transient)',
              source:
                `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
                `define root view entity ${parentName} as select from t000 ` +
                `composition [0..*] of ${childName} as _Child ` +
                `{ key mandt as Client, _Child }`,
            },
            {
              type: 'DDLS',
              name: childName,
              description: 'composition child (transient)',
              source:
                `@AccessControl.authorizationCheck: #NOT_REQUIRED\n` +
                `define view entity ${childName} ` +
                `as select from t000 association to parent ${parentName} as _Parent ` +
                `on $projection.Client = _Parent.Client ` +
                `{ key mandt as Client, _Parent }`,
            },
          ],
        });
        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('activated as a single batch');
        expect(text).toContain(parentName);
        expect(text).toContain(childName);

        // Confirm both are active by reading them back.
        for (const name of [parentName, childName]) {
          const read = await handleToolCall(client, config, 'SAPRead', {
            type: 'DDLS',
            name,
          });
          expect(read.isError).toBeUndefined();
        }
      } finally {
        for (const name of [parentName, childName]) {
          try {
            await handleToolCall(client, config, 'SAPWrite', {
              action: 'delete',
              type: 'DDLS',
              name,
            });
          } catch {
            // best-effort-cleanup
          }
        }
      }
    });
  });
});
