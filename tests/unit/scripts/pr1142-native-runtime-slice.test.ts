import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import {
  AdtClient,
  calls,
  f,
  formatterType,
  formatterXml,
  harness,
  origin,
  owner,
  parsePinnedFormatterDocument,
  RUNTIME_STAGES,
  rows,
  runRuntimeSlice,
  runtimeProposal,
  runtimeStoredSource,
  st05Xml,
  TRACE_BASE,
} from '../../helpers/runtime-slice-harness.js';

for (const stage of RUNTIME_STAGES)
  for (const useProxy of [false, true])
    it(`fixed ${stage} uses actual ${useProxy ? 'Connectivity' : 'direct'} dispatch`, async () => {
      const h = harness(stage, useProxy);
      const result = await h.run();
      expect(result, JSON.stringify({ result, rows }, null, 2)).toMatchObject({ failure: false, remaining: [] });
      expect(calls.some((c) => c.path.includes('/activation') || c.path.includes('/unit'))).toBe(false);
      if (stage === 'formatter')
        expect(parsePinnedFormatterDocument(h.state.formatter).settings).toEqual(
          parsePinnedFormatterDocument(formatterXml).settings,
        );
      if (stage === 'st05') {
        expect(h.state.st05).toBe(st05Xml);
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
      }
      if (stage === 'profiler') {
        expect(h.state.armed).toBe(false);
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
      }
      if (stage === 'quickfix') {
        expect(h.state.source).toBe(runtimeStoredSource);
        expect(h.state.exists).toBe(false);
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
      }
      if (stage === 'populated-flp') {
        expect(h.state.catalog || h.state.group).toBe(false);
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(4);
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
      }
    });
it('never changes an ST05 filter that could not be restored', async () => {
  const h = harness('st05');
  h.state.st05 = h.state.st05.replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>');
  expect(await h.run()).toMatchObject({ failure: true, reason: 'st05-restoration-prerequisite', remaining: [] });
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);
});
it('retains the formatter baseline after one uncertain PUT, without retry or guessed restoration', async () => {
  const h = harness('formatter', false, (c) => (c.method === 'PUT' ? { status: 503, body: '' } : undefined));
  expect(await h.run()).toMatchObject({ failure: true, restored: false });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});
it('refuses changed opaque formatter fields before restoration', async () => {
  const h = harness('formatter', false, (c, _s, r) =>
    c.method === 'GET' && calls.some((x) => x.method === 'PUT')
      ? { ...r, body: r.body.replace('extra="keep"', 'extra="foreign"') }
      : undefined,
  );
  expect(await h.run()).toMatchObject({ failure: true, restored: false });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});
