/** Authored in-memory native responses exercise the real runner and shared mutation handlers, not live SAP. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { runNativeFunctionContract } = await import(
  '../../../scripts/qualification/pr1142/native-function-contract-run.js'
);
const { contractSelection } = await import('../../../scripts/qualification/pr1142/native-contract-transport.js');

import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { deletePinnedOwner } from '../../../src/adt/pinned-delete.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const suffix = '0123456789ABCDEF',
  selected = contractSelection(suffix),
  marker = 'native fixture';
const core = 'http://www.sap.com/adt/core',
  sourceNs = 'http://www.sap.com/adt/abapsource';
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  systemType: 'onprem' as const,
  allowWrites: true,
  allowedPackages: ['$TMP'],
  lintBeforeWrite: false,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
let groupExists = false,
  moduleExists = false,
  moduleSource = '',
  activeSource = '',
  fault = '',
  nativeActivated = false,
  cleanupStarted = false,
  invalidatedModuleLock = false,
  stopRequested = false;
const nativeSource = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/function-source-a4h-readback.json', import.meta.url), 'utf8'),
);
const nativeMetadata = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/function-metadata-a4h-activation.json', import.meta.url), 'utf8'),
);
const activationBodies: string[] = [];
const calls: { method: string; path: string }[] = [],
  rows: Record<string, unknown>[] = [],
  unexpected: string[] = [];
const pool = `/sap/bc/adt/textelements/functiongroups/${selected.group.toLowerCase()}`;
const groupMeta = `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:adtcore="${core}" adtcore:name="${selected.group}" adtcore:type="FUGR/F" adtcore:description="${marker}" adtcore:createdBy="MARIAN" adtcore:version="active"><adtcore:packageRef adtcore:name="$TMP" adtcore:type="DEVC/K"/></g:abapFunctionGroup>`;
const moduleMeta = `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="${core}" adtcore:name="${selected.module}" adtcore:type="FUGR/FF" adtcore:description="${marker}" adtcore:changedBy="MARIAN" adtcore:version="active"><adtcore:containerRef adtcore:name="${selected.group}" adtcore:type="FUGR/F" adtcore:uri="${selected.groupUrl}" adtcore:packageName="$TMP"/></f:abapFunctionModule>`;
function structure() {
  const entries = [
    [`L${selected.group}TOP`, 'FUGR/I'],
    [`L${selected.group}UXX`, 'FUGR/I'],
    [`SAPL${selected.group}`, 'FUGR/PX'],
  ];
  if (moduleExists) entries.push([selected.module, 'FUGR/FF']);
  if (fault === 'foreign-screen' && cleanupStarted) entries.push(['FOREIGN_SCREEN', 'FUGR/PD']);
  return `<s:objectStructureElement xmlns:s="${sourceNs}" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F">${entries.map(([name, type]) => `<s:objectStructureElement c:name="${name}" c:type="${type}"/>`).join('')}</s:objectStructureElement>`;
}
function missing() {
  return mockResponse(
    404,
    '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>',
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  groupExists = moduleExists = cleanupStarted = nativeActivated = false;
  fault = '';
  invalidatedModuleLock = false;
  stopRequested = false;
  moduleSource = activeSource = `FUNCTION ${selected.module.toLowerCase()}.\nENDFUNCTION.\n`;
  calls.length = rows.length = unexpected.length = activationBodies.length = 0;
  mockFetch.mockImplementation(async (url, init: RequestInit = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({ method, path: path + uri.search });
    const response = (body: string, media = 'application/xml') => mockResponse(200, body, { 'content-type': media });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
    if (path === '/sap/bc/adt/core/http/sessions')
      return mockResponse(200, fault === 'oversized-close' ? 'x'.repeat(65537) : '');
    if (uri.searchParams.get('_action') === 'LOCK') {
      if (path === selected.moduleUrl) invalidatedModuleLock = false;
      return mockResponse(200, '<DATA><LOCK_HANDLE>PRIVATE_TEST_LOCK</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=fixture-session; Path=/',
      });
    }
    // Deliberately hostile native model: versioned guard reads can invalidate this editing context.
    // This checks isolation; it does not model or establish SAP's exact invalidation mechanism.
    if (
      ['versioned-guard-invalidates-lock', 'active-versioned-guard-invalidates-lock'].includes(fault) &&
      cleanupStarted &&
      method === 'GET' &&
      path.startsWith(selected.moduleUrl) &&
      uri.searchParams.has('version') &&
      new Headers(init.headers).get('cookie')?.includes('sap-contextid=fixture-session')
    )
      invalidatedModuleLock = true;
    if (uri.searchParams.get('_action') === 'UNLOCK') return mockResponse(200, '');
    if (path === '/sap/bc/adt/cts/transportchecks')
      return response(
        `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${String(init.body).includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
      );
    if (method === 'POST' && path === '/sap/bc/adt/functions/groups') {
      groupExists = true;
      return mockResponse(201, '');
    }
    if (method === 'POST' && path === `${selected.groupUrl}/fmodules`) {
      if (fault === 'unknown-create') return mockResponse(503, 'Uncertain creation');
      moduleExists = true;
      return mockResponse(201, '');
    }
    if (method === 'DELETE' && path === selected.moduleUrl) {
      if (fault === 'active-module-lock-rejected' || invalidatedModuleLock)
        return mockResponse(
          423,
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceInvalidLockHandle"/><message>Invalid lock handle</message></exc:exception>',
        );
      if (fault === 'delete-rejected') return mockResponse(403, 'Native deletion denied');
      moduleExists = false;
      if (fault === 'vanished-parent-after-child-delete') groupExists = false;
      return mockResponse(204, '');
    }
    if (method === 'DELETE' && path === selected.groupUrl) {
      groupExists = false;
      return mockResponse(204, '');
    }
    const confirmedSnapshots = rows.filter(
      (row) => row.snapshot === selected.moduleUrl && row.requestedVersion === 'active',
    ).length;
    if (
      method === 'GET' &&
      path === selected.moduleUrl &&
      ((fault === 'vanished-before-update' && confirmedSnapshots >= 1) ||
        (fault === 'vanished-after-save' && confirmedSnapshots >= 2))
    )
      moduleExists = false;
    if (path === selected.moduleUrl) {
      const epoch = nativeActivated
        ? 'saved-active'
        : uri.searchParams.get('version') === 'active'
          ? 'created-active'
          : moduleSource.includes('MiXeD')
            ? 'saved-inactive'
            : 'created-inactive';
      const captured = ['native-shaped-activation', 'activation-metadata-drift', 'activation-native-fallback'].includes(
        fault,
      );
      const capturedState = nativeActivated
        ? fault === 'activation-native-fallback'
          ? nativeMetadata.saved
          : nativeMetadata.active
        : uri.searchParams.get('version') === 'active'
          ? moduleSource.includes('MiXeD')
            ? nativeMetadata.postSaveActive
            : nativeMetadata.postCreateActive
          : nativeMetadata.saved;
      let metadata = captured
        ? capturedState.xml
            .replaceAll(nativeMetadata.marker, marker)
            .replaceAll(nativeMetadata.suffix, suffix)
            .replaceAll(nativeMetadata.suffix.toLowerCase(), suffix.toLowerCase())
            .replace(/etag="[^"]*"/g, `etag="${epoch}"`)
        : moduleMeta;
      if (nativeActivated && fault === 'activation-metadata-drift')
        metadata = metadata.replace('processingType="normal"', 'processingType="rfc"');
      if (nativeActivated && fault === 'activation-inactive-metadata')
        metadata = metadata.replace('adtcore:version="active"', 'adtcore:version="inactive"');
      if (nativeActivated && fault === 'activation-missing-version')
        metadata = metadata.replace(' adtcore:version="active"', '');
      if (
        fault === 'active-fallback-at-delete' &&
        rows.some((row) => row.verifiedActiveDeletionSelected) &&
        uri.searchParams.get('version') === 'active'
      )
        metadata = metadata.replace('adtcore:version="active"', 'adtcore:version="inactive"');
      if (nativeActivated && fault === 'activation-foreign-version')
        metadata = metadata.replace('adtcore:version="active"', 'xmlns:foreign="urn:foreign" foreign:version="active"');
      return moduleExists ? response(metadata) : missing();
    }
    if (path === selected.groupUrl) return groupExists ? response(groupMeta) : missing();
    if (path === `${selected.moduleUrl}/source/main`) {
      if (method === 'PUT') {
        if (fault.startsWith('unknown-save-')) {
          if (fault === 'unknown-save-all-404') groupExists = false;
          moduleExists = false;
          return mockResponse(503, 'Uncertain source save');
        }
        moduleSource =
          fault === 'native-shaped-activation'
            ? nativeSource.readback
                .replaceAll(nativeSource.functionName.toLowerCase(), selected.module.toLowerCase())
                .replace(/ARC1 native contract [A-F0-9]{16}/, marker)
            : String(init.body);
        return mockResponse(200, '');
      }
      if (fault === 'stop-during-verification' && rows.some((row) => row.verifiedActiveDeletionSelected))
        stopRequested = true;
      const active = uri.searchParams.get('version') === 'active';
      if (active && fault === 'post-create-active-missing') return missing();
      if (active && cleanupStarted && fault === 'guard-read-denied') return mockResponse(403, 'Guard read denied');
      return response(
        active
          ? fault === 'active-drift' && cleanupStarted
            ? `${activeSource}* FOREIGN\n`
            : activeSource
          : moduleSource,
        'text/plain',
      );
    }
    if (path === `${selected.groupUrl}/objectstructure`)
      return response(structure(), 'application/vnd.sap.adt.objectstructure.v2+xml');
    if (path.startsWith(selected.groupUrl) && path.endsWith('/source/main'))
      return response('* generated group source\n', 'text/plain');
    if (path === pool)
      return response(
        `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/PX" c:version="active"><c:packageRef c:name="$TMP" c:type="DEVC/K"/></rept:textElement>`,
      );
    if (path.startsWith(`${pool}/source/`))
      return response('', `application/vnd.sap.adt.textelements.${path.split('/').at(-1)}.v1`);
    if (path === '/sap/bc/adt/activation') {
      activationBodies.push(String(init.body));
      cleanupStarted = true;
      if (fault === 'vanished-after-preaudit') groupExists = moduleExists = false;
      if (fault === 'activated-with-prompt') {
        nativeActivated = true;
        activeSource = moduleSource;
      }
      if (
        [
          'native-shaped-activation',
          'activation-without-source-change',
          'activation-metadata-drift',
          'activation-inactive-metadata',
          'activation-missing-version',
          'activation-native-fallback',
          'activation-foreign-version',
          'active-versioned-guard-invalidates-lock',
          'active-fallback-at-delete',
          'stop-during-verification',
        ].includes(fault)
      ) {
        nativeActivated = true;
        if (fault !== 'activation-without-source-change') activeSource = moduleSource;
        return response(
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>',
        );
      }
      return response(
        `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}"><ioc:entry><ioc:object ioc:user="MARIAN" ioc:deleted="false"><ioc:ref adtcore:uri="${selected.groupUrl}" adtcore:name="${selected.group}" adtcore:type="FUGR/F"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
      );
    }
    unexpected.push(`${method} ${path}${uri.search}`);
    return mockResponse(599, 'Unexpected fixture request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
async function run(activatedCleanup: 'preserve' | 'delete-verified-active' = 'preserve') {
  const base = new AdtClient({
    baseUrl: 'https://sap.example.test',
    client: '001',
    username: 'MARIAN',
    password: 'fixture',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  return runNativeFunctionContract({
    base,
    config,
    activatedCleanup,
    selection: selected,
    marker,
    verifySource: () => {},
    shouldStop: () => stopRequested,
    record: (value) => rows.push(value as Record<string, unknown>),
  });
}
it('runs creation, source proof and cleanup through the actual handlers', async () => {
  const result = await run();
  expect(result, JSON.stringify(rows.filter((row) => row.failure || row.cleanupFailure || row.input))).toMatchObject({
    failure: false,
    remaining: [],
    pendingCreation: [],
    cleanupUnconfirmed: false,
  });
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path.split('?')[0])).toEqual([
    selected.moduleUrl,
    selected.groupUrl,
  ]);
});
it('keeps versioned fixture verification out of the owning lock session', async () => {
  fault = 'versioned-guard-invalidates-lock';
  const result = await run();
  expect(result).toMatchObject({ failure: false, remaining: [], cleanupUnconfirmed: false });
  expect(invalidatedModuleLock).toBe(false);
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
});
it('verifies native active source but preserves both owners until active module deletion is qualified', async () => {
  fault = 'native-shaped-activation';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: true,
    remaining: [selected.groupUrl, selected.moduleUrl],
  });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  expect(activationBodies).toHaveLength(1);
  expect(activationBodies[0]).toContain(`adtcore:uri="${selected.moduleUrl}"`);
  expect(rows).toContainEqual(expect.objectContaining({ state: 'saved-inactive' }));
  expect(rows).toContainEqual(
    expect.objectContaining({ activeSourceVerified: selected.moduleUrl, hash: expect.any(String) }),
  );
  expect(rows).toContainEqual(expect.objectContaining({ preservedAfterActivation: selected.moduleUrl }));
  expect(rows).toContainEqual(
    expect.objectContaining({
      cleanupFailure: selected.moduleUrl,
      message: expect.stringContaining('deliberately preserved'),
    }),
  );
});
it('deletes a verified active fixture only in the explicit native qualification mode', async () => {
  fault = 'native-shaped-activation';
  const result = await run('delete-verified-active');
  expect(result).toMatchObject({
    failure: false,
    remaining: [],
    cleanupUnconfirmed: false,
    activeDeletionVerified: true,
  });
  expect(rows).toContainEqual(expect.objectContaining({ verifiedActiveDeletionSelected: selected.moduleUrl }));
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path.split('?')[0])).toEqual([
    selected.moduleUrl,
    selected.groupUrl,
  ]);
});
it('keeps active-delete verification stateless while native mutation retains its lock', async () => {
  fault = 'active-versioned-guard-invalidates-lock';
  expect(await run('delete-verified-active')).toMatchObject({
    failure: false,
    activeDeletionVerified: true,
    remaining: [],
  });
  expect(invalidatedModuleLock).toBe(false);
});
it.each(['active-fallback-at-delete', 'stop-during-verification'])(
  'refuses active DELETE when its last verification encounters %s',
  async (scenario) => {
    fault = scenario;
    expect(await run('delete-verified-active')).toMatchObject({ failure: true, activeDeletionVerified: false });
    expect(rows.some((row) => row.verifiedActiveDeletionSelected)).toBe(true);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  },
);
it('does not qualify active deletion when preaudit only offers a confirmation', async () => {
  const result = await run('delete-verified-active');
  expect(result).toMatchObject({ failure: true, activeDeletionVerified: false, remaining: [] });
});
it.each(['activated-with-prompt', 'activation-inactive-metadata', 'activation-metadata-drift', 'oversized-close'])(
  'does not let the explicit active-delete mode clear uncertainty: %s',
  async (scenario) => {
    fault = scenario;
    const result = await run('delete-verified-active');
    expect(result.failure).toBe(true);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    expect(rows.some((row) => row.verifiedActiveDeletionSelected)).toBe(false);
  },
);
it('preserves saved source found active even when preaudit returns a confirmation prompt', async () => {
  fault = 'activated-with-prompt';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [selected.groupUrl, selected.moduleUrl] });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  expect(rows).toContainEqual(expect.objectContaining({ preservedAfterUnexpectedActivation: selected.moduleUrl }));
});
it('rejects successful activation flags when active source remains unchanged', async () => {
  fault = 'activation-without-source-change';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: true,
    remaining: [selected.groupUrl, selected.moduleUrl],
  });
  expect(rows).toContainEqual(expect.objectContaining({ failure: expect.stringContaining('active source') }));
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});
it('refuses captured metadata drift even when activated source matches', async () => {
  fault = 'activation-metadata-drift';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [selected.groupUrl, selected.moduleUrl] });
  expect(rows.some((row) => row.activeSourceVerified === selected.moduleUrl)).toBe(false);
  expect(rows).toContainEqual(
    expect.objectContaining({ cleanupFailure: selected.moduleUrl, message: expect.stringContaining('Unconfirmed') }),
  );
  expect(rows).toContainEqual(expect.objectContaining({ failure: expect.stringContaining('owner does not match') }));
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});
it.each(['activation-inactive-metadata', 'activation-missing-version', 'activation-native-fallback'])(
  'does not call matching source active without native active metadata: %s',
  async (scenario) => {
    fault = scenario;
    const result = await run();
    expect(result).toMatchObject({ failure: true, remaining: [selected.groupUrl, selected.moduleUrl] });
    expect(rows.some((row) => row.activeSourceVerified === selected.moduleUrl)).toBe(false);
    expect(rows).toContainEqual(
      expect.objectContaining({ cleanupFailure: selected.moduleUrl, message: expect.stringContaining('Unconfirmed') }),
    );
    expect(rows).toContainEqual(expect.objectContaining({ failure: expect.stringContaining('active version') }));
    expect(rows).toContainEqual(
      expect.objectContaining({
        snapshot: selected.moduleUrl,
        requestedVersion: 'active',
        nativeVersion: scenario === 'activation-missing-version' ? null : 'inactive',
      }),
    );
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  },
);
it('rejects a foreign-bound native version without deleting either owner', async () => {
  fault = 'activation-foreign-version';
  expect(await run()).toMatchObject({ failure: true, remaining: [selected.groupUrl, selected.moduleUrl] });
  expect(rows.some((row) => row.activeSourceVerified === selected.moduleUrl)).toBe(false);
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});
it.each(['vanished-after-preaudit', 'vanished-parent-after-child-delete'])(
  'reports unexplained disappearance as failure: %s',
  async (scenario) => {
    fault = scenario;
    const result = await run();
    expect(result).toMatchObject({ failure: true, remaining: [], cleanupUnconfirmed: true });
    expect(rows).toContainEqual(expect.objectContaining({ unexpectedAbsence: selected.groupUrl }));
    expect(
      calls.filter((call) => call.method === 'DELETE' && call.path.startsWith(`${selected.groupUrl}?`)),
    ).toHaveLength(0);
  },
);
it('preserves an owner when the raw session close exceeds its allowance', async () => {
  fault = 'oversized-close';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: true,
    remaining: [selected.groupUrl],
    cleanupIssues: [selected.groupUrl],
  });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});
it('keeps unknown creation pending even when every current module read returns typed 404', async () => {
  fault = 'unknown-create';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    remaining: [selected.groupUrl],
    pendingCreation: [selected.moduleUrl],
    cleanupUnconfirmed: true,
  });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});
function deleteOutcome(path: string) {
  const entry = rows.find(
    (row) =>
      (row.input as { action?: string; type?: string } | undefined)?.action === 'delete' &&
      (row.input as { type: string }).type === (path === selected.moduleUrl ? 'FUNC' : 'FUGR'),
  );
  expect(entry).toBeDefined();
  expect(entry).not.toHaveProperty('phase');
  expect(entry).not.toHaveProperty('state');
  return JSON.parse((entry!.result as { content: { text: string }[] }).content[0].text);
}
it('journals an active-version drift as a local refusal and sends no DELETE', async () => {
  fault = 'active-drift';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [selected.groupUrl, selected.moduleUrl] });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  expect(deleteOutcome(selected.moduleUrl)).toMatchObject({ state: 'unchanged', phase: 'delete', retryable: false });
  expect(rows).toContainEqual(
    expect.objectContaining({
      stage: 'refused-before-send',
      method: 'DELETE',
      reason: expect.stringContaining('active'),
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({ stage: 'response', method: 'GET', body: expect.stringContaining('FOREIGN') }),
  );
});
it('preserves a group with a foreign screen while removing its verified module', async () => {
  fault = 'foreign-screen';
  const result = await run();
  expect(result).toMatchObject({ failure: true, remaining: [selected.groupUrl] });
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path.split('?')[0])).toEqual([
    selected.moduleUrl,
  ]);
  expect(deleteOutcome(selected.groupUrl)).toMatchObject({ state: 'unchanged', phase: 'delete' });
  expect(rows).toContainEqual(
    expect.objectContaining({ stage: 'response', body: expect.stringContaining('FOREIGN_SCREEN') }),
  );
});
it('keeps a real native DELETE rejection distinct from a guard refusal', async () => {
  fault = 'delete-rejected';
  const result = await run();
  expect(result.failure).toBe(true);
  expect(deleteOutcome(selected.moduleUrl)).toMatchObject({
    state: 'delete-rejected',
    phase: 'delete',
    statusCode: 403,
  });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(rows).toContainEqual(expect.objectContaining({ stage: 'error', method: 'DELETE', status: 403 }));
  expect(rows).not.toContainEqual(expect.objectContaining({ stage: 'refused-before-send', method: 'DELETE' }));
});
it('does not misclassify a guard GET 403 as a native DELETE rejection', async () => {
  fault = 'guard-read-denied';
  const result = await run();
  expect(result.failure).toBe(true);
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  const outcome = deleteOutcome(selected.moduleUrl);
  expect(outcome).toMatchObject({ state: 'unchanged', phase: 'delete' });
  expect(outcome.statusCode).toBeUndefined();
  expect(rows).toContainEqual(expect.objectContaining({ stage: 'error', method: 'GET', status: 403 }));
  expect(rows).toContainEqual(expect.objectContaining({ stage: 'refused-before-send', method: 'DELETE' }));
});

it.each([false, true])(
  'retains unknown-save inspection even when current resources return 404 (all=%s)',
  async (allAbsent) => {
    fault = allAbsent ? 'unknown-save-all-404' : 'unknown-save-current-404';
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      remaining: allAbsent ? [] : [selected.groupUrl],
      pendingCreation: [],
      inspectionRequired: [selected.moduleUrl, selected.groupUrl],
      cleanupUnconfirmed: true,
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  },
);

it.each(['vanished-before-update', 'vanished-after-save'])(
  'preserves evidence when a receipted module has %s',
  async (scenario) => {
    fault = scenario;
    const result = await run();
    expect(result).toMatchObject({
      failure: true,
      remaining: [selected.groupUrl],
      inspectionRequired: [selected.moduleUrl, selected.groupUrl],
      cleanupUnconfirmed: true,
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  },
);
it('preserves both fixtures after the post-create active source read returns 404', async () => {
  fault = 'post-create-active-missing';
  const result = await run();
  expect(result).toMatchObject({
    failure: true,
    remaining: [selected.groupUrl, selected.moduleUrl],
    inspectionRequired: [selected.moduleUrl, selected.groupUrl],
    cleanupUnconfirmed: true,
  });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
});

it('reports the observed activated-module lock rejection without retrying or deleting its group', async () => {
  fault = 'native-shaped-activation';
  await run();
  fault = 'active-module-lock-rejected';
  const base = new AdtClient({
    baseUrl: 'https://sap.example.test',
    client: '001',
    username: 'MARIAN',
    password: 'fixture',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  const context = pinnedMutationContext(base.safety, { deadline: Date.now() + 30000 }, { unlockFailed: false });
  const result = await deletePinnedOwner(base, context, { type: 'FUNC', name: selected.module, group: selected.group });
  expect(result).toMatchObject({ ok: false, state: 'delete-rejected', statusCode: 423, retryable: false });
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(context.cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  expect(groupExists && moduleExists).toBe(true);
});
