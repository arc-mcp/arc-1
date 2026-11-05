import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PREREQUISITE_AGE_MS } from '../../../scripts/qualification/pr1142/native-declarative-prerequisites.js';
import {
  assertDeclarativeV4Runtime,
  runNativeDeclarativeV4,
} from '../../../scripts/qualification/pr1142/native-declarative-v4.js';
import { DECLARATIVE_V4 } from '../../../scripts/qualification/pr1142/native-declarative-v4-evidence.js';
import {
  DECLARATIVE_V4_HISTORY,
  verifyDeclarativeV4History,
} from '../../../scripts/qualification/pr1142/native-declarative-v4-history.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';

vi.mock('../../../scripts/qualification/pr1142/native-declarative-v4-history.js', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/native-declarative-v4-history.js')>()),
  verifyDeclarativeV4History: vi.fn(),
}));

const revision = 'a'.repeat(40);
const secret = 'V4-PRIVATE-TEST-PASSWORD';
const digest = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
// Minimal bounded JPEG marker fixture: SOI, 8-bit frame, scan, byte-stuffed entropy and EOI.
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
let temporary: string;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeV4>[1]>;
let get: ReturnType<typeof vi.fn<AdtHttpClient['get']>>;
const root = () => join(temporary, DECLARATIVE_V4);
const attempt = () => join(root(), 'attempt');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const invoke = (phase: 'prepare' | 'preflight' | 'check' | 'execute', sample?: string) =>
  runNativeDeclarativeV4([`--${phase}-reviewed-declarative-v4`, revision, ...(sample ? [sample] : [])], dependencies);
const result = () => read(join(attempt(), 'result.json'));
function outcome(input: Parameters<typeof dependencies.execute>[0]) {
  return {
    failure: false,
    mutationAttempted: true,
    completed: input.fixtures.map((f) => f.owner),
    remaining: [],
    confirmedDeleted: [...input.fixtures].reverse().map((f) => f.owner),
    pendingCreation: [],
    createNeverSent: [],
    inspectionRequired: [],
    cleanupIssues: [],
    cleanupNotAttempted: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
    stopped: false,
  };
}
beforeEach(() => {
  vi.mocked(verifyDeclarativeV4History).mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T22:00:00.000Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-native-v4-'));
  get = vi.fn(async (path) => {
    if (path === '/sap/bc/adt/activation/inactiveobjects')
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/xml' },
        body: '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
      };
    const intent = read(join(root(), 'intent.json'));
    if (!intent.fixtures.some((fixture: { owner: string }) => fixture.owner === path))
      throw new Error('Unexpected fixture read.');
    throw new AdtApiError(
      'Not found',
      404,
      path,
      '<exc:exception xmlns:exc="urn:x"><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>',
    );
  });
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async (sha) => ({
      repo: temporary,
      root: root(),
      verifySource: vi.fn(),
      evidence: {
        revision: sha,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        repo: temporary,
        dependencyLimit: 'fixture',
      },
    })),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_CLIENT: '001',
      SAP_PASSWORD: secret,
    })),
    createClient: vi.fn(() => ({ http: { get } }) as unknown as AdtClient),
    execute: vi.fn(async (input) => outcome(input)),
    confirmAbsence: vi.fn(async () => {}),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});

