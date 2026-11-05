import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  indexTailOwners,
  TABLE_INDEX_PROTOCOL as TABLE_PROTOCOL,
  TABLE_INDEX_STAGES as TABLE_STAGES,
} from '../../../scripts/qualification/pr1142/native-ddic-table-index-fixed.js';
import { fixtures, indexTailHarness as tableHarness } from './pr1142-native-ddic-table-index-harness.js';

const { runNativeIndexTailPhases } = await import('../../../scripts/qualification/pr1142/native-ddic-table-index.js');

import type { DdicPhaseDependencies as PhaseDependencies } from '../../../scripts/qualification/pr1142/native-ddic-phases.js';
import { assertDdicRuntime } from '../../../scripts/qualification/pr1142/native-ddic-phases.js';
import type { TableFixture } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';

type DdicPhaseDependencies = PhaseDependencies<TableFixture> & { verifyHistory: () => void };
let historyValid = true;

const revision = 'a'.repeat(40),
  jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex'),
  read = (p: string) => JSON.parse(readFileSync(p, 'utf8')),
  write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v), { mode: 0o600 });
let temporary: string, root: string, h: ReturnType<typeof tableHarness>, deps: DdicPhaseDependencies;
const invoke = (phase: string, sample?: string) =>
  runNativeIndexTailPhases(
    [`--${phase}-reviewed-ddic-table-index-tail-v1`, revision, ...(sample ? [sample] : [])],
    deps,
  );
const tree = (path: string): string =>
  readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      e.isDirectory() ? `${e.name}/${tree(join(path, e.name))}` : `${e.name}:${sha(readFileSync(join(path, e.name)))}`,
    )
    .join('|');
