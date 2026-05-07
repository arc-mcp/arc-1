/**
 * Replay-based probe tests.
 *
 * Reads a fixture directory produced by `scripts/probe-adt-types.ts
 * --save-fixtures <dir>` and re-runs the classifier against it. This is the
 * regression guard for changes to runner.ts/classifyVerdict — any shift in
 * decision logic for the recorded responses shows up here.
 *
 * The synthetic-752 fixture is hand-crafted to cover the decision branches
 * that matter (available-high, available-medium, unavailable-high, ambiguous,
 * auth-blocked). Real-system fixtures contributed by users drop in next to it.
 */

import { describe, expect, it } from 'vitest';
import { CATALOG, getCatalogEntry } from '../../../src/probe/catalog.js';
import { createReplayFetcher, discoveryMapFromMeta } from '../../../src/probe/fixtures.js';
import { computeQuality } from '../../../src/probe/quality.js';
import { probeType } from '../../../src/probe/runner.js';

const SYNTHETIC_752 = 'tests/fixtures/probe/synthetic-752';
const S4HANA_2023 = 'tests/fixtures/probe/s4hana-2023-onprem-abap-trial';
const NPL_750 = 'tests/fixtures/probe/npl-750-sp02-dev-edition';
const ECC_EHP8_750_SP31 = 'tests/fixtures/probe/ecc-ehp8-nw750-sp31-onprem-prod';

describe('probe replay — synthetic 7.52 fixture', () => {
  it('classifies each recorded type correctly', async () => {
    const { fetcher, meta } = createReplayFetcher(SYNTHETIC_752);
    const discoveryMap = discoveryMapFromMeta(meta);

    const verdicts: Record<string, string> = {};
    for (const type of ['TABL', 'BDEF', 'DDLS', 'AUTH', 'DOMA']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      verdicts[type] = result.verdict;
    }

    // TABL: discovery YES + collection 200 + T000 200 → highest confidence
    expect(verdicts.TABL).toBe('available-high');

    // BDEF: discovery NO + collection 404 + no known object + release 752<754 → highest negative
    expect(verdicts.BDEF).toBe('unavailable-high');

    // DDLS: discovery YES + collection 400 (valid! bad params) + no known object.
    // #94/#95 guard: 400 must NOT be classified as unavailable.
    expect(verdicts.DDLS).toBe('available-high');

    // AUTH: collection 403 + ACTVT/MANDT 403 → uniform auth block
    expect(verdicts.AUTH).toBe('auth-blocked');

    // DOMA: discovery YES + collection 200 + ABAP_BOOL 200 → authoritative
    expect(verdicts.DOMA).toBe('available-high');
  });

  it('returns synthetic network-error when a URL has no recorded response', async () => {
    const { fetcher } = createReplayFetcher(SYNTHETIC_752);
    const result = await fetcher('/sap/bc/adt/nonexistent', 'GET');
    expect(result.networkError).toBe(true);
    expect(result.errorMessage).toMatch(/no recorded response/i);
  });

  it('aggregates quality metrics consistent with the recorded responses', async () => {
    const { fetcher, meta } = createReplayFetcher(SYNTHETIC_752);
    const discoveryMap = discoveryMapFromMeta(meta);

    const results = [];
    for (const entry of CATALOG) {
      results.push(await probeType(fetcher, entry, discoveryMap, meta.abapRelease));
    }
    const q = computeQuality(results);
    // Discovery is always definitive (the fixture ships a discovery map).
    expect(q.coverage.discovery).toBe(1);
    // Release was detected, so release coverage is 1.
    expect(q.coverage.release).toBe(1);
    // Synthetic fixture deliberately leaves most types with no recorded responses
    // so that their collection GET reports networkError — this is the "we don't
    // know yet" signal and is expected to drive a lot of verdicts to ambiguous.
    // Just sanity-check that the aggregation ran without throwing.
    expect(q.verdictHistogram).toBeDefined();
  });
});

