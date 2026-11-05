import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assertPackageRuntime,
  type PackagePhaseDependencies,
  runNativePackage,
} from '../../../scripts/qualification/pr1142/native-package.js';
import {
  PACKAGE_PROTOCOL,
  PACKAGE_STAGES,
  packageOwners,
} from '../../../scripts/qualification/pr1142/native-package-fixtures.js';
import type { PackageRuntime } from '../../../scripts/qualification/pr1142/native-package-runner.js';
import { AdtApiError } from '../../../src/adt/errors.js';

vi.mock('dotenv', async (original) => ({
  ...(await original<typeof import('dotenv')>()),
  config: vi.fn(() => ({ parsed: {} })),
}));
const revision = 'a'.repeat(40),
  sampleRoot = () => join(temporary, PACKAGE_PROTOCOL),
  secret = 'SYNTHETIC-ONLY-PASSWORD';
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex'),
  sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')),
  write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v), { mode: 0o600 });
let temporary: string,
  dependencies: PackagePhaseDependencies,
  runtime: PackageRuntime,
  binding: Awaited<ReturnType<PackagePhaseDependencies['bind']>>;
const invoke = (phase: string, sample?: string) =>
  runNativePackage([`--${phase}-reviewed-local-package-v1`, revision, ...(sample ? [sample] : [])], dependencies);
