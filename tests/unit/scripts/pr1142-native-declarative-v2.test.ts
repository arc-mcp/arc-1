import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assertDeclarativeV2Runtime,
  runNativeDeclarativeV2,
} from '../../../scripts/qualification/pr1142/native-declarative-v2.js';
import {
  DECLARATIVE_V2,
  PREREQUISITE_AGE_MS,
  privateEvidence,
} from '../../../scripts/qualification/pr1142/native-declarative-v2-intent.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';

const revision = 'a'.repeat(40);
const secret = 'V2-PRIVATE-TEST-PASSWORD';
const digest = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');
const png = Buffer.from('89504e470d0a1a0a0000000046495854555245', 'hex');
let temporary: string;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeV2>[1]>;
let get: ReturnType<typeof vi.fn<AdtHttpClient['get']>>;
const root = () => join(temporary, DECLARATIVE_V2);
const attempt = () => join(root(), 'attempt');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const invoke = (phase: 'prepare' | 'preflight' | 'execute', sample?: string) =>
  runNativeDeclarativeV2([`--${phase}-reviewed-declarative-v2`, revision, ...(sample ? [sample] : [])], dependencies);
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
  temporary = mkdtempSync(join(tmpdir(), 'arc1-native-v2-'));
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
    evidenceSha256: digest(png),
  };
  const proof = {
    protocol: DECLARATIVE_V2,
    revision,
    intentHash: sample.intentHash,
    preflightId: sample.preflightId,
    suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  write(join(sample.root, 'sm12-baseline.json'), proof);
  for (const name of ['suffix', 'user']) writeFileSync(join(sample.root, `sm12-${name}.png`), png, { mode: 0o600 });
  return proof;
}
function persisted(path = root()): string {
  return readdirSync(path, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory() ? persisted(join(path, entry.name)) : readFileSync(join(path, entry.name)).toString(),
    )
    .join('\n');
}

it('prepares only local immutable intent and leaves consumed v1/recovery claims byte-identical', async () => {
  for (const name of ['pr1142-native-declarative-v1', 'pr1142-native-declarative-recovery-v1']) {
    mkdirSync(join(temporary, name), { mode: 0o700 });
    writeFileSync(join(temporary, name, 'result.json'), 'original consumed receipt', { mode: 0o600 });
  }
  const prepared = await invoke('prepare');
  expect(prepared).toMatchObject({ mode: 'prepare', failure: false, mutationAttempted: false });
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(existsSync(attempt())).toBe(false);
  const before = readFileSync(join(root(), 'intent.json'));
  await expect(invoke('prepare')).rejects.toThrow();
  expect(readFileSync(join(root(), 'intent.json'))).toEqual(before);
  for (const name of ['pr1142-native-declarative-v1', 'pr1142-native-declarative-recovery-v1'])
    expect(readFileSync(join(temporary, name, 'result.json'), 'utf8')).toBe('original consumed receipt');
});

