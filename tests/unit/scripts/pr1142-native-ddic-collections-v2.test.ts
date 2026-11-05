import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COLLECTIONS_STAGES, collectionsHarness } from './pr1142-native-ddic-collections-harness.js';

const { runNativeCollectionsV2, COLLECTIONS_V2_PROTOCOL, collectionsV2Fixtures } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-v2.js'
);
const revision = 'a'.repeat(40),
  jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
let temp: string, root: string, historyBroken: boolean, h: ReturnType<typeof collectionsHarness>;
let deps: NonNullable<Parameters<typeof runNativeCollectionsV2>[1]>;
const invoke = (phase: string, sample?: string) =>
  runNativeCollectionsV2([`--${phase}-reviewed-ddic-collections-v2`, revision, ...(sample ? [sample] : [])], deps);
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'arc1-collections-v2-'));
  root = join(temp, COLLECTIONS_V2_PROTOCOL);
  h = collectionsHarness();
  historyBroken = false;
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  deps = {
    validateRuntime: vi.fn(),
    runtime: vi.fn(async () => h.runtime),
    verifyHistory: vi.fn(() => {
      if (historyBroken) throw new Error('synthetic history drift');
    }),
    bind: vi.fn(async () => ({
      root,
      repo: temp,
      verifySource: h.verify,
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        repo: temp,
        dependencyLimit: 'synthetic',
      },
    })),
  };
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));
async function ready() {
  const prepared = await invoke('prepare');
  if (!('fixtures' in prepared) || !prepared.fixtures) throw new Error();
  h.useFixtures(prepared.fixtures);
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
  writeFileSync(
    join(dir, 'sm12-baseline.json'),
    JSON.stringify({
      protocol: COLLECTIONS_V2_PROTOCOL,
      revision,
      intentHash: preflight.intentHash,
      preflightId: sample,
      suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
      userSearch: { ...search, user: 'MARIAN', argument: '*' },
    }),
    { mode: 0o600 },
  );
  for (const name of ['user', 'suffix']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { sample, dir, intent };
}
it('composes the fresh entry/client/driver through normalized source, all stages and reverse deletion once', async () => {
  const { sample, intent } = await ready();
  h.hooks.before = (url, input) => {
    if (input.method !== 'GET' || !url.pathname.endsWith('/source/main')) return;
    const owner = url.pathname.slice(0, -'/source/main'.length),
      o = h.world.objects.get(owner);
    if (o?.source?.startsWith('@EndUserText') && !o.source.includes('{\n\n'))
      o.source = o.source.replace('define structure', '\ndefine structure').replace('{\n', '{\n\n').replace(/\n$/, '');
  };
  const calls = h.world.calls.length;
  vi.mocked(deps.runtime).mockClear();
  expect(await invoke('check', sample)).toMatchObject({ attemptClaimed: false, executionGrant: false });
  expect(deps.runtime).not.toHaveBeenCalled();
  expect(h.world.calls).toHaveLength(calls);
  expect(await invoke('execute', sample)).toMatchObject({
    failure: false,
    completed: [...COLLECTIONS_STAGES],
    remaining: [],
    inspectionRequired: [],
    finalAbsenceConfirmed: true,
    cleanupUnconfirmed: false,
  });
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    intent.fixtures.map((f: { owner: string }) => f.owner).reverse(),
  );
  expect(h.world.calls.some((c) => c.path.includes('0B9644EAD7A6'))).toBe(false);
  expect(h.runtime.createClient.mock.calls.at(-1)?.[0]).toMatchObject({
    client: '001',
    username: 'MARIAN',
    safety: { allowedPackages: ['$TMP'] },
  });
  const after = h.world.calls.length;
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.world.calls).toHaveLength(after);
  expect(vi.mocked(deps.bind).mock.calls[0][1].pathname).toMatch(/native-ddic-collections-v2\.ts$/);
}, 30000);
it('refuses changed predecessor evidence before preparation or a credential reader', async () => {
  historyBroken = true;
  await expect(invoke('prepare')).rejects.toThrow('history');
  expect(existsSync(root)).toBe(false);
  expect(deps.runtime).not.toHaveBeenCalled();
});
it.each(['history', 'old-protocol', 'old-suffix', 'jpeg', 'expiry'] as const)(
  'consumes a new claim without dispatch for changed %s evidence',
  async (fault) => {
    const { sample, dir, intent } = await ready();
    h.runtime.readEnv.mockClear();
    if (fault === 'history') historyBroken = true;
    if (fault === 'old-protocol' || fault === 'old-suffix') {
      if (fault === 'old-protocol') intent.protocol = 'pr1142-native-ddic-collections-v1';
      else intent.suffix = '0B9644EAD7A6';
      writeFileSync(join(root, 'intent.json'), JSON.stringify(intent));
    }
    if (fault === 'jpeg') writeFileSync(join(dir, 'sm12-user.jpg'), 'not a JPEG');
    if (fault === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    const count = h.world.calls.length;
    await expect(invoke('execute', sample)).rejects.toThrow();
    expect(existsSync(join(root, 'attempt'))).toBe(true);
    expect(h.runtime.readEnv).not.toHaveBeenCalled();
    expect(h.world.calls).toHaveLength(count);
    await expect(invoke('execute', sample)).rejects.toThrow();
  },
);
it('rechecks history after lazy runtime loading, before credential or client creation', async () => {
  const { sample } = await ready();
  h.runtime.readEnv.mockClear();
  h.runtime.createClient.mockClear();
  vi.mocked(deps.runtime).mockImplementation(async () => {
    await Promise.resolve();
    historyBroken = true;
    return h.runtime;
  });
  await expect(invoke('execute', sample)).rejects.toThrow();
  expect(h.runtime.readEnv).not.toHaveBeenCalled();
  expect(h.runtime.createClient).not.toHaveBeenCalled();
});
it('retains successful cleanup facts when final history verification fails', async () => {
  const { sample } = await ready(),
    execute = h.runtime.execute;
  h.runtime.execute = async (input) => {
    const r = await execute(input);
    historyBroken = true;
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
it('never exposes old suffix, old phase flags or caller-selected roots/profiles', async () => {
  expect(() => collectionsV2Fixtures('0B9644EAD7A6')).toThrow();
  await expect(runNativeCollectionsV2(['--prepare-reviewed-ddic-collections-v1', revision], deps)).rejects.toThrow();
  await expect(
    runNativeCollectionsV2(['--prepare-reviewed-ddic-collections-v2', revision, 'foreign'], deps),
  ).rejects.toThrow();
  expect(deps.bind).not.toHaveBeenCalled();
});

it.each([false, true])(
  'rechecks cleanup history after actual async authentication and preserves own cleanup, proxy=%s',
  async (proxy) => {
    let armed = false;
    h = collectionsHarness({
      proxy,
      token: async () => {
        await Promise.resolve();
        if (armed) historyBroken = true;
        return 'synthetic-token';
      },
    });
    const { sample, intent } = await ready(),
      execute = h.runtime.execute;
    h.runtime.execute = (input) =>
      execute({
        ...input,
        record: (row) => {
          const r = row as { stage?: string; method?: string; path?: string };
          if (r.stage === 'request' && r.method === 'PUT' && r.path?.includes('/source/main')) armed = true;
          input.record(row);
        },
      });
    const result = await invoke('execute', sample);
    expect(armed).toBe(true);
    expect(result).toMatchObject({ failure: true });
    expect(h.world.calls.filter((r) => r.method === 'PUT' && r.path.includes('/source/main'))).toHaveLength(0);
    expect(h.world.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(h.world.calls.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    if (!('remaining' in result)) throw new Error();
    expect(result.remaining).toContain(intent.fixtures[0].owner);
  },
);
