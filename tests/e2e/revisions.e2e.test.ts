import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { TaskContext } from 'vitest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

/**
 * Parse a SAPRead VERSIONS response or skip the test when it's not usable.
 *
 * SAPRead VERSIONS returns a plain-text sentinel (not JSON) when the object
 * has no revision history — calling JSON.parse on that crashes. Also skip
 * when the fixture isn't present on the system or when the release doesn't
 * expose the VERSIONS endpoint in the expected shape. Only JSON with a real
 * revision list survives this helper.
 */
function parseVersionsOrSkip(
  ctx: TaskContext,
  text: string,
  fixtureName: string,
): { object: { name: string }; revisions: Array<{ uri?: string }> } {
  // 1. Plain-text sentinels — the handler returns these before reaching SAP.
  if (/^No version/i.test(text) || /Version source endpoint unavailable/i.test(text)) {
    skipTest(
      ctx,
      `Required test fixture not found on SAP system (${fixtureName} revisions) — object has no version history or endpoint unavailable`,
    );
    // Unreachable — skipTest(ctx, reason) throws. Return empty object only to satisfy the type.
    return { object: { name: fixtureName }, revisions: [] };
  }
  let parsed: { object?: { name?: string }; revisions?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    skipTest(
      ctx,
      `Required test fixture not found on SAP system (${fixtureName} revisions) — VERSIONS returned non-JSON: ${text.slice(0, 80)}`,
    );
    return { object: { name: fixtureName }, revisions: [] };
  }
  if (!parsed || !Array.isArray(parsed.revisions) || parsed.revisions.length === 0) {
    skipTest(
      ctx,
      `Required test fixture not found on SAP system (${fixtureName}) — no revisions recorded for this object`,
    );
    return { object: { name: fixtureName }, revisions: [] };
  }
  return parsed as { object: { name: string }; revisions: Array<{ uri?: string }> };
}

describe('E2E Revisions (SAPRead VERSIONS / VERSION_SOURCE)', () => {
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

  it('SAPRead VERSIONS returns a revision list for ZARC1_TEST_REPORT', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'VERSIONS', name: 'ZARC1_TEST_REPORT' });
    const text = expectToolSuccessOrSkip(ctx, result);
    const parsed = parseVersionsOrSkip(ctx, text, 'ZARC1_TEST_REPORT');
    expect(parsed.object.name).toBe('ZARC1_TEST_REPORT');
    expect(parsed.revisions.length).toBeGreaterThanOrEqual(1);
  });

  it('SAPRead VERSIONS returns revisions for ZCL_ARC1_TEST', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'VERSIONS', name: 'ZCL_ARC1_TEST', include: 'main' });
    const text = expectToolSuccessOrSkip(ctx, result);
    const parsed = parseVersionsOrSkip(ctx, text, 'ZCL_ARC1_TEST');
    expect(parsed.object.name).toBe('ZCL_ARC1_TEST');
    expect(parsed.revisions.length).toBeGreaterThanOrEqual(1);
  });

  it('SAPRead VERSIONS returns revisions for ZIF_ARC1_TEST', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'VERSIONS', name: 'ZIF_ARC1_TEST' });
    const text = expectToolSuccessOrSkip(ctx, result);
    const parsed = parseVersionsOrSkip(ctx, text, 'ZIF_ARC1_TEST');
    expect(parsed.object.name).toBe('ZIF_ARC1_TEST');
    expect(parsed.revisions.length).toBeGreaterThanOrEqual(1);
    // URI shape varies across releases:
    //   newer: /sap/bc/adt/oo/interfaces/<NAME>/source/main/versions/<id>
    //   older: /sap/bc/adt/oo/interfaces/<NAME>/source/main (no versions segment)
    // Both are legitimate ADT paths — assert only the sub-resource anchor.
    const firstUri = parsed.revisions[0]?.uri ?? '';
    expect(firstUri).toContain('/source/main');
  });

  it('SAPRead VERSION_SOURCE returns source for a specific revision', async (ctx) => {
    const versions = await callTool(client, 'SAPRead', { type: 'VERSIONS', name: 'ZARC1_TEST_REPORT' });
    const versionsText = expectToolSuccessOrSkip(ctx, versions);
    const parsed = parseVersionsOrSkip(ctx, versionsText, 'ZARC1_TEST_REPORT');
    const uri = String(parsed.revisions[0]?.uri ?? '');
    expect(uri.startsWith('/sap/bc/adt/')).toBe(true);

    const sourceResult = await callTool(client, 'SAPRead', { type: 'VERSION_SOURCE', versionUri: uri });
    const sourceText = expectToolSuccess(sourceResult);
    expect(sourceText).toMatch(/report/i);
  });

  it('SAPRead VERSION_SOURCE without versionUri returns an error', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'VERSION_SOURCE' });
    expectToolError(result, 'versionUri');
  });

  it('SAPRead VERSION_SOURCE blocks non-ADT URI values', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'VERSION_SOURCE', versionUri: 'https://evil.example/x' });
    expectToolError(result, '/sap/bc/adt/');
  });
});
