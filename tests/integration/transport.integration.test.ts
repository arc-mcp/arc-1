/**
 * Integration tests for CTS transport compatibility and corrNr propagation.
 *
 * These tests validate the transport-related fixes from issues #9, #26, #56, #70
 * against a live SAP system.
 *
 * Transport tests require:
 *   - SAP credentials (TEST_SAP_URL / SAP_URL, etc.)
 *   - allowTransportWrites safety config
 *
 * Transportable-package tests additionally require:
 *   - TEST_TRANSPORT_PACKAGE env var (e.g., Z_LLM_TEST_PACKAGE)
 *
 * Run: npm run test:integration -- tests/integration/transport.integration.test.ts
 * Run with transportable package:
 *   TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE npm run test:integration -- tests/integration/transport.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { createObject, safeUpdateSource } from '../../src/adt/crud.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import {
  createTransport,
  deleteTransport,
  getObjectTransports,
  getTransport,
  listTransports,
  reassignTransport,
  releaseTransportRecursive,
} from '../../src/adt/transport.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { buildCreateXml, CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { requireSapCredentials } from './helpers.js';

const transportReleaseTestsEnabled = process.env.TEST_TRANSPORT_RELEASE_TESTS === 'true';

function isArc1TestTransport(description: string): boolean {
  return /^ARC-1 (IT|integration test)\b/.test(description);
}

/** Create an ADT client with transport writes enabled */
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

/** Check if an error indicates the backend doesn't support this CTS operation */
function isUnsupportedBackend(err: unknown): boolean {
  if (err instanceof AdtApiError) {
    // 400/405/501 typically indicate the operation isn't supported on this system
    return [400, 405, 501].includes(err.statusCode);
  }
  return false;
}

