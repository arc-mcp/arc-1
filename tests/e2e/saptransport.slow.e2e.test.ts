/**
 * Slow E2E coverage for recursive transport release.
 *
 * Releasing a transport is permanent on the shared SAP system. Keep this out
 * of the default E2E profile and run only with TEST_TRANSPORT_RELEASE_TESTS=true.
 *
 * Run: TEST_TRANSPORT_RELEASE_TESTS=true npm run test:e2e:slow -- tests/e2e/saptransport.slow.e2e.test.ts
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';

const transportReleaseTestsEnabled = process.env.TEST_TRANSPORT_RELEASE_TESTS === 'true';

describe('E2E SAPTransport Slow Release Tests', () => {
  let client: Client;
  let transportsEnabled = true;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  it('release_recursive releases transport', async (ctx) => {
    requireOrSkip(ctx, transportReleaseTestsEnabled ? true : undefined, SkipReason.TRANSPORT_RELEASE_DISABLED);

    let id = '';
    let released = false;
    try {
      const createResult = await callTool(client, 'SAPTransport', {
        action: 'create',
        description: `ARC-1 E2E recursive-release ${Date.now()}`,
      });
      if (createResult.isError && createResult.content?.[0]?.text?.includes('allowTransportWrites=false')) {
        transportsEnabled = false;
        return skipTest(ctx, 'Transport writes not enabled on MCP server');
      }
      const createText = expectToolSuccessOrSkip(ctx, createResult);
      const match = createText.match(/([A-Z0-9]+K\d+)/);
      expect(match).toBeTruthy();
      id = match![1];

      const result = await callTool(client, 'SAPTransport', {
        action: 'release_recursive',
        id,
      });
      const text = expectToolSuccess(result);
      expect(text).toContain(id);
      released = true;
    } finally {
      if (id && !released && transportsEnabled) {
        const deleteResult = await callTool(client, 'SAPTransport', { action: 'delete', id, recursive: true });
        expectToolSuccess(deleteResult);
      }
    }
  });
});
