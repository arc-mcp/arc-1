/**
 * E2E Tests for CDS Context Features
 *
 * Tests SAPContext(type='DDLS') and SAPRead(type='DDLS', include='elements').
 * Dynamically discovers an available DDLS on the system, then runs tests against it.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

/** Well-known CDS views to try, in order of likelihood */
const DDLS_CANDIDATES = ['/DMO/I_TRAVEL', '/DMO/I_FLIGHT', '/DMO/I_BOOKING', 'I_LANGUAGE', 'SEPM_I_SALESORDER'];

/** Try each candidate via SAPRead until one succeeds */
async function findAvailableDdls(client: Client): Promise<string | undefined> {
  for (const name of DDLS_CANDIDATES) {
    try {
      const result = await callTool(client, 'SAPRead', { type: 'DDLS', name });
      if (!result.isError && result.content?.[0]?.text?.includes('define')) {
        return name;
      }
    } catch {
      // Not available — try next
    }
  }
  return undefined;
}

describe('E2E CDS Context Tests', () => {
  let client: Client;
  let cdsName: string | undefined;

  beforeAll(async () => {
    client = await connectClient();
    cdsName = await findAvailableDdls(client);
    if (!cdsName) {
      console.log('    [setup] No DDLS found on system; CDS tests will skip through requireOrSkip');
    }
  }, 60000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  // ── SAPRead DDLS ──────────────────────────────────────────────────

  describe('SAPRead DDLS', () => {
    it('reads raw DDL source for a CDS view', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLS',
        name: cdsName,
      });
      const text = expectToolSuccess(result);
      expect(text).toContain('define');
    });

    it('returns structured elements with include="elements"', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLS',
        name: cdsName,
        include: 'elements',
      });
      const text = expectToolSuccess(result);
      expect(text).toContain(`=== ${cdsName} elements ===`);
    });

    it('returns 404 error for non-existent DDLS', async () => {
      const result = await callTool(client, 'SAPRead', {
        type: 'DDLS',
        name: 'ZZZNOTEXIST_DDLS_999',
      });
      expectToolError(result, 'ZZZNOTEXIST_DDLS_999');
    });
  });

  // ── SAPContext DDLS ───────────────────────────────────────────────

  describe('SAPContext DDLS', () => {
    it('returns CDS dependency context', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      const result = await callTool(client, 'SAPContext', {
        type: 'DDLS',
        name: cdsName,
      });
      const text = expectToolSuccess(result);
      expect(text).toContain(`CDS dependency context for ${cdsName}`);
      expect(text).toContain('Stats:');
      expect(text).toContain('resolved');
    });

    it('returns CDS dependency context with depth=2', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      const result = await callTool(client, 'SAPContext', {
        type: 'DDLS',
        name: cdsName,
        depth: 2,
      });
      const text = expectToolSuccess(result);
      expect(text).toContain(`CDS dependency context for ${cdsName}`);
      expect(text).toContain('resolved');
    });

    it('returns error for non-existent DDLS', async () => {
      const result = await callTool(client, 'SAPContext', {
        type: 'DDLS',
        name: 'ZZZNOTEXIST_DDLS_999',
      });
      expectToolError(result, 'ZZZNOTEXIST_DDLS_999');
    });
  });
});
