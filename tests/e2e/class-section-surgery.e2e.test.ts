/**
 * E2E tests for class-section surgery (issue #303).
 *
 * Exercises each of the four new SAPWrite actions through the MCP JSON-RPC
 * stack against a running MCP server (E2E_MCP_URL → live SAP).
 *
 * Each test creates a transient ZCL_ARC1_E303_<unique> class, runs one
 * action, and cleans up in finally{}. No persistent E2E fixture — too much
 * state for too little leverage.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip, uniqueName } from './helpers.js';

const PROBE_V1 = (name: string) => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.

CLASS ${name.toLowerCase()} IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

  METHOD goodbye.
    result = 'Goodbye!'.
  ENDMETHOD.

ENDCLASS.`;

async function seed(client: Client, ctx: import('vitest').TestContext, className: string): Promise<boolean> {
  const create = await callTool(client, 'SAPWrite', {
    action: 'create',
    type: 'CLAS',
    name: className,
    description: 'issue #303 e2e (transient)',
    package: '$TMP',
  });
  if (create.isError) {
    const detail = create.content[0]?.text ?? 'no error detail returned';
    skipTest(ctx, `Cannot seed transient class ${className}: ${detail.slice(0, 200)}`);
    return false;
  }
  const write = await callTool(client, 'SAPWrite', {
    action: 'update',
    type: 'CLAS',
    name: className,
    source: PROBE_V1(className),
    lintBeforeWrite: false,
  });
  expectToolSuccessOrSkip(ctx, write);
  const activate = await callTool(client, 'SAPActivate', { objects: [{ type: 'CLAS', name: className }] });
  expectToolSuccessOrSkip(ctx, activate);
  return true;
}

async function cleanup(client: Client, className: string): Promise<void> {
  try {
    await callTool(client, 'SAPWrite', { action: 'delete', type: 'CLAS', name: className });
  } catch {
    // best-effort-cleanup
  }
}

describe('E2E class-section surgery (issue #303)', () => {
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

  it('edit_class_definition: happy path (drop FINAL)', async (ctx) => {
    const name = uniqueName('ZCL_ARC1_E303A');
    const ok = await seed(client, ctx, name);
    if (!ok) return;
    try {
      const newDef = `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
      const result = await callTool(client, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name,
        source: newDef,
        lintBeforeWrite: false,
      });
      expectToolSuccessOrSkip(ctx, result);
      const activate = await callTool(client, 'SAPActivate', { objects: [{ type: 'CLAS', name }] });
      expectToolSuccess(activate);
    } finally {
      await cleanup(client, name);
    }
  });

  it('add_method: inserts METHODS + stub atomically', async (ctx) => {
    const name = uniqueName('ZCL_ARC1_E303B');
    const ok = await seed(client, ctx, name);
    if (!ok) return;
    try {
      const result = await callTool(client, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name,
        method: '    METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.',
        visibility: 'public',
        lintBeforeWrite: false,
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      expect(text).toMatch(/added method.*GREET/i);
      const activate = await callTool(client, 'SAPActivate', { objects: [{ type: 'CLAS', name }] });
      expectToolSuccess(activate);
    } finally {
      await cleanup(client, name);
    }
  });

  it('edit_method_signature: appends DEFAULT param', async (ctx) => {
    const name = uniqueName('ZCL_ARC1_E303C');
    const ok = await seed(client, ctx, name);
    if (!ok) return;
    try {
      const newSig = `    METHODS hello
      IMPORTING name TYPE string
                greeting TYPE string DEFAULT 'Hi'
      RETURNING VALUE(result) TYPE string.`;
      const result = await callTool(client, 'SAPWrite', {
        action: 'edit_method_signature',
        type: 'CLAS',
        name,
        method: 'hello',
        source: newSig,
        lintBeforeWrite: false,
      });
      expectToolSuccessOrSkip(ctx, result);
      const activate = await callTool(client, 'SAPActivate', { objects: [{ type: 'CLAS', name }] });
      expectToolSuccess(activate);
    } finally {
      await cleanup(client, name);
    }
  });

  it('delete_method: removes both DEFINITION and IMPLEMENTATION ranges', async (ctx) => {
    const name = uniqueName('ZCL_ARC1_E303D');
    const ok = await seed(client, ctx, name);
    if (!ok) return;
    try {
      const result = await callTool(client, 'SAPWrite', {
        action: 'delete_method',
        type: 'CLAS',
        name,
        method: 'goodbye',
      });
      const text = expectToolSuccessOrSkip(ctx, result);
      expect(text).toMatch(/deleted method.*GOODBYE/i);
      const activate = await callTool(client, 'SAPActivate', { objects: [{ type: 'CLAS', name }] });
      expectToolSuccess(activate);
      const read = await callTool(client, 'SAPRead', { type: 'CLAS', name });
      const source = expectToolSuccess(read);
      expect(source).not.toMatch(/METHODS\s+goodbye/i);
      expect(source).toMatch(/METHODS\s+hello/i);
    } finally {
      await cleanup(client, name);
    }
  });

  it('edit_class_definition: refuse-policy returns a structured error pointing at add_method', async (ctx) => {
    const name = uniqueName('ZCL_ARC1_E303E');
    const ok = await seed(client, ctx, name);
    if (!ok) return;
    try {
      const badDef = `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
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
      const result = await callTool(client, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name,
        source: badDef,
        lintBeforeWrite: false,
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toMatch(/GREET/);
      expect(text).toMatch(/add_method/);
    } finally {
      await cleanup(client, name);
    }
  });
});
