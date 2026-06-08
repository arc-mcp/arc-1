/**
 * E2E Tests for SAPTransport tool and transportable SAPWrite operations.
 *
 * Validates the full MCP JSON-RPC path for:
 * - SAPTransport create + get + delete/reassign/type/history (Issues #9, #26, #70)
 * - SAPWrite update in a transportable package without explicit transport (Issue #56)
 *
 * Transport tests require the MCP server to be running with --allow-transport-writes.
 * Transportable-package write tests additionally require TEST_TRANSPORT_PACKAGE and
 * TEST_TRANSPORT_PACKAGE_WRITE_TESTS=true because cleanup can leave locked CTS tasks
 * on shared SAP systems.
 *
 * Run: npm run test:e2e -- tests/e2e/saptransport.e2e.test.ts
 * Recursive release coverage: npm run test:e2e:slow -- tests/e2e/saptransport.slow.e2e.test.ts
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

const transportPackageWriteTestsEnabled = process.env.TEST_TRANSPORT_PACKAGE_WRITE_TESTS === 'true';

interface TransportListEntry {
  id?: string;
  description?: string;
  status?: string;
}

function isArc1TestTransport(transport: TransportListEntry): boolean {
  return /^ARC-1 (E2E|IT|integration test)\b/.test(transport.description ?? '');
}

describe('E2E SAPTransport Tests', () => {
  let client: Client;
  let initialArc1DraftTransportIds = new Set<string>();
  const createdTransportablePrograms = new Set<string>();

  async function listArc1DraftTransportIds(): Promise<Set<string>> {
    const result = await callTool(client, 'SAPTransport', { action: 'list', status: 'D' });
    const transports = JSON.parse(expectToolSuccess(result)) as TransportListEntry[];
    return new Set(
      transports
        .filter(isArc1TestTransport)
        .map((transport) => transport.id)
        .filter(Boolean) as string[],
    );
  }

  async function expectNoNewArc1DraftTransportResidue(): Promise<void> {
    const current = await listArc1DraftTransportIds();
    const leaked = [...current].filter((id) => !initialArc1DraftTransportIds.has(id));
    expect(leaked, 'New ARC-1 draft transports left by E2E run').toEqual([]);
  }

  function trackTransportableProgram(name: string): void {
    createdTransportablePrograms.add(name);
  }

  async function deleteTrackedTransportableProgram(name: string): Promise<void> {
    const result = await callTool(client, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name,
    });
    const text = result.content?.[0]?.text ?? '';
    if (result.isError && !/not found|does not exist|unknown/i.test(text)) {
      throw new Error(text || `Failed to delete ${name}`);
    }
    createdTransportablePrograms.delete(name);
  }

  async function cleanupTrackedTransportablePrograms(): Promise<string[]> {
    const failures: string[] = [];
    for (const name of [...createdTransportablePrograms].reverse()) {
      try {
        await deleteTrackedTransportableProgram(name);
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return failures;
  }

  beforeAll(async () => {
    client = await connectClient();
    initialArc1DraftTransportIds = await listArc1DraftTransportIds();
  });

  afterAll(async () => {
    const failures: string[] = [];
    try {
      if (client) {
        failures.push(...(await cleanupTrackedTransportablePrograms()));
        try {
          await expectNoNewArc1DraftTransportResidue();
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      try {
        await client?.close();
      } catch {
        // Ignore close errors
      }
    }
    if (failures.length > 0) {
      throw new Error(`E2E transport cleanup failed: ${JSON.stringify(failures)}`);
    }
  });

  // ── SAPTransport create + get ─────────────────────────────────────

  describe('SAPTransport create + get', () => {
    let createdTransportId: string | undefined;
    let transportsEnabled = true;

    afterAll(async () => {
      if (!createdTransportId) return;
      const result = await callTool(client, 'SAPTransport', {
        action: 'delete',
        id: createdTransportId,
        recursive: true,
      });
      expectToolSuccess(result);
      createdTransportId = undefined;
    });

    it('creates a transport and returns a valid transport ID', async (ctx) => {
      const desc = `ARC-1 E2E test ${Date.now()}`;
      const result = await callTool(client, 'SAPTransport', {
        action: 'create',
        description: desc,
      });

      // Skip gracefully when transport writes aren't enabled on the MCP server
      if (result.isError && result.content?.[0]?.text?.includes('allowTransportWrites=false')) {
        transportsEnabled = false;
        return skipTest(ctx, 'Transport writes not enabled on MCP server (--allow-transport-writes)');
      }

      const text = expectToolSuccess(result);

      // Response should contain a transport ID (pattern: <SID>K<number>)
      expect(text).toContain('Created transport request:');
      const match = text.match(/([A-Z0-9]+K\d+)/);
      expect(match, 'Response should contain a transport ID').toBeTruthy();
      createdTransportId = match![1];
    });

    it('retrieves the created transport with correct details', async (ctx) => {
      if (!transportsEnabled) return skipTest(ctx, 'Transport writes not enabled on MCP server');
      requireOrSkip(ctx, createdTransportId, 'No transport was created in previous test');

      const result = await callTool(client, 'SAPTransport', {
        action: 'get',
        id: createdTransportId,
      });
      const text = expectToolSuccess(result);

      // Response should be valid JSON with transport details, no raw XML
      const transport = JSON.parse(text);
      expect(transport.id).toBe(createdTransportId);
      expect(transport.description).toContain('ARC-1 E2E test');
      expect(transport.owner).toBeTruthy();
      expect(transport.status).toBeTruthy();
    });

    it('returns not-found message for non-existent transport', async (ctx) => {
      if (!transportsEnabled) return skipTest(ctx, 'Transport writes not enabled on MCP server');
      const result = await callTool(client, 'SAPTransport', {
        action: 'get',
        id: 'ZZZK999999',
      });
      // May return success with "not found" text or an error — both are acceptable
      const text = result.content?.[0]?.text ?? '';
      expect(text).toBeTruthy();
      // Must not contain raw XML
      expect(text).not.toContain('<?xml');
    });

    it('lists transports without errors', async (ctx) => {
      if (!transportsEnabled) return skipTest(ctx, 'Transport writes not enabled on MCP server');
      const result = await callTool(client, 'SAPTransport', {
        action: 'list',
      });
      const text = expectToolSuccess(result);

      // Response should be valid JSON array
      const transports = JSON.parse(text);
      expect(Array.isArray(transports)).toBe(true);
      console.log(`    Listed ${transports.length} transports`);
      if (transports.length > 0) {
        // Verify structure of first entry
        expect(transports[0]).toHaveProperty('id');
      }
    });

    it('returns error for missing required parameters', async () => {
      // create without description
      const createResult = await callTool(client, 'SAPTransport', {
        action: 'create',
      });
      expectToolError(createResult);

      // get without id
      const getResult = await callTool(client, 'SAPTransport', {
        action: 'get',
      });
      expectToolError(getResult);
    });

    it('returns error for unknown action', async () => {
      const result = await callTool(client, 'SAPTransport', {
        action: 'nonexistent',
      });
      expectToolError(result, 'Invalid arguments for SAPTransport');
    });
  });

  // ── New transport actions (delete, reassign, type) ──

  describe('SAPTransport new actions', () => {
    let transportsEnabled = true;

    it('delete action removes a transport', async (ctx) => {
      let id = '';
      try {
        // Create transport first
        const createResult = await callTool(client, 'SAPTransport', {
          action: 'create',
          description: `ARC-1 E2E delete test ${Date.now()}`,
        });
        if (createResult.isError && createResult.content?.[0]?.text?.includes('allowTransportWrites=false')) {
          transportsEnabled = false;
          return skipTest(ctx, 'Transport writes not enabled on MCP server');
        }
        const createText = expectToolSuccess(createResult);
        const match = createText.match(/([A-Z0-9]+K\d+)/);
        expect(match).toBeTruthy();
        id = match![1];

        const deleteResult = await callTool(client, 'SAPTransport', {
          action: 'delete',
          id,
        });
        const text = expectToolSuccess(deleteResult);
        expect(text).toContain(`Deleted transport request: ${id}`);
        id = '';
      } finally {
        if (id) {
          const deleteResult = await callTool(client, 'SAPTransport', { action: 'delete', id, recursive: true });
          expectToolSuccess(deleteResult);
        }
      }
    });

    it('create with type W creates Customizing transport', async (ctx) => {
      if (!transportsEnabled) return skipTest(ctx, 'Transport writes not enabled on MCP server');

      let id = '';
      try {
        const result = await callTool(client, 'SAPTransport', {
          action: 'create',
          description: `ARC-1 E2E type-W ${Date.now()}`,
          type: 'W',
        });
        const text = expectToolSuccessOrSkip(ctx, result);
        const match = text.match(/([A-Z0-9]+\w\d+)/);
        expect(match).toBeTruthy();
        id = match![1];
      } finally {
        if (id) {
          const deleteResult = await callTool(client, 'SAPTransport', { action: 'delete', id, recursive: true });
          expectToolSuccess(deleteResult);
        }
      }
    });

    it('reassign action changes transport owner', async (ctx) => {
      if (!transportsEnabled) return skipTest(ctx, 'Transport writes not enabled on MCP server');

      let id = '';
      try {
        // Create transport
        const createResult = await callTool(client, 'SAPTransport', {
          action: 'create',
          description: `ARC-1 E2E reassign test ${Date.now()}`,
        });
        const createText = expectToolSuccessOrSkip(ctx, createResult);
        const match = createText.match(/([A-Z0-9]+K\d+)/);
        expect(match).toBeTruthy();
        id = match![1];

        // Get current owner
        const getResult = await callTool(client, 'SAPTransport', { action: 'get', id });
        const transport = JSON.parse(expectToolSuccess(getResult));

        // Reassign to same user (safe)
        const reassignResult = await callTool(client, 'SAPTransport', {
          action: 'reassign',
          id,
          owner: transport.owner,
        });
        const reassignText = expectToolSuccess(reassignResult);
        expect(reassignText).toContain('Reassigned transport');
      } finally {
        if (id) {
          const deleteResult = await callTool(client, 'SAPTransport', { action: 'delete', id, recursive: true });
          expectToolSuccess(deleteResult);
        }
      }
    });

    it('returns a schema error for unknown action', async () => {
      const result = await callTool(client, 'SAPTransport', {
        action: 'nonexistent',
      });
      expectToolError(result, 'Invalid arguments for SAPTransport');
    });
  });

  // ── Transportable SAPWrite with auto-corrNr ─────────────────────

  describe('SAPWrite in transportable package (auto-corrNr)', () => {
    it('updates a program without explicit transport via lock corrNr propagation', async (ctx) => {
      requireOrSkip(
        ctx,
        transportPackageWriteTestsEnabled ? true : undefined,
        SkipReason.TRANSPORT_PACKAGE_WRITES_DISABLED,
      );
      const pkg = process.env.TEST_TRANSPORT_PACKAGE;
      requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE);

      const testName = `ZARC1_E2E_TR_${Date.now().toString(36).toUpperCase().slice(-6)}`;
      let transportId = '';
      let programCreated = false;
      const cleanupErrors: string[] = [];

      try {
        // Step 1: Create a transport for the create operation
        const createTransportResult = await callTool(client, 'SAPTransport', {
          action: 'create',
          description: `ARC-1 E2E transportable write ${Date.now()}`,
        });
        const transportText = expectToolSuccess(createTransportResult);
        const transportMatch = transportText.match(/([A-Z0-9]+K\d+)/);
        transportId = transportMatch?.[1] ?? '';
        expect(transportMatch, 'Should get a transport ID').toBeTruthy();

        // Step 2: Create a program in the transportable package
        const createResult = await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'PROG',
          name: testName,
          source: `REPORT ${testName.toLowerCase()}.\nWRITE: / 'original'.`,
          package: pkg,
          transport: transportId,
        });
        expectToolSuccess(createResult);
        programCreated = true;
        trackTransportableProgram(testName);

        // Step 3: Update WITHOUT explicit transport — should auto-use lock corrNr
        const updateResult = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'PROG',
          name: testName,
          source: `REPORT ${testName.toLowerCase()}.\nWRITE: / 'auto-corrNr propagated'.`,
        });
        expectToolSuccess(updateResult);

        // Step 4: Read back and verify
        const readResult = await callTool(client, 'SAPRead', {
          type: 'PROG',
          name: testName,
        });
        const readText = expectToolSuccess(readResult);
        expect(readText).toContain('auto-corrNr propagated');
      } finally {
        if (programCreated) {
          try {
            await deleteTrackedTransportableProgram(testName);
          } catch (err) {
            cleanupErrors.push(err instanceof Error ? err.message : String(err));
          }
        }

        if (transportId) {
          const deleteTransportResult = await callTool(client, 'SAPTransport', {
            action: 'delete',
            id: transportId,
            recursive: true,
          });
          if (deleteTransportResult.isError) {
            cleanupErrors.push(deleteTransportResult.content?.[0]?.text ?? `Failed to delete transport ${transportId}`);
          }
        }
      }

      if (cleanupErrors.length > 0) {
        expect(cleanupErrors, 'Transportable E2E cleanup failed').toEqual([]);
      }
    });
  });

  // ── SAPTransport history (reverse lookup) ──────────────────────

  describe('SAPTransport history action', () => {
    it('returns valid JSON for an existing class fixture', async (ctx) => {
      // By design this is read-only and should work independently from transport write enablement.
      const result = await callTool(client, 'SAPTransport', {
        action: 'history',
        type: 'CLAS',
        name: 'ZCL_ARC1_TEST',
      });

      if (result.isError) {
        const text = result.content?.[0]?.text ?? '';
        if (text.includes('Unknown tool')) {
          return skipTest(ctx, 'SAPTransport tool not available on MCP server');
        }
        if (text.toLowerCase().includes('not found')) {
          requireOrSkip(
            ctx,
            undefined,
            `${SkipReason.NO_FIXTURE}: ZCL_ARC1_TEST not found — run npm run test:e2e:fixtures first`,
          );
        }
      }

      const payload = JSON.parse(expectToolSuccess(result));
      expect(payload.object.type).toBe('CLAS');
      expect(payload.object.name).toBe('ZCL_ARC1_TEST');
      expect(Array.isArray(payload.relatedTransports)).toBe(true);
      expect(typeof payload.summary).toBe('string');
      expect(payload.summary.length).toBeGreaterThan(0);
    });

    it('returns an error when type or name is missing', async (ctx) => {
      const result = await callTool(client, 'SAPTransport', { action: 'history' });
      if (result.isError && (result.content?.[0]?.text ?? '').includes('Unknown tool')) {
        return skipTest(ctx, 'SAPTransport tool not available on MCP server');
      }
      expectToolError(result);
      const text = result.content?.[0]?.text ?? '';
      expect(text.toLowerCase()).toMatch(/type|name/);
    });
  });
});
