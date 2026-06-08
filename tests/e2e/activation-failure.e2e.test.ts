/**
 * E2E regression test for the activation-failure path (PR #179 follow-up).
 *
 * Background: The original PR #179 fixed five independent bugs that combined to make
 * `SAPActivate` report "Successfully activated" for an object that was provably inactive
 * (parseActivationResult misread <ioc:inactiveObjects> as success, missing version param,
 * NW 7.50 <chkrun:checkMessage> shape, etc). A single E2E test exercising the
 * deliberate-failure path would have caught all five.
 *
 * What this test asserts (the regression contract):
 *   1. SAPActivate on a deliberately broken PROG returns isError=true.
 *   2. The error text says "Activation failed" (so the LLM doesn't see "Successfully…").
 *   3. The error names the object (so the LLM knows which object).
 *
 * The transient PROG uses a unique timestamped name so concurrent runs do not collide.
 * Cleanup is best-effort in finally blocks (per tests/e2e/diagnostics.e2e.test.ts pattern).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipTest } from '../helpers/skip-policy.js';
import { callTool, classifyToolErrorSkip, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'abap');

describe('E2E SAPActivate failure path (PR #179 regression)', () => {
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

  it('reports activation failure with a clear error message for a deliberately broken PROG', async (ctx) => {
    const brokenSource = readFileSync(join(FIXTURES_DIR, 'zarc1_e2e_act_broken.abap'), 'utf-8');
    // Unique name per run to avoid collisions on parallel CI executions.
    const suffix = Date.now().toString(36).slice(-6);
    const progName = `ZARC1_E2E_ACTBROKE_${suffix}`.toUpperCase();

    let created = false;
    try {
      // 1. Create the broken object. The CREATE itself succeeds — SAP does not
      //    syntax-check on create, only on activate.
      const createResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: progName,
        source: brokenSource,
        package: '$TMP',
      });

      if (createResult.isError) {
        const text = createResult.content?.[0]?.text ?? '';
        const skip = classifyToolErrorSkip(createResult);
        if (skip !== null) {
          skipTest(ctx, skip);
          return;
        }
        // Known precondition gaps that legitimately skip this test:
        //   - NW 7.50 PROG/INCLUDE split: the lock-handle for the PROG resource is rejected
        //     when the source PUT targets the auto-generated INCLUDE wrapper (status 423,
        //     "is not locked (invalid lock handle)"). Distinct from the bug under test.
        //   - Server safety gates (read-only, package allowlist) blocking writes.
        if (/read-only|not allowed|package|forbidden/i.test(text) || /invalid lock handle|is not locked/i.test(text)) {
          skipTest(ctx, `Create blocked by activation-failure precondition: ${text.slice(0, 200)}`);
          return;
        }
        throw new Error(`Unexpected create failure: ${text.slice(0, 300)}`);
      }
      expectToolSuccess(createResult);
      created = true;

      // 2. Update source — needed because some SAP releases require an explicit
      //    update after create before the body is visible to the activator.
      const updateResult = await callTool(client, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name: progName,
        source: brokenSource,
      });
      if (updateResult.isError) {
        const text = updateResult.content?.[0]?.text ?? '';
        const skip = classifyToolErrorSkip(updateResult);
        if (skip !== null) {
          skipTest(ctx, skip);
          return;
        }
        if (/invalid lock handle|is not locked/i.test(text)) {
          skipTest(ctx, `Update blocked by NW 7.50 lock-handle quirk: ${text.slice(0, 200)}`);
          return;
        }
        console.log(`    update warning (continuing): ${text.slice(0, 200)}`);
      }

      // 3. Activate. This is the key assertion — must return an error containing
      //    "Activation failed" (the LLM-facing failure marker) and the object name.
      const activateResult = await callTool(client, 'SAPActivate', {
        action: 'activate',
        type: 'PROG',
        name: progName,
      });

      const errorText = expectToolError(activateResult);
      // Robust contract — match the LLM-facing surface:
      //   - "Activation failed" or "still inactive" (parseActivationOutcome → outcomeToResult)
      //   - The object name (so the LLM knows what failed)
      expect(errorText).toMatch(/Activation failed|still inactive/i);
      expect(errorText.toUpperCase()).toContain(progName);
      // The broken reference is on line 10 of the fixture source.
      expect(errorText).toMatch(/\[line 10\]/);

      // 4. Batch activate the same broken object — must also surface the failure.
      const batchResult = await callTool(client, 'SAPActivate', {
        action: 'activate',
        objects: [{ type: 'PROG', name: progName }],
      });

      const batchErrorText = expectToolError(batchResult);
      expect(batchErrorText).toMatch(/Batch activation failed/i);
      expect(batchErrorText.toUpperCase()).toContain(progName);
      // Per-object status must attribute the error to the specific object with the correct line.
      expect(batchErrorText).toMatch(new RegExp(`${progName}.*\\(PROG\\).*\\[line 10\\]`, 'i'));
    } finally {
      if (created) {
        try {
          // best-effort-cleanup: delete the transient broken object
          await callTool(client, 'SAPWrite', {
            action: 'delete',
            type: 'PROG',
            name: progName,
          });
        } catch {
          // best-effort-cleanup: delete may fail if the object was activated or
          // is locked by a previous run — leaving stale objects is acceptable in CI
        }
      }
    }
  });
});
