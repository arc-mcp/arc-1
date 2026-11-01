import { beforeEach, expect, it, vi } from 'vitest';
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
const name = 'ZARC1_ACT';
const pool = '/sap/bc/adt/textelements/programs/zarc1_act';
let owner = '',
  type = 'PROG',
  posts = 0,
  fault = '';
let expanded: string[] | undefined;
let cancel: AbortController | undefined;
const calls: { path: string; method: string; body: string }[] = [];
beforeEach(() => {
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
      const root = type === 'PROG' ? 'abapProgram' : 'abapInclude';
      const nativeType = fault === 'owner-drift' && posts ? 'FUGR/I' : `PROG/${type === 'PROG' ? 'P' : 'I'}`;
      return mockResponse(
        200,
        `<${root} name="${name}" type="${nativeType}" programType="executableProgram"><adtcore:packageRef xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${fault === 'package-drift' && posts ? 'ZOTHER' : '$TMP'}" adtcore:type="DEVC/K"/></${root}>`,
      );
    }
    if (path === pool) {
      if (fault === 'pool-unreadable' && posts > 1) return mockResponse(503, '');
      return mockResponse(
        200,
        `<textElement name="${fault === 'pool-owner' ? 'ZFOREIGN' : name}" type="PROG/PX" version="${posts > 1 && fault !== 'pool-inactive' ? 'active' : 'inactive'}"/>`,
      );
    }
    if (path === '/sap/bc/adt/activation') {
      posts++;
      if (fault === 'cancel') cancel!.abort();
      if (fault === 'network') return mockResponse(503, '');
      if (expanded && uri.searchParams.get('preauditRequested') === 'true')
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">${expanded.map((ref) => `<ioc:entry><ioc:object><ioc:ref adtcore:uri="${ref}" adtcore:name="${name}"/></ioc:object></ioc:entry>`).join('')}</ioc:inactiveObjects>`,
        );
      return mockResponse(
        200,
        `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="${fault === 'no-execution' ? 'false' : 'true'}"/></chkl:messages>`,
      );
    }
    throw Error(`Unexpected ${method} ${path}`);
  });
});
async function activate(kind = 'PROG', refs?: (owner: string) => string[]) {
  type = kind;
  owner = `/sap/bc/adt/programs/${kind === 'PROG' ? 'programs' : 'includes'}/zarc1_act`;
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
});
it.each(['foreign-program', 'foreign-pool', 'include-pool', 'duplicate', 'source-fragment'])(
  'refuses %s before native confirmation',
  async (mode) => {
    const { result } = await activate(mode === 'include-pool' ? 'INCL' : 'PROG', (uri) =>
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
    expect(posts).toBe(1);
  },
);
it.each(['owner-drift', 'package-drift', 'pool-owner'])('rechecks %s before confirmation', async (failure) => {
  fault = failure;
  const { result } = await activate('PROG', (uri) => [uri, pool]);
  expect(result.isError).toBe(true);
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
  const { result } = await activate();
  expect(result.isError).toBe(true);
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