describe('probe replay — s4hana-2023-onprem-abap-trial fixture (recorded from A4H, abap-cloud-developer-trial:2023)', () => {
  it('captures S/4HANA 2023 product markers (not just SAP_BASIS)', async () => {
    const { meta } = createReplayFetcher(S4HANA_2023);
    expect(meta.abapRelease).toBe('758');
    // S4FND 108 is the canonical marker for S/4HANA 2023 — proves this fixture
    // is not a plain NetWeaver system. Guards against label drift.
    const s4fnd = meta.products?.find((p) => p.name.toUpperCase() === 'S4FND');
    expect(s4fnd?.release).toBe('108');
  });

  it('reports all RAP types as available on a modern on-prem 7.58 S/4 system', async () => {
    const { fetcher, meta } = createReplayFetcher(S4HANA_2023);
    const discoveryMap = discoveryMapFromMeta(meta);

    expect(meta.abapRelease).toBe('758');

    // RAP types (DDLS, BDEF, SRVD, SRVB) must come back available on 7.58 —
    // this is the regression guard for the #162 scenario: a system that clearly
    // supports RAP must NOT be classified as unavailable.
    for (const type of ['DDLS', 'BDEF', 'SRVD', 'SRVB', 'DCLS', 'DDLX']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on 7.58 should be available`).toMatch(/^available-/);
    }
  });

  it('reports zero unavailable or ambiguous types on the recorded 7.58 run', async () => {
    const { fetcher, meta } = createReplayFetcher(S4HANA_2023);
    const discoveryMap = discoveryMapFromMeta(meta);

    const results = [];
    for (const entry of CATALOG) {
      results.push(await probeType(fetcher, entry, discoveryMap, meta.abapRelease));
    }
    const q = computeQuality(results);

    expect(q.verdictHistogram['unavailable-high']).toBe(0);
    expect(q.verdictHistogram['unavailable-likely']).toBe(0);
    expect(q.verdictHistogram.ambiguous).toBe(0);
    // Every type in the catalog is either available or auth-blocked on this system.
    const verdictSum =
      q.verdictHistogram['available-high'] +
      q.verdictHistogram['available-medium'] +
      q.verdictHistogram['auth-blocked'];
    expect(verdictSum).toBe(CATALOG.length);
  });
});

describe('probe replay — npl-750-sp02-dev-edition fixture (recorded from real NW 7.50 SP02)', () => {
  it('captures the expected NetWeaver 7.50 product markers', async () => {
    const { meta } = createReplayFetcher(NPL_750);

    expect(meta.abapRelease).toBe('750');

    const basis = meta.products?.find((p) => p.name.toUpperCase() === 'SAP_BASIS');
    const ui = meta.products?.find((p) => p.name.toUpperCase() === 'SAP_UI');

    expect(basis?.release).toBe('750');
    expect(basis?.spLevel).toBe('0002');
    expect(ui?.release).toBe('750');
    expect(ui?.spLevel).toBe('0002');
  });

  it('reports classic ABAP repository types as available and RAP-era types as unavailable or ambiguous', async () => {
    const { fetcher, meta } = createReplayFetcher(NPL_750);
    const discoveryMap = discoveryMapFromMeta(meta);

    expect(meta.abapRelease).toBe('750');

    for (const type of ['PROG', 'CLAS', 'INTF']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on 7.50 should be available`).toBe('available-high');
    }

    for (const type of ['BDEF', 'SRVD', 'SRVB', 'AUTH', 'FTG2']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on 7.50 should be unavailable`).toBe('unavailable-high');
    }

    for (const type of ['DDLS', 'DCLS']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on 7.50 should stay ambiguous`).toBe('ambiguous');
    }
  });

  it('keeps the recorded 7.50 quality profile stable', async () => {
    const { fetcher, meta } = createReplayFetcher(NPL_750);
    const discoveryMap = discoveryMapFromMeta(meta);

    const results = [];
    for (const entry of CATALOG) {
      results.push(await probeType(fetcher, entry, discoveryMap, meta.abapRelease));
    }
    const q = computeQuality(results);

    expect(q.coverage.discovery).toBe(1);
    expect(q.coverage.collection).toBe(1);
    // Known-object coverage rose from 0.6 → 0.7 after #162 contributor added
    // seed objects for DDLS (I_LANGUAGE), DCLS (P_USER002), and INCL (LSLOGTOP).
    // After Model B (collapse-stru-into-tabl) the standalone STRU catalog entry
    // was removed (TABL covers both transparent tables and DDIC structures via
    // the /tables/ → /structures/ fallback), so the catalog dropped from 20 to
    // 19 entries and STRU's previously-passing known-object probe is gone:
    // 13/19 ≈ 0.6842 instead of 14/20 = 0.7. `discoveryAccuracyVsKnownObject`
    // numerator/denominator both drop by 1 (STRU was discovered AND known on 7.50).
    expect(q.coverage.knownObject).toBeCloseTo(13 / 19, 4);
    expect(q.coverage.release).toBe(1);
    expect(q.discoveryAccuracyVsKnownObject).toBeCloseTo(5 / 6, 4);

    // After STRU removal the `available-high` count drops by one (STRU was a
    // success on this 7.50 fixture). The other histogram buckets are unchanged.
    expect(q.verdictHistogram['available-high']).toBe(7);
    expect(q.verdictHistogram['available-medium']).toBe(0);
    expect(q.verdictHistogram['unavailable-high']).toBe(6);
    expect(q.verdictHistogram['unavailable-likely']).toBe(3);
    expect(q.verdictHistogram['auth-blocked']).toBe(0);
    expect(q.verdictHistogram.ambiguous).toBe(3);
  });
});

