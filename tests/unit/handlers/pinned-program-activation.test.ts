import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  allowWrites: true,
  multiTargetEndpoints: true,
  targetId: 'A4H/001',
  ppEnabled: true,
  ppStrict: true,
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
let name = 'ZARC1_ACT';
let pool = '/sap/bc/adt/textelements/programs/zarc1_act';
let usedInclude = false;
let owner = '',
  type = 'PROG',
  posts = 0,
  fault = '';
usedInclude = false;
let expanded: string[] | undefined;
let cancel: AbortController | undefined;
const calls: { path: string; method: string; body: string }[] = [];
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
beforeEach(() => {
  unexpected.length = 0;
  vi.restoreAllMocks();
  vi.resetAllMocks();
  posts = 0;
  fault = '';
  expanded = undefined;
  cancel = undefined;
  calls.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({ path: path + uri.search, method, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    if (path === owner) {
      const root = type === 'PROG' ? 'program:abapProgram' : 'include:abapInclude';
      const nativeType = fault === 'owner-drift' && posts ? 'FUGR/I' : `PROG/${type === 'PROG' ? 'P' : 'I'}`;
      return mockResponse(
        200,
        `<${root} xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${nativeType}" program:programType="executableProgram" ${usedInclude ? 'include:contextRefCount="20"' : ''}><adtcore:packageRef xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${fault === 'package-drift' && posts ? 'ZOTHER' : '$TMP'}" adtcore:type="DEVC/K"/>${usedInclude ? '<include:contextRef adtcore:type="PROG/P" adtcore:name="ZCONSUMER" adtcore:uri="/sap/bc/adt/programs/programs/zconsumer" adtcore:packageName="ZOUTSIDE"/>' : ''}</${root}>`,
      );
    }
    if (path === pool) {
      if (fault === 'pool-unreadable' && posts > 1) return mockResponse(503, '');
      return mockResponse(
        200,
        `<text:textElement xmlns:text="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${fault === 'pool-owner' ? 'ZFOREIGN' : name}" adtcore:type="PROG/PX" adtcore:version="${posts > 1 && fault !== 'pool-inactive' ? 'active' : 'inactive'}"/>`,
      );
    }
    if (path === '/sap/bc/adt/activation') {
      posts++;
      if (fault === 'cancel') cancel!.abort();
      if (fault === 'network') return mockResponse(503, '');
      if (expanded && uri.searchParams.get('preauditRequested') === 'true')
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">${expanded.map((ref) => `<ioc:entry><ioc:object ioc:deleted="${fault === 'ref-deleted' ? 'true' : fault === 'ref-deleted-invalid' ? 'maybe' : 'false'}"><ioc:ref adtcore:uri="${ref}" adtcore:type="${fault === 'ref-type' ? 'FUGR/I' : ref.includes('/textelements/') ? 'PROG/PX' : type === 'PROG' ? 'PROG/P' : 'PROG/I'}" adtcore:name="${fault === 'ref-name' ? 'ZFOREIGN' : name}" ${fault === 'ref-collision' ? 'xmlns:other="urn:foreign" other:name="ZFOREIGN"' : ''}/></ioc:object></ioc:entry>`).join('')}</ioc:inactiveObjects>`,
        );
      if (fault === 'native-error')
        return mockResponse(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:msg severity="error" shortText="Native activation refused"/></chkl:messages>',
        );
      return mockResponse(
        200,
        `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="${fault === 'no-execution' ? 'false' : 'true'}"/></chkl:messages>`,
      );
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
async function activate(kind = 'PROG', refs?: (owner: string) => string[], selectedName = 'ZARC1_ACT') {
  type = kind;
  name = selectedName;
  const segment = encodeURIComponent(name.toLowerCase()).toLowerCase();
  pool = `/sap/bc/adt/textelements/programs/${segment}`;
  owner = `/sap/bc/adt/programs/${kind === 'PROG' ? 'programs' : 'includes'}/${segment}`;
  expanded = refs?.(owner);
  const client = new AdtClient({
    baseUrl: 'http://sap:8000',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  const result = await handleToolCall(client, config, 'SAPActivate', { type, name });
  return { result, payload: JSON.parse(result.content[0].text) };
}
it.each(['PROG', 'INCL'])('activates the selected standalone %s through the native engine', async (kind) => {
  const { result, payload } = await activate(kind, (uri) => [uri]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.success).toBe(true);
  expect(posts).toBe(2);
  const submissions = calls.filter((call) => call.path.startsWith('/sap/bc/adt/activation?'));
  expect(submissions[0]!.path).toContain('preauditRequested=true');
  expect(submissions[1]!.path).toContain('preauditRequested=false');
  expect(submissions.every((call) => call.body.includes(owner))).toBe(true);
});
it('confirms only the selected program pool and verifies its final native state', async () => {
  const { result, payload } = await activate('PROG', (uri) => [uri, pool]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.textPoolState).toBe('active');
  expect(posts).toBe(2);
  expect(calls.filter((call) => call.path.startsWith(pool))).toHaveLength(2);
  expect(calls.find((call) => call.path.includes('preauditRequested=false'))!.body).toContain(pool);
});
it.each(['foreign-program', 'foreign-pool', 'include-pool', 'duplicate', 'source-fragment'])(
  'refuses %s before native confirmation',
  async (mode) => {
    const { result, payload } = await activate(mode === 'include-pool' ? 'INCL' : 'PROG', (uri) =>
      mode === 'foreign-program'
        ? ['/sap/bc/adt/programs/programs/zforeign']
        : mode === 'foreign-pool'
          ? ['/sap/bc/adt/textelements/programs/zforeign']
          : mode === 'include-pool'
            ? [pool]
            : mode === 'duplicate'
              ? [uri, uri]
              : [`${uri}/source/main`],
    );
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: 'activation-not-confirmed',
      phase: 'activation',
      message: expect.stringContaining('unqualified reference'),
    });
    expect(posts).toBe(1);
  },
);
it.each(['owner-drift', 'package-drift', 'pool-owner'])('rechecks %s before confirmation', async (failure) => {
  fault = failure;
  const { result, payload } = await activate('PROG', (uri) => [uri, pool]);
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'activation' });
  expect(payload.message).toMatch(
    failure === 'owner-drift' ? /standalone native/ : failure === 'package-drift' ? /package/i : /text-pool state/,
  );
  expect(posts).toBe(1);
});
it.each(['pool-inactive', 'pool-unreadable'])(
  'preserves uncertainty after native activation when %s',
  async (failure) => {
    fault = failure;
    const { result, payload } = await activate('PROG', (uri) => [uri, pool]);
    expect(result.isError).toBe(true);
    expect(posts).toBe(2);
    expect(payload).toMatchObject({
      state: 'activation-not-confirmed',
      phase: 'text-pool-verification',
      retryable: false,
    });
    expect(payload.warnings).toContain('SAP reported activation');
  },
);
it.each(['no-execution', 'network'])('does not infer success or retry after %s', async (failure) => {
  fault = failure;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'activation', retryable: false });
  expect(payload.statusCode).toBe(failure === 'network' ? 503 : undefined);
  if (failure === 'no-execution') expect(payload.message).toContain('did not affirm activation');
  expect(posts).toBe(1);
});
it('cancels between preaudit and confirmation without replay', async () => {
  fault = 'cancel';
  cancel = new AbortController();
  const { result } = await requestContext.run({ requestId: 'program-activation', signal: cancel.signal }, () =>
    activate('PROG', (uri) => [uri]),
  );
  expect(result.isError).toBe(true);
  expect(posts).toBe(1);
});

