/** Synthetic backend contracts exercise the real entry/client/factory paths; never native evidence. */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtClient, mockFetch } from './native-procedural-mock.js';

const undici = await vi.importActual<typeof import('undici')>('undici');
const { runNativeProceduralContract } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-driver.js'
);
const { GROUP, MODULE, INCLUDE, MARKER, POOL, owners, STAGES, proceduralConfig } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-fixed.js'
);
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { Semaphore } = await import('../../../src/adt/semaphore.js');
const { checkProceduralRequest } = await import('../../../scripts/qualification/pr1142/native-procedural-transport.js');
const { runNativeProcedural: entry, assertProceduralRuntime } = await import(
  '../../../scripts/qualification/pr1142/native-procedural.js'
);
const { PROCEDURAL_PROTOCOL, PROCEDURAL_SUFFIX } = await import(
  '../../../scripts/qualification/pr1142/native-procedural-fixed.js'
);
const nativeInclude = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/procedural-include-a4h-readback.json', import.meta.url), 'utf8'),
);
const core = 'http://www.sap.com/adt/core';
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
  const i = owners.indexOf(owner),
    data = objects.get(owner)!;
  const module = i === 1,
    group = i === 0,
    name = group ? GROUP : module ? MODULE : INCLUDE,
    ns = `http://www.sap.com/adt/functions/${group ? 'groups' : module ? 'fmodules' : 'fincludes'}`,
    prefix = group ? 'group' : module ? 'fmodule' : 'finclude',
    tag = group ? 'abapFunctionGroup' : module ? 'abapFunctionModule' : 'abapFunctionGroupInclude';
  const version = active || data.draft === undefined ? 'active' : 'inactive';
  const xml = `<${prefix}:${tag} xmlns:${prefix}="${ns}" xmlns:adtcore="${core}" adtcore:name="${name}" adtcore:type="${group ? 'FUGR/F' : module ? 'FUGR/FF' : 'FUGR/I'}" adtcore:description="${MARKER}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN" adtcore:version="${version}" ${module ? 'fmodule:processingType="normal"' : ''}>${group ? '<adtcore:packageRef adtcore:name="$TMP" adtcore:type="DEVC/K"/>' : `<adtcore:containerRef adtcore:name="${GROUP}" adtcore:type="FUGR/F" adtcore:uri="${owners[0]}" adtcore:packageName="$TMP"/>`}</${prefix}:${tag}>`;
  return group && parentDrift
    ? xml.replace(`adtcore:description="${MARKER}"`, `adtcore:description="foreign marker"`)
    : xml;
}
beforeEach(() => {
  vi.restoreAllMocks();
  calls = [];
  records = [];
  fault = '';
  parentDrift = '';
  objects = new Map();
  deleted = new Set();
  absenceReads = new Map();
  activeTexts = { symbols: '', selections: '', headings: '' };
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
          if (data?.draft !== undefined) {
            data.active = data.draft;
            delete data.draft;
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
        deleted.add(path);
        return reply(204);
      }
      if (path === `${owners[0]}/objectstructure`)
        return reply(
          200,
          `<s:objectStructureElement xmlns:s="http://www.sap.com/adt/abapsource" xmlns:c="${core}" c:name="${GROUP}" c:type="FUGR/F">${['TOP', 'UXX'].map((s) => `<s:objectStructureElement c:name="L${GROUP}${s}" c:type="FUGR/I"/>`).join('')}</s:objectStructureElement>`,
          'application/vnd.sap.adt.objectstructure.v2+xml',
        );
      if (path === POOL)
        return objects.has(owners[0])
          ? reply(
              200,
              `<t:textElement xmlns:t="http://www.sap.com/adt/textelements" xmlns:c="${core}" c:name="${GROUP}" c:type="FUGR/PX" c:version="${Object.keys(draftTexts).length ? 'inactive' : 'active'}"><c:packageRef c:name="$TMP" c:type="DEVC/K"/></t:textElement>`,
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
          return reply(200, data!.active + (objects.has(owners[2]) ? `INCLUDE ${INCLUDE}.\n` : ''), 'text/plain');
        if (data)
          return reply(
            200,
            uri.searchParams.get('version') === 'active' ? data.active : (data.draft ?? data.active),
            'text/plain',
          );
        if (path.includes(`/includes/l${GROUP.toLowerCase()}`))
          return reply(200, '* generated baseline\n', 'text/plain');
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
it('real factories, owning HTTP, signatures, FORM siblings, whole pool parts and ordered cleanup', async () => {
  const result = await run();
  expect(result, JSON.stringify({ result, records: records.slice(-12) }, null, 2)).toMatchObject({
    failure: false,
    completed: [...STAGES],
    confirmedDeleted: [...owners].reverse(),
    remaining: [],
    finalAbsenceConfirmed: true,
    cleanupConfirmed: true,
  });
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([...owners].reverse());
  expect(records.filter((row) => row.stage === 'dispatch' && row.method === 'PUT')).toHaveLength(
    calls.filter((call) => call.method === 'PUT').length,
  );
});
it('preflight uses GETs only and proves all exact owner/pool absences', async () => {
  const result = await run({ preflight: true });
  expect(result).toMatchObject({ failure: false, mutationAttempted: false, completed: ['preflight'] });
  expect(calls.every((c) => c.method === 'GET' || c.method === 'HEAD')).toBe(true);
});
it('unknown create consumes no replay and retains the possible group', async () => {
  fault = 'create-unknown';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [owners[0]] });
  expect(
    calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/functions/groups'),
  ).toHaveLength(1);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it.each(['foreign-parent', 'save-mismatch', 'pool-activation-unverified', 'unlock-unknown', 'delete-unknown'])(
  'retains exact possible owners after %s without cleanup replay',
  async (value) => {
    fault = value;
    const result = await run();
    expect(result.failure, JSON.stringify(result)).toBe(true);
    expect(result.remaining).toContain(owners[0]);
    if (value !== 'delete-unknown') expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    else expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  },
);
it('generic service 404 never establishes typed native absence', async () => {
  fault = 'generic-404';
  expect(await run()).toMatchObject({ failure: true, mutationAttempted: false });
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});
it('historical include deletion remains true but subsequent presence blocks sibling/parent deletion', async () => {
  fault = 'revived-include';
  const result = await run();
  expect(result).toMatchObject({ failure: true, confirmedDeleted: [owners[2]] });
  expect(result.remaining).toContain(owners[2]);
  expect(result.inspectionRequired).toContain(owners[2]);
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});
it('terminal presence does not become a clean result after all historical deletions', async () => {
  fault = 'terminal-present';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    confirmedDeleted: [...owners].reverse(),
    finalAbsenceConfirmed: false,
  });
  expect(result.remaining).toContain(owners[0]);
});
it.each(['binding', 'expiry'])('revalidates %s after actual CSRF fetch and before CREATE dispatch', async (kind) => {
  let changed = false,
    now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  hook = (method) => {
    if (method === 'HEAD') {
      changed = true;
      if (kind === 'expiry') now += 300_001;
    }
  };
  const result = await run({
    verifySource: () => {
      if (changed && kind === 'binding') throw new Error('synthetic drift');
    },
  });
  expect(result.failure).toBe(true);
  expect(calls.some((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/functions/groups')).toBe(false);
});
it('own unlock/session closure remains reachable after cancellation during a submitted source save', async () => {
  let stopped = false;
  hook = (method) => {
    if (method === 'PUT') stopped = true;
  };
  const result = await run({ shouldStop: () => stopped });
  expect(result.failure).toBe(true);
  expect(result.remaining).toContain(owners[1]);
  expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  expect(calls.some((c) => c.path.includes('/http/sessions'))).toBe(true);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it('fresh hash is checked under the actual owner lock before a signature-only PUT', async () => {
  let locks = 0;
  hook = (method, path) => {
    if (method === 'POST' && path === owners[1] && calls.at(-1)?.path.includes('_action=LOCK') && ++locks === 3)
      objects.get(owners[1])!.draft = `${objects.get(owners[1])!.active}* concurrently changed\n`;
  };
  const result = await run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'module-signature' });
  expect(calls.filter((c) => c.method === 'PUT' && c.path.startsWith(owners[1]))).toHaveLength(1);
});
it('entry→factory→real HTTP chain claims once; checks neither load credentials nor grant execution', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'arc1-procedural-entry-')),
    root = join(temporary, 'synthetic-protocol'),
    revision = 'a'.repeat(40);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex'),
    tick = () => vi.setSystemTime(Date.now() + 1);
  const binding = {
    repo: temporary,
    root,
    verifySource: vi.fn(),
    evidence: {
      revision,
      repo: temporary,
      node: 'v22.21.1',
      entryHash: 'b'.repeat(64),
      packageLockHash: 'c'.repeat(64),
      dependencyLimit: 'synthetic',
    },
  };
  const deps = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => binding),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_CLIENT: '001',
      SAP_PASSWORD: 'synthetic-password',
    })),
    createClient: vi.fn(() => client()),
    execute: runNativeProceduralContract,
  };
  const invoke = (phase: string) => entry([`--${phase}-reviewed-procedural`, revision], deps);
  const controls = (phase: 'execute' | 'final') => {
    tick();
    const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
    const obs = {
        observedAt: new Date().toISOString(),
        client: '001',
        table: '*',
        lockCount: 0,
        evidenceSha256: hash(jpeg),
      },
      directory = join(root, phase === 'execute' ? 'prerequisites' : 'final');
    const data = {
      protocol: PROCEDURAL_PROTOCOL,
      phase,
      revision,
      intentHash: hash(readFileSync(join(root, 'intent.json'))),
      previousResultHash: hash(readFileSync(join(root, phase === 'execute' ? 'preflight' : 'execute', 'result.json'))),
      noConcurrentFixtureEditing: true,
      suffixSearch: { ...obs, user: '*', argument: `*${PROCEDURAL_SUFFIX}*` },
      userSearch: { ...obs, user: 'MARIAN', argument: '*' },
    };
    writeFileSync(join(directory, 'sm12-baseline.json'), JSON.stringify(data), { mode: 0o600 });
    for (const key of ['suffix', 'user']) writeFileSync(join(directory, `sm12-${key}.jpg`), jpeg, { mode: 0o600 });
    tick();
  };
  try {
    expect(await invoke('prepare')).toMatchObject({ failure: false, mutationAttempted: false });
    expect(deps.readEnv).not.toHaveBeenCalled();
    tick();
    expect(await invoke('preflight')).toMatchObject({ failure: false, completed: ['preflight'] });
    controls('execute');
    expect(await invoke('check')).toMatchObject({ failure: false, executionGrant: false });
    expect(deps.readEnv).toHaveBeenCalledTimes(1);
    expect(existsSync(join(root, 'execute'))).toBe(false);
    const result = await invoke('execute');
    expect(result).toMatchObject({ failure: false, completed: [...STAGES], finalAbsenceConfirmed: true });
    await expect(invoke('execute')).rejects.toThrow();
    expect(deps.readEnv).toHaveBeenCalledTimes(2);
    controls('final');
    expect(await entry(['--verify-reviewed-procedural-cleanup', revision], deps)).toMatchObject({
      failure: false,
      executionGrant: false,
    });
    expect(deps.readEnv).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(root, 'intent.json'), 'utf8'))).not.toHaveProperty('finalDeletionOwners');
    const saved = JSON.parse(readFileSync(join(root, 'execute/result.json'), 'utf8'));
    expect(saved.confirmedDeleted).toEqual([...owners].reverse());
    saved.confirmedDeleted = [owners[0]];
    writeFileSync(join(root, 'execute/result.json'), JSON.stringify(saved));
    controls('final');
    const count = calls.length;
    await expect(entry(['--verify-reviewed-procedural-cleanup', revision], deps)).rejects.toThrow();
    expect(calls).toHaveLength(count);
    expect(deps.readEnv).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 60_000);
