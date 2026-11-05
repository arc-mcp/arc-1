import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PREREQUISITE_AGE_MS } from '../../../scripts/qualification/pr1142/native-declarative-prerequisites.js';
import {
  assertDeclarativeV3Runtime,
  runNativeDeclarativeV3,
} from '../../../scripts/qualification/pr1142/native-declarative-v3.js';
import { DECLARATIVE_V3 } from '../../../scripts/qualification/pr1142/native-declarative-v3-evidence.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';

const revision = 'a'.repeat(40);
const secret = 'V3-PRIVATE-TEST-PASSWORD';
const digest = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
// Minimal bounded JPEG marker fixture: SOI, 8-bit frame, scan, byte-stuffed entropy and EOI.
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
let temporary: string;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeV3>[1]>;
let get: ReturnType<typeof vi.fn<AdtHttpClient['get']>>;
const root = () => join(temporary, DECLARATIVE_V3);
const attempt = () => join(root(), 'attempt');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const invoke = (phase: 'prepare' | 'preflight' | 'check' | 'execute', sample?: string) =>
  runNativeDeclarativeV3([`--${phase}-reviewed-declarative-v3`, revision, ...(sample ? [sample] : [])], dependencies);
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T22:00:00.000Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-native-v3-'));
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
        node: 'v32.21.1',
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
    protocol: DECLARATIVE_V3,
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

