/** Candidate native profile tests; public capability admission is added only with the complete family. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { createPinnedFunctionContext } = await import('../../../src/handlers/write/pinned-function-context.js');
const { pinnedSourceState, forgetPinnedSourceContext } = await import(
  '../../../src/handlers/write/pinned-source-context.js'
);
const { writeActionUpdate } = await import('../../../src/handlers/write/update-delete.js');
const { writeActionUnit } = await import('../../../src/handlers/write/unit-surgery.js');
const root = '/sap/bc/adt/functions/groups/zgroup';
const sources = {
  FUGR: 'INCLUDE lzgrouptop.\nINCLUDE lzgroupuxx.\n',
  FUNC: "FUNCTION zfunction.\n  WRITE 'preserve body'.\nENDFUNCTION.\n",
  INCL: "FORM selected.\n WRITE 'old'.\nENDFORM.\nFORM neighbor.\nENDFORM.\n",
};
let kind: keyof typeof sources = 'FUNC',
  stored = sources.FUNC,
  locked = false,
  fault = '',
  transported = false;
const requests: { method: string; path: string; locked: boolean; body: string }[] = [];
const unexpected: string[] = [];
const resource = () =>
  kind === 'FUGR' ? root : `${root}/${kind === 'FUNC' ? 'fmodules/zfunction' : 'includes/lzgroupf01'}`;
const names = { FUGR: 'ZGROUP', FUNC: 'ZFUNCTION', INCL: 'LZGROUPF01' };
const config = {
  ...DEFAULT_CONFIG,
  lintBeforeWrite: false,
  systemType: 'onprem' as const,
  allowWrites: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  requests.length = 0;
  unexpected.length = 0;
  kind = 'FUNC';
  stored = sources.FUNC;
  locked = false;
  fault = '';
  transported = false;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const parsed = new URL(String(url)),
      path = parsed.pathname,
      method = init.method ?? 'GET';
    requests.push({ method, path: path + parsed.search, locked, body: String(init.body ?? '') });
    const pkg = fault === 'package' && locked ? 'ZDENIED' : transported ? 'ZTEAM' : '$TMP';
    const core = 'http://www.sap.com/adt/core';
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (parsed.searchParams.get('_action') === 'LOCK') {
      if (path !== resource()) unexpected.push(`Wrong lock owner: ${path}`);
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>function-lock</LOCK_HANDLE><CORRNR>${transported ? (fault === 'lock-cts' ? 'A4HK900099' : 'A4HK900002') : ''}</CORRNR><IS_LOCAL>${transported ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=function-session; Path=/' },
      );
    }
    if (parsed.searchParams.get('_action') === 'UNLOCK') {
      if (path !== resource()) unexpected.push(`Wrong unlock owner: ${path}`);
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(200, '');
    if (path === root && method === 'GET')
      return mockResponse(
        200,
        `<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:a="${core}" a:name="ZGROUP" a:type="FUGR/F"><a:packageRef a:name="${pkg}" a:type="DEVC/K"/></group:abapFunctionGroup>`,
      );
    if (path === resource() && method === 'GET') {
      const module = kind === 'FUNC',
        tag = module ? 'abapFunctionModule' : 'abapFunctionGroupInclude';
      return mockResponse(
        200,
        `<f:${tag} xmlns:f="http://www.sap.com/adt/functions/${module ? 'fmodules' : 'fincludes'}" xmlns:a="${core}" a:name="${names[kind]}" a:type="${module ? 'FUGR/FF' : 'FUGR/I'}"><a:containerRef a:name="${fault === 'container' && locked ? 'ZOTHER' : 'ZGROUP'}" a:type="FUGR/F" a:uri="${root}" a:packageName="${pkg}"/></f:${tag}>`,
      );
    }
    if (path.endsWith('/source/main')) {
      if (path !== `${resource()}/source/main` || !locked) unexpected.push(`Wrong/unlocked source: ${path}`);
      if (method === 'PUT') {
        if (fault === 'save') return mockResponse(503, 'Unavailable');
        stored = String(init.body);
        return mockResponse(200, '');
      }
      return mockResponse(200, fault === 'hash' ? `${stored}* changed\n` : stored);
    }
    if (path.includes('/transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${transported ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${transported ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('/transportrequests/'))
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${path.endsWith('900099') ? 'A4HK900099' : 'A4HK900001'}" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>`,
      );
    unexpected.push(`${method} ${path}`);
    return mockResponse(500, 'Unexpected request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
async function update(type: keyof typeof sources, extra: Record<string, unknown> = {}) {
  kind = type;
  stored = sources[type];
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    username: 'test',
    password: 'test',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
  const args = {
    action: 'update',
    type,
    name: names[type],
    ...(type === 'FUGR' ? {} : { group: 'ZGROUP' }),
    source: `${stored}* appended\n`,
    expectedSourceHash: sourceHash(stored),
    ...(transported ? { transport: 'A4HK900002' } : {}),
    ...extra,
  };
  const ctx = await createPinnedFunctionContext(client, args, config, context);
  try {
    const result = args.action === 'update' ? await writeActionUpdate(ctx) : await writeActionUnit(ctx);
    return { result, state: { ...pinnedSourceState(ctx) }, cleanup: context.cleanup };
  } finally {
    forgetPinnedSourceContext(ctx);
  }
}
it.each(['FUNC', 'INCL'] as const)(
  'updates %s through the shared handler and exact native resource lock',
  async (type) => {
    const { result, state, cleanup } = await update(type);
    expect(result.isError).toBeFalsy();
    expect(state.state).toBe('saved-inactive');
    expect(state.sourceHash).toBe(sourceHash(stored));
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(requests.some((r) => r.path.split('?')[0] === root && r.locked)).toBe(true);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it('refuses unqualified FUGR main-source replacement before SAP', async () => {
  await expect(update('FUGR')).rejects.toThrow('Function-group main source is maintained by SAP');
  expect(requests).toHaveLength(0);
});
it('preserves the function body when replacing its structured signature under the lock', async () => {
  const { result } = await update('FUNC', {
    source: undefined,
    parameters: [{ kind: 'importing', name: 'IV_NUMBER', type: 'I' }],
  });
  expect(result.isError).toBeFalsy();
  expect(stored).toContain('IV_NUMBER TYPE I');
  expect(stored).toContain("WRITE 'preserve body'.");
});
it('uses the shared FORM surgery without changing its neighbor', async () => {
  const { result } = await update('INCL', {
    action: 'edit_unit',
    unit: 'selected',
    source: "FORM selected.\n WRITE 'new'.\nENDFORM.",
  });
  expect(result.isError).toBeFalsy();
  expect(stored).toContain("WRITE 'new'.");
  expect(stored).toContain('FORM neighbor.\nENDFORM.');
});
it.each(['package', 'container', 'hash', 'lock-cts'])(
  'refuses %s drift before source submission and releases its lock',
  async (selected) => {
    fault = selected;
    transported = selected === 'lock-cts';
    await expect(update('FUNC')).rejects.toThrow(
      selected === 'hash'
        ? /expectedSourceHash/
        : selected === 'container'
          ? /verified parent group/
          : selected === 'package'
            ? /package/i
            : /transport|recording/i,
    );
    expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
it('uses the allowed parent request for an explicitly selected modifiable CTS task', async () => {
  transported = true;
  const { state } = await update('INCL');
  expect(state.recording?.request).toBe('A4HK900001');
  expect(requests.find((r) => r.method === 'PUT')?.path).toContain('corrNr=A4HK900001');
});
it.each(['ZGROUP', undefined])('refuses missing source hashes before SAP access (group=%s)', async (group) => {
  await expect(update('FUNC', { expectedSourceHash: undefined, group })).rejects.toThrow('expectedSourceHash');
  expect(requests).toEqual([]);
});
