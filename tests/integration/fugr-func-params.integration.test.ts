/**
 * Integration test for FUNC structured-parameter lifecycle (issue #252).
 *
 * Exercises the verified live ADT recipe: parameters live INSIDE /source/main as
 * ABAP source-based signature syntax. The ARC-1 generator builds the
 * IMPORTING/EXPORTING/CHANGING/TABLES/EXCEPTIONS/RAISING clause from a structured
 * array; the parser reads it back. End-to-end:
 *
 *   create FUGR → create FM with parameters → activate → SAPRead includeSignature
 *   → assert structured signature → update with new parameters → re-activate →
 *   re-read → assert delta persisted → delete.
 *
 * NPL 7.50 lock-handle 423 issues skip the lifecycle test (not BAPI read).
 *
 * Run: npm run test:integration -- fugr-func-params.integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { handleToolCall, type ToolResult } from '../../src/handlers/intent.js';
import type { ServerConfig } from '../../src/server/types.js';
import { SkipReason } from '../helpers/skip-policy.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

function fmSkipReason(err: unknown): string | null {
  if (!(err instanceof AdtApiError)) return null;
  if (err.statusCode === 423) {
    return `${SkipReason.BACKEND_UNSUPPORTED}: lock-handle session correlation differs on this release (NPL 7.50 ADT gap)`;
  }
  return null;
}

/** Extract the text payload from a tool result. */
function toolResultText(result: { content: { text?: string }[]; isError?: boolean }): string {
  return result.content?.[0]?.text ?? '';
}

