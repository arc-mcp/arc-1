/**
 * Slow integration coverage for recursive CTS release.
 *
 * Releasing a transport is permanent on the shared SAP system. Keep this out
 * of the default integration profile and run only with TEST_TRANSPORT_RELEASE_TESTS=true.
 *
 * Run: TEST_TRANSPORT_RELEASE_TESTS=true npm run test:integration:slow -- tests/integration/transport-release.slow.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { createTransport, deleteTransport, getTransport, releaseTransportRecursive } from '../../src/adt/transport.js';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { requireSapCredentials } from './helpers.js';

const transportReleaseTestsEnabled = process.env.TEST_TRANSPORT_RELEASE_TESTS === 'true';

function getTransportEnabledClient(): AdtClient {
  requireSapCredentials();

  const url = process.env.TEST_SAP_URL || process.env.SAP_URL || '';
  const username = process.env.TEST_SAP_USER || process.env.SAP_USER || '';
  const password = process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD || '';
  const client = process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT || '100';
  const language = process.env.TEST_SAP_LANGUAGE || process.env.SAP_LANGUAGE || 'EN';
  const insecure = (process.env.TEST_SAP_INSECURE || process.env.SAP_INSECURE) === 'true';

  const safety = unrestrictedSafetyConfig();
  safety.allowTransportWrites = true;

  return new AdtClient({
    baseUrl: url,
    username,
    password,
    client,
    language,
    insecure,
    safety,
  });
}

function isUnsupportedBackend(err: unknown): boolean {
  if (err instanceof AdtApiError) {
    return [400, 405, 501].includes(err.statusCode);
  }
  return false;
}

describe('Transport Release Slow Integration Tests', () => {
  let client: AdtClient;
  const createdTransportIds = new Set<string>();

  function trackTransport(id: string): string {
    createdTransportIds.add(id);
    return id;
  }

  async function deleteTrackedTransport(id: string): Promise<void> {
    await deleteTransport(client.http, client.safety, id, true);
    createdTransportIds.delete(id);
  }

  beforeAll(async () => {
    client = getTransportEnabledClient();
  });

  afterAll(async () => {
    if (!client) return;
    const failures: Array<{ id: string; error: string }> = [];
    for (const id of [...createdTransportIds].reverse()) {
      try {
        await deleteTrackedTransport(id);
      } catch (err) {
        failures.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Transport release slow cleanup failed: ${JSON.stringify(failures)}`);
    }
  });

  it('recursively releases a transport', async (ctx) => {
    requireOrSkip(ctx, transportReleaseTestsEnabled ? true : undefined, SkipReason.TRANSPORT_RELEASE_DISABLED);

    let id = '';
    let released = false;
    try {
      id = trackTransport(
        await createTransport(client.http, client.safety, `ARC-1 IT recursive-release ${Date.now()}`),
      );
      expect(id).toBeTruthy();

      const result = await releaseTransportRecursive(client.http, client.safety, id);
      expect(result.released).toContain(id);
      // #433: the release now surfaces the chkrun report — a clean release must carry a released:true report.
      expect(result.reports.length).toBeGreaterThan(0);
      expect(result.reports.every((r) => r.released)).toBe(true);
      released = true;
      createdTransportIds.delete(id);

      const transport = await getTransport(client.http, client.safety, id);
      if (transport) {
        expect(transport.status).toBe('R');
      }
    } catch (err) {
      if (isUnsupportedBackend(err)) {
        return skipTest(
          ctx,
          'NW 7.5x ADT_TM gap: release endpoint rejects /newreleasejobs path segment; no client-side workaround',
        );
      }
      throw err;
    } finally {
      if (id && !released) {
        await deleteTrackedTransport(id);
      }
    }
  }, 60_000);
});
