/**
 * Slow E2E tests for SAPNavigate broad where-used scans.
 *
 * These checks hit high-cardinality standard DDIC objects and are valuable for
 * coverage, but too expensive for the default PR E2E path.
 *
 * Run: npm run test:e2e:slow
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

describe('E2E SAPNavigate — Slow Where-Used Analysis', () => {
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

  it('finds references to T000 table', async (ctx) => {
    // T000 is universal across SAP systems and normally has many references.
    const result = await callTool(client, 'SAPNavigate', {
      action: 'references',
      type: 'TABL',
      name: 'T000',
    });
    const text = expectToolSuccessOrSkip(ctx, result);
    const refs = JSON.parse(text);
    expect(refs.length).toBeGreaterThan(0);
    console.log(`    T000 table has ${refs.length} references`);
  });

  it('filters BAPIRET2 references by objectType CLAS/OC', async () => {
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