it.each([{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { NODE_OPTIONS: '--inspect' }, { ARC1_LOG_HTTP_DEBUG: 'true' }])(
  'runtime refuses ambient unsafe launch settings %j',
  (env) => {
    expect(() => assertProceduralRuntime(env, [], 'v22.21.1')).toThrow();
  },
);
it.each(['source', 'baseline-expiry', 'native-timeout'])(
  'actual semaphore wait cannot outlive %s at the send boundary',
  async (kind) => {
    const semaphore = new Semaphore(1);
    let held = false,
      changed = false,
      now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const promise = run({
      base: client(semaphore),
      verifySource: () => {
        if (changed && kind === 'source') throw new Error('changed source');
      },
      record: (row: any) => {
        records.push(row);
        if (!held && row.stage === 'request' && row.method === 'POST' && row.path === '/sap/bc/adt/functions/groups') {
          held = true;
          void semaphore.acquire();
        }
      },
    });
    await vi.waitFor(() => expect(semaphore.waiting).toBe(1));
    changed = true;
    if (kind === 'baseline-expiry') now += 300_001;
    if (kind === 'native-timeout') now += 30_001;
    semaphore.release();
    expect((await promise).failure).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/sap/bc/adt/functions/groups')).toBe(false);
  },
);
it.each([
  ['POST', `${owners[0]}/includes/lforeign?_action=LOCK&accessMode=MODIFY`, undefined],
  ['DELETE', `${owners[0]}/includes/l${GROUP.toLowerCase()}top?lockHandle=x`, undefined],
  ['POST', '/sap/bc/adt/programs/programs', undefined],
  ['GET', '/sap/bc/adt/abaprun/programs', undefined],
  ['GET', `${owners[0]}?version=active&version=inactive`, undefined],
  ['PUT', `${owners[1]}/source/main?lockHandle=x&corrNr=A4HK900001`, 'foreign source'],
  [
    'POST',
    '/sap/bc/adt/activation?method=activate&preauditRequested=true',
    `<c:objectReferences xmlns:c="${core}"><c:objectReference c:uri="${owners[0]}/includes/lforeign" c:name="LFOREIGN"/></c:objectReferences>`,
  ],
])('exact current stage refuses %s %s', (method, path, body) => {
  expect(() =>
    checkProceduralRequest(
      { stage: 'include-activate', activation: { uri: owners[2], name: INCLUDE } },
      method!,
      path!,
      body,
    ),
  ).toThrow();
});
it('retains native lowercase signature identifiers without folding the mixed-case default literal', async () => {
  fault = 'native-signature-case';
  expect(await run()).toMatchObject({ failure: false, finalAbsenceConfirmed: true });
});
it('native framing does not authorize changed mixed-case default literals', async () => {
  fault = 'native-literal-change';
  expect(await run()).toMatchObject({ failure: true, stoppedAt: 'module-create' });
  expect(
    calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation') && c.body.includes(owners[1])),
  ).toBe(false);
});

it.each(['module-create', 'include-create', 'text-headings'])(
  'foreign parent marker must refuse before %s mutation',
  async (stage) => {
    const result = await run({
      record: (row: any) => {
        records.push(row);
        if (row.workflowStage === stage) parentDrift = 'changed';
      },
    });
    expect(result.failure).toBe(true);
    const path =
      stage === 'module-create'
        ? `${owners[0]}/fmodules`
        : stage === 'include-create'
          ? `${owners[0]}/includes`
          : `${POOL}/source/headings`;
    expect(
      calls.filter(
        (call) =>
          (stage === 'text-headings' ? call.method === 'PUT' : call.method === 'POST') &&
          call.path.split('?')[0] === path,
      ),
    ).toHaveLength(0);
    expect(result.remaining).toContain(owners[0]);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  },
);
it('narrower request expiry after final synchronous proof blocks actual initial CREATE', async () => {
  let now = Date.now(),
    armed = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const result = await run({
    verifySource: () => {
      if (armed) now += 30_001;
    },
    record: (row: any) => {
      records.push(row);
      if (row.stage === 'request' && row.method === 'POST' && row.path === '/sap/bc/adt/functions/groups') armed = true;
    },
  });
  expect(result.failure).toBe(true);
  expect(
    calls.some((call) => call.method === 'POST' && call.path.split('?')[0] === '/sap/bc/adt/functions/groups'),
  ).toBe(false);
});

it('native 421 cannot replay a submitted group creation through the actual composed dispatcher', async () => {
  fault = 'create-421';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [owners[0]] });
  expect(
    calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === '/sap/bc/adt/functions/groups'),
  ).toHaveLength(1);
  expect(
    records.filter(
      (row) => row.stage === 'dispatch' && row.method === 'POST' && row.path === '/sap/bc/adt/functions/groups',
    ),
  ).toHaveLength(1);
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
});

