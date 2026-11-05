import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { PackagePhaseDependencies } from '../../../scripts/qualification/pr1142/native-package.js';

const { runNativePackageApiMoved } = await import('../../../scripts/qualification/pr1142/native-package-api-moved.js');
const { PACKAGE_API_MOVED_PROTOCOL, PACKAGE_API_MOVED_STAGES } = await import(
  '../../../scripts/qualification/pr1142/native-package-api-moved-fixed.js'
);

import type { PackageRuntime } from '../../../scripts/qualification/pr1142/native-package-runner.js';
import type { packageApiHarness } from './pr1142-native-package-api-harness.js';

const { runNativePackageApiMovedTail } = await import('./pr1142-native-package-api-harness.js');

import { movedHarness } from './pr1142-native-package-api-moved-harness.js';

const revision = 'a'.repeat(40),
  sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directoryDigest(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (v) =>
        `${v.name}:${v.isDirectory() ? directoryDigest(join(root, v.name)) : sha(readFileSync(join(root, v.name)))}`,
    )
    .join('|');
}
async function prepared() {
  const temp = mkdtempSync(join(tmpdir(), 'arc1-package-api-entry-'));
  roots.push(temp);
  const root = join(temp, PACKAGE_API_MOVED_PROTOCOL);
  const binding = {
    repo: temp,
    root,
    verifySource: vi.fn(),
    evidence: {
      revision,
      entryHash: 'b'.repeat(64),
      packageLockHash: 'c'.repeat(64),
      node: 'v22.21.1',
      repo: temp,
      dependencyLimit: 'synthetic',
    },
  };
  let harness: ReturnType<typeof packageApiHarness>;
  const readEnv = vi.fn(() => ({
    SAP_URL: 'https://a4h.marianzeis.de',
    SAP_USER: 'MARIAN',
    SAP_PASSWORD: 'SYNTHETIC-ENTRY-SECRET',
    SAP_CLIENT: '001',
  }));
  const factory = vi.fn((input: Parameters<PackageRuntime['createClient']>[0]) => {
    expect(input).toMatchObject({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: 'MARIAN',
      insecure: false,
      language: 'EN',
    });
    return harness.client.withSafety(input!.safety!);
  });
  const runtime: PackageRuntime = { readEnv, createClient: factory, execute: runNativePackageApiMovedTail };
  const deps: PackagePhaseDependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    runtime: vi.fn(async () => runtime),
  };
  const invoke = (phase: string, sample?: string) =>
    runNativePackageApiMoved(
      [`--${phase}-reviewed-package-api-moved-v1`, revision, ...(sample ? [sample] : [])],
      deps,
      () => binding.verifySource(),
    );
  harness = movedHarness();
  await invoke('prepare');
  expect(readEnv).not.toHaveBeenCalled();
  expect(factory).not.toHaveBeenCalled();
  const intent = JSON.parse(readFileSync(join(root, 'intent.json'), 'utf8'));
  expect(intent.fixedProfile.stages).toEqual(PACKAGE_API_MOVED_STAGES);
  const preflight = await invoke('preflight');
  if (!('preflightId' in preflight) || typeof preflight.preflightId !== 'string') throw new Error();
  const sample = preflight.preflightId,
    dir = join(root, 'preflight', sample);
  expect(harness.calls.length).toBeGreaterThan(17);
  expect(harness.calls.every((c) => c.method === 'GET')).toBe(true);
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
      protocol: PACKAGE_API_MOVED_PROTOCOL,
      revision,
      intentHash: sha(readFileSync(join(root, 'intent.json'))),
      preflightId: sample,
      suffixSearch: { ...search, user: '*', argument: `*${intent.suffix}*` },
      userSearch: { ...search, user: 'MARIAN', argument: '*' },
    }),
    { mode: 0o600 },
  );
  for (const name of ['sm12-suffix.jpg', 'sm12-user.jpg']) {
    writeFileSync(join(dir, name), jpeg, { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
  }
  return { root, dir, sample, invoke, harness, binding, readEnv, factory, runtime, graph: intent.graph };
}
it('composes pure prepare/check and once-only entry→factory→client→driver without actual credentials', async () => {
  const h = await prepared(),
    before = directoryDigest(h.root),
    loads = h.readEnv.mock.calls.length;
  expect(await h.invoke('check', h.sample)).toMatchObject({
    failure: false,
    attemptClaimed: false,
    executionGrant: false,
  });
  expect(directoryDigest(h.root)).toBe(before);
  expect(h.readEnv).toHaveBeenCalledTimes(loads);
  const result = await h.invoke('execute', h.sample);
  expect(result).toMatchObject({
    failure: false,
    completed: PACKAGE_API_MOVED_STAGES,
    remaining: [],
    finalAbsenceConfirmed: true,
    retainedBookkeeping: {
      request: 'A4HK906609',
      task: 'A4HK906611',
      originalTask: 'A4HK906610',
      classRecorded: true,
      apiRecorded: true,
    },
  });
  const saved = JSON.parse(readFileSync(join(h.root, 'attempt/result.json'), 'utf8'));
  expect(saved.failure).toBe(false);
  const calls = h.harness.calls.length;
  await expect(h.invoke('execute', h.sample)).rejects.toThrow();
  await expect(h.invoke('check', h.sample)).rejects.toThrow();
  expect(h.harness.calls).toHaveLength(calls);
  const inspect = (root: string) => {
    for (const p of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, p.name);
      if (p.isDirectory()) inspect(path);
      else if (p.name.endsWith('.json')) expect(readFileSync(path, 'utf8')).not.toContain('SYNTHETIC-ENTRY-SECRET');
    }
  };
  inspect(h.root);
}, 60_000);
it.each(['intent', 'jpeg', 'wrong-owner', 'expiry'])('refuses %s proof before runtime or a mutation', async (fault) => {
  const h = await prepared(),
    calls = h.harness.calls.length,
    loads = h.readEnv.mock.calls.length;
  if (fault === 'intent') {
    const p = join(h.root, 'intent.json'),
      j = JSON.parse(readFileSync(p, 'utf8'));
    j.fixedProfile.recordedPackage = 'OTHER';
    writeFileSync(p, JSON.stringify(j));
  }
  if (fault === 'jpeg') writeFileSync(join(h.dir, 'sm12-user.jpg'), 'not jpeg');
  if (fault === 'wrong-owner') {
    const p = join(h.dir, 'result.json'),
      j = JSON.parse(readFileSync(p, 'utf8'));
    j.verifiedOwners = [h.graph.root.owner];
    writeFileSync(p, JSON.stringify(j));
  }
  if (fault === 'expiry') {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_001);
  }
  await expect(h.invoke('execute', h.sample)).rejects.toThrow();
  expect(h.readEnv).toHaveBeenCalledTimes(loads);
  expect(h.harness.calls).toHaveLength(calls);
  expect(existsSync(join(h.root, 'attempt'))).toBe(true);
  expect(JSON.parse(readFileSync(join(h.root, 'attempt/result.json'), 'utf8'))).toMatchObject({
    failure: true,
    mutationAttempted: false,
  });
});

it.each(['extra-refusal', 'missing-history', 'wrong-task'] as const)(
  'does not persist complete success for %s',
  async (fault) => {
    const h = await prepared(),
      execute = h.runtime.execute;
    h.runtime.execute = async (input) => {
      const r = await execute(input);
      if (fault === 'extra-refusal') r.expectedRefusals.push({ stage: 'refuse-root-child', owner: h.graph.root.owner });
      if (fault === 'missing-history') r.previouslyCompleted = [];
      if (fault === 'wrong-task' && r.retainedBookkeeping)
        r.retainedBookkeeping.members = ['A4HK906609', 'A4HK906610', 'A4HK906612'];
      return r;
    };
    expect(await h.invoke('execute', h.sample)).toMatchObject({
      failure: true,
      completionUnconfirmed: true,
      remaining: [],
      confirmedDeleted: expect.arrayContaining([h.graph.root.owner]),
    });
  },
  60_000,
);
