import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { runNativeDeclarativeRecovery } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-recovery.js'
);
const { recoveryFixture, recoveryMetadataHash, recoverySourceHash } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js'
);
const revision = 'a'.repeat(40);
const args = ['--execute-reviewed-inactive-ddls-cleanup', revision];
const PASSWORD = 'RECOVERY-ENTRY-FIXTURE-PASSWORD';
const PRIVATE_ERROR = 'PRIVATE-ERROR-WITH-SECRET';
let parent: string, root: string;
let env: Record<string, string>;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeRecovery>[1]>;
const success = {
  failure: false,
  mutationAttempted: true,
  deleteAttempted: true,
  confirmedDeleted: true,
  cleanupConfirmed: true,
  stopped: false,
  remaining: [],
  inspectionRequired: [],
};
const signalNames = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
let signalBaseline: number[];
beforeEach(() => {
  vi.resetAllMocks();
  parent = mkdtempSync(join(tmpdir(), 'arc1-recovery-entry-test-'));
  root = join(parent, 'recovery-claim');
  env = { SAP_URL: 'https://a4h.marianzeis.de', SAP_CLIENT: '001', SAP_USER: 'MARIAN', SAP_PASSWORD: PASSWORD };
  signalBaseline = signalNames.map((signal) => process.listenerCount(signal));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  // Every dependency touching runtime checks, Git, operator state, or credentials is injected.
  // The only real filesystem changes are this test's temporary claim and redacted receipts.
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => ({
      repo: parent,
      root,
      verifySource: vi.fn(),
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: process.version,
        repo: parent,
        dependencyLimit: 'fixture',
      },
    })),
    verifyOriginal: vi.fn(),
    readEnv: vi.fn(() => env),
    createClient: vi.fn((input) => new AdtClient(input)),
    execute: vi.fn(async () => ({ ...success })),
  };
});
function contents() {
  if (!existsSync(root)) return '';
  return readdirSync(root)
    .flatMap((name) =>
      name === 'run'
        ? readdirSync(join(root, name)).map((item) => readFileSync(join(root, name, item), 'utf8'))
        : readFileSync(join(root, name), 'utf8'),
    )
    .join('\n');
}
afterEach(() => {
  expect(mockFetch).not.toHaveBeenCalled();
  expect(signalNames.map((signal) => process.listenerCount(signal))).toEqual(signalBaseline);
  for (const secret of [PASSWORD, PRIVATE_ERROR]) expect(contents()).not.toContain(secret);
  vi.restoreAllMocks();
  rmSync(parent, { recursive: true, force: true });
});
const persisted = () => JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
it('claims a separate one-run cleanup before credentials, verifies original receipts, and binds exact native identity', async () => {
  const events: string[] = [];
  dependencies.validateRuntime = () => {
    events.push('runtime');
  };
  const bind = dependencies.bind;
  dependencies.bind = vi.fn(async (...input: Parameters<typeof bind>) => {
    events.push('binding');
    return bind(...input);
  });
  dependencies.verifyOriginal = vi.fn(() => {
    expect(existsSync(join(root, 'manifest.json'))).toBe(true);
    expect(existsSync(join(root, 'run'))).toBe(true);
    events.push('original-receipts');
  });
  dependencies.readEnv = vi.fn((repo) => {
    expect(repo).toBe(parent);
    events.push('credentials');
    return env;
  });
  dependencies.execute = vi.fn(async (input) => {
    events.push('execute');
    expect(input.shouldStop()).toBe(false);
    input.verifySource();
    input.record({ injectedTest: true });
    return { ...success };
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toEqual({ root, ...success });
  expect(events).toEqual(['runtime', 'binding', 'original-receipts', 'credentials', 'execute']);
  expect(dependencies.bind).toHaveBeenCalledWith(revision, expect.any(URL));
  expect(vi.mocked(dependencies.bind).mock.calls[0][1].pathname).toMatch(/\/native-declarative-recovery\.ts$/);
  expect(dependencies.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: 'MARIAN',
      password: PASSWORD,
      insecure: false,
      safety: expect.objectContaining({ allowWrites: true, allowedPackages: ['$TMP'] }),
    }),
  );
  expect(env.SAP_PASSWORD).toBeUndefined();
  expect(persisted()).toEqual(success);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({
    owner: recoveryFixture.owner,
    originalExperiment: 'pr1142-native-declarative-v1',
    identity: 'MARIAN',
    target: 'A4H/001',
    authentication: 'Basic-native cleanup only; not PP evidence',
    sourceHash: recoverySourceHash,
    metadataHash: recoveryMetadataHash,
  });
  expect(statSync(root).mode & 0o777).toBe(0o700);
  expect(statSync(join(root, 'manifest.json')).mode & 0o777).toBe(0o600);
  expect(statSync(join(root, 'result.json')).mode & 0o777).toBe(0o600);
});
it.each(['success', 'original-receipts', 'configuration', 'execution'])(
  'never reuses a claim after %s',
  async (stage) => {
    if (stage === 'original-receipts')
      dependencies.verifyOriginal = vi.fn(() => {
        throw new Error(PRIVATE_ERROR);
      });
    if (stage === 'configuration') env.SAP_CLIENT = '100';
    if (stage === 'execution')
      dependencies.execute = vi.fn(async () => {
        throw new Error(PRIVATE_ERROR);
      });
    await runNativeDeclarativeRecovery(args, dependencies);
    const original = contents();
    const reads = vi.mocked(dependencies.readEnv).mock.calls.length;
    const executions = vi.mocked(dependencies.execute).mock.calls.length;
    await expect(runNativeDeclarativeRecovery(args, dependencies)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(vi.mocked(dependencies.readEnv).mock.calls.length).toBe(reads);
    expect(vi.mocked(dependencies.execute).mock.calls.length).toBe(executions);
    expect(contents()).toBe(original);
  },
);
it('refuses a mismatched original failure receipt before reading credentials and retains the consumed claim', async () => {
  dependencies.verifyOriginal = vi.fn(() => {
    throw new Error(PRIVATE_ERROR);
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toMatchObject({
    root,
    failure: true,
    mutationAttempted: false,
    deleteAttempted: false,
    stoppedAt: 'original-receipts',
    remaining: [recoveryFixture.owner],
    inspectionRequired: [recoveryFixture.owner],
  });
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(persisted().stoppedAt).toBe('original-receipts');
});
it.each([
  ['SAP_URL', 'https://other.example'],
  ['SAP_CLIENT', '100'],
  ['SAP_USER', 'OTHER'],
  ['SAP_PASSWORD', ''],
])('journals only the invalid field name when %s is wrong', async (field, value) => {
  env[field] = value;
  const result = await runNativeDeclarativeRecovery(args, dependencies);
  expect(result).toMatchObject({
    failure: true,
    mutationAttempted: false,
    deleteAttempted: false,
    stoppedAt: 'configuration-env-invalid',
    invalidFields: [field],
  });
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(persisted()).toMatchObject({ invalidFields: [field] });
  expect(contents()).not.toContain('https://other.example');
});
it('journals an unreadable configuration without exposing its exception', async () => {
  dependencies.readEnv = vi.fn(() => {
    throw new Error(PRIVATE_ERROR);
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toMatchObject({
    failure: true,
    mutationAttempted: false,
    stoppedAt: 'configuration-env-unreadable',
  });
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('removes the temporary password even when client construction throws', async () => {
  dependencies.createClient = vi.fn(() => {
    throw new Error(PRIVATE_ERROR);
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toMatchObject({
    failure: true,
    mutationAttempted: false,
    stoppedAt: 'configuration-client',
  });
  expect(env.SAP_PASSWORD).toBeUndefined();
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('reports unknown mutation outcome and removes signal handlers if execution unexpectedly rejects', async () => {
  dependencies.execute = vi.fn(async () => {
    throw new Error(PRIVATE_ERROR);
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toMatchObject({
    failure: true,
    mutationAttempted: 'unknown',
    deleteAttempted: 'unknown',
    confirmedDeleted: false,
    stoppedAt: 'execution-error',
    remaining: [recoveryFixture.owner],
    inspectionRequired: [recoveryFixture.owner],
  });
  expect(persisted()).toMatchObject({ mutationAttempted: 'unknown', deleteAttempted: 'unknown' });
});
it.each(signalNames)(
  'lets %s request a stop without issuing native actions or leaving listeners behind',
  async (signal) => {
    dependencies.execute = vi.fn(async (input) => {
      expect(input.shouldStop()).toBe(false);
      const listener = process.listeners(signal).at(-1)!;
      listener(signal);
      expect(input.shouldStop()).toBe(true);
      return { ...success, failure: true, stopped: true };
    });
    await expect(runNativeDeclarativeRecovery(args, dependencies)).resolves.toMatchObject({
      failure: true,
      stopped: true,
    });
  },
);
it.each([
  { selected: [] },
  { selected: ['--execute-reviewed-declarative', revision] },
  { selected: [args[0], 'short'] },
  { selected: [args[0], revision.toUpperCase()] },
  { selected: [...args, '--retry'] },
])('rejects CLI arguments %j before any binding, claim or credential access', async ({ selected }) => {
  await expect(runNativeDeclarativeRecovery(selected, dependencies)).rejects.toThrow('Requires');
  expect(dependencies.validateRuntime).not.toHaveBeenCalled();
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});
it('validates the runtime before binding or creating a claim', async () => {
  dependencies.validateRuntime = vi.fn(() => {
    throw new Error('runtime refused');
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).rejects.toThrow('runtime refused');
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});
it('does not create a claim or read credentials when source binding rejects', async () => {
  dependencies.bind = vi.fn(async () => {
    throw new Error('binding refused');
  });
  await expect(runNativeDeclarativeRecovery(args, dependencies)).rejects.toThrow('binding refused');
  expect(dependencies.verifyOriginal).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});
