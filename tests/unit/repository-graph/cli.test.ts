import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../../src/cli.js';
import { jsonResponse, KEY, response } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('graph CLI without SAP', () => {
  it('checks status and queries without constructing direct SAP context or loading plugins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc-graph-cli-'));
    const key = join(dir, 'key');
    const file = join(dir, 'connection.json');
    writeFileSync(key, KEY, { mode: 0o600 });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        url: 'https://graph.example',
        systemKey: 'TEST-001',
        audience: 'trial',
        sharing: 'shared-repository-metadata',
        apiKeyFile: key,
      }),
      { mode: 0o600 },
    );
    const graphFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => jsonResponse(response(JSON.parse(String(init?.body)).action)));
    vi.stubGlobal('fetch', graphFetch);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sap = vi.fn().mockRejectedValue(new Error('MUST NOT CONTACT SAP'));
    try {
      const prefix = [
        '--graph-connection-file',
        file,
        '--cookie-file',
        '/unreadable-sap-cookie',
        '--plugins',
        '/missing-plugin.js',
      ];
      expect(await main([...prefix, 'graph', 'status'], { authPreflight: sap, probeFeatures: sap })).toBe(0);
      expect(
        await main([...prefix, 'call', 'SAPGraph', '--json', '{"action":"search","query":"Z"}'], {
          authPreflight: sap,
          probeFeatures: sap,
        }),
      ).toBe(0);
      expect(sap).not.toHaveBeenCalled();
      expect(graphFetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(output.mock.calls)).not.toContain(KEY);
      graphFetch.mockRejectedValue(new Error(KEY));
      expect(await main([...prefix, 'graph', 'status'], { authPreflight: sap, probeFeatures: sap })).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
