/**
 * Integration test for FUGR + FUNC create/update/delete lifecycle.
 *
 * Exercises the verified live ADT recipe (issue #250 / docs/plans/add-func-fugr-create-write.md):
 *   create FUGR → create FM → lock → write source → unlock → activate → delete FM → delete FUGR
 *
 * Cleans up via try/finally + retryDelete. NPL 7.50 lock-handle 423 issues are
 * skipped via ddicSkipReason() (same pattern as crud.lifecycle.integration.test.ts).
 *
 * Run: npm run test:integration -- fugr-func.integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { createObject, safeUpdateSource } from '../../src/adt/crud.js';
import { activate } from '../../src/adt/devtools.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { SkipReason } from '../helpers/skip-policy.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const CT_FUGR = 'application/vnd.sap.adt.functions.groups.v3+xml';
const CT_FUNC = 'application/vnd.sap.adt.functions.fmodules+xml';

/**
 * Classify a caught error as a known NW 7.50-class limitation we should skip rather than fail on.
 * Mirrors ddicSkipReason() in crud.lifecycle.integration.test.ts.
 */
function fmSkipReason(err: unknown): string | null {
  if (!(err instanceof AdtApiError)) return null;
  if (err.statusCode === 423) {
    return `${SkipReason.BACKEND_UNSUPPORTED}: lock-handle session correlation differs on this release (NPL 7.50 ADT gap)`;
  }
  return null;
}

function fugrCreateBody(name: string, pkg: string, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${description}" adtcore:language="EN" adtcore:name="${name}" adtcore:type="FUGR/F" adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</group:abapFunctionGroup>`;
}

function fmCreateBody(name: string, group: string, description: string): string {
  const groupLc = encodeURIComponent(group.toLowerCase());
  return `<?xml version="1.0" encoding="UTF-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${description}" adtcore:name="${name}" adtcore:type="FUGR/FF">
  <adtcore:containerRef adtcore:name="${group}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/${groupLc}"/>
</fmodule:abapFunctionModule>`;
}

