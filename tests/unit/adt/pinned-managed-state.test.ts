import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { core, managedHarness, ownerXml, packageXml } from './pinned-managed-harness.js';

const { movePinnedObjectPackage } = await import('../../../src/adt/pinned-package-move.js');
const { setPinnedApiReleaseState } = await import('../../../src/adt/pinned-api-release.js');
const objectName = 'ZCL_ARC1_APIFIX',
  ownerUri = '/sap/bc/adt/oo/classes/zcl_arc1_apifix';
let harness: ReturnType<typeof managedHarness>, fault: string, pkg: string, api: string, apiReads: number;
let abort: AbortController;
const moveInput = { objectName, objectType: 'CLAS/OC', oldPackage: '$TMP', newPackage: '$DEST' };
const apiInput = {
  type: 'CLAS',
  name: objectName,
  contract: 'C1',
  apiState: 'RELEASED',
  expectedCurrentState: 'NOT_RELEASED',
};
const generic = 'http://www.sap.com/adt/refactoring/genericrefactoring';
function preview() {
  const object = `<g:affectedObject adtcore:name="${objectName}" adtcore:type="CLAS/OC" adtcore:uri="${ownerUri}" adtcore:packageName="$TMP"><g:changePackageDelta><g:newPackage>${fault === 'foreign-target' ? '$FOREIGN' : '$DEST'}</g:newPackage></g:changePackageDelta></g:affectedObject>`;
  return `<g:genericRefactoring xmlns:g="${generic}" xmlns:adtcore="${core}"><g:adtObjectUri>${fault === 'foreign-primary' ? '/sap/bc/adt/oo/classes/zforeign' : ownerUri}</g:adtObjectUri><g:transport>${fault === 'foreign-transport' ? 'A4HK900099' : ''}</g:transport><g:affectedObjects>${object}${fault === 'expanded' ? object : ''}</g:affectedObjects></g:genericRefactoring>`;
}
beforeEach(() => {
  fault = '';
  pkg = '$TMP';
  apiReads = 0;
  abort = new AbortController();
  api = readFileSync(new URL('../../fixtures/xml/api-release-unreleased.xml', import.meta.url), 'utf8');
  harness = managedHarness((r) => {
    if (fault === 'recorded-api' && r.path.includes('transportchecks'))
      return mockResponse(
        200,
        '<DATA><DEVCLASS>ZTEAM</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>X</RECORDING><LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>A4HK900001</TRKORR></REQ_HEADER></LOCK_HOLDER></CTS_OBJECT_LOCK></LOCKS></DATA>',
      );
    if (fault === 'recorded-api' && r.path.includes('/transportrequests/'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (r.path === ownerUri) return mockResponse(200, ownerXml('CLAS', objectName, pkg));
    if (r.path === '/sap/bc/adt/packages/%24DEST') return mockResponse(200, packageXml('$DEST', '$TMP'));
    if (r.method === 'POST' && r.path.startsWith('/sap/bc/adt/refactorings?step=preview')) {
      if (fault === 'package-drift') pkg = '$DEST';
      if (fault === 'cancel-preview') abort.abort();
      if (fault === 'destination-drift')
        harness.client.safety.multiTargetWrite = {
          ...harness.client.safety.multiTargetWrite!,
          allowedPackages: ['$TMP'],
        };
      return mockResponse(200, preview());
    }
    if (r.method === 'POST' && r.path === '/sap/bc/adt/refactorings?step=execute') {
      if (fault !== 'wrong-readback') pkg = '$DEST';
      return mockResponse(fault === 'lost-execute' ? 503 : 200, '');
    }
    if (r.path.startsWith('/sap/bc/adt/apireleases/')) {
      if (r.method === 'GET') {
        apiReads++;
        if (fault === 'api-drift' && apiReads === 2) api = api.replace('ars:comment=""', 'ars:comment="changed"');
        if (fault === 'api-readback' && apiReads === 3) return mockResponse(503, 'PRIVATE_NATIVE_FAILURE');
        return mockResponse(200, api);
      }
      if (r.method === 'PUT') {
        api = api
          .replace('ars:state="NOT_RELEASED"', 'ars:state="RELEASED"')
          .replace('ars:useInSAPCloudPlatform="false"', 'ars:useInSAPCloudPlatform="true"');
        return mockResponse(fault === 'lost-api' ? 503 : 200, '');
      }
    }
    return undefined;
  });
});
const move = (patch = {}) =>
  movePinnedObjectPackage(harness.client, harness.context(abort.signal), { ...moveInput, ...patch });
const release = (patch = {}) =>
  setPinnedApiReleaseState(harness.client, harness.context(abort.signal), { ...apiInput, ...patch });
const executes = () => harness.calls.filter((r) => r.method === 'POST' && r.path.includes('step=execute'));
const puts = () => harness.calls.filter((r) => r.method === 'PUT');

describe('private package move', () => {
  it('accepts native alternate namespace prefixes and rechecks both package policies before execute', async () => {
    const result = await move();
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, state: 'moved', resource: { package: '$DEST' } });
    expect(executes()).toHaveLength(1);
    expect(harness.calls.filter((r) => r.path.includes('transportchecks'))).toHaveLength(4);
    expect(executes()[0]?.body).toContain('<generic:newPackage>$DEST</generic:newPackage>');
  });
  it.each([
    'foreign-target',
    'foreign-primary',
    'foreign-transport',
    'expanded',
    'package-drift',
    'destination-drift',
    'cancel-preview',
  ])('stops %s after preview without execute', async (scenario) => {
    fault = scenario;
    const result = await move();
    expect(result).toMatchObject({
      ok: false,
      state: 'unchanged',
      warnings: expect.arrayContaining([expect.stringContaining('preview request was sent')]),
    });
    expect(executes()).toHaveLength(0);
  });
  it.each([
    { objectType: 'TABL/DT' },
    { newPackage: '$TMP' },
    { objectName: '../OTHER' },
    { oldPackage: '' },
    { newPackage: '/OTHER/PACK' },
    { action: 'all' },
  ])('refuses unsupported move selections before native requests %j', async (patch) => {
    expect(await move(patch)).toMatchObject({ ok: false, state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it('does not execute when the source package was guessed by the caller', async () => {
    expect(await move({ oldPackage: '$DEST', newPackage: '$NEW' })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(harness.calls.some((r) => r.path.includes('refactorings'))).toBe(false);
  });
  it('does not replay or reverse an uncertain move', async () => {
    fault = 'lost-execute';
    expect(await move()).toMatchObject({ ok: false, state: 'move-unconfirmed', retryable: false });
    expect(executes()).toHaveLength(1);
  });
  it('reports a completed request with unchanged owner package as unverified', async () => {
    fault = 'wrong-readback';
    expect(await move()).toMatchObject({ ok: false, state: 'move-unverified' });
    expect(executes()).toHaveLength(1);
  });
});

describe('private API release', () => {
  it('uses the verified APIS parent request in the existing API PUT contract', async () => {
    fault = 'recorded-api';
    pkg = 'ZTEAM';
    api = api.replaceAll('adtcore:packageName="$TMP"', 'adtcore:packageName="ZTEAM"');
    const result = await release({ transport: 'A4HK900002' });
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      recording: { local: false, request: 'A4HK900001' },
    });
    expect(puts()).toHaveLength(1);
    expect(puts()[0]?.path).toContain('?request=A4HK900001');
  });
  it('authorizes the native APIS resource and preserves native default visibility', async () => {
    const result = await release();
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      state: 'state-changed',
      apiState: 'RELEASED',
      visibilitySelection: 'native-defaults',
      visibility: { cloudDevelopment: true, keyUserApps: false },
    });
    expect(puts()).toHaveLength(1);
    const recording = harness.calls.find((r) => r.path.includes('transportchecks'));
    expect(recording?.body).toContain('<URI>/sap/bc/adt/apireleases/apis/ZCL_ARC1_APIFIX%20');
    expect(recording?.body).not.toContain(`<URI>${ownerUri}</URI>`);
  });
  it.each([
    { contract: undefined },
    { contract: 'ALL' },
    { expectedCurrentState: undefined },
    { type: 'SRVB' },
    { group: 'ZGROUP' },
    { apiVisibility: ['cloudDevelopment', 'cloudDevelopment'] },
    { apiState: 'NOT_RELEASED', apiVisibility: [] },
    { rawBody: '<xml/>' },
  ])('rejects invalid release selections before network %j', async (patch) => {
    expect(await release(patch)).toMatchObject({ ok: false, state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it.each(['wrong-owner', 'wrong-resource', 'wrong-package', 'readonly-contract', 'api-drift'])(
    'refuses %s without API PUT',
    async (scenario) => {
      fault = scenario;
      if (scenario === 'wrong-owner') api = api.replace('adtcore:name="ZCL_ARC1_APIFIX"', 'adtcore:name="ZFOREIGN"');
      if (scenario === 'wrong-resource') api = api.replaceAll('/apis/ZCL_ARC1_APIFIX', '/apis/ZFOREIGN');
      if (scenario === 'wrong-package')
        api = api.replaceAll('adtcore:packageName="$TMP"', 'adtcore:packageName="$DEST"');
      if (scenario === 'readonly-contract')
        api = api.replace('ars:c1Release ars:create="true"', 'ars:c1Release ars:create="false"');
      expect(await release()).toMatchObject({ ok: false, state: 'unchanged' });
      expect(puts()).toHaveLength(0);
    },
  );
  it('rejects stale native contract state', async () => {
    expect(await release({ expectedCurrentState: 'RELEASED' })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(puts()).toHaveLength(0);
  });
  it.each(['lost-api', 'api-readback'])('preserves %s uncertainty and never repeats PUT', async (scenario) => {
    fault = scenario;
    const result = await release();
    expect(result).toMatchObject({ ok: false, state: 'state-change-unconfirmed', retryable: false });
    expect(puts()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_FAILURE');
  });
});
