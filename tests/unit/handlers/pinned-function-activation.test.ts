import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { readPinnedFunctionOwner } from '../../../src/adt/pinned-repository-owner.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  handlePinnedActivation,
  handlePrivatePinnedFunctionActivation,
} from '../../../src/handlers/write/pinned-activation.js';
import { selectPinnedFunctionActivation } from '../../../src/handlers/write/pinned-function-activation.js';
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
let groupName: string, moduleName: string, group: string, owner: string, source: string;
const core = 'http://www.sap.com/adt/core';
let fault = '',
  posts = 0,
  prompt = false;
let cancel: AbortController | undefined;
const calls: { path: string; method: string; body: string; version: string | null }[] = [];
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  fault = '';
  groupName = 'ZARC1_FG';
  moduleName = 'ZARC1_FN';
  group = '/sap/bc/adt/functions/groups/zarc1_fg';
  owner = `${group}/fmodules/zarc1_fn`;
  source = 'FUNCTION zarc1_fn.\nENDFUNCTION.\n';
  posts = 0;
  prompt = false;
  cancel = undefined;
  calls.length = 0;
  unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname,
      method = init.method ?? 'GET';
    calls.push({
      path: path + uri.search,
      method,
      body: String(init.body ?? ''),
      version: uri.searchParams.get('version'),
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path === '/sap/bc/adt/repository/informationsystem/search')
      return mockResponse(
        200,
        fault === 'oversize-lookup'
          ? 'x'.repeat(1024 * 1024 + 1)
          : `<adtcore:objectReferences xmlns:adtcore="${core}"><adtcore:objectReference adtcore:uri="${owner}" adtcore:type="FUGR/FF" adtcore:name="${moduleName}"/></adtcore:objectReferences>`,
      );
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    if (path === group)
      return mockResponse(
        fault === 'oversize-parent-error' ? 503 : 200,
        fault.startsWith('oversize-parent')
          ? 'x'.repeat(1024 * 1024 + 1)
          : `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:adtcore="${core}" adtcore:name="${groupName}" adtcore:type="FUGR/F"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="${fault === 'package' || (['package-drift', 'drift-between-allowed'].includes(fault) && posts) ? 'ZOTHER' : '$TMP'}"/></g:abapFunctionGroup>`,
      );
    if (path === owner) {
      if (fault === 'oversize-child') return mockResponse(200, 'x'.repeat(1024 * 1024 + 1));
      const active = uri.searchParams.get('version') === 'active';
      const finished = posts >= (prompt ? 2 : 1) && fault !== 'no-execution';
      const version =
        fault === 'already-active'
          ? 'active'
          : active
            ? fault === 'inactive-version'
              ? 'inactive'
              : 'active'
            : finished && fault !== 'metadata-draft-remains'
              ? 'active'
              : 'inactive';
      const description =
        (posts && (fault === 'metadata-change' || fault === 'draft-metadata-drift')) ||
        (active && fault === 'active-metadata-disagreement') ||
        (posts && !active && fault === 'default-metadata-disagreement')
          ? 'Different metadata'
          : 'Expected metadata';
      const alternative =
        finished &&
        (fault === 'inactive-alternative' ||
          (!active && fault === 'default-inactive-alternative') ||
          (active && fault === 'active-inactive-alternative'))
          ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${owner}/source/main?version=inactive"/>`
          : !finished && fault === 'namespaced-state-links'
            ? `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${owner.replaceAll('%2F', '%2f')}/source/main?version=active"/>`
            : '';
      return mockResponse(
        200,
        `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="${core}" adtcore:name="${active && fault === 'name-drift' ? 'ZOTHER' : moduleName}" adtcore:type="${active && fault === 'type-drift' ? 'PROG/P' : 'FUGR/FF'}" adtcore:description="${description}" ${active && fault === 'missing-version' ? '' : `adtcore:version="${version}"`}><adtcore:containerRef adtcore:uri="${active && fault === 'container-uri-drift' ? `${group}other` : fault === 'namespaced-state-links' ? group.replaceAll('%2F', '%2f') : group}" adtcore:type="${active && fault === 'container-type-drift' ? 'PROG/P' : 'FUGR/F'}" adtcore:name="${active && fault === 'owner-drift' ? 'ZOTHER' : groupName}" adtcore:packageName="${(posts && fault === 'drift-between-allowed') || (active && fault === 'container-package-drift') ? 'ZOTHER' : '$TMP'}"/>${active && fault === 'own-package-drift' ? '<adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="ZOTHER"/>' : ''}${alternative}</f:abapFunctionModule>`,
      );
    }
    if (path === `${owner}/source/main`) {
      const active = uri.searchParams.get('version') === 'active';
      if (active && ['readback-failed', 'native-warning-readback-failed'].includes(fault))
        return mockResponse(503, 'unavailable');
      const changed = (active && fault === 'active-source') || (!active && posts && fault === 'draft-drift');
      return mockResponse(
        200,
        fault === 'source-frame'
          ? 'not a native function source'
          : fault === 'oversize-source'
            ? source + ' '.repeat(1024 * 1024)
            : changed
              ? source.replace('ENDFUNCTION.', '  WRITE 1.\nENDFUNCTION.')
              : source,
        {
          'content-type':
            fault === 'source-mime'
              ? 'text/html'
              : fault === 'source-mime-prefix'
                ? 'text/plain-unsupported'
                : 'text/plain; charset=utf-8',
        },
      );
    }
    if (path === '/sap/bc/adt/activation') {
      posts++;
      if (fault === 'cancel') cancel!.abort();
      if (fault === 'network') return mockResponse(503, 'unavailable');
      if (prompt && posts === 1) {
        const ref =
          fault === 'foreign-reference' ? `${group}/fmodules/zother` : fault === 'parent-reference' ? group : owner;
        const entry = `<ioc:entry><ioc:object ioc:deleted="${fault === 'deleted-reference' ? 'true' : 'false'}"><ioc:ref adtcore:uri="${ref}" adtcore:type="${fault === 'wrong-type' ? 'PROG/P' : 'FUGR/FF'}" adtcore:name="${moduleName}"/></ioc:object></ioc:entry>`;
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}">${entry}${fault === 'duplicate-reference' ? entry : ''}</ioc:inactiveObjects>`,
        );
      }
      return mockResponse(
        200,
        `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="${['no-execution', 'native-rejection'].includes(fault) ? 'false' : 'true'}"/>${fault.startsWith('native-') ? '<chkl:msg severity="warning" shortText="NATIVE_FUNC_DIAGNOSTIC_SENTINEL"/>' : ''}</chkl:messages>`,
      );
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
function client() {
  return new AdtClient({ baseUrl: 'http://sap:8000', client: '001', safety: { ...defaultSafetyConfig(), ...config } });
}
async function activate(minimalErrors = false) {
  const result = await handlePrivatePinnedFunctionActivation(
    client(),
    {
      type: 'FUNC',
      name: moduleName,
      group: groupName,
    },
    minimalErrors,
  );
  return { result, payload: JSON.parse(result.content[0].text) };
}
it.each([false, true])('verifies native active FUNC source with preaudit prompt=%s', async (withPrompt) => {
  prompt = withPrompt;
  const { result, payload } = await activate();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(payload).toMatchObject({
    success: true,
    state: 'activated',
    group: 'ZARC1_FG',
    scope: 'selected-function-module-only',
    activeSourceVerified: true,
  });
  expect(posts).toBe(withPrompt ? 2 : 1);
  expect(calls.some((call) => call.path.split('?')[0] === owner && call.version === 'active')).toBe(true);
  expect(calls.some((call) => call.path.split('?')[0] === `${owner}/source/main` && call.version === 'active')).toBe(
    true,
  );
});
it.each([
  'foreign-reference',
  'parent-reference',
  'deleted-reference',
  'wrong-type',
  'duplicate-reference',
  'draft-drift',
  'package-drift',
])('refuses %s before confirmation', async (issue) => {
  fault = issue;
  prompt = true;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({ state: 'activation-not-confirmed', retryable: false });
  expect(posts).toBe(1);
  expect(calls.some((call) => call.path.includes('preauditRequested=false'))).toBe(false);
});
it.each([
  'inactive-version',
  'missing-version',
  'owner-drift',
  'name-drift',
  'type-drift',
  'container-uri-drift',
  'container-type-drift',
  'container-package-drift',
  'own-package-drift',
  'active-source',
  'readback-failed',
])('reports native success but unconfirmed FUNC readback after %s', async (issue) => {
  fault = issue;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    state: 'activation-not-confirmed',
    phase: 'function-active-verification',
    retryable: false,
  });
  expect(payload.warnings).toContain('SAP reported activation');
  expect(payload.activeSourceVerified).toBeUndefined();
  expect(posts).toBe(1);
});
it.each(['package', 'source-mime', 'source-mime-prefix', 'source-frame', 'oversize-source'])(
  'refuses %s before any activation request',
  async (issue) => {
    fault = issue;
    const { result, payload } = await activate();
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(posts).toBe(0);
  },
);
it.each(['network', 'no-execution'])('does not infer activation or replay after %s', async (issue) => {
  fault = issue;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
  expect(calls.some((call) => call.version === 'active')).toBe(false);
});
it('stops between preaudit and confirmation', async () => {
  fault = 'cancel';
  prompt = true;
  cancel = new AbortController();
  const { result, payload } = await requestContext.run(
    { requestId: 'function-activation', signal: cancel.signal },
    activate,
  );
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});
it('keeps public FUNC activation closed while its private profile is unqualified', async () => {
  const result = await handleToolCall(client(), config, 'SAPActivate', {
    type: 'FUNC',
    name: 'ZARC1_FN',
    group: 'ZARC1_FG',
  });
  expect(result.isError).toBe(true);
  expect(calls).toEqual([]);
});

