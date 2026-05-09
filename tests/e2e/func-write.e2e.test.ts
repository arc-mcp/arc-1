/**
 * E2E Tests for Function-Module + Function-Group Write Lifecycle (issue #250).
 *
 * Exercises SAPWrite create/update/delete for FUGR + FUNC through the full
 * MCP JSON-RPC stack against a real SAP system.
 *
 * Objects are transient: created with unique names and deleted in finally blocks.
 * Cleanup is best-effort to avoid masking test failures.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

/** Generate a collision-safe unique name (letters-only suffix). */
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

/** Best-effort delete helper — for FUNC requires `group`. */
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

describe('E2E FUGR + FUNC write lifecycle', () => {
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

  it('SAPWrite creates FUGR, creates FM, updates source, activates, deletes', async (ctx) => {
    const fugrName = uniqueName('ZARC1FG');
    const fmName = uniqueName('ZARC1FM');

    // Step 1: Create FUGR
    const createFugrResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: fugrName,
      package: '$TMP',
      description: 'ARC-1 E2E FUGR',
    });
    expectToolSuccessOrSkip(ctx, createFugrResult);

    try {
      // Step 2: Create FM
      const createFmResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: fmName,
        group: fugrName,
        description: 'ARC-1 E2E FM',
      });
      expectToolSuccessOrSkip(ctx, createFmResult);

      try {
        // Step 3: Read FM source (should return canonical stub)
        const readResult = await callTool(client, 'SAPRead', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          version: 'inactive',
        });
        const readText = expectToolSuccess(readResult);
        expect(readText.toUpperCase()).toContain('FUNCTION');
        expect(readText.toUpperCase()).toContain('ENDFUNCTION');

        // Step 4: Update FM source — clean source (no parameter comment block)
        const newSource = `FUNCTION ${fmName.toLowerCase()}.\n  WRITE / 'Hello from ARC-1 E2E'.\nENDFUNCTION.\n`;
        const updateResult = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          source: newSource,
        });
        expectToolSuccess(updateResult);

        // Step 5: Activate
        const activateResult = await callTool(client, 'SAPActivate', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
        });
        expectToolSuccessOrSkip(ctx, activateResult);

        // Step 6: Verify the active source contains our update
        const readActiveResult = await callTool(client, 'SAPRead', {
          type: 'FUNC',
          name: fmName,
          group: fugrName,
        });
        const activeText = expectToolSuccess(readActiveResult);
        expect(activeText).toContain('Hello from ARC-1 E2E');
      } finally {
        await bestEffortDeleteFm(client, fugrName, fmName);
      }
    } finally {
      await bestEffortDeleteFugr(client, fugrName);
    }
  });

  it('SAPWrite FUNC create without group returns clear error', async () => {
    const fmName = uniqueName('ZARC1FM');
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name: fmName,
      description: 'no group provided',
    });
    expectToolError(result, 'group');
  });

  it('SAPWrite FUNC create with non-existent FUGR returns clear error', async () => {
    const fakeGroup = uniqueName('ZARC1NX');
    const fmName = uniqueName('ZFM');
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name: fmName,
      group: fakeGroup,
      description: 'orphan FM',
    });
    // Either the FUGR-doesn't-exist message bubbles up, OR a friendly handler error
    expectToolError(result);
  });

  it('SAPWrite FUNC update with parameter comment block strips and warns', async (ctx) => {
    const fugrName = uniqueName('ZARC1PFG');
    const fmName = uniqueName('ZARC1PFM');

    const createFugrResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: fugrName,
      package: '$TMP',
      description: 'ARC-1 param-strip test',
    });
    expectToolSuccessOrSkip(ctx, createFugrResult);

    try {
      const createFmResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: fmName,
        group: fugrName,
        description: 'param-strip test',
      });
      expectToolSuccessOrSkip(ctx, createFmResult);

      try {
        const sourceWithParamBlock = [
          `FUNCTION ${fmName.toLowerCase()}.`,
          '*"----------------------------------------------------------------------',
          '*"*"Local Interface:',
          '*"  IMPORTING',
          `*"     VALUE(IV_NAME) TYPE STRING DEFAULT 'World'`,
          '*"  EXPORTING',
          '*"     VALUE(EV_GREETING) TYPE STRING',
          '*"----------------------------------------------------------------------',
          `  WRITE / 'Hello'.`,
          'ENDFUNCTION.',
          '',
        ].join('\n');

        const updateResult = await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'FUNC',
          name: fmName,
          group: fugrName,
          source: sourceWithParamBlock,
        });
        const updateText = expectToolSuccess(updateResult);
        // Handler must strip the param-block and append a warning
        expect(updateText.toLowerCase()).toMatch(/parameter comment block|stripped/i);
      } finally {
        await bestEffortDeleteFm(client, fugrName, fmName);
      }
    } finally {
      await bestEffortDeleteFugr(client, fugrName);
    }
  });
});