describe('probe replay — ecc-ehp8-nw750-sp31-onprem-prod fixture (contributed via #170, real ECC EhP8 on NW 7.50 SP31)', () => {
  it('captures ECC EhP8 product markers (SAP_APPL 618)', async () => {
    const { meta } = createReplayFetcher(ECC_EHP8_750_SP31);

    expect(meta.abapRelease).toBe('750');

    const basis = meta.products?.find((p) => p.name.toUpperCase() === 'SAP_BASIS');
    const appl = meta.products?.find((p) => p.name.toUpperCase() === 'SAP_APPL');

    // SAP_APPL 618 is the canonical marker for ECC 6.0 EhP8 — proves this fixture
    // is a real productive ERP system, not a plain NetWeaver or trial edition.
    expect(basis?.release).toBe('750');
    expect(basis?.spLevel).toBe('0031');
    expect(appl?.release).toBe('618');
  });

  it('classifies DDLS and DCLS as available via known-object reads despite collection 500s', async () => {
    const { fetcher, meta } = createReplayFetcher(ECC_EHP8_750_SP31);
    const discoveryMap = discoveryMapFromMeta(meta);

    // On this system the CDS/DCL collection endpoints return HTTP 500 ("No URI-Mapping
    // defined for URI") — but I_LANGUAGE and P_USER002 read back cleanly. This is
    // exactly the "known-object trumps collection" scenario the probe was designed for,
    // and the regression guard for the #170 contribution.
    for (const type of ['DDLS', 'DCLS']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on EhP8/7.50 should be available via known object`).toBe('available-high');
    }
  });

  it('reports RAP-era types (BDEF, SRVD, SRVB) as unavailable on this EhP8 system', async () => {
    const { fetcher, meta } = createReplayFetcher(ECC_EHP8_750_SP31);
    const discoveryMap = discoveryMapFromMeta(meta);

    for (const type of ['BDEF', 'SRVD', 'SRVB']) {
      const entry = getCatalogEntry(type);
      if (!entry) throw new Error(`Missing catalog entry for ${type}`);
      const result = await probeType(fetcher, entry, discoveryMap, meta.abapRelease);
      expect(result.verdict, `${type} on EhP8/7.50 should be unavailable`).toBe('unavailable-high');
    }
  });

  it('runs the full catalog without throwing and produces a sensible quality profile', async () => {
    const { fetcher, meta } = createReplayFetcher(ECC_EHP8_750_SP31);
    const discoveryMap = discoveryMapFromMeta(meta);

    const results = [];
    for (const entry of CATALOG) {
      results.push(await probeType(fetcher, entry, discoveryMap, meta.abapRelease));
    }
    const q = computeQuality(results);

    expect(q.coverage.discovery).toBe(1);
    expect(q.coverage.release).toBe(1);
    // At least one available verdict (the core ABAP types plus DDLS/DCLS) —
    // a regression here would mean classification broke for this fixture.
    const availableSum = q.verdictHistogram['available-high'] + q.verdictHistogram['available-medium'];
    expect(availableSum).toBeGreaterThan(0);
  });
});
