import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runNativePackageRecovery } from '../../../scripts/qualification/pr1142/native-package-recovery.js';
import {
  PACKAGE_RECOVERY,
  packageRecoveryHistory,
} from '../../../scripts/qualification/pr1142/native-package-recovery-fixed.js';
import { graph, recoveryHarness } from './pr1142-native-package-recovery-harness.js';

const { runNativePackageCleanup } = await import('../../../scripts/qualification/pr1142/native-package-driver.js');
const revision = 'a'.repeat(40),
  jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v), { mode: 0o600 });
let temporary: string,
  root: string,
  h: ReturnType<typeof recoveryHarness>,
  deps: NonNullable<Parameters<typeof runNativePackageRecovery>[1]>;
const invoke = (phase: string, sample?: string) =>
  runNativePackageRecovery(
    [`--${phase}-reviewed-local-package-recovery-v1`, revision, ...(sample ? [sample] : [])],
    deps,
  );
const tree = (p: string): string =>
  readdirSync(p, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      e.isDirectory() ? `${e.name}/${tree(join(p, e.name))}` : `${e.name}:${sha(readFileSync(join(p, e.name)))}`,
    )
    .join('|');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-package-recovery-entry-'));
  root = join(temporary, PACKAGE_RECOVERY);
  h = recoveryHarness();
  const runtime = {
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'SYNTHETIC-ONLY',
    })),
    createClient: vi.fn((options: any) => {
      h.client.safety.allowWrites = options.safety.allowWrites;
      return h.client;
    }),
    execute: vi.fn(runNativePackageCleanup),
  };
  deps = {
    validateRuntime: vi.fn(),
    verifyHistory: vi.fn(),
    bind: vi.fn(async () => ({
      repo: temporary,
      root,
      verifySource: vi.fn(),
      evidence: {
        revision,
        repo: temporary,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        dependencyLimit: 'synthetic',
      },
    })),
    runtime: vi.fn(async () => runtime),
  };
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});
async function ready() {
  await invoke('prepare');
  vi.setSystemTime(Date.now() + 1);
  const preflight = await invoke('preflight');
  if (!('preflightId' in preflight) || typeof preflight.preflightId !== 'string') throw new Error();
  vi.setSystemTime(Date.now() + 1);
  const sample = preflight.preflightId,
    dir = join(root, 'preflight', sample),
    search = {
      observedAt: new Date().toISOString(),
      client: '001',
      table: '*',
      lockCount: 0,
      evidenceSha256: sha(jpeg),
    };
  write(join(dir, 'sm12-baseline.json'), {
    protocol: PACKAGE_RECOVERY,
    revision,
    intentHash: preflight.intentHash,
    preflightId: sample,
    suffixSearch: { ...search, user: '*', argument: `*${graph.suffix}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  });
  for (const n of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${n}.jpg`), jpeg, { mode: 0o600 });
  return { sample, dir };
}
it('prepares a separate fixed retained intent without native runtime, credentials, random owners or old claim edits', async () => {
  await invoke('prepare');
  expect(deps.runtime).not.toHaveBeenCalled();
  expect(deps.verifyHistory).toHaveBeenCalled();
  expect(read(join(root, 'intent.json'))).toMatchObject({
    protocol: PACKAGE_RECOVERY,
    graph,
    history: packageRecoveryHistory,
  });
  const before = tree(root);
  await expect(invoke('prepare')).rejects.toThrow();
  expect(tree(root)).toBe(before);
});
it('performs a nonclaiming, write-free check and exactly one claimed reverse cleanup', async () => {
  const { sample } = await ready(),
    before = tree(root);
  vi.mocked(deps.runtime).mockClear();
  const check = await invoke('check', sample);
  expect(check).toMatchObject({ executionGrant: false, attemptClaimed: false, failure: false });
  expect(tree(root)).toBe(before);
  expect(deps.runtime).not.toHaveBeenCalled();
  const result = await invoke('execute', sample);
  expect(result).toMatchObject({
    failure: false,
    created: [],
    remaining: [],
    confirmedDeleted: [graph.clas.owner, graph.child.owner, graph.root.owner],
  });
  expect(read(join(root, 'attempt', 'manifest.json')).stages).toEqual(['delete-class', 'delete-child', 'delete-root']);
  const final = tree(root);
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(tree(root)).toBe(final);
});
it.each(['history', 'intent', 'image', 'expiry', 'wrong-protocol'] as const)(
  'consumes a rejected attempt before credentials after %s drift',
  async (fault) => {
    const { sample, dir } = await ready();
    vi.mocked(deps.runtime).mockClear();
    if (fault === 'history')
      vi.mocked(deps.verifyHistory).mockImplementation(() => {
        throw new Error('changed');
      });
    if (fault === 'intent') {
      const i = read(join(root, 'intent.json'));
      i.graph.root.name = 'FOREIGN';
      write(join(root, 'intent.json'), i);
    }
    if (fault === 'image') writeFileSync(join(dir, 'sm12-user.jpg'), 'changed');
    if (fault === 'expiry') vi.setSystemTime(Date.now() + 300001);
    if (fault === 'wrong-protocol') {
      const p = read(join(dir, 'result.json'));
      p.protocol = 'pr1142-native-local-package-v1';
      write(join(dir, 'result.json'), p);
    }
    await expect(invoke('execute', sample)).rejects.toThrow();
    expect(deps.runtime).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'attempt'))).toBe(true);
    expect(read(join(root, 'attempt', 'result.json'))).toMatchObject({ failure: true, mutationAttempted: false });
  },
);
it('rechecks history after the driver returns and preserves confirmed native facts', async () => {
  const { sample } = await ready(),
    runtime = await deps.runtime(),
    execute = runtime.execute;
  runtime.execute = async (input) => {
    const result = await execute(input);
    vi.mocked(deps.verifyHistory).mockImplementation(() => {
      throw new Error('changed');
    });
    return result;
  };
  const result = await invoke('execute', sample);
  expect(result).toMatchObject({
    failure: true,
    terminalCheckUnconfirmed: true,
    remaining: [],
    confirmedDeleted: [graph.clas.owner, graph.child.owner, graph.root.owner],
  });
  expect(read(join(root, 'attempt', 'result.json')).confirmedDeleted).toHaveLength(3);
});
it('rejects the old protocol flags at the new entry without binding or claims', async () => {
  await expect(runNativePackageRecovery(['--prepare-reviewed-local-package-v1', revision], deps)).rejects.toThrow();
  expect(deps.bind).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});
