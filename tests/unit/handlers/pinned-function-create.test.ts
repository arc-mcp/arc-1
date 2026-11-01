/** Candidate function creation through the shared handler; still outside public capability admission. */
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
const { writeActionCreate } = await import('../../../src/handlers/write/create.js');
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  systemType: 'onprem' as const,
  allowWrites: true,
  lintBeforeWrite: false,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
const parent = '/sap/bc/adt/functions/groups/zfg';
const names = { FUGR: 'ZFG', FUNC: 'Z_FM', INCL: 'LZFGF01' };
const resources = { FUGR: parent, FUNC: `${parent}/fmodules/z_fm`, INCL: `${parent}/includes/lzfgf01` };
const templates = {
  FUGR: 'INCLUDE lzfgtop.\nINCLUDE lzfguxx.\n',
  FUNC: 'FUNCTION z_fm.\nENDFUNCTION.\n',
  INCL: '* generated include\n',
};
let type: keyof typeof names = 'FUNC',
  created = false,
  locked = false,
  source = '',
  metadata = '',
  fault = '',
  transported = false,
  parentReads = 0;
let lastState: ReturnType<typeof pinnedSourceState> | undefined;
const calls: { method: string; path: string; body: string; locked: boolean; headers: Headers }[] = [],
  unexpected: string[] = [];
const groupXml = (pkg: string) =>
  `<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZFG" adtcore:type="FUGR/F"><adtcore:packageRef adtcore:name="${pkg}" adtcore:type="DEVC/K"/></group:abapFunctionGroup>`;