it.each(['crlf', 'lf-trim', 'crlf-trim'])(
  'accepts native INCL %s framing while preserving exact stored hashes',
  async (variant) => {
    fault = `include-native-${variant}`;
    const result = await run();
    expect(result).toMatchObject({ failure: false, completed: [...STAGES], finalAbsenceConfirmed: true });
    const saves = records.filter(
      (row) => row.workflowStage.startsWith('include-') && row.operation && row.operation !== 'delete',
    );
    expect(saves).toHaveLength(3);
    for (const row of saves) {
      const result = JSON.parse(row.result.content[0].text);
      const source = records.find(
        (receipt) =>
          receipt.workflowStage === row.workflowStage &&
          receipt.childReceipt === owners[2] &&
          receipt.sourceHash === result.sourceHash,
      )?.source;
      expect(typeof source).toBe('string');
      expect(result.sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
      const submitted = calls.filter(
        (call) => call.method === 'PUT' && call.path.split('?')[0] === `${owners[2]}/source/main`,
      )[saves.indexOf(row)]!.body;
      if (row.workflowStage === 'include-create') {
        expect(result.sourceHash).not.toBe(createHash('sha256').update(submitted).digest('hex'));
        if (variant === 'crlf-trim') {
          expect(submitted).toBe(nativeInclude.requestedSource);
          expect(source).toBe(nativeInclude.storedSource);
          expect(result.sourceHash).toBe(nativeInclude.storedSourceHash);
        }
      }
      expect(row.cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    }
  },
);
it.each(['sibling-change', 'blank-change'])(
  'refuses native INCL %s instead of normalizing content',
  async (variant) => {
    fault = `include-native-${variant}`;
    const result = await run();
    expect(result).toMatchObject({ failure: true, stoppedAt: 'include-create', remaining: [...owners] });
    expect(
      calls.filter((call) => call.method === 'PUT' && call.path.split('?')[0] === `${owners[2]}/source/main`),
    ).toHaveLength(1);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(result.cleanupConfirmed).toBe(true);
  },
);
it('normalization-equivalent late source drift still fails the exact stale hash before FORM PUT', async () => {
  fault = 'include-native-crlf-trim';
  hook = (method, path) => {
    if (
      method === 'POST' &&
      path === owners[2] &&
      calls.at(-1)?.path.includes('_action=LOCK') &&
      calls.filter((call) => call.method === 'PUT' && call.path.split('?')[0] === `${owners[2]}/source/main`).length ===
        1
    ) {
      const owner = objects.get(owners[2])!;
      owner.draft = owner.draft!.replace(/\r\n/g, '\n');
    }
  };
  const result = await run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'include-edit', remaining: [...owners] });
  expect(
    calls.filter((call) => call.method === 'PUT' && call.path.split('?')[0] === `${owners[2]}/source/main`),
  ).toHaveLength(1);
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
});
