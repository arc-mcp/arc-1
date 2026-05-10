/**
 * E2E test for FUNC structured-parameter lifecycle (issue #252).
 *
 * Exercises SAPWrite create/update with structured parameters and SAPRead with
 * includeSignature through the full MCP JSON-RPC stack against a real SAP system.
 *
 * Objects are transient: created with unique names and deleted in finally blocks.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

function uniqueName(prefix: string): string {
  const toLetters = (n: number): string => {
    let s = '';
    let v = n;
    while (v > 0) {
      s = String.fromCharCode(65 + (v % 26)) + s;
      v = Math.floor(v / 26);
    }
    return s || 'A';
  };
  const suffix = `${toLetters(Date.now())}${toLetters(Math.floor(Math.random() * 1e6))}`;
  return `${prefix}${suffix}`.slice(0, 30);
}

async function bestEffortDeleteFm(client: Client, group: string, name: string): Promise<void> {
  try {
    await callTool(client, 'SAPWrite', { action: 'delete', type: 'FUNC', name, group });
  } catch {
    // best-effort-cleanup
  }
}

async function bestEffortDeleteFugr(client: Client, name: string): Promise<void> {
  try {
    await callTool(client, 'SAPWrite', { action: 'delete', type: 'FUGR', name });
  } catch {
    // best-effort-cleanup
  }
}

describe('E2E FUNC structured-parameter lifecycle (issue #252)', () => {
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

  it('SAPWrite FUNC with structured parameters round-trips through MCP', async (ctx) => {
    const fugrName = uniqueName('ZARC1EP');
    const fmName = uniqueName('ZARC1EM');

    const createFugr = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: fugrName,
      package: '$TMP',
      description: 'ARC-1 E2E param FUGR',
    });
    expectToolSuccessOrSkip(ctx, createFugr);

    try {
      // Create FM with structured parameters.
      const createFm = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: fmName,
        group: fugrName,
        description: 'ARC-1 E2E param FM',
        parameters: [
          { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true },
          { kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true },
        ],
        source: '  ev_output = iv_input.\n',
      });
      expectToolSuccessOrSkip(ctx, createFm);

      try {
        // Activate.
        const activate = await callTool(client, 'SAPActivate', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
        });
        expectToolSuccessOrSkip(ctx, activate);

        // Read with includeSignature → assert structured signature.
        const read = await callTool(client, 'SAPRead', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          includeSignature: true,
        });
        const readText = expectToolSuccess(read);
        const readPayload = JSON.parse(readText) as {
          source: string;
          signature: { importing: { name: string }[]; exporting: { name: string }[] };
        };
        expect(readPayload.signature.importing[0]?.name).toBe('IV_INPUT');
        expect(readPayload.signature.exporting[0]?.name).toBe('EV_OUTPUT');

        // Update — add CHANGING parameter.
        const update = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          parameters: [
            { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true },
            { kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true },
            { kind: 'changing', name: 'CV_FLAG', type: 'I' },
          ],
          source: '  ev_output = iv_input.\n  cv_flag = cv_flag + 1.\n',
        });
        expectToolSuccessOrSkip(ctx, update);

        // Activate again.
        const activate2 = await callTool(client, 'SAPActivate', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
        });
        expectToolSuccessOrSkip(ctx, activate2);

        // Re-read → assert CHANGING was added.
        const reread = await callTool(client, 'SAPRead', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          includeSignature: true,
        });
        const rereadText = expectToolSuccess(reread);
        const rereadPayload = JSON.parse(rereadText) as {
          signature: { changing: { name: string }[] };
        };
        expect(rereadPayload.signature.changing[0]?.name).toBe('CV_FLAG');
      } finally {
        await bestEffortDeleteFm(client, fugrName, fmName);
      }
    } finally {
      await bestEffortDeleteFugr(client, fugrName);
    }
  });

  it('SAPWrite FUNC with malformed parameters returns schema error', async () => {
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name: uniqueName('ZBAD'),
      group: 'ZARC1NX_NONEXIST',
      description: 'malformed params',
      // Missing required `name` field on the parameter.
      parameters: [{ kind: 'importing', type: 'STRING' }],
    });
    expectToolError(result);
  });
});
