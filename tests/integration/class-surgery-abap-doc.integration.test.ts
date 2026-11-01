import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isNotFoundError } from '../../src/adt/errors.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { ToolResult } from '../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

// A separate disposable class keeps these draft/activation checks independent
// of the stateful class-section-surgery suite.
describe('class surgery ABAP Doc — live (#1041)', () => {
  const name = generateUniqueName('ZARC1_DOC');
  let client: ReturnType<typeof getTestClient>;
  let created = false;
  const classDoc = '"! Original class documentation';
  const methodDoc = '    "! @parameter iv_a | Original parameter documentation';
  const definition = `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
${methodDoc}
    METHODS run IMPORTING iv_a TYPE i.
ENDCLASS.`;
  const initial = `${classDoc}
${definition}

CLASS ${name.toLowerCase()} IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
ENDCLASS.`;

  function expectSuccess(result: ToolResult): void {
    expect(result.isError, result.content[0]?.text).toBeUndefined();
  }

  beforeAll(async () => {
    client = getTestClient();
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'CLAS',
      name,
      description: 'ABAP Doc regression (transient)',
      package: '$TMP',
    });
    expectSuccess(result);
    created = true;
  });

  beforeEach(async () => {
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

  it.each([
    { action: 'edit_class_definition', replaceDoc: true },
    { action: 'edit_method_signature', replaceDoc: true },
    { action: 'edit_class_definition', replaceDoc: false },
    { action: 'edit_method_signature', replaceDoc: false },
  ])('$action replaces docs: $replaceDoc', async ({ action, replaceDoc }) => {
    const before = (await client.getClass(name, undefined, { version: 'active' })).source.replaceAll('\r\n', '\n');
    const oldDoc = action === 'edit_class_definition' ? classDoc : methodDoc;
    const newDoc = oldDoc.replace('Original', 'Updated');
    const clause = action === 'edit_class_definition' ? definition : '    METHODS run IMPORTING iv_a TYPE i.';
    const source = replaceDoc ? `${newDoc}\n${clause}` : clause;
    expectSuccess(
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action,
        type: 'CLAS',
        name,
        method: 'run',
        source,
        lintBeforeWrite: false,
      }),
    );
    const draft = (await client.getClass(name, undefined, { version: 'inactive' })).source.replaceAll('\r\n', '\n');
    expect(draft).toBe(replaceDoc ? before.replace(oldDoc, newDoc) : before);
    expectSuccess(await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { objects: [{ type: 'CLAS', name }] }));
    const active = (await client.getClass(name, undefined, { version: 'active' })).source.replaceAll('\r\n', '\n');
    expect(active).toBe(draft);
  });
});
