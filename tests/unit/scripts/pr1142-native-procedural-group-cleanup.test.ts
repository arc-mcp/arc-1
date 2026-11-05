/** Actual HTTP composition against exact retained native bodies; no native execution. */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type AdtClient, mockFetch } from './native-procedural-mock.js';

const undici = await vi.importActual<typeof import('undici')>('undici');
const { runProceduralGroupCleanup: driver, checkGroupCleanupRequest } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-group-cleanup-driver.js'
);
const { runNativeProceduralGroupCleanup: entry } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-group-cleanup.js'
);
const { nativeProceduralDefaults } = await import('../../../scripts/qualification/pr1142/native-procedural-runtime.js');
const { owners, POOL, proceduralConfig, PROCEDURAL_SUFFIX } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-fixed.js'
);
const { GROUP_CLEANUP_PROTOCOL, GROUP_CLEANUP_STAGES } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-group-cleanup-fixed.js'
);
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { Semaphore } = await import('../../../src/adt/semaphore.js');
const packets: { path: string; accept: string; status: number; body: string }[] = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/procedural-group-cleanup-native.json', import.meta.url), 'utf8'),
);
const rows = new Map(packets.map((p) => [p.path, p]));
const missing = packets.find((p) => p.status === 404)!.body;
let agent: InstanceType<typeof undici.MockAgent>, old: ReturnType<typeof undici.getGlobalDispatcher>;
let calls: { method: string; path: string; body: string }[],
  records: any[],
  fault: string,
  locked: boolean,
  deleted: boolean,
  parentMissing: number;
