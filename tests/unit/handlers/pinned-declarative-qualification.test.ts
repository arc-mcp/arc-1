import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  declarativeFixtures,
  declarativeV2Fixtures,
  declarativeV4Fixtures,
} from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import { declarativeV5Fixtures } from '../../../scripts/qualification/pr1142/native-declarative-v5-fixtures.js';
import { declarativeV5References } from '../../../scripts/qualification/pr1142/native-declarative-v5-references.js';
import { pinnedDeclarativeSelection } from '../../../src/adt/pinned-repository-owner.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { runNativeDeclarativeContract } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-driver.js'
);
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
describe.each([
  { protocol: 'v1', factory: declarativeFixtures },
  { protocol: 'v2', factory: declarativeV2Fixtures },
  { protocol: 'v4', factory: declarativeV4Fixtures },
  { protocol: 'v5', factory: declarativeV5Fixtures },
])('$protocol fixed lifecycle', ({ factory, protocol }) => {
  const fixtures = factory('0123456789ABCDEF');
  const [view, abstract, role, extension, behavior, service] = fixtures;
  const references = protocol === 'v5' ? declarativeV5References(fixtures) : [];
  it('keeps the native DT205 reserved field alias out of both view-source variants', () => {
    for (const source of [view.source, view.updatedSource]) {
      expect(source).not.toMatch(/\bas\s+connection\b/i);
      expect(source).toMatch(/\bconnid\s+as\s+ConnectionId\b/);
    }
  });
  const core = 'http://www.sap.com/adt/core';
  const absent =
    '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>';
  const HANDLE = 'FIXTURE-LOCK-HANDLE';
  const CONTEXT = 'FIXTURE-CONTEXT';
  const PASSWORD = 'FIXTURE-PASSWORD';
  const BINDING_TEXT = 'BINDING-PRIVATE-TEXT';
  const realNow = Date.now.bind(Date);
  const state = new Map<
    string,
    { exists: boolean; locked: boolean; source: string; activeSource?: string; draft: boolean; prompt: boolean }
  >();
  const calls: { method: string; path: string }[] = [];
  const records: any[] = [];
  const unexpected: string[] = [];
  let fault = '',
    stopped = false,
    bindingBroken = false,
    closeFailed = false,
    clockOffset = 0;
  const intent = (phase: string, owner: string) =>
    records.some((record) => record.phase === phase && record.owner === owner && record.stage === 'intent');
  const activations = (owner: string) =>
    records.filter((record) => record.operation === 'activate' && record.owner === owner).length;
  /** Receipt changes that appear only after the check before them, on the independent connection alone. */
  function drifted(
    fixture: (typeof fixtures)[number],
    locked: boolean,
    stateful: boolean,
    kind: 'metadata' | 'source',
  ) {
    const [when, drift] = fault.split(':');
    if (stateful || drift !== kind) return false;
    if (when === 'guard') return fixture === service && locked;
    if (when === 'pre-activate') return fixture === view && intent('activate', view.owner);
    if (when === 'pre-update') return fixture === view && intent('update', view.owner);
    if (when === 'pre-delete') return fixture === service && intent('delete', service.owner);
    return false;
  }
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
    resetCachedFeatures();
    setCachedFeatures({ ...featuresOff, systemType: 'onprem', abapRelease: '758' });
    state.clear();
    calls.length = 0;
    records.length = 0;
    unexpected.length = 0;
    fault = '';
    stopped = false;
    bindingBroken = false;
    closeFailed = false;
    clockOffset = 0;
    for (const fixture of fixtures)
      state.set(fixture.owner, { exists: false, locked: false, source: '// skeleton\n', draft: true, prompt: false });
    mockFetch.mockImplementation(async (url, init: any = {}) => {
      const uri = new URL(String(url)),
        path = uri.pathname,
        method = init.method ?? 'GET',
        stateful = init.headers?.['X-sap-adt-sessiontype'] === 'stateful';
      calls.push({ method, path: path + uri.search });
      if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'fixture' });
      if (path.includes('/http/sessions')) {
        if (
          fault === 'close-fail' &&
          !closeFailed &&
          intent('delete', service.owner) &&
          !state.get(service.owner)!.exists
        ) {
          closeFailed = true;
          return mockResponse(500, 'close failed');
        }
        return mockResponse(200, '');
      }
      if (path.endsWith('/transportchecks')) {
        const operation = String(init.body).match(/<OPERATION>([^<]*)<\/OPERATION>/)?.[1] ?? '';
        if (fault === 'cts-refuse-child' && operation === 'I' && String(init.body).includes(role.owner))
          return mockResponse(500, 'CTS unavailable');
        if (fault === 'binding-before-create' && operation === 'I') bindingBroken = true;
        return mockResponse(
          200,
          `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${operation}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
        );
      }
      const finalRead = records.some((record) => record.phase === 'final-absence' && record.stage === 'intent');
      if (fault === 'binding-final-inventory' && finalRead && path.endsWith('/inactiveobjects')) bindingBroken = true;
      if (path.endsWith('/inactiveobjects'))
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">${fault === 'inactive-tail' && calls.some((call) => call.method === 'DELETE') ? fixtures[0].name : ''}</ioc:inactiveObjects>`,
          { 'content-type': 'application/xml' },
        );
      if (references.some((r) => r.owner === path)) {
        expect(method).toBe('GET');
        const created = state.get(behavior.owner)!.exists;
        if (
          fault === 'reference-preflight' ||
          (fault === 'reference-after-create' && created) ||
          (fault === 'reference-under-lock' && state.get(behavior.owner)!.locked)
        )
          return mockResponse(200, '<class/>');
        if (fault === 'reference-final' && finalRead) return mockResponse(503, 'unknown');
        if (fault === 'reference-binding' && created) bindingBroken = true;
        if (fault === 'reference-untyped') return mockResponse(404, '<html>not found</html>');
        return mockResponse(404, absent);
      }
      if (path === '/sap/bc/adt/activation') {
        const owner = String(init.body).match(/adtcore:uri="([^"]+)"/)?.[1];
        const fixture = fixtures.find((f) => f.owner === owner)!;
        const row = state.get(owner!)!;
        if (!fixture || !row) throw new Error('Unknown activation fixture');
        if (uri.searchParams.get('preauditRequested') === 'true')
          return mockResponse(
            200,
            `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:c="${core}"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref c:uri="${owner}" c:name="${fixture.name}" c:type="${pinnedDeclarativeSelection(fixture.type, fixture.name).native}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          );
        row.activeSource = row.source;
        row.draft = false;
        return mockResponse(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
        );
      }
      for (const fixture of fixtures) {
        const row = state.get(fixture.owner)!;
        const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
        const independentlyReading = records.some(
          (record) => record.operation === 'create' && record.owner === fixture.owner,
        );
        if (
          method === 'POST' &&
          path === fixture.owner.replace(/\/[^/]+$/, '') &&
          String(init.body).includes(`adtcore:name="${fixture.name}"`)
        ) {
          if (fixture === role && fault === 'create-503') return mockResponse(503, 'create outcome unknown');
          if (fixture === role && fault === 'create-409') return mockResponse(409, absent);
          row.exists = true;
          return mockResponse(201, '', { location: fixture.owner });
        }
        if (path !== fixture.owner && path !== `${fixture.owner}/source/main`) continue;
        if (fault === 'binding-child-guard' && fixture === role && !stateful && state.get(view.owner)!.locked)
          bindingBroken = true;
        const liveChild = fault === 'live-child' && fixture === role && !stateful && state.get(view.owner)!.locked;
        if (fault === 'preflight-untyped' && fixture === behavior && !row.exists)
          return mockResponse(404, '<html>plain not found</html>');
        if (
          fault === 'unlock-fail' &&
          fixture === service &&
          !row.exists &&
          uri.searchParams.get('_action') === 'UNLOCK'
        )
          return mockResponse(500, 'unlock failed');
        if (
          fault === 'absence-unavailable' &&
          fixture === service &&
          !row.exists &&
          !stateful &&
          intent('delete', service.owner)
        )
          return mockResponse(503, 'independent read unavailable');
        if (fault === 'binding-final-owner' && finalRead && fixture === service) bindingBroken = true;
        if (!row.exists && !liveChild) return mockResponse(404, absent);
        if (uri.searchParams.get('_action') === 'LOCK') {
          row.locked = true;
          if (fault === 'binding-update' && intent('update', fixture.owner)) bindingBroken = true;
          if (fault === 'binding-delete' && intent('delete', fixture.owner)) bindingBroken = true;
          if (fault === 'phase-deadline' && intent('update', fixture.owner)) clockOffset += 61_000;
          return mockResponse(200, `<DATA><LOCK_HANDLE>${HANDLE}</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>`, {
            'set-cookie': `sap-contextid=${CONTEXT}; Path=/`,
          });
        }
        if (uri.searchParams.get('_action') === 'UNLOCK') {
          row.locked = false;
          return mockResponse(200, '');
        }
        if (method === 'DELETE') {
          expect(row.locked).toBe(true);
          row.exists = false;
          row.locked = false;
          return mockResponse(200, '');
        }
        if (fault === 'stop-guard' && row.locked && !stateful) stopped = true;
        if (fault === 'binding-guard' && fixture === service && row.locked && !stateful) bindingBroken = true;
        if (path.endsWith('/source/main')) {
          if (method === 'PUT') {
            expect(row.locked).toBe(true);
            row.source = String(init.body);
            row.draft = true;
            if (fault === 'stop-save') stopped = true;
            if (fault === 'update-unknown' && fixture.type === 'DCLS' && row.source.includes('revised fixture comment'))
              return mockResponse(503, 'native failure');
            return mockResponse(200, '');
          }
          return mockResponse(
            200,
            (independentlyReading && fault === 'source-drift') || drifted(fixture, row.locked, stateful, 'source')
              ? '// foreign source'
              : uri.searchParams.get('version') === 'active'
                ? (row.activeSource ?? '')
                : row.source,
            {
              'content-type': independentlyReading && fault === 'source-mime' ? 'text/html' : 'text/plain',
            },
          );
        }
        const active = uri.searchParams.get('version') === 'active' && row.activeSource !== undefined;
        const fallback =
          !stateful &&
          fixture === view &&
          active &&
          ((fault === 'active-fallback-first' && activations(view.owner) >= 1) ||
            (fault === 'active-fallback-later' && activations(view.owner) >= 2));
        const version = fallback ? 'inactive' : active || !row.draft ? 'active' : 'inactive';
        let alternate =
          row.draft && row.activeSource !== undefined
            ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${(fault === 'ddls-relative' && fixture.type === 'DDLS') || fault === `owned-relative:${fixture.type}` ? `./${fixture.owner.split('/').at(-1)}` : `${fixture.owner}/source/main`}?version=${active ? 'inactive' : 'active'}"/>`
            : fault === 'relative-link' && fixture === behavior
              ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${fixture.name}/source/main"/>`
              : '';
        if (row.draft && row.activeSource !== undefined && fault === `invalid-relative:${fixture.type}`)
          alternate = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${fixture.owner.split('/').at(-1)}?version=active&amp;x=1"/>`;
        if (
          row.activeSource !== undefined &&
          activations(fixture.owner) >= 2 &&
          fault === `remaining-inactive:${fixture.type}`
        )
          alternate = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${fixture.owner.split('/').at(-1)}?version=inactive"/>`;
        return mockResponse(
          200,
          `<x:${selected.root} xmlns:x="${selected.namespace}" xmlns:c="${core}" c:name="${fixture.name}" c:type="${selected.native}" c:description="${independentlyReading && fault === 'owner-marker' ? 'foreign' : fixture.description}" c:version="${version}" c:createdBy="MARIAN" c:changedBy="${independentlyReading && fault === 'foreign-author' ? 'OTHER' : 'MARIAN'}"${drifted(fixture, row.locked, stateful, 'metadata') ? ' c:changedAt="later"' : ''}><c:packageRef c:name="$TMP" c:type="DEVC/K"/>${alternate}</x:${selected.root}>`,
        );
      }
      unexpected.push(`${method} ${path}`);
      return mockResponse(599, 'unexpected');
    });
  });
  afterEach(() => {
    expect(unexpected).toEqual([]);
    // Every scenario, including refused ones: lock handles, context IDs and raw failure text stay out of receipts.
    const journal = JSON.stringify(records);
    for (const secret of [HANDLE, CONTEXT, PASSWORD, BINDING_TEXT]) expect(journal).not.toContain(secret);
    vi.restoreAllMocks();
  });
  function trackClock(value: { phase?: string; owner?: string; stage?: string }) {
    if (
      fault === 'forward-deadline' &&
      value.phase === 'create' &&
      value.owner === abstract.owner &&
      value.stage === 'intent'
    )
      clockOffset = 8 * 60_000 + 1000;
    if (
      fault === 'cleanup-deadline' &&
      value.phase === 'delete' &&
      value.owner === service.owner &&
      value.stage === 'intent'
    )
      clockOffset = 12 * 60_000 + 1000;
  }
  async function run() {
    const config = {
      ...DEFAULT_CONFIG,
      client: '001',
      targetId: 'A4H/001',
      systemType: 'onprem' as const,
      allowWrites: true,
      allowedPackages: ['$TMP'],
      lintBeforeWrite: false,
      checkBeforeWrite: false,
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    };
    const base = new AdtClient({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: 'MARIAN',
      password: PASSWORD,
      safety: { ...defaultSafetyConfig(), ...config },
    });
    return runNativeDeclarativeContract({
      base,
      config,
      fixtures,
      readOnlyReferences: references,
      record: (value: any) => {
        records.push(value);
        trackClock(value);
      },
      verifySource: () => {
        if (bindingBroken) throw new Error(BINDING_TEXT);
      },
      shouldStop: () => stopped,
    });
  }
  const unconfirmed = (owner?: string) =>
    records.filter((row) => row.stage === 'unconfirmed' && (owner === undefined || row.owner === owner));
  const refusals = (method: string, owner: string) =>
    records.filter(
      (row) => row.stage === 'refused-before-send' && row.method === method && row.path.split('?')[0] === owner,
    );
  const deletesOn = (owner: string) => calls.filter((call) => call.method === 'DELETE' && call.path.startsWith(owner));
  const activationPosts = () => calls.filter((call) => call.path.startsWith('/sap/bc/adt/activation?'));
  const unlockedEverything = () => [...state.values()].every((row) => !row.locked);
  const sessionsClosed = () => calls.filter((call) => call.path.includes('/http/sessions')).length;

  it('runs all six private native lifecycles through real adapters and confirms cleanup', async () => {
    const result = await run();
    expect(
      result.failure,
      JSON.stringify(records.filter((row) => row.operation || row.stage === 'refused-before-send')),
    ).toBe(false);
    expect(result).toMatchObject({
      mutationAttempted: true,
      remaining: [],
      pendingCreation: [],
      createNeverSent: [],
      inspectionRequired: [],
      cleanupIssues: [],
      cleanupNotAttempted: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
    });
    expect(result.confirmedDeleted).toEqual([...fixtures].reverse().map((fixture) => fixture.owner));
    expect([...state.values()].every((row) => !row.exists && !row.locked)).toBe(true);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(6);
    expect(activationPosts()).toHaveLength(24);
  });
  if (protocol === 'v5') {
    it('uses with-control BDEF and keeps the default class strictly read-only throughout the six-owner lifecycle', async () => {
      expect(behavior.source).toContain(`define behavior for ${behavior.name} with control`);
      const result = await run();
      expect(result.failure).toBe(false);
      expect(result.confirmedDeleted).toHaveLength(6);
      const reads = calls.filter((c) => c.path.split('?')[0] === references[0].owner);
      expect(reads.length).toBeGreaterThanOrEqual(7);
      expect(reads.every((c) => c.method === 'GET')).toBe(true);
      expect(result.confirmedDeleted).not.toContain(references[0].owner);
    });
    it.each(['reference-preflight', 'reference-untyped'])('%s refuses before any mutation', async (issue) => {
      fault = issue;
      const result = await run();
      expect(result.failure).toBe(true);
      expect(result.mutationAttempted).toBe(false);
      expect(calls.every((c) => c.method === 'GET' || c.method === 'HEAD')).toBe(true);
    });
    it.each(['reference-after-create', 'reference-binding', 'reference-under-lock'])(
      '%s preserves the BDEF and dependent base without owning the class',
      async (issue) => {
        fault = issue;
        const result = await run();
        expect(result.failure).toBe(true);
        expect(result.inspectionRequired).toContain(behavior.owner);
        expect(deletesOn(behavior.owner)).toHaveLength(0);
        expect(deletesOn(abstract.owner)).toHaveLength(0);
        expect(deletesOn(references[0].owner)).toHaveLength(0);
        expect(unlockedEverything()).toBe(true);
      },
    );
    it('retains six confirmed deletes but reports a final reference read as unknown', async () => {
      fault = 'reference-final';
      const result = await run();
      expect(result.failure).toBe(true);
      expect(result.confirmedDeleted).toHaveLength(6);
      expect(result.finalAbsenceConfirmed).toBe(false);
      expect(deletesOn(references[0].owner)).toHaveLength(0);
    });
  }
  it('preserves uncertain saves and their dependency instead of deleting them', async () => {
    fault = 'update-unknown';
    const result = await run();
    expect(result.failure).toBe(true);
    expect(result.inspectionRequired).toEqual(expect.arrayContaining([role.owner, ...role.dependencies]));
    expect(unconfirmed(role.owner)[0].reason).toBe('write-unconfirmed');
    expect(
      calls
        .filter((call) => call.method === 'DELETE')
        .some((call) => call.path.startsWith(role.owner) || call.path.startsWith(role.dependencies[0])),
    ).toBe(false);
  });
  it('closes its owning lock after a stop without another forward mutation or deletion', async () => {
    fault = 'stop-save';
    const result = await run();
    expect(result.stopped).toBe(true);
    expect(unlockedEverything()).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE' || call.path.startsWith('/sap/bc/adt/activation?'))).toBe(
      false,
    );
  });
  it('does not claim complete cleanup when the inactive inventory retains the namespace', async () => {
    fault = 'inactive-tail';
    const result = await run();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(6);
    expect(result).toMatchObject({
      failure: true,
      remaining: [],
      cleanupUnconfirmed: true,
      finalAbsenceConfirmed: false,
    });
    expect(unconfirmed()).toEqual([
      { phase: 'final-absence', stage: 'unconfirmed', reason: 'inventory-contains-fixture' },
    ]);
  });

  it.each(['binding-final-owner', 'binding-final-inventory'])(
    'retains deletions but refuses %s drift in the final awaited native reads',
    async (boundary) => {
      fault = boundary;
      const result = await run();
      expect(result).toMatchObject({
        failure: true,
        remaining: [],
        finalAbsenceConfirmed: false,
        cleanupUnconfirmed: true,
      });
      expect(result.confirmedDeleted).toEqual([...fixtures].reverse().map((fixture) => fixture.owner));
      expect(result.inspectionRequired).toEqual(fixtures.map((fixture) => fixture.owner));
      expect(unconfirmed()).toContainEqual({ phase: 'final-absence', stage: 'unconfirmed', reason: 'source-binding' });
      expect(unlockedEverything()).toBe(true);
    },
  );

  it('completes the fixed graph using observed exact relative DDLS state links on the inactive update', async () => {
    fault = 'ddls-relative';
    expect(await run()).toMatchObject({ failure: false, finalAbsenceConfirmed: true, cleanupUnconfirmed: false });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(6);
    expect(unlockedEverything()).toBe(true);
  });

  it.each(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'] as const)(
    'completes the graph with exact same-owner %s relative alternatives after acknowledged updates (synthetic)',
    async (type) => {
      fault = `owned-relative:${type}`;
      expect(await run()).toMatchObject({ failure: false, finalAbsenceConfirmed: true, cleanupUnconfirmed: false });
      for (const fixture of fixtures.filter((item) => item.type === type)) {
        const update = records.find((record) => record.operation === 'update' && record.owner === fixture.owner);
        expect(update).toBeDefined();
        expect(update.result.isError).toBeUndefined();
        expect(
          calls.filter((call) => call.method === 'PUT' && call.path.startsWith(`${fixture.owner}/source/main`)),
        ).toHaveLength(2);
      }
      expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(6);
      expect(unlockedEverything()).toBe(true);
    },
  );

  it.each(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'] as const)(
    'preserves %s and dependencies when an acknowledged update returns extra relative query data',
    async (type) => {
      fault = `invalid-relative:${type}`;
      const fixture = fixtures.find((item) => item.type === type)!;
      const result = await run();
      expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true });
      expect(unconfirmed(fixture.owner)).toContainEqual({
        phase: 'update',
        owner: fixture.owner,
        stage: 'unconfirmed',
        reason: 'metadata-state-link',
      });
      expect(result.inspectionRequired).toContain(fixture.owner);
      expect(deletesOn(fixture.owner)).toEqual([]);
      expect(unlockedEverything()).toBe(true);
    },
  );
  it.each(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'] as const)(
    'does not confirm %s activation while its exact relative inactive alternative remains',
    async (type) => {
      fault = `remaining-inactive:${type}`;
      const fixture = fixtures.find((item) => item.type === type)!;
      const result = await run();
      expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true });
      expect(result.inspectionRequired).toContain(fixture.owner);
      expect(deletesOn(fixture.owner)).toEqual([]);
      expect(unlockedEverything()).toBe(true);
    },
  );

  it.each([
    ['owner-marker', 'metadata-marker'],
    ['foreign-author', 'metadata-author'],
    ['source-mime', 'source-media'],
    ['source-drift', 'source-content'],
  ])('preserves an independently unconfirmed create after %s, naming the exact check', async (issue, reason) => {
    fault = issue;
    const result = await run();
    expect(records.some((record) => record.operation === 'create' && !record.result.isError)).toBe(true);
    expect(result).toMatchObject({
      failure: true,
      mutationAttempted: true,
      pendingCreation: [view.owner],
      createNeverSent: [],
      cleanupUnconfirmed: true,
    });
    expect(unconfirmed(view.owner)).toEqual([{ phase: 'create', owner: view.owner, stage: 'unconfirmed', reason }]);
    // The refused native answer stays in the journal, ahead of the row that refused it.
    const refusal = records.findIndex((row) => row.stage === 'unconfirmed');
    const answers = records.slice(0, refusal).filter((row) => row.read?.startsWith(view.owner));
    expect(answers.at(-1)).toMatchObject({ status: 200, body: expect.any(String), sha256: expect.any(String) });
    expect(calls.some((call) => call.method === 'DELETE' || call.path.startsWith('/sap/bc/adt/activation?'))).toBe(
      false,
    );
    expect(unlockedEverything()).toBe(true);
  });

  it('retains the relative state-link answer that a first BDEF draft may return, and preserves its base', async () => {
    fault = 'relative-link';
    const result = await run();
    expect(unconfirmed(behavior.owner)).toEqual([
      { phase: 'create', owner: behavior.owner, stage: 'unconfirmed', reason: 'metadata-state-link' },
    ]);
    expect(records.find((row) => row.read === behavior.owner && row.status === 200)?.body).toContain(
      `./${behavior.name}/source/main`,
    );
    expect(result.pendingCreation).toEqual([behavior.owner]);
    expect(result.inspectionRequired).toEqual(expect.arrayContaining([behavior.owner, abstract.owner]));
    expect(deletesOn(abstract.owner)).toEqual([]);
    expect(deletesOn(view.owner)).toHaveLength(1);
  });

  it('reports a typed-absence variant at preflight as a refusal with no mutation or cleanup doubt', async () => {
    fault = 'preflight-untyped';
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      mutationAttempted: false,
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
      pendingCreation: [],
      createNeverSent: [],
    });
    expect(unconfirmed()).toEqual([
      { phase: 'preflight', stage: 'unconfirmed', reason: 'absence-not-typed', status: 404 },
    ]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(records.find((row) => row.read === behavior.owner)?.body).toBeUndefined();
  });

  it.each([
    ['pre-activate:metadata', view, 'receipt-drift'],
    ['pre-update:metadata', view, 'receipt-drift'],
    ['pre-update:source', view, 'source-content'],
  ])('refuses %s before its forward mutation and preserves the owner', async (issue, owner, reason) => {
    fault = issue;
    const result = await run();
    const phase = issue.startsWith('pre-activate') ? 'activate' : 'update';
    expect(unconfirmed(owner.owner)).toEqual([{ phase, owner: owner.owner, stage: 'unconfirmed', reason }]);
    expect(result.remaining).toEqual([owner.owner]);
    expect(result.inspectionRequired).toEqual([owner.owner]);
    expect(deletesOn(owner.owner)).toEqual([]);
    if (phase === 'activate') expect(activationPosts()).toEqual([]);
    // One save from the create only: the comment update was never sent.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });
  it.each([
    ['first', 'active-fallback-first', 2],
    ['later', 'active-fallback-later', 4],
  ])('refuses a %s activation whose explicit active read falls back to inactive', async (_label, issue, posts) => {
    fault = issue;
    const result = await run();
    expect(unconfirmed(view.owner)).toEqual([
      { phase: 'activate', owner: view.owner, stage: 'unconfirmed', reason: 'metadata-not-active' },
    ]);
    expect(activationPosts()).toHaveLength(posts);
    expect(result.remaining).toEqual([view.owner]);
    expect(deletesOn(view.owner)).toEqual([]);
  });
  it.each([
    ['pre-delete:metadata', 'receipt-drift'],
    ['pre-delete:source', 'source-content'],
  ])('refuses %s before any LOCK and preserves its base closure', async (issue, reason) => {
    fault = issue;
    const result = await run();
    expect(unconfirmed(service.owner)).toEqual([
      { phase: 'delete', owner: service.owner, stage: 'unconfirmed', reason },
    ]);
    const deleteIntent = records.findIndex((row) => row.phase === 'delete' && row.owner === service.owner);
    const lockRequests = records
      .slice(deleteIntent)
      .filter((row) => row.stage === 'request' && row.path?.startsWith(`${service.owner}?_action=LOCK`));
    expect(lockRequests).toEqual([]);
    expect(deletesOn(service.owner)).toEqual([]);
    expect(deletesOn(view.owner)).toEqual([]);
    expect(result.cleanupIssues).toEqual([service.owner]);
    expect(result.remaining).toEqual([view.owner, service.owner]);
    expect(result.inspectionRequired).toEqual(expect.arrayContaining([service.owner, view.owner]));
    // Unrelated owners and the other dependency base still clean up.
    expect(deletesOn(abstract.owner)).toHaveLength(1);
    expect(deletesOn(behavior.owner)).toHaveLength(1);
    expect(deletesOn(extension.owner)).toHaveLength(1);
    expect(deletesOn(role.owner)).toHaveLength(1);
  });
  it.each([
    ['guard:metadata', 'receipt-drift'],
    ['guard:source', 'source-content'],
  ])('refuses DELETE on %s seen only under the owning lock', async (issue, reason) => {
    fault = issue;
    const result = await run();
    expect(refusals('DELETE', service.owner).map((row) => row.reason)).toEqual([reason]);
    expect(unconfirmed(service.owner)[0].reason).toBe('delete-not-sent');
    expect(deletesOn(service.owner)).toEqual([]);
    expect(deletesOn(view.owner)).toEqual([]);
    expect(result.cleanupIssues).toEqual([service.owner]);
    expect(result.remaining).toEqual([view.owner, service.owner]);
    expect(result.confirmedDeleted).not.toContain(service.owner);
    expect(unlockedEverything()).toBe(true);
  });
  it('refuses a base DELETE when a live child appears only under the base lock', async () => {
    fault = 'live-child';
    const result = await run();
    expect(refusals('DELETE', view.owner).map((row) => row.reason)).toEqual(['absence-owner-present']);
    expect(deletesOn(view.owner)).toEqual([]);
    expect(result.remaining).toEqual([view.owner]);
    expect(result.cleanupIssues).toEqual([view.owner]);
    expect(unconfirmed(view.owner)[0].reason).toBe('delete-not-sent');
    // The child was earlier deleted and confirmed; the separate abstract closure still completes.
    expect(result.confirmedDeleted).toEqual(
      [service, behavior, extension, role, abstract].map((fixture) => fixture.owner),
    );
    expect(unlockedEverything()).toBe(true);
  });

  it('prevents DELETE when a stop arrives during the guard reads, and still releases the lock', async () => {
    fault = 'stop-guard';
    const result = await run();
    expect(refusals('DELETE', service.owner).map((row) => row.reason)).toEqual(['stopped']);
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(
      calls.some((call) => call.method === 'POST' && call.path.startsWith(`${service.owner}?_action=UNLOCK`)),
    ).toBe(true);
    expect(unlockedEverything()).toBe(true);
    expect(result).toMatchObject({ stopped: true, failure: true, cleanupUnconfirmed: true });
    // Later owners were never attempted, which is not a failed deletion; their bases stay preserved by closure.
    expect(result.cleanupIssues).toEqual([service.owner]);
    expect(result.cleanupNotAttempted).toEqual([behavior, extension, role].map((fixture) => fixture.owner));
    expect(result.remaining).toEqual(fixtures.map((fixture) => fixture.owner));
  });

  it.each([
    ['binding-guard', service],
    ['binding-child-guard', view],
  ] as const)(
    '%s: binding drift during independent guard reads prevents DELETE but permits own cleanup',
    async (issue, owner) => {
      fault = issue;
      const result = await run();
      expect(deletesOn(owner.owner)).toEqual([]);
      expect(refusals('DELETE', owner.owner).map((row) => row.reason)).toEqual(['source-binding']);
      expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true });
      expect(result.confirmedDeleted).not.toContain(owner.owner);
      expect(result.remaining).toContain(owner.owner);
      expect(unlockedEverything()).toBe(true);
      expect(sessionsClosed()).toBeGreaterThan(0);
      expect(
        records.filter((row) => row.operation === 'delete' && row.owner === owner.owner).at(-1).cleanup,
      ).toMatchObject({
        unlockFailed: false,
        sessionClosed: true,
      });
    },
  );

  it.each([
    ['binding-update', view, 'PUT'],
    ['binding-delete', service, 'DELETE'],
  ] as const)('%s: a validated own UNLOCK still releases after source binding fails', async (issue, owner, method) => {
    fault = issue;
    const result = await run();
    const beforeBreak = method === 'PUT' ? 1 : 12;
    expect(calls.filter((call) => call.method === 'PUT').length).toBe(beforeBreak);
    expect(deletesOn(owner.owner)).toEqual([]);
    const unlocks = calls.filter(
      (call) => call.method === 'POST' && call.path.includes(`${owner.owner}?_action=UNLOCK`),
    );
    expect(unlocks.length).toBeGreaterThan(0);
    expect(records.some((row) => row.stage === 'refused-before-send' && row.path?.includes('_action=UNLOCK'))).toBe(
      false,
    );
    expect(records.filter((row) => row.stage === 'refused-before-send').map((row) => row.reason)).toContain(
      'source-binding',
    );
    expect(unlockedEverything()).toBe(true);
    // Session close stays bounded and independent of the refused binding.
    expect(sessionsClosed()).toBeGreaterThan(0);
    expect(records.filter((row) => row.operation && row.owner === owner.owner).at(-1).cleanup).toMatchObject({
      unlockFailed: false,
      sessionClosed: true,
    });
    expect(result.failure).toBe(true);
    expect(result.inspectionRequired).toContain(owner.owner);
  });

  it('stops forward work at its deadline and keeps the reserved cleanup budget', async () => {
    fault = 'forward-deadline';
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      completed: [view.owner],
      createNeverSent: [abstract.owner],
      pendingCreation: [],
      confirmedDeleted: [view.owner],
      remaining: [],
      finalAbsenceConfirmed: true,
      cleanupUnconfirmed: false,
    });
    expect(unconfirmed(abstract.owner)).toEqual([
      { phase: 'create', owner: abstract.owner, stage: 'unconfirmed', reason: 'create-not-sent' },
    ]);
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === '/sap/bc/adt/ddic/ddl/sources'),
    ).toHaveLength(1);
    expect(deletesOn(view.owner)).toHaveLength(1);
  });
  it('sends no deletion after the cleanup deadline and reports every owner as remaining', async () => {
    fault = 'cleanup-deadline';
    const result = await run();
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(result.remaining).toEqual(fixtures.map((fixture) => fixture.owner));
    expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true, finalAbsenceConfirmed: false });
    expect(unconfirmed(service.owner)[0].reason).toBe('metadata-read-failed');
    expect(records.at(-1)).toMatchObject({ stage: 'unconfirmed', reason: 'metadata-read-failed' });
  });
  it('clamps one phase to its 60-second budget, while UNLOCK keeps its own', async () => {
    fault = 'phase-deadline';
    const result = await run();
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(unconfirmed(view.owner)[0].reason).toBe('write-unconfirmed');
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.startsWith(`${view.owner}?_action=UNLOCK`)).length,
    ).toBeGreaterThan(1);
    expect(unlockedEverything()).toBe(true);
    expect(result.remaining).toEqual([view.owner]);
  });

  it('distinguishes a create that was never sent, and lets its base clean up', async () => {
    fault = 'cts-refuse-child';
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      mutationAttempted: true,
      createNeverSent: [role.owner],
      pendingCreation: [],
      inspectionRequired: [],
      remaining: [],
      finalAbsenceConfirmed: true,
      cleanupUnconfirmed: false,
    });
    expect(unconfirmed(role.owner)[0].reason).toBe('create-not-sent');
    expect(records.find((row) => row.operation === 'create' && row.owner === role.owner).result.isError).toBe(true);
    expect(deletesOn(view.owner)).toHaveLength(1);
  });
  it('reports no mutation attempted when the first create is refused before its POST', async () => {
    fault = 'binding-before-create';
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      mutationAttempted: false,
      createNeverSent: [view.owner],
      pendingCreation: [],
      remaining: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
    });
    expect(refusals('POST', '/sap/bc/adt/ddic/ddl/sources').map((row) => row.reason)).toEqual(['source-binding']);
    expect(state.get(view.owner)!.exists).toBe(false);
  });
  it.each(['create-503', 'create-409'])(
    'keeps a create sent to SAP uncertain after %s, without inferring absence from its error',
    async (issue) => {
      fault = issue;
      const result = await run();
      expect(result).toMatchObject({
        failure: true,
        mutationAttempted: true,
        pendingCreation: [role.owner],
        createNeverSent: [],
        cleanupUnconfirmed: true,
        finalAbsenceConfirmed: false,
      });
      expect(result.inspectionRequired).toEqual(expect.arrayContaining([role.owner, view.owner]));
      expect(unconfirmed(role.owner)[0].reason).toBe('write-unconfirmed');
      expect(deletesOn(view.owner)).toEqual([]);
      expect(deletesOn(abstract.owner)).toHaveLength(1);
    },
  );
  it.each(['unlock-fail', 'close-fail'])(
    'separates a confirmed deletion from its failed cleanup after %s, preserving the base',
    async (issue) => {
      fault = issue;
      const result = await run();
      expect(result.confirmedDeleted).toContain(service.owner);
      expect(result.remaining).toEqual([view.owner]);
      expect(result.cleanupIssues).toEqual([service.owner]);
      expect(result.inspectionRequired).toEqual(expect.arrayContaining([service.owner, view.owner]));
      expect(unconfirmed(service.owner)[0].reason).toBe('deleted-cleanup-unconfirmed');
      expect(deletesOn(view.owner)).toEqual([]);
      expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true, finalAbsenceConfirmed: false });
    },
  );
  it('does not report a deleted owner when the independent absence read is unavailable', async () => {
    fault = 'absence-unavailable';
    const result = await run();
    expect(deletesOn(service.owner)).toHaveLength(1);
    expect(result.confirmedDeleted).not.toContain(service.owner);
    expect(result.remaining).toContain(service.owner);
    expect(unconfirmed(service.owner)).toEqual([
      { phase: 'delete', owner: service.owner, stage: 'unconfirmed', reason: 'absence-not-typed', status: 503 },
    ]);
  });
});