describe('FUGR + FUNC lifecycle', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    if (report.failed.length > 0) {
      // best-effort-cleanup
      console.error('FUGR/FUNC cleanup failures:', report.failed);
    }
  }, 60_000);

  it('creates a function group, creates an FM, writes source, activates, deletes', async (ctx) => {
    const fugrName = generateUniqueName('ZARC1FG');
    const fmName = generateUniqueName('ZARC1FM');
    const fugrUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}`;
    const fmUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}/fmodules/${encodeURIComponent(fmName.toLowerCase())}`;

    try {
      // Step 1: Create FUGR
      try {
        await createObject(
          client.http,
          client.safety,
          '/sap/bc/adt/functions/groups',
          fugrCreateBody(fugrName, '$TMP', 'ARC-1 FUGR integration test'),
          CT_FUGR,
        );
        registry.register(fugrUrl, 'FUGR', fugrName);
      } catch (err) {
        const skip = fmSkipReason(err);
        if (skip) {
          ctx.skip();
          return;
        }
        throw err;
      }

      // Step 2: Create FM
      try {
        await createObject(
          client.http,
          client.safety,
          `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}/fmodules`,
          fmCreateBody(fmName, fugrName, 'ARC-1 FM integration test'),
          CT_FUNC,
        );
        registry.register(fmUrl, 'FUNC', fmName);
      } catch (err) {
        const skip = fmSkipReason(err);
        if (skip) {
          ctx.skip();
          return;
        }
        throw err;
      }

      // Step 3: Verify FM source readable (default stub)
      const stub = await client.getFunction(fugrName, fmName, { version: 'inactive' });
      expect(stub.source).toMatch(/FUNCTION\s+/i);
      expect(stub.source).toMatch(/ENDFUNCTION\./i);

      // Step 4: Update FM source — lock → PUT (clean source, no parameter comment block) → unlock
      const newSource = `FUNCTION ${fmName.toLowerCase()}.\n  WRITE / 'Hello from ARC-1 integration test'.\nENDFUNCTION.\n`;
      try {
        await safeUpdateSource(client.http, client.safety, fmUrl, `${fmUrl}/source/main`, newSource);
      } catch (err) {
        const skip = fmSkipReason(err);
        if (skip) {
          ctx.skip();
          return;
        }
        throw err;
      }

      // Step 5: Activate the FM
      const activateResult = await activate(client.http, client.safety, fmUrl, { name: fmName });
      expect(activateResult.success).toBe(true);

      // Step 6: Verify the active source contains our update
      const active = await client.getFunction(fugrName, fmName);
      expect(active.source).toContain('Hello from ARC-1 integration test');
    } finally {
      // Cleanup is handled by registry/cleanupAll in afterAll
    }
  });

  it('rejects FM creation when parent FUGR does not exist', async (ctx) => {
    const fakeGroup = generateUniqueName('ZARC1NOEX');
    const fmName = generateUniqueName('ZFM');

    try {
      await createObject(
        client.http,
        client.safety,
        `/sap/bc/adt/functions/groups/${encodeURIComponent(fakeGroup.toLowerCase())}/fmodules`,
        fmCreateBody(fmName, fakeGroup, 'orphan FM'),
        CT_FUNC,
      );
      // If we got here, the FUGR magically exists — clean up and fail
      const orphanUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fakeGroup.toLowerCase())}/fmodules/${encodeURIComponent(fmName.toLowerCase())}`;
      registry.register(orphanUrl, 'FUNC', fmName);
      throw new Error('Expected FM creation to fail with non-existent parent FUGR');
    } catch (err) {
      const skip = fmSkipReason(err);
      if (skip) {
        ctx.skip();
        return;
      }
      // SAP returns HTTP 500 + ExceptionResourceCreationFailure: "Function group X does not exist"
      expectSapFailureClass(err, [500, 400, 404], [/function group .* (does not exist|unknown|not found)/i]);
    }
  });

  it('rejects FM source PUT containing parameter comment blocks (FUNC_ADT028)', async (ctx) => {
    const fugrName = generateUniqueName('ZARC1PFG');
    const fmName = generateUniqueName('ZARC1PFM');
    const fugrUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}`;
    const fmUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}/fmodules/${encodeURIComponent(fmName.toLowerCase())}`;

    // Setup: create FUGR + FM
    try {
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/functions/groups',
        fugrCreateBody(fugrName, '$TMP', 'ARC-1 param-block test'),
        CT_FUGR,
      );
      registry.register(fugrUrl, 'FUGR', fugrName);
    } catch (err) {
      const skip = fmSkipReason(err);
      if (skip) {
        ctx.skip();
        return;
      }
      throw err;
    }

    try {
      await createObject(
        client.http,
        client.safety,
        `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}/fmodules`,
        fmCreateBody(fmName, fugrName, 'ARC-1 param-block test'),
        CT_FUNC,
      );
      registry.register(fmUrl, 'FUNC', fmName);
    } catch (err) {
      const skip = fmSkipReason(err);
      if (skip) {
        ctx.skip();
        return;
      }
      throw err;
    }

    // Now try a PUT with a parameter comment block — must fail with FUNC_ADT028
    const sourceWithParamBlock = [
      `FUNCTION ${fmName.toLowerCase()}.`,
      '*"----------------------------------------------------------------------',
      '*"*"Local Interface:',
      '*"  IMPORTING',
      "*\"     VALUE(IV_NAME) TYPE STRING DEFAULT 'World'",
      '*"  EXPORTING',
      '*"     VALUE(EV_GREETING) TYPE STRING',
      '*"----------------------------------------------------------------------',
      '  ev_greeting = |Hello|.',
      'ENDFUNCTION.',
      '',
    ].join('\n');

    try {
      await safeUpdateSource(client.http, client.safety, fmUrl, `${fmUrl}/source/main`, sourceWithParamBlock);
      throw new Error('Expected SAP to reject parameter comment block with FUNC_ADT028');
    } catch (err) {
      const skip = fmSkipReason(err);
      if (skip) {
        ctx.skip();
        return;
      }
      // FUNC_ADT028 = "Parameter comment blocks are not allowed"
      expectSapFailureClass(err, [400], [/parameter comment block.*not allowed/i]);
    }
  });
});
