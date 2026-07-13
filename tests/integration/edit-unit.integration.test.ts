/** Live create → edit_unit → activate → read-back coverage for issue #558. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('edit_unit — live (issue #558)', () => {
  const client = getTestClient();
  const programName = generateUniqueName('ZARC1_EUNIT_P');
  const includeName = generateUniqueName('ZARC1_EUNIT_I');
  const created: Array<{ type: 'PROG' | 'INCL'; name: string }> = [];

  beforeAll(() => requireSapCredentials());

  afterAll(async () => {
    for (const object of created.reverse()) {
      try {
        await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', ...object });
      } catch {
        // best-effort-cleanup
      }
    }
  });

  async function expectSuccess(result: Awaited<ReturnType<typeof handleToolCall>>, label: string): Promise<void> {
    if (result.isError) throw new Error(`${label}: ${result.content[0]?.text ?? '(no detail)'}`);
    expect(result.isError).toBeUndefined();
  }

  it('surgically edits a FORM in PROG and a MODULE in INCL', async () => {
    const programCreate = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: programName,
      package: '$TMP',
      description: 'ARC-1 edit_unit integration test',
    });
    await expectSuccess(programCreate, 'create PROG');
    created.push({ type: 'PROG', name: programName });

    const programSource = `REPORT ${programName.toLowerCase()}.

FORM alpha.
  WRITE 'alpha unchanged'.
ENDFORM.

FORM beta.
  WRITE 'beta old'.
ENDFORM.

START-OF-SELECTION.
  PERFORM alpha.
  PERFORM beta.`;
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name: programName,
        source: programSource,
        lintBeforeWrite: false,
      }),
      'seed PROG source',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'PROG', name: programName }),
      'activate seeded PROG',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'PROG',
        name: programName,
        unit: 'BETA',
        source: "FORM beta.\n  WRITE 'beta changed'.\nENDFORM.",
        lintBeforeWrite: false,
      }),
      'edit PROG FORM',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'PROG', name: programName }),
      'activate edited PROG',
    );
    const programRead = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: programName,
    });
    await expectSuccess(programRead, 'read edited PROG');
    expect(programRead.content[0]?.text).toContain("WRITE 'beta changed'.");
    expect(programRead.content[0]?.text).toContain("WRITE 'alpha unchanged'.");
    expect(programRead.content[0]?.text).not.toContain("WRITE 'beta old'.");

    const includeCreate = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'INCL',
      name: includeName,
      package: '$TMP',
      description: 'ARC-1 edit_unit include test',
    });
    await expectSuccess(includeCreate, 'create INCL');
    created.push({ type: 'INCL', name: includeName });
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: includeName,
        source: "MODULE status_0100 OUTPUT.\n  SET PF-STATUS 'OLD'.\nENDMODULE.",
        lintBeforeWrite: false,
      }),
      'seed INCL source',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'INCL', name: includeName }),
      'activate seeded INCL',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'INCL',
        name: includeName,
        unit: 'status_0100',
        source: "MODULE status_0100 OUTPUT.\n  SET PF-STATUS 'NEW'.\nENDMODULE.",
        lintBeforeWrite: false,
      }),
      'edit INCL MODULE',
    );
    await expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'INCL', name: includeName }),
      'activate edited INCL',
    );
    const includeRead = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: includeName,
    });
    await expectSuccess(includeRead, 'read edited INCL');
    expect(includeRead.content[0]?.text).toContain("SET PF-STATUS 'NEW'.");
    expect(includeRead.content[0]?.text).not.toContain("SET PF-STATUS 'OLD'.");
  }, 120_000);
});
