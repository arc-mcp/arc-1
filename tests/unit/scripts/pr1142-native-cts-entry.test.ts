import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CtsRound } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { AdtClient, CTS_PROTOCOL, harness, runNativeCtsRound } from './pr1142-native-cts-harness.js';

const { runNativeCts, assertNativeCtsRuntime } = await import('../../../scripts/qualification/pr1142/native-cts.js');

import type { NativeCtsDependencies } from '../../../scripts/qualification/pr1142/native-cts.js';

const revision = 'a'.repeat(40),
  jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex'),
  sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')),
  write = (p: string, value: unknown) => writeFileSync(p, JSON.stringify(value), { mode: 0o600 });
let temporary: string,
  deps: NativeCtsDependencies,
  binding: Awaited<ReturnType<NativeCtsDependencies['bind']>>,
  h: ReturnType<typeof harness> | undefined;
const root = () => join(temporary, CTS_PROTOCOL),
  tick = () => vi.setSystemTime(Date.now() + 1000);
const invoke = (mode: string, round?: CtsRound, sample?: string) =>
  runNativeCts(
    [`--${mode}-reviewed-native-cts-v1`, revision, ...(round ? [round] : []), ...(sample ? [sample] : [])],
    deps,
  );
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  temporary = mkdtempSync(join(tmpdir(), 'arc1-cts-entry-'));
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
  deps = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'SYNTHETIC-PASSWORD',
      SAP_CLIENT: '001',
    })),
    createClient: vi.fn((options) => {
      if (!h) throw new Error('Harness not ready.');
      return new AdtClient({ ...options, baseUrl: h.origin });
    }),
    execute: runNativeCtsRound,
  };
});
afterEach(() => {
  h?.assertSafe();
  h = undefined;
  rmSync(temporary, { recursive: true, force: true });
  vi.useRealTimers();
});
async function prepare() {
  await invoke('prepare');
  h = harness(read(join(root(), 'intent.json')).graph);
  tick();
}
async function ready(round: CtsRound) {
  const result = await invoke('preflight', round);
  expect(result).toMatchObject({ failure: false, mutationAttempted: false });
  tick();
  const sample = (result as { preflightId: string }).preflightId,
    dir = join(root(), round, 'preflight', sample),
    intentHash = sha(readFileSync(join(root(), 'intent.json'))),
    observed = {
      observedAt: new Date().toISOString(),
      client: '001',
      table: '*',
      lockCount: 0,
      evidenceSha256: sha(jpeg),
    };
  write(join(dir, 'sm12-baseline.json'), {
    protocol: CTS_PROTOCOL,
    round,
    revision,
    intentHash,
    preflightId: sample,
    suffixSearch: { ...observed, user: '*', argument: `*${h!.graph.suffix}*` },
    userSearch: { ...observed, user: 'MARIAN', argument: '*' },
  });
  for (const name of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { sample, dir };
}
it('uses actual entry/client/driver for A/B/C, binds history, and never reclaims a completed round', async () => {
  await prepare();
  for (const round of ['A', 'B', 'C'] as const) {
    const { sample } = await ready(round);
    const before = h!.calls.length,
      envCalls = vi.mocked(deps.readEnv).mock.calls.length;
    expect(await invoke('check', round, sample)).toMatchObject({
      failure: false,
      attemptClaimed: false,
      mutationAttempted: false,
    });
    expect(h!.calls).toHaveLength(before);
    expect(vi.mocked(deps.readEnv)).toHaveBeenCalledTimes(envCalls);
    const out = await invoke('execute', round, sample);
    expect(out).toMatchObject({ failure: false });
    const durable = read(join(root(), round, 'attempt/result.json'));
    expect(durable.remaining).toEqual([]);
    expect(durable.journal.length).toBeGreaterThan(0);
    const calls = h!.calls.length;
    await expect(invoke('execute', round, sample)).rejects.toThrow();
    expect(h!.calls).toHaveLength(calls);
    tick();
  }
  expect(
    vi
      .mocked(deps.createClient)
      .mock.calls.every(
        ([c]) =>
          c?.baseUrl === 'https://a4h.marianzeis.de' &&
          c.client === '001' &&
          c.safety?.multiTargetWrite?.serverAllowedTransports?.[0] === '*',
      ),
  ).toBe(true);
}, 120000);
it('refuses a later round without successful immutable history before reading credentials', async () => {
  await prepare();
  await expect(invoke('preflight', 'B')).rejects.toThrow();
  expect(deps.readEnv).not.toHaveBeenCalled();
});
it.each(['jpeg', 'hash', 'mode', 'expiry', 'journal'] as const)(
  'refuses changed %s prerequisite before credentials and permanently claims execution',
  async (fault) => {
    await prepare();
    const { sample, dir } = await ready('A'),
      calls = vi.mocked(deps.readEnv).mock.calls.length;
    if (fault === 'jpeg') writeFileSync(join(dir, 'sm12-user.jpg'), Buffer.from('not jpeg'));
    if (fault === 'hash') {
      const x = read(join(dir, 'sm12-baseline.json'));
      x.intentHash = '0'.repeat(64);
      write(join(dir, 'sm12-baseline.json'), x);
    }
    if (fault === 'mode') chmodSync(join(dir, 'sm12-user.jpg'), 0o666);
    if (fault === 'expiry') vi.setSystemTime(Date.now() + 300_001);
    if (fault === 'journal') {
      const name = readdirSync(join(dir, 'run'))[0];
      write(join(dir, 'run', name), { tampered: true });
    }
    await expect(invoke('execute', 'A', sample)).rejects.toThrow();
    expect(deps.readEnv).toHaveBeenCalledTimes(calls);
    expect(existsSync(join(root(), 'A', 'attempt'))).toBe(true);
    await expect(invoke('execute', 'A', sample)).rejects.toThrow();
  },
);
it('refuses a dropped actual constructor policy with no mutation', async () => {
  await prepare();
  const { sample } = await ready('A');
  const original = deps.createClient;
  deps.createClient = (options) => original({ ...options, safety: undefined });
  const n = h!.calls.length;
  const r = await invoke('execute', 'A', sample);
  expect(r.failure).toBe(true);
  expect(h!.calls.slice(n).some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
});
it.each([
  ['--execute-reviewed-native-cts-v1', revision, 'A', '../bad'],
  ['--prepare-reviewed-native-cts-v1', 'main'],
  ['--preflight-reviewed-native-cts-v1', revision, 'D'],
])('refuses unsupported CLI %j before binding', async (...args) => {
  await expect(runNativeCts(args, deps)).rejects.toThrow();
  expect(deps.bind).not.toHaveBeenCalled();
});
it('keeps the fixed runtime and debug/loader prohibitions', () => {
  expect(() => assertNativeCtsRuntime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
  expect(() => assertNativeCtsRuntime({ NODE_OPTIONS: '--import=x' }, [], 'v22.21.1')).toThrow();
  expect(() => assertNativeCtsRuntime({ ARC1_LOG_HTTP_DEBUG: 'true' }, [], 'v22.21.1')).toThrow();
  expect(() => assertNativeCtsRuntime({}, [], 'v20.0.0')).toThrow();
});
it.each(['manifest', 'consumed-jpeg', 'journal-addition'] as const)(
  'refuses changed prior %s before later native credential loading',
  async (fault) => {
    await prepare();
    const { sample } = await ready('A');
    expect(await invoke('execute', 'A', sample)).toMatchObject({ failure: false });
    tick();
    const envCalls = vi.mocked(deps.readEnv).mock.calls.length;
    if (fault === 'manifest') {
      const path = join(root(), 'A/attempt/manifest.json'),
        m = read(path);
      m.binding.revision = 'b'.repeat(40);
      write(path, m);
    }
    if (fault === 'consumed-jpeg')
      writeFileSync(join(root(), 'A/preflight', sample, 'sm12-user.jpg'), Buffer.from('changed'));
    if (fault === 'journal-addition') write(join(root(), 'A/attempt/run/99999.json'), { unexpected: true });
    await expect(invoke('preflight', 'B')).rejects.toThrow();
    expect(deps.readEnv).toHaveBeenCalledTimes(envCalls);
  },
);
it.each([false, true])(
  'persists an unexpected unqualified task without adopting it (fallback=%s)',
  async (fallback) => {
    await prepare();
    const { sample } = await ready('A');
    let bound = false,
      injected = false;
    deps.execute = async (input) => {
      const result = await runNativeCtsRound({
        ...input,
        record: (row) => {
          input.record(row);
          if ((row as { completedStep?: string }).completedStep === 'create-request') bound = true;
        },
      });
      if (fallback) throw new Error('Synthetic return failure after the diagnostic observation.');
      return result;
    };
    h!.hooks.reply = (r) => {
      const t = [...h!.trees.values()][0];
      if (!bound || injected || r.method !== 'GET' || !r.path.startsWith('/sap/bc/adt/cts/transportrequests/')) return;
      injected = true;
      return {
        statusCode: 200,
        data: h!
          .xml(t)
          .replace(
            '</t:request>',
            `<t:task t:number="A4HK999998" t:parent="${t.parent}" t:owner="MARIAN" t:type="Unclassified" t:status="D" t:desc="Unexpected" t:source_client="001" t:uri="/sap/bc/adt/cts/transportrequests/A4HK999998"/></t:request>`,
          ),
      };
    };
    const r = await invoke('execute', 'A', sample);
    expect(injected).toBe(true);
    expect(r.failure).toBe(true);
    const saved = read(join(root(), 'A/attempt/result.json'));
    expect(saved.current.A4HK999998).toBe('unknown');
    expect(saved.remaining).toContain('A4HK999998');
    expect(saved.inspectionRequired).toContain('A4HK999998');
    expect(saved.requests.flatMap((r: { parent: string; task: string }) => [r.parent, r.task])).not.toContain(
      'A4HK999998',
    );
    expect(h!.calls.some((c) => c.path.includes('A4HK999998'))).toBe(false);
    await expect(invoke('execute', 'A', sample)).rejects.toThrow();
  },
);