let hook: (method: string, path: string) => void | Promise<void>;
function client(semaphore?: InstanceType<typeof Semaphore>) {
  const c = nativeProceduralDefaults.createClient({
    baseUrl: 'https://procedural.invalid',
    client: '001',
    username: 'MARIAN',
    password: 'synthetic-password',
    adtSemaphore: semaphore,
    safety: { ...defaultSafetyConfig(), ...proceduralConfig() },
  });
  c.http.setDiscoveryMap(
    new Map([
      ['/sap/bc/adt/textelements/functiongroups', ['application/vnd.sap.adt.textelements.v1+xml']],
      ['/sap/bc/adt/functions/groups', ['application/vnd.sap.adt.functions.groups.v3+xml']],
    ]),
  );
  return c;
}
beforeEach(() => {
  vi.restoreAllMocks();
  calls = [];
  records = [];
  fault = '';
  locked = false;
  deleted = false;
  parentMissing = 0;
  hook = () => {};
  old = undici.getGlobalDispatcher();
  agent = new undici.MockAgent();
  agent.disableNetConnect();
  undici.setGlobalDispatcher(agent);
  agent
    .get('https://procedural.invalid')
    .intercept({ path: /.*/, method: /.*/ })
    .reply(async (options: any) => {
      const uri = new URL(options.path, 'https://procedural.invalid'),
        path = uri.pathname,
        method = options.method;
      const body =
        typeof options.body === 'string' ? options.body : options.body ? await new Response(options.body).text() : '';
      expect(uri.searchParams.get('sap-client')).toBe('001');
      expect(uri.searchParams.get('sap-language')).toBe('EN');
      uri.searchParams.delete('sap-client');
      uri.searchParams.delete('sap-language');
      const nativePath = uri.pathname + uri.search;
      calls.push({ method, path: nativePath, body });
      await hook(method, path);
      const reply = (
        statusCode: number,
        data = '',
        type = 'application/xml',
        headers: Record<string, string> = {},
      ) => ({ statusCode, data, responseOptions: { headers: { 'content-type': type, ...headers } } });
      if (method === 'HEAD') return reply(200, '', 'application/xml', { 'x-csrf-token': 'synthetic-csrf' });
      if (path.includes('/http/sessions')) return reply(200);
      if (path === '/sap/bc/adt/cts/transportchecks')
        return reply(
          200,
          '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
        );
      if (uri.searchParams.get('_action') === 'LOCK') {
        locked = true;
        return reply(
          200,
          '<DATA><LOCK_HANDLE>synthetic-lock</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL><CORRNR/></DATA>',
          'application/xml',
          { 'set-cookie': 'sap-contextid=synthetic-session; Path=/' },
        );
      }
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(fault === 'unlock' ? 503 : 200);
      if (path === '/sap/bc/adt/deletion/check')
        return reply(200, '<del:checkResponse xmlns:del="http://www.sap.com/adt/deletion"/>');
      if (method === 'DELETE') {
        if (fault === 'delete-unknown') return reply(503, 'unknown');
        deleted = true;
        return reply(204);
      }
      if (path === '/sap/bc/adt/activation/inactiveobjects')
        return reply(
          200,
          `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects">${fault === 'suffix-remains' ? PROCEDURAL_SUFFIX : ''}</i:inactiveObjects>`,
        );
      if (method === 'GET') {
        if (deleted && [owners[0], POOL].includes(path)) {
          if (path === owners[0]) parentMissing++;
          if (fault === 'final-present' && parentMissing >= 3 && path === owners[0])
            return reply(200, rows.get(path)!.body);
          if (
            ((fault === 'final-foreign' && parentMissing >= 3) || (fault === 'last-foreign' && parentMissing >= 5)) &&
            path === owners[0]
          )
            return reply(
              404,
              missing.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
            );
          return reply(404, missing);
        }
        const row = rows.get(nativePath);
        if (!row) throw Error(`Unexpected ${method} ${options.path}`);
        if (row.status === 404) {
          if (fault === 'child-present') return reply(200, '<unexpected/>');
          if (fault === 'child-foreign')
            return reply(
              404,
              missing.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
            );
          return reply(404, row.body);
        }
        let data = row.body;
        if (fault === 'under:' + nativePath && locked) data += ' ';
        if (fault === 'media' && nativePath.includes('/source/')) return reply(200, data, 'text/html');
        if (fault === 'source-drift' && path.endsWith('/source/main')) data += 'changed';
        if (fault === 'locked-drift' && locked && path === owners[0]) data += ' ';
        if (fault === 'metadata-drift' && path === owners[0]) data = data.replace('MARIAN', 'FOREIGN');
        if (fault === 'oversized') data += ' '.repeat(2 * 1024 * 1024);
        return reply(200, data, row.accept === 'application/*' ? 'application/xml' : row.accept);
      }
      throw Error(`Unexpected ${method} ${options.path}`);
    })
    .persist();
  mockFetch.mockImplementation((url, init) => undici.fetch(url, init));
});
afterEach(async () => {
  await agent.close();
  undici.setGlobalDispatcher(old);
  vi.useRealTimers();
  expect(JSON.stringify(records)).not.toMatch(/synthetic-(?:password|lock|session|proxy-token|user-token)/);
});
const run = (extra: Partial<Parameters<typeof driver>[0]> = {}) =>
  driver({
    base: client(),
    preflight: false,
    freshUntil: Date.now() + 240000,
    verifySource: () => {},
    shouldStop: () => false,
    record: (r) => records.push(r),
    ...extra,
  });
