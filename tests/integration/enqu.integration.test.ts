/**
 * Live read for DDIC lock objects (ENQU).
 * Verified on S/4HANA SAP_BASIS 8.16 — docs/research/2026-09-28-enqu-lock-object-adt-contract.md.
 * Instances are system-dependent, so the test searches for one by type instead of hardcoding a name.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument, resolveAcceptType } from '../../src/adt/discovery.js';
import { getLockObject } from '../../src/adt/lock-object.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('ENQU reads', () => {
  let client: AdtClient;
  let discovery: Map<string, string[]>;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    discovery = (await fetchDiscoveryDocument(client.http)).map;
  });

  it('reads a lock object (ENQU) as structured tables + parameters', async (ctx) => {
    requireOrSkip(
      ctx,
      resolveAcceptType(discovery, '/sap/bc/adt/ddic/lockobjects/sources'),
      `${SkipReason.BACKEND_UNSUPPORTED}: lock-object collection not advertised`,
    );
    const objects = await client.searchObject('E*', 10, 'ENQU/DL');
    const hit = objects.find((o) => o.objectType === 'ENQU/DL');
    requireOrSkip(ctx, hit, `${SkipReason.NO_FIXTURE}: no visible ENQU instance`);
    const info = await getLockObject(client.http, unrestrictedSafetyConfig(), hit.objectName);
    expect(info.name).toBe(hit.objectName);
    expect(info.primaryTable.tableName).toBeTruthy();
    expect(['E', 'S', 'X', 'O']).toContain(info.primaryTable.lockMode);
    expect(Array.isArray(info.lockParameters)).toBe(true);
  });
});
