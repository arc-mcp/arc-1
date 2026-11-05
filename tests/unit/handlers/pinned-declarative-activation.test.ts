import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { type PinnedDeclarativeType, pinnedDeclarativeSelection } from '../../../src/adt/pinned-repository-owner.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handlePrivatePinnedDeclarativeActivation: privateActivate, handlePinnedActivation } = await import(
  '../../../src/handlers/write/pinned-activation.js'
);
const kinds: PinnedDeclarativeType[] = ['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'];
let selected = pinnedDeclarativeSelection('DDLS', 'ZARC1_DECL');
let recorded = false;
let posts = 0,
  complete = false,
  fault = '',
  confirm = true;
let expanded: { uri: string; name?: string; type?: string; deleted?: string }[] | undefined;
let cancel: AbortController | undefined;
const calls: { path: string; method: string; body: string }[] = [];
const unexpected: string[] = [];
const canonical = (value: string) => value.replace(/%2f/gi, '%2F');
const core = 'http://www.sap.com/adt/core';
const source = 'define view entity ZARC1_DECL as select from source { key field }';
function metadata(activeRead: boolean) {
  const phaseFault = complete || (posts && ['package-drift', 'metadata-drift', 'owner-drift'].includes(fault));
  const version =
    (complete || ['already-active', 'active-with-draft'].includes(fault)) &&
    !(fault === 'default-inactive' && !activeRead) &&
    !(fault === 'active-inactive' && activeRead)
      ? 'active'
      : 'inactive';
  const pkg =
    (phaseFault && fault === 'package-drift') || (complete && activeRead && fault === 'active-package')
      ? 'ZALLOWED'
      : recorded
        ? 'ZTEAM'
        : '$TMP';
  const name =
    (phaseFault && fault === 'owner-drift') || (complete && activeRead && fault === 'active-owner')
      ? 'ZFOREIGN'
      : selected.name;
  let alt =
    complete && ((fault === 'default-alternative' && !activeRead) || (fault === 'active-alternative' && activeRead))
      ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}/source/main?version=inactive"/>`
      : '';
  if (!complete && fault === 'active-with-draft')
    alt = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}/source/main?version=inactive"/>`;
  if (!complete && fault === 'inactive-with-active-alternative')
    alt = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}/source/main?version=active"/>`;
  if (fault === 'foreign-alternative')
    alt = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="/sap/bc/adt/ddic/ddl/sources/zforeign/source/main?version=inactive"/>`;
  if (fault === 'duplicate-alternative')
    alt = ['inactive', 'active']
      .map(
        (version) =>
          `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}/source/main?version=${version}"/>`,
      )
      .join('');
  if ((!complete && fault === 'relative-owned') || (complete && fault === 'relative-inactive-after'))
    alt = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${selected.objectUrl.slice(selected.objectUrl.lastIndexOf('/') + 1)}?version=${complete ? 'inactive' : 'active'}"/>`;
  if (fault.startsWith('invalid-relative:')) {
    const leaf = selected.objectUrl.split('/').at(-1)!;
    const alternatives: Record<string, string> = {
      foreign: './foreign?version=active',
      traversal: `../${leaf}?version=active`,
      query: `./${leaf}?version=active&x=1`,
      version: `./${leaf}`,
      encoded: `./%7a${leaf.slice(1)}?version=active`,
    };
    const href = alternatives[fault.split(':')[1]!];
    alt = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${href!.replaceAll('&', '&amp;')}"/>`;
  }
  return `<native:${selected.root} xmlns:native="${selected.namespace}" xmlns:adtcore="${core}" adtcore:name="${name}" adtcore:type="${selected.native}" ${fault === 'missing-version' ? '' : `adtcore:version="${fault === 'unknown-version' ? 'unknown' : version}"`} adtcore:description="${phaseFault && fault === 'metadata-drift' ? 'changed' : complete && fault === 'derived-description' ? 'derived from source' : 'baseline'}"><adtcore:packageRef adtcore:name="${pkg}" adtcore:type="DEVC/K"/>${alt}</native:${selected.root}>`;
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  posts = 0;
  recorded = false;
  complete = false;
  fault = '';
  confirm = true;
  expanded = undefined;
  cancel = undefined;
  calls.length = 0;
  unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = canonical(uri.pathname),
      method = init.method ?? 'GET';
    calls.push({ path: path + uri.search, method, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path.includes('transportchecks')) {
      expect(String(init.body)).toContain(`<URI>${selected.objectUrl}</URI>`);
      const request =
        fault === 'foreign-recording' ||
        (posts && ['recording-disallowed', 'recording-between-allowed'].includes(fault))
          ? 'A4HK900099'
          : 'A4HK900001';
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${recorded ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${recorded ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>${fault === 'cts-refusal' ? 'E' : 'S'}</RESULT><RECORDING>${recorded ? 'X' : ''}</RECORDING>${recorded ? `<LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>${request}</TRKORR></REQ_HEADER></LOCK_HOLDER></CTS_OBJECT_LOCK></LOCKS>` : ''}</DATA>`,
      );
    }
    if (path.includes('/transportrequests/')) {
      const request = path.slice(path.lastIndexOf('/') + 1);
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${request}" tm:type="K" tm:status="D"/></tm:root>`,
      );
    }
    if (path === selected.objectUrl) {
      if (fault === 'metadata-budget') return mockResponse(200, 'x'.repeat(1024 * 1024 + 1));
      if (complete && fault === 'metadata-network') return mockResponse(503, 'PRIVATE_NATIVE_METADATA');
      return mockResponse(200, metadata(uri.searchParams.get('version') === 'active'));
    }
    if (path === `${selected.objectUrl}/source/main`) {
      const active = uri.searchParams.get('version') === 'active';
      if (fault.startsWith('source-budget') || (active && fault === 'active-source-budget'))
        return mockResponse(fault.endsWith('error') ? 503 : 200, 'x'.repeat(1024 * 1024 + 1), {
          'content-type': 'text/plain',
        });
      return mockResponse(
        200,
        (posts && fault === 'source-drift') || (active && fault === 'active-source') ? `${source}\n// changed` : source,
        {
          'content-type':
            fault === 'source-mime' || (active && fault === 'active-source-mime')
              ? 'text/plain-unsupported'
              : 'text/plain; charset=utf-8',
        },
      );
    }
    if (path === '/sap/bc/adt/activation') {
      posts++;
      if (fault === 'network') return mockResponse(503, 'PRIVATE_NATIVE_ACTIVATION');
      if (fault === 'cancel') cancel!.abort();
      if (confirm && posts === 1) {
        const refs = expanded ?? [{ uri: selected.objectUrl, name: selected.name, type: selected.native }];
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}">${refs.map((ref) => `<ioc:entry><ioc:object ioc:deleted="${ref.deleted ?? 'false'}"><ioc:ref adtcore:uri="${ref.uri}"${ref.name === undefined ? '' : ` adtcore:name="${ref.name}"`}${ref.type === undefined ? '' : ` adtcore:type="${ref.type}"`}/></ioc:object></ioc:entry>`).join('')}</ioc:inactiveObjects>`,
        );
      }
      if (fault === 'native-error')
        return mockResponse(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:msg severity="error" shortText="PRIVATE_NATIVE_ACTIVATION"/></chkl:messages>',
        );
      complete = true;
      return mockResponse(
        200,
        `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="${fault === 'generation-only' ? 'false' : 'true'}"${fault === 'generation-only' ? ' generationExecuted="true"' : ''}/></chkl:messages>`,
      );
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
async function run(
  kind: PinnedDeclarativeType = 'DDLS',
  options: {
    name?: string;
    args?: Record<string, unknown>;
    minimal?: boolean;
    public?: boolean;
    writes?: boolean;
    enabled?: boolean;
    server?: string[];
    destination?: string[];
    serverTransports?: string[];
    destinationTransports?: string[];
  } = {},
) {
  selected = pinnedDeclarativeSelection(kind, options.name ?? 'ZARC1_DECL');
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: options.writes ?? true,
      allowedPackages: options.server ?? ['$TMP', 'ZALLOWED', 'ZTEAM'],
      multiTargetWrite: {
        enabled: options.enabled ?? true,
        target: 'A4H/001',
        allowedPackages: options.destination ?? ['$TMP', 'ZALLOWED', 'ZTEAM'],
        allowedTransports: options.destinationTransports ?? (recorded ? ['A4HK900001'] : []),
        serverAllowedTransports: options.serverTransports ?? (recorded ? ['A4HK900001'] : []),
      },
    },
  });
  const result = await (options.public ? handlePinnedActivation : privateActivate)(
    client,
    { type: kind, name: selected.name, ...options.args },
    options.minimal,
  );
  return { result, payload: JSON.parse(result.content[0].text) };
}
it.each(kinds)('verifies %s active owner and source through shared activation', async (kind) => {
  const { result, payload } = await run(kind);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    success: true,
    state: 'activated',
    activeSourceVerified: true,
    nativeStateVerified: true,
    previousNativeVersion: 'inactive',
    scope: 'selected-declarative-source-owner-only',
    retryable: false,
  });
  expect(posts).toBe(2);
  expect(
    calls.filter((c) => c.path.startsWith('/sap/bc/adt/activation')).every((c) => c.body.includes(selected.objectUrl)),
  ).toBe(true);
  expect(calls.filter((c) => c.path.includes('transportchecks'))).toHaveLength(2);
  expect(calls.filter((c) => c.path.startsWith(`${selected.objectUrl}?version=active`))).toHaveLength(1);
  expect(calls.filter((c) => c.path.includes('_action=LOCK') || c.path.includes('_action=UNLOCK'))).toEqual([]);
});
it.each(kinds)('uses the same reviewed activation core for public %s selection', async (kind) => {
  expect((await run(kind, { public: true })).result.isError).toBeUndefined();
  expect(
    calls.filter(
      (call) => call.path.startsWith('/sap/bc/adt/activation') && !call.path.includes('preauditRequested=true'),
    ),
  ).toHaveLength(1);
});
it.each([
  { type: 'CLAS' },
  { type: 'FUNC', group: 'ZGROUP' },
  { group: 'ZGROUP' },
  { objects: [] },
  { source: source },
  { transport: 'R1' },
  { include: 'source' },
  { preaudit: false },
  { preaudit: 'true' },
  { preaudit: null },
  { action: 'publish_srvb' },
])('rejects unsupported private activation input before HTTP: %j', async (args) => {
  expect((await run('DDLS', { args })).result.isError).toBe(true);
  expect(calls).toEqual([]);
});
it.each([{ writes: false }, { enabled: false }])('retains the write ceiling: %j', async (options) => {
  expect((await run('DDLS', options)).result.isError).toBe(true);
  expect(calls).toEqual([]);
});
it.each([{ server: ['ZDENIED'] }, { destination: ['ZDENIED'] }])(
  'retains independent package policy: %j',
  async (options) => {
    expect((await run('DDLS', options)).result.isError).toBe(true);
    expect(posts).toBe(0);
  },
);
it.each(['foreign', 'fragment', 'query', 'absolute', 'duplicate', 'name', 'type', 'deleted'])(
  'refuses %s references before confirmation',
  async (mode) => {
    selected = pinnedDeclarativeSelection('DDLS', 'ZARC1_DECL');
    expanded = [
      {
        uri:
          mode === 'foreign'
            ? `${selected.objectUrl}other`
            : mode === 'fragment'
              ? `${selected.objectUrl}/source/main`
              : mode === 'query'
                ? `${selected.objectUrl}?x=1`
                : mode === 'absolute'
                  ? `https://sap.example${selected.objectUrl}`
                  : selected.objectUrl,
        name: mode === 'name' ? 'ZFOREIGN' : selected.name,
        type: mode === 'type' ? 'DCLS/DL' : selected.native,
        deleted: mode === 'deleted' ? 'true' : 'false',
      },
    ];
    if (mode === 'duplicate') expanded.push(expanded[0]!);
    const { result, payload } = await run();
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('activation-not-confirmed');
    expect(posts).toBe(1);
  },
);
it.each(['source-drift', 'metadata-drift', 'owner-drift', 'package-drift'])(
  'refuses %s before confirmation',
  async (mode) => {
    fault = mode;
    const { result, payload } = await run();
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('activation-not-confirmed');
    expect(posts).toBe(1);
  },
);
it.each(['cts-refusal', 'source-mime', 'metadata-budget', 'source-budget-success', 'source-budget-error'])(
  'refuses %s before any activation POST',
  async (mode) => {
    fault = mode;
    const reserve = vi.spyOn(DataResponseBudget.prototype, 'reserve');
    const { result, payload } = await run();
    expect(result.isError).toBe(true);
    if (mode.includes('budget')) {
      expect(
        reserve.mock.results.some((row) => row.type === 'throw' && row.value instanceof AdtResponseLimitError),
      ).toBe(true);
      expect(result.content[0].text).not.toContain('Cannot verify');
      expect(payload.statusCode).toBeUndefined();
    }
    expect(posts).toBe(0);
  },
);
it.each([
  'default-inactive',
  'active-inactive',
  'default-alternative',
  'active-alternative',
  'active-source',
  'active-source-budget',
  'active-source-mime',
  'active-owner',
  'active-package',
  'metadata-network',
])('preserves native success with unconfirmed %s evidence', async (mode) => {
  fault = mode;
  const reserve = vi.spyOn(DataResponseBudget.prototype, 'reserve');
  const { result, payload } = await run();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    state: 'activation-not-confirmed',
    phase: 'declarative-active-verification',
    nativeActivation: { success: true },
    retryable: false,
  });
  expect(payload.warnings).toContain('before the later verification failed');
  if (mode === 'active-source-budget') {
    expect(reserve.mock.results.some((row) => row.type === 'throw' && row.value instanceof AdtResponseLimitError)).toBe(
      true,
    );
    expect(result.content[0].text).not.toContain('differs from');
  }
  expect(posts).toBe(2);
  if (mode.startsWith('active-'))
    expect(calls.some((c) => c.path.startsWith(`${selected.objectUrl}?version=active`))).toBe(true);
});
it('permits metadata derived from activated source without claiming exact metadata equality', async () => {
  fault = 'derived-description';
  expect((await run()).result.isError).toBeUndefined();
  expect(posts).toBe(2);
});
it('accepts direct native activation and namespaced identifiers', async () => {
  confirm = false;
  expect((await run('BDEF', { name: '/ARC1/ZBEHAVIOR' })).result.isError).toBeUndefined();
  expect(posts).toBe(1);
});
it('accepts lowercase namespace escapes only for the same reference', async () => {
  selected = pinnedDeclarativeSelection('DDLX', '/ARC1/ZMETADATA');
  expanded = [{ uri: selected.objectUrl.replace(/%2F/g, '%2f'), name: selected.name, type: selected.native }];
  expect((await run('DDLX', { name: selected.name })).result.isError).toBeUndefined();
  expect(posts).toBe(2);
});
it.each(['network', 'native-error', 'generation-only'])('does not report success or retry %s', async (mode) => {
  fault = mode;
  const { result, payload } = await run('SRVD', { minimal: true });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(mode === 'network' ? 1 : 2);
  expect(result.content[0].text).not.toContain('PRIVATE_NATIVE_');
});
it('stops after preaudit when the caller cancels', async () => {
  fault = 'cancel';
  cancel = new AbortController();
  const { result } = await requestContext.run({ requestId: 'declarative-cancel', signal: cancel.signal }, () => run());
  expect(result.isError).toBe(true);
  expect(posts).toBe(1);
});

