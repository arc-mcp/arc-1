import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assertRetainedRuntime,
  type RetainedDependencies,
  runNativeRetained,
} from '../../../scripts/qualification/pr1142/native-v5-retained.js';
import {
  originalResultHash,
  RETAINED_PROTOCOL,
  RETAINED_SUFFIX,
  retainedHash,
  retainedOwners,
  retainedStages,
} from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';

vi.mock('dotenv', async (original) => ({
  ...(await original<typeof import('dotenv')>()),
  config: vi.fn(() => ({ parsed: {} })),
}));
const revision = 'a'.repeat(40),
  secret = 'RETAINED-SYNTHETIC-PASSWORD';
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
let temporary: string, dependencies: RetainedDependencies, binding: Awaited<ReturnType<RetainedDependencies['bind']>>;
const root = () => join(temporary, RETAINED_PROTOCOL),
  read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const invoke = (phase: 'prepare' | 'preflight' | 'check' | 'execute', sample?: string) =>
  runNativeRetained([`--${phase}-reviewed-v5-retained`, revision, ...(sample ? [sample] : [])], dependencies);
const success = () => ({
  failure: false,
  mutationAttempted: true,
  mutationSubmitted: true,
  completed: [...retainedStages],
  confirmedDeleted: [...retainedOwners],
  cleanupConfirmed: true,
  finalAbsenceConfirmed: true,
  remaining: [],
  inspectionRequired: [],
  stopped: false,
});
function tree(path = root()): string {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      e.isDirectory()
        ? `${e.name}/${tree(join(path, e.name))}`
        : `${e.name}:${retainedHash(readFileSync(join(path, e.name)))}`,
    )
    .join('|');
}
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_SOCKET_GUARD');
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'retained-entry-'));
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
      dependencyLimit: 'synthetic',
    },
  };
  const receipt = {
    metadataHash: 'e'.repeat(64),
    sourceHash: 'f'.repeat(64),
    activeVerified: false,
    description: 'fixture',
  };
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    verifyHistory: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: secret,
    })),
    createClient: vi.fn(
      () => ({ http: { get: vi.fn(async () => ({ statusCode: 200, headers: {}, body: '' })) } }) as never,
    ),
    inspect: vi.fn(async () => ({ view: receipt, service: receipt })),
    execute: vi.fn(async (input) => {
      input.verifySource();
      return success();
    }),
  };
});
afterEach(() => {
  if (existsSync(root())) {
    const scan = (path: string) => {
      for (const e of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, e.name);
        if (e.isDirectory()) scan(file);
        else if (e.name.endsWith('.json')) expect(readFileSync(file, 'utf8')).not.toContain(secret);
      }
    };
    scan(root());
  }
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});
async function ready() {
  const prepared = await invoke('prepare');
  vi.advanceTimersByTime(1);
  const sample = await invoke('preflight');
  if (!('sample' in sample)) throw new Error('sample missing');
  vi.advanceTimersByTime(1);
  const search = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: retainedHash(jpeg),
  };
  const baseline = {
    protocol: RETAINED_PROTOCOL,
    revision,
    intentHash: prepared.intentHash,
    preflightId: sample.sample,
    originalResultHash,
    suffixSearch: { ...search, user: '*', argument: `*${RETAINED_SUFFIX}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  write(join(sample.root, 'sm12-baseline.json'), baseline);
  for (const name of ['suffix', 'user']) writeFileSync(join(sample.root, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return sample;
}
it('prepare is purely local and the offline check has no native dependencies, writes or claim', async () => {
  await invoke('prepare');
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(dependencies.inspect).not.toHaveBeenCalled();
});
it('nonclaiming check rereads all proofs without changing files or umask', async () => {
  const sample = await ready(),
    before = tree(),
    masks = vi.mocked(process.umask).mock.calls.length;
  vi.mocked(dependencies.readEnv).mockClear();
  vi.mocked(dependencies.createClient).mockClear();
  vi.mocked(dependencies.inspect).mockClear();
  expect(await invoke('check', sample.sample)).toMatchObject({
    failure: false,
    attemptClaimed: false,
    executionGrant: false,
    mutationAttempted: false,
  });
  expect(tree()).toBe(before);
  expect(process.umask).toHaveBeenCalledTimes(masks);
  expect(vi.mocked(dependencies.bind).mock.calls.at(-1)?.[3]).toEqual({ readOnly: true });
  expect(dependencies.readEnv).not.toHaveBeenCalled();
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(dependencies.inspect).not.toHaveBeenCalled();
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
});
it('awaits the source binding before creating any protocol state', async () => {
  let release!: (b: typeof binding) => void;
  vi.mocked(dependencies.bind).mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const pending = invoke('prepare');
  expect(existsSync(root())).toBe(false);
  release(binding);
  await pending;
  expect(existsSync(join(root(), 'intent.json'))).toBe(true);
});
it('consumes exactly one attempt and refuses subsequent execute/check/preflight without changing the result', async () => {
  const sample = await ready();
  expect((await invoke('execute', sample.sample)).failure).toBe(false);
  const saved = tree();
  for (const phase of ['execute', 'check', 'preflight'] as const)
    await expect(invoke(phase, phase === 'preflight' ? undefined : sample.sample)).rejects.toThrow();
  expect(tree()).toBe(saved);
  expect(dependencies.execute).toHaveBeenCalledTimes(1);
});
it.each(['JPEG', 'receipt', 'intent', 'preflight', 'stale', 'history', 'source'])(
  'rechecks %s after a successful check before credentials',
  async (fault) => {
    const sample = await ready();
    await invoke('check', sample.sample);
    vi.mocked(dependencies.readEnv).mockClear();
    if (fault === 'JPEG') writeFileSync(join(sample.root, 'sm12-user.jpg'), 'PNG', { mode: 0o600 });
    if (fault === 'receipt') {
      const p = join(sample.root, 'sm12-baseline.json'),
        d = read(p);
      d.userSearch.user = 'OTHER';
      write(p, d);
    }
    if (fault === 'intent') {
      const p = join(root(), 'intent.json'),
        d = read(p);
      d.owners = [];
      write(p, d);
    }
    if (fault === 'preflight') {
      const p = join(sample.root, 'result.json'),
        d = read(p);
      d.owners = [];
      write(p, d);
    }
    if (fault === 'stale') vi.advanceTimersByTime(300001);
    if (fault === 'history')
      vi.mocked(dependencies.verifyHistory).mockImplementation(() => {
        throw new Error('changed');
      });
    if (fault === 'source')
      vi.mocked(binding.verifySource).mockImplementation(() => {
        throw new Error('changed');
      });
    expect(await invoke('execute', sample.sample)).toMatchObject({
      failure: true,
      mutationAttempted: false,
      stoppedAt: 'prerequisites',
    });
    expect(dependencies.readEnv).not.toHaveBeenCalled();
    expect(existsSync(join(root(), 'attempt'))).toBe(true);
  },
);
it('stops on a prerequisite TOCTOU change after configuration was read', async () => {
  const sample = await ready();
  vi.mocked(dependencies.readEnv).mockImplementation(() => {
    writeFileSync(join(sample.root, 'sm12-suffix.jpg'), 'changed', { mode: 0o600 });
    return { SAP_URL: 'https://a4h.marianzeis.de', SAP_CLIENT: '001', SAP_USER: 'MARIAN', SAP_PASSWORD: secret };
  });
  expect((await invoke('execute', sample.sample)).failure).toBe(true);
  expect(dependencies.execute).not.toHaveBeenCalled();
});
it('retains confirmed outcomes while refusing late source drift or incomplete completion', async () => {
  const sample = await ready();
  vi.mocked(dependencies.execute).mockImplementation(async () => {
    vi.mocked(binding.verifySource).mockImplementation(() => {
      throw new Error('late');
    });
    return success();
  });
  expect(await invoke('execute', sample.sample)).toMatchObject({
    failure: true,
    confirmedDeleted: [...retainedOwners],
    cleanupConfirmed: true,
    inspectionRequired: [...retainedOwners],
  });
});
it.each(['stages', 'deletions', 'absence', 'cleanup'])(
  'refuses a successful driver missing %s evidence',
  async (field) => {
    const sample = await ready();
    vi.mocked(dependencies.execute).mockImplementation(async () => ({
      ...success(),
      ...(field === 'stages'
        ? { completed: [] }
        : field === 'deletions'
          ? { confirmedDeleted: [] }
          : field === 'absence'
            ? { finalAbsenceConfirmed: false }
            : { cleanupConfirmed: false }),
    }));
    expect((await invoke('execute', sample.sample)).failure).toBe(true);
  },
);
it('will not use a baseline captured before the current preflight completed', async () => {
  const sample = await ready(),
    p = join(sample.root, 'sm12-baseline.json'),
    d = read(p);
  d.userSearch.observedAt = read(join(sample.root, 'result.json')).startedAt;
  write(p, d);
  await expect(invoke('check', sample.sample)).rejects.toThrow();
});
it('preflight rejects any mutating dependency request and creates no attempt', async () => {
  await invoke('prepare');
  vi.mocked(dependencies.inspect).mockImplementation(async (reader) => {
    await (reader as any).put('/sap/bc/adt/whatever', 'bad');
    return {} as never;
  });
  expect((await invoke('preflight')).failure).toBe(true);
  expect(existsSync(join(root(), 'attempt'))).toBe(false);
});
it.each([{ NODE_OPTIONS: '--require evil' }, { GIT_PAGER: 'cat' }, { ARC1_LOG_HTTP_DEBUG: 'true' }])(
  'rejects runtime overrides %j',
  (env) => expect(() => assertRetainedRuntime(env, ['--import', 'tsx'], 'v22.21.1')).toThrow(),
);
it('rejects another Node runtime or caller-selected options', async () => {
  expect(() => assertRetainedRuntime({}, ['--import', 'tsx'], 'v22.22.0')).toThrow();
  await expect(
    runNativeRetained(['--prepare-reviewed-v5-retained', revision, 'foreign-root'], dependencies),
  ).rejects.toThrow();
});
it.each(['not-jpeg', 'truncated-jpeg'])('refuses %s even when its receipt hash matches', async (kind) => {
  const sample = await ready(),
    file = join(sample.root, 'sm12-user.jpg'),
    body = kind === 'not-jpeg' ? Buffer.from('PNG') : jpeg.subarray(0, jpeg.length - 2);
  writeFileSync(file, body, { mode: 0o600 });
  const p = join(sample.root, 'sm12-baseline.json'),
    d = read(p);
  d.userSearch.evidenceSha256 = retainedHash(body);
  write(p, d);
  await expect(invoke('check', sample.sample)).rejects.toThrow();
});
it('rechecks the original expiry after the driver await, preserving native facts', async () => {
  const sample = await ready();
  vi.mocked(dependencies.execute).mockImplementation(async () => {
    vi.advanceTimersByTime(300001);
    return success();
  });
  expect(await invoke('execute', sample.sample)).toMatchObject({
    failure: true,
    confirmedDeleted: [...retainedOwners],
    cleanupConfirmed: true,
  });
});
