/**
 * Live contract probe for the experimental data-source blocklist.
 *
 * Verified fixtures:
 * - DEMO_CDS_SUMDIST -> SCARR + SPFLI on SAP_BASIS 750 and 758
 * - SCARR data preview is bound on the 758 target; the available 750 endpoint is unbound
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { DataSourcePolicyError } from '../../src/adt/data-source-policy.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { SkipReason, skipTest } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('experimental data-source blocklist live contract', () => {
  let client: AdtClient;
  let basisRelease = 0;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    const [{ map }, components] = await Promise.all([
      fetchDiscoveryDocument(client.http),
      client.getInstalledComponents(),
    ]);
    client.http.setDiscoveryMap(map);
    basisRelease = Number.parseInt(components.find((component) => component.name === 'SAP_BASIS')?.release ?? '0', 10);
  });

  afterEach(() => vi.restoreAllMocks());

  const withBlocked = (names: string[]): AdtClient =>
    client.withSafety({ ...unrestrictedSafetyConfig(), blockedDataSources: names });

  it('denies an exact direct table before any SAP HTTP call', async () => {
    const strict = withBlocked(['SCARR']);
    const getSpy = vi.spyOn(strict.http, 'get');
    const postSpy = vi.spyOn(strict.http, 'post');

    await expect(strict.runQuery('SELECT CARRID FROM SCARR')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['SCARR'],
    });
    expect(getSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('uses the live release-specific dependency graph to deny a transitive CDS table', async () => {
    const strict = withBlocked(['SPFLI']);

    await expect(strict.runQuery('SELECT * FROM DEMO_CDS_SUMDIST')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_CDS_SUMDIST', 'SPFLI'],
    });
  });

  it('expands the live DDIC replacement object before deciding', async (ctx) => {
    if (basisRelease < 752) {
      skipTest(
        ctx,
        `${SkipReason.BACKEND_UNSUPPORTED}: canonical table source omits replacement metadata on SAP_BASIS 750`,
      );
    }
    const strict = withBlocked(['SCARR']);

    await expect(strict.runTableQuery('DEMO_SUMDIST')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_SUMDIST', 'DEMO_CDS_SUMDIST', 'SCARR'],
    });
  });

  it('allows an unrelated static table after live lineage checks on a bound data-preview backend', async (ctx) => {
    if (basisRelease < 752) {
      skipTest(ctx, `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview is unbound on the live SAP_BASIS 750 target`);
    }
    const strict = withBlocked(['USR02']);
    const result = await strict.runQuery('SELECT CARRID FROM SCARR');
    expect(result.columns).toContain('CARRID');
  });

  it('restores zero-analysis behavior when the list is empty', async (ctx) => {
    if (basisRelease < 752) {
      skipTest(ctx, `${SkipReason.BACKEND_UNSUPPORTED}: /datapreview is unbound on the live SAP_BASIS 750 target`);
    }
    const off = withBlocked([]);
    const searchSpy = vi.spyOn(off, 'searchObject');
    const result = await off.runQuery('SELECT CARRID FROM SCARR');
    expect(result.columns).toContain('CARRID');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns a typed denial with an operator action and no SQL or data values', async () => {
    const strict = withBlocked(['SCARR']);
    let error: unknown;
    try {
      await strict.runTableQuery('SCARR', { where: [{ field: 'CARRID', op: '=', value: 'secret-marker' }] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DataSourcePolicyError);
    expect(String(error)).toContain('request denied before data execution');
    expect(String(error)).toContain('Operator action:');
    expect(String(error)).not.toContain('secret-marker');
  });
});
