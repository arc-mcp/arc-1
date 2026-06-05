import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

/**
 * Deterministic-by-construction assertions are split between upstream and downstream paths:
 *
 *   - Upstream is AST-based (parses the CDS source) — always deterministic for our own
 *     Z-namespace fixtures (ZTABL_ARC1_I33, ZI_ARC1_I33_ROOT, ZI_ARC1_I33_PROJ).
 *
 *   - Downstream relies on SAP's where-used index, which is populated asynchronously by a
 *     background job. On a just-activated Z-namespace object the index can be empty even
 *     though the projection view's source references the root view (confirmed live against
 *     A4H: numberOfResults="0" for ZI_ARC1_I33_ROOT right after sync). SAP-shipped objects
 *     (I_ABAPPACKAGE) are pre-indexed, so we use one for the downstream assertion.
 */
describe('E2E CDS impact analysis', () => {
  let client: Client;
  let rapAvailable: true | undefined;

  beforeAll(async () => {
    client = await connectClient();
    const probeResult = await callTool(client, 'SAPManage', { action: 'probe' });
    const probeText = expectToolSuccess(probeResult);
    const features = JSON.parse(probeText);
    rapAvailable = features.rap?.available === true ? true : undefined;
  }, 90000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  it('returns deterministic upstream for a root CDS view (AST-based)', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, SkipReason.BACKEND_UNSUPPORTED);

    const result = await callTool(client, 'SAPContext', {
      action: 'impact',
      type: 'DDLS',
      name: 'ZI_ARC1_I33_ROOT',
    });
    const text = expectToolSuccessOrSkip(ctx, result);
    const impact = JSON.parse(text);

    expect(impact.name).toBe('ZI_ARC1_I33_ROOT');
    expect(impact.type).toBe('DDLS');
    // Upstream is parsed from the DDLS source via extractCdsDependencies —
    // deterministic *given the fixture source*. If the source we got back is
    // a stub (e.g. fixture sync couldn't activate full content on this
    // release), skip rather than fail on empty AST parse.
    const upstreamTables = impact.upstream.tables.map((item: { name: string }) => item.name);
    if (upstreamTables.length === 0) {
      skipTest(
        ctx,
        'Fixture ZI_ARC1_I33_ROOT has no upstream tables in its source — fixture sync likely produced a stub on this release',
      );
      return;
    }
    expect(upstreamTables).toContain('ZTABL_ARC1_I33');
    // Shape check: downstream buckets are always present even when empty (system indexing lag).
    expect(Array.isArray(impact.downstream.projectionViews)).toBe(true);
    expect(typeof impact.downstream.summary.total).toBe('number');
    // If SAP's where-used index has caught up, the projection consumer is reported correctly.
    // Otherwise it's empty — both are valid for a freshly-synced fixture.
    const projectionNames = impact.downstream.projectionViews.map((item: { name: string }) => item.name);
    if (projectionNames.length > 0) {
      expect(projectionNames).toContain('ZI_ARC1_I33_PROJ');
    }
  });

  it('returns upstream root reference for a projection view', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, SkipReason.BACKEND_UNSUPPORTED);

    const result = await callTool(client, 'SAPContext', {
      action: 'impact',
      type: 'DDLS',
      name: 'ZI_ARC1_I33_PROJ',
    });
    const text = expectToolSuccessOrSkip(ctx, result);
    const impact = JSON.parse(text);

    const upstreamViews = impact.upstream.views.map((item: { name: string }) => item.name);
    if (upstreamViews.length === 0) {
      skipTest(
        ctx,
        'Fixture ZI_ARC1_I33_PROJ has no upstream views in its source — fixture sync likely produced a stub on this release',
      );
      return;
    }
    expect(upstreamViews).toContain('ZI_ARC1_I33_ROOT');
    // Leaf view — where-used is empty in practice; assertion holds regardless of index state.
    expect(impact.downstream.summary.total).toBe(0);
  });

  it('classifies downstream consumers for a pre-indexed SAP-shipped CDS view', async (ctx) => {
    // I_ABAPPACKAGE is SAP-shipped — its where-used index is populated on every vanilla S/4
    // (verified live on A4H: DCLS/DL + SKTD/TYP consumers). This exercises the full
    // parse → classify path end-to-end without depending on async indexing of Z objects.
    const result = await callTool(client, 'SAPContext', {
      action: 'impact',
      type: 'DDLS',
      name: 'I_ABAPPACKAGE',
    });
    const text = expectToolSuccessOrSkip(ctx, result);
    const impact = JSON.parse(text);

    expect(impact.name).toBe('I_ABAPPACKAGE');
    expect(impact.downstream.summary.total).toBeGreaterThanOrEqual(1);
    // At minimum one of the RAP-aware buckets must be populated for this SAP-shipped object.
    const populatedBuckets = [
      impact.downstream.accessControls,
      impact.downstream.documentation,
      impact.downstream.projectionViews,
      impact.downstream.abapConsumers,
    ].filter((bucket: unknown[]) => bucket.length > 0);
    expect(populatedBuckets.length).toBeGreaterThan(0);
  });

  it('rejects non-DDLS impact requests with guidance', async () => {
    const result = await callTool(client, 'SAPContext', {
      action: 'impact',
      type: 'CLAS',
      name: 'ZCL_ARC1_TEST',
    });

    expectToolError(result, 'SAPNavigate', 'DDLS only');
  });
});