it('resolves an omitted group before proving native ownership', async () => {
  const native = client();
  const result = await handlePrivatePinnedFunctionActivation(native, { type: 'FUNC', name: 'ZARC1_FN' });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(calls.some((call) => call.path.startsWith('/sap/bc/adt/repository/informationsystem/search?'))).toBe(true);
  expect(calls.some((call) => call.path.split('?')[0] === group)).toBe(true);
});

it.each([
  'metadata-draft-remains',
  'metadata-change',
  'active-metadata-disagreement',
  'default-metadata-disagreement',
  'inactive-alternative',
  'default-inactive-alternative',
  'active-inactive-alternative',
])('requires metadata proof even when source is unchanged: %s', async (issue) => {
  fault = issue;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload).toMatchObject({
    state: 'activation-not-confirmed',
    phase: 'function-active-verification',
    nativeActivation: { success: true },
  });
  expect(payload.activeSourceVerified).toBeUndefined();
  expect(posts).toBe(1);
});

it('requires metadata proof to stay unchanged before confirmation', async () => {
  fault = 'draft-metadata-drift';
  prompt = true;
  const { result, payload } = await activate();
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(posts).toBe(1);
});
it.each([
  { name: 'ZBAD?x=1', group: 'ZARC1_FG' },
  { name: 'ZARC1_FN', group: 'ZBAD/../' },
  { name: 'ZARC1_FN', group: null },
])('refuses malformed selection %j before any native lookup', async (selection) => {
  const native = client();
  const resolve = vi.spyOn(native, 'resolveFunctionGroup');
  const result = await handlePrivatePinnedFunctionActivation(native, { type: 'FUNC', ...selection });
  expect(result.isError).toBe(true);
  expect(calls).toEqual([]);
  expect(resolve).not.toHaveBeenCalled();
});

