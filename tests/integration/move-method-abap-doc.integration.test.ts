import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isNotFoundError } from '../../src/adt/errors.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { ToolResult } from '../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('moving method ABAP Doc — live (#1048)', () => {
  const name = generateUniqueName('ZARC1_MOVEDOC');
  let client: ReturnType<typeof getTestClient>;
  let created = false;
  const block = '    "! Documentation for run\n    "! @parameter iv_a | Input\n    METHODS run IMPORTING iv_a TYPE i.';
  const initial = `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
${block}
    METHODS sibling.
  PRIVATE SECTION.
ENDCLASS.

CLASS ${name.toLowerCase()} IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
  METHOD sibling.
  ENDMETHOD.
ENDCLASS.`;

  function expectSuccess(result: ToolResult): void {
    expect(result.isError, result.content[0]?.text).toBeUndefined();
  }

  beforeAll(async () => {
    client = getTestClient();
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name,
        description: 'Method documentation move (transient)',
        package: '$TMP',
      }),
    );
    created = true;
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name,
        source: initial,
        lintBeforeWrite: false,
      }),
    );
    expectSuccess(await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { objects: [{ type: 'CLAS', name }] }));
  });

  afterAll(async () => {
    if (!created) return;
    expectSuccess(await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type: 'CLAS', name }));
    await expect(client.getClass(name, undefined, { version: 'active' })).rejects.toSatisfy(isNotFoundError);
  });

  it('moves documentation with its method downward and upward, preserving sibling and bodies', async () => {
    for (const visibility of ['private', 'public'] as const) {
      const before = (await client.getClass(name, undefined, { version: 'active' })).source.replaceAll('\r\n', '\n');
      const anchor = visibility === 'private' ? '  PRIVATE SECTION.' : '    METHODS sibling.';
      const expected = before.replace(`${block}\n`, '').replace(anchor, `${anchor}\n${block}`);
      expectSuccess(
        await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
          action: 'change_method_visibility',
          type: 'CLAS',
          name,
          method: 'run',
          visibility,
        }),
      );
      const draft = (await client.getClass(name, undefined, { version: 'inactive' })).source.replaceAll('\r\n', '\n');
      expect(draft).toBe(expected);
      expectSuccess(await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { objects: [{ type: 'CLAS', name }] }));
      const active = (await client.getClass(name, undefined, { version: 'active' })).source.replaceAll('\r\n', '\n');
      expect(active).toBe(expected);
    }
  });
});
