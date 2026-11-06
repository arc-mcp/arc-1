/** Package listing contract; systems without native package filtering must refuse the operation. */
import { beforeAll, describe, expect, it } from 'vitest';
import { AdtApiError } from '../../src/adt/errors.js';
import { supportsPackageFilteredSearch } from '../../src/adt/package-contents.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient } from './helpers.js';

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
  const client = getTestClient();
  let filteredSearchAvailable = false;
  beforeAll(async () => {
    const discovery = await client.http.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' });
    filteredSearchAvailable = supportsPackageFilteredSearch(discovery.body);
  });
  function requireFilteredSearch(ctx: import('vitest').TestContext) {
    requireOrSkip(
      ctx,
      filteredSearchAvailable || undefined,
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT quicksearch does not advertise packageName`,
    );
  }
  async function getPackageContentsFixtureOrSkip(
    ctx: import('vitest').TestContext,
    packageName: string,
    maxResults?: number,
  ) {
    requireFilteredSearch(ctx);
    try {
      return await client.getPackageContents(packageName, maxResults);
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 400 && /Package is invalid/i.test(err.message)) {
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.NO_FIXTURE} (${packageName}) — demo package not on this SAP system; see SEGW->RAP demo setup`,
        );
        return [];
      }
      throw err;
    }
  }

  it('returns a bounded standard package listing or explicitly refuses unsupported filtering', async () => {
    if (!filteredSearchAvailable) {
      await expect(client.getPackageContents('SABP_UNIT', 3)).rejects.toThrow(
        'does not advertise package-filtered ADT search',
      );
      await expect(client.getPackageContents('ZNONEXISTENT_PKG_99X', 3)).rejects.toThrow(
        'does not advertise package-filtered ADT search',
      );
      return;
    }
    const contents = await client.getPackageContents('SABP_UNIT', 3);
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.length).toBeLessThanOrEqual(3);
  });

  it('returns objects with descriptions correctly aligned to names', async (ctx) => {
    const contents = await getPackageContentsFixtureOrSkip(ctx, 'ZDEMO_MIG');
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
    const contents = await getPackageContentsFixtureOrSkip(ctx, 'ZDEMO_MIG');
    const sub = contents.find((c) => c.name === 'ZDEMO_MIG_RAP');
    requireOrSkip(ctx, sub, `${SkipReason.NO_FIXTURE} (ZDEMO_MIG_RAP sub-package) — demo workspace not fully set up`);
    expect(sub.type).toBe('DEVC/K');
    // The sub-package's OWN description must be on its OWN row — pre-fix,
    // this string showed up on a CLAS row instead.
    expect(sub.description).toBe('Demo: RAP migration outputs from migrate-segw-to-rap skill');
  });

  it('aligns SEGW-generated CLAS descriptions with their own names', async (ctx) => {
    const contents = await getPackageContentsFixtureOrSkip(ctx, 'ZDEMO_MIG');
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
    const contents = await getPackageContentsFixtureOrSkip(ctx, 'ZDEMO_MIG_RAP');
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

  it('throws AdtApiError 400 for a non-existent package name', async (ctx) => {
    requireFilteredSearch(ctx);
    // The search endpoint validates package names server-side: invalid → 400.
    // This is the documented behaviour we propagate to callers (don't silently swallow).
    const listing = client.getPackageContents('ZNONEXISTENT_PKG_99X');
    await expect(listing).rejects.toBeInstanceOf(AdtApiError);
    await expect(listing).rejects.toMatchObject({ statusCode: 400 });
  });

  it('honors maxResults parameter', async (ctx) => {
    // ZDEMO_MIG has roughly 17 objects via the search endpoint.
    // Asking for 3 must cap at 3.
    const contents = await getPackageContentsFixtureOrSkip(ctx, 'ZDEMO_MIG', 3);
    requireOrSkip(
      ctx,
      contents.length > 0 ? contents : null,
      `${SkipReason.NO_FIXTURE} (ZDEMO_MIG) — demo package not on test system`,
    );
    expect(contents.length).toBeLessThanOrEqual(3);
  });
});
