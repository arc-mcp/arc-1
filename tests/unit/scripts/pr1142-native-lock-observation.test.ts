/** Real HTTP/session lifecycle against an authored backend; no native SAP calls. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { observeNativeFunctionLock } = await import('../../../scripts/qualification/pr1142/native-lock-observation.js');
const { contractSelection, contractFunctionMetadataHash } = await import(
  '../../../scripts/qualification/pr1142/native-contract-transport.js'
);
const selected = contractSelection('0123456789ABCDEF');
const marker = 'ARC1 native contract 0123456789ABCDEF';
const core = 'http://www.sap.com/adt/core';
const group = `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F" c:description="${marker}" c:createdBy="MARIAN"><c:packageRef c:name="$TMP"/></g:abapFunctionGroup>`;
const module = `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:c="${core}" c:name="${selected.module}" c:type="FUGR/FF" c:description="${marker}" c:changedBy="MARIAN" c:version="active"><c:containerRef c:name="${selected.group}" c:type="FUGR/F" c:uri="${selected.groupUrl}" c:packageName="$TMP"/></f:abapFunctionModule>`;
const source = `FUNCTION ${selected.module.toLowerCase()}.\nENDFUNCTION.\n`;
const receipt = { hash: sourceHash(source), metadataHash: contractFunctionMetadataHash(module, selected) };
const calls: { method: string; path: string }[] = [];
const rows: unknown[] = [];
let fault = '';
let locked = false;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  calls.length = rows.length = 0;
  fault = '';
  locked = false;
  mockFetch.mockImplementation(async (url, init: RequestInit = {}) => {
    const uri = new URL(String(url));
    const method = init.method ?? 'GET';
    calls.push({ method, path: uri.pathname + uri.search });
    const response = (body: string, media = 'application/xml') => mockResponse(200, body, { 'content-type': media });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
    if (uri.pathname === '/sap/bc/adt/core/http/sessions') {
      if (fault === 'close-failure') return mockResponse(503, 'Close not confirmed');
      return response('');
    }
    if (uri.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(
        200,
        fault === 'missing-handle'
          ? '<DATA/>'
          : `<DATA><LOCK_HANDLE>PRIVATE_TEST_LOCK</LOCK_HANDLE><IS_LOCAL>${fault === 'nonlocal' ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=private-fixture-session; Path=/' },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK')
      return fault === 'unlock-failure' ? mockResponse(503, 'Unlock failed') : response('');
    if (uri.pathname === '/sap/bc/adt/cts/transportchecks')
      return response(
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    if (method !== 'GET') throw new Error(`Unexpected operation ${method}`);
    if (locked && fault === 'read-failure') return mockResponse(500, 'Read failed');
    if (uri.pathname === selected.groupUrl && locked && fault === 'context-change')
      return mockResponse(200, group, {
        'content-type': 'application/xml',
        'set-cookie': 'sap-contextid=changed-private-context; Path=/',
      });
    if (uri.pathname === selected.groupUrl)
      return response(fault === 'foreign-owner' ? group.replace('MARIAN', 'FOREIGN') : group);
    if (uri.pathname === selected.moduleUrl)
      return response(fault === 'inactive' ? module.replace('c:version="active"', 'c:version="inactive"') : module);
    if (uri.pathname === `${selected.moduleUrl}/source/main`)
      return response(
        fault === 'source-drift' ? `${source}changed` : source,
        fault === 'source-media' ? 'text/html' : 'text/plain',
      );
    throw new Error(`Unexpected read ${uri.pathname}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
function run(
  observe: Parameters<typeof observeNativeFunctionLock>[0]['observe'] = async () => 'present',
  signal = new AbortController().signal,
  timeoutMs = 240_000,
) {
  const client = new AdtClient({
    baseUrl: 'https://a4h.marianzeis.de',
    client: '001',
    username: 'MARIAN',
    password: 'fake',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      allowedPackages: ['$TMP'],
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  return observeNativeFunctionLock({
    client,
    selection: selected,
    marker,
    receipt,
    observe,
    record: (value) => rows.push(value),
    verifySource: () => {},
    signal,
    timeoutMs,
  });
}
const actions = (action: string) =>
  calls.filter((call) => new URL(call.path, 'https://test.invalid').searchParams.get('_action') === action);
it('uses one LOCK, observes all nine requests, and closes without a resource DELETE', async () => {
  const result = await run();
  expect(result).toMatchObject({ state: 'observed', cleanupConfirmed: true });
  expect(result.observations.map((row) => row.step)).toEqual([
    'locked',
    'group-default',
    'module-default',
    'recording-check',
    'group-active',
    'module-active',
    'source-active',
    'group-inactive',
    'module-inactive',
    'source-inactive',
  ]);
  expect(actions('LOCK')).toHaveLength(1);
  expect(actions('UNLOCK')).toHaveLength(1);
  expect(calls.filter((call) => ['PUT', 'DELETE'].includes(call.method))).toEqual([]);
  expect(
    calls.filter((call) => new URL(call.path, 'https://test.invalid').pathname === '/sap/bc/adt/core/http/sessions'),
  ).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('PRIVATE_TEST_LOCK');
  expect(JSON.stringify(result)).not.toContain('private-fixture-session');
});
it.each(['absent', 'changed', 'unknown'] as const)('stops at the first passive %s observation', async (observation) => {
  const result = await run(async (prompt) => (prompt.step === 'group-default' ? observation : 'present'));
  expect(result).toMatchObject({ state: 'stopped', phase: 'group-default', cleanupConfirmed: true });
  expect(result.observations).toHaveLength(2);
  expect(actions('LOCK')).toHaveLength(1);
  expect(actions('UNLOCK')).toHaveLength(1);
  expect(calls.filter((call) => call.path === selected.moduleUrl)).toHaveLength(0);
});
it.each(['foreign-owner', 'inactive', 'source-drift', 'source-media'])(
  'refuses an unqualified fixture before LOCK: %s',
  async (scenario) => {
    fault = scenario;
    expect(await run()).toMatchObject({ state: 'failed', lockAttempted: false, cleanupConfirmed: true });
    expect(actions('LOCK')).toHaveLength(0);
  },
);
it.each(['nonlocal', 'missing-handle', 'read-failure', 'unlock-failure', 'close-failure'])(
  'preserves explicit failure and cleanup state: %s',
  async (scenario) => {
    fault = scenario;
    const result = await run();
    if (['nonlocal', 'missing-handle', 'read-failure'].includes(scenario)) expect(result.state).toBe('failed');
    expect(result.cleanupConfirmed).toBe(!['missing-handle', 'unlock-failure', 'close-failure'].includes(scenario));
    expect(actions('LOCK')).toHaveLength(1);
    expect(actions('UNLOCK')).toHaveLength(scenario === 'missing-handle' ? 0 : 1);
    expect(calls.filter((call) => ['PUT', 'DELETE'].includes(call.method))).toEqual([]);
  },
);
it('cancels a stalled external observation and still uses bounded owning-session cleanup', async () => {
  const controller = new AbortController();
  const result = await run(async () => {
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  }, controller.signal);
  expect(result).toMatchObject({ state: 'failed', phase: 'locked', cleanupConfirmed: true });
  expect(actions('LOCK')).toHaveLength(1);
  expect(actions('UNLOCK')).toHaveLength(1);
});
it('applies the finite deadline while the external observation never settles', async () => {
  const result = await run(async () => new Promise(() => {}), new AbortController().signal, 40);
  expect(result).toMatchObject({ state: 'failed', phase: 'locked', cleanupConfirmed: true });
  expect(actions('UNLOCK')).toHaveLength(1);
});
it('does not acquire a lock after an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await run(undefined, controller.signal)).toMatchObject({ state: 'failed', lockAttempted: false });
  expect(calls).toHaveLength(0);
});
it('stops on an HTTP context change and never claims owning-context cleanup', async () => {
  fault = 'context-change';
  const result = await run();
  expect(result).toMatchObject({ state: 'stopped', phase: 'group-default', cleanupConfirmed: false });
  expect(result.observations).toHaveLength(1);
  expect(rows).toContainEqual(expect.objectContaining({ observationContext: 'group-default', sameAsLock: false }));
  expect(actions('LOCK')).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('changed-private-context');
});
