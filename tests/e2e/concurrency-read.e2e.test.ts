/**
 * Bounded read-only concurrency smoke for the local MCP HTTP server.
 *
 * This intentionally uses one connected MCP client and a low fixed concurrency
 * level. It proves simultaneous read calls work without creating, updating,
 * deleting, activating, warming cache, or releasing transport objects.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess } from './helpers.js';

describe('E2E read-only concurrency smoke', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
    console.log(
      `    concurrency smoke env: ARC1_MAX_CONCURRENT=${process.env.ARC1_MAX_CONCURRENT ?? '<default>'}, ` +
        `ARC1_AUTH_RATE_LIMIT=${process.env.ARC1_AUTH_RATE_LIMIT ?? '<default>'}, ` +
        `ARC1_RATE_LIMIT=${process.env.ARC1_RATE_LIMIT ?? '<default>'}`,
    );
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  it('handles three simultaneous read-only MCP calls', async () => {
    const [systemResult, componentsResult, classResult] = await Promise.all([
      callTool(client, 'SAPRead', { type: 'SYSTEM' }),
      callTool(client, 'SAPRead', { type: 'COMPONENTS' }),
      callTool(client, 'SAPRead', { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES', method: '*' }),
    ]);

    const systemText = expectToolSuccess(systemResult);
    const system = JSON.parse(systemText);
    expect(typeof system).toBe('object');

    const componentsText = expectToolSuccess(componentsResult);
    const components = JSON.parse(componentsText);
    expect(Array.isArray(components)).toBe(true);

    const classText = expectToolSuccess(classResult);
    expect(classText).toContain('CL_ABAP_CHAR_UTILITIES');
  });
});
