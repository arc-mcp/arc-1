/**
 * Integration tests for class-section surgery (issue #303).
 *
 * Exercises all four new SAPWrite actions against a live SAP system:
 *   - edit_class_definition (happy path + refuse-policy)
 *   - add_method
 *   - edit_method_signature
 *   - delete_method
 *
 * Creates a transient `ZCL_ARC1_CSURG_*` class in $TMP and cleans up in
 * `afterAll`. Hard-fails when `TEST_SAP_URL` is not set; individual cases
 * skip-with-reason if seeding fails (e.g., NPL 7.50 lock-handle bug, SAP
 * Note 2727890 — pre-existing, not specific to this feature).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleToolCall } from '../../src/handlers/intent.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const cfg = DEFAULT_CONFIG;

describe('class-section surgery — live (issue #303)', () => {
  let client: ReturnType<typeof getTestClient>;
  const className = generateUniqueName('ZCL_ARC1_CSURG');
  let seeded = false;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    // Seed: create + write v1 + activate. If the seed fails (lock-handle 423 on
    // NPL etc.), individual tests still skip with a clear reason rather than
    // crashing.
    try {
      const create = await handleToolCall(client, cfg, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: className,
        description: 'class-section surgery test (transient)',
        package: '$TMP',
      });
      if (create.isError) {
        throw new Error(`create failed: ${create.content[0]?.text ?? '(no detail)'}`);
      }

      const v1 = `CLASS ${className.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.

CLASS ${className.toLowerCase()} IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

  METHOD goodbye.
    result = 'Goodbye!'.
  ENDMETHOD.

ENDCLASS.`;

      const write = await handleToolCall(client, cfg, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: className,
        source: v1,
        lintBeforeWrite: false,
      });
      if (write.isError) {
        throw new Error(`update failed: ${write.content[0]?.text ?? '(no detail)'}`);
      }

      const activate = await handleToolCall(client, cfg, 'SAPActivate', {
        objects: [{ type: 'CLAS', name: className }],
      });
      if (activate.isError) {
        throw new Error(`activate failed: ${activate.content[0]?.text ?? '(no detail)'}`);
      }
      seeded = true;
    } catch (err) {
      // NPL 7.50 lock-handle 423 bug (SAP Note 2727890) is the most common
      // seed failure on the trial image. Classify with the standard helper so
      // the suite reports the cause rather than just timing out.
      try {
        expectSapFailureClass(err, [423], [/invalid lock handle/i]);
      } catch {
        // Different failure — surface it as test setup error.
        throw err;
      }
    }
  });

  afterAll(async () => {
    if (!seeded) return;
    try {
      await handleToolCall(client, cfg, 'SAPWrite', {
        action: 'delete',
        type: 'CLAS',
        name: className,
      });
    } catch {
      // best-effort-cleanup; transient $TMP class will be garbage-collected.
    }
  });

  it('edit_class_definition: drop FINAL (no method-set change)', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    const newDef = `CLASS ${className.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'edit_class_definition',
      type: 'CLAS',
      name: className,
      source: newDef,
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const activate = await handleToolCall(client, cfg, 'SAPActivate', {
      objects: [{ type: 'CLAS', name: className }],
    });
    expect(activate.isError).toBeUndefined();
  });

  it('edit_class_definition: refuses added method without IMPL stub', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    const badDef = `CLASS ${className.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
    METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'edit_class_definition',
      type: 'CLAS',
      name: className,
      source: badDef,
      lintBeforeWrite: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/GREET/);
    expect(result.content[0]?.text).toMatch(/add_method|missing/i);
  });

  it('add_method: inserts METHOD + stub atomically and activates', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'add_method',
      type: 'CLAS',
      name: className,
      method: '    METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.',
      visibility: 'public',
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/added method.*GREET/i);
    const activate = await handleToolCall(client, cfg, 'SAPActivate', {
      objects: [{ type: 'CLAS', name: className }],
    });
    expect(activate.isError).toBeUndefined();
  });

  it('edit_method_signature: appends DEFAULT param and re-activates', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    const newSig = `    METHODS greet
      IMPORTING who TYPE string
                greeting TYPE string DEFAULT 'Hi'
      RETURNING VALUE(r) TYPE string.`;
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'edit_method_signature',
      type: 'CLAS',
      name: className,
      method: 'greet',
      source: newSig,
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const activate = await handleToolCall(client, cfg, 'SAPActivate', {
      objects: [{ type: 'CLAS', name: className }],
    });
    expect(activate.isError).toBeUndefined();
  });

  it('delete_method: removes DEFINITION + IMPLEMENTATION ranges atomically', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'delete_method',
      type: 'CLAS',
      name: className,
      method: 'greet',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/deleted method.*GREET/i);
    const activate = await handleToolCall(client, cfg, 'SAPActivate', {
      objects: [{ type: 'CLAS', name: className }],
    });
    expect(activate.isError).toBeUndefined();

    // Read back: GREET should be gone from both halves.
    const read = await handleToolCall(client, cfg, 'SAPRead', {
      type: 'CLAS',
      name: className,
    });
    expect(read.isError).toBeUndefined();
    const text = read.content[0]?.text ?? '';
    expect(text).not.toMatch(/METHODS\s+greet/i);
    expect(text).not.toMatch(/^\s*METHOD\s+greet\s*\./im);
    // Other methods still present.
    expect(text).toMatch(/METHODS\s+hello/i);
    expect(text).toMatch(/METHODS\s+goodbye/i);
  });

  it('change_method_visibility: moves a method between sections, preserving the body', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    // The seeded `hello` is public and has a real body (`result = |Hello, { name }!|.`).
    // Move it to PRIVATE — the body must survive (this is the safe alternative to
    // delete_method + add_method, which would wipe it).
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'change_method_visibility',
      type: 'CLAS',
      name: className,
      method: 'hello',
      visibility: 'private',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/moved method.*HELLO/i);
    expect(result.content[0]?.text).toMatch(/IMPLEMENTATION preserved/i);

    const activate = await handleToolCall(client, cfg, 'SAPActivate', {
      objects: [{ type: 'CLAS', name: className }],
    });
    expect(activate.isError).toBeUndefined();

    // Read back: hello declaration now under PRIVATE SECTION, and the body survives.
    const read = await handleToolCall(client, cfg, 'SAPRead', { type: 'CLAS', name: className });
    expect(read.isError).toBeUndefined();
    const text = read.content[0]?.text ?? '';
    const privIdx = text.search(/PRIVATE SECTION/i);
    const helloDeclIdx = text.search(/METHODS\s+hello/i);
    expect(privIdx).toBeGreaterThan(-1);
    expect(helloDeclIdx).toBeGreaterThan(privIdx);
    // Body preserved — the whole point of change_method_visibility.
    expect(text).toContain('result = |Hello, { name }!|.');
  });

  it('change_method_visibility: idempotent no-op when already in the target section', async (ctx) => {
    if (!seeded) {
      ctx.skip();
      return;
    }
    // goodbye is still public; asking for public must be a no-op (no write).
    const result = await handleToolCall(client, cfg, 'SAPWrite', {
      action: 'change_method_visibility',
      type: 'CLAS',
      name: className,
      method: 'goodbye',
      visibility: 'public',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/already in the PUBLIC SECTION/i);
  });
});