async function preparedSample() {
  await invoke('prepare');
  const proof = await invoke('preflight');
  if (proof.mode !== 'preflight') throw new Error('Wrong phase.');
  return proof;
}
function baseline(sample: Awaited<ReturnType<typeof preparedSample>>) {
  const intent = read(join(root(), 'intent.json'));
  const search = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: digest(jpeg),
  };
  const proof = {
    protocol: DECLARATIVE_V4,
    revision,
    intentHash: sample.intentHash,
    preflightId: sample.preflightId,
    suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  write(join(sample.root, 'sm12-baseline.json'), proof);
  for (const name of ['suffix', 'user']) writeFileSync(join(sample.root, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return proof;
}
function persisted(path = root()): string {
  return readdirSync(path, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory() ? persisted(join(path, entry.name)) : readFileSync(join(path, entry.name)).toString(),
    )
    .join('\n');
}

it('creates only the fixed V4 six-owner intent, binding every historical receipt without changing old claims', async () => {
  for (const name of ['v1', 'v2', 'v3', 'v3-recovery-v1']) {
    const old = join(temporary, `pr1142-native-declarative-${name}`);
    mkdirSync(old, { mode: 0o700 });
    write(join(old, 'result.json'), { consumed: name });
  }
  expect(await invoke('prepare')).toMatchObject({ failure: false, mutationAttempted: false });
  const intent = read(join(root(), 'intent.json'));
  expect(intent.history).toEqual(DECLARATIVE_V4_HISTORY);
  expect(intent.fixtures).toHaveLength(6);
  expect(intent.fixtures.every((f: { name: string }) => /^ZARC1_V4[VADXS]_[A-F0-9]{16}$/.test(f.name))).toBe(true);
  for (const name of ['v1', 'v2', 'v3', 'v3-recovery-v1'])
    expect(read(join(temporary, `pr1142-native-declarative-${name}/result.json`))).toEqual({ consumed: name });
  expect(verifyDeclarativeV4History).toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(existsSync(attempt())).toBe(false);
});
it('checks fresh raw JPEG proof with no writes, credential/native dependencies, or execution grant', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const before = persisted();
  vi.clearAllMocks();
  expect(await invoke('check', sample.preflightId)).toMatchObject({
    failure: false,
    attemptClaimed: false,
    executionGrant: false,
  });
  expect(persisted()).toBe(before);
  expect(existsSync(attempt())).toBe(false);
  expect(dependencies.bind).toHaveBeenCalledWith(revision, expect.any(URL), undefined, { readOnly: true });
  for (const fn of [
    dependencies.readEnv,
    dependencies.createClient,
    dependencies.execute,
    dependencies.confirmAbsence,
    get,
    process.umask,
  ])
    expect(fn).not.toHaveBeenCalled();
});
it.each(['prepare', 'preflight', 'check', 'execute'] as const)(
  'refuses changed predecessor proof at %s before credentials',
  async (phase) => {
    const sample = phase === 'prepare' ? undefined : await preparedSample();
    if (sample) baseline(sample);
    vi.mocked(verifyDeclarativeV4History).mockImplementation(() => {
      throw new Error('changed private history');
    });
    vi.clearAllMocks();
    await expect(
      invoke(phase, phase === 'check' || phase === 'execute' ? sample?.preflightId : undefined),
    ).rejects.toThrow();
    expect(dependencies.readEnv).not.toHaveBeenCalled();
    expect(dependencies.execute).not.toHaveBeenCalled();
    expect(existsSync(attempt())).toBe(phase === 'execute');
    if (phase === 'execute') expect(result()).toMatchObject({ failure: true, mutationAttempted: false });
  },
);
it.each(['history', 'intent', 'image', 'expired'] as const)(
  'execute rechecks %s after successful offline check and never replays',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    await invoke('check', sample.preflightId);
    if (change === 'history')
      vi.mocked(verifyDeclarativeV4History).mockImplementation(() => {
        throw new Error();
      });
    if (change === 'intent') {
      const intent = read(join(root(), 'intent.json'));
      delete intent.history;
      write(join(root(), 'intent.json'), intent);
    }
    if (change === 'image') writeFileSync(join(sample.root, 'sm12-user.jpg'), 'changed');
    if (change === 'expired') vi.setSystemTime(Date.now() + PREREQUISITE_AGE_MS + 1);
    vi.clearAllMocks();
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(result()).toMatchObject({ failure: true, mutationAttempted: false, stoppedAt: 'prerequisites' });
    expect(dependencies.readEnv).not.toHaveBeenCalled();
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(dependencies.execute).not.toHaveBeenCalled();
  },
);
it.each([
  'preflight-before-intent',
  'baseline-before-preflight',
  'future',
  'nonzero',
  'old-protocol',
  'malformed-jpeg',
  'wrong-extension',
])('offline check refuses %s without claiming the attempt', async (change) => {
  const sample = await preparedSample(),
    proof = baseline(sample);
  if (change === 'preflight-before-intent') {
    const path = join(sample.root, 'result.json');
    const pre = read(path);
    pre.startedAt = new Date(Date.now() - 1).toISOString();
    write(path, pre);
  }
  if (change === 'baseline-before-preflight') proof.userSearch.observedAt = new Date(Date.now() - 1).toISOString();
  if (change === 'future') proof.userSearch.observedAt = new Date(Date.now() + 1).toISOString();
  if (change === 'nonzero') Object.assign(proof.userSearch, { lockCount: 1 });
  if (change === 'old-protocol') proof.protocol = 'pr1142-native-declarative-v3';
  if (change === 'malformed-jpeg') {
    const bytes = jpeg.subarray(0, -2);
    writeFileSync(join(sample.root, 'sm12-user.jpg'), bytes);
    proof.userSearch.evidenceSha256 = digest(bytes);
  }
  if (change === 'wrong-extension') {
    writeFileSync(join(sample.root, 'sm12-user.png'), jpeg, { mode: 0o600 });
    rmSync(join(sample.root, 'sm12-user.jpg'));
  }
  write(join(sample.root, 'sm12-baseline.json'), proof);
  vi.clearAllMocks();
  await expect(invoke('check', sample.preflightId)).rejects.toThrow();
  expect(existsSync(attempt())).toBe(false);
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it.each([
  'preflight-env',
  'execute-env',
  'preflight-client',
  'execute-client',
  'failed-execute',
  'independent-absence',
])('detects immutable binding drift at the %s boundary and retains native facts', async (boundary) => {
  const sample = await preparedSample();
  baseline(sample);
  let broken = false;
  vi.mocked(verifyDeclarativeV4History).mockImplementation(() => {
    if (broken) throw new Error();
  });
  const env = { SAP_URL: 'https://a4h.marianzeis.de', SAP_CLIENT: '001', SAP_USER: 'MARIAN', SAP_PASSWORD: secret };
  if (boundary.endsWith('env'))
    vi.mocked(dependencies.readEnv).mockImplementation(() => {
      broken = true;
      return env;
    });
  if (boundary.endsWith('client'))
    vi.mocked(dependencies.createClient).mockImplementation(() => {
      broken = true;
      return { http: { get } } as unknown as AdtClient;
    });
  if (boundary === 'failed-execute')
    vi.mocked(dependencies.execute).mockImplementation(async (input) => {
      broken = true;
      return { ...outcome(input), failure: true };
    });
  if (boundary === 'independent-absence')
    vi.mocked(dependencies.confirmAbsence).mockImplementation(async () => {
      broken = true;
    });
  vi.clearAllMocks();
  if (boundary.endsWith('client') || boundary.endsWith('env')) {
    await expect(
      invoke(
        boundary.startsWith('preflight') ? 'preflight' : 'execute',
        boundary.startsWith('execute') ? sample.preflightId : undefined,
      ),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(dependencies.execute).not.toHaveBeenCalled();
    if (boundary.endsWith('env')) {
      expect(dependencies.createClient).not.toHaveBeenCalled();
      expect(env).not.toHaveProperty('SAP_PASSWORD');
    }
  } else {
    const result = await invoke('execute', sample.preflightId);
    expect(result).toMatchObject({
      failure: true,
      bindingUnconfirmed: true,
      cleanupUnconfirmed: true,
      finalAbsenceConfirmed: true,
    });
    if (!('confirmedDeleted' in result)) throw new Error('Missing result');
    expect(result.confirmedDeleted).toHaveLength(6);
    expect(result.inspectionRequired).toHaveLength(6);
  }
});
it('permits baseline age after mutation while retaining immutable proof checks and refusing all replay', async () => {
  const sample = await preparedSample();
  baseline(sample);
  vi.mocked(dependencies.execute).mockImplementation(async (input) => {
    input.record({ stage: 'request', method: 'POST', path: input.fixtures[0].owner });
    vi.setSystemTime(Date.now() + PREREQUISITE_AGE_MS + 1);
    input.verifySource();
    return outcome(input);
  });
  expect(await invoke('execute', sample.preflightId)).toMatchObject({
    failure: false,
    independentAbsence: 'confirmed',
  });
  for (const phase of ['prepare', 'preflight', 'check', 'execute'] as const)
    await expect(
      invoke(phase, phase === 'check' || phase === 'execute' ? sample.preflightId : undefined),
    ).rejects.toThrow();
  expect(dependencies.execute).toHaveBeenCalledOnce();
  expect(persisted()).not.toContain(secret);
});
it('awaits asynchronous source binding and independently repeats evidence reads', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const original = vi.mocked(dependencies.bind).getMockImplementation()!;
  let resume!: (value: Awaited<ReturnType<typeof dependencies.bind>>) => void;
  vi.mocked(dependencies.bind).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  );
  const pending = invoke('check', sample.preflightId);
  writeFileSync(join(sample.root, 'sm12-user.jpg'), 'changed while awaiting source');
  resume(await original(revision, new URL('file:///fixture')));
  await expect(pending).rejects.toThrow();
  expect(existsSync(attempt())).toBe(false);
});
it('keeps exact runtime and fixed-argument admission', async () => {
  expect(() => assertDeclarativeV4Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
  expect(() => assertDeclarativeV4Runtime({}, ['--import', 'tsx'], 'v22.18.0')).toThrow('v4-runtime');
  expect(() => assertDeclarativeV4Runtime({ ARC1_LOG_HTTP_DEBUG: 'false' }, ['--import', 'tsx'], 'v22.21.1')).toThrow(
    'v4-runtime',
  );
  for (const args of [
    [],
    ['--execute-reviewed-declarative-v3', revision, 'A'.repeat(16)],
    ['--prepare-reviewed-declarative-v4', revision, '--root=/tmp/other'],
  ])
    await expect(runNativeDeclarativeV4(args, dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
});
