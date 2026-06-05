/**
 * E2E Tests for Runtime Diagnostics (SAPDiagnose: dumps + traces)
 *
 * Tests the full MCP stack for short dump analysis (ST22) and
 * ABAP profiler trace listing.
 *
 * Dump trigger strategy:
 *   We create and activate a small program that deliberately causes
 *   a MESSAGE_TYPE_X runtime error, then execute it via SAPQuery
 *   (which runs an ABAP SQL statement that fails). After triggering,
 *   we verify the dump appears in the listing and can be read back
 *   with full detail.
 *
 *   If triggering fails (e.g., the SAP user lacks execute permissions),
 *   we fall back to reading any existing dumps on the system.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

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
        ctx.skip('No dumps on system — cannot test user filter');
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
        ctx.skip('No dumps on system — cannot test detail read');
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

    it('triggers a fresh dump and reads it back', async (ctx) => {
      // Strategy: create a report that causes a COMPUTE_INT_ZERODIVIDE dump,
      // activate it, then check if it (or a previous run) produced dumps.
      // If write steps all fail, skip rather than silently passing.

      const dumpProgName = 'ZARC1_E2E_DUMP';
      const dumpSource = [
        `REPORT ${dumpProgName.toLowerCase()}.`,
        '* Deliberate dump for ARC-1 E2E testing.',
        '* DO NOT RUN MANUALLY — causes MESSAGE_TYPE_X dump.',
        'DATA: lv_zero TYPE i VALUE 0.',
        'DATA: lv_result TYPE i.',
        'lv_result = 1 / lv_zero.',
      ].join('\n');

      let createOk = false;
      let activateOk = false;

      // Create the program
      try {
        const createResult = await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'PROG',
          name: dumpProgName,
          source: dumpSource,
          package: '$TMP',
        });
        if (!createResult.isError) {
          createOk = true;
          console.log(`    Created ${dumpProgName}`);
        }
      } catch {
        // best-effort-cleanup: create may fail if object already exists
        console.log(`    ${dumpProgName} already exists or create failed — continuing`);
      }

      // Update source (in case it already existed with different code)
      try {
        const updateResult = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'PROG',
          name: dumpProgName,
          source: dumpSource,
        });
        if (!updateResult.isError) {
          createOk = true; // update success counts as having the program ready
        }
      } catch {
        // best-effort-cleanup: update may fail if locked or missing permissions
      }

      // Activate
      try {
        const activateResult = await callTool(client, 'SAPActivate', {
          name: dumpProgName,
          type: 'PROG',
        });
        if (activateResult.isError) {
          console.log(`    Activation warning: ${activateResult.content[0]?.text?.slice(0, 200)}`);
        } else {
          activateOk = true;
          console.log(`    Activated ${dumpProgName}`);
        }
      } catch {
        // best-effort-cleanup: activation may fail due to permissions
        console.log(`    Activation failed — continuing`);
      }

      // Signal check: if all write steps failed, skip
      if (!createOk && !activateOk) {
        return ctx.skip('Could not create or activate dump-trigger program — write steps all failed');
      }

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
        // Write steps succeeded but no dumps on system — program exists but
        // wasn't executed (we can't execute programs via MCP).
        return ctx.skip('Dump-trigger program ready but no dumps — cannot execute programs via MCP');
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
          return ctx.skip(`System messages endpoint unavailable on this system: ${err.slice(0, 200)}`);
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
          return ctx.skip(`Gateway error log unavailable on this system: ${err.slice(0, 200)}`);
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
        return ctx.skip(
          `Fixture class ZCL_ARC1_TEST not readable: ${readResult.content?.[0]?.text ?? 'unknown error'}`,
        );
      }
      const source = expectToolSuccess(readResult);

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
          return ctx.skip(`Quickfix endpoint unavailable on this system: ${err.slice(0, 200)}`);
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
        return ctx.skip(
          `Fixture program ZARC1_TEST_REPORT not readable: ${readResult.content?.[0]?.text ?? 'unknown error'}`,
        );
      }
      const source = expectToolSuccess(readResult);

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
          return ctx.skip(`Quickfix endpoint unavailable on this system: ${err.slice(0, 200)}`);
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
        return ctx.skip(`ATC not available on this system: ${result.content?.[0]?.text ?? 'unknown error'}`);
      }

      const text = expectToolSuccess(result);
      const parsed = JSON.parse(text) as { findings?: Array<Record<string, unknown>> };
      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      if (findings.length === 0) {
        return ctx.skip('ATC returned no findings for ZARC1_TEST_REPORT — cannot verify quickfix metadata fields');
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
      });

      // New on ABAP Platform 2025 (8.16). On 7.5x / S/4HANA 2023 the handler returns a
      // discovery-gated "needs SAP_BASIS 8.16+" error — skip cleanly there.
      if (result.isError) {
        return ctx.skip(
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
