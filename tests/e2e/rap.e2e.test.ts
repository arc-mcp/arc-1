/**
 * E2E Tests for RAP Completeness Features
 *
 * Tests DDLX (metadata extensions), SRVB (service bindings), and batch activation.
 * Uses standard /DMO/ Flight Reference Scenario objects that exist on any demo system.
 *
 * Read tests use DMO objects (no setup needed).
 * Write lifecycle and batch activation tests use managed ARC-1 fixtures.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

function parsePossiblyCachedJson(text: string): any {
  return JSON.parse(text.replace(/^\[cached(?::revalidated)?\]\n/, ''));
}

describe('E2E RAP Completeness Tests', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  // ── DDLX Read ─────────────────────────────────────────────────────

  describe('SAPRead DDLX (Metadata Extensions)', () => {
    it('reads a DDLX metadata extension source', async (ctx) => {
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLX',
        name: '/DMO/C_AGENCYTP',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      // SAPRead DDLX returns a soft "No metadata extension (DDLX) found"
      // placeholder when the DDLX doesn't exist — which is the state on any
      // system that didn't ship the /DMO/ Flight Reference scenario.
      if (/No metadata extension \(DDLX\) found/i.test(text)) {
        skipTest(
          ctx,
          'Required test fixture not found on SAP system (/DMO/C_AGENCYTP DDLX) — S/4 Flight Reference Scenario',
        );
        return;
      }
      // DDLX source contains annotation layer and annotate keyword
      expect(text).toContain('@Metadata.layer');
      expect(text).toContain('annotate');
    });

    it('reads a DDLX with UI annotations for Fiori Elements', async (ctx) => {
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLX',
        name: '/DMO/C_TRAVEL_A_D',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      if (/No metadata extension \(DDLX\) found/i.test(text)) {
        skipTest(
          ctx,
          'Required test fixture not found on SAP system (/DMO/C_TRAVEL_A_D DDLX) — S/4 Flight Reference Scenario',
        );
        return;
      }
      expect(text).toContain('@UI');
      // Should contain facet definitions and line item annotations
      expect(text).toContain('lineItem');
    });

    it('returns soft informational message for non-existent DDLX', async () => {
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLX',
        name: 'ZZZNOTEXIST_DDLX_999',
      });
      const text = expectToolSuccess(result);
      expect(text).toContain('No metadata extension (DDLX) found');
      expect(text).toContain('ZZZNOTEXIST_DDLX_999');
    });
  });

  // ── SRVB Read ─────────────────────────────────────────────────────

  describe('SAPRead SRVB (Service Bindings)', () => {
    it('reads a V4 service binding as structured JSON', async (ctx) => {
      const result = await callTool(client, 'SAPRead', {
        type: 'SRVB',
        name: '/DMO/UI_AGENCY_O4',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const parsed = parsePossiblyCachedJson(text);

      expect(parsed.name).toBe('/DMO/UI_AGENCY_O4');
      expect(parsed.type).toBe('SRVB/SVB');
      expect(parsed.odataVersion).toBe('V4');
      expect(parsed.bindingType).toBe('ODATA');
      expect(parsed.bindingCategory).toBe('UI');
      expect(parsed.serviceDefinition).toBeTruthy();
      expect(parsed.package).toBeTruthy();
    });

    it('reads a V2 service binding', async (ctx) => {
      const result = await callTool(client, 'SAPRead', {
        type: 'SRVB',
        name: '/DMO/UI_TRAVEL_U_V2',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const parsed = parsePossiblyCachedJson(text);

      expect(parsed.name).toBe('/DMO/UI_TRAVEL_U_V2');
      expect(parsed.odataVersion).toBe('V2');
      expect(parsed.bindingType).toBe('ODATA');
    });

    it('returns publish status for service bindings', async (ctx) => {
      const result = await callTool(client, 'SAPRead', {
        type: 'SRVB',
        name: '/DMO/UI_TRAVEL_D_D_O4',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const parsed = parsePossiblyCachedJson(text);

      // Binding should have publish status and service definition reference
      expect(typeof parsed.published).toBe('boolean');
      expect(typeof parsed.bindingCreated).toBe('boolean');
      expect(parsed.serviceDefinition).toBeTruthy();
      expect(parsed.releaseState).toBeTruthy();
    });

    it('returns 404 error for non-existent SRVB', async () => {
      const result = await callTool(client, 'SAPRead', {
        type: 'SRVB',
        name: 'ZZZNOTEXIST_SRVB_999',
      });
      expectToolError(result, 'ZZZNOTEXIST_SRVB_999');
    });
  });

  // ── SAPActivate: Single + Batch ───────────────────────────────────

  describe('SAPActivate', () => {
    it('activates a single object successfully', async () => {
      // Activating an already-active managed fixture is a no-op, but still
      // exercises SAPActivate inside the CI allowedPackages ceiling.
      const result = await callTool(client, 'SAPActivate', {
        type: 'PROG',
        name: 'ZARC1_TEST_REPORT',
      });
      const text = expectToolSuccess(result);
      expect(text).toContain('ZARC1_TEST_REPORT');
    });

    it('batch activates multiple objects together', async () => {
      const result = await callTool(client, 'SAPActivate', {
        objects: [
          { type: 'PROG', name: 'ZARC1_TEST_REPORT' },
          { type: 'CLAS', name: 'ZCL_ARC1_TEST' },
        ],
      });
      const text = expectToolSuccess(result);
      expect(text).toContain('2 objects');
      expect(text).toContain('ZARC1_TEST_REPORT');
      expect(text).toContain('ZCL_ARC1_TEST');
    });
  });

  // ── Write + Activate Lifecycle ────────────────────────────────────

  describe('SAPWrite + SAPActivate lifecycle', () => {
    const WRITE_NAME = 'ZARC1_E2E_WRITE';

    it('creates a program, updates source, activates, reads back, deletes', async (ctx) => {
      // Pre-cleanup: delete stale object from a previous run that failed mid-lifecycle
      try {
        await callTool(client, 'SAPWrite', {
          action: 'delete',
          type: 'PROG',
          name: WRITE_NAME,
        });
        console.log(`    [cleanup] Deleted stale ${WRITE_NAME} from previous run`);
      } catch {
        // best-effort-cleanup: object may not exist — that's the happy path
      }

      // Step 1: Create the transient program
      const createResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: WRITE_NAME,
        source: "REPORT zarc1_e2e_write.\nWRITE: / 'original'.",
        package: '$TMP',
      });
      expectToolSuccessOrSkip(ctx, createResult);

      try {
        // Step 2: Activate the created program
        const activateResult = await callTool(client, 'SAPActivate', {
          type: 'PROG',
          name: WRITE_NAME,
        });
        const activateText = activateResult.content[0]?.text ?? '';
        expect(activateText).toContain(WRITE_NAME);

        // Step 3: Update the source
        const updatedSource = "REPORT zarc1_e2e_write.\nWRITE: / 'updated by E2E test'.";
        const updateResult = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'PROG',
          name: WRITE_NAME,
          source: updatedSource,
        });
        expectToolSuccess(updateResult);

        // Step 4: Activate the updated program
        const reactivateResult = await callTool(client, 'SAPActivate', {
          type: 'PROG',
          name: WRITE_NAME,
        });
        expect(reactivateResult.content[0]?.text).toContain(WRITE_NAME);

        // Step 5: Read back and verify the update took effect
        const readResult = await callTool(client, 'SAPRead', {
          type: 'PROG',
          name: WRITE_NAME,
        });
        const readText = expectToolSuccess(readResult);
        expect(readText).toContain('updated by E2E test');
      } finally {
        // Always clean up — delete the transient object even if test fails
        try {
          await callTool(client, 'SAPWrite', {
            action: 'delete',
            type: 'PROG',
            name: WRITE_NAME,
          });
        } catch {
          // Best-effort cleanup
        }
      }
    });
  });
});
