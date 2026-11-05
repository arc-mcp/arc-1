import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assertV3RecoveryRuntime,
  runNativeV3Recovery,
} from '../../../scripts/qualification/pr1142/native-declarative-v3-recovery.js';
import {
  V3_RECOVERY,
  v3OriginalHashes,
  v3RecoveryFixture,
} from '../../../scripts/qualification/pr1142/native-declarative-v3-recovery-fixed.js';

vi.mock('dotenv', () => ({ parse: vi.fn(), config: vi.fn() }));
vi.mock('../../../scripts/qualification/pr1142/native-declarative-v3-recovery-driver.js', () => ({
  runV3DeclarativeRecovery: vi.fn(),
}));
vi.mock('../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js', () => ({ recoveryConfig: {} }));
const revision = 'a'.repeat(40),
  secret = 'RECOVERY-SECRET-FIXTURE';
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
let temporary: string;
let dependencies: NonNullable<Parameters<typeof runNativeV3Recovery>[1]>;
let binding: Awaited<ReturnType<typeof dependencies.bind>>;
const root = () => join(temporary, V3_RECOVERY);
const file = (name: string) => join(root(), 'prerequisites', name);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const invoke = (phase: 'prepare' | 'check' | 'execute') =>
  runNativeV3Recovery([`--${phase}-reviewed-v3-ddls-cleanup`, revision], dependencies);