beforeEach(() => {
  historyValid = true;
  temporary = mkdtempSync(join(tmpdir(), 'arc1-ddic-table-retained-entry-'));
  root = join(temporary, TABLE_PROTOCOL);
  h = tableHarness();
  h.runtime.readEnv.mockClear();
  h.runtime.createClient.mockClear();
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  deps = {
    validateRuntime: vi.fn(),
    verifyHistory: () => {
      if (!historyValid) throw new Error('history changed');
    },
    runtime: vi.fn(async () => h.runtime),
    bind: vi.fn(async () => ({
      repo: temporary,
      root,
      verifySource: h.verify,
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        repo: temporary,
        dependencyLimit: 'offline synthetic',
      },
    })),
  };
});
afterEach(() => {
  if (existsSync(root)) {
    const inspect = (path: string) => {
      for (const e of readdirSync(path, { withFileTypes: true })) {
        const p = join(path, e.name);
        if (e.isDirectory()) inspect(p);
        else if (e.name.endsWith('.json')) expect(readFileSync(p, 'utf8')).not.toContain('SYNTHETIC-ONLY-DDIC');
      }
    };
    inspect(root);
  }
  rmSync(temporary, { recursive: true, force: true });
});
async function ready() {
  const prepared = await invoke('prepare');
  if (!('fixtures' in prepared) || !prepared.fixtures) throw new Error();
  expect(prepared.fixtures).toEqual(fixtures);
  h.seed();
  const preflight = await invoke('preflight');
  if (!('preflightId' in preflight) || !preflight.preflightId) throw new Error();
  const sample = preflight.preflightId,
    dir = join(root, 'preflight', sample),
    intent = read(join(root, 'intent.json'));
  const search = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: sha(jpeg),
  };
  write(join(dir, 'sm12-baseline.json'), {
    protocol: TABLE_PROTOCOL,
    revision,
    intentHash: preflight.intentHash,
    preflightId: sample,
    suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  });
  for (const name of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { sample, dir };
}
it('prepares pure fixed intent only and refuses repeated preparation', async () => {
  const p = await invoke('prepare');
  expect(p).toMatchObject({ failure: false, mutationAttempted: false });
  expect(deps.runtime).not.toHaveBeenCalled();
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
  const before = tree(root);
  await expect(invoke('prepare')).rejects.toThrow();
  expect(tree(root)).toBe(before);
});
it('check is nonclaiming and read-only, without runtime, credential reader, umask change', async () => {
  const { sample } = await ready();
  vi.mocked(deps.runtime).mockClear();
  h.runtime.readEnv.mockClear();
  const before = tree(root),
    masks = vi.mocked(process.umask).mock.calls.length;
  expect(await invoke('check', sample)).toMatchObject({ attemptClaimed: false, executionGrant: false, failure: false });
  expect(tree(root)).toBe(before);
  expect(deps.runtime).not.toHaveBeenCalled();
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
  expect(vi.mocked(process.umask).mock.calls).toHaveLength(masks);
  expect(deps.bind).toHaveBeenLastCalledWith(revision, expect.any(URL), undefined, { readOnly: true });
});
it('actual entry→factory→real client→driver completes once with full pinned policy', async () => {
  const { sample } = await ready();
  const r = await invoke('execute', sample);
  expect(r).toMatchObject({
    failure: false,
    completed: [...TABLE_STAGES],
    finalAbsenceConfirmed: true,
    mutationDispatched: true,
  });
  const last = h.runtime.createClient.mock.calls.at(-1)![0];
  expect(last).toMatchObject({
    client: '001',
    username: 'MARIAN',
    baseUrl: 'https://a4h.marianzeis.de',
    insecure: false,
    safety: {
      allowWrites: true,
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  const before = tree(root),
    calls = h.world.calls.length;
  await expect(invoke('execute', sample)).rejects.toThrow();
  await expect(invoke('preflight')).rejects.toThrow();
  expect(tree(root)).toBe(before);
  expect(h.world.calls).toHaveLength(calls);
}, 30000);
it.each([
  'protocol',
  'owner',
  'sample',
  'past',
  'future',
  'bad-jpeg',
  'hash',
  'world-readable',
  'before-prepare',
] as const)('consumes execution claim before credentials for bad %s', async (fault) => {
  const { sample, dir } = await ready(),
    path = join(dir, 'sm12-baseline.json'),
    b = read(path);
  h.runtime.readEnv.mockClear();
  if (fault === 'protocol') b.protocol = 'pr1142-native-local-package-v1';
  if (fault === 'owner') b.suffixSearch.argument = '*FOREIGN*';
  if (fault === 'sample') b.preflightId = 'F'.repeat(16);
  if (fault === 'past') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
  if (fault === 'future') b.userSearch.observedAt = new Date(Date.now() + 60000).toISOString();
  if (fault === 'before-prepare') b.userSearch.observedAt = '2000-01-01T00:00:00.000Z';
  if (fault === 'bad-jpeg') {
    writeFileSync(join(dir, 'sm12-user.jpg'), 'wrong');
    b.userSearch.evidenceSha256 = sha('wrong');
  }
  if (fault === 'hash') b.userSearch.evidenceSha256 = '0'.repeat(64);
  if (fault === 'world-readable') chmodSync(join(dir, 'sm12-user.jpg'), 0o644);
  write(path, b);
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(existsSync(join(root, 'attempt'))).toBe(true);
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
  expect(read(join(root, 'attempt', 'result.json'))).toMatchObject({ mutationAttempted: false });
  await expect(invoke('execute', sample)).rejects.toThrow();
});
it('execute rereads proof after a successful check and does not reuse its outcome', async () => {
  const { sample, dir } = await ready();
  expect(await invoke('check', sample)).toMatchObject({ failure: false });
  writeFileSync(join(dir, 'sm12-user.jpg'), 'changed');
  h.runtime.readEnv.mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
});
it('detects receipt drift across async runtime load before client creation', async () => {
  const { sample, dir } = await ready();
  vi.mocked(deps.runtime).mockImplementation(async () => {
    await Promise.resolve();
    writeFileSync(join(dir, 'sm12-user.jpg'), 'changed');
    return h.runtime;
  });
  h.runtime.createClient.mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.runtime.createClient).not.toHaveBeenCalled();
});
it('validates credentials without silently inheriting a different user or target', async () => {
  const { sample } = await ready();
  h.runtime.readEnv.mockReturnValue({
    SAP_URL: 'https://wrong.invalid',
    SAP_USER: 'OTHER',
    SAP_PASSWORD: 'synthetic',
    SAP_CLIENT: '100',
  });
  h.runtime.createClient.mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.runtime.createClient).not.toHaveBeenCalled();
});
it('marks terminal binding failure while preserving successful deletion/cleanup facts', async () => {
  const { sample } = await ready();
  const execute = h.runtime.execute;
  h.runtime.execute = async (input) => {
    const r = await execute(input);
    h.breakSource();
    return r;
  };
  const result = await invoke('execute', sample);
  expect(result).toMatchObject({
    failure: true,
    terminalCheckUnconfirmed: true,
    cleanupUnconfirmed: false,
    confirmedDeleted: expect.any(Array),
  });
  if (!('confirmedDeleted' in result)) throw new Error();
  expect(result.confirmedDeleted).toHaveLength(3);
}, 30000);
it('enforces fixed runtime, phase and no caller path/profile overrides', async () => {
  expect(() => assertDdicRuntime({ NODE_OPTIONS: '--require foreign' }, [], 'v22.21.1')).toThrow();
  expect(() => assertDdicRuntime({}, [], 'v22.22.0')).toThrow();
  expect(() => assertDdicRuntime({ ARC1_LOG_HTTP_DEBUG: 'false' }, [], 'v22.21.1')).toThrow();
  await expect(
    runNativeIndexTailPhases(['--prepare-reviewed-ddic-table-index-tail-v1', revision, '/foreign'], deps),
  ).rejects.toThrow();
  expect(deps.bind).not.toHaveBeenCalled();
});

it('history drift consumes the new claim before credentials and retains the known four owners', async () => {
  const { sample } = await ready();
  historyValid = false;
  h.runtime.readEnv.mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
  expect(read(join(root, 'attempt', 'result.json'))).toMatchObject({
    mutationAttempted: false,
    remaining: indexTailOwners(),
    inspectionRequired: indexTailOwners(),
  });
});
it('an unexpected runtime escape retains the full potentially touched graph', async () => {
  const { sample } = await ready();
  h.runtime.execute = async () => {
    throw new Error('unknown after entry');
  };
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(read(join(root, 'attempt', 'result.json'))).toMatchObject({
    mutationAttempted: 'unknown',
    cleanupUnconfirmed: true,
    remaining: fixtures.map((f) => f.owner),
    inspectionRequired: fixtures.map((f) => f.owner),
  });
});
it('a history change after awaited native reads reaches the actual activation send fence', async () => {
  const { sample } = await ready();
  const execute = h.runtime.execute;
  let changed = false;
  h.runtime.execute = (input) =>
    execute({
      ...input,
      record: (r) => {
        input.record(r);
        const row = r as { stage?: string; phase?: string; path?: string };
        if (
          row.stage === 'response' &&
          row.path?.startsWith(fixtures[3].owner) &&
          row.phase === 'reactivate-TABL/DTI'
        ) {
          historyValid = false;
          changed = true;
        }
      },
    });
  expect(await invoke('execute', sample)).toMatchObject({ failure: true, terminalCheckUnconfirmed: true });
  expect(changed).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(read(join(root, 'attempt', 'result.json')).failure).toBe(true);
});
