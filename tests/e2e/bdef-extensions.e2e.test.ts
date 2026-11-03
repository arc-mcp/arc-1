/** Standard SAP example through the running MCP server; no fixture writes. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertBdefExtensions } from '../helpers/bdef-extension-assertions.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolSuccess } from './helpers.js';

describe('BDEF extensions through MCP', () => {
  let client: Client;
  let supported: true | undefined;
  beforeAll(async () => {
    client = await connectClient();
    const features = JSON.parse(expectToolSuccess(await callTool(client, 'SAPManage', { action: 'features' })));
    expect(features.abapRelease).toMatch(/^\d{3}$/);
    supported = Number(features.abapRelease) >= 758 ? true : undefined;
  });
  afterAll(async () => {
    await client?.close();
  });
  it('preserves the base across automatic, explicit and repeated reads', async (ctx) => {
    requireOrSkip(ctx, supported, SkipReason.BACKEND_UNSUPPORTED);
    const args = { type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE', version: 'active', force_refresh: true };
    const base = await callTool(client, 'SAPRead', { ...args, extensions: 'none' });
    for (const mode of [undefined, 'summary', 'summary'] as const) {
      const result = await callTool(client, 'SAPRead', { ...args, ...(mode ? { extensions: mode } : {}) });
      assertBdefExtensions(base, result, mode ?? 'summary');
    }
  });
  it('verifies separate authored bodies independently of summary completion', async (ctx) => {
    requireOrSkip(ctx, supported, SkipReason.BACKEND_UNSUPPORTED);
    const args = { type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE', version: 'active', force_refresh: true };
    const base = await callTool(client, 'SAPRead', { ...args, extensions: 'none' });
    assertBdefExtensions(base, await callTool(client, 'SAPRead', { ...args, extensions: 'sources' }), 'sources');
  });
  it('keeps source windows unchanged and defaults them to none', async (ctx) => {
    requireOrSkip(ctx, supported, SkipReason.BACKEND_UNSUPPORTED);
    const args = {
      type: 'BDEF',
      name: 'DEMO_RAP_EXTENSIBLE',
      version: 'active',
      lineStart: 1,
      lineEnd: 2,
      force_refresh: true,
    };
    const base = await callTool(client, 'SAPRead', args);
    expectToolSuccess(base);
    expect(base.content).toHaveLength(1);
    const report = assertBdefExtensions(
      base,
      await callTool(client, 'SAPRead', { ...args, extensions: 'summary' }),
      'summary',
    );
    expect(report.scope).toContain('owning object/source');
  });
});