for (const useProxy of [false, true])
  it(`final proof expiry after auth wait blocks the first write (${useProxy})`, async () => {
    const h = harness('formatter', useProxy);
    let expired = false;
    h.input.verifySource.mockImplementation(() => {
      if (expired) throw new Error('changed');
    });
    h.setProvider(async () => {
      if (rows.some((r) => r.stage === 'request' && r.method === 'PUT')) expired = true;
      return 'synthetic';
    });
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
it('refuses foreign populated membership before any parent deletion', async () => {
  const h = harness('populated-flp', false, (c, s, r) =>
    c.method === 'GET' && c.path.includes('/PageChipInstances') && s.member
      ? {
          ...r,
          body: JSON.stringify({
            d: {
              results: [
                JSON.parse(r.body).d.results[0],
                { instanceId: 'foreign', pageId: 'foreign', chipId: 'foreign' },
              ],
            },
          }),
        }
      : undefined,
  );
  expect((await h.run()).failure).toBe(true);
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
});

const { runNativeRuntimeSlice: entry } = await import('../../../scripts/qualification/pr1142/native-runtime-slice.js');
const { RUNTIME_PROTOCOL, RUNTIME_SUFFIX } = await import(
  '../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js'
);
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
async function entryFixture() {
  const temp = mkdtempSync(join(tmpdir(), 'arc1-runtime-entry-')),
    root = join(temp, RUNTIME_PROTOCOL),
    revision = 'a'.repeat(40);
  const bound = {
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
  const deps = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => bound),
    verifyEvidence: vi.fn(),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'synthetic-only',
    })),
    createClient: vi.fn((options: any) => new AdtClient({ ...options, baseUrl: origin })),
    execute: runRuntimeSlice,
  };
  const call = (cmd: string) => entry([cmd, revision], deps);
  await call('--prepare-reviewed-runtime');
  await new Promise((resolve) => setTimeout(resolve, 2));
  const observedAt = new Date().toISOString(),
    intentHash = sha(readFileSync(join(root, 'intent.json')));
  const search = { observedAt, client: '001', table: '*', lockCount: 0, evidenceSha256: sha(jpeg) };
  const baseline = {
    protocol: RUNTIME_PROTOCOL,
    stage: 'formatter',
    revision,
    intentHash,
    previousResultHash: null,
    ordinaryCustSourceContractAcknowledged: true,
    noConcurrentFixtureEditing: true,
    noConcurrentMarianDialogOrPreferenceChanges: true,
    suffixSearch: { ...search, user: '*', argument: `*${RUNTIME_SUFFIX}*` },
    userSearch: { ...search, user: 'MARIAN', argument: '*' },
  };
  const directory = join(root, 'formatter/prerequisites');
  writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(baseline), { mode: 0o600 });
  for (const name of ['suffix', 'user']) writeFileSync(join(directory, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  return { temp, root, deps, call, baseline, directory };
}
it('real entry injects pinned policy into the actual factory and driver; local check does not read credentials', async () => {
  const h = harness('formatter'),
    e = await entryFixture();
  try {
    expect(await e.call('--check-reviewed-runtime-formatter')).toMatchObject({ failure: false, executionGrant: false });
    expect(e.deps.readEnv).not.toHaveBeenCalled();
    expect(await e.call('--execute-reviewed-runtime-formatter')).toMatchObject({
      failure: false,
      restored: true,
      ppQualified: false,
      publicAdmission: false,
    });
    expect(e.deps.createClient.mock.calls[0][0].safety.multiTargetWrite).toMatchObject({
      enabled: true,
      target: 'A4H/001',
      allowedPackages: ['$TMP'],
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    expect(parsePinnedFormatterDocument(h.state.formatter).settings).toEqual(
      parsePinnedFormatterDocument(formatterXml).settings,
    );
    await expect(e.call('--execute-reviewed-runtime-formatter')).rejects.toThrow();
    expect(e.deps.readEnv).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(e.root, 'formatter/attempt/result.json'), 'utf8')).not.toContain('synthetic-only');
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
it('actual factory dropping policy is refused before a native settings write', async () => {
  harness('formatter');
  const e = await entryFixture();
  try {
    e.deps.createClient.mockImplementation(
      (options) => new AdtClient({ ...options, safety: { ...options.safety, multiTargetWrite: undefined } }),
    );
    expect((await e.call('--execute-reviewed-runtime-formatter')).failure).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});
it.each(['image', 'hash', 'identity', 'stage', 'timestamp', 'concurrency'])(
  'claims but refuses invalid %s prerequisites without credentials',
  async (kind) => {
    const e = await entryFixture();
    try {
      if (kind === 'image') writeFileSync(join(e.directory, 'sm12-user.jpg'), 'not-jpeg');
      else {
        const b: any = e.baseline;
        if (kind === 'hash') b.intentHash = 'f'.repeat(64);
        if (kind === 'identity') b.userSearch.user = 'OTHER';
        if (kind === 'stage') b.stage = 'profiler';
        if (kind === 'timestamp') b.userSearch.observedAt = '2000-01-01T00:00:00.000Z';
        if (kind === 'concurrency') b.noConcurrentMarianDialogOrPreferenceChanges = false;
        writeFileSync(join(e.directory, 'sm12-baseline.json'), JSON.stringify(b));
      }
      expect(await e.call('--execute-reviewed-runtime-formatter')).toMatchObject({
        failure: true,
        stoppedAt: 'prerequisites',
      });
      expect(e.deps.readEnv).not.toHaveBeenCalled();
      expect(existsSync(join(e.root, 'formatter/attempt'))).toBe(true);
      await expect(e.call('--execute-reviewed-runtime-formatter')).rejects.toThrow();
    } finally {
      rmSync(e.temp, { recursive: true, force: true });
    }
  },
);
for (const useProxy of [false, true])
  it(`effective thirty-second clamp remains checked after synchronous proof (${useProxy})`, async () => {
    const h = harness('formatter', useProxy),
      start = Date.now();
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
    h.input.verifySource.mockImplementation(() => {
      if (rows.some((r) => r.stage === 'request' && r.method === 'PUT')) offset = 31000;
    });
    expect((await h.run()).failure).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
it('late stop preserves ST05 baseline and reports the armed state for inspection', async () => {
  const h = harness('st05');
  h.input.shouldStop = () => calls.some((c) => c.method === 'PUT');
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, restored: false });
  expect((result as any).remaining.length).toBe(1);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});
it('unknown profiler request outcome is never cancelled by a guessed ID or retried', async () => {
  const h = harness('profiler', false, (c) =>
    c.method === 'POST' && c.path.startsWith(`${TRACE_BASE}/requests?`) ? { status: 503, body: '' } : undefined,
  );
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect((result as any).remaining.length).toBe(1);
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});

it('native delta that rewrites a nonempty range never proves the unsaved quickfix', async () => {
  const h = harness('quickfix', false, (c, _s, r) =>
    c.path === runtimeProposal ? { ...r, body: r.body.replace('end=8,4', 'end=8,5') } : undefined,
  );
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, reason: 'delta-content' });
  expect((result as any).remaining).toEqual([owner]);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it('under-own-lock source drift stops class deletion but still sends only its UNLOCK', async () => {
  let locks = 0;
  const h = harness('quickfix', false, (c, s, r) => {
    if (c.path.includes('_action=LOCK')) {
      locks++;
      if (locks === 2) s.source += '\n* foreign change';
    }
    return r;
  });
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect((result as any).remaining).toEqual([owner]);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
});
it.each(['present', 'unknown'])('historical class deletion does not hide later %s evidence', async (kind) => {
  let reads = 0;
  const h = harness('quickfix', false, (c, _s, r) => {
    if (c.method === 'GET' && c.path.split('?')[0] === owner && calls.some((x) => x.method === 'DELETE')) {
      reads++;
      if (reads === 3) return kind === 'present' ? { status: 200, body: 'present' } : { status: 503, body: '' };
    }
    return r;
  });
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, confirmedDeleted: [owner], remaining: [owner], finalAbsent: false });
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});
it('missing or foreign namespace profiler feeds cannot be treated as empty baseline', async () => {
  const h = harness('profiler', false, (c) =>
    c.method === 'GET' ? { status: 200, body: '<x:feed xmlns:x="urn:foreign"/>' } : undefined,
  );
  expect((await h.run()).failure).toBe(true);
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});
it('oversized settings response stops without replacement defaults', async () => {
  const h = harness('formatter', false, (c) =>
    c.method === 'GET'
      ? { status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1), headers: { 'content-type': formatterType } }
      : undefined,
  );
  expect((await h.run()).failure).toBe(true);
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);
});
it('known existing catalog is never overwritten under the backend-create-only alternative', async () => {
  const h = harness('populated-flp');
  h.state.catalog = true;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
});
it('a narrow destination request policy refuses the populated FLP stage', async () => {
  const h = harness('populated-flp');
  Object.assign(h.input.base.safety.multiTargetWrite!, { allowedTransports: ['A4HK900001'] });
  await expect(h.run()).rejects.toThrow();
  expect(calls).toEqual([]);
});
it('read-only safety refuses all mutation stages before any native request', async () => {
  const h = harness('formatter');
  h.input.base.safety.allowWrites = false;
  expect((await h.run()).failure).toBe(true);
  expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
});

it('own class UNLOCK survives an expiry arriving immediately after LOCK', async () => {
  const h = harness('quickfix'),
    start = Date.now();
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
  const record = h.input.record;
  h.input.record = (row) => {
    record(row);
    const event = row as any;
    if (event.stage === 'response' && event.path.includes('_action=LOCK')) offset = 130000;
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect((result as any).remaining).toEqual([owner]);
});

it('catalog DELETE acknowledgement cannot hide a still-readable owned Page', async () => {
  const h = harness('populated-flp', false, (call, _state, response) =>
    call.method === 'GET' &&
    call.path.includes('/Pages(') &&
    call.path.includes('CATALOGPAGE') &&
    calls.some((c) => c.method === 'DELETE' && c.path.includes('/Catalogs('))
      ? { ...response, status: 200, body: JSON.stringify({ d: { id: `X-SAP-UI2-CATALOGPAGE:${f.catalogId}` } }) }
      : response,
  );
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, reason: 'post-delete-page-present' });
  expect((result as any).nativeDeleteCompleted).toHaveLength(2);
  expect((result as any).remaining).toHaveLength(1);
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
});