const success = () => ({
  failure: false,
  mutationAttempted: true,
  deleteAttempted: true,
  confirmedDeleted: true,
  cleanupConfirmed: true,
  stopped: false,
  remaining: [],
  inspectionRequired: [],
});
function tree(path = root()): string {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) =>
      entry.isDirectory()
        ? `${entry.name}/${tree(join(path, entry.name))}`
        : `${entry.name}:${sha(readFileSync(join(path, entry.name)))}`,
    )
    .join('|');
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T01:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-v3-recovery-entry-'));
  binding = {
    repo: temporary,
    root: root(),
    verifySource: vi.fn(),
    evidence: {
      revision,
      entryHash: 'b'.repeat(64),
      packageLockHash: 'c'.repeat(64),
      node: 'v22.21.1',
      repo: temporary,
      dependencyLimit: 'fixture',
    },
  };
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => {
      binding.verifySource();
      return binding;
    }),
    verifyOriginal: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: secret,
    })),
    createClient: vi.fn(() => ({}) as never),
    execute: vi.fn(async (input) => {
      input.verifySource();
      input.record({ stage: 'request', method: 'DELETE' });
      return success();
    }),
  };
});
afterEach(() => {
  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.name.endsWith('.json')) expect(readFileSync(path, 'utf8')).not.toContain(secret);
    }
  };
  if (existsSync(root())) inspect(root());
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});
async function ready() {
  const prepared = await invoke('prepare');
  const search = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: sha(jpeg),
  };
  const baseline = {
    protocol: V3_RECOVERY,
    revision,
    intentHash: prepared.intentHash,
    originalResultHash: v3OriginalHashes.result,
    suffixSearch: { ...search, user: '*', argument: '*F4C656905A65AA61*' },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  write(file('sm12-baseline.json'), baseline);
  for (const name of ['suffix', 'user']) writeFileSync(file(`sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return baseline;
}
function noNative() {
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
}
it('checks the fixed cleanup without writes, umask change, credentials, native calls or an attempt claim', async () => {
  await ready();
  const before = tree();
  const masks = vi.mocked(process.umask).mock.calls.length;
  const proof = await invoke('check');
  expect(proof).toMatchObject({
    phase: 'check',
    failure: false,
    attemptClaimed: false,
    executionGrant: false,
    mutationAttempted: false,
  });
  expect(tree()).toBe(before);
  expect(vi.mocked(process.umask).mock.calls).toHaveLength(masks);
  expect(vi.mocked(dependencies.bind).mock.calls.at(-1)?.slice(2)).toEqual([undefined, { readOnly: true }]);
  noNative();
  await invoke('check');
  expect(tree()).toBe(before);
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
});
it('awaits async source binding before preparing a new fixed root', async () => {
  let resolve!: (value: typeof binding) => void;
  vi.mocked(dependencies.bind).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = invoke('prepare');
  expect(existsSync(root())).toBe(false);
  expect(dependencies.verifyOriginal).not.toHaveBeenCalled();
  resolve(binding);
  await pending;
  expect(existsSync(join(root(), 'intent.json'))).toBe(true);
  noNative();
});
it('runs exactly once and permanently refuses all replays while preserving the first result', async () => {
  await ready();
  await invoke('check');
  await expect(invoke('execute')).resolves.toMatchObject(success());
  const saved = tree();
  for (const phase of ['execute', 'check', 'prepare'] as const) await expect(invoke(phase)).rejects.toThrow();
  expect(tree()).toBe(saved);
  expect(dependencies.execute).toHaveBeenCalledTimes(1);
  expect(read(join(root(), 'attempt/manifest.json')).owner).toBe(v3RecoveryFixture.owner);
});
it('catches missing prerequisites offline, permits correction, and does not consume the attempt', async () => {
  await invoke('prepare');
  await expect(invoke('check')).rejects.toMatchObject({ reason: 'recovery-baseline' });
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
  noNative();
});
it.each([
  'revision',
  'intent',
  'result',
  'protocol',
  'client',
  'filter',
  'locks',
  'future',
  'stale',
  'predates',
  'hash',
  'png',
  'truncated',
])('refuses invalid %s before any native dependency', async (fault) => {
  const proof = await ready();
  if (fault === 'revision') proof.revision = 'b'.repeat(40);
  if (fault === 'intent') proof.intentHash = 'b'.repeat(64);
  if (fault === 'result') proof.originalResultHash = 'b'.repeat(64) as typeof proof.originalResultHash;
  if (fault === 'protocol') (proof as { protocol: string }).protocol = 'other';
  if (fault === 'client') proof.userSearch.client = '100';
  if (fault === 'filter') proof.suffixSearch.argument = '*';
  if (fault === 'locks') proof.userSearch.lockCount = 1;
  if (fault === 'future') proof.userSearch.observedAt = new Date(Date.now() + 1).toISOString();
  if (fault === 'stale') vi.advanceTimersByTime(300001);
  if (fault === 'predates') proof.userSearch.observedAt = new Date(Date.now() - 1).toISOString();
  if (fault === 'hash') proof.userSearch.evidenceSha256 = 'd'.repeat(64);
  if (fault === 'png' || fault === 'truncated') {
    const bytes = fault === 'png' ? Buffer.from('89504e470d0a1a0a', 'hex') : jpeg.subarray(0, 8);
    writeFileSync(file('sm12-user.jpg'), bytes);
    proof.userSearch.evidenceSha256 = sha(bytes);
  }
  write(file('sm12-baseline.json'), proof);
  await expect(invoke('check')).rejects.toMatchObject({ reason: 'recovery-baseline' });
  noNative();
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
});
it.each(['original', 'source', 'intent', 'receipt', 'image', 'expiry'])(
  'independently rechecks %s after a passing offline check, consuming only the subsequent attempt',
  async (fault) => {
    await ready();
    await invoke('check');
    if (fault === 'original')
      vi.mocked(dependencies.verifyOriginal).mockImplementation(() => {
        throw new Error(secret);
      });
    if (fault === 'source')
      vi.mocked(binding.verifySource)
        .mockImplementationOnce(() => {})
        .mockImplementation(() => {
          throw new Error(secret);
        });
    if (fault === 'intent') writeFileSync(join(root(), 'intent.json'), '{}');
    if (fault === 'receipt') write(file('sm12-baseline.json'), {});
    if (fault === 'image') writeFileSync(file('sm12-user.jpg'), Buffer.from('changed'));
    if (fault === 'expiry') vi.advanceTimersByTime(300001);
    await expect(invoke('execute')).resolves.toMatchObject({
      failure: true,
      mutationAttempted: false,
      deleteAttempted: false,
      stoppedAt: 'prerequisites',
    });
    noNative();
    const saved = tree();
    await expect(invoke('execute')).rejects.toThrow();
    expect(tree()).toBe(saved);
  },
);
it('detects an image changing during the offline check itself', async () => {
  await ready();
  let checks = 0;
  vi.mocked(binding.verifySource).mockImplementation(() => {
    if (++checks === 3) writeFileSync(file('sm12-user.jpg'), 'changed');
  });
  await expect(invoke('check')).rejects.toMatchObject({ reason: 'recovery-baseline' });
  noNative();
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
});
it('rechecks freshness after dependency setup before calling the cleanup driver', async () => {
  await ready();
  vi.mocked(dependencies.createClient).mockImplementation(() => {
    vi.advanceTimersByTime(300001);
    return {} as never;
  });
  await expect(invoke('execute')).resolves.toMatchObject({
    failure: true,
    mutationAttempted: false,
    deleteAttempted: false,
    reason: 'recovery-baseline',
  });
  expect(dependencies.execute).not.toHaveBeenCalled();
  await expect(invoke('execute')).rejects.toThrow();
});
it('does not mask receipt drift after DELETE as success or replay the consumed claim', async () => {
  await ready();
  vi.mocked(dependencies.execute).mockImplementation(async (input) => {
    input.record({ stage: 'request', method: 'DELETE' });
    writeFileSync(file('sm12-user.jpg'), 'changed');
    input.verifySource();
    return success();
  });
  await expect(invoke('execute')).resolves.toMatchObject({
    failure: true,
    mutationAttempted: 'unknown',
    deleteAttempted: true,
    confirmedDeleted: false,
  });
  expect(dependencies.execute).toHaveBeenCalledTimes(1);
  await expect(invoke('execute')).rejects.toThrow();
});
it.each(['source', 'original', 'intent', 'receipt', 'suffix-image', 'user-image'])(
  'rechecks %s after the driver returns, preserving confirmed cleanup and the consumed claim',
  async (fault) => {
    await ready();
    vi.mocked(dependencies.execute).mockImplementation(async (input) => {
      input.verifySource();
      input.record({ stage: 'request', method: 'DELETE' });
      await Promise.resolve();
      if (fault === 'source')
        vi.mocked(binding.verifySource).mockImplementation(() => {
          throw new Error(secret);
        });
      if (fault === 'original')
        vi.mocked(dependencies.verifyOriginal).mockImplementation(() => {
          throw new Error(secret);
        });
      if (fault === 'intent') writeFileSync(join(root(), 'intent.json'), '{}');
      if (fault === 'receipt') write(file('sm12-baseline.json'), {});
      if (fault === 'suffix-image' || fault === 'user-image')
        writeFileSync(file(`sm12-${fault === 'suffix-image' ? 'suffix' : 'user'}.jpg`), 'changed');
      return success();
    });
    const result = await invoke('execute');
    expect(result).toMatchObject({
      ...success(),
      failure: true,
      inspectionRequired: [v3RecoveryFixture.owner],
    });
    const { root: attempt, ...outcome } = result;
    expect(read(join(attempt, 'result.json'))).toEqual(outcome);
    expect(dependencies.execute).toHaveBeenCalledTimes(1);
    const saved = tree();
    await expect(invoke('execute')).rejects.toThrow();
    expect(tree()).toBe(saved);
    expect(dependencies.execute).toHaveBeenCalledTimes(1);
  },
);
it('retains an earlier cleanup failure when final immutable verification also fails', async () => {
  await ready();
  vi.mocked(dependencies.execute).mockImplementation(async (input) => {
    input.record({ stage: 'request', method: 'DELETE' });
    writeFileSync(file('sm12-user.jpg'), 'changed');
    return {
      ...success(),
      failure: true,
      cleanupConfirmed: false,
      reason: 'deleted-cleanup-unconfirmed' as const,
      inspectionRequired: [v3RecoveryFixture.owner],
    };
  });
  const result = await invoke('execute');
  expect(result).toMatchObject({
    failure: true,
    confirmedDeleted: true,
    cleanupConfirmed: false,
    reason: 'deleted-cleanup-unconfirmed',
    remaining: [],
    inspectionRequired: [v3RecoveryFixture.owner],
  });
  const records = readdirSync(join(root(), 'attempt/run')).map((name) => read(join(root(), 'attempt/run', name)).value);
  expect(records).toContainEqual({ recoveryUnconfirmed: true, reason: 'recovery-baseline' });
});
it('still verifies immutable evidence but exempts freshness expiry after an observed DELETE', async () => {
  await ready();
  vi.mocked(dependencies.execute).mockImplementation(async (input) => {
    input.verifySource();
    input.record({ stage: 'request', method: 'DELETE' });
    vi.advanceTimersByTime(300001);
    return success();
  });
  await expect(invoke('execute')).resolves.toMatchObject(success());
  expect(read(join(root(), 'attempt/result.json'))).toEqual(success());
  expect(dependencies.execute).toHaveBeenCalledTimes(1);
});
it.each([
  ['toString', revision],
  ['constructor', revision],
  ['--execute-reviewed-v3-ddls-cleanup', 'short'],
  ['--execute-reviewed-v3-ddls-cleanup', revision, 'other'],
])('refuses malformed phase %j without binding', async (...args) => {
  await expect(runNativeV3Recovery(args, dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
  noNative();
});
it('keeps exact runtime/debug restrictions', () => {
  expect(() => assertV3RecoveryRuntime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
  expect(() => assertV3RecoveryRuntime({}, ['--import', 'tsx'], 'v24.0.0')).toThrow();
  expect(() => assertV3RecoveryRuntime({ ARC1_LOG_HTTP_DEBUG: 'false' }, ['--import', 'tsx'], 'v22.21.1')).toThrow();
});
