/**
 * E2E tests for SAPRead grep (issue #313).
 *
 * Greps the persistent ZCL_ARC1_TEST fixture class through the MCP JSON-RPC
 * stack against a running MCP server (E2E_MCP_URL → live SAP). Asserts the
 * grep result is filtered (matches + line numbers), method-annotated, and
 * smaller than the full-source read. Uses the existing persistent fixture
 * (tests/e2e/fixtures.ts) — no transient object is created.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

const CLAS = 'ZCL_ARC1_TEST'; // persistent fixture: has method get_name with body `rv_name = mv_name.`

describe('SAPRead grep (e2e)', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('returns only matching lines and is smaller than the full source', async (ctx) => {
    const full = await callTool(client, 'SAPRead', { type: 'CLAS', name: CLAS });
    const fullText = expectToolSuccessOrSkip(ctx, full); // skips if the fixture is not present

    const grep = await callTool(client, 'SAPRead', { type: 'CLAS', name: CLAS, grep: 'mv_name' });
    const grepText = expectToolSuccess(grep);

    expect(grepText).toContain('match(es)');
    expect(grepText.toLowerCase()).toContain('mv_name');
    // token-efficiency: filtered output is strictly smaller than the whole class source
    expect(grepText.length).toBeLessThan(fullText.length);
  });

  it('annotates a class match with the owning method and section', async (ctx) => {
    const grep = await callTool(client, 'SAPRead', { type: 'CLAS', name: CLAS, grep: 'mv_name' });
    const text = expectToolSuccessOrSkip(ctx, grep);
    expect(text).toContain('section=main');
    // `mv_name` is read inside METHOD get_name → annotated with that owning method
    expect(text).toMatch(/=>\s*get_name/i);
  });

  it('rejects grep combined with method (find first, then read)', async () => {
    // Short-circuits in the handler before any fetch, so it does not depend on the fixture.
    const result = await callTool(client, 'SAPRead', {
      type: 'CLAS',
      name: CLAS,
      grep: 'mv_name',
      method: 'get_name',
    });
    expect(result.isError).toBe(true);
    expect(String(result.content?.[0]?.text ?? '')).toContain('Do not combine grep with method');
  });
});