for (const useProxy of [false, true]) {
  it(`changed catalog marker refuses tile POST (${useProxy})`, async () => {
    const h = harness('populated-flp', useProxy, (c, s, response) => {
      if (c.method === 'GET' && c.path.includes('/Catalogs(') && s.group && !s.tile) s.foreignCatalog = true;
      if (c.method === 'GET' && c.path.includes('/Catalogs(') && response.status === 200 && s.foreignCatalog) {
        const body = JSON.parse(response.body);
        body.d.title = 'FOREIGN changed catalog';
        return { ...response, body: JSON.stringify(body) };
      }
      return response;
    });
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(
      calls.filter((c) => c.method === 'POST' && new URL(c.path, origin).pathname.endsWith('/PageChipInstances')),
    ).toHaveLength(0);
  });
  it(`changed group marker refuses assignment POST (${useProxy})`, async () => {
    const h = harness('populated-flp', useProxy, (c, s, response) => {
      if (c.method === 'GET' && c.path.includes('/Pages(') && c.path.includes(f.groupId) && s.tile && !s.member)
        s.foreignGroup = true;
      if (
        c.method === 'GET' &&
        c.path.includes('/Pages(') &&
        c.path.includes(f.groupId) &&
        response.status === 200 &&
        s.foreignGroup
      ) {
        const body = JSON.parse(response.body);
        body.d.title = 'FOREIGN changed group';
        return { ...response, body: JSON.stringify(body) };
      }
      return response;
    });
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(
      calls.filter((c) => c.method === 'POST' && new URL(c.path, origin).pathname.endsWith('/PageChipInstances')),
    ).toHaveLength(1);
  });
}

