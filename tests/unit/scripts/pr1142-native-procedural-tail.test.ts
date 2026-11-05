/** Synthetic backend contracts exercise the real entry/client/factory paths; never native evidence. */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtClient, mockFetch } from './native-procedural-mock.js';

const undici = await vi.importActual<typeof import('undici')>('undici');
const { runProceduralTail: runNativeProceduralContract } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-tail-driver.js'
);
const { GROUP, MODULE, MARKER, POOL, owners, proceduralConfig } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-fixed.js'
);
const { nativeProceduralDefaults } = await import('../../../scripts/qualification/pr1142/native-procedural-runtime.js');
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { Semaphore } = await import('../../../src/adt/semaphore.js');
const { runNativeProceduralTail: entry } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-tail.js'
);
const { PROCEDURAL_SUFFIX } = await import('../../../scripts/qualification/pr1142/native-procedural-fixed.js');
const native = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/procedural-retained-a4h.json', import.meta.url), 'utf8'),
);
const { TAIL_STAGES, TAIL_PROTOCOL } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-tail-fixed.js'
);
const tail = JSON.parse(readFileSync(new URL('../../fixtures/adt/procedural-tail-a4h.json', import.meta.url), 'utf8'));
native.parentCurrentMetadata = tail.parentMetadata.body;
native.extra['parent-active-metadata'].body = tail.parentMetadata.body;
native.extra['group-objectstructure'].body = tail.tree.body;
native.functionDraft.metadata = tail.functionDraftMetadata.body;
native.functionActive.metadata = tail.functionActiveMetadata.body;
native.includeDraft.metadata = tail.includeDraftMetadata.body;
native.includeDraft.source = tail.includeDraftSource.body;
const original = (path: string) => native.baseline.find((row: any) => row.groupInventory === path).body;
const missing =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>';
let agent: InstanceType<typeof undici.MockAgent>,
  calls: { method: string; path: string; body: string }[],
  records: any[],
  fault: string;
let parentDrift = '';
let originalDispatcher: ReturnType<typeof undici.getGlobalDispatcher>;
let objects: Map<string, { active: string; draft?: string }>,
  activeTexts: Record<string, string>,
  draftTexts: Record<string, string>;
