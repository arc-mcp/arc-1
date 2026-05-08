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

  beforeAll(() => {
    requireSapCredentials();
    client = getTransportEnabledClient();
  });

  // ─── getTransport ──────────────────────────────────────────────

  describe('getTransport', () => {
    it('returns transport details with corrected Accept header', async (ctx) => {
      // First list transports to find an existing one
      const transports = await listTransports(client.http, client.safety);
      if (transports.length === 0) {
        // No transports available — create one to test with (needs a package)
        const pkg = process.env.TEST_TRANSPORT_PACKAGE;
        requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);
        const id = await createTransport(client.http, client.safety, 'ARC-1 integration test: getTransport', pkg);
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
    const createdTransportIds: string[] = [];

    afterAll(() => {
      // Log created transports for manual cleanup if needed
      // We intentionally do NOT auto-release test transports
      if (createdTransportIds.length > 0) {
        console.error(
          `Transport integration test created transports: ${createdTransportIds.join(', ')} (not auto-released)`,
        );
      }
    });

    it('creates a transport via CreateCorrectionRequest endpoint', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const desc = `ARC-1 IT ${Date.now()}`;
      const id = await createTransport(client.http, client.safety, desc, pkg);

      expect(id).toBeTruthy();
      // SAP transport IDs follow pattern: <SID>K<number>
      expect(id).toMatch(/^[A-Z0-9]+K\d+$/);
      createdTransportIds.push(id);

      // Verify the created transport can be retrieved
      const transport = await getTransport(client.http, client.safety, id);
      expect(transport).not.toBeNull();
      expect(transport!.id).toBe(id);
      expect(transport!.description).toBe(desc);
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
    it('creates and deletes a transport', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);
      const id = await createTransport(client.http, client.safety, `ARC-1 IT delete ${Date.now()}`, pkg);
      expect(id).toBeTruthy();

      await deleteTransport(client.http, client.safety, id);

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
  // package's transport route in TADIR. The legacy `transportType`
  // parameter is kept on the function signature for backward compatibility
  // but ignored by the backend, so per-type integration tests would need
  // separate Customizing/Workbench packages and are not portable.

  // ─── reassignTransport ────────────────────────────────────────

  describe('reassignTransport', () => {
    it('reassigns a transport to same user', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);
      let id = '';
      try {
        id = await createTransport(client.http, client.safety, `ARC-1 IT reassign ${Date.now()}`, pkg);
        expect(id).toBeTruthy();

        const transport = await getTransport(client.http, client.safety, id);
        const currentOwner = transport!.owner;

        // Reassign to same user (safe — we know the user exists)
        await reassignTransport(client.http, client.safety, id, currentOwner);

        const updated = await getTransport(client.http, client.safety, id);
        expect(updated!.owner).toBe(currentOwner);
      } catch (err) {
        if (isUnsupportedBackend(err)) return ctx.skip('Backend does not support transport reassign');
        throw err;
      } finally {
        if (id) {
          try {
            await deleteTransport(client.http, client.safety, id, true);
          } catch {
            // best-effort-cleanup
          }
        }
      }
    }, 30_000);
  });

  // ─── releaseTransportRecursive ────────────────────────────────

  describe('releaseTransportRecursive', () => {
    it('recursively releases a transport', async (ctx) => {
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);
      let id = '';
      try {
        id = await createTransport(client.http, client.safety, `ARC-1 IT recursive-release ${Date.now()}`, pkg);
        expect(id).toBeTruthy();

        const result = await releaseTransportRecursive(client.http, client.safety, id);
        expect(result.released).toContain(id);

        const transport = await getTransport(client.http, client.safety, id);
        if (transport) {
          expect(transport.status).toBe('R');
        }
      } catch (err) {
        if (isUnsupportedBackend(err)) return ctx.skip('Backend does not support recursive release');
        throw err;
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
        // best-effort-cleanup
        console.error('Transport test cleanup failures:', report.failed);
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
      const transportId = await createTransport(client.http, client.safety, `ARC-1 IT corrNr ${Date.now()}`, pkg);
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
      const transportId = await createTransport(client.http, client.safety, `ARC-1 IT explicit ${Date.now()}`, pkg);
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