const deletes = () => calls.filter((c) => c.method === 'DELETE');
it('rechecks full native state under own lock and deletes only the retained group once', async () => {
  const result = await run();
  expect(result, JSON.stringify({ records: records.slice(-4), calls: calls.slice(-2) })).toMatchObject({
    failure: false,
    completed: [...GROUP_CLEANUP_STAGES],
    confirmedDeleted: [owners[0]],
    remaining: [],
    cleanupConfirmed: true,
    finalAbsenceConfirmed: true,
  });
  expect(deletes()).toHaveLength(1);
  expect(deletes()[0].path.split('?')[0]).toBe(owners[0]);
  expect(calls.some((c) => c.method === 'PUT' || c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  const lock = calls.findIndex((c) => c.path.includes('_action=LOCK')),
    del = calls.findIndex((c) => c.method === 'DELETE');
  expect(
    calls.slice(lock, del).filter((c) => c.method === 'GET' && c.path === `${owners[0]}?version=inactive`).length,
  ).toBeGreaterThan(0);
});
it('preflight is GET-only and confirms the already absent children without a deletion claim', async () => {
  const r = await run({ preflight: true });
  expect(r).toMatchObject({ failure: false, completed: ['preflight'], confirmedDeleted: [], remaining: [owners[0]] });
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});
it.each(['source-drift', 'metadata-drift', 'child-present', 'child-foreign', 'locked-drift', 'oversized'])(
  'refuses %s before DELETE',
  async (value) => {
    fault = value;
    expect((await run()).failure).toBe(true);
    expect(deletes()).toHaveLength(0);
    if (value === 'locked-drift') expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
it.each(['delete-unknown', 'unlock', 'final-present', 'final-foreign', 'suffix-remains'])(
  'retains honest %s outcome without replay',
  async (value) => {
    fault = value;
    const r = await run();
    expect(r.failure).toBe(true);
    expect(deletes()).toHaveLength(1);
    if (value === 'delete-unknown') expect(r.remaining).toContain(owners[0]);
    if (value.startsWith('final-')) {
      expect(r.confirmedDeleted).toContain(owners[0]);
      expect(r.remaining).toContain(owners[0]);
    }
    if (value === 'unlock') expect(r.cleanupConfirmed).toBe(false);
  },
);
it.each(['stop', 'source', 'deadline'])(
  'rechecks %s at actual DELETE dispatch and still owns cleanup',
  async (value) => {
    let fail = false;
    const real = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => real + (fail && value === 'deadline' ? 300001 : 0));
    const r = await run({
      shouldStop: () => fail && value === 'stop',
      verifySource: () => {
        if (fail && value === 'source') throw Error('changed');
      },
      record: (row) => {
        records.push(row);
        if ((row as any).stage === 'request' && (row as any).method === 'DELETE') fail = true;
      },
    });
    expect(r.failure).toBe(true);
    expect(deletes()).toHaveLength(0);
    expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
it('queue cancellation sends no mutation after the wait', async () => {
  const s = new Semaphore(1);
  await s.acquire();
  let stop = false;
  const pending = run({ base: client(s), shouldStop: () => stop });
  await new Promise((r) => setTimeout(r, 5));
  stop = true;
  s.release();
  expect((await pending).failure).toBe(true);
  expect(deletes()).toHaveLength(0);
});
it.each(['module-delete', 'include-delete', 'include-activate', 'group-create'] as const)(
  'never authorizes completed stage %s',
  (stage) => {
    expect(() => checkGroupCleanupRequest({ stage }, 'DELETE', owners[0] + '?lockHandle=own')).toThrow();
  },
);
it('does not authorize child recording, creation intent or foreign cleanup locks', () => {
  for (const owner of [owners[1], owners[2]])
    expect(() =>
      checkGroupCleanupRequest(
        { stage: 'group-delete' },
        'POST',
        '/sap/bc/adt/cts/transportchecks',
        `<a:abap xmlns:a="http://www.sap.com/abapxml"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${owner}</URI><OPERATION/></DATA></a:values></a:abap>`,
      ),
    ).toThrow();
  expect(() =>
    checkGroupCleanupRequest({ stage: 'group-delete' }, 'POST', owners[1] + '?_action=UNLOCK&lockHandle=own'),
  ).toThrow();
});
function entryHarness(execute: typeof driver = driver) {
  const temporary = mkdtempSync(join(tmpdir(), 'arc1-procedural-group-cleanup-entry-')),
    root = join(temporary, 'retained'),
    revision = 'a'.repeat(40);
  const deps = {
    validateRuntime: vi.fn(),
    verifyHistory: vi.fn(),
    bind: vi.fn(async () => ({
      repo: temporary,
      root,
      verifySource: () => {},
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        repo: temporary,
        dependencyLimit: 'synthetic',
      },
    })),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'synthetic-password',
      SAP_CLIENT: '001',
    })),
    createClient: vi.fn((input: ConstructorParameters<typeof AdtClient>[0]) => {
      const c = nativeProceduralDefaults.createClient({ ...input, baseUrl: 'https://procedural.invalid' });
      c.http.setDiscoveryMap(
        new Map([
          ['/sap/bc/adt/textelements/functiongroups', ['application/vnd.sap.adt.textelements.v1+xml']],
          ['/sap/bc/adt/functions/groups', ['application/vnd.sap.adt.functions.groups.v3+xml']],
        ]),
      );
      return c;
    }),
    execute,
  };
  const invoke = (phase: string) => entry([`--${phase}-reviewed-procedural-group-cleanup`, revision], deps);
  const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex'),
    read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const ready = async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const p = await invoke('prepare');
    now += 2;
    // The real journal uses new Date(), so advance real wall time as well for the strict receipt ordering.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const preflight = await invoke('preflight');
    expect(preflight.failure, JSON.stringify(preflight)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    now = Date.parse(String(preflight.completedAt)) + 2;
    const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
    const search = {
      observedAt: new Date(now).toISOString(),
      client: '001',
      table: '*',
      lockCount: 0,
      evidenceSha256: sha(jpeg),
    };
    for (const name of ['suffix', 'user'])
      writeFileSync(join(root, 'prerequisites', `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
    writeFileSync(
      join(root, 'prerequisites', 'sm12-baseline.json'),
      JSON.stringify({
        protocol: GROUP_CLEANUP_PROTOCOL,
        phase: 'execute',
        revision,
        intentHash: p.intentHash,
        previousResultHash: sha(readFileSync(join(root, 'preflight/result.json'))),
        noConcurrentFixtureEditing: true,
        suffixSearch: { ...search, user: '*', argument: `*${PROCEDURAL_SUFFIX}*` },
        userSearch: { ...search, user: 'MARIAN', argument: '*' },
      }),
      { mode: 0o600 },
    );
    return {
      advance: (ms: number) => {
        now += ms;
      },
    };
  };
  return { temporary, root, deps, invoke, ready, read };
}

it('actual entry→factory→client has exact policy, nonclaiming check and permanent claim', async () => {
  const h = entryHarness();
  try {
    await h.ready();
    h.deps.readEnv.mockClear();
    expect(await h.invoke('check')).toMatchObject({ failure: false, executionGrant: false });
    expect(h.deps.readEnv).not.toHaveBeenCalled();
    expect(existsSync(join(h.root, 'execute'))).toBe(false);
    expect(await h.invoke('execute')).toMatchObject({
      failure: false,
      completed: [...GROUP_CLEANUP_STAGES],
      confirmedDeleted: [owners[0]],
      remaining: [],
    });
    expect(h.deps.createClient.mock.calls.at(-1)![0]!.safety?.multiTargetWrite).toEqual(
      proceduralConfig().multiTargetWrite,
    );
    const count = calls.length;
    await expect(h.invoke('execute')).rejects.toThrow();
    await expect(h.invoke('preflight')).rejects.toThrow();
    expect(calls).toHaveLength(count);
  } finally {
    rmSync(h.temporary, { recursive: true, force: true });
  }
});
it.each(['history', 'receipt', 'expired', 'dropped-policy'])(
  'entry stops %s without a native mutation or replay',
  async (kind) => {
    const h = entryHarness();
    try {
      const clock = await h.ready();
      h.deps.readEnv.mockClear();
      if (kind === 'history')
        h.deps.verifyHistory.mockImplementation(() => {
          throw Error('history');
        });
      if (kind === 'receipt') writeFileSync(join(h.root, 'prerequisites/sm12-user.jpg'), 'changed');
      if (kind === 'expired') clock.advance(300001);
      if (kind === 'dropped-policy') {
        const create = h.deps.createClient.getMockImplementation()!;
        h.deps.createClient.mockImplementation((input) =>
          create({ ...input, safety: { ...input!.safety!, multiTargetWrite: undefined } }),
        );
      }
      const count = calls.length;
      expect(await h.invoke('execute')).toMatchObject({ failure: true, remaining: owners });
      expect(calls.slice(count).some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
      await expect(h.invoke('execute')).rejects.toThrow();
    } finally {
      rmSync(h.temporary, { recursive: true, force: true });
    }
  },
);
it('old flags are rejected and history failure leaves new prepare root absent', async () => {
  const h = entryHarness();
  try {
    h.deps.verifyHistory.mockImplementation(() => {
      throw Error('history');
    });
    await expect(h.invoke('prepare')).rejects.toThrow();
    expect(existsSync(h.root)).toBe(false);
    expect(() => entry(['--prepare-reviewed-procedural-retained', 'a'.repeat(40)], h.deps)).toThrow();
    expect(h.deps.readEnv).not.toHaveBeenCalled();
  } finally {
    rmSync(h.temporary, { recursive: true, force: true });
  }
});

it.each(packets.filter((p) => p.status === 200).map((p) => p.path))(
  'refuses exact raw receipt drift under LOCK at %s',
  async (path) => {
    fault = 'under:' + path;
    const result = await run();
    expect(result.failure).toBe(true);
    expect(deletes()).toHaveLength(0);
    expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
it('rejects a foreign namespace at the very last parent absence read', async () => {
  fault = 'last-foreign';
  const result = await run();
  expect(parentMissing).toBeGreaterThanOrEqual(5);
  expect(result).toMatchObject({ failure: true, confirmedDeleted: [owners[0]], finalAbsenceConfirmed: false });
  expect(result.remaining).toContain(owners[0]);
  expect(deletes()).toHaveLength(1);
});
it('refuses unsupported native source media without any mutation', async () => {
  fault = 'media';
  expect((await run()).failure).toBe(true);
  expect(calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
});
it('keeps the original per-request deadline through under-lock proof reads', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  hook = (method, path) => {
    if (locked && method === 'GET' && path === owners[0] + '/objectstructure') now += 31000;
  };
  expect((await run()).failure).toBe(true);
  expect(deletes()).toHaveLength(0);
  expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
});

function finalControls(h: ReturnType<typeof entryHarness>, clock: { advance: (ms: number) => void }) {
  const resultPath = join(h.root, 'execute/result.json');
  clock.advance(Math.max(1, Date.parse(h.read(resultPath).completedAt) - Date.now() + 1));
  const baseline = h.read(join(h.root, 'prerequisites/sm12-baseline.json'));
  baseline.phase = 'final';
  baseline.previousResultHash = createHash('sha256').update(readFileSync(resultPath)).digest('hex');
  baseline.suffixSearch.observedAt = new Date(Date.now()).toISOString();
  baseline.userSearch.observedAt = baseline.suffixSearch.observedAt;
  for (const name of ['suffix', 'user'])
    writeFileSync(
      join(h.root, 'final', `sm12-${name}.jpg`),
      readFileSync(join(h.root, 'prerequisites', `sm12-${name}.jpg`)),
      { mode: 0o600 },
    );
  writeFileSync(join(h.root, 'final/sm12-baseline.json'), JSON.stringify(baseline), { mode: 0o600 });
}
function fileTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) Object.assign(result, fileTree(p));
    else result[p] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  return result;
}
it('actual single-parent execution supports a separate repeatable file-only final verification', async () => {
  const h = entryHarness();
  try {
    const clock = await h.ready();
    expect(h.read(join(h.root, 'intent.json')).finalDeletionOwners).toEqual([owners[0]]);
    expect(await h.invoke('execute')).toMatchObject({
      failure: false,
      confirmedDeleted: [owners[0]],
      finalAbsenceConfirmed: true,
    });
    finalControls(h, clock);
    const tree = fileTree(h.root),
      count = calls.length;
    h.deps.readEnv.mockClear();
    h.deps.createClient.mockClear();
    const execute = vi.spyOn(h.deps, 'execute');
    for (let i = 0; i < 2; i++)
      expect(await h.invoke('verify')).toMatchObject({
        phase: 'final',
        failure: false,
        mutationAttempted: false,
        executionGrant: false,
      });
    expect(h.deps.bind).toHaveBeenLastCalledWith(expect.any(String), expect.any(URL), undefined, { readOnly: true });
    expect(h.deps.readEnv).not.toHaveBeenCalled();
    expect(h.deps.createClient).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(calls).toHaveLength(count);
    expect(fileTree(h.root)).toEqual(tree);
  } finally {
    rmSync(h.temporary, { recursive: true, force: true });
  }
});
it.each([
  'missing',
  'extra',
  'wrong',
  'duplicate',
  'absence',
  'cleanup',
  'remaining',
  'stages',
  'intent-missing',
  'intent-extra',
  'history',
])('final verification refuses %s without any HTTP, credential load or claim', async (kind) => {
  // These cases exercise the file-only verifier. The preceding composition test keeps the real
  // entry → HTTP cleanup → final verification path; do not repeat that workflow for every corruption.
  const h = entryHarness(async ({ preflight }) => ({
    failure: false,
    owners,
    completed: preflight ? ['preflight'] : [...GROUP_CLEANUP_STAGES],
    stoppedAt: preflight ? 'preflight' : 'final',
    mutationAttempted: !preflight,
    confirmedDeleted: preflight ? [] : [owners[0]],
    cleanupConfirmed: true,
    finalAbsenceConfirmed: !preflight,
    remaining: preflight ? [...owners] : [],
    inspectionRequired: [],
    independentLockVerification: 'required',
    authentication: 'Basic-native-contract-only',
    ppQualified: false,
  }));
  try {
    const clock = await h.ready();
    expect((await h.invoke('execute')).failure).toBe(false);
    finalControls(h, clock);
    // A valid control prevents a broken synthetic fixture from making every refusal pass.
    expect(await h.invoke('verify')).toMatchObject({ phase: 'final', failure: false });
    expect(calls).toHaveLength(0);
    const path = join(h.root, 'execute/result.json'),
      result = h.read(path);
    if (kind === 'missing') result.confirmedDeleted = [];
    if (kind === 'extra') result.confirmedDeleted = [...owners].reverse();
    if (kind === 'wrong') result.confirmedDeleted = [owners[1]];
    if (kind === 'duplicate') result.confirmedDeleted = [owners[0], owners[0]];
    if (kind === 'absence') result.finalAbsenceConfirmed = false;
    if (kind === 'cleanup') result.cleanupConfirmed = false;
    if (kind === 'remaining') result.remaining = [owners[1]];
    if (kind === 'stages') result.completed = [];
    writeFileSync(path, JSON.stringify(result));
    finalControls(h, clock);
    if (kind.startsWith('intent')) {
      const ip = join(h.root, 'intent.json'),
        intent = h.read(ip);
      if (kind === 'intent-missing') delete intent.finalDeletionOwners;
      else intent.finalDeletionOwners = owners;
      writeFileSync(ip, JSON.stringify(intent));
    }
    if (kind === 'history')
      h.deps.verifyHistory.mockImplementation(() => {
        throw Error('changed history');
      });
    const tree = fileTree(h.root),
      count = calls.length;
    h.deps.readEnv.mockClear();
    h.deps.createClient.mockClear();
    const execute = vi.spyOn(h.deps, 'execute');
    await expect(h.invoke('verify')).rejects.toThrow();
    expect(h.deps.readEnv).not.toHaveBeenCalled();
    expect(h.deps.createClient).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(calls).toHaveLength(count);
    expect(fileTree(h.root)).toEqual(tree);
  } finally {
    rmSync(h.temporary, { recursive: true, force: true });
  }
});