it.each(kinds)('validates the recorded %s owner at both activation phases', async (kind) => {
  recorded = true;
  expect((await run(kind)).result.isError).toBeUndefined();
  expect(posts).toBe(2);
  expect(calls.filter((c) => c.path.includes('transportrequests/A4HK900001'))).toHaveLength(2);
});
it.each(['foreign-recording', 'recording-disallowed'])('refuses %s without additional submission', async (mode) => {
  recorded = true;
  fault = mode;
  expect((await run()).result.isError).toBe(true);
  expect(posts).toBe(mode === 'recording-disallowed' ? 1 : 0);
});
it.each([{ serverTransports: ['A4HK900099'] }, { destinationTransports: [] }])(
  'retains independent recording policy: %j',
  async (options) => {
    recorded = true;
    expect((await run('DDLS', options)).result.isError).toBe(true);
    expect(posts).toBe(0);
  },
);

it('keeps an unset server request restriction subordinate to the mandatory destination request policy', async () => {
  recorded = true;
  expect((await run('DCLS', { serverTransports: [] })).result.isError).toBeUndefined();
  expect(posts).toBe(2);
});
it('redacts post-activation diagnostics while preserving the confirmed native result and failed phase', async () => {
  fault = 'metadata-network';
  const { result, payload } = await run('DDLX', { minimal: true });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).not.toContain('PRIVATE_NATIVE_');
  expect(payload).toMatchObject({
    state: 'activation-not-confirmed',
    phase: 'declarative-active-verification',
    nativeActivation: { success: true },
  });
  expect(posts).toBe(2);
});

