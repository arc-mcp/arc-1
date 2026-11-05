import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handlePrivatePinnedFunctionActivation } from '../../../src/handlers/write/pinned-activation.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
let groupName: string, includeName: string, group: string, include: string;
let cancel: AbortController | undefined;
const source = 'FORM test.\nENDFORM.\n';
const core = 'http://www.sap.com/adt/core';
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  allowWrites: true,
  multiTargetEndpoints: true,
  ppEnabled: true,
  ppStrict: true,
  targetId: 'A4H/001',
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
let posts = 0,
  includeActivated = false,
  fault = '',
  withPrompt = false,
  recorded = false;
const calls: { path: string; method: string; body: string }[] = [];
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
beforeEach(() => {
  vi.resetAllMocks();
  posts = 0;
  includeActivated = false;
  groupName = 'ZARC1_FG';
  includeName = 'LZARC1_FGF01';
  group = '/sap/bc/adt/functions/groups/zarc1_fg';
  include = `${group}/includes/lzarc1_fgf01`;
  cancel = undefined;
  fault = '';
  withPrompt = false;
  recorded = false;
  calls.length = 0;
  unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname,
      method = init.method ?? 'GET';
    const active = uri.searchParams.get('version') === 'active';
    calls.push({ path: path + uri.search, method, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'fixture' });
    const nativePackage = recorded ? 'ZTEAM' : '$TMP';
    if (path.includes('transportchecks')) {
      const resource = String(init.body).match(/<URI>([^<]+)<\/URI>/)?.[1];
      expect([group, include]).toContain(resource);
      const request =
        resource === include && (fault === 'foreign-child-recording' || (posts && fault === 'recording-drift'))
          ? 'A4HK900099'
          : resource === include && posts && fault === 'unlocked-recording-drift'
            ? 'A4HK900003'
            : resource === group && fault === 'different-group-recording'
              ? 'A4HK900003'
              : 'A4HK900001';
      const localChild = resource === include && fault === 'local-child-recorded-group';
      const locks =
        !recorded ||
        localChild ||
        (resource === group && ['group-unlocked', 'unlocked-recording-drift'].includes(fault))
          ? ''
          : `<LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>${request}</TRKORR></REQ_HEADER></LOCK_HOLDER></CTS_OBJECT_LOCK></LOCKS>`;
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${nativePackage}</DEVCLASS><DLVUNIT>${recorded && !localChild ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${recorded && !localChild ? 'X' : ''}</RECORDING>${locks}</DATA>`,
      );
    }
    if (path.includes('/transportrequests/')) {
      const request = path.slice(path.lastIndexOf('/') + 1);
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${request}" tm:type="K" tm:status="D"/></tm:root>`,
      );
    }
    if (path === group)
      return mockResponse(
        200,
        `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:c="${core}" c:name="${groupName}" c:type="FUGR/F" c:version="${active && fault === 'group-version' ? 'inactive' : 'active'}"><c:packageRef c:name="${fault === 'package' || (posts && fault === 'package-drift') || (active && fault === 'active-package') ? 'ZOTHER' : nativePackage}" c:type="DEVC/K"/></g:abapFunctionGroup>`,
      );
    if (path === include)
      return mockResponse(
        200,
        `<i:abapFunctionGroupInclude xmlns:i="http://www.sap.com/adt/functions/fincludes" xmlns:c="${core}" c:description="${posts && fault === 'metadata-drift' ? 'changed' : 'original'}" c:name="${includeName}" c:type="${active && fault === 'include-type' ? 'FUGR/FF' : 'FUGR/I'}" c:version="${(['already-active', 'already-active-native', 'active-with-alternative'].includes(fault) || active || includeActivated) && fault !== 'include-version' ? 'active' : 'inactive'}"><c:containerRef c:name="${active && fault === 'include-owner' ? 'ZOTHER' : groupName}" c:type="FUGR/F" c:uri="${group}" c:packageName="${nativePackage}"/>${fault === 'active-with-alternative' && posts === 0 ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${include}/source/main?version=inactive"/>` : ''}</i:abapFunctionGroupInclude>`,
      );
    if (path === `${include}/source/main`) {
      if (active && ['readback', 'native-warning-readback'].includes(fault)) return mockResponse(503, 'unavailable');
      const changed = (posts && !active && fault === 'draft-drift') || (active && fault === 'active-source');
      return mockResponse(200, changed ? source.replace('test.', 'changed.') : source, {
        'content-type': fault === 'mime' ? 'text/plain-unsupported' : 'text/plain; charset=utf-8',
      });
    }
    if (path === '/sap/bc/adt/activation') {
      posts++;
      const selectedInclude = String(init.body).includes(`adtcore:uri="${include}"`);
      if (fault === 'cancel') cancel!.abort();
      if (fault === 'network') return mockResponse(503, 'unavailable');
      if (withPrompt && posts === 1)
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:c="${core}"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref c:uri="${selectedInclude && fault !== 'expanded' ? include : group}" c:name="${selectedInclude && fault !== 'expanded' ? includeName : groupName}" c:type="${selectedInclude && fault !== 'expanded' ? 'FUGR/I' : 'FUGR/F'}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
        );
      // Match the native stop: generating the group does not promote its include draft.
      includeActivated = selectedInclude;
      return mockResponse(
        200,
        `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="${(selectedInclude && !['no-execution', 'generation-only'].includes(fault)) || ['native-activation', 'already-active-native'].includes(fault) ? 'true' : 'false'}" generationExecuted="${fault === 'no-execution' ? 'false' : 'true'}"/>${fault === 'native-warning-readback' ? '<chkl:msg severity="warning" shortText="PRIVATE_GROUP_DIAGNOSTIC"/>' : ''}</chkl:messages>`,
      );
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
function client() {
  const recording = recorded
    ? {
        allowedPackages: ['ZTEAM'],
        multiTargetWrite: {
          ...config.multiTargetWrite,
          allowedPackages: ['ZTEAM'],
          allowedTransports: ['A4HK900001', 'A4HK900003'],
          serverAllowedTransports: ['A4HK900001', 'A4HK900003'],
        },
      }
    : {};
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config, ...recording },
  });
}
const args = (type: 'FUGR' | 'INCL') =>
  type === 'FUGR' ? { type, name: groupName } : { type, name: includeName, group: groupName };
async function run(type: 'FUGR' | 'INCL', minimalErrors = false) {
  const result = await handlePrivatePinnedFunctionActivation(client(), args(type), minimalErrors);
  return { result, payload: JSON.parse(result.content[0].text) };
}

it.each([false, true])('reports FUGR generation without claiming module activation, prompt=%s', async (prompt) => {
  withPrompt = prompt;
  const { result, payload } = await run('FUGR');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    success: true,
    state: 'generated',
    execution: 'generation',
    scope: 'selected-function-group-native-operation',
  });
  expect(payload.activeSourceVerified).toBeUndefined();
  expect(payload.warnings).toContain('Function-module draft activation is not verified');
  expect(posts).toBe(prompt ? 2 : 1);
});

it.each([false, true])(
  'activates the exact structural include with native active-source proof, prompt=%s',
  async (prompt) => {
    withPrompt = prompt;
    const { result, payload } = await run('INCL');
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload).toMatchObject({
      success: true,
      state: 'activated',
      activeSourceVerified: true,
      group: 'ZARC1_FG',
      scope: 'selected-group-include-only',
    });
    expect(payload.execution).toBeUndefined();
    const requests = calls.filter((call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/activation?'));
    expect(requests).toHaveLength(prompt ? 2 : 1);
    for (const request of requests) {
      expect(request.body).toContain(`adtcore:uri="${include}"`);
      expect(request.body).not.toContain(`adtcore:uri="${group}"`);
      expect(request.body).toContain(`adtcore:name="${includeName}"`);
    }
  },
);

it.each(['package', 'mime'])('refuses %s before generating anything', async (issue) => {
  fault = issue;
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('unchanged');
  expect(posts).toBe(0);
});

it.each(['expanded', 'draft-drift', 'package-drift'])('stops %s before confirmation', async (issue) => {
  fault = issue;
  withPrompt = true;
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});

it.each(['include-version', 'include-type', 'include-owner', 'active-source', 'readback'])(
  'preserves native activation but refuses unconfirmed include state after %s',
  async (issue) => {
    fault = issue;
    const { result, payload } = await run('INCL');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: 'activation-not-confirmed',
      phase: 'function-active-verification',
      nativeActivation: { success: true },
    });
    expect(payload.activeSourceVerified).toBeUndefined();
    expect(payload.warnings).toContain('SAP reported activation');
    expect(posts).toBe(1);
  },
);

it.each(['group-version', 'active-package'])('refuses unconfirmed group identity after %s', async (issue) => {
  fault = issue;
  const { result, payload } = await run('FUGR');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(payload.nativeActivation.execution).toBe('generation');
  expect(posts).toBe(1);
});

it('does not infer generation from an empty execution result', async () => {
  fault = 'no-execution';
  const { result, payload } = await run('FUGR');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});

it.each(['no-execution', 'generation-only'])(
  'requires native include activation acknowledgement: %s',
  async (issue) => {
    fault = issue;
    const { result, payload } = await run('INCL');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'activation-not-confirmed', scope: 'selected-group-include-only' });
    expect(payload.activeSourceVerified).toBeUndefined();
    expect(posts).toBe(1);
  },
);

it.each(['FUGR', 'INCL'] as const)('keeps public %s activation closed for this private group profile', async (type) => {
  const result = await handleToolCall(client(), config, 'SAPActivate', args(type));
  expect(result.isError).toBe(true);
  expect(calls).toEqual([]);
});

it.each(['foreign-child-recording', 'different-group-recording'])(
  'checks both transport owners before any include POST: %s',
  async (issue) => {
    recorded = true;
    fault = issue;
    const { result, payload } = await run('INCL');
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(posts).toBe(0);
  },
);
it('uses the allowed child request for a group with no existing CTS lock', async () => {
  recorded = true;
  fault = 'group-unlocked';
  const { result } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(posts).toBe(1);
});
it('revalidates both exact recording URIs before confirmation', async () => {
  recorded = true;
  withPrompt = true;
  const { result } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(
    calls.filter((c) => c.path.includes('transportchecks')).map((c) => c.body.match(/<URI>([^<]+)<\/URI>/)?.[1]),
  ).toEqual([include, group, include, group]);
});
it('stops a changed child recording before the confirmation POST', async () => {
  recorded = true;
  withPrompt = true;
  fault = 'recording-drift';
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});

it('reports an already-active include without claiming a new activation', async () => {
  fault = 'already-active';
  const { result, payload } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    state: 'already-active',
    previousNativeVersion: 'active',
    activeSourceVerified: true,
    nativeMetadataVerified: true,
  });
});
it('relays a native group activation flag without claiming a verified state transition', async () => {
  fault = 'native-activation';
  const { result, payload } = await run('FUGR');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'native-operation-confirmed', execution: 'activation' });
  expect(payload.activeSourceVerified).toBeUndefined();
});
it.each(['network', 'readback'])('retains the selected include scope after a submitted %s failure', async (issue) => {
  fault = issue;
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    scope: 'selected-group-include-only',
    group: 'ZARC1_FG',
    state: 'activation-not-confirmed',
  });
  expect(payload.warnings).toContain('owning function group');
  expect(posts).toBe(1);
});
it('refuses group-include metadata drift before confirmation', async () => {
  withPrompt = true;
  fault = 'metadata-drift';
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});
it('preserves the selected include scope after cancellation before confirmation', async () => {
  withPrompt = true;
  fault = 'cancel';
  cancel = new AbortController();
  const { result, payload } = await requestContext.run({ requestId: 'group-cancel', signal: cancel.signal }, () =>
    run('INCL'),
  );
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(payload.warnings).toContain('owning function group');
  expect(posts).toBe(1);
});
it.each([true, false])('preserves group execution and scope while honoring minimal errors=%s', async (minimal) => {
  fault = 'native-warning-readback';
  const { result, payload } = await run('INCL', minimal);
  expect(result.isError).toBe(true);
  expect(result.content[0].text.includes('PRIVATE_GROUP_DIAGNOSTIC')).toBe(!minimal);
  expect(payload.nativeActivation).toMatchObject({ success: true });
  expect(payload.warnings).toContain('owning function group');
});
it('uses exact namespace-encoded group and include owners through confirmation', async () => {
  withPrompt = true;
  groupName = '/NS/ZGROUP';
  includeName = '/NS/LZGROUPF01';
  group = '/sap/bc/adt/functions/groups/%2Fns%2Fzgroup';
  include = `${group}/includes/%2Fns%2Flzgroupf01`;
  const { result, payload } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    group: groupName,
    name: includeName,
    previousNativeVersion: 'inactive',
    state: 'activated',
  });
  expect(posts).toBe(2);
  for (const call of calls.filter((c) => c.path.startsWith('/sap/bc/adt/activation')))
    expect(call.body).toContain(`adtcore:uri="${include}"`);
});

it('rejects local child evidence paired with a recorded group before submission', async () => {
  recorded = true;
  fault = 'local-child-recorded-group';
  const { result, payload } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(payload.message).toContain('matching native recording contexts');
  expect(posts).toBe(0);
  expect(
    calls.filter((c) => c.path.includes('transportchecks')).map((c) => c.body.match(/<URI>([^<]+)<\/URI>/)?.[1]),
  ).toEqual([include, group]);
});
it('does not claim an include transition when SAP acknowledged activation but the include was already active', async () => {
  fault = 'already-active-native';
  const { result, payload } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'already-active', previousNativeVersion: 'active' });
});
it('does not classify removal of a captured inactive alternative as already active', async () => {
  fault = 'active-with-alternative';
  const { result, payload } = await run('INCL');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({ state: 'activated', previousNativeVersion: 'active' });
});

it('refuses a child moving between allowed requests while its group remains unlocked', async () => {
  recorded = true;
  withPrompt = true;
  fault = 'unlocked-recording-drift';
  const { result } = await run('INCL');
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('recording context changed');
  expect(posts).toBe(1);
});