for (const useProxy of [false, true])
  it(`profiler preserves known orphaned parameters after expiry between its two POSTs (${useProxy})`, async () => {
    const h = harness('profiler', useProxy);
    const actualModule = await import('../../../src/handlers/pinned-trace.js');
    const original = actualModule.executePrivatePinnedTrace;
    const outcomes: any[] = [];
    vi.spyOn(actualModule, 'executePrivatePinnedTrace').mockImplementation(async (...args) => {
      const result = await original(...args);
      outcomes.push(JSON.parse(result.content[0].text));
      return result;
    });
    const time = Date.now();
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => time + offset);
    const record = h.input.record;
    h.input.record = (row) => {
      record(row);
      const r = row as any;
      if (r.stage === 'response' && r.path === `${TRACE_BASE}/parameters`) offset = 130000;
    };
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      state: 'parameters-orphaned',
      parametersId: `${TRACE_BASE}/parameters/123`,
      requestOutcome: 'not-sent',
    });
    expect((result as any).parametersId).toBe(`${TRACE_BASE}/parameters/123`);
  });

for (const useProxy of [false, true]) {
  it(`retains exact parent receipt fields beyond its marker (${useProxy})`, async () => {
    const h = harness('populated-flp', useProxy, (c, state, response) => {
      if (
        c.method === 'GET' &&
        c.path.includes('/Catalogs(') &&
        state.group &&
        !state.tile &&
        response.status === 200
      ) {
        const body = JSON.parse(response.body);
        body.d.foreignOpaque = 'changed';
        return { ...response, body: JSON.stringify(body) };
      }
      return response;
    });
    expect(await h.run()).toMatchObject({ failure: true, stoppedAt: 'tile' });
    expect(rows.some((row) => row.childWriteParentsVerified === 'tile')).toBe(false);
    expect(
      calls.filter((c) => c.method === 'POST' && new URL(c.path, origin).pathname.endsWith('/PageChipInstances')),
    ).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
  for (const fault of ['source', 'deadline', 'stop'] as const)
    it(`child send repeats ${fault} after proof and authentication (${useProxy})`, async () => {
      const h = harness('populated-flp', useProxy);
      let changed = false,
        offset = 0;
      const now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now + offset);
      h.input.verifySource = vi.fn(() => {
        if (changed && fault === 'source') throw new Error('source changed');
      });
      h.input.shouldStop = () => changed && fault === 'stop';
      h.setProvider(async () => {
        if (rows.some((row) => row.childWriteParentsVerified === 'tile')) {
          changed = true;
          if (fault === 'deadline') offset = 130000;
        }
        return 'synthetic';
      });
      const result = await h.run();
      expect(changed).toBe(true);
      expect(result).toMatchObject({ failure: true, cleanup: { sessionClosed: true } });
      expect(
        calls.filter((c) => c.method === 'POST' && new URL(c.path, origin).pathname.endsWith('/PageChipInstances')),
      ).toHaveLength(0);
      expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });
  for (const status of [400, 503])
    it(`profiler request ${status} retains diagnostic parameters without cancellation (${useProxy})`, async () => {
      const h = harness('profiler', useProxy, (c) =>
        c.method === 'POST' && c.path.startsWith(`${TRACE_BASE}/requests?`) ? { status, body: '' } : undefined,
      );
      const result = (await h.run()) as any;
      expect(result).toMatchObject({
        failure: true,
        parametersId: `${TRACE_BASE}/parameters/123`,
        parametersDispatched: true,
        requestDispatched: true,
        startOutcome: { state: status === 400 ? 'parameters-orphaned' : 'request-unconfirmed' },
      });
      expect(result.remaining).toEqual(
        status === 400 ? [`${TRACE_BASE}/parameters/123`] : ['MARIAN profiler request outcome unknown'],
      );
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
      expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });
  it(`profiler unknown parameters cannot become cancellation authority (${useProxy})`, async () => {
    const h = harness('profiler', useProxy, (c) =>
      c.method === 'POST' && new URL(c.path, origin).pathname === `${TRACE_BASE}/parameters`
        ? { status: 201, body: '', headers: { location: 'https://foreign.invalid/parameters/123' } }
        : undefined,
    );
    const result = (await h.run()) as any;
    expect(result).toMatchObject({
      failure: true,
      parametersDispatched: true,
      requestDispatched: false,
      remaining: ['MARIAN profiler parameters outcome unknown'],
    });
    expect(result.parametersId).toBeUndefined();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
}

it('actual entry persists orphaned parameters and not-sent request through terminal expiry', async () => {
  harness('profiler');
  const e = await entryFixture();
  try {
    let previous: string | null = null;
    for (const stage of ['formatter', 'quickfix', 'profiler']) {
      await new Promise((resolve) => setTimeout(resolve, 3));
      const observedAt = new Date().toISOString();
      const baseline = {
        ...e.baseline,
        stage,
        previousResultHash: previous,
        suffixSearch: { ...e.baseline.suffixSearch, observedAt },
        userSearch: { ...e.baseline.userSearch, observedAt },
      };
      const dir = join(e.root, stage, 'prerequisites');
      writeFileSync(join(dir, 'sm12-baseline.json'), JSON.stringify(baseline), { mode: 0o600 });
      for (const name of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
      if (stage === 'profiler') {
        const time = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => time + offset);
        e.deps.execute = (input) =>
          runRuntimeSlice({
            ...input,
            record: (row) => {
              input.record(row);
              if ((row as any).stage === 'response' && (row as any).path === `${TRACE_BASE}/parameters`)
                offset = 360000;
            },
          });
      }
      const result = await e.call(`--execute-reviewed-runtime-${stage}`);
      if (stage !== 'profiler') expect(result).toMatchObject({ failure: false });
      else {
        const expected = {
          failure: true,
          bindingUnconfirmed: true,
          parametersId: `${TRACE_BASE}/parameters/123`,
          parametersDispatched: true,
          requestDispatched: false,
          remaining: [`${TRACE_BASE}/parameters/123`],
          startOutcome: {
            state: 'parameters-orphaned',
            requestOutcome: 'not-sent',
            parametersId: `${TRACE_BASE}/parameters/123`,
          },
        };
        expect(result).toMatchObject(expected);
        expect(JSON.parse(readFileSync(join(e.root, stage, 'attempt/result.json'), 'utf8'))).toMatchObject(expected);
        expect(calls.filter((c) => c.method === 'POST' && c.path.startsWith(`${TRACE_BASE}/requests?`))).toHaveLength(
          0,
        );
        await expect(e.call('--execute-reviewed-runtime-profiler')).rejects.toThrow();
      }
      previous = sha(readFileSync(join(e.root, stage, 'attempt/result.json')));
    }
  } finally {
    rmSync(e.temp, { recursive: true, force: true });
  }
});

for (const [name, before, after] of [
  ['other active trace', '<ts:bufOn>false</ts:bufOn>', '<ts:bufOn>true</ts:bufOn>'],
  [
    'inactive nondefault property',
    '<ts:authErrorsOnly>false</ts:authErrorsOnly>',
    '<ts:authErrorsOnly>true</ts:authErrorsOnly>',
  ],
  ['inactive filter', '<ts:program/>', '<ts:program>ZFOREIGN</ts:program>'],
  ['unknown reset property', '</ts:traceProperties>', '<ts:opaque>keep</ts:opaque></ts:traceProperties>'],
])
  it(`refuses unproven ST05 baseline ${name} before PUT`, async () => {
    const h = harness('st05');
    h.state.st05 = h.state.st05.replace(before, after);
    const result = await h.run();
    expect(result).toMatchObject({ failure: true, restored: false, remaining: [], mutationDispatched: false });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
it('preserves a native independent stack flag through the two-write round trip', async () => {
  const h = harness('st05');
  h.state.st05 = h.state.st05.replace(
    '<ts:stackTraceOn>false</ts:stackTraceOn>',
    '<ts:stackTraceOn>true</ts:stackTraceOn>',
  );
  const baseline = h.state.st05;
  expect(await h.run()).toMatchObject({ failure: false, restored: true, remaining: [] });
  expect(h.state.st05).toBe(baseline);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
});
it('does not retry or invent a third restore after an uncertain OFF', async () => {
  const h = harness('st05', false, (c) =>
    c.method === 'PUT' && c.body.includes('<ts:sqlOn>false</ts:sqlOn>') ? { status: 503, body: '' } : undefined,
  );
  expect(await h.run()).toMatchObject({ failure: true, restored: false, mutationDispatched: true });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
});
