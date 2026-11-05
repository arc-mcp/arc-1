import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AdtClient, calls, harness, origin, owner, runtimeProposal } from '../../helpers/runtime-slice-harness.js';

const { runNativeRuntimeRetainedV2: runEntry } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-retained-v2.js'
);
const { runtimeRetainedV2History: history, RUNTIME_RETAINED_V2_PROTOCOL: protocol } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-retained-v2-fixed.js'
);
const { RUNTIME_RETAINED_STAGES: stages } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-retained-fixed.js'
);
const { RUNTIME_SUFFIX } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js');
const { nativeRuntimeDefaults } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-runtime.js');
const captured = JSON.parse(
  readFileSync(new URL('../../fixtures/quickfix/a4h-retained-runtime-class.json', import.meta.url), 'utf8'),
);
const evaluation = readFileSync(
  new URL('../../fixtures/quickfix/a4h-native-evaluation-types.xml', import.meta.url),
  'utf8',
);
const computed = readFileSync(
  new URL('../../fixtures/quickfix/a4h-native-proposal-result.xml', import.meta.url),
  'utf8',
).replace('/sap/bc/adt/oo/classes/zcl_test/source/main', owner + '/source/main');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
async function fixture(proxy = false) {
  const h = harness('quickfix', proxy, (call, state, response) => {
    if (call.path.includes('_action=LOCK'))
      response = { ...response, headers: { ...response.headers, 'set-cookie': 'sap-contextid=own-context-secret' } };
    if (call.method === 'GET' && call.path.split('?')[0] === owner && state.exists)
      response = { ...response, body: captured.metadata };
    if (call.method === 'POST' && call.path.startsWith('/sap/bc/adt/quickfixes/evaluation?'))
      response = { ...response, body: evaluation };
    if (call.method === 'POST' && call.path === runtimeProposal) response = { ...response, body: computed };
    return response;
  });
  h.state.exists = true;
  h.state.source = captured.source;
  const temp = mkdtempSync(join(tmpdir(), 'arc1-runtime-v2-')),
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
  await call('--prepare-reviewed-runtime-retained-v2');
  const baseline = async (stage: (typeof stages)[number] | 'final', previousResultHash: string) => {
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
    for (const n of ['user', 'suffix']) writeFileSync(join(directory, `sm12-${n}.jpg`), jpeg, { mode: 0o600 });
    return { data, directory };
  };
  return {
    h,
    temp,
    root,
    binding,
    deps,
    call,
    baseline,
    setProvider: (next: () => Promise<string>) => {
      provider = next;
    },
  };
}
for (const proxy of [false, true])
  it(`fixed v2 entry/factory/client runs only remaining stages (${proxy})`, async () => {
    const e = await fixture(proxy);
    try {
      const intent = JSON.parse(readFileSync(join(e.root, 'intent.json'), 'utf8'));
      expect(intent.retainedHistory).toEqual(history);
      expect(intent.stages).toEqual(stages);
      let previous: string = history.failedQuickfixResultHash;
      for (const stage of stages) {
        await e.baseline(stage, previous);
        const loaded = e.deps.readEnv.mock.calls.length;
        expect(await e.call(`--check-reviewed-runtime-retained-v2-${stage}`)).toMatchObject({
          failure: false,
          mutationAttempted: false,
          executionGrant: false,
        });
        expect(e.deps.readEnv).toHaveBeenCalledTimes(loaded);
        expect(existsSync(join(e.root, stage, 'attempt'))).toBe(false);
        expect(await e.call(`--execute-reviewed-runtime-retained-v2-${stage}`)).toMatchObject({
          failure: false,
          previousResultHash: previous,
          remaining: [],
          ppQualified: false,
          publicAdmission: false,
        });
        previous = sha(readFileSync(join(e.root, stage, 'attempt/result.json')));
        await expect(e.call(`--execute-reviewed-runtime-retained-v2-${stage}`)).rejects.toThrow();
        await expect(e.call(`--check-reviewed-runtime-retained-v2-${stage}`)).rejects.toThrow();
      }
      await e.baseline('final', previous);
      expect(await e.call('--verify-reviewed-runtime-retained-v2-cleanup')).toMatchObject({
        failure: false,
        completedHere: stages,
        recording: 'native-governed-unverified',
        readAbsenceConfirmed: false,
        profilerParametersCleanup: 'native-retention-unverified',
      });
      expect(calls.filter((c) => c.path === runtimeProposal)).toHaveLength(1);
      expect(calls.filter((c) => c.method === 'DELETE' && c.path.split('?')[0] === owner)).toHaveLength(1);
      expect(
        calls.some(
          (c) =>
            (c.method === 'PUT' && c.path.includes('/source/')) ||
            c.path.split('?')[0] === '/sap/bc/adt/oo/classes' ||
            c.path.includes('/activation') ||
            c.path.includes('prettyprinter'),
        ),
      ).toBe(false);
      expect(e.h.state.source).toBe(captured.source);
      expect(e.deps.createClient.mock.calls[0][0].safety.multiTargetWrite).toMatchObject({
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['$TMP'],
      });
      expect(readFileSync(join(e.root, 'quickfix/attempt/result.json'), 'utf8')).not.toMatch(
        /synthetic-only|own-context-secret|secret-lock/,
      );
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  });
it.each(['image', 'expired', 'old-result', 'history', 'intent', 'factory'])(
  'v2 refuses %s drift and permanently consumes its claim',
  async (kind) => {
    const e = await fixture();
    try {
      const { data, directory } = await e.baseline('quickfix', history.failedQuickfixResultHash);
      if (kind === 'image') writeFileSync(join(directory, 'sm12-user.jpg'), 'invalid');
      if (kind === 'expired') data.userSearch.observedAt = '2000-01-01T00:00:00.000Z';
      if (kind === 'old-result') data.previousResultHash = history.priorHistory.failedQuickfixResultHash;
      if (['expired', 'old-result'].includes(kind))
        writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data));
      if (kind === 'intent') writeFileSync(join(e.root, 'intent.json'), '{}');
      if (kind === 'history')
        e.deps.verifyEvidence.mockImplementation(() => {
          throw new Error('changed history');
        });
      if (kind === 'factory')
        e.deps.createClient.mockImplementation(
          (options: any) =>
            new AdtClient({ ...options, baseUrl: origin, safety: { ...options.safety, multiTargetWrite: undefined } }),
        );
      expect(await e.call('--execute-reviewed-runtime-retained-v2-quickfix')).toMatchObject({
        failure: true,
        remaining: [owner],
        inspectionRequired: [owner],
      });
      expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
      if (kind !== 'factory') expect(e.deps.readEnv).not.toHaveBeenCalled();
      await expect(e.call('--execute-reviewed-runtime-retained-v2-quickfix')).rejects.toThrow();
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  },
);
it('v2 refuses older commands, formatter and out-of-order stages without credential reads', async () => {
  const e = await fixture();
  try {
    for (const flag of [
      '--resume',
      '--execute-reviewed-runtime-quickfix',
      '--execute-reviewed-runtime-retained-quickfix',
      '--execute-reviewed-runtime-retained-v2-formatter',
    ])
      await expect(e.call(flag)).rejects.toThrow();
    await e.baseline('profiler', history.failedQuickfixResultHash);
    expect(await e.call('--execute-reviewed-runtime-retained-v2-profiler')).toMatchObject({
      failure: true,
      stoppedAt: 'prerequisites',
    });
    expect(e.deps.readEnv).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
for (const proxy of [false, true])
  it(`v2 rechecks history after auth wait before actual application (${proxy})`, async () => {
    const e = await fixture(proxy);
    try {
      await e.baseline('quickfix', history.failedQuickfixResultHash);
      let changed = false;
      e.setProvider(async () => {
        const directory = join(e.root, 'quickfix/attempt/run');
        if (
          readdirSync(directory).some((name) => {
            const row = JSON.parse(readFileSync(join(directory, name), 'utf8')).value;
            return row.stage === 'request' && row.path === runtimeProposal;
          })
        )
          changed = true;
        return 'synthetic';
      });
      e.deps.verifyEvidence.mockImplementation(() => {
        if (changed) throw new Error('changed history');
      });
      expect(await e.call('--execute-reviewed-runtime-retained-v2-quickfix')).toMatchObject({
        failure: true,
        remaining: [owner],
      });
      expect(calls.some((c) => c.path === runtimeProposal || c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  });

for (const proxy of [false, true])
  it(`v2 effective request deadline is rechecked after final history work (${proxy})`, async () => {
    const e = await fixture(proxy);
    try {
      await e.baseline('quickfix', history.failedQuickfixResultHash);
      const start = Date.now();
      let offset = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
      e.deps.verifyEvidence.mockImplementation(() => {
        const directory = join(e.root, 'quickfix/attempt/run');
        if (
          existsSync(directory) &&
          readdirSync(directory).some((name) => {
            const row = JSON.parse(readFileSync(join(directory, name), 'utf8')).value;
            return row.stage === 'request' && row.path === runtimeProposal;
          })
        )
          offset = 31000;
      });
      expect(await e.call('--execute-reviewed-runtime-retained-v2-quickfix')).toMatchObject({
        failure: true,
        remaining: [owner],
      });
      expect(calls.some((c) => c.path === runtimeProposal || c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  });
for (const proxy of [false, true])
  it(`v2 preserves own cleanup after history changes under the lock (${proxy})`, async () => {
    const e = await fixture(proxy);
    try {
      await e.baseline('quickfix', history.failedQuickfixResultHash);
      e.deps.verifyEvidence.mockImplementation(() => {
        if (calls.some((c) => c.path.includes('_action=LOCK'))) throw new Error('history changed under lock');
      });
      expect(await e.call('--execute-reviewed-runtime-retained-v2-quickfix')).toMatchObject({
        failure: true,
        remaining: [owner],
        cleanup: { unlockFailed: false, sessionClosed: true },
      });
      expect(calls.some((c) => c.method === 'DELETE' || c.method === 'PUT')).toBe(false);
      expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  });
