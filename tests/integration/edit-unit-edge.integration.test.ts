/** Cross-release live edge cases for SAPWrite edit_unit (issue #558). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { ToolResult } from '../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('edit_unit — live edge cases (issue #558)', () => {
  const client = getTestClient();
  const programName = generateUniqueName('ZARC1_EEDGE_P');
  const includeName = generateUniqueName('ZARC1_EEDGE_I');
  const functionGroup = generateUniqueName('ZARC1_EEDGE_FG');
  const topInclude = `L${functionGroup}TOP`;
  const created: Array<{ type: 'PROG' | 'INCL' | 'FUGR'; name: string }> = [];

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

  function expectSuccess(result: ToolResult, label: string): void {
    if (result.isError) throw new Error(`${label}: ${result.content[0]?.text ?? '(no detail)'}`);
    expect(result.isError).toBeUndefined();
  }

  function expectFailure(result: ToolResult, text: string): void {
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(text);
  }

  it('preserves a multiline FORM signature and chains two inactive PROG edits', async () => {
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: programName,
        package: '$TMP',
        description: 'ARC-1 edit_unit edge program',
      }),
      'create edge PROG',
    );
    created.push({ type: 'PROG', name: programName });

    const initialSource = `REPORT ${programName.toLowerCase()}.

FORM complex
  USING iv_value TYPE i
  CHANGING cv_result TYPE i.
  " ENDFORM. and FORM fake. inside a comment must not affect boundaries
  cv_result = iv_value * 2.
ENDFORM.

FORM sibling.
  WRITE 'sibling old'.
ENDFORM.

START-OF-SELECTION.
  DATA lv_result TYPE i.
  PERFORM complex USING 3 CHANGING lv_result.
  PERFORM sibling.`;
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name: programName,
        source: initialSource,
        lintBeforeWrite: false,
      }),
      'seed edge PROG',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'PROG', name: programName }),
      'activate edge PROG',
    );

    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'PROG',
        name: programName,
        unit: 'COMPLEX',
        source: `FORM complex
  USING iv_value TYPE i
  CHANGING cv_result TYPE i.
  " ENDFORM. remains harmless inside a comment
  cv_result = iv_value * 3.
ENDFORM.`,
        lintBeforeWrite: false,
      }),
      'edit multiline FORM',
    );
    // Deliberately do not activate: the second edit must splice into the first inactive draft.
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'PROG',
        name: programName,
        unit: 'sibling',
        source: "FORM sibling.\n  WRITE 'sibling changed'.\nENDFORM.",
        lintBeforeWrite: false,
      }),
      'chain second PROG edit',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'PROG', name: programName }),
      'activate chained PROG edits',
    );
    const read = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: programName });
    expectSuccess(read, 'read chained PROG edits');
    expect(read.content[0]?.text).toContain('cv_result = iv_value * 3.');
    expect(read.content[0]?.text).toContain("WRITE 'sibling changed'.");
    expect(read.content[0]?.text).toContain('START-OF-SELECTION.');

    expectFailure(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'PROG',
        name: programName,
        unit: 'START-OF-SELECTION',
        source: 'FORM injected.\nENDFORM.',
        lintBeforeWrite: false,
      }),
      'not found',
    );
    expectFailure(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'PROG',
        name: programName,
        unit: 'complex',
        source: 'FORM complex.\nENDFORM.\nFORM injected.\nENDFORM.',
        lintBeforeWrite: false,
      }),
      'exactly one complete FORM',
    );
  }, 120_000);

  it('chains case-insensitive MODULE and FORM edits in an inactive INCL draft', async () => {
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'INCL',
        name: includeName,
        package: '$TMP',
        description: 'ARC-1 edit_unit edge include',
      }),
      'create edge INCL',
    );
    created.push({ type: 'INCL', name: includeName });
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: includeName,
        source: `MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
ENDMODULE.

MODULE user_command_0100 INPUT.
  CHECK sy-ucomm IS NOT INITIAL.
ENDMODULE.

FORM helper.
  WRITE 'helper old'.
ENDFORM.`,
        lintBeforeWrite: false,
      }),
      'seed edge INCL',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'INCL', name: includeName }),
      'activate edge INCL',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'INCL',
        name: includeName,
        unit: 'USER_COMMAND_0100',
        source: `MODULE user_command_0100 INPUT.
  " ENDMODULE. inside a comment must not affect boundaries
  IF sy-ucomm = 'BACK'.
    LEAVE PROGRAM.
  ENDIF.
ENDMODULE.`,
        lintBeforeWrite: false,
      }),
      'edit INPUT MODULE',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'INCL',
        name: includeName,
        unit: 'HELPER',
        source: "FORM helper.\n  WRITE 'helper changed'.\nENDFORM.",
        lintBeforeWrite: false,
      }),
      'chain FORM edit in INCL',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { type: 'INCL', name: includeName }),
      'activate chained INCL edits',
    );
    const read = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'INCL', name: includeName });
    expectSuccess(read, 'read chained INCL edits');
    expect(read.content[0]?.text).toContain("IF sy-ucomm = 'BACK'.");
    expect(read.content[0]?.text).toContain("WRITE 'helper changed'.");
    expect(read.content[0]?.text).toContain("SET PF-STATUS 'MAIN'.");
  }, 120_000);

  it('chains two FORM edits in a function-group structural include', async () => {
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'FUGR',
        name: functionGroup,
        package: '$TMP',
        description: 'ARC-1 edit_unit edge function group',
      }),
      'create edge FUGR',
    );
    created.push({ type: 'FUGR', name: functionGroup });
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        group: functionGroup,
        name: topInclude,
        source: `FUNCTION-POOL ${functionGroup}.

FORM calculate USING iv_value TYPE i CHANGING cv_value TYPE i.
  cv_value = iv_value + 1.
ENDFORM.

FORM keep.
  WRITE 'keep old'.
ENDFORM.`,
        lintBeforeWrite: false,
      }),
      'seed FUGR TOP include',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
        type: 'INCL',
        name: topInclude,
        group: functionGroup,
      }),
      'activate seeded FUGR TOP include',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'INCL',
        group: functionGroup,
        name: topInclude,
        unit: 'calculate',
        source: 'FORM calculate USING iv_value TYPE i CHANGING cv_value TYPE i.\n  cv_value = iv_value + 2.\nENDFORM.',
        lintBeforeWrite: false,
      }),
      'edit FUGR FORM',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_unit',
        type: 'INCL',
        group: functionGroup,
        name: topInclude,
        unit: 'keep',
        source: "FORM keep.\n  WRITE 'keep changed'.\nENDFORM.",
        lintBeforeWrite: false,
      }),
      'chain second FUGR FORM edit',
    );
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
        type: 'INCL',
        name: topInclude,
        group: functionGroup,
      }),
      'activate chained FUGR TOP edits',
    );
    const includeUrl = `/sap/bc/adt/functions/groups/${functionGroup.toLowerCase()}/includes/${topInclude.toLowerCase()}/source/main`;
    const read = await client.http.get(includeUrl);
    expect(read.body).toContain('cv_value = iv_value + 2.');
    expect(read.body).toContain("WRITE 'keep changed'.");
  }, 120_000);
});