let deleted: Set<string>, absenceReads: Map<string, number>;
let hook: (method: string, path: string) => Promise<void> | void;
function metadata(owner: string, active: boolean) {
  const data = objects.get(owner)!;
  if (owner === owners[0]) {
    const template = objects.has(owners[2])
      ? active
        ? native.extra['parent-active-metadata'].body
        : native.parentCurrentMetadata
      : original(`${owners[0]}?version=active`);
    return parentDrift
      ? template.replace(`adtcore:description="${MARKER}"`, 'adtcore:description="foreign"')
      : template;
  }
  const originalActive =
    owner === owners[1] ? native.functionActive.source : native.extra['include-active-source'].body;
  const activeTemplate =
    owner === owners[1] ? native.functionActive.metadata : native.extra['include-active-metadata'].body;
  const draftTemplate = owner === owners[1] ? native.functionDraft.metadata : native.includeDraft.metadata;
  const isActive = active || data.draft === undefined;
  if (isActive && data.active === originalActive) return activeTemplate;
  let xml = draftTemplate;
  if (isActive) xml = xml.replace('adtcore:version="inactive"', 'adtcore:version="active"');
  if (data.draft === undefined)
    xml = xml.replace(/<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/objectstates"[^>]*\/>/g, '');
  return xml;
}
beforeEach(() => {
  vi.restoreAllMocks();
  calls = [];
  records = [];
  fault = '';
  parentDrift = '';
  objects = new Map([
    [owners[0], { active: tail.parentSource.body }],
    [owners[1], { active: native.functionActive.source, draft: native.functionDraft.source }],
    [owners[2], { active: native.extra['include-active-source'].body, draft: native.includeDraft.source }],
  ]);
  deleted = new Set();
  absenceReads = new Map();
  activeTexts = Object.fromEntries(Object.entries(native.pool.parts).map(([k, v]) => [k, (v as any).active]));
  draftTexts = {};
  hook = () => {};
  agent = new undici.MockAgent();
  agent.disableNetConnect();
  originalDispatcher = undici.getGlobalDispatcher();
  undici.setGlobalDispatcher(agent);
  agent
    .get('https://procedural.invalid')
    .intercept({ path: /.*/, method: /.*/ })
    .reply(async (options: any) => {
      const uri = new URL(options.path, 'https://procedural.invalid'),
        path = uri.pathname,
        method = options.method,
        body: string =
          typeof options.body === 'string' ? options.body : options.body ? await new Response(options.body).text() : '';
      calls.push({ method, path: options.path, body });
      await hook(method, path);
      const reply = (
        statusCode: number,
        data = '',
        contentType = 'application/xml',
        headers: Record<string, string> = {},
      ) => ({ statusCode, data, responseOptions: { headers: { 'content-type': contentType, ...headers } } });
      if (method === 'HEAD') return reply(200, '', 'application/xml', { 'x-csrf-token': 'synthetic-csrf' });
      if (path.includes('/http/sessions')) return reply(200);
      if (path === '/sap/bc/adt/activation/inactiveobjects')
        return reply(200, '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"/>');
      if (path === '/sap/bc/adt/cts/transportchecks')
        return reply(
          200,
          `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${body.includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
        );
      if (uri.searchParams.get('_action') === 'LOCK')
        return reply(
          200,
          '<DATA><LOCK_HANDLE>synthetic-lock</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL><CORRNR/></DATA>',
          'application/xml',
          { 'set-cookie': 'sap-contextid=synthetic-session; Path=/' },
        );
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(fault === 'unlock-unknown' ? 503 : 200);
      if (
        method === 'POST' &&
        ['/sap/bc/adt/functions/groups', `${owners[0]}/fmodules`, `${owners[0]}/includes`].includes(path)
      ) {
        if (fault === 'create-unknown') return reply(503, 'Unknown creation');
        if (fault === 'create-421') return reply(421, 'Misdirected request');
        const owner = path.endsWith('/groups') ? owners[0] : path.endsWith('/fmodules') ? owners[1] : owners[2];
        objects.set(owner, {
          active:
            owner === owners[0]
              ? `INCLUDE l${GROUP.toLowerCase()}top.\nINCLUDE l${GROUP.toLowerCase()}uxx.\n`
              : owner === owners[1]
                ? `FUNCTION ${MODULE}.\nENDFUNCTION.\n`
                : '* generated\n',
        });
        return reply(201);
      }
      if (path === '/sap/bc/adt/activation') {
        const owner =
          body.match(/adtcore:uri="([^"]+)"/)?.[1] ??
          body.match(/core:uri="([^"]+)"/)?.[1] ??
          body.match(/ uri="([^"]+)"/)?.[1];
        if (owner === POOL) {
          if (fault !== 'pool-activation-unverified') {
            activeTexts = { ...activeTexts, ...draftTexts };
            draftTexts = {};
          }
        } else if (owner === owners[0]) {
          // Native group generation leaves structural-include drafts inactive.
        } else if (owner === owners[2]) {
          const data = objects.get(owners[2]);
          if (data?.draft !== undefined && fault !== 'include-no-activation') {
            data.active = data.draft;
            delete data.draft;
          }
          if (fault === 'include-activates-sibling') {
            const f = objects.get(owners[1])!;
            f.active = f.draft!;
            delete f.draft;
          }
        } else if (owner === owners[1]) {
          const data = objects.get(owners[1])!;
          data.active = data.draft ?? data.active;
          delete data.draft;
        } else throw new Error(`Unexpected activation reference ${body}`);
        return reply(
          200,
          `<c:messages xmlns:c="http://www.sap.com/abapxml/checklist"><c:properties activationExecuted="${owner === owners[0] ? 'false' : 'true'}" generationExecuted="${owner === owners[0] ? 'true' : 'false'}"/></c:messages>`,
        );
      }
      if (method === 'DELETE' && owners.includes(path)) {
        if (fault === 'delete-unknown') return reply(503, 'Unknown deletion');
        objects.delete(path);
        if (
          !objects.has(owners[1]) &&
          !objects.has(owners[2]) &&
          objects.has(owners[0]) &&
          fault !== 'parent-cleanup-drift'
        )
          objects.get(owners[0])!.active = original(`${owners[0]}/source/main?version=active`);
        deleted.add(path);
        return reply(204);
      }
      if (method === 'GET' && path.endsWith('/objectstructure'))
        return reply(
          200,
          objects.has(owners[1]) || objects.has(owners[2])
            ? native.extra['group-objectstructure'].body
            : original(`${owners[0]}/objectstructure`),
          'application/vnd.sap.adt.objectstructure.v2+xml',
        );
      if (path === POOL)
        return objects.has(owners[0])
          ? reply(
              200,
              tail.poolMetadata.body.replace(
                'adtcore:version="active"',
                `adtcore:version="${Object.keys(draftTexts).length ? 'inactive' : 'active'}"`,
              ),
            )
          : reply(404, missing);
      if (path.startsWith(`${POOL}/source/`)) {
        const part = path.split('/').at(-1)!;
        if (method === 'PUT') {
          draftTexts[part] = body;
          return reply(200);
        }
        return reply(
          200,
          uri.searchParams.get('version') === 'active' ? activeTexts[part] : (draftTexts[part] ?? activeTexts[part]),
          `application/vnd.sap.adt.textelements.${part}.v1`,
        );
      }
      if (owners.includes(path)) {
        if (deleted.has(path)) {
          const n = (absenceReads.get(path) ?? 0) + 1;
          absenceReads.set(path, n);
          if (
            (fault === 'revived-include' && path === owners[2] && n >= 3) ||
            (fault === 'terminal-present' && path === owners[0] && n >= 3)
          )
            objects.set(path, { active: '* concurrent owner' });
        }
        if (fault === 'generic-404' && !objects.has(path)) return reply(404, '<error>service missing</error>');
        let xml = objects.has(path) ? metadata(path, uri.searchParams.get('version') === 'active') : missing;
        if (fault === 'foreign-parent' && path === owners[0]) xml = xml.replace('$TMP', 'ZFOREIGN');
        return objects.has(path) ? reply(200, xml) : reply(404, missing);
      }
      if (path.endsWith('/source/main')) {
        const owner = path.slice(0, -12),
          data = objects.get(owner);
        if (method === 'PUT' && data) {
          data.draft = fault === 'save-mismatch' ? `${body}* unexpected\n` : body;
          if (fault === 'native-signature-case' && owner === owners[1])
            data.draft = data.draft
              .replace(/^FUNCTION ([A-Z0-9_]+)/m, (_, name: string) => `FUNCTION ${name.toLowerCase()}`)
              .replace(
                /VALUE\((IV_[A-Z_]+)\) TYPE (STRING|I)/g,
                (_, name: string, type: string) => `VALUE(${name.toLowerCase()}) TYPE ${type.toLowerCase()}`,
              );
          if (fault === 'native-literal-change' && owner === owners[1])
            data.draft = data.draft.replace("'MiXeD'", "'MIXED'");
          if (fault.startsWith('include-native-') && owner === owners[2]) {
            data.draft = data.draft.replace(/\r\n/g, '\n');
            if (!fault.endsWith('crlf')) data.draft = data.draft.replace(/\n+$/, '');
            if (fault !== 'include-native-lf-trim') data.draft = data.draft.replace(/\n/g, '\r\n');
            if (fault === 'include-native-sibling-change')
              data.draft = data.draft.replace('lv_value = 1.', 'lv_value = 9.');
            if (fault === 'include-native-blank-change')
              data.draft = data.draft.replace('ENDFORM.\r\n\r\nFORM', 'ENDFORM.\r\nFORM');
          }
          return reply(200);
        }
        if (owner === owners[0])
          return reply(
            200,
            objects.has(owners[2]) && uri.searchParams.get('version') !== 'active'
              ? native.parentInsertedSource
              : data!.active,
            'text/plain',
          );
        if (data)
          return reply(
            200,
            uri.searchParams.get('version') === 'active' ? data.active : (data.draft ?? data.active),
            'text/plain',
          );
        if (path.includes(`/includes/l${GROUP.toLowerCase()}`))
          return reply(
            200,
            path.includes('uxx/') && objects.has(owners[1])
              ? native.extra['uxx-active-source'].body
              : original(path + '?version=active'),
            'text/plain',
          );
      }
      throw new Error(`Unexpected ${method} ${path}`);
    })
    .persist();
  // Keep the composed final-send budget/authorization wrapper; the mock Agent sits underneath it.
  mockFetch.mockImplementation((url, init) => undici.fetch(url, init));
});
afterEach(async () => {
  await agent.close();
  undici.setGlobalDispatcher(originalDispatcher);
  expect(JSON.stringify(records)).not.toContain('synthetic-password');
  expect(JSON.stringify(records)).not.toContain('synthetic-lock');
  vi.useRealTimers();
});
function client(adtSemaphore?: InstanceType<typeof Semaphore>) {
  const c = new AdtClient({
    baseUrl: 'https://procedural.invalid',
    client: '001',
    username: 'MARIAN',
    password: 'synthetic-password',
    adtSemaphore,
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
const run = (extra: Partial<Parameters<typeof runNativeProceduralContract>[0]> = {}) =>
  runNativeProceduralContract({
    base: client(),
    preflight: false,
    freshUntil: Date.now() + 240_000,
    verifySource: () => {},
    shouldStop: () => false,
    record: (row) => records.push(row),
    ...extra,
  });
function entryHarness() {
  const temporary = mkdtempSync(join(tmpdir(), 'arc1-procedural-tail-entry-')),
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
    execute: runNativeProceduralContract,
  };
  const invoke = (phase: string) => entry([`--${phase}-reviewed-procedural-tail`, revision], deps);
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
        protocol: TAIL_PROTOCOL,
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

it('preflight uses the captured post-edit state and only GETs', async () => {
  const r = await run({ preflight: true });
  expect(r, JSON.stringify(records.slice(-4))).toMatchObject({
    failure: false,
    completed: ['preflight'],
    mutationAttempted: false,
    remaining: owners,
  });
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});
it('real factories begin at exact INCL activation, preserve FUNC draft and complete only the remaining tail', async () => {
  const r = await run();
  expect(r, JSON.stringify({ r, records: records.slice(-5) })).toMatchObject({
    failure: false,
    completed: [...TAIL_STAGES],
    confirmedDeleted: [...owners].reverse(),
    remaining: [],
    cleanupConfirmed: true,
    finalAbsenceConfirmed: true,
  });
  expect(calls.filter((c) => c.method === 'PUT' && owners.some((o) => c.path.startsWith(o)))).toHaveLength(0);
  const activations = calls.filter((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'));
  expect(activations[0].body).toContain(`adtcore:uri="${owners[2]}"`);
  expect(activations.some((c) => c.body.includes(`adtcore:uri="${owners[0]}"`))).toBe(false);
  expect(
    calls.filter(
      (c) =>
        c.method === 'POST' &&
        ['/sap/bc/adt/functions/groups', `${owners[0]}/fmodules`, `${owners[0]}/includes`].includes(
          c.path.split('?')[0],
        ),
    ),
  ).toHaveLength(0);
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([...owners].reverse());
});
it.each(['module-active', 'module-draft', 'include-active', 'include-draft', 'parent'])(
  'refuses changed %s without mutation',
  async (kind) => {
    if (kind === 'parent') parentDrift = 'x';
    else {
      const d = objects.get(owners[kind.startsWith('module') ? 1 : 2])!;
      if (kind.endsWith('active')) d.active += 'foreign';
      else d.draft += 'foreign';
    }
    expect(await run()).toMatchObject({ failure: true, remaining: owners });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  },
);
it.each(['include-no-activation', 'include-activates-sibling'])(
  'refuses native200 with %s before text or deletion',
  async (value) => {
    fault = value;
    const r = await run();
    expect(r).toMatchObject({ failure: true, remaining: owners });
    expect(calls.some((c) => ['PUT', 'DELETE'].includes(c.method))).toBe(false);
  },
);
it('never adopts the populated active parent as the cleanup baseline', async () => {
  fault = 'parent-cleanup-drift';
  const r = await run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: [owners[2], owners[1]],
    remaining: [owners[0]],
    finalAbsenceConfirmed: false,
  });
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([owners[2], owners[1]]);
});
it.each(['source', 'deadline', 'stop'])('final queued first activation rejects %s', async (kind) => {
  const semaphore = new Semaphore(1);
  let held = false,
    changed = false,
    now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = run({
    base: client(semaphore),
    shouldStop: () => kind === 'stop' && changed,
    verifySource: () => {
      if (changed && kind === 'source') throw Error('changed');
    },
    record: (row: any) => {
      records.push(row);
      if (!held && row.stage === 'request' && row.method === 'POST' && row.path.startsWith('/sap/bc/adt/activation?')) {
        held = true;
        void semaphore.acquire();
      }
    },
  });
  await vi.waitFor(() => expect(semaphore.waiting).toBe(1));
  changed = true;
  if (kind === 'deadline') now += 300001;
  semaphore.release();
  expect(await pending).toMatchObject({ failure: true, remaining: owners });
  expect(calls.filter((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toHaveLength(0);
});
it('own text-pool unlock remains available after stop blocks its PUT', async () => {
  let stop = false;
  const r = await run({
    shouldStop: () => stop,
    record: (row: any) => {
      records.push(row);
      if (row.stage === 'request' && row.method === 'PUT') stop = true;
    },
  });
  expect(r).toMatchObject({ failure: true, remaining: owners });
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(calls.some((c) => c.path.startsWith(POOL) && c.path.includes('_action=UNLOCK'))).toBe(true);
});
it.each(['revived-include', 'terminal-present', 'delete-unknown'])(
  'preserves honest residuals for %s',
  async (value) => {
    fault = value;
    const r = await run();
    expect(r.failure).toBe(true);
    expect(r.remaining.length).toBeGreaterThan(0);
    expect(r.finalAbsenceConfirmed).toBe(false);
    if (value === 'revived-include') {
      expect(r.confirmedDeleted).toContain(owners[2]);
      expect(r.remaining).toContain(owners[2]);
    }
  },
);
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
      completed: [...TAIL_STAGES],
      confirmedDeleted: [...owners].reverse(),
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
}, 60_000);
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
