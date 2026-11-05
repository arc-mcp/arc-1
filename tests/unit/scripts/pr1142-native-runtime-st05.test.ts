import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AdtClient, calls, harness, origin, st05Xml } from '../../helpers/runtime-slice-harness.js';

const { runNativeRuntimeSt05: runEntry } = await import('../../../scripts/qualification/pr1142/native-runtime-st05.js');
const { runtimeSt05History: history, RUNTIME_ST05_PROTOCOL: protocol } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-st05-fixed.js'
);
const { runRetainedSt05 } = await import('../../../scripts/qualification/pr1142/native-runtime-st05-driver.js');
const { RUNTIME_SUFFIX } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js');
const { nativeRuntimeDefaults } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-runtime.js');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
// Exact native inactive receipt, derived from the existing native wire fixture, not an invented PUT echo.
const baselineXml = st05Xml
  .replace('<ts:modificationUser>MARIAN</ts:modificationUser>', '<ts:modificationUser/>')
  .replace('2026-06-25T14:49:23Z', '2026-08-20T06:03:53Z');
async function fixture(proxy = false, change?: Parameters<typeof harness>[2]) {
  const h = harness('st05', proxy, change);
  h.state.st05 = baselineXml;
  const temp = mkdtempSync(join(tmpdir(), 'arc1-st05-tail-')),
    root = join(temp, protocol),
    revision = 'a'.repeat(40);
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
  let provider = async () => 'synthetic';
  const deps = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    verifyEvidence: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'synthetic-only',
    })),
    createClient: vi.fn((options: any) =>
      nativeRuntimeDefaults.createClient({
        ...options,
        baseUrl: origin,
        ...(proxy
          ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 80, getProxyToken: () => provider() } }
          : { bearerTokenProvider: () => provider() }),
      }),
    ),
  };
  const call = (flag: string) => runEntry([flag, revision], deps);
  await call('--prepare-reviewed-runtime-st05');
  const baseline = async (stage: 'st05' | 'final' = 'st05', previousResultHash = history.results.st05) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const observedAt = new Date().toISOString(),
      search = { observedAt, client: '001', table: '*', lockCount: 0, evidenceSha256: sha(jpeg) };
    const data = {
      protocol,
      stage,
      revision,
      intentHash: sha(readFileSync(join(root, 'intent.json'))),
      previousResultHash,
      ordinaryCustSourceContractAcknowledged: true,
      noConcurrentFixtureEditing: true,
      noConcurrentMarianDialogOrPreferenceChanges: true,
      suffixSearch: { ...search, user: '*', argument: `*${RUNTIME_SUFFIX}*` },
      userSearch: { ...search, user: 'MARIAN', argument: '*' },
    };
    const directory = join(root, stage, 'prerequisites');
    writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data), { mode: 0o600 });
    for (const name of ['user', 'suffix']) writeFileSync(join(directory, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
    return { data, directory };
  };
  const putIntent = () => {
    const dir = join(root, 'st05/attempt/run');
    return (
      existsSync(dir) &&
      readdirSync(dir).some((n) => {
        const row = JSON.parse(readFileSync(join(dir, n), 'utf8')).value;
        return row.stage === 'request' && row.method === 'PUT';
      })
    );
  };
  return {
    h,
    temp,
    root,
    binding,
    deps,
    call,
    baseline,
    putIntent,
    setProvider: (fn: () => Promise<string>) => {
      provider = fn;
    },
  };
}
for (const proxy of [false, true])
  it(`only ST05 runs through actual entry/factory/client (${proxy})`, async () => {
    const e = await fixture(proxy);
    try {
      expect(sha(baselineXml)).toBe(history.baselineHash);
      expect(JSON.parse(readFileSync(join(e.root, 'intent.json'), 'utf8')).stages).toEqual(['st05']);
      await e.baseline();
      expect(await e.call('--check-reviewed-runtime-st05-st05')).toMatchObject({
        failure: false,
        executionGrant: false,
      });
      expect(e.deps.readEnv).not.toHaveBeenCalled();
      expect(existsSync(join(e.root, 'st05/attempt'))).toBe(false);
      expect(await e.call('--execute-reviewed-runtime-st05-st05')).toMatchObject({
        failure: false,
        restored: true,
        remaining: [],
        clientIsolated: false,
        ppQualified: false,
        publicAdmission: false,
      });
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
      expect(calls.some((c) => ['POST', 'DELETE'].includes(c.method))).toBe(false);
      expect(e.h.state.st05).toBe(baselineXml);
      await expect(e.call('--execute-reviewed-runtime-st05-st05')).rejects.toThrow();
      await expect(e.call('--prepare-reviewed-runtime-st05')).rejects.toThrow();
      await e.baseline('final', sha(readFileSync(join(e.root, 'st05/attempt/result.json'))));
      expect(await e.call('--verify-reviewed-runtime-st05-cleanup')).toMatchObject({
        failure: false,
        completedHere: ['st05'],
        fixedRepresentativesCompleted: true,
        readAbsenceConfirmed: false,
        profilerParametersCleanup: 'native-retention-unverified',
        recording: 'native-governed-unverified',
      });
      expect(readFileSync(join(e.root, 'st05/attempt/result.json'), 'utf8')).not.toMatch(
        /synthetic-only|secret-lock|own-context-secret/,
      );
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  });
it.each(['formatter', 'quickfix', 'profiler', 'populated-flp'])(
  'refuses prefix stage %s before binding or credentials',
  async (stage) => {
    const e = await fixture();
    try {
      e.deps.bind.mockClear();
      await expect(e.call(`--execute-reviewed-runtime-st05-${stage}`)).rejects.toThrow();
      expect(e.deps.bind).not.toHaveBeenCalled();
      expect(e.deps.readEnv).not.toHaveBeenCalled();
      expect(() => runRetainedSt05({ ...e.h.input, stage: stage as any })).toThrow();
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  },
);
it.each(['image', 'expired', 'old-result', 'history', 'intent', 'factory', 'native-baseline'])(
  'refuses %s without a native PUT and consumes only new claim',
  async (kind) => {
    const e = await fixture();
    try {
      const { data, directory } = await e.baseline();
      if (kind === 'image') writeFileSync(join(directory, 'sm12-user.jpg'), 'bad');
      if (kind === 'expired') data.userSearch.observedAt = '2000-01-01T00:00:00.000Z';
      if (kind === 'old-result') data.previousResultHash = history.results['populated-flp'];
      if (['expired', 'old-result'].includes(kind))
        writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data));
      if (kind === 'history')
        e.deps.verifyEvidence.mockImplementation(() => {
          throw new Error('drift');
        });
      if (kind === 'intent') writeFileSync(join(e.root, 'intent.json'), '{}');
      if (kind === 'factory')
        e.deps.createClient.mockImplementation(
          (o: any) => new AdtClient({ ...o, baseUrl: origin, safety: { ...o.safety, multiTargetWrite: undefined } }),
        );
      if (kind === 'native-baseline')
        e.h.state.st05 = e.h.state.st05.replace(
          '<ts:stackTraceOn>false</ts:stackTraceOn>',
          '<ts:stackTraceOn>true</ts:stackTraceOn>',
        );
      expect(await e.call('--execute-reviewed-runtime-st05-st05')).toMatchObject({ failure: true });
      expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
      if (!['factory', 'native-baseline'].includes(kind)) expect(e.deps.readEnv).not.toHaveBeenCalled();
      await expect(e.call('--execute-reviewed-runtime-st05-st05')).rejects.toThrow();
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  },
);
for (const proxy of [false, true])
  for (const mode of ['history-after-auth', 'deadline-in-proof', 'stop-after-on'] as const)
    it(`preserves final dispatch/inspection boundary ${mode} (${proxy})`, async () => {
      const e = await fixture(proxy);
      try {
        await e.baseline();
        let changed = false,
          offset = 0;
        const start = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        if (mode === 'history-after-auth')
          e.setProvider(async () => {
            if (e.putIntent()) changed = true;
            return 'synthetic';
          });
        e.deps.verifyEvidence.mockImplementation(() => {
          if (mode === 'deadline-in-proof' && e.putIntent()) offset = 31000;
          if (changed || (mode === 'stop-after-on' && calls.some((c) => c.method === 'PUT')))
            throw new Error('changed proof');
        });
        const result: any = await e.call('--execute-reviewed-runtime-st05-st05');
        expect(result.failure).toBe(true);
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(mode === 'stop-after-on' ? 1 : 0);
        if (mode === 'stop-after-on') {
          expect(result.restored).toBe(false);
          expect(result.remaining).toHaveLength(1);
          expect(result.mutationDispatched).toBe(true);
        }
      } finally {
        rmSync(e.temp, { recursive: true, force: true });
      }
    });
it('keeps uncertainty after one rejected OFF without a third PUT', async () => {
  const e = await fixture(false, (c) =>
    c.method === 'PUT' && c.body.includes('<ts:sqlOn>false</ts:sqlOn>') ? { status: 503, body: '' } : undefined,
  );
  try {
    await e.baseline();
    expect(await e.call('--execute-reviewed-runtime-st05-st05')).toMatchObject({
      failure: true,
      restored: false,
      mutationDispatched: true,
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    await e.baseline('final', sha(readFileSync(join(e.root, 'st05/attempt/result.json'))));
    await expect(e.call('--verify-reviewed-runtime-st05-cleanup')).rejects.toThrow();
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
for (const proxy of [false, true])
  for (const kind of ['history', 'deadline'] as const)
    it(`real semaphore wait retains ${kind} guard before first PUT (${proxy})`, async () => {
      const { Semaphore } = await import('../../../src/adt/semaphore.js');
      const semaphore = new Semaphore(1);
      let release!: () => void, held: Promise<void> | undefined, pending: Promise<any> | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0,
        acquired = false,
        changed = false,
        offset = 0;
      const e = await fixture(proxy, (call) => {
        if (call.method === 'GET' && call.path.split('?')[0] === '/sap/bc/adt/st05/trace/state' && ++reads === 2)
          held = semaphore.run(async () => {
            acquired = true;
            await gate;
          });
      });
      try {
        await e.baseline();
        const factory = e.deps.createClient.getMockImplementation()!;
        e.deps.createClient.mockImplementation((options: any) => factory({ ...options, adtSemaphore: semaphore }));
        const start = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        e.deps.verifyEvidence.mockImplementation(() => {
          if (changed) throw new Error('history changed in queue');
        });
        pending = e.call('--execute-reviewed-runtime-st05-st05');
        for (let i = 0; i < 100 && !(acquired && semaphore.waiting && e.putIntent()); i++)
          await new Promise((resolve) => setTimeout(resolve, 5));
        expect(
          acquired && semaphore.waiting > 0 && e.putIntent(),
          JSON.stringify({
            acquired,
            waiting: semaphore.waiting,
            reads,
            intent: e.putIntent(),
            calls: calls.map((c) => ({ method: c.method, path: c.path })),
          }),
        ).toBe(true);
        if (kind === 'history') changed = true;
        else offset = 31_000;
        release();
        await held;
        expect(await pending).toMatchObject({ failure: true, mutationDispatched: false, remaining: [] });
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
      } finally {
        release();
        await held;
        await pending;
        rmSync(e.temp, { recursive: true, force: true });
      }
    });
