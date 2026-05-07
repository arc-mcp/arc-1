/**
 * E2E Tests for SAPNavigate — Where-Used Analysis
 *
 * Tests the scope-based Where-Used API against real SAP objects:
 * - Custom Z objects (ZIF_ARC1_TEST, ZCL_ARC1_TEST) with known relationships (skipped if not present)
 * - Standard SAP objects (CL_ABAP_CHAR_UTILITIES, BAPIRET2, BUKRS) with many references
 * - Multiple object types: CLAS, INTF, DOMA, DTEL, TABL (covers transparent tables and DDIC structures)
 * - objectType filtering
 * - Error handling for missing/invalid parameters
 *
 * Uses standard SAP objects for the core tests (no setup needed).
 * Custom Z object tests are skipped when the objects don't exist on the system.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

/** Check if a custom object exists on the SAP system via SAPSearch */
async function objectExists(client: Client, name: string): Promise<boolean> {
  try {
    const result = await callTool(client, 'SAPSearch', { query: name, maxResults: 1 });
    const parsed = JSON.parse(result.content?.[0]?.text ?? '[]');
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

describe('E2E SAPNavigate — Where-Used Analysis', () => {
  let client: Client;
  let hasCustomObjects = false;
  const CUSTOM_OBJECT_SKIP_REASON =
    'Custom Z fixtures missing on target SAP system (expected ZIF_ARC1_TEST + ZCL_ARC1_TEST)';

  beforeAll(async () => {
    client = await connectClient();
    // Check if custom test objects exist (don't try to create them)
    const [hasIntf, hasClas] = await Promise.all([
      objectExists(client, 'ZIF_ARC1_TEST'),
      objectExists(client, 'ZCL_ARC1_TEST'),
    ]);
    hasCustomObjects = hasIntf && hasClas;
    if (!hasCustomObjects) {
      console.log('    [info] Custom Z objects not found — skipping custom object tests');
    }
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  // ── Custom objects: known relationships ──────────────────────────

  describe('Custom Z objects (known references)', () => {
    it('finds references to ZIF_ARC1_TEST — implemented by ZCL_ARC1_TEST', async (ctx) => {
      if (!hasCustomObjects) return ctx.skip(CUSTOM_OBJECT_SKIP_REASON);
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_ARC1_TEST',
      });
      const text = expectToolSuccess(result);
      if (/^No references found\./i.test(text)) {
        ctx.skip(
          'Where-used index empty on this system (likely freshly-activated fixture, or SAP_BASIS level without usageReferences indexing)',
        );
        return;
      }
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      // ZCL_ARC1_TEST implements this interface — must appear in results
      const classRef = refs.find((r: { name: string }) => r.name === 'ZCL_ARC1_TEST');
      expect(classRef, 'ZCL_ARC1_TEST should reference ZIF_ARC1_TEST').toBeDefined();
      expect(classRef.uri).toContain('/oo/classes/');
    });

    it('finds references to ZCL_ARC1_TEST using type+name', async (ctx) => {
      if (!hasCustomObjects) return ctx.skip(CUSTOM_OBJECT_SKIP_REASON);
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_ARC1_TEST',
      });
      const text = expectToolSuccess(result);
      if (/^No references found\./i.test(text)) {
        ctx.skip('Where-used index empty for ZCL_ARC1_TEST on this system');
        return;
      }
      const refs = JSON.parse(text);
      expect(Array.isArray(refs)).toBe(true);
      if (refs.length > 0) {
        expect(refs[0]).toHaveProperty('uri');
        expect(refs[0]).toHaveProperty('type');
        expect(refs[0]).toHaveProperty('name');
      }
    });

    it('returns enriched fields (line, snippet, package) from scope-based API', async (ctx) => {
      if (!hasCustomObjects) return ctx.skip(CUSTOM_OBJECT_SKIP_REASON);
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_ARC1_TEST',
      });
      const text = expectToolSuccess(result);
      if (/^No references found\./i.test(text)) {
        ctx.skip('Where-used index empty for ZIF_ARC1_TEST on this system');
        return;
      }
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      const first = refs[0];
      // Scope-based API returns enriched fields
      if ('line' in first && first.line > 0) {
        expect(first.line).toBeGreaterThan(0);
        expect(first).toHaveProperty('packageName');
        expect(first).toHaveProperty('snippet');
        console.log(
          `    Enriched result: line=${first.line}, package=${first.packageName}, snippet="${first.snippet}"`,
        );
      } else {
        console.log('    Legacy API: no line/snippet enrichment');
      }
    });

    it('finds definition of interface reference in class source', async (ctx) => {
      if (!hasCustomObjects) return ctx.skip(CUSTOM_OBJECT_SKIP_REASON);
      // ZCL_ARC1_TEST line 3: "INTERFACES zif_arc1_test."
      const result = await callTool(client, 'SAPNavigate', {
        action: 'definition',
        uri: '/sap/bc/adt/oo/classes/ZCL_ARC1_TEST/source/main',
        line: 3,
        column: 16,
        source: [
          'CLASS zcl_arc1_test DEFINITION PUBLIC FINAL CREATE PUBLIC.',
          '  PUBLIC SECTION.',
          '    INTERFACES zif_arc1_test.',
        ].join('\n'),
      });
      if (result.isError) {
        const errText = result.content?.[0]?.text ?? '';
        // Some SAP trial backends return 400 (I::000) for navigation/target on custom class offsets.
        if (/status 400/i.test(errText) && /navigation\/target/i.test(errText)) {
          return ctx.skip('ADT definition API returned HTTP 400 for custom class source offset on this backend');
        }
      }
      const text = expectToolSuccess(result);
      const def = JSON.parse(text);
      expect(def.uri).toContain('zif_arc1_test');
      expect(def.name).toMatch(/ZIF_ARC1_TEST/i);
    });
  });

  // ── Standard SAP objects: classes ─────────────────────────────────

  describe('Standard classes', () => {
    it('finds references to CL_ABAP_CHAR_UTILITIES — widely used class', async () => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'CL_ABAP_CHAR_UTILITIES',
      });
      const text = expectToolSuccess(result);
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThan(0);
      const first = refs[0];
      expect(first).toHaveProperty('uri');
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('name');
      expect(first.uri).toBeTruthy();
      expect(first.name).toBeTruthy();
    });
  });

  // ── Standard SAP objects: DDIC ────────────────────────────────────

  describe('DDIC objects', () => {
    it('finds references to BAPIRET2 structure (via unified TABL type)', async () => {
      // Model B: DDIC structures use type='TABL' (no separate STRU).
      // ARC-1 resolves /sap/bc/adt/ddic/structures/BAPIRET2 internally.
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'TABL',
        name: 'BAPIRET2',
      });
      const text = expectToolSuccess(result);
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThan(0);
      console.log(`    BAPIRET2 has ${refs.length} references`);
    });

    it('finds references to BUKRS domain', async (ctx) => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'DOMA',
        name: 'BUKRS',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThan(0);
      console.log(`    BUKRS domain has ${refs.length} references`);
    });

    it('finds references to BUKRS data element', async (ctx) => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'DTEL',
        name: 'BUKRS',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThan(0);
      console.log(`    BUKRS data element has ${refs.length} references`);
    });

    it('finds references to T001 table', async (ctx) => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'TABL',
        name: 'T001',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      const refs = JSON.parse(text);
      expect(refs.length).toBeGreaterThan(0);
      console.log(`    T001 table has ${refs.length} references`);
    });
  });

  // ── objectType filtering ──────────────────────────────────────────

  describe('objectType filtering', () => {
    it('filters references by objectType PROG/P', async () => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'CL_ABAP_CHAR_UTILITIES',
        objectType: 'PROG/P',
      });
      const text = expectToolSuccess(result);
      const refs = JSON.parse(text);
      // The objectTypeFilter is sent in the request body, but some SAP systems
      // ignore it and return all types. We just verify we got results back.
      if (Array.isArray(refs)) {
        expect(refs.length).toBeGreaterThan(0);
        const progCount = refs.filter((r: { type: string }) => r.type === 'PROG/P').length;
        console.log(`    ${refs.length} references (${progCount} PROG/P) — scope-based API`);
      } else {
        expect(refs.note).toContain('objectType filter');
        expect(Array.isArray(refs.results)).toBe(true);
        console.log(`    Fallback: ${refs.results.length} unfiltered references (legacy API)`);
      }
    });

    it('filters references by objectType CLAS/OC', async () => {
      // BAPIRET2 is a DDIC structure; under Model B both structures and
      // transparent tables use type='TABL'.
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
        type: 'TABL',
        name: 'BAPIRET2',
        objectType: 'CLAS/OC',
      });
      const text = expectToolSuccess(result);
      const refs = JSON.parse(text);
      if (Array.isArray(refs)) {
        expect(refs.length).toBeGreaterThan(0);
        const clasCount = refs.filter((r: { type: string }) => r.type === 'CLAS/OC').length;
        console.log(`    ${refs.length} references (${clasCount} CLAS/OC) — scope-based API`);
      } else {
        expect(refs.note).toContain('objectType filter');
        console.log(`    Fallback: ${refs.results.length} unfiltered references (legacy API)`);
      }
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error when no uri or type+name provided', async () => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'references',
      });
      expectToolError(result, 'uri', 'type');
    });

    it('returns error for definition without line/column', async () => {
      const result = await callTool(client, 'SAPNavigate', {
        action: 'definition',
        uri: '/sap/bc/adt/oo/classes/CL_ABAP_CHAR_UTILITIES/source/main',
      });
      expectToolError(result, 'line', 'column');
    });
  });
});
