/** Method reads through the deployed HTTP MCP endpoint and the persistent read-only fixture. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

describe('SAPRead method response contracts (e2e)', () => {
  let client: Client;
  const object = { type: 'CLAS', name: 'ZCL_ARC1_TEST' };
  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client?.close();
  });

  it('returns an own signature and preserves a later implementation/full read', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { ...object, method: 'get_name', methodView: 'signature' });
    const signature = JSON.parse(expectToolSuccessOrSkip(ctx, result));
    expect(signature).toMatchObject({ className: object.name, scope: 'own-declaration', visibility: 'public' });
    expect(signature.signature).toMatch(/METHODS\s+get_name\b/i);
    expect(signature.signature).toMatch(/RETURNING/i);
    const body = expectToolSuccess(await callTool(client, 'SAPRead', { ...object, method: 'get_name' }));
    expect(body).toMatch(/rv_name\s*=\s*mv_name/i);
    const full = expectToolSuccess(await callTool(client, 'SAPRead', object));
    expect(full).toMatch(/CLASS\s+zcl_arc1_test\s+IMPLEMENTATION/i);
    expect(JSON.stringify(signature).length).toBeLessThan(full.length);
  });

  it('rejects structured + method through the HTTP MCP entry point', async () => {
    const result = await callTool(client, 'SAPRead', { ...object, method: 'get_name', format: 'structured' });
    expect(result.isError).toBe(true);
    expect(String(result.content?.[0]?.text)).toContain('structured');
  });

  it('suggests an actual near-name without returning the whole inventory', async (ctx) => {
    expectToolSuccessOrSkip(ctx, await callTool(client, 'SAPRead', { ...object, method: 'get_name' }));
    const result = await callTool(client, 'SAPRead', { ...object, method: 'get_nam' });
    expect(result.isError).toBe(true);
    const message = String(result.content?.[0]?.text);
    expect(message).toMatch(/Suggestions in selected source:.*get_name/i);
    expect(message.length).toBeLessThan(1200);
  });
});
