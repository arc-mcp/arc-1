import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import fixture from '../../fixtures/declarative-owners/native-metadata.json';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { createPinnedDeclarativeContext } = await import('../../../src/handlers/write/pinned-declarative-context.js');
const { executePinnedSourceWrite } = await import('../../../src/handlers/write/pinned-source-write.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
let row = fixture.observations[0]!,
  stored = '',
  locked = false,
  fault = '',
  transported = false,
  deleted = false;
let abort: AbortController | undefined;
const calls: { path: string; method: string; locked: boolean; body: string }[] = [];
const unexpected: string[] = [];
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  ppEnabled: true,
  ppStrict: true,
  allowWrites: true,
  systemType: 'onprem' as const,
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  allowedPackages: ['$TMP', 'Z_RAP_VB_BC26', 'ZTEAM'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP', 'Z_RAP_VB_BC26', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
const original = '// original source\n';
const replacement = '// changed source\n';
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  vi.resetAllMocks();
  row = fixture.observations[0]!;
  stored = original;
  locked = false;
  fault = '';
  transported = false;
  deleted = false;
  abort = undefined;
  calls.length = 0;
  unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname,
      method = init.method ?? 'GET';
    calls.push({ path: path + uri.search, method, locked, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (uri.searchParams.get('_action') === 'LOCK') {
      expect(path).toBe(row.path);
      locked = true;
      if (fault === 'cancel') abort!.abort();
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>native-lock</LOCK_HANDLE><CORRNR>${transported ? 'A4HK900002' : ''}</CORRNR><IS_LOCAL>${transported ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=owned; Path=/' },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      expect(path).toBe(row.path);
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(200, '');
    const pkg =
      fault === 'denied-package'
        ? 'ZDENIED'
        : locked && fault === 'package-drift'
          ? 'ZTEAM'
          : transported
            ? 'ZTEAM'
            : row.packageName;
    if (path === row.path.replace(/\/[^/]+$/, '') && method === 'POST') {
      if (fault === 'create-unknown') return mockResponse(503, 'unavailable');
      stored = '// native generated skeleton\n';
      return mockResponse(201, row.metadataXml);
    }
    if (path === row.path && method === 'DELETE') {
      expect(locked).toBe(true);
      if (fault === 'delete-unknown') return mockResponse(503, 'unavailable');
      deleted = true;
      return mockResponse(200, '');
    }
    if (path === row.path && method === 'GET') {
      if (deleted)
        return mockResponse(
          404,
          fault === 'ambiguous-absence'
            ? 'not found'
            : '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>',
        );
      let body = row.metadataXml.replaceAll(row.packageName, pkg);
      if ((locked && fault === 'identity') || (!locked && fault === 'preflight-identity'))
        body = body.replace(`adtcore:name="${row.name}"`, 'adtcore:name="ZOTHER"');
      return mockResponse(200, body);
    }
    if (!locked && fault === 'post-hint' && path.toLowerCase() === `${row.path}/source/main`)
      return mockResponse(503, 'optional hint unavailable');
    if (path === `${row.path}/source/main`) {
      if (!locked && fault === 'post-hint') return mockResponse(503, 'optional hint unavailable');
      expect(locked).toBe(true);
      if (method === 'PUT') {
        if (fault === 'save') return mockResponse(503, 'unavailable');
        stored = String(init.body);
        if (fault === 'readback') stored += 'unexpected';
        return mockResponse(200, '');
      }
      return mockResponse(200, stored, { 'content-type': 'text/plain' });
    }
    if (path.includes('/transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${transported ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION>${String(init.body).includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${transported ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('/transportrequests/'))
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${fault === 'cts' ? 'A4HK900099' : 'A4HK900001'}" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>`,
      );
    if (path === '/sap/bc/adt/repository/informationsystem/usageReferences')
      return mockResponse(
        200,
        '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"/>',
      );
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
afterEach(() => {
  expect(unexpected).toEqual([]);
  resetCachedFeatures();
});
function client() {
  return new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
  });
}
async function run(extra: Record<string, unknown> = {}, overrides: Partial<ServerConfig> = {}) {
  const native = client(),
    context = pinnedMutationContext(
      native.safety,
      { deadline: Date.now() + 30_000, signal: abort?.signal },
      { unlockFailed: false },
    );
  const args = {
    action: 'update',
    type: row.type,
    name: row.name,
    source: replacement,
    expectedSourceHash: sourceHash(original),
    ...(transported ? { transport: 'A4HK900002' } : {}),
    ...extra,
  };
  const ctx = createPinnedDeclarativeContext(native, args, { ...config, ...overrides }, context);
  const result = await executePinnedSourceWrite(ctx);
  return { result, payload: JSON.parse(result.content[0].text), cleanup: context.cleanup };
}
it.each(fixture.observations)('updates $type through the shared source and owning-lock lifecycle', async (selected) => {
  row = selected;
  const { result, payload, cleanup } = await run();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ type: row.type, state: 'saved-inactive', sourceHash: sourceHash(replacement) });
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(calls.filter((c) => c.path.split('?')[0] === row.path && c.method === 'GET').map((c) => c.locked)).toEqual([
    false,
    true,
  ]);
  expect(calls.some((c) => c.path.includes('/activation'))).toBe(false);
});
it('resolves and records an independently allowed task under its parent request', async () => {
  transported = true;
  const { result, payload } = await run();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.transport).toBe('A4HK900001');
  expect(calls.find((c) => c.method === 'PUT')?.path).toContain('corrNr=A4HK900001');
});
it.each(['identity', 'package-drift', 'cts', 'cancel'])(
  'refuses %s before PUT and cleans an acquired lock',
  async (issue) => {
    fault = issue;
    if (issue === 'cts') transported = true;
    if (issue === 'cancel') abort = new AbortController();
    const { result, payload, cleanup } = await run();
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    if (calls.some((c) => c.path.includes('_action=LOCK')))
      expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it('rejects a stale editable-source hash under the lock', async () => {
  const { result, payload, cleanup } = await run({ expectedSourceHash: 'a'.repeat(64) });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(cleanup.sessionClosed).toBe(true);
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
});
it.each(['save', 'readback', 'unlock'])('preserves uncertainty and never repeats the save after %s', async (issue) => {
  fault = issue;
  const { result, payload } = await run();
  expect(result.isError).toBe(true);
  expect(payload.retryable).toBe(false);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(payload.state).toBe(issue === 'unlock' ? 'saved-inactive' : 'source-save-unknown');
});
it.each([
  { action: 'create' },
  { action: 'delete' },
  { include: 'main' },
  { group: 'ZGROUP' },
  { check: false },
  { expectedSourceHash: undefined },
  { transport: '' },
  { source: '' },
])('refuses unsupported private input before HTTP: %j', async (extra) => {
  await expect(run(extra)).rejects.toThrow();
  expect(calls).toEqual([]);
});
it.each(fixture.observations)(
  'requires verified public authorization for $type writes and activation',
  async (selected) => {
    row = selected;
    for (const action of ['create', 'update', 'delete', 'activate']) {
      const result = await handleToolCall(client(), config, action === 'activate' ? 'SAPActivate' : 'SAPWrite', {
        type: row.type,
        name: row.name,
        action,
        ...(action === 'update' ? { source: replacement, expectedSourceHash: sourceHash(original) } : {}),
        ...(action === 'create' ? { package: row.packageName, source: replacement } : {}),
      });
      expect(result.isError).toBe(true);
    }
    expect(calls).toEqual([]);
  },
);

it.each(fixture.observations)('creates $type then saves through the same native source profile', async (selected) => {
  row = selected;
  const { result, payload, cleanup } = await run({
    action: 'create',
    package: row.packageName,
    expectedSourceHash: undefined,
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(replacement) });
  expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  const creation = calls.filter(
    (c) => c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, '') && c.method === 'POST',
  );
  expect(creation).toHaveLength(1);
  expect(creation[0]!.body).toContain(`adtcore:type="${row.nativeType}"`);
  expect(creation[0]!.body).not.toContain('adtcore:responsible=');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(calls.some((c) => c.path.includes('/activation'))).toBe(false);
});
it.each(fixture.observations)('verifies generated $type source after metadata-only creation', async (selected) => {
  row = selected;
  const { result, payload } = await run({
    action: 'create',
    package: row.packageName,
    source: undefined,
    expectedSourceHash: undefined,
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.state).toBe('created');
  expect(payload.sourceHash).toBe(sourceHash('// native generated skeleton\n'));
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it.each(fixture.observations)(
  'deletes the exact $type owner with typed absence and owning cleanup',
  async (selected) => {
    row = selected;
    const { result, payload, cleanup } = await run({
      action: 'delete',
      source: undefined,
      expectedSourceHash: undefined,
    });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload.state).toBe('deleted');
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')[0]!.path.split('?')[0]).toBe(row.path);
  },
);
it('does not retry or follow an uncertain create with a source write', async () => {
  fault = 'create-unknown';
  const { result, payload } = await run({ action: 'create', package: row.packageName, expectedSourceHash: undefined });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('creation-unknown');
  expect(
    calls.filter((c) => c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, '') && c.method === 'POST'),
  ).toHaveLength(1);
  expect(calls.some((c) => c.path.includes('_action=LOCK') || c.method === 'PUT')).toBe(false);
});
it.each(['delete-unknown', 'ambiguous-absence'])('retains deletion uncertainty after %s', async (issue) => {
  fault = issue;
  const { result, payload, cleanup } = await run({
    action: 'delete',
    source: undefined,
    expectedSourceHash: undefined,
  });
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('delete-unconfirmed');
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(cleanup.sessionClosed).toBe(true);
});

it('rejects inconsistent update identity before acquiring a lock', async () => {
  fault = 'preflight-identity';
  const { result, payload } = await run();
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(calls.some((c) => c.path.includes('_action=LOCK') || c.method === 'PUT')).toBe(false);
});
it.each(['preflight-identity', 'identity', 'denied-package', 'package-drift', 'cts', 'cancel'])(
  'refuses declarative deletion after %s without sending DELETE',
  async (issue) => {
    fault = issue;
    transported = issue === 'cts';
    if (issue === 'cancel') abort = new AbortController();
    const { result, cleanup } = await run({ action: 'delete', source: undefined, expectedSourceHash: undefined });
    expect(result.isError).toBe(true);
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    if (calls.some((c) => c.path.includes('_action=LOCK')))
      expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    else expect(calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(false);
  },
);
it.each(fixture.observations)(
  'records $type deletion in the independently allowed parent request',
  async (selected) => {
    row = selected;
    transported = true;
    const { result, cleanup } = await run({ action: 'delete', source: undefined, expectedSourceHash: undefined });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'DELETE')!.path).toContain('corrNr=A4HK900001');
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  },
);
it.each([
  { package: undefined },
  { package: '' },
  { source: 123 },
  { description: 123 },
  { source: '\n' },
  { source: '\t' },
  { source: '   ' },
])('validates create-only input directly before HTTP: %j', async (extra) => {
  await expect(
    run({ action: 'create', package: row.packageName, expectedSourceHash: undefined, ...extra }),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});
it('does not perform discarded where-used hint work after a confirmed pinned DDLS save', async () => {
  const { result } = await run();
  expect(result.isError).toBeUndefined();
  expect(calls.filter((c) => c.path.includes('usageReferences'))).toEqual([]);
});
it('creates a native BDEF extension without a fallible discarded post-save hint', async () => {
  row = fixture.observations.find((r) => r.type === 'BDEF')!;
  fault = 'post-hint';
  const source = 'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}';
  const { result, payload } = await run({
    action: 'create',
    package: row.packageName,
    expectedSourceHash: undefined,
    source,
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload.state).toBe('saved-inactive');
  const creation = calls.find((c) => c.method === 'POST' && c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, ''))!;
  expect(creation.body).toContain('base_bdef');
  expect(creation.body).toContain('ZR_BASE');
  expect(calls.filter((c) => c.method === 'GET' && !c.locked && c.path.includes('/source/main'))).toEqual([]);
});
it.each(['create', 'update'])('retains configured DDLS lint refusal for %s', async (action) => {
  const { result, payload } = await run(
    {
      action,
      source: 'this is not valid CDS',
      ...(action === 'create' ? { package: row.packageName, expectedSourceHash: undefined } : {}),
    },
    { lintBeforeWrite: true },
  );
  expect(result.isError).toBe(true);
  expect(payload.message).toContain('Pre-write lint check failed');
  expect(
    calls.some(
      (c) => c.method === 'PUT' || (c.method === 'POST' && c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, '')),
    ),
  ).toBe(false);
});
it.each(['create', 'update'])('retains deterministic RAP refusal for %s', async (action) => {
  row = fixture.observations.find((r) => r.type === 'BDEF')!;
  const { result, payload } = await run({
    action,
    source:
      'managed implementation in class zbp_i_travel unique;\ndefine behavior for ZI_Travel alias Travel\nauthorization master ( none )\n{\n}',
    ...(action === 'create' ? { package: row.packageName, expectedSourceHash: undefined } : {}),
  });
  expect(result.isError).toBe(true);
  expect(payload.message).toContain('RAP preflight validation failed');
  expect(
    calls.some(
      (c) => c.method === 'PUT' || (c.method === 'POST' && c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, '')),
    ),
  ).toBe(false);
});
it.each(['create', 'update'])('retains release-dependent CDS refusal for %s', async (action) => {
  setCachedFeatures({ ...featuresOff(), systemType: 'onprem', abapRelease: '756' });
  const { result, payload } = await run({
    action,
    source: 'define table entity ZTEST { key id : abap.char(1); }',
    ...(action === 'create' ? { package: row.packageName, expectedSourceHash: undefined } : {}),
  });
  expect(result.isError).toBe(true);
  expect(payload.message).toContain('syntax requires ABAP Cloud');
  expect(
    calls.some(
      (c) => c.method === 'PUT' || (c.method === 'POST' && c.path.split('?')[0] === row.path.replace(/\/[^/]+$/, '')),
    ),
  ).toBe(false);
});

it.each(fixture.observations)(
  'dispatches authorized public $type updates through the shared real HTTP lifecycle',
  async (selected) => {
    row = selected;
    const result = await handleToolCall(
      client(),
      { ...config, multiTargetAuthorization: 'xsuaa-attribute' },
      'SAPWrite',
      {
        action: 'update',
        type: row.type,
        name: row.name,
        source: replacement,
        expectedSourceHash: sourceHash(original),
      },
      pinnedPublicAuth(),
      undefined,
      undefined,
      true,
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(JSON.parse(result.content[0].text).state).toBe('saved-inactive');
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(calls.some((call) => call.path.includes('_action=UNLOCK'))).toBe(true);
    expect(stored).toBe(replacement);
  },
);