describe('FUNC parameter lifecycle (issue #252)', () => {
  let client: AdtClient;
  let config: ServerConfig;
  const registry = new CrudRegistry();

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
    config = {
      systemType: 'onprem',
      toolMode: 'standard',
      lintBeforeWrite: false,
      checkBeforeWrite: false,
    } as ServerConfig;
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    if (report.failed.length > 0) {
      // best-effort-cleanup
      console.error('FUNC params cleanup failures:', report.failed);
    }
  }, 60_000);

  it('FUGR + FUNC parameter create → activate → read → update → activate → read', async (ctx) => {
    const fugrName = generateUniqueName('ZARC1XPF');
    const fmName = generateUniqueName('ZARC1XPM');
    const fugrUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}`;
    const fmUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(fugrName.toLowerCase())}/fmodules/${encodeURIComponent(fmName.toLowerCase())}`;

    try {
      // Step 1: Create FUGR via the ARC-1 handler (mirrors what an LLM would do).
      const fugrResult = await handleToolCall(client, config, 'SAPWrite', {
        action: 'create',
        type: 'FUGR',
        name: fugrName,
        package: '$TMP',
        description: 'ARC-1 FUNC params integration test',
      });
      if (fugrResult.isError) {
        const msg = toolResultText(fugrResult);
        if (/lock|423/i.test(msg)) {
          ctx.skip();
          return;
        }
        throw new Error(`FUGR create failed: ${msg}`);
      }
      registry.register(fugrUrl, 'FUGR', fugrName);

      // Step 2: Create FM with structured parameters.
      const initialParams = [
        { kind: 'importing' as const, name: 'IV_INPUT', type: 'STRING', byValue: true },
        { kind: 'exporting' as const, name: 'EV_OUTPUT', type: 'STRING', byValue: true },
      ];
      let fmCreateResult: ToolResult;
      try {
        fmCreateResult = await handleToolCall(client, config, 'SAPWrite', {
          action: 'create',
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          description: 'ARC-1 FM with params',
          parameters: initialParams,
          source: '  ev_output = iv_input.\n',
        });
      } catch (err) {
        const skip = fmSkipReason(err);
        if (skip) {
          ctx.skip();
          return;
        }
        throw err;
      }
      if (fmCreateResult.isError) {
        const msg = toolResultText(fmCreateResult);
        if (/lock|423/i.test(msg)) {
          ctx.skip();
          return;
        }
        throw new Error(`FM create failed: ${msg}`);
      }
      registry.register(fmUrl, 'FUNC', fmName);

      // Step 3: Activate the FM.
      const activateResult = await handleToolCall(client, config, 'SAPActivate', {
        type: 'FUNC',
        name: fmName,
        group: fugrName,
      });
      if (activateResult.isError) {
        const msg = toolResultText(activateResult);
        if (/lock|423/i.test(msg)) {
          ctx.skip();
          return;
        }
        throw new Error(`Activate failed: ${msg}`);
      }

      // Step 4: Read with includeSignature → assert structured signature.
      const readResult = await handleToolCall(client, config, 'SAPRead', {
        type: 'FUNC',
        name: fmName,
        group: fugrName,
        includeSignature: true,
      });
      expect(readResult.isError).not.toBe(true);
      const readPayload = JSON.parse(toolResultText(readResult)) as {
        source: string;
        signature: { importing: { name: string }[]; exporting: { name: string }[] };
      };
      expect(readPayload.signature.importing[0]?.name).toBe('IV_INPUT');
      expect(readPayload.signature.exporting[0]?.name).toBe('EV_OUTPUT');
      expect(readPayload.source.toLowerCase()).toContain('ev_output = iv_input');

      // Step 5: Update with extra parameters (CHANGING + TABLES + RAISING).
      const updatedParams = [
        ...initialParams,
        { kind: 'changing' as const, name: 'CV_FLAG', type: 'I' },
        { kind: 'tables' as const, name: 'IT_LINES', type: 'TYPE STANDARD TABLE' },
        { kind: 'raising' as const, name: 'CX_ROOT' },
      ];
      let updateResult: ToolResult;
      try {
        updateResult = await handleToolCall(client, config, 'SAPWrite', {
          action: 'update',
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          parameters: updatedParams,
          source: '  ev_output = iv_input.\n  cv_flag = cv_flag + 1.\n',
        });
      } catch (err) {
        const skip = fmSkipReason(err);
        if (skip) {
          ctx.skip();
          return;
        }
        throw err;
      }
      if (updateResult.isError) {
        const msg = toolResultText(updateResult);
        if (/lock|423/i.test(msg)) {
          ctx.skip();
          return;
        }
        throw new Error(`FM update failed: ${msg}`);
      }

      // Step 6: Activate again.
      const activate2 = await handleToolCall(client, config, 'SAPActivate', {
        type: 'FUNC',
        name: fmName,
        group: fugrName,
      });
      if (activate2.isError) {
        const msg = toolResultText(activate2);
        if (/lock|423/i.test(msg)) {
          ctx.skip();
          return;
        }
        throw new Error(`Activate (after update) failed: ${msg}`);
      }

      // Step 7: Re-read with includeSignature → assert all four parameter kinds.
      const reread = await handleToolCall(client, config, 'SAPRead', {
        type: 'FUNC',
        name: fmName,
        group: fugrName,
        includeSignature: true,
      });
      expect(reread.isError).not.toBe(true);
      const reReadPayload = JSON.parse(toolResultText(reread)) as {
        signature: {
          importing: { name: string }[];
          exporting: { name: string }[];
          changing: { name: string }[];
          tables: { name: string }[];
          raising: { name: string }[];
        };
      };
      expect(reReadPayload.signature.importing.map((p) => p.name)).toContain('IV_INPUT');
      expect(reReadPayload.signature.exporting.map((p) => p.name)).toContain('EV_OUTPUT');
      expect(reReadPayload.signature.changing.map((p) => p.name)).toContain('CV_FLAG');
      expect(reReadPayload.signature.tables.map((p) => p.name)).toContain('IT_LINES');
      expect(reReadPayload.signature.raising.map((p) => p.name)).toContain('CX_ROOT');
    } finally {
      // Cleanup is handled by registry/cleanupAll in afterAll.
    }
  }, 120_000);

  it('SAPRead includeSignature on existing released FM (BAPI_USER_GETLIST)', async () => {
    // Read-only test — exercises the parser on real SAP-emitted source.
    // Works on every release that ships BAPI_USER_GETLIST (any AS ABAP since 6.20).
    const result = await handleToolCall(client, config, 'SAPRead', {
      type: 'FUNC',
      name: 'BAPI_USER_GETLIST',
      group: 'SU_USER',
      includeSignature: true,
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(toolResultText(result)) as {
      source: string;
      signature: {
        importing: { name: string; default?: string }[];
        exporting: { name: string }[];
        tables: { name: string }[];
      };
    };
    // BAPI_USER_GETLIST has 2 importing (max_rows, with_username), 1 exporting (rows), 4 tables.
    expect(payload.signature.importing.length).toBeGreaterThanOrEqual(1);
    expect(payload.signature.exporting.length).toBeGreaterThanOrEqual(1);
    expect(payload.signature.tables.length).toBeGreaterThanOrEqual(1);
    // At least one importing parameter has a DEFAULT clause (max_rows DEFAULT 0).
    const hasDefault = payload.signature.importing.some((p) => p.default !== undefined && p.default.length > 0);
    expect(hasDefault).toBe(true);
  });
});
