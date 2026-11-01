/** Read-only SHLP coverage through MCP discovery, validation and result serialization. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

describe('E2E native partial SHLP metadata (on-prem)', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client?.close();
  });

  it('advertises SHLP in both read and context schemas', async () => {
    const { tools } = await client.listTools();
    for (const name of ['SAPRead', 'SAPContext']) {
      expect(tools.find((tool) => tool.name === name)?.inputSchema.properties?.type).toMatchObject({
        enum: expect.arrayContaining(['SHLP']),
      });
    }
  });
  it.each(['SAPRead', 'SAPContext'])('%s returns native flags and explicit partial coverage', async (tool) => {
    const result = await callTool(client, tool, { type: 'SHLP/DH', name: 'SCUSTOM' });
    const metadata = JSON.parse(expectToolSuccess(result));
    expect(metadata).toMatchObject({
      availability: 'available',
      type: 'SHLP',
      name: 'SCUSTOM',
      completeness: 'partial',
      sourceVersion: 'active',
      language: { effective: null },
    });
    expect(metadata.parameters).toContainEqual(expect.objectContaining({ name: 'ID', import: false, export: true }));
    expect(metadata.missing).toEqual(
      expect.arrayContaining(['searchHelpExit', 'collectiveInclusions', 'appendSearchHelps']),
    );
  });
  it.each(['SAPRead', 'SAPContext'])('%s preserves an unavailable result as an MCP error', async (tool) => {
    const result = await callTool(client, tool, { type: 'SHLP', name: 'ZZ_ARC_SHLP_ABSENT_20261029' });
    expectToolError(result);
    expect(JSON.parse(result.content.map((item) => item.text).join(''))).toMatchObject({
      availability: 'not_available',
      type: 'SHLP',
    });
  });
  it('refuses inactive reads at the MCP boundary', async () => {
    expectToolError(
      await callTool(client, 'SAPRead', { type: 'SHLP', name: 'SCUSTOM', version: 'inactive' }),
      'active only',
    );
  });
  it('refuses dependency enrichment options that the metadata reader cannot honor', async () => {
    expectToolError(
      await callTool(client, 'SAPContext', { type: 'SHLP', name: 'SCUSTOM', includeKtd: true }),
      'includeKtd',
    );
  });
});
