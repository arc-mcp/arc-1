import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';

const { runNativeRuntimeRetained } = await import('../../../scripts/qualification/pr1142/native-runtime-retained.js');
const { runRetainedRuntimeSlice } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-retained-driver.js'
);
const {
  runtimeRetainedHistory: history,
  RUNTIME_RETAINED_PROTOCOL: protocol,
  runtimeRetainedClassReceipt: receipt,
  RUNTIME_RETAINED_STAGES: stages,
} = await import('../../../scripts/qualification/pr1142/native-runtime-retained-fixed.js');
const { verifyRuntimeRetainedHistory } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-retained-history.js'
);
const { RUNTIME_SUFFIX } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js');
const { nativeRuntimeDefaults } = await import('../../../scripts/qualification/pr1142/native-runtime-slice-runtime.js');

import {
  AdtClient,
  calls,
  harness,
  origin,
  owner,
  rows,
  runtimeProposal,
  runtimeStoredSource,
} from '../../helpers/runtime-slice-harness.js';

const captured = JSON.parse(
  readFileSync(new URL('../../fixtures/quickfix/a4h-retained-runtime-class.json', import.meta.url), 'utf8'),
);
const evaluation = readFileSync(
  new URL('../../fixtures/quickfix/a4h-native-evaluation-types.xml', import.meta.url),
  'utf8',
);
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function retained(proxy = false, change?: (call: any, state: any, response: any) => any) {
  const h = harness('quickfix', proxy, (call, state, response) => {
    if (call.path.includes('_action=LOCK'))
      response = { ...response, headers: { ...response.headers, 'set-cookie': 'sap-contextid=own-context-secret' } };
    if (call.method === 'GET' && call.path.split('?')[0] === owner && state.exists)
      response = { ...response, body: captured.metadata };
    if (call.method === 'POST' && call.path.startsWith('/sap/bc/adt/quickfixes/evaluation?'))
      response = { ...response, body: evaluation };
    return change?.(call, state, response) ?? response;
  });
  h.state.exists = true;
  h.state.source = captured.source;
  return { ...h, run: () => runRetainedRuntimeSlice(h.input) };
}
it('retains exact captured identity and raw source, including native CRLF bytes', () => {
  expect(sha(captured.metadata)).toBe(receipt.metadataHash);
  expect(sha(captured.source)).toBe(receipt.sourceHash);
  expect(captured.source.replace(/\r\n/g, '\n').trimEnd()).toBe(runtimeStoredSource);
});
for (const proxy of [false, true]) {
  it(`actual retained driver computes only an unsaved delta and deletes once (${proxy})`, async () => {
    const h = retained(proxy);
    const result = await h.run();
    expect(result, JSON.stringify({ result, calls, rows }, null, 2)).toMatchObject({
      failure: false,
      adopted: [owner],
      createReplayed: false,
      sourceUnchanged: true,
      confirmedDeleted: [owner],
      remaining: [],
      finalAbsent: true,
      cleanup: { unlockFailed: false, sessionClosed: true },
    });
    expect(
      calls.some(
        (c) =>
          c.method === 'PUT' || c.path.split('?')[0] === '/sap/bc/adt/oo/classes' || c.path.includes('/activation'),
      ),
    ).toBe(false);
    expect(calls.filter((c) => c.path.split('?')[0] === runtimeProposal)).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(h.state.source).toBe(captured.source);
  });
  it(`late credential/token-bound proof rejects application before sending (${proxy})`, async () => {
    const h = retained(proxy);
    let changed = false;
    h.setProvider(async () => {
      if (rows.some((r) => r.stage === 'request' && r.path === runtimeProposal)) changed = true;
      return 'synthetic';
    });
    h.input.verifySource.mockImplementation(() => {
      if (changed) throw new Error('history changed');
    });
    expect(await h.run()).toMatchObject({ failure: true, remaining: [owner] });
    expect(rows.some((r) => r.stage === 'request' && r.path === runtimeProposal)).toBe(true);
    expect(
      calls.some((c) => c.path.split('?')[0] === runtimeProposal || c.method === 'DELETE' || c.method === 'PUT'),
    ).toBe(false);
  });
  it(`effective deadline still refuses after synchronous proof work (${proxy})`, async () => {
    const h = retained(proxy),
      start = Date.now();
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
    h.input.verifySource.mockImplementation(() => {
      if (rows.some((r) => r.stage === 'request' && r.path === runtimeProposal)) offset = 31_000;
    });
    expect(await h.run()).toMatchObject({ failure: true, remaining: [owner] });
    expect(calls.some((c) => c.path.split('?')[0] === runtimeProposal || c.method === 'DELETE')).toBe(false);
  });
}
it.each(['source', 'metadata', 'owner', 'creator', 'state'])(
  'fresh %s mismatch refuses before evaluation/application/delete',
  async (kind) => {
    const h = retained(false, (c, state, response) => {
      if (c.method === 'GET' && c.path.split('?')[0] === owner) {
        if (kind === 'metadata') response.body += '\n';
        if (kind === 'owner') response.body = response.body.replace('ZCL_RSF_', 'ZCL_FOREIGN_');
        if (kind === 'creator') response.body = response.body.replace('createdBy="MARIAN"', 'createdBy="OTHER"');
        if (kind === 'state') response.body = response.body.replace('version="inactive"', 'version="active"');
      }
      if (kind === 'source') state.source = runtimeStoredSource;
      return response;
    });
    expect(await h.run()).toMatchObject({ failure: true, remaining: [owner], inspectionRequired: [owner] });
    expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
  },
);
it.each(['present', 'unknown'])(
  'later %s observation retains the owner despite confirmed historical deletion',
  async (kind) => {
    let postReads = 0;
    const h = retained(false, (c, _s, r) => {
      if (
        c.method === 'GET' &&
        c.path.split('?')[0] === owner &&
        calls.some((x) => x.method === 'DELETE') &&
        ++postReads === 3
      )
        return kind === 'present' ? { ...r, status: 200, body: captured.metadata } : { ...r, status: 503, body: '' };
      return r;
    });
    expect(await h.run()).toMatchObject({
      failure: true,
      confirmedDeleted: [owner],
      remaining: [owner],
      inspectionRequired: [owner],
      finalAbsent: false,
    });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  },
);
it('stop after acquiring the deletion lock preserves the class and its owning cleanup', async () => {
  const h = retained();
  h.input.shouldStop = () => calls.some((c) => c.path.includes('_action=LOCK'));
  expect(await h.run()).toMatchObject({
    failure: true,
    remaining: [owner],
    cleanup: { unlockFailed: false, sessionClosed: true },
  });
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('refuses formatter at the retained driver boundary without any call', async () => {
  const h = retained();
  h.input.stage = 'formatter';
  expect(() => h.run()).toThrow();
  expect(calls).toEqual([]);
});
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
async function entry() {
  const temp = mkdtempSync(join(tmpdir(), 'arc1-runtime-retained-')),
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
  const dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    verifyEvidence: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'synthetic-only',
    })),
    createClient: vi.fn((options: any) => nativeRuntimeDefaults.createClient({ ...options, baseUrl: origin })),
  };
  const call = (flag: string) => runNativeRuntimeRetained([flag, revision], dependencies);
  await call('--prepare-reviewed-runtime-retained');
  const baseline = async (stage: (typeof stages)[number] | 'final', previousResultHash: string) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const observedAt = new Date().toISOString();
    const search = { observedAt, client: '001', table: '*', lockCount: 0, evidenceSha256: sha(jpeg) };
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
    for (const name of ['suffix', 'user']) writeFileSync(join(directory, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
    return { data, directory };
  };
  return { temp, root, binding, dependencies, call, baseline };
}
it('complete actual entry/factory/client/tail chain skips formatter and creation, then permanently refuses each replay', async () => {
  retained();
  const e = await entry();
  try {
    let previous: string = history.failedQuickfixResultHash;
    for (const stage of stages) {
      await e.baseline(stage, previous);
      const count = e.dependencies.readEnv.mock.calls.length;
      expect(await e.call(`--check-reviewed-runtime-retained-${stage}`)).toMatchObject({
        failure: false,
        mutationAttempted: false,
        executionGrant: false,
      });
      expect(e.dependencies.readEnv).toHaveBeenCalledTimes(count);
      expect(existsSync(join(e.root, stage, 'attempt'))).toBe(false);
      expect(await e.call(`--execute-reviewed-runtime-retained-${stage}`)).toMatchObject({
        failure: false,
        previousResultHash: previous,
        remaining: [],
        ppQualified: false,
        publicAdmission: false,
      });
      previous = sha(readFileSync(join(e.root, stage, 'attempt/result.json')));
      await expect(e.call(`--execute-reviewed-runtime-retained-${stage}`)).rejects.toThrow();
      await expect(e.call(`--check-reviewed-runtime-retained-${stage}`)).rejects.toThrow();
    }
    await e.baseline('final', previous);
    expect(await e.call('--verify-reviewed-runtime-retained-cleanup')).toMatchObject({
      failure: false,
      fixedRepresentativesCompleted: true,
      readAbsenceConfirmed: false,
      profilerParametersCleanup: 'native-retention-unverified',
    });
    expect(e.dependencies.createClient.mock.calls[0][0].safety.multiTargetWrite).toMatchObject({
      enabled: true,
      target: 'A4H/001',
      allowedPackages: ['$TMP'],
    });
    expect(
      calls.some((c) => c.path.split('?')[0] === '/sap/bc/adt/oo/classes' || c.path.includes('prettyprinter')),
    ).toBe(false);
    expect(readFileSync(join(e.root, 'quickfix/attempt/result.json'), 'utf8')).not.toContain('synthetic-only');
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
it.each(['image', 'expired', 'history', 'intent', 'prior', 'factory'])(
  'actual entry refuses %s mismatch with permanent claim and no repository write',
  async (kind) => {
    retained();
    const e = await entry();
    try {
      const { data, directory } = await e.baseline('quickfix', history.failedQuickfixResultHash);
      if (kind === 'image') writeFileSync(join(directory, 'sm12-user.jpg'), 'bad');
      if (kind === 'expired') {
        data.userSearch.observedAt = '2000-01-01T00:00:00.000Z';
        writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data));
      }
      if (kind === 'prior') {
        data.previousResultHash = 'f'.repeat(64);
        writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data));
      }
      if (kind === 'intent') writeFileSync(join(e.root, 'intent.json'), '{}');
      if (kind === 'history')
        e.dependencies.verifyEvidence.mockImplementation(() => {
          throw new Error('changed historical proof');
        });
      if (kind === 'factory')
        e.dependencies.createClient.mockImplementation(
          (o: any) => new AdtClient({ ...o, baseUrl: origin, safety: { ...o.safety, multiTargetWrite: undefined } }),
        );
      expect(await e.call('--execute-reviewed-runtime-retained-quickfix')).toMatchObject({ failure: true });
      expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
      if (kind !== 'factory') expect(e.dependencies.readEnv).not.toHaveBeenCalled();
      await expect(e.call('--execute-reviewed-runtime-retained-quickfix')).rejects.toThrow();
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  },
);
it('retained entry refuses any original/formatter command and premature later stage', async () => {
  const e = await entry();
  try {
    for (const command of [
      '--execute-reviewed-runtime-quickfix',
      '--execute-reviewed-runtime-retained-formatter',
      '--resume',
    ])
      await expect(e.call(command)).rejects.toThrow();
    await e.baseline('profiler', history.failedQuickfixResultHash);
    expect(await e.call('--execute-reviewed-runtime-retained-profiler')).toMatchObject({
      failure: true,
      stoppedAt: 'prerequisites',
    });
    expect(e.dependencies.readEnv).not.toHaveBeenCalled();
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
function historyFixture() {
  const state = mkdtempSync(join(tmpdir(), 'arc1-runtime-history-')),
    prefix = '/Users/marianzeis/.local/state/';
  const roots = [
    'arc1-qualification/pr1142-native-runtime-flp-v1',
    'arc1-review/pr1142-native-runtime-execution-20261104',
  ];
  const files: Record<string, any> = {};
  const save = (name: string, body: string) => {
    const file = join(state, name);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body, { mode: 0o600 });
    return sha(body);
  };
  const add = (name: string, body: string) => {
    files[prefix + name] = {
      sha256: save(name, body),
      bytes: Buffer.byteLength(body),
      mode: 0o600,
      uid: process.getuid!(),
      gid: process.getgid!(),
    };
  };
  const formatter = JSON.stringify({
    protocol: history.originalProtocol,
    revision: history.originalRevision,
    failure: false,
    restored: true,
  });
  const failure = JSON.stringify({
    protocol: history.originalProtocol,
    revision: history.originalRevision,
    failure: true,
    created: true,
    remaining: [owner],
  });
  add(`${roots[0]}/formatter/attempt/result.json`, formatter);
  add(`${roots[0]}/quickfix/attempt/result.json`, failure);
  for (let i = 0; i < 93; i++) add(`${roots[0]}/${i}.json`, '{}');
  for (let i = 0; i < 17; i++) add(`${roots[1]}/${i}.json`, '{}');
  const audit = 'arc1-review/pr1142-runtime-quickfix-independent-audit1',
    op = 'arc1-review/pr1142-runtime-quickfix-stop-operator-audit1';
  const expected: any = { ...history, formatterResultHash: sha(formatter), failedQuickfixResultHash: sha(failure) };
  expected.independentAuditHash = save(
    `${audit}/result.json`,
    JSON.stringify({
      revision: history.originalRevision,
      formatterResult: sha(formatter),
      quickfixResult: sha(failure),
      proposalApplied: false,
      deleteAttempted: false,
      remaining: [owner],
      originalFiles: files,
    }),
  );
  expected.independentReportHash = save(`${audit}/result.md`, 'independent audit');
  expected.operatorAuditHash = save(`${op}/result.json`, '{}');
  expected.operatorReportHash = save(`${op}/result.md`, 'operator audit');
  return { state, expected, root: join(state, roots[0]) };
}
it.each(['valid', 'changed', 'extra', 'missing', 'permissions'])(
  'complete historical proof refuses %s corruption without touching it',
  (kind) => {
    const h = historyFixture();
    try {
      if (kind === 'changed') writeFileSync(join(h.root, '0.json'), 'changed');
      if (kind === 'extra') writeFileSync(join(h.root, 'extra.json'), '{}');
      if (kind === 'missing') rmSync(join(h.root, '0.json'));
      if (kind === 'permissions') chmodSync(join(h.root, '0.json'), 0o644);
      if (kind === 'valid') expect(() => verifyRuntimeRetainedHistory(h.state, h.expected)).not.toThrow();
      else expect(() => verifyRuntimeRetainedHistory(h.state, h.expected)).toThrow();
    } finally {
      rmSync(h.state, { recursive: true, force: true });
    }
  },
);
it.each(['binding', 'stop'])('final %s proof cannot erase the confirmed cleanup facts', async (kind) => {
  let changed = false,
    reads = 0;
  const h = retained(false, (c, _state, response) => {
    if (
      c.method === 'GET' &&
      c.path.split('?')[0] === owner &&
      calls.some((x) => x.method === 'DELETE') &&
      ++reads === 3
    )
      changed = true;
    return response;
  });
  if (kind === 'binding')
    h.input.verifySource.mockImplementation(() => {
      if (changed) throw new Error('changed proof');
    });
  else h.input.shouldStop = () => changed;
  expect(await h.run()).toMatchObject({
    failure: true,
    confirmedDeleted: [owner],
    finalAbsent: true,
    remaining: [],
    cleanup: { unlockFailed: false, sessionClosed: true },
  });
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});
it('a changed exact receipt under its own lock refuses DELETE and still closes that session', async () => {
  const h = retained(false, (c, state, response) => {
    if (c.path.includes('_action=LOCK')) state.source += '\r\n';
    return response;
  });
  expect(await h.run()).toMatchObject({
    failure: true,
    remaining: [owner],
    inspectionRequired: [owner],
    cleanup: { unlockFailed: false, sessionClosed: true },
  });
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('uncertain own-session closure is preserved after deletion without another DELETE', async () => {
  const h = retained(false, (c, _s, _response) =>
    c.path.split('?')[0] === '/sap/bc/adt/core/http/sessions' ? { status: 503, body: '', headers: {} } : undefined,
  );
  expect(await h.run()).toMatchObject({ failure: true, remaining: [owner], cleanup: { sessionClosed: false } });
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});

const nativeResult = readFileSync(
  new URL('../../fixtures/quickfix/a4h-native-proposal-result.xml', import.meta.url),
  'utf8',
).replace('/sap/bc/adt/oo/classes/zcl_test/source/main', owner + '/source/main');
for (const proxy of [false, true]) {
  it(`captured replacement delta preserves the complete unsaved buffer before cleanup (${proxy})`, async () => {
    const h = retained(proxy, (call, _state, response) =>
      call.method === 'POST' && call.path === runtimeProposal ? { ...response, body: nativeResult } : undefined,
    );
    const result = await h.run();
    expect(result, JSON.stringify({ result, rows })).toMatchObject({
      failure: false,
      sourceUnchanged: true,
      confirmedDeleted: [owner],
      remaining: [],
      finalAbsent: true,
    });
    expect(h.state.source).toBe(captured.source);
    expect(calls.filter((c) => c.path === runtimeProposal)).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(
      calls.some(
        (c) =>
          c.method === 'PUT' || c.path.split('?')[0] === '/sap/bc/adt/oo/classes' || c.path.includes('/activation'),
      ),
    ).toBe(false);
  });
  for (const [label, body] of [
    [
      'existing declaration removed',
      nativeResult.replace('DATA lv_existing TYPE i.\n    DATA: lv_missing TYPE i.', 'DATA: lv_missing TYPE i.'),
    ],
    ['existing declaration retyped', nativeResult.replace('DATA lv_existing TYPE i.', 'DATA lv_existing TYPE string.')],
    [
      'unrelated statement added',
      nativeResult.replace('DATA: lv_missing TYPE i.', 'DATA: lv_missing TYPE i.\n    WRITE lv_missing.'),
    ],
    ['declaration commented out', nativeResult.replace('DATA: lv_missing TYPE i.', '&quot; DATA: lv_missing TYPE i.')],
    [
      'existing statement changed',
      nativeResult
        .replace('end=7,28', 'end=8,19')
        .replace('DATA: lv_missing TYPE i.', 'DATA: lv_missing TYPE i.\n    lv_missing = 2.'),
    ],
    ['unrelated source line replaced', nativeResult.replace('start=7,4;end=7,28', 'start=3,4;end=3,16')],
  ])
    it(`refuses ${label} without cleanup or proposal replay (${proxy})`, async () => {
      const h = retained(proxy, (call, _state, response) =>
        call.method === 'POST' && call.path === runtimeProposal ? { ...response, body } : undefined,
      );
      expect(await h.run()).toMatchObject({
        failure: true,
        reason: 'delta-content',
        remaining: [owner],
        confirmedDeleted: [],
      });
      expect(h.state.source).toBe(captured.source);
      expect(calls.filter((c) => c.path === runtimeProposal)).toHaveLength(1);
      expect(
        calls.some(
          (c) =>
            c.method === 'PUT' ||
            c.method === 'DELETE' ||
            c.path.split('?')[0] === '/sap/bc/adt/oo/classes' ||
            c.path.includes('/activation'),
        ),
      ).toBe(false);
    });
}