describe('Transport Integration Tests', () => {
  let client: AdtClient;
  const createdTransportIds = new Set<string>();
  let initialArc1DraftTransportIds = new Set<string>();

  function trackTransport(id: string): string {
    createdTransportIds.add(id);
    return id;
  }

  async function listArc1DraftTransportIds(): Promise<Set<string>> {
    const transports = await listTransports(client.http, client.safety, undefined, 'D');
    return new Set(
      transports
        .filter((transport) => isArc1TestTransport(transport.description) && transport.status === 'D')
        .map((transport) => transport.id),
    );
  }

  async function deleteTrackedTransport(id: string): Promise<void> {
    try {
      await deleteTransport(client.http, client.safety, id, true);
      createdTransportIds.delete(id);
    } catch (err) {
      try {
        const transport = await getTransport(client.http, client.safety, id);
        if (!transport) {
          createdTransportIds.delete(id);
          return;
        }
      } catch {
        // Keep the original cleanup error below.
      }
      throw err;
    }
  }

  beforeAll(async () => {
    requireSapCredentials();
    client = getTransportEnabledClient();
    initialArc1DraftTransportIds = await listArc1DraftTransportIds();
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

    const currentArc1DraftTransportIds = await listArc1DraftTransportIds();
    const leaked = [...currentArc1DraftTransportIds].filter((id) => !initialArc1DraftTransportIds.has(id));
    for (const id of leaked) {
      failures.push({ id, error: 'new ARC-1 draft transport still exists after integration cleanup' });
    }

    if (failures.length > 0) {
      throw new Error(`Transport cleanup failed: ${JSON.stringify(failures)}`);
    }
  });

  // ─── getTransport ──────────────────────────────────────────────

  describe('getTransport', () => {
    it('returns transport details with corrected Accept header', async () => {
      // First list transports to find an existing one
      const transports = await listTransports(client.http, client.safety);
      if (transports.length === 0) {
        // No transports available — create one to test with
        const id = trackTransport(
          await createTransport(client.http, client.safety, 'ARC-1 integration test: getTransport'),
        );
        expect(id).toBeTruthy();
        expect(id).toMatch(/^[A-Z0-9]+K\d+$/);

        const transport = await getTransport(client.http, client.safety, id);
        expect(transport).not.toBeNull();
        expect(transport!.id).toBe(id);
        expect(transport!.description).toBe('ARC-1 integration test: getTransport');
        expect(transport!.status).toBeTruthy();
        return;
      }

      // Use the first available transport
      const transport = await getTransport(client.http, client.safety, transports[0].id);
      expect(transport).not.toBeNull();
      expect(transport!.id).toBe(transports[0].id);
      expect(transport!.description).toBeTruthy();
      expect(transport!.owner).toBeTruthy();
      expect(transport!.status).toBeTruthy();
    });

    it('returns null for non-existent transport', async () => {
      try {
        const result = await getTransport(client.http, client.safety, 'ZZZK999999');
        // Some SAP systems return empty result, some throw 404
        expect(result === null || result?.id === '').toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
      }
    });
  });

  // ─── createTransport ───────────────────────────────────────────

  describe('createTransport', () => {
    it('creates a transport without explicit package (defaults to $TMP)', async () => {
      const desc = `ARC-1 IT default-tmp ${Date.now()}`;
      const id = trackTransport(await createTransport(client.http, client.safety, desc));

      expect(id).toBeTruthy();
      // SAP transport IDs follow pattern: <SID>K<number>
      expect(id).toMatch(/^[A-Z0-9]+K\d+$/);

      // Verify the created transport can be retrieved and has the right description + owner
      const transport = await getTransport(client.http, client.safety, id);
      expect(transport).not.toBeNull();
      expect(transport!.id).toBe(id);
      expect(transport!.description).toBe(desc);
      expect(transport!.owner).toBeTruthy();
    });

    it('creates a transport with explicit target package', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const desc = `ARC-1 IT pkg ${Date.now()}`;
      const id = trackTransport(await createTransport(client.http, client.safety, desc, pkg));
      expect(id).toBeTruthy();
      expect(id).toMatch(/^[A-Z0-9]+K\d+$/);
    });
  });

  // ─── listTransports ────────────────────────────────────────────

  describe('listTransports', () => {
    it('lists transports for current user', async () => {
      const transports = await listTransports(client.http, client.safety);
      expect(Array.isArray(transports)).toBe(true);
      // At minimum, the transports created above should exist
      // (but they might already be released or the user may have pre-existing ones)
      for (const t of transports) {
        expect(t.id).toBeTruthy();
        expect(typeof t.description).toBe('string');
        expect(typeof t.owner).toBe('string');
        expect(typeof t.status).toBe('string');
      }
    });
  });

  // ─── getObjectTransports ───────────────────────────────────────

  describe('getObjectTransports (object → transports reverse lookup)', () => {
    it('$TMP fixture object returns no related transports', async (ctx) => {
      try {
        const result = await getObjectTransports(client.http, client.safety, '/sap/bc/adt/oo/classes/zcl_arc1_test');
        expect(result.relatedTransports.length).toBe(0);
        expect(result.lockedTransport).toBeUndefined();
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.NO_FIXTURE}: ZCL_ARC1_TEST not found — run npm run test:e2e:fixtures first`,
        );
      }
    });

    it('supports probing a transportable object when configured', async (ctx) => {
      const transportPkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, transportPkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const objectName = process.env.TEST_TRANSPORT_OBJECT_NAME;
      requireOrSkip(ctx, objectName, 'TEST_TRANSPORT_OBJECT_NAME not configured');

      const objectUrl = `/sap/bc/adt/oo/classes/${encodeURIComponent(objectName.toLowerCase())}`;
      try {
        const result = await getObjectTransports(client.http, client.safety, objectUrl);
        expect(Array.isArray(result.relatedTransports)).toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: configured TEST_TRANSPORT_OBJECT_NAME "${objectName}" is not available`,
        );
      }
    });
  });

  // ─── deleteTransport ───────────────────────────────────────────

  describe('deleteTransport', () => {
    it('creates and deletes a transport', async () => {
      const id = trackTransport(await createTransport(client.http, client.safety, `ARC-1 IT delete ${Date.now()}`));
      expect(id).toBeTruthy();

      await deleteTransport(client.http, client.safety, id);
      createdTransportIds.delete(id);

      // Verify transport is gone or returns null
      try {
        const result = await getTransport(client.http, client.safety, id);
        expect(result === null || result?.id === '').toBe(true);
      } catch (err) {
        expectSapFailureClass(err, [404, 400], [/not found/i, /does not exist/i]);
      }
    }, 30_000);
  });

  // K/W/T transport type is no longer driven by the request body — the
  // CreateCorrectionRequest endpoint infers the type from the target
  // package's transport route in TADIR. Per-type integration tests would
  // need separate Customizing/Workbench packages and aren't portable, so
  // they're removed.

  // ─── reassignTransport ────────────────────────────────────────

  describe('reassignTransport', () => {
    it('reassigns a transport to same user', async (ctx) => {
      let id = '';
      try {
        id = trackTransport(await createTransport(client.http, client.safety, `ARC-1 IT reassign ${Date.now()}`));
        expect(id).toBeTruthy();

        const transport = await getTransport(client.http, client.safety, id);
        const currentOwner = transport!.owner;

        // Reassign to same user (safe — we know the user exists)
        await reassignTransport(client.http, client.safety, id, currentOwner);

        const updated = await getTransport(client.http, client.safety, id);
        expect(updated!.owner).toBe(currentOwner);
      } catch (err) {
        // NW 7.5x ADT_TM gap: PUT body attributes are silently dropped, so
        // tm:targetuser arrives empty and SAP responds 400 "User  does not
        // exist in the system (or locked)" (note the double space — empty
        // interpolation). NW 7.5x accepts the same operation as URL-query
        // params, but S/4HANA needs the body — incompatible without
        // release-aware fallback. Tracked separately from PR #228.
        if (isUnsupportedBackend(err))
          return ctx.skip(
            'NW 7.5x ADT_TM gap: reassign requires URL-query params on that release; needs release-aware fallback',
          );
        throw err;
      } finally {
        if (id) {
          await deleteTrackedTransport(id);
        }
      }
    }, 30_000);
  });

  // ─── releaseTransportRecursive ────────────────────────────────

  describe('releaseTransportRecursive', () => {
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
        released = true;
        createdTransportIds.delete(id);

        const transport = await getTransport(client.http, client.safety, id);
        if (transport) {
          expect(transport.status).toBe('R');
        }
      } catch (err) {
        // NW 7.5x ADT_TM gap: POST /{id}/newreleasejobs is rejected with
        // 400 "user action newreleasejobs is not supported" — the framework
        // treats the path segment as a useraction attribute. No client-side
        // workaround verified (probed: useraction in body, query param,
        // PUT variant — all rejected). Genuine NW 7.5x release-on-empty
        // limitation. Tracked separately from PR #228.
        if (isUnsupportedBackend(err))
          return ctx.skip(
            'NW 7.5x ADT_TM gap: release endpoint rejects /newreleasejobs path segment; no client-side workaround',
          );
        throw err;
      } finally {
        if (id && !released) {
          await deleteTrackedTransport(id);
        }
      }
    }, 60_000);
  });

  // ─── Transportable Package Write with corrNr Propagation ──────

  describe('transportable package write with auto-corrNr', () => {
    const registry = new CrudRegistry();

    afterAll(async () => {
      if (!client) return;
      const report = await cleanupAll(client.http, client.safety, registry);
      if (report.failed.length > 0) {
        console.error('Transport test cleanup failures:', report.failed);
        throw new Error(`Transport object cleanup failed: ${JSON.stringify(report.failed)}`);
      }
    });

    it('update succeeds without explicit transport via lock corrNr propagation', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const testName = generateUniqueName('ZARC1_TR');
      const objectUrl = `/sap/bc/adt/programs/programs/${testName.toLowerCase()}`;
      const sourceUrl = `${objectUrl}/source/main`;

      // Create object in transportable package (needs a transport)
      // First create a transport for the create operation
      const transportId = trackTransport(
        await createTransport(client.http, client.safety, `ARC-1 IT corrNr ${Date.now()}`, pkg),
      );
      expect(transportId).toBeTruthy();

      const xml = buildCreateXml('PROG', testName, pkg, 'ARC-1 corrNr propagation test');
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/programs/programs',
        xml,
        'application/xml',
        transportId,
      );
      registry.register(objectUrl, 'PROG', testName);

      // Update WITHOUT explicit transport — should auto-use lock corrNr
      const newSource = `REPORT ${testName.toLowerCase()}.\nWRITE: / 'corrNr auto-propagated'.`;
      await safeUpdateSource(client.http, client.safety, objectUrl, sourceUrl, newSource);

      // Verify update succeeded
      const { source } = await client.getProgram(testName);
      expect(source).toContain('corrNr auto-propagated');
    }, 60_000);

    it('explicit transport overrides lock corrNr', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const testName = generateUniqueName('ZARC1_TR');
      const objectUrl = `/sap/bc/adt/programs/programs/${testName.toLowerCase()}`;
      const sourceUrl = `${objectUrl}/source/main`;

      // Create transport and object
      const transportId = trackTransport(
        await createTransport(client.http, client.safety, `ARC-1 IT explicit ${Date.now()}`, pkg),
      );
      expect(transportId).toBeTruthy();

      const xml = buildCreateXml('PROG', testName, pkg, 'ARC-1 explicit transport test');
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/programs/programs',
        xml,
        'application/xml',
        transportId,
      );
      registry.register(objectUrl, 'PROG', testName);

      // Update WITH explicit transport — should use that, not lock corrNr
      const newSource = `REPORT ${testName.toLowerCase()}.\nWRITE: / 'explicit transport used'.`;
      await safeUpdateSource(client.http, client.safety, objectUrl, sourceUrl, newSource, transportId);

      // Verify update succeeded
      const { source } = await client.getProgram(testName);
      expect(source).toContain('explicit transport used');
    }, 60_000);
  });
});