it.each([
  [],
  ['--execute-reviewed-declarative', revision],
  ['--prepare-reviewed-declarative-v2', 'short'],
  ['--execute-reviewed-declarative-v2', revision],
  ['--execute-reviewed-declarative-v2', revision, '../old'],
  ['--prepare-reviewed-declarative-v2', revision, 'extra'],
  ['--preflight-reviewed-declarative-v2', revision, 'extra'],
])('refuses invalid input %j before state or credentials', async (...args) => {
  await expect(runNativeDeclarativeV2(args, dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it('validates runtime before binding or credential access', async () => {
  dependencies.validateRuntime = () => {
    throw new Error('runtime');
  };
  await expect(invoke('prepare')).rejects.toThrow('runtime');
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it('pins the runtime and retains all existing diagnostic/trust-root refusals', () => {
  expect(() => assertDeclarativeV2Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
  expect(() => assertDeclarativeV2Runtime({}, ['--import', 'tsx'], 'v22.18.0')).toThrow('v2-runtime');
  expect(() => assertDeclarativeV2Runtime({ NODE_EXTRA_CA_CERTS: '' }, ['--import', 'tsx'], 'v22.21.1')).toThrow();
  expect(() => assertDeclarativeV2Runtime({}, ['--require', 'other'], 'v22.21.1')).toThrow();
});
it('preflights exactly the saved six owners and inventory, with bounded GET-only no-replay reads', async () => {
  const sample = await preparedSample();
  const intent = read(join(root(), 'intent.json'));
  expect(sample).toMatchObject({ failure: false, mutationAttempted: false, inventory: 'valid-without-suffix' });
  expect(get.mock.calls.map(([path]) => path)).toEqual([
    ...intent.fixtures.map((f: { owner: string }) => f.owner),
    '/sap/bc/adt/activation/inactiveobjects',
  ]);
  for (const [, , options] of get.mock.calls) {
    expect(options).toMatchObject({ noReplay: true, retryTransientErrors: false });
    expect(options!.deadline).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(options!.responseBudget!.limitBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  }
  expect(dependencies.createClient).toHaveBeenCalledWith(
    expect.objectContaining({ safety: expect.objectContaining({ allowWrites: false }) }),
  );
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(existsSync(attempt())).toBe(false);
});
it('retains an untyped preflight failure and sends no other read or mutation', async () => {
  await invoke('prepare');
  get.mockRejectedValue(new AdtApiError('SECRET-TEXT', 404, '/sap/bc/adt/test', '<html>not typed</html>'));
  await expect(invoke('preflight')).rejects.toMatchObject({ reason: 'absence-not-typed' });
  expect(get).toHaveBeenCalledOnce();
  expect(persisted()).toContain('absence-not-typed');
  expect(persisted()).not.toContain('SECRET-TEXT');
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('allows a fresh read-only sample without changing intent, then refuses samples after the one attempt', async () => {
  const first = await preparedSample();
  const second = await invoke('preflight');
  expect(second.mode).toBe('preflight');
  if (second.mode !== 'preflight') throw new Error('Wrong phase.');
  expect(second.preflightId).not.toBe(first.preflightId);
  expect(second.intentHash).toBe(first.intentHash);
  baseline(second);
  await invoke('execute', second.preflightId);
  const before = get.mock.calls.length;
  await expect(invoke('preflight')).rejects.toMatchObject({ reason: 'v2-claimed' });
  expect(get).toHaveBeenCalledTimes(before);
});
it('stops a concurrent preflight before its next GET once the mutation claim appears', async () => {
  await invoke('prepare');
  const original = get.getMockImplementation()!;
  get.mockImplementationOnce(async (...args) => {
    mkdirSync(attempt(), { mode: 0o700 });
    return original(...args);
  });
  await expect(invoke('preflight')).rejects.toMatchObject({ reason: 'absence-read-failed' });
  expect(get).toHaveBeenCalledOnce();
});
it('requires SM12 baseline evidence before credentials and consumes even that refused attempt', async () => {
  const sample = await preparedSample();
  dependencies.readEnv = vi.fn(() => {
    throw new Error('must not read');
  });
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-baseline' });
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(result()).toMatchObject({ failure: true, mutationAttempted: false, stoppedAt: 'prerequisites' });
  baseline(sample);
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('consumes and refuses an attempt while another preflight is still reading, without loading write credentials', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const original = get.getMockImplementation()!;
  get.mockImplementationOnce(async (...args) => {
    const credentialReads = vi.mocked(dependencies.readEnv).mock.calls.length;
    await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-preflight' });
    expect(dependencies.readEnv).toHaveBeenCalledTimes(credentialReads);
    return original(...args);
  });
  await expect(invoke('preflight')).rejects.toMatchObject({ reason: 'absence-read-failed' });
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(result()).toMatchObject({ mutationAttempted: false, failure: true, stoppedAt: 'prerequisites' });
  expect(existsSync(join(root(), 'preflight-running'))).toBe(false);
});
it.each(['fixture', 'binding', 'protocol', 'extra'])('refuses altered immutable intent: %s', async (change) => {
  const sample = await preparedSample();
  baseline(sample);
  const path = join(root(), 'intent.json'),
    intent = read(path);
  if (change === 'fixture') intent.fixtures[0].source += '\n// caller source';
  if (change === 'binding') intent.binding.revision = 'd'.repeat(40);
  if (change === 'protocol') intent.protocol = 'pr1142-native-declarative-v1';
  if (change === 'extra') intent.extra = true;
  write(path, intent);
  const reads = get.mock.calls.length;
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-intent' });
  expect(get).toHaveBeenCalledTimes(reads);
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it.each(['failed', 'missing-owner', 'wrong-intent', 'wrong-revision', 'stale', 'future'])(
  'refuses invalid preflight proof: %s',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    const path = join(sample.root, 'result.json'),
      proof = read(path);
    if (change === 'failed') proof.failure = true;
    if (change === 'missing-owner') proof.verifiedOwners.pop();
    if (change === 'wrong-intent') proof.intentHash = 'e'.repeat(64);
    if (change === 'wrong-revision') proof.revision = 'e'.repeat(40);
    if (change === 'stale') proof.startedAt = new Date(Date.now() - PREREQUISITE_AGE_MS - 1).toISOString();
    if (change === 'future') proof.completedAt = new Date(Date.now() + 1).toISOString();
    write(path, proof);
    await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-preflight' });
    expect(dependencies.execute).not.toHaveBeenCalled();
  },
);
it.each([
  'locks',
  'wrong-user',
  'wrong-suffix',
  'wrong-client',
  'wrong-sample',
  'wrong-image',
  'missing-image',
  'stale',
  'before-preflight',
  'public-file',
  'symlink',
])('refuses invalid SM12 proof: %s', async (change) => {
  const sample = await preparedSample(),
    proof = baseline(sample);
  const path = join(sample.root, 'sm12-baseline.json');
  if (change === 'locks') proof.userSearch.lockCount = 1;
  if (change === 'wrong-user') proof.userSearch.user = 'OTHER';
  if (change === 'wrong-suffix') proof.suffixSearch.argument = '*OLD*';
  if (change === 'wrong-client') proof.userSearch.client = '100';
  if (change === 'wrong-sample') proof.preflightId = 'F'.repeat(16);
  if (change === 'wrong-image') proof.userSearch.evidenceSha256 = 'f'.repeat(64);
  if (change === 'missing-image') rmSync(join(sample.root, 'sm12-suffix.png'));
  if (change === 'stale') proof.userSearch.observedAt = new Date(Date.now() - PREREQUISITE_AGE_MS - 1).toISOString();
  if (change === 'before-preflight') proof.userSearch.observedAt = new Date(Date.now() - 1).toISOString();
  write(path, proof);
  if (change === 'public-file') chmodSync(path, 0o644);
  if (change === 'symlink') {
    const other = join(temporary, 'baseline.json');
    write(other, proof);
    rmSync(path);
    symlinkSync(other, path);
  }
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-baseline' });
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('executes the exact intent once, preserves independent cleanup evidence, and never replays under another revision', async () => {
  const sample = await preparedSample();
  baseline(sample);
  const response = await invoke('execute', sample.preflightId);
  expect(response).toMatchObject({ mode: 'execute', failure: false, independentAbsence: 'confirmed' });
  expect(dependencies.execute).toHaveBeenCalledOnce();
  expect(dependencies.execute).toHaveBeenCalledWith(
    expect.objectContaining({ fixtures: read(join(root(), 'intent.json')).fixtures }),
  );
  expect(dependencies.confirmAbsence).toHaveBeenCalledOnce();
  expect(persisted()).not.toContain(secret);
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  await expect(
    runNativeDeclarativeV2(['--execute-reviewed-declarative-v2', 'd'.repeat(40), sample.preflightId], dependencies),
  ).rejects.toThrow();
  expect(dependencies.execute).toHaveBeenCalledOnce();
});
it.each(['intent', 'baseline', 'image'])(
  'rechecks %s immutability during execution and keeps an unexpected failure unknown',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    dependencies.execute = vi.fn(async (input) => {
      const path =
        change === 'intent'
          ? join(root(), 'intent.json')
          : join(sample.root, change === 'baseline' ? 'sm12-baseline.json' : 'sm12-user.png');
      writeFileSync(path, `${readFileSync(path, 'utf8')} `);
      input.verifySource();
      return outcome(input);
    });
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(result()).toMatchObject({ failure: true, mutationAttempted: 'unknown', cleanupUnconfirmed: true });
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(dependencies.execute).toHaveBeenCalledOnce();
  },
);
it.each(['intent', 'baseline', 'image'])(
  'refuses success when %s drifts during independent final absence',
  async (change) => {
    const sample = await preparedSample();
    baseline(sample);
    dependencies.confirmAbsence = vi.fn(async () => {
      const path =
        change === 'intent'
          ? join(root(), 'intent.json')
          : join(sample.root, change === 'baseline' ? 'sm12-baseline.json' : 'sm12-user.png');
      writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(' ')]));
    });
    const response = await invoke('execute', sample.preflightId);
    expect(response).toMatchObject({ failure: true, independentAbsence: 'unconfirmed', cleanupUnconfirmed: true });
    expect(result()).toMatchObject({ failure: true, independentAbsence: 'unconfirmed', cleanupUnconfirmed: true });
    expect(persisted()).toContain('source-binding');
    expect(persisted()).not.toContain(secret);
    await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
    expect(dependencies.execute).toHaveBeenCalledOnce();
  },
);

it.each(['true', 'false', '', '1'])('requires HTTP debug to be unset, including %j', (value) => {
  expect(() => assertDeclarativeV2Runtime({ ARC1_LOG_HTTP_DEBUG: value }, ['--import', 'tsx'], 'v22.21.1')).toThrow(
    'v2-runtime',
  );
});

it('checks freshness until the first mutation while preserving the existing longer cleanup window', async () => {
  const sample = await preparedSample();
  baseline(sample);
  dependencies.execute = vi.fn(async (input) => {
    input.verifySource();
    input.record({ stage: 'request', method: 'POST', path: '/sap/bc/adt/owned?_action=LOCK' });
    vi.setSystemTime(new Date(Date.now() + PREREQUISITE_AGE_MS + 1));
    expect(() => input.verifySource()).not.toThrow();
    return outcome(input);
  });
  expect(await invoke('execute', sample.preflightId)).toMatchObject({ failure: false });
});
it('refuses a stale baseline after credential/preflight delay but before the first mutation', async () => {
  const sample = await preparedSample();
  baseline(sample);
  dependencies.execute = vi.fn(async (input) => {
    vi.setSystemTime(new Date(Date.now() + PREREQUISITE_AGE_MS + 1));
    input.verifySource();
    return outcome(input);
  });
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-baseline' });
});
it('keeps a post-claim configuration refusal secret-safe and permanently consumed', async () => {
  const sample = await preparedSample();
  baseline(sample);
  dependencies.readEnv = vi.fn(() => {
    throw new Error(secret);
  });
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'configuration-env-unreadable' });
  expect(result()).toMatchObject({ mutationAttempted: false, failure: true, stoppedAt: 'configuration' });
  expect(persisted()).not.toContain(secret);
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it.each(['workflow', 'independent-absence', 'stop'])('never replays after a returned %s failure', async (mode) => {
  const sample = await preparedSample();
  baseline(sample);
  if (mode === 'independent-absence')
    dependencies.confirmAbsence = vi.fn(async () => {
      throw new Error(secret);
    });
  dependencies.execute = vi.fn(async (input) => {
    if (mode === 'stop') Reflect.apply(process.listeners('SIGTERM').at(-1)!, process, ['SIGTERM']);
    return {
      ...outcome(input),
      ...(mode === 'workflow' ? { failure: true, cleanupUnconfirmed: true, completed: [] } : {}),
    };
  });
  expect(await invoke('execute', sample.preflightId)).toMatchObject({ failure: true });
  expect(result().failure).toBe(true);
  expect(persisted()).not.toContain(secret);
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
  expect(dependencies.execute).toHaveBeenCalledOnce();
});
it('keeps invalid preflight credentials out of receipts and clears their password', async () => {
  await invoke('prepare');
  const env = {
    SAP_URL: 'https://a4h.marianzeis.de',
    SAP_USER: 'OTHER-PRIVATE-USER',
    SAP_CLIENT: '001',
    SAP_PASSWORD: secret,
  };
  dependencies.readEnv = vi.fn(() => env);
  await expect(invoke('preflight')).rejects.toMatchObject({ reason: 'configuration-env-invalid' });
  expect(env.SAP_PASSWORD).toBeUndefined();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(persisted()).toContain('SAP_USER');
  expect(persisted()).not.toContain('OTHER-PRIVATE-USER');
  expect(persisted()).not.toContain(secret);
});
it('rejects evidence files beyond the read budget', () => {
  const path = join(temporary, 'large.json');
  writeFileSync(path, 'x'.repeat(33), { mode: 0o600 });
  expect(() => privateEvidence(path, 32)).toThrow();
});

it('still refuses JPEG bytes named PNG before credentials and consumes the v2 attempt', async () => {
  const sample = await preparedSample();
  const proof = baseline(sample);
  const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
  writeFileSync(join(sample.root, 'sm12-user.png'), jpeg, { mode: 0o600 });
  proof.userSearch.evidenceSha256 = digest(jpeg);
  write(join(sample.root, 'sm12-baseline.json'), proof);
  vi.clearAllMocks();
  await expect(invoke('execute', sample.preflightId)).rejects.toMatchObject({ reason: 'v2-baseline' });
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(result()).toMatchObject({ mutationAttempted: false, stoppedAt: 'prerequisites' });
  await expect(invoke('execute', sample.preflightId)).rejects.toThrow();
});
