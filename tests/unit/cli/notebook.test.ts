import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { type CliDependencies, main } from '../../../src/cli.js';
import { errorResult, textResult } from '../../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { importAbapSql } from '../../../src/workflows/notebook-document.js';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'arc1-notebook-'));
  temporary.push(root);
  return root;
}
function dependencies(blocked = false) {
  const dispatchToolCall = vi.fn(async () =>
    blocked
      ? errorResult('Operation FreeSQL blocked by safety configuration')
      : textResult(JSON.stringify({ columns: ['ID'], rows: [{ ID: '0001' }], rowsReturned: 1 })),
  );
  const createClient = vi.fn(() => ({ http: { setDiscoveryMap: vi.fn() } }) as unknown as AdtClient);
  const deps: CliDependencies = {
    resolveConfiguration: () => ({
      config: { ...DEFAULT_CONFIG, url: 'https://sap.test', client: '001', cacheMode: 'none' },
      sources: {},
    }),
    createClient,
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
  return { deps, createClient, dispatchToolCall };
}
const input = {
  schemaVersion: 1,
  title: 'Checks',
  cells: [{ id: 'one', kind: 'sql', value: 'SELECT id FROM ztest', target: 'dev', maxRows: 2 }],
};

it('imports the observed SAP fixture without creating a client, preserving inert metadata and refusing overwrite', async () => {
  const root = await directory();
  const out = join(root, 'notebook.json');
  const { deps, createClient, dispatchToolCall } = dependencies();
  const args = [
    'notebook',
    'import',
    'examples/workflows/Flight_Capacity_Showcase.abapsql',
    '--destination',
    'A4H2023-2',
    '--target',
    'dev',
    '--out',
    out,
  ];
  expect(await main(args, deps)).toBe(0);
  expect(createClient).not.toHaveBeenCalled();
  expect(dispatchToolCall).not.toHaveBeenCalled();
  const saved = await readFile(out, 'utf8');
  expect(JSON.parse(saved).cells[1]).toMatchObject({
    target: 'dev',
    maxRows: 20,
    imported: { destination: 'A4H2023-2' },
  });
  expect(await main(args, deps)).not.toBe(0);
  expect(await readFile(out, 'utf8')).toBe(saved);
  if (process.platform !== 'win32') expect((await stat(out)).mode & 0o777).toBe(0o600);
});
it.each([false, true])('runs through the configured dispatcher; result export=%s', async (includeResults) => {
  const root = await directory();
  const file = join(root, 'input.json');
  const output = join(root, 'run');
  await writeFile(file, JSON.stringify(input));
  const { deps, dispatchToolCall } = dependencies();
  const args = [
    'notebook',
    'run',
    file,
    '--target',
    'dev',
    '--output-dir',
    output,
    ...(includeResults ? ['--include-results'] : []),
  ];
  expect(await main(args, deps)).toBe(0);
  expect(dispatchToolCall).toHaveBeenCalledTimes(1);
  expect(dispatchToolCall.mock.calls[0]).toEqual(
    expect.arrayContaining(['SAPQuery', { sql: input.cells[0].value, maxRows: 2 }]),
  );
  const evidence = JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8'));
  expect(evidence.cells[0]).toMatchObject({ target: 'https://sap.test/001', client: '001', status: 'success' });
  expect(evidence.cells[0].rows).toEqual(includeResults ? [{ ID: '0001' }] : undefined);
  if (process.platform !== 'win32') {
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output, 'evidence.json'))).mode & 0o777).toBe(0o600);
  }
  dispatchToolCall.mockClear();
  expect(await main(args, deps)).not.toBe(0);
  expect(dispatchToolCall).not.toHaveBeenCalled();
});
it('records policy denial and refuses unknown target mappings before SQL', async () => {
  const root = await directory();
  const file = join(root, 'input.json');
  await writeFile(file, JSON.stringify(input));
  const { deps, dispatchToolCall } = dependencies(true);
  expect(await main(['notebook', 'run', file, '--target', 'dev', '--output-dir', join(root, 'denied')], deps)).toBe(1);
  expect(JSON.parse(await readFile(join(root, 'denied/evidence.json'), 'utf8')).cells[0].status).toBe('blocked');
  dispatchToolCall.mockClear();
  expect(
    await main(['notebook', 'run', file, '--target', 'other', '--output-dir', join(root, 'unknown')], deps),
  ).not.toBe(0);
  expect(dispatchToolCall).not.toHaveBeenCalled();
});
it.each(['oversized', 'directory', 'invalid-utf8'])('refuses %s input before creating a client', async (kind) => {
  const root = await directory();
  const file = join(root, 'input.json');
  if (kind !== 'directory')
    await writeFile(file, kind === 'oversized' ? ' '.repeat(1024 * 1024 + 1) : Buffer.from([0xff]));
  const { deps, createClient } = dependencies();
  expect(
    await main(
      ['notebook', 'run', kind === 'directory' ? root : file, '--target', 'dev', '--output-dir', join(root, 'report')],
      deps,
    ),
  ).not.toBe(0);
  expect(createClient).not.toHaveBeenCalled();
});

it('allows a corrected proposal to reuse the output path after validation fails', async () => {
  const root = await directory();
  const file = join(root, 'input.json');
  const output = join(root, 'run');
  await writeFile(file, JSON.stringify(input));
  const { deps, dispatchToolCall } = dependencies();
  expect(await main(['notebook', 'run', file, '--target', 'wrong', '--output-dir', output], deps)).toBe(2);
  expect(dispatchToolCall).not.toHaveBeenCalled();
  expect(await main(['notebook', 'run', file, '--target', 'dev', '--output-dir', output], deps)).toBe(0);
});

it.each(['compact', 'formatted'])('rejects an import whose %s output exceeds the runner limit', async (form) => {
  const root = await directory();
  const file = join(root, 'source.abapsql');
  const output = join(root, 'imported.json');
  const base = { cells: [{ kind: 'markdown', value: 'x' }], metadata: '' };
  const overhead = JSON.stringify(importAbapSql(base, {})).length;
  const remaining = form === 'compact' ? 100 : overhead + 10;
  const source = JSON.stringify({ ...base, metadata: 'x'.repeat(1024 * 1024 - remaining) });
  expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
  await writeFile(file, source);
  const { deps, createClient } = dependencies();
  expect(
    await main(['notebook', 'import', file, '--destination', 'SAP', '--target', 'dev', '--out', output], deps),
  ).toBe(2);
  await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(createClient).not.toHaveBeenCalled();
});