const childXml = (pkg: string) =>
  `<${type === 'FUNC' ? 'fmodule:abapFunctionModule' : 'finclude:abapFunctionGroupInclude'} xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:finclude="http://www.sap.com/adt/functions/fincludes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${names[type]}" adtcore:type="${type === 'FUNC' ? 'FUGR/FF' : 'FUGR/I'}" fmodule:processingType="normal"><adtcore:containerRef adtcore:name="ZFG" adtcore:type="FUGR/F" adtcore:uri="${parent}" adtcore:packageName="${pkg}"/></${type === 'FUNC' ? 'fmodule:abapFunctionModule' : 'finclude:abapFunctionGroupInclude'}>`;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  created = locked = transported = false;
  fault = '';
  parentReads = 0;
  lastState = undefined;
  calls.length = unexpected.length = 0;
  mockFetch.mockImplementation(async (input, init: any = {}) => {
    const uri = new URL(String(input)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({
      method,
      path: path + uri.search,
      body: String(init.body ?? ''),
      locked,
      headers: new Headers(init.headers),
    });
    const pkg = transported ? 'ZTEAM' : '$TMP';
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path === '/sap/bc/adt/cts/transportchecks')
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${transported ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION>${String(init.body).includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${transported ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('/transportrequests/'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path === resources[type].replace(/\/[^/]+$/, '') && method === 'POST') {
      if (fault === 'create-uncertain') return mockResponse(503, 'Create response unavailable');
      created = true;
      return mockResponse(201, 'Created');
    }
    if (uri.searchParams.get('_action') === 'LOCK') {
      if (path !== resources[type]) unexpected.push('Wrong creation lock owner');
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>H</LOCK_HANDLE><IS_LOCAL>${transported ? '' : 'X'}</IS_LOCAL><CORRNR>${transported ? 'A4HK900002' : ''}</CORRNR></DATA>`,
        {},
        ['sap-contextid=created-owner; Path=/'],
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      locked = false;
      return mockResponse(fault === 'metadata-unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(fault === 'metadata-close' ? 503 : 200, '');
    if (path === parent && method === 'GET') {
      parentReads++;
      return mockResponse(200, groupXml(fault === 'parent-drift' && parentReads > 1 ? 'ZDENIED' : pkg));
    }
    if (path === resources[type] && method === 'GET')
      return mockResponse(200, metadata, {
        'content-type': 'application/vnd.sap.adt.functions.fmodules.v3+xml; charset=utf-8',
      });
    if (path === resources[type] && method === 'PUT') {
      if (!locked) unexpected.push('Unlocked processing metadata');
      if (fault !== 'processing-not-retained') metadata = String(init.body);
      return mockResponse(200, '');
    }
    if (type === 'INCL' && path === `${parent}/source/main` && method === 'GET')
      return mockResponse(
        200,
        fault === 'missing-membership'
          ? `* INCLUDE ${names.INCL}.\nWRITE 'INCLUDE ${names.INCL}.'.\n`
          : fault === 'ambiguous-membership'
            ? `INCLUDE ${names.INCL}.\nINCLUDE ${names.INCL}.\n`
            : `INCLUDE ${names.INCL}.\n`,
      );
    if (path === `${resources[type]}/source/main`) {
      if (!locked) unexpected.push('Unlocked created source');
      if (method === 'GET') return mockResponse(200, source);
      if (method === 'PUT') {
        source = String(init.body);
        return mockResponse(200, '');
      }
    }
    unexpected.push(`${method} ${path}${uri.search}`);
    return mockResponse(599, 'Unexpected fixture request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
async function create(kind: keyof typeof names, extra: Record<string, unknown> = {}) {
  type = kind;
  source = templates[type];
  metadata = childXml(transported ? 'ZTEAM' : '$TMP');
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    username: 'writer',
    password: 'fixture',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
  const ctx = await createPinnedFunctionContext(
    client,
    {
      action: 'create',
      type,
      name: names[type],
      ...(type === 'FUGR' ? { package: transported ? 'ZTEAM' : '$TMP' } : { group: 'ZFG' }),
      ...(transported ? { transport: 'A4HK900002' } : {}),
      ...extra,
    },
    config,
    context,
  );
  lastState = pinnedSourceState(ctx);
  try {
    return await writeActionCreate(ctx);
  } finally {
    forgetPinnedSourceContext(ctx);
  }
}
const saves = () => calls.filter((call) => call.method === 'PUT' && call.path.includes('/source/main'));
it.each(['FUGR', 'FUNC', 'INCL'] as const)(
  'verifies metadata-only %s creation without claiming an inactive save',
  async (kind) => {
    const result = await create(kind);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(lastState).toMatchObject({
      state: 'created',
      createdOwner: true,
      sourceHash: sourceHash(templates[kind]),
      writeAttempted: false,
    });
    expect(saves()).toHaveLength(0);
    expect(calls.filter((call) => call.path.includes('_action=LOCK'))).toHaveLength(1);
  },
);
it.each(['FUNC', 'INCL'] as const)('writes supplied %s source after native creation', async (kind) => {
  const requested = `${templates[kind]}* requested\n`;
  const result = await create(kind, { source: requested });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(lastState).toMatchObject({ state: 'saved-inactive', createdOwner: true, sourceHash: sourceHash(source) });
  expect(saves()).toHaveLength(1);
  expect(saves()[0].locked).toBe(true);
});
it('refuses supplied FUGR main source before creating the owner', async () => {
  await expect(create('FUGR', { source: templates.FUGR })).rejects.toThrow(
    'Function-group main source is maintained by SAP',
  );
  expect(calls).toHaveLength(0);
});
it('inherits the native group package and revalidates it immediately before POST', async () => {
  fault = 'parent-drift';
  await expect(create('FUNC')).rejects.toThrow(/package|allowed/i);
  expect(lastState).toMatchObject({ state: 'unchanged', phase: 'parent-revalidation' });
  expect(created).toBe(false);
});
it('refuses a claimed package that differs from the independently read native group', async () => {
  await expect(create('INCL', { package: 'ZTEAM' })).rejects.toThrow('inherits package');
  expect(created).toBe(false);
});
it('saves structured parameters through the existing function source preparation', async () => {
  const result = await create('FUNC', { parameters: [{ kind: 'importing', name: 'IV_INPUT', type: 'STRING' }] });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(source).toContain('IV_INPUT');
  expect(saves()).toHaveLength(1);
});
it('round-trips processing metadata under the child lock before saving source', async () => {
  await create('FUNC', { processingType: 'rfc', source: templates.FUNC });
  const metadataSave = calls.find((call) => call.method === 'PUT' && !call.path.includes('/source/main'))!;
  expect(metadataSave.locked).toBe(true);
  expect(metadataSave.headers.get('Content-Type')).toBe('application/vnd.sap.adt.functions.fmodules.v3+xml');
  expect(metadata).toContain('fmodule:processingType="rfc"');
  expect(
    calls
      .filter((call) => call.method === 'GET' && call.path.includes('version=inactive'))
      .every((call) => call.headers.get('Cache-Control') === 'no-cache'),
  ).toBe(true);
  expect(saves()).toHaveLength(1);
});
it.each(['metadata-close', 'metadata-unlock'])('does not start source work after %s fails', async (failure) => {
  fault = failure;
  await expect(create('FUNC', { processingType: 'rfc', source: templates.FUNC })).rejects.toThrow('cleanup');
  expect(lastState).toMatchObject({
    createdOwner: true,
    phase: failure === 'metadata-close' ? 'session-close' : 'unlock',
  });
  expect(saves()).toHaveLength(0);
  expect(calls.filter((call) => call.path.includes('/source/main'))).toHaveLength(0);
});
it('preserves partial creation when SAP does not retain processing metadata', async () => {
  fault = 'processing-not-retained';
  await expect(create('FUNC', { processingType: 'rfc' })).rejects.toThrow('retained processingType');
  expect(lastState).toMatchObject({
    createdOwner: true,
    state: 'created-processing-unknown',
    phase: 'processing-metadata-readback',
  });
  expect(saves()).toHaveLength(0);
});
it('uses the allowed parent transport for creation, metadata and source', async () => {
  transported = true;
  await create('FUNC', { processingType: 'rfc', source: templates.FUNC });
  expect(calls.filter((call) => call.method === 'PUT').every((call) => call.path.includes('corrNr=A4HK900001'))).toBe(
    true,
  );
  expect(lastState?.recording?.request).toBe('A4HK900001');
});

it.each(['missing-membership', 'ambiguous-membership'])(
  'retains a created child without saving source when %s',
  async (failure) => {
    fault = failure;
    await expect(create('INCL', { source: '* requested\n' })).rejects.toThrow('INCLUDE reference');
    expect(lastState).toMatchObject({
      createdOwner: true,
      state: 'created-source-not-confirmed',
      phase: 'include-membership-verification',
    });
    expect(saves()).toHaveLength(0);
  },
);
it('reports observed parent membership without writing the parent source', async () => {
  await create('INCL');
  expect(lastState?.functionGroup).toEqual({
    name: 'ZFG',
    sourceHash: sourceHash('INCLUDE LZFGF01.\n'),
    includeReferenced: true,
  });
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});