it.each(['PROG', 'INCL'])('accepts either encoded slash hex spelling for a namespaced %s', async (kind) => {
  for (const hex of ['%2f', '%2F']) {
    const { result, payload } = await activate(kind, (uri) => [uri.replace(/%2f/gi, hex)], '/NS/ZARC1_ACT');
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload.state).toBe('activated');
  }
});
it.each(['%2f', '%2F'])('confirms namespaced uppercase pool identity with %s separators', async (hex) => {
  const upperPool = `/sap/bc/adt/textelements/programs/${encodeURIComponent('/NS/ZARC1_ACT').replace(/%2F/g, hex)}`;
  const { result, payload } = await activate('PROG', (uri) => [uri, upperPool], '/NS/ZARC1_ACT');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    state: 'activated',
    textPoolState: 'active',
    scope: 'selected-program-with-native-owned-text-pool-expansion',
  });
  expect(calls.find((call) => call.path.includes('preauditRequested=false'))!.body).toContain(upperPool);
});
it('accepts only the owned pool when native preaudit returns a pool-only prompt', async () => {
  const { result, payload } = await activate('PROG', () => [pool]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.textPoolState).toBe('active');
  expect(calls.find((call) => call.path.includes('preauditRequested=false'))!.body).toContain(pool);
  expect(calls.find((call) => call.path.includes('preauditRequested=false'))!.body).not.toContain(owner);
});
it.each(['three-refs', 'hex-duplicate', 'encoded-name'])('refuses %s without confirmation', async (mode) => {
  const { result, payload } = await activate(
    'PROG',
    (uri) =>
      mode === 'three-refs'
        ? [uri, pool, pool.toUpperCase()]
        : mode === 'hex-duplicate'
          ? [uri, uri.replace(/%2f/g, '%2F')]
          : [uri.replace('zarc', '%7aarc')],
    '/NS/ZARC1_ACT',
  );
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    state: 'activation-not-confirmed',
    phase: 'activation',
    error: 'PINNED_WRITE_INCOMPLETE',
  });
  expect(payload.message).toContain('unqualified reference');
  expect(posts).toBe(1);
});
it.each(['ref-name', 'ref-type', 'ref-deleted', 'ref-deleted-invalid', 'ref-collision'])(
  'validates native preaudit identity metadata: %s',
  async (failure) => {
    fault = failure;
    const { result, payload } = await activate('PROG', (uri) => [uri, pool]);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'activation' });
    expect(payload.message).toMatch(failure === 'ref-collision' ? /Ambiguous.*identity/ : /unqualified reference/);
    expect(posts).toBe(1);
  },
);
it('reports an unactivated pool draft when owner-only activation succeeds', async () => {
  const { result, payload } = await activate();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'activated', scope: 'selected-program-only', textPoolState: 'inactive' });
  expect(payload.warnings).toContain('did not activate that pool');
  expect(calls.filter((call) => call.path.startsWith(pool))).toHaveLength(1);
});
it('keeps an explicit uncertain state and reads the pool after a native error result', async () => {
  fault = 'native-error';
  const { result, payload } = await activate('PROG', (uri) => [uri, pool]);
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    success: false,
    state: 'activation-not-confirmed',
    textPoolState: 'active',
    retryable: false,
  });
  expect(payload.messages).toContain('Native activation refused');
  expect(posts).toBe(2);
  expect(calls.filter((call) => call.path.startsWith(pool))).toHaveLength(2);
});
it('reports native include consumers without activating or authorizing them', async () => {
  usedInclude = true;
  const { result, payload } = await activate('INCL', (uri) => [uri]);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.includeUsage).toEqual({
    contextRefCount: 20,
    contexts: [{ uri: '/sap/bc/adt/programs/programs/zconsumer', name: 'ZCONSUMER', packageName: 'ZOUTSIDE' }],
  });
  expect(payload.warnings).toContain('consumers may be affected');
  expect(calls.some((call) => call.path.includes('/zconsumer') || call.body.includes('zconsumer'))).toBe(false);
});