it('prepares a new fixed v3 claim and unchanged six-owner graph without touching v2', async () => {
  const old = join(temporary, 'pr1142-native-declarative-v2');
  mkdirSync(old, { mode: 0o700 });
  writeFileSync(join(old, 'result.json'), 'permanently consumed v2 receipt', { mode: 0o600 });
  expect(await invoke('prepare')).toMatchObject({ failure: false, mutationAttempted: false });
  expect(read(join(root(), 'intent.json')).fixtures).toHaveLength(6);
  expect(read(join(root(), 'intent.json')).fixtures.every((f: { name: string }) => f.name.startsWith('ZARC1_V2'))).toBe(
    true,
  );
  expect(readFileSync(join(old, 'result.json'), 'utf8')).toBe('permanently consumed v2 receipt');
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(existsSync(attempt())).toBe(false);
});
it('checks raw JPEG receipts read-only, without claiming or invoking native/credential dependencies', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const before = persisted();
  vi.clearAllMocks();
  const checked = await invoke('check', sample.preflightId);
  expect(checked).toMatchObject({
    mode: 'check',
    failure: false,
    mutationAttempted: false,
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
  expect(await invoke('check', sample.preflightId)).toMatchObject({ failure: false });
});
it('awaits the asynchronous binding before reading evidence', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const original = vi.mocked(dependencies.bind).getMockImplementation()!;
  let resolve!: (value: Awaited<ReturnType<typeof dependencies.bind>>) => void;
  vi.mocked(dependencies.bind).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const check = invoke('check', sample.preflightId);
  expect(existsSync(attempt())).toBe(false);
  resolve(await original(revision, new URL('file:///fixture')));
  expect(await check).toMatchObject({ mode: 'check', failure: false });
});
it.each([
  'wrong-hash',
  'wrong-extension',
  'png-bytes',
  'truncated',
  'invalid-length',
  'future',
  'stale',
  'wrong-protocol',
  'wrong-client',
  'locks',
  'preflight-stale',
])('offline check refuses %s without consuming the claim', async (change) => {
  const sample = await preparedSample(),
    proof = baseline(sample);
  const image = join(sample.root, 'sm12-user.jpg');
  if (change === 'wrong-hash') proof.userSearch.evidenceSha256 = 'f'.repeat(64);
  if (change === 'wrong-extension') {
    writeFileSync(join(sample.root, 'sm12-user.png'), jpeg, { mode: 0o600 });
    rmSync(image);
  }
  if (['png-bytes', 'truncated', 'invalid-length'].includes(change)) {
    const bytes =
      change === 'png-bytes'
        ? Buffer.from('89504e470d0a1a0a', 'hex')
        : change === 'truncated'
          ? jpeg.subarray(0, -2)
          : Buffer.from(`ffd8ffc0ffff${'00'.repeat(30)}ffd9`, 'hex');
    writeFileSync(image, bytes, { mode: 0o600 });
    proof.userSearch.evidenceSha256 = digest(bytes);
  }
  if (change === 'future') proof.userSearch.observedAt = new Date(Date.now() + 1).toISOString();
  if (change === 'stale') proof.userSearch.observedAt = new Date(Date.now() - PREREQUISITE_AGE_MS - 1).toISOString();
  if (change === 'wrong-protocol') proof.protocol = 'pr1142-native-declarative-v2';
  if (change === 'wrong-client') Object.assign(proof.userSearch, { client: '002' });
  if (change === 'locks') Object.assign(proof.userSearch, { lockCount: 1 });
  write(join(sample.root, 'sm12-baseline.json'), proof);
  if (change === 'preflight-stale') {
    const path = join(sample.root, 'result.json');
    const pre = read(path);
    pre.startedAt = new Date(Date.now() - PREREQUISITE_AGE_MS - 1).toISOString();
    write(path, pre);
  }
  vi.clearAllMocks();
  await expect(invoke('check', sample.preflightId)).rejects.toThrow();
  expect(existsSync(attempt())).toBe(false);
  for (const fn of [
    dependencies.readEnv,
    dependencies.createClient,
    dependencies.execute,
    dependencies.confirmAbsence,
    get,
  ])
    expect(fn).not.toHaveBeenCalled();
});
it('a corrected operator receipt can pass a subsequent offline check', async () => {
  const sample = await preparedSample();
  await expect(invoke('check', sample.preflightId)).rejects.toMatchObject({ reason: 'v3-baseline' });
  baseline(sample);
  expect(await invoke('check', sample.preflightId)).toMatchObject({ failure: false });
  expect(existsSync(attempt())).toBe(false);
});
it.each(['source', 'intent', 'preflight', 'baseline', 'image', 'stale'])(
  'execute rechecks %s after a passed offline check and permanently consumes failures',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    await invoke('check', sample.preflightId);
    if (change === 'source') {
      const original = vi.mocked(dependencies.bind).getMockImplementation()!;
      vi.mocked(dependencies.bind).mockImplementation(async (...args) => ({
        ...(await original(...args)),
        verifySource: () => {
          throw new Error('source drift');
        },
      }));
    } else if (change === 'stale') vi.setSystemTime(new Date(Date.now() + PREREQUISITE_AGE_MS + 1));
    else {
      const path =
        change === 'intent'
          ? join(root(), 'intent.json')
          : join(
              sample.root,
              change === 'preflight' ? 'result.json' : change === 'baseline' ? 'sm12-baseline.json' : 'sm12-user.jpg',
            );
      if (change === 'image') writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('changed')]));
      else {
        const value = read(path);
        value.extra = 'changed';
        write(path, value);
      }
    }
    vi.clearAllMocks();
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(result()).toMatchObject({ failure: true, mutationAttempted: false, stoppedAt: 'prerequisites' });
    for (const fn of [
      dependencies.readEnv,
      dependencies.createClient,
      dependencies.execute,
      dependencies.confirmAbsence,
      get,
    ])
      expect(fn).not.toHaveBeenCalled();
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  },
);
it.each(['image', 'expired', 'claim', 'preflight-running'])(
  'offline check catches %s changing during validation',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    const original = vi.mocked(dependencies.bind).getMockImplementation()!;
    vi.mocked(dependencies.bind).mockImplementation(async (...args) => ({
      ...(await original(...args)),
      verifySource: vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          if (change === 'image')
            writeFileSync(join(sample.root, 'sm12-user.jpg'), Buffer.concat([jpeg, Buffer.from('drift')]));
          if (change === 'expired') vi.setSystemTime(new Date(Date.now() + PREREQUISITE_AGE_MS + 1));
          if (change === 'claim') mkdirSync(attempt(), { mode: 0o700 });
          if (change === 'preflight-running') mkdirSync(join(root(), 'preflight-running'), { mode: 0o700 });
        }),
    }));
    vi.clearAllMocks();
    await expect(invoke('check', sample.preflightId)).rejects.toThrow();
    expect(dependencies.readEnv).not.toHaveBeenCalled();
    expect(dependencies.execute).not.toHaveBeenCalled();
  },
);
it('executes once through the unchanged driver and refuses every subsequent phase except no operation', async () => {
  const sample = await preparedSample();
  baseline(sample);
  await invoke('check', sample.preflightId);
  expect(await invoke('execute', sample.preflightId)).toMatchObject({
    failure: false,
    mode: 'execute',
    independentAbsence: 'confirmed',
  });
  for (const phase of ['prepare', 'preflight', 'check', 'execute'] as const)
    await expect(
      invoke(phase, phase === 'check' || phase === 'execute' ? sample.preflightId : undefined),
    ).rejects.toThrow();
  expect(dependencies.execute).toHaveBeenCalledOnce();
  expect(dependencies.confirmAbsence).toHaveBeenCalledOnce();
  expect(persisted()).not.toContain(secret);
});
it('preserves source/evidence checks during independent final absence', async () => {
  const sample = await preparedSample();
  baseline(sample);
  dependencies.confirmAbsence = vi.fn(async () => {
    writeFileSync(join(sample.root, 'sm12-user.jpg'), Buffer.concat([jpeg, Buffer.from('drift')]));
  });
  expect(await invoke('execute', sample.preflightId)).toMatchObject({
    failure: true,
    independentAbsence: 'unconfirmed',
    cleanupUnconfirmed: true,
  });
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  expect(dependencies.execute).toHaveBeenCalledOnce();
});
it.each(
  [
    [],
    ['--check-reviewed-declarative-v2', revision, 'A'.repeat(16)],
    ['--check-reviewed-declarative-v3', revision],
    ['--check-reviewed-declarative-v3', revision, '../sample'],
    ['--execute-reviewed-declarative-v3', revision, 'A'.repeat(16), '--profile=other'],
  ].map((args) => ({ args })),
)('rejects unsupported command arguments $args before binding', async ({ args }) => {
  await expect(runNativeDeclarativeV3(args, dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
});
it('retains exact Node, loader, trust-root and debug gates', () => {
  expect(() => assertDeclarativeV3Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
  expect(() => assertDeclarativeV3Runtime({}, ['--import', 'tsx'], 'v22.18.0')).toThrow('v3-runtime');
  expect(() => assertDeclarativeV3Runtime({ ARC1_LOG_HTTP_DEBUG: 'false' }, ['--import', 'tsx'], 'v22.21.1')).toThrow(
    'v3-runtime',
  );
  expect(() => assertDeclarativeV3Runtime({ NODE_EXTRA_CA_CERTS: '' }, ['--import', 'tsx'], 'v22.21.1')).toThrow();
});