function tree(path = sampleRoot()): string {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) =>
      e.isDirectory() ? `${e.name}/${tree(join(path, e.name))}` : `${e.name}:${sha(readFileSync(join(path, e.name)))}`,
    )
    .join('|');
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T08:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_ONLY');
  });
  temporary = mkdtempSync(join(tmpdir(), 'arc1-package-entry-'));
  binding = {
    repo: temporary,
    root: sampleRoot(),
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
  runtime = {
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: secret,
      SAP_CLIENT: '001',
    })),
    createClient: vi.fn(
      () =>
        ({
          http: {
            get: vi.fn(async (path: string) => {
              if (path === '/sap/bc/adt/activation/inactiveobjects')
                return {
                  statusCode: 200,
                  headers: { 'content-type': 'application/xml' },
                  body: '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
                };
              throw new AdtApiError(
                'absent',
                404,
                path,
                '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>',
              );
            }),
          },
        }) as never,
    ),
    execute: vi.fn(async (input) => {
      input.verify();
      return {
        failure: false,
        mutationAttempted: true,
        completed: [...PACKAGE_STAGES],
        created: packageOwners(input.graph).map((o) => o.owner),
        confirmedDeleted: [...packageOwners(input.graph)].reverse().map((o) => o.owner),
        adapterReportedDeleted: [],
        expectedRefusals: [
          { stage: 'refuse-root-child', owner: input.graph.root.owner },
          { stage: 'refuse-child-class', owner: input.graph.child.owner },
        ],
        remaining: [],
        inspectionRequired: [],
        cleanupUnconfirmed: false,
        finalAbsenceConfirmed: true,
        stopped: false,
      };
    }),
  };
  dependencies = { validateRuntime: vi.fn(), bind: vi.fn(async () => binding), runtime: vi.fn(async () => runtime) };
});
afterEach(() => {
  if (existsSync(sampleRoot())) {
    const inspect = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name);
        if (e.isDirectory()) inspect(path);
        else if (e.name.endsWith('.json')) expect(readFileSync(path, 'utf8')).not.toContain(secret);
      }
    };
    inspect(sampleRoot());
  }
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});
async function ready() {
  await invoke('prepare');
  vi.advanceTimersByTime(1);
  const preflight = await invoke('preflight');
  if (!('preflightId' in preflight) || typeof preflight.preflightId !== 'string') throw new Error();
  vi.advanceTimersByTime(1);
  const intent = read(join(sampleRoot(), 'intent.json')),
    sample = preflight.preflightId,
    dir = join(sampleRoot(), 'preflight', sample),
    search = {
      observedAt: new Date().toISOString(),
      client: '001',
      table: '*',
      lockCount: 0,
      evidenceSha256: sha(jpeg),
    };
  write(join(dir, 'sm12-baseline.json'), {
    protocol: PACKAGE_PROTOCOL,
    revision,
    intentHash: preflight.intentHash,
    preflightId: sample,
    suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  });
  for (const name of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { sample, dir };
}
it('prepares only a fresh local immutable intent, without native dependencies or credentials', async () => {
  const result = await invoke('prepare');
  expect(result).toMatchObject({ failure: false, mutationAttempted: false });
  expect(dependencies.runtime).not.toHaveBeenCalled();
  const before = tree();
  await expect(invoke('prepare')).rejects.toThrow();
  expect(tree()).toBe(before);
});
it('checks raw JPEG prerequisites without a claim, runtime, umask change or filesystem mutation', async () => {
  const { sample } = await ready();
  vi.mocked(dependencies.runtime).mockClear();
  const before = tree(),
    masks = vi.mocked(process.umask).mock.calls.length;
  expect(await invoke('check', sample)).toMatchObject({ failure: false, attemptClaimed: false, executionGrant: false });
  expect(tree()).toBe(before);
  expect(dependencies.bind).toHaveBeenLastCalledWith(revision, expect.any(URL), undefined, { readOnly: true });
  expect(dependencies.runtime).not.toHaveBeenCalled();
  expect(vi.mocked(process.umask).mock.calls).toHaveLength(masks);
  expect(existsSync(join(sampleRoot(), 'attempt'))).toBe(false);
});
it('executes one claimed attempt only, using the original prerequisite deadline', async () => {
  const { sample, dir } = await ready();
  expect(await invoke('execute', sample)).toMatchObject({ failure: false, confirmedDeleted: expect.any(Array) });
  expect(runtime.execute).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runtime.execute).mock.calls[0][0].freshUntil).toBe(
    Date.parse(read(join(dir, 'result.json')).startedAt) + 300000,
  );
  await expect(invoke('execute', sample)).rejects.toThrow();
  await expect(invoke('preflight')).rejects.toThrow();
  expect(runtime.execute).toHaveBeenCalledTimes(1);
});
it.each([
  'wrong-protocol',
  'wrong-owner',
  'wrong-preflight',
  'old-baseline',
  'future-baseline',
  'bad-jpeg',
  'hash-mismatch',
  'public-image',
  'pre-prepare',
] as const)('consumes a refused execution claim before credentials for %s', async (fault) => {
  const { sample, dir } = await ready();
  const p = join(dir, 'sm12-baseline.json'),
    b = read(p);
  if (fault === 'wrong-protocol') b.protocol = 'pr1142-native-declarative-v5';
  if (fault === 'wrong-owner') b.suffixSearch.argument = '*FOREIGN*';
  if (fault === 'wrong-preflight') b.preflightId = 'F'.repeat(16);
  if (fault === 'old-baseline') vi.advanceTimersByTime(300001);
  if (fault === 'future-baseline') b.userSearch.observedAt = new Date(Date.now() + 10).toISOString();
  if (fault === 'pre-prepare') b.suffixSearch.observedAt = new Date(Date.now() - 1000).toISOString();
  if (fault === 'bad-jpeg') {
    writeFileSync(join(dir, 'sm12-user.jpg'), 'not JPEG');
    b.userSearch.evidenceSha256 = sha('not JPEG');
  }
  if (fault === 'hash-mismatch') b.userSearch.evidenceSha256 = '0'.repeat(64);
  if (fault === 'public-image') chmodSync(join(dir, 'sm12-user.jpg'), 0o644);
  write(p, b);
  vi.mocked(runtime.readEnv).mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(runtime.readEnv).not.toHaveBeenCalled();
  expect(runtime.execute).not.toHaveBeenCalled();
  expect(read(join(sampleRoot(), 'attempt/result.json'))).toMatchObject({ failure: true, mutationAttempted: false });
  await expect(invoke('execute', sample)).rejects.toThrow();
});
it('does not reuse a previous offline check after the image changed', async () => {
  const { sample, dir } = await ready();
  await invoke('check', sample);
  writeFileSync(join(dir, 'sm12-user.jpg'), 'changed');
  vi.mocked(runtime.readEnv).mockClear();
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(runtime.readEnv).not.toHaveBeenCalled();
});
it('rechecks receipt bytes after configuration loading, before creating a native client', async () => {
  const { sample, dir } = await ready();
  vi.mocked(runtime.createClient).mockClear();
  vi.mocked(runtime.readEnv).mockImplementation(() => {
    writeFileSync(join(dir, 'sm12-user.jpg'), 'changed');
    return { SAP_URL: 'https://a4h.marianzeis.de', SAP_USER: 'MARIAN', SAP_PASSWORD: secret, SAP_CLIENT: '001' };
  });
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(runtime.createClient).not.toHaveBeenCalled();
  expect(read(join(sampleRoot(), 'attempt/result.json')).mutationAttempted).toBe(false);
});
it('marks terminal binding failure without dropping confirmed deletion facts', async () => {
  const { sample } = await ready();
  const normal = vi.mocked(runtime.execute).getMockImplementation()!;
  vi.mocked(runtime.execute).mockImplementation(async (input) => {
    const result = await normal(input);
    vi.mocked(binding.verifySource).mockImplementation(() => {
      throw new Error('changed');
    });
    return result;
  });
  expect(await invoke('execute', sample)).toMatchObject({
    failure: true,
    terminalCheckUnconfirmed: true,
    confirmedDeleted: expect.arrayContaining([expect.any(String)]),
    inspectionRequired: expect.any(Array),
  });
});
it.each(['NODE_OPTIONS', 'NODE_PATH', 'GIT_PAGER', 'ARC1_LOG_HTTP_DEBUG'])('refuses runtime override %s', (key) => {
  expect(() => assertPackageRuntime({ [key]: '1' }, ['--import', 'tsx'], 'v22.21.1')).toThrow();
});
it('requires the exact Node version and fixed phase syntax before binding', async () => {
  expect(() => assertPackageRuntime({}, ['--import', 'tsx'], 'v22.22.0')).toThrow();
  await expect(runNativePackage(['--execute-custom', revision], dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
});
it('refuses an incomplete driver outcome even if it reports failure false', async () => {
  const { sample } = await ready(),
    normal = vi.mocked(runtime.execute).getMockImplementation()!;
  vi.mocked(runtime.execute).mockImplementation(async (input) => ({ ...(await normal(input)), completed: [] }));
  expect(await invoke('execute', sample)).toMatchObject({
    failure: true,
    completionUnconfirmed: true,
    inspectionRequired: expect.any(Array),
  });
});
