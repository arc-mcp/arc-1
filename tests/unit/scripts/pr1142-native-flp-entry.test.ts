import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertFlpRuntime, runNativeFlp } from '../../../scripts/qualification/pr1142/native-flp-cust.js';
import type { NativeFlpInput, NativeFlpOutcome } from '../../../scripts/qualification/pr1142/native-flp-driver.js';
import { FLP_PROTOCOL, FLP_SUFFIX, flpOwner } from '../../../scripts/qualification/pr1142/native-flp-fixed.js';

const revision = 'a'.repeat(40),
  secret = 'FLP-SECRET-DO-NOT-RECORD';
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
let temporary: string, deps: NonNullable<Parameters<typeof runNativeFlp>[1]>;
const root = () => join(temporary, FLP_PROTOCOL);
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
function tree(path = root()): string {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      e.isDirectory() ? `${e.name}/${tree(join(path, e.name))}` : `${e.name}:${sha(readFileSync(join(path, e.name)))}`,
    )
    .join('|');
}
const invoke = (phase: string) => runNativeFlp([`--${phase}`, revision], deps);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T07:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-flp-entry-'));
  const binding = {
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
  deps = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    verifyEvidence: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_CLIENT: '001',
      SAP_PASSWORD: secret,
    })),
    createClient: vi.fn(() => ({}) as never),
    execute: vi.fn(async (input: NativeFlpInput): Promise<NativeFlpOutcome> => {
      input.verifySource();
      input.record({ stage: 'request', method: 'POST' });
      return {
        owner: flpOwner(input.stage),
        declaredNativeParts: input.stage === 'catalog' ? ['Page', 'PageConfig'] : ['Page'],
        failure: false,
        mutationAttempted: true,
        createAcknowledged: true,
        ownedReadbackVerified: true,
        deleteAcknowledged: true,
        nativeDeleteCompleted: true,
        readAbsenceConfirmed: false,
        postDeleteLookup: 'unknown',
        sessionCleanup: 'closed',
        recording: 'native-governed-unverified',
        remaining: [],
        independentLockVerification: 'required',
      };
    }),
  };
});
afterEach(() => {
  if (existsSync(root()))
    for (const name of ['page', 'catalog']) {
      const result = join(root(), name, 'attempt/result.json');
      if (existsSync(result)) expect(readFileSync(result, 'utf8')).not.toContain(secret);
    }
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});
async function ready(stage: 'page' | 'catalog' | 'final' = 'page') {
  if (!existsSync(root())) await invoke('prepare-reviewed-flp');
  vi.advanceTimersByTime(1);
  const intentHash = sha(readFileSync(join(root(), 'intent.json')));
  const previous =
    stage === 'page' ? null : join(root(), stage === 'catalog' ? 'page' : 'catalog', 'attempt/result.json');
  const search = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: sha(jpeg),
  };
  const baseline = {
    protocol: FLP_PROTOCOL,
    stage,
    revision,
    intentHash,
    previousResultHash: previous ? sha(readFileSync(previous)) : null,
    ordinaryCustSourceContractAcknowledged: true,
    noConcurrentFixtureEditing: true,
    suffixSearch: { ...search, user: '*', argument: `*${FLP_SUFFIX}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  const directory = join(root(), stage, 'prerequisites');
  write(join(directory, 'sm12-baseline.json'), baseline);
  for (const name of ['suffix', 'user']) writeFileSync(join(directory, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { baseline, directory };
}
function noNative() {
  expect(deps.readEnv).not.toHaveBeenCalled();
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.execute).not.toHaveBeenCalled();
}
it('prepare/check are local; two stages each once; final fresh locks retain unknown absence', async () => {
  await ready();
  noNative();
  const before = tree();
  const check = await invoke('check-reviewed-flp-page');
  expect(check).toMatchObject({ failure: false, mutationAttempted: false, executionGrant: false });
  expect(tree()).toBe(before);
  noNative();
  const page = await invoke('execute-reviewed-flp-page');
  expect(page.failure).toBe(false);
  await expect(invoke('execute-reviewed-flp-page')).rejects.toThrow();
  await ready('catalog');
  const catalog = await invoke('execute-reviewed-flp-catalog');
  expect(catalog.failure).toBe(false);
  await ready('final');
  const final = await invoke('verify-reviewed-flp-cleanup');
  expect(final).toMatchObject({
    failure: false,
    nativeCleanupCompleted: true,
    independentZeroLocksVerified: true,
    readAbsenceConfirmed: false,
    recording: 'native-governed-unverified',
  });
  expect(deps.execute).toHaveBeenCalledTimes(2);
  expect(deps.readEnv).toHaveBeenCalledTimes(2);
});
it.each([
  'wrong-hash',
  'old',
  'future',
  'wrong-user',
  'wrong-suffix',
  'locks',
  'false-runtime',
  'concurrency',
  'png',
  'invalid-jpeg',
])('rejects prerequisite %s before credentials', async (kind) => {
  const { baseline, directory } = await ready();
  if (kind === 'wrong-hash') baseline.intentHash = 'f'.repeat(64);
  if (kind === 'old') vi.advanceTimersByTime(300001);
  if (kind === 'future') baseline.userSearch.observedAt = new Date(Date.now() + 1).toISOString();
  if (kind === 'wrong-user') baseline.userSearch.user = 'OTHER';
  if (kind === 'wrong-suffix') baseline.suffixSearch.argument = '*OTHER*';
  if (kind === 'locks') baseline.userSearch.lockCount = 1;
  if (kind === 'false-runtime') baseline.ordinaryCustSourceContractAcknowledged = false;
  if (kind === 'concurrency') baseline.noConcurrentFixtureEditing = false;
  if (kind === 'png') {
    writeFileSync(join(directory, 'sm12-user.jpg'), Buffer.from('89504e470d0a1a0a', 'hex'));
    baseline.userSearch.evidenceSha256 = sha(readFileSync(join(directory, 'sm12-user.jpg')));
  }
  if (kind === 'invalid-jpeg') writeFileSync(join(directory, 'sm12-user.jpg'), 'not-jpeg');
  write(join(directory, 'sm12-baseline.json'), baseline);
  const result = await invoke('execute-reviewed-flp-page');
  expect(result).toMatchObject({ failure: true, mutationAttempted: false, stoppedAt: 'prerequisites' });
  noNative();
  expect(existsSync(join(root(), 'page/attempt/result.json'))).toBe(true);
  await expect(invoke('execute-reviewed-flp-page')).rejects.toThrow();
});
it('catalog cannot run without confirmed first-stage result and newer lock evidence', async () => {
  await ready();
  const result = await invoke('execute-reviewed-flp-catalog');
  expect(result.failure).toBe(true);
  noNative();
});
it('uncertain Page result prevents the catalog stage even with new screenshots', async () => {
  await ready();
  vi.mocked(deps.execute).mockImplementation(async (input) => ({
    owner: flpOwner(input.stage),
    declaredNativeParts: input.stage === 'catalog' ? ['Page', 'PageConfig'] : ['Page'],
    failure: true,
    mutationAttempted: true,
    createAcknowledged: true,
    ownedReadbackVerified: true,
    deleteAcknowledged: false,
    nativeDeleteCompleted: false,
    readAbsenceConfirmed: false,
    postDeleteLookup: 'not-run',
    sessionCleanup: 'closed',
    recording: 'native-governed-unverified',
    remaining: [flpOwner(input.stage)],
    independentLockVerification: 'required',
  }));
  await invoke('execute-reviewed-flp-page');
  await ready('catalog');
  const result = await invoke('execute-reviewed-flp-catalog');
  expect(result.failure).toBe(true);
  expect(deps.execute).toHaveBeenCalledTimes(1);
});
it('check does not claim or load credentials after evidence drift', async () => {
  await ready();
  vi.mocked(deps.verifyEvidence).mockImplementation(() => {
    throw new Error(secret);
  });
  const before = tree();
  await expect(invoke('check-reviewed-flp-page')).rejects.toThrow('binding');
  expect(tree()).toBe(before);
  noNative();
});
it('source binding failure preserves already confirmed outcome fields', async () => {
  await ready();
  const original = deps.execute;
  deps.execute = vi.fn(async (input) => {
    const result = await original(input);
    vi.mocked(deps.verifyEvidence).mockImplementation(() => {
      throw new Error(secret);
    });
    return result;
  });
  const result = await invoke('execute-reviewed-flp-page');
  expect(result).toMatchObject({
    failure: true,
    createAcknowledged: true,
    nativeDeleteCompleted: true,
    bindingUnconfirmed: true,
  });
  expect(JSON.stringify(result)).not.toContain(secret);
});
it.each(['SAP_URL', 'SAP_CLIENT', 'SAP_USER', 'SAP_PASSWORD'])('invalid %s is never sent or logged', async (field) => {
  await ready();
  vi.mocked(deps.readEnv).mockReturnValue({
    SAP_URL: 'https://a4h.marianzeis.de',
    SAP_USER: 'MARIAN',
    SAP_CLIENT: '001',
    SAP_PASSWORD: secret,
    [field]: '',
  });
  const result = await invoke('execute-reviewed-flp-page');
  expect(result.failure).toBe(true);
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.execute).not.toHaveBeenCalled();
});
it.each(
  [
    [],
    ['--execute-reviewed-flp-page'],
    ['--unknown', revision],
    ['--prepare-reviewed-flp', 'short'],
    ['--prepare-reviewed-flp', revision, '--root', '/tmp'],
  ].map((args) => ({ args })),
)('strict CLI $args', async ({ args }) => {
  await expect(runNativeFlp(args, deps)).rejects.toThrow();
  expect(deps.bind).not.toHaveBeenCalled();
  noNative();
});
it.each([
  { NODE_OPTIONS: '--require x' },
  { ARC1_LOG_HTTP_DEBUG: 'false' },
  { GIT_DIR: '/foreign' },
  { NODE_EXTRA_CA_CERTS: '/foreign' },
  { TSX_TSCONFIG_PATH: '/foreign' },
])('refuses runtime override %j', (env) => {
  expect(() => assertFlpRuntime(env, ['--import', 'tsx'], 'v22.21.1')).toThrow();
});
it('final check rejects a changed Page receipt through the catalog chain', async () => {
  await ready();
  await invoke('execute-reviewed-flp-page');
  await ready('catalog');
  await invoke('execute-reviewed-flp-catalog');
  await ready('final');
  const path = join(root(), 'page/attempt/result.json');
  write(path, { ...JSON.parse(readFileSync(path, 'utf8')), note: 'changed' });
  await expect(invoke('verify-reviewed-flp-cleanup')).rejects.toThrow('baseline');
  expect(deps.execute).toHaveBeenCalledTimes(2);
});
it('a linked stage directory cannot redirect the permanent attempt claim', async () => {
  await ready();
  const redirect = join(temporary, 'other-stage');
  renameSync(join(root(), 'page'), redirect);
  symlinkSync(redirect, join(root(), 'page'));
  await expect(invoke('execute-reviewed-flp-page')).rejects.toThrow();
  expect(existsSync(join(redirect, 'attempt'))).toBe(false);
  noNative();
});
it('a linked JPEG cannot satisfy the prerequisite receipt', async () => {
  const { directory } = await ready();
  const source = join(directory, 'sm12-user.jpg'),
    other = join(temporary, 'capture.jpg');
  renameSync(source, other);
  symlinkSync(other, source);
  const result = await invoke('execute-reviewed-flp-page');
  expect(result).toMatchObject({ failure: true, mutationAttempted: false });
  noNative();
});
