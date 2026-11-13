/**
 * Live reads for SAP object types (RONT) and node types (NONT) — server-driven, AFF JSON.
 * Contract: docs/research/2026-10-31-ront-nont-adt-contract.md.
 * Instances are system-dependent, so each test searches for one by type instead of hardcoding a name.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { getServerDrivenObject, supportsServerDrivenObject } from '../../src/adt/server-driven.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('RONT / NONT reads', () => {
  let client: AdtClient;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
  });

  // typeCategory is required by the RONT schema; NONT only requires its name.
  for (const [code, searchType, key] of [
    ['RONT', 'RONT/ROT', 'typeCategory'],
    ['NONT', 'NONT/NOT', 'name'],
  ] as const) {
    it(`reads an ${code} with AFF JSON source`, async (ctx) => {
      requireOrSkip(
        ctx,
        // `|| undefined` so a definite "unavailable" (false) skips — requireOrSkip only skips on null/undefined.
        supportsServerDrivenObject(client.http, code) || undefined,
        `${SkipReason.BACKEND_UNSUPPORTED}: ${code} collection not advertised`,
      );
      const objects = await client.searchObject('*', 10, searchType);
      const hit = objects.find((o) => o.objectType === searchType);
      requireOrSkip(ctx, hit, `${SkipReason.NO_FIXTURE}: no visible ${code} instance`);
      const r = await getServerDrivenObject(client.http, unrestrictedSafetyConfig(), code, hit.objectName);
      expect(r.type).toBe(searchType);
      const src = r.source as Record<string, unknown>;
      expect(src.formatVersion).toBe('1');
      expect(src).toHaveProperty(key);
    });
  }
});
