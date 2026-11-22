import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

vi.mock('../../../src/server/http.js', () => ({
  startHttpServer: vi.fn(async () => ({ close: vi.fn() })),
}));
vi.mock('../../../src/server/shutdown.js', () => ({ registerShutdownHandlers: vi.fn() }));
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: vi.fn().mockRejectedValue(new Error('No SAP connection in this unit test')),
}));

const CONFIG = {
  ...DEFAULT_CONFIG,
  url: 'http://sap.example.test',
  transport: 'http-streamable',
  cacheMode: 'none',
} as const;

beforeEach(() => {
  vi.resetModules(); // Give each startup its own process-wide tool registry.
  vi.clearAllMocks();
});

it.each(['Custom_LaunchReport', 'Custom_LaunchReprt'])('validates %s after loading a plugin', async (name) => {
  const { createAndStartServer } = await import('../../../src/server/server.js');
  const { startHttpServer } = await import('../../../src/server/http.js');
  const dir = mkdtempSync(join(tmpdir(), 'arc1-deny-plugin-'));
  const manifest = join(dir, 'launch-report.tool.json');
  try {
    writeFileSync(
      manifest,
      JSON.stringify({
        name: 'Custom_LaunchReport',
        description: 'read report information',
        scope: 'read',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        request: { method: 'GET', path: '/sap/bc/adt/discovery' },
      }),
    );
    const startup = createAndStartServer({ ...CONFIG, plugins: [manifest], denyActions: [name] });
    if (name === 'Custom_LaunchReport') {
      const server = await startup;
      await server.close();
      expect(startHttpServer).toHaveBeenCalledOnce();
    } else {
      await expect(startup).rejects.toThrow(
        "unknown plugin tool 'Custom_LaunchReprt'. Loaded plugin tools: Custom_LaunchReport.",
      );
      expect(startHttpServer).not.toHaveBeenCalled();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('refuses a plugin deny rule at startup when no plugins are configured', async () => {
  const { createAndStartServer } = await import('../../../src/server/server.js');
  const { startHttpServer } = await import('../../../src/server/http.js');
  await expect(createAndStartServer({ ...CONFIG, denyActions: ['Custom_LaunchReport'] })).rejects.toThrow(
    "unknown plugin tool 'Custom_LaunchReport'. Loaded plugin tools: (none).",
  );
  expect(startHttpServer).not.toHaveBeenCalled();
});
