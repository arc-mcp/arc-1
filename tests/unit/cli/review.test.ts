import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { type CliDependencies, main } from '../../../src/cli.js';
import { textResult } from '../../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function outputDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'arc1-review-'));
  temporary.push(root);
  return join(root, 'review');
}
function dependencies(invalid = false) {
  const page = {
    schemaVersion: 1,
    resultFormat: 'structured',
    target: 'TEST/001',
    client: '001',
    transport: { id: 'DEVK900001', status: 'R' },
    reviewMode: 'released',
    inventoryFingerprint: 'hash',
    continuation: 'token',
    offset: 0,
    shown: 0,
    totalObjects: 0,
    objects: [],
  };
  const dispatchToolCall = vi.fn(async () => textResult(JSON.stringify(invalid ? {} : page)));
  const deps: CliDependencies = {
    resolveConfiguration: () => ({
      config: { ...DEFAULT_CONFIG, url: 'https://sap.test', cacheMode: 'none' },
      sources: {},
    }),
    createClient: () => ({ http: { setDiscoveryMap: vi.fn() } }) as unknown as AdtClient,
    createCache: async () => undefined,
    authPreflight: async () => ({
      status: 'skipped',
      blocking: false,
      endpoint: '/sap/bc/adt/core/discovery',
      checkedAt: '',
      reason: 'offline test',
    }),
    probeFeatures: async () => undefined,
    flushLogger: async () => undefined,
    dispatchToolCall,
  };
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return { deps, dispatchToolCall };
}
it('uses the dispatcher and writes private evidence without treating empty inventory as a release verdict', async () => {
  const directory = await outputDirectory();
  const { deps, dispatchToolCall } = dependencies();
  expect(await main(['review', 'DEVK900001', '--output-dir', directory], deps)).toBe(0);
  expect(dispatchToolCall).toHaveBeenCalledTimes(2);
  expect(dispatchToolCall.mock.calls[0]).toEqual(
    expect.arrayContaining(['SAPTransport', expect.objectContaining({ action: 'diff', reviewMode: 'released' })]),
  );
  const artifact = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8'));
  expect(artifact.pages[0]).not.toHaveProperty('continuation');
  expect(await readFile(join(directory, 'report.html'), 'utf8')).toContain('not a release verdict');
  if (process.platform !== 'win32') {
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, 'evidence.json'))).mode & 0o777).toBe(0o600);
  }
  const saved = await readFile(join(directory, 'evidence.json'), 'utf8');
  await writeFile(join(directory, 'report.html'), 'original report');
  const second = dependencies();
  expect(await main(['review', 'DEVK900001', '--output-dir', directory], second.deps)).not.toBe(0);
  expect(second.dispatchToolCall).not.toHaveBeenCalled();
  expect(await readFile(join(directory, 'evidence.json'), 'utf8')).toBe(saved);
  expect(await readFile(join(directory, 'report.html'), 'utf8')).toBe('original report');
});
it('saves failed collection evidence and rejects invalid modes before dispatch', async () => {
  const directory = await outputDirectory();
  const { deps, dispatchToolCall } = dependencies(true);
  expect(await main(['review', 'DEVK900001', '--output-dir', directory], deps)).toBe(1);
  expect(JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')).status).toBe('error');
  dispatchToolCall.mockClear();
  expect(await main(['review', 'DEVK900001', '--mode', 'invented', '--output-dir', `${directory}-invalid`], deps)).toBe(
    2,
  );
  expect(dispatchToolCall).not.toHaveBeenCalled();
});
