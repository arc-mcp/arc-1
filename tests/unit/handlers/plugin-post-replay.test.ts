import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AdtClient } from '../../../src/adt/client.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { getToolRegistry, handleToolCall } from '../../../src/handlers/dispatch.js';
import { defineTool } from '../../../src/public/index.js';
import { logger } from '../../../src/server/logger.js';
import { registerPluginTool } from '../../../src/server/plugin-loader.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const path = '/sap/bc/soap/rfc';
for (const scope of ['read', 'write'] as const) {
  registerPluginTool(
    getToolRegistry(),
    'post-test',
    defineTool({
      name: `Custom_Post_${scope}`,
      description: 'Test a parameterized service through the real plugin adapter',
      schema: z.object({}),
      policy: { scope, opType: scope === 'write' ? 'U' : 'R' },
      handler: async (_args, ctx) => {
        const response = await ctx.http.post(path, '<approved-operation/>', 'text/xml');
        return { content: [{ type: 'text', text: response.body }] };
      },
    }),
  );
}

for (const operation of ['classRun', 'programRun'] as const) {
  registerPluginTool(
    getToolRegistry(),
    'post-test',
    defineTool({
      name: `Custom_${operation}`,
      description: 'Test named execution through the real plugin adapter',
      schema: z.object({}),
      policy: { scope: 'write', opType: 'W' },
      handler: async (_args, ctx) => ({
        content: [{ type: 'text', text: await ctx.run[operation]('Z_EXECUTION_TEST') }],
      }),
    }),
  );
}

async function withService(
  status: number | 'disconnect',
  run: (client: AdtClient, state: { requests: number; posts: number; executions: number }) => Promise<void>,
) {
  const state = { requests: 0, posts: 0, executions: 0 };
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Drain the body. */
    }
    state.requests++;
    if (req.method === 'HEAD') {
      res.setHeader('x-csrf-token', 'test-token');
      res.end();
      return;
    }
    state.posts++;
    if (state.posts === 1 && status === 403) {
      res.writeHead(403);
      res.end('CSRF token validation failed');
      return;
    }
    if (status !== 400) state.executions++;
    if (status === 'disconnect') {
      res.destroy();
      return;
    }
    res.writeHead(state.posts === 1 ? status : 200, { 'retry-after': '0', 'content-type': 'text/plain' });
    res.end(state.posts === 1 && status !== 200 ? 'database connection is not open' : 'done');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local TCP port');
  try {
    await run(
      new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}`, safety: unrestrictedSafetyConfig() }),
      state,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const config = { ...DEFAULT_CONFIG, allowWrites: true, allowPluginRawWrites: true };
afterEach(() => vi.restoreAllMocks());

describe('extension POST replay through the dispatcher', () => {
  it.each([
    { operation: 'classRun', status: 503 },
    { operation: 'programRun', status: 500 },
  ])('does not repeat $operation after execution and HTTP $status', async ({ operation, status }) => {
    await withService(status, async (client, state) => {
      const result = await handleToolCall(
        client,
        { ...config, allowPluginExecute: true, allowPluginRawWrites: false },
        `Custom_${operation}`,
        {},
      );
      expect(state.posts).toBe(1);
      expect(state.executions).toBe(1);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('POST completion is unconfirmed');
      expect(result.content[0]?.text).not.toContain('wait 10-30 seconds and retry');
    });
  });

  it.each([
    { status: 503, minimalErrors: false },
    { status: 429, minimalErrors: false },
    { status: 500, minimalErrors: true },
    { status: 'disconnect' as const, minimalErrors: true },
  ])('preserves unknown execution after $status (minimal=$minimalErrors)', async ({ status, minimalErrors }) => {
    const audit = vi.spyOn(logger, 'emitAudit');
    await withService(status, async (client, state) => {
      const result = await handleToolCall(client, { ...config, minimalErrors }, 'Custom_Post_write', {});
      expect(state.posts).toBe(1);
      expect(state.executions).toBe(1);
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('POST completion is unconfirmed');
      expect(text).toContain('Do not blindly repeat');
      expect(text).not.toContain('wait 10-30 seconds and retry');
      if (minimalErrors) {
        expect(text).toContain('request ID');
        expect(text).not.toContain('database connection');
        if (typeof status === 'number') expect(text).toContain(`status ${status}`);
      }
      expect(audit.mock.calls.some(([event]) => event.event === 'tool_call_end' && event.status === 'error')).toBe(
        true,
      );
    });
  });

  it.each([200, 403])('preserves success and existing CSRF recovery (%s)', async (status) => {
    await withService(status, async (client, state) => {
      const result = await handleToolCall(client, config, 'Custom_Post_write', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toBe('done');
      expect(state.posts).toBe(status === 403 ? 2 : 1);
      expect(state.executions).toBe(1);
    });
  });

  it('does not label a definitive 400 as an unknown completion', async () => {
    await withService(400, async (client, state) => {
      const result = await handleToolCall(client, config, 'Custom_Post_write', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('POST completion is unconfirmed');
      expect(state.posts).toBe(1);
      expect(state.executions).toBe(0);
    });
  });

  it.each(['read-scope', 'raw-disabled', 'writes-disabled'] as const)('refuses before any HTTP: %s', async (gate) => {
    await withService(200, async (client, state) => {
      const effective =
        gate === 'writes-disabled' ? client.withSafety({ ...client.safety, allowWrites: false }) : client;
      const result = await handleToolCall(
        effective,
        {
          ...config,
          allowPluginRawWrites: gate !== 'raw-disabled',
        },
        gate === 'read-scope' ? 'Custom_Post_read' : 'Custom_Post_write',
        {},
      );
      expect(result.isError).toBe(true);
      expect(state.requests).toBe(0);
    });
  });
});