it.each(kinds)('labels %s with no captured draft already active', async (kind) => {
  fault = 'already-active';
  const { result, payload } = await run(kind);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    state: 'already-active',
    previousNativeVersion: 'active',
    activeSourceVerified: true,
    nativeStateVerified: true,
  });
});
it.each(kinds)('verifies %s draft over the existing active owner', async (kind) => {
  fault = 'active-with-draft';
  const { result, payload } = await run(kind);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'activated', previousNativeVersion: 'active', activeSourceVerified: true });
  expect(posts).toBe(2);
});
it.each(['missing-version', 'unknown-version', 'foreign-alternative', 'duplicate-alternative'])(
  'refuses invalid captured state %s before native activation',
  async (mode) => {
    fault = mode;
    expect((await run()).result.isError).toBe(true);
    expect(posts).toBe(0);
  },
);
it('refuses changing to another allowed recording request before confirmation', async () => {
  recorded = true;
  fault = 'recording-between-allowed';
  const { result } = await run('DDLS', {
    serverTransports: ['A4HK900001', 'A4HK900099'],
    destinationTransports: ['A4HK900001', 'A4HK900099'],
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('recording context changed');
  expect(posts).toBe(1);
});

it.each(kinds)('accepts %s saved-draft metadata with its active alternative', async (kind) => {
  fault = 'inactive-with-active-alternative';
  const { result, payload } = await run(kind);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'activated', previousNativeVersion: 'inactive', activeSourceVerified: true });
  expect(posts).toBe(2);
});

it.each(kinds)(
  'accepts the exact owned relative %s alternative before activation (synthetic family control)',
  async (kind) => {
    fault = 'relative-owned';
    const { result, payload } = await run(kind);
    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({ success: true, activeSourceVerified: true, nativeStateVerified: true });
    expect(posts).toBe(2);
  },
);
it.each(kinds)('does not confirm %s activation with an exact relative inactive counterpart', async (kind) => {
  fault = 'relative-inactive-after';
  const { result, payload } = await run(kind);
  expect(result.isError).toBe(true);
  expect(payload.success).not.toBe(true);
  expect(payload.nativeStateVerified).not.toBe(true);
  expect(posts).toBe(2);
});

it.each(
  kinds.flatMap((kind) =>
    ['foreign', 'traversal', 'query', 'version', 'encoded'].map((variant) => [kind, variant] as const),
  ),
)('refuses %s %s relative alternatives before any activation POST', async (kind, variant) => {
  fault = `invalid-relative:${variant}`;
  const { result } = await run(kind);
  expect(result.isError).toBe(true);
  expect(posts).toBe(0);
});
