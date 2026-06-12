/**
 * E2E Tests for Runtime Diagnostics (SAPDiagnose: dumps + traces)
 *
 * Tests the full MCP stack for short dump analysis (ST22) and
 * ABAP profiler trace listing.
 *
 * Dump fixture strategy:
 *   ZARC1_E2E_DUMP is a managed persistent fixture. This suite verifies that
 *   the fixture exists, then reads a matching historical dump when one is
 *   present. MCP cannot execute ABAP reports, so the test falls back to any
 *   available dump when no fixture-specific dump exists.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

function stripCachedMarker(text: string): string {
  return text.replace(/^\[cached(?::revalidated)?\]\n/, '');
}

describe('E2E Diagnostics Tests', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  // ── Short Dumps (ST22) ──────────────────────────────────────────

  describe('SAPDiagnose dumps', () => {
    it('lists dumps via MCP (may be empty)', async () => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        maxResults: 5,
      });
      const text = expectToolSuccess(result);
      const dumps = JSON.parse(text);
      expect(Array.isArray(dumps)).toBe(true);
      console.log(`    Found ${dumps.length} dumps`);

      if (dumps.length > 0) {
        // Verify structure of first dump
        expect(dumps[0]).toHaveProperty('id');
        expect(dumps[0]).toHaveProperty('timestamp');
        expect(dumps[0]).toHaveProperty('user');
        expect(dumps[0]).toHaveProperty('error');
        expect(dumps[0]).toHaveProperty('program');
        expect(dumps[0].id).toBeTruthy();
        expect(dumps[0].error).toBeTruthy();
        console.log(
          `    First dump: ${dumps[0].error} in ${dumps[0].program} by ${dumps[0].user} at ${dumps[0].timestamp}`,
        );
      }
    });

    it('lists dumps filtered by user', async (ctx) => {
      // First get unfiltered to find a user that has dumps
      const allResult = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        maxResults: 1,
      });
      const allDumps = JSON.parse(expectToolSuccess(allResult));
      if (allDumps.length === 0) {
        skipTest(ctx, 'No dumps on system — cannot test user filter');
        return;
      }

      const user = allDumps[0].user;
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        user,
        maxResults: 5,
      });
      const text = expectToolSuccess(result);
      const dumps = JSON.parse(text);
      expect(Array.isArray(dumps)).toBe(true);

      // All returned dumps should be from this user
      for (const dump of dumps) {
        expect(dump.user.toUpperCase()).toBe(user.toUpperCase());
      }
      console.log(`    ${dumps.length} dumps for user ${user}`);
    });

    it('reads dump detail with focused sections by default', async (ctx) => {
      // Get a dump ID to read
      const listResult = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        maxResults: 1,
      });
      const dumps = JSON.parse(expectToolSuccess(listResult));
      if (dumps.length === 0) {
        skipTest(ctx, 'No dumps on system — cannot test detail read');
        return;
      }

      const dumpId = dumps[0].id;
      console.log(`    Reading dump: ${dumpId.slice(0, 60)}...`);

      const result = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        id: dumpId,
      });
      const text = expectToolSuccess(result);
      const detail = JSON.parse(text);

      // Verify structure
      expect(detail.error).toBeTruthy();
      // exception may be empty for system-level dumps (not all dumps are ABAP exceptions)
      expect(typeof detail.exception).toBe('string');
      expect(detail.program).toBeTruthy();
      expect(detail.user).toBeTruthy();
      expect(detail.timestamp).toBeTruthy();

      // Section-focused payload should be present by default (full formattedText is opt-in)
      expect(typeof detail.sections).toBe('object');
      expect(Object.keys(detail.sections ?? {}).length).toBeGreaterThan(0);
      expect(detail.formattedText).toBeUndefined();

      // Chapters should exist
      expect(Array.isArray(detail.chapters)).toBe(true);
      expect(detail.chapters.length).toBeGreaterThan(0);
      expect(detail.chapters[0]).toHaveProperty('title');
      expect(detail.chapters[0]).toHaveProperty('category');
      expect(detail.chapters[0]).toHaveProperty('line');

      console.log(`    Dump: ${detail.error} (${detail.exception}) in ${detail.program}`);
      console.log(`    Chapters: ${detail.chapters.length}, Sections: ${Object.keys(detail.sections ?? {}).length}`);
      if (detail.terminationUri) {
        console.log(`    Termination: ${detail.terminationUri}`);
      }
    });

    it('uses the managed dump fixture and reads dump detail', async (ctx) => {
      const dumpProgName = 'ZARC1_E2E_DUMP';

      const fixtureReadResult = await callTool(client, 'SAPRead', { type: 'PROG', name: dumpProgName });
      if (fixtureReadResult.isError) {
        return skipTest(
          ctx,
          `Required test fixture not found on SAP system (${dumpProgName}) — run npm run test:e2e:fixtures first`,
        );
      }
      const fixtureSource = expectToolSuccess(fixtureReadResult);
      expect(fixtureSource).toContain('ARC-1 E2E diagnostics dump fixture');

      // Check for dumps from our test program
      const listResult = await callTool(client, 'SAPDiagnose', {
        action: 'dumps',
        maxResults: 50,
      });
      const allDumps = JSON.parse(expectToolSuccess(listResult));

      // Look for a dump from our test program or any COMPUTE_INT_ZERODIVIDE
      const ourDump = allDumps.find(
        (d: { program: string; error: string }) =>
          d.program === dumpProgName || d.program === `SAPL${dumpProgName}` || d.error === 'COMPUTE_INT_ZERODIVIDE',
      );

      if (ourDump) {
        console.log(`    Found relevant dump: ${ourDump.error} in ${ourDump.program} at ${ourDump.timestamp}`);

        // Read its detail
        const detailResult = await callTool(client, 'SAPDiagnose', {
          action: 'dumps',
          id: ourDump.id,
        });
        const detail = JSON.parse(expectToolSuccess(detailResult));
        expect(detail.error).toBe(ourDump.error);
        expect(Object.keys(detail.sections ?? {}).length).toBeGreaterThan(0);
        console.log(`    Detail read OK: ${Object.keys(detail.sections ?? {}).length} sections`);
      } else if (allDumps.length > 0) {
        console.log(`    No COMPUTE_INT_ZERODIVIDE dump found, but ${allDumps.length} other dumps available`);
        // Verify we can read at least one — validates API shape with available data
        const detailResult = await callTool(client, 'SAPDiagnose', {
          action: 'dumps',
          id: allDumps[0].id,
        });
        const detail = JSON.parse(expectToolSuccess(detailResult));
        expect(Object.keys(detail.sections ?? {}).length).toBeGreaterThan(0);
      } else {
        return skipTest(
          ctx,
          'Managed dump fixture exists but no dumps are available — MCP cannot execute ABAP reports',
        );
      }
    });
  });

  // ── ABAP Traces ─────────────────────────────────────────────────

  describe('SAPDiagnose traces', () => {
    it('lists traces via MCP (may be empty)', async () => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'traces',
      });
      const text = expectToolSuccess(result);
      const traces = JSON.parse(text);
      expect(Array.isArray(traces)).toBe(true);
      console.log(`    Found ${traces.length} traces`);

      if (traces.length > 0) {
        expect(traces[0]).toHaveProperty('id');
        expect(traces[0]).toHaveProperty('title');
        expect(traces[0]).toHaveProperty('timestamp');
        console.log(`    First trace: "${traces[0].title}" at ${traces[0].timestamp}`);
      }
    });
  });

  describe('SAPDiagnose runtime feeds', () => {
    it('lists system messages when endpoint is available', async (ctx) => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'system_messages',
        maxResults: 5,
      });

      if (result.isError) {
        const err = result.content?.[0]?.text ?? '';
        if (/not found|unsupported|not available|404/i.test(err)) {
          return skipTest(ctx, `System messages endpoint unavailable on this system: ${err.slice(0, 200)}`);
        }
      }

      const messages = JSON.parse(expectToolSuccess(result));
      expect(Array.isArray(messages)).toBe(true);
    });

    it('lists gateway errors on supported systems', async (ctx) => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'gateway_errors',
        maxResults: 5,
      });

      if (result.isError) {
        const err = result.content?.[0]?.text ?? '';
        if (/not available on BTP|not found|unsupported|404/i.test(err)) {
          return skipTest(ctx, `Gateway error log unavailable on this system: ${err.slice(0, 200)}`);
        }
      }

      const errors = JSON.parse(expectToolSuccess(result));
      expect(Array.isArray(errors)).toBe(true);
    });
  });

  // ── Quick Fix Proposals ─────────────────────────────────────────

  describe('SAPDiagnose quickfix', () => {
    it('gets fix proposals for a class', async (ctx) => {
      const readResult = await callTool(client, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_ARC1_TEST',
      });
      if (readResult.isError) {
        return skipTest(
          ctx,
          `Fixture class ZCL_ARC1_TEST not readable: ${readResult.content?.[0]?.text ?? 'unknown error'}`,
        );
      }
      const source = stripCachedMarker(expectToolSuccess(readResult));

      const result = await callTool(client, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_ARC1_TEST',
        source,
        line: 1,
        column: 1,
      });

      if (result.isError) {
        const err = result.content?.[0]?.text ?? '';
        if (/quickfix|404|406|not found|not acceptable/i.test(err)) {
          return skipTest(ctx, `Quickfix endpoint unavailable on this system: ${err.slice(0, 200)}`);
        }
      }

      const text = expectToolSuccess(result);
      const proposals = JSON.parse(text);
      expect(Array.isArray(proposals)).toBe(true);

      if (proposals.length > 0) {
        for (const proposal of proposals) {
          expect(proposal).toHaveProperty('uri');
          expect(proposal).toHaveProperty('name');
          expect(proposal).toHaveProperty('type');
        }
      }

      const names = proposals.map((p: { name: string }) => p.name).join(', ');
      console.log(`    Quickfix proposals: ${proposals.length}${names ? ` (${names})` : ''}`);
    });

    it('returns valid proposals array for arbitrary position', async (ctx) => {
      const readResult = await callTool(client, 'SAPRead', {
        type: 'PROG',
        name: 'ZARC1_TEST_REPORT',
      });
      if (readResult.isError) {
        return skipTest(
          ctx,
          `Fixture program ZARC1_TEST_REPORT not readable: ${readResult.content?.[0]?.text ?? 'unknown error'}`,
        );
      }
      const source = stripCachedMarker(expectToolSuccess(readResult));

      const result = await callTool(client, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'PROG',
        name: 'ZARC1_TEST_REPORT',
        source,
        line: 2,
        column: 0,
      });

      if (result.isError) {
        const err = result.content?.[0]?.text ?? '';
        if (/quickfix|404|406|not found|not acceptable/i.test(err)) {
          return skipTest(ctx, `Quickfix endpoint unavailable on this system: ${err.slice(0, 200)}`);
        }
      }

      const text = expectToolSuccess(result);
      const proposals = JSON.parse(text);
      expect(Array.isArray(proposals)).toBe(true);
      // SAP may return 0 or more proposals depending on system state —
      // we only verify the response is a well-formed array of objects
      for (const p of proposals) {
        expect(p).toHaveProperty('name');
      }
    });

    it('returns error when source is missing', async () => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_ARC1_TEST',
        line: 1,
        column: 1,
      });
      expectToolError(result, 'source');
    });

    it('ATC findings include quickfix metadata', async (ctx) => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'atc',
        type: 'PROG',
        name: 'ZARC1_TEST_REPORT',
      });

      if (result.isError) {
        return skipTest(ctx, `ATC not available on this system: ${result.content?.[0]?.text ?? 'unknown error'}`);
      }

      const text = expectToolSuccess(result);
      const parsed = JSON.parse(text) as { findings?: Array<Record<string, unknown>> };
      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      if (findings.length === 0) {
        return skipTest(ctx, 'ATC returned no findings for ZARC1_TEST_REPORT — cannot verify quickfix metadata fields');
      }

      for (const finding of findings) {
        expect(typeof finding.hasQuickfix).toBe('boolean');
      }
    });
  });

  // ── CDS Test Double Framework test cases (SAP_BASIS 8.16+) ───────

  describe('SAPDiagnose cds_testcases', () => {
    it('returns CDS test-case suggestions for a standard view (skips if pre-8.16)', async (ctx) => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'cds_testcases',
        name: 'I_CURRENCY',
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (/request timed out|timed out/i.test(message)) {
          return skipTest(ctx, `${SkipReason.BACKEND_UNSUPPORTED}: cds_testcases request timed out on this backend`);
        }
        throw err;
      });

      // New on ABAP Platform 2025 (8.16). On 7.5x / S/4HANA 2023 the handler returns a
      // discovery-gated "needs SAP_BASIS 8.16+" error — skip cleanly there.
      if (result.isError) {
        return skipTest(
          ctx,
          `CDS test cases unavailable on this system: ${result.content?.[0]?.text?.slice(0, 200) ?? 'unknown error'}`,
        );
      }

      const payload = JSON.parse(expectToolSuccess(result)) as {
        cds: string;
        testCaseCount: number;
        testCases: Array<{ testMethod: string; semanticType: string }>;
        hint: string;
      };
      expect(payload.cds).toBe('I_CURRENCY');
      expect(payload.testCaseCount).toBeGreaterThan(0);
      expect(payload.testCases.length).toBe(payload.testCaseCount);
      expect(typeof payload.testCases[0]?.testMethod).toBe('string');
      expect(payload.hint).toContain('cl_cds_test_environment');
    });

    it('returns a focused error when name is missing', async () => {
      const result = await callTool(client, 'SAPDiagnose', { action: 'cds_testcases' });
      expectToolError(result, 'name');
    });
  });

  // ── Error Handling ──────────────────────────────────────────────

  describe('SAPDiagnose error handling', () => {
    it('returns error for unknown action', async () => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'foobar',
        name: 'ZTEST',
        type: 'PROG',
      });
      expectToolError(result, 'Invalid arguments for SAPDiagnose');
    });

    it('returns error for unknown trace analysis type', async () => {
      const result = await callTool(client, 'SAPDiagnose', {
        action: 'traces',
        id: 'FAKE_TRACE_ID',
        analysis: 'foobar',
      });
      expectToolError(result, 'Invalid arguments for SAPDiagnose');
    });
  });
});