it('rejects public FUNC dispatch without relying on a forbidden group field', async () => {
  const result = await handleToolCall(client(), config, 'SAPActivate', { type: 'FUNC', name: 'ZARC1_FN' });
  expect(result.isError).toBe(true);
  expect(calls).toEqual([]);
});
it('cannot supply the private function grant in tool arguments', async () => {
  const result = await handlePinnedActivation(client(), { type: 'FUNC', name: 'ZARC1_FN', privateFunctionGrant: true });
  expect(result.isError).toBe(true);
  expect(calls).toEqual([]);
});
it('refuses a group selector on ordinary class activation before HTTP', async () => {
  const result = await handlePinnedActivation(client(), { type: 'CLAS', name: 'ZCLASS', group: 'ZARC1_FG' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('cannot select a function group');
  expect(calls).toEqual([]);
});
it('refuses drift between two independently allowed packages at the stability guard', async () => {
  fault = 'drift-between-allowed';
  prompt = true;
  const open = {
    ...config,
    allowedPackages: ['*'],
    multiTargetWrite: { ...config.multiTargetWrite, allowedPackages: ['*'] },
  };
  const native = new AdtClient({
    baseUrl: 'http://sap:8000',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...open },
  });
  const result = await handlePrivatePinnedFunctionActivation(native, {
    type: 'FUNC',
    name: 'ZARC1_FN',
    group: 'ZARC1_FG',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Owner package is unresolved or changed');
  expect(posts).toBe(1);
  expect(calls.filter((call) => call.path.includes('transportchecks'))).toHaveLength(1);
});
it.each(['oversize-parent', 'oversize-parent-error', 'oversize-child', 'oversize-lookup'])(
  'stops %s in the response stream, before native XML parsing',
  async (issue) => {
    fault = issue;
    const native = client();
    const bounded = mutationClient(
      native,
      pinnedMutationContext(native.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false }),
    );
    await expect(
      issue === 'oversize-lookup'
        ? selectPinnedFunctionActivation(bounded, 'ZARC1_FN', undefined)
        : readPinnedFunctionOwner(bounded, owner),
    ).rejects.toBeInstanceOf(AdtResponseLimitError);
    expect(posts).toBe(0);
  },
);

it.each([false, true])(
  'activates an exact namespaced module and its source frame with prompt=%s',
  async (withPrompt) => {
    prompt = withPrompt;
    fault = 'namespaced-state-links';
    groupName = '/ARC1/FG';
    moduleName = '/ARC1/FN';
    group = '/sap/bc/adt/functions/groups/%2Farc1%2Ffg';
    owner = `${group}/fmodules/%2Farc1%2Ffn`;
    source = 'FUNCTION /arc1/fn.\nENDFUNCTION.\n';
    const { result, payload } = await activate();
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload).toMatchObject({
      name: moduleName,
      group: groupName,
      state: 'activated',
      activeSourceVerified: true,
      nativeMetadataVerified: true,
    });
    expect(posts).toBe(withPrompt ? 2 : 1);
    expect(calls.some((call) => call.path.split('?')[0] === `${owner}/source/main` && call.version === 'active')).toBe(
      true,
    );
  },
);

it.each([
  { issue: 'native-rejection', minimalErrors: true },
  { issue: 'native-rejection', minimalErrors: false },
  { issue: 'native-warning-readback-failed', minimalErrors: true },
  { issue: 'native-warning-readback-failed', minimalErrors: false },
])('honors minimal FUNC errors for $issue / $minimalErrors', async ({ issue, minimalErrors }) => {
  fault = issue;
  const { result, payload } = await activate(minimalErrors);
  expect(result.isError).toBe(true);
  expect(payload.state).toBe('activation-not-confirmed');
  expect(result.content[0].text.includes('NATIVE_FUNC_DIAGNOSTIC_SENTINEL')).toBe(!minimalErrors);
  expect(posts).toBe(1);
});

it('labels a function without a captured draft already active', async () => {
  fault = 'already-active';
  const client = new AdtClient({ baseUrl: 'https://sap.example', safety: { ...defaultSafetyConfig(), ...config } });
  const result = await handlePrivatePinnedFunctionActivation(client, {
    type: 'FUNC',
    name: moduleName,
    group: groupName,
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    state: 'already-active',
    previousNativeVersion: 'active',
    activeSourceVerified: true,
  });
});
