import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { captureOwnedFunctionInventory, assertOwnedInventoryMatches } = await import(
  '../../../scripts/qualification/pr1142/native-lock-inventory.js'
);
const { recoverInspectedFunctionGroup } = await import('../../../scripts/qualification/pr1142/native-lock-recovery.js');
const { contractSelection, contractFunctionMetadataHash } = await import(
  '../../../scripts/qualification/pr1142/native-contract-transport.js'
);
const selected = contractSelection('0123456789ABCDEF'),
  marker = 'ARC1 native contract 0123456789ABCDEF';
const core = 'http://www.sap.com/adt/core',
  treeNs = 'http://www.sap.com/adt/abapsource';
const group = `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F" c:description="${marker}" c:createdBy="MARIAN"><c:packageRef c:name="$TMP" c:type="DEVC/K"/></g:abapFunctionGroup>`;
const module = `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:c="${core}" c:name="${selected.module}" c:type="FUGR/FF" c:description="${marker}" c:changedBy="MARIAN" c:version="active"><c:containerRef c:name="${selected.group}" c:type="FUGR/F" c:uri="${selected.groupUrl}" c:packageName="$TMP"/></f:abapFunctionModule>`;
const source = `FUNCTION ${selected.module.toLowerCase()}.\nENDFUNCTION.\n`;
const receipt = { hash: sourceHash(source), metadataHash: contractFunctionMetadataHash(module, selected) };
const pool = `/sap/bc/adt/textelements/functiongroups/${selected.group.toLowerCase()}`;
const calls: { method: string; path: string }[] = [];
let deleted = false,
  fault = '',
  locked = false;
function missing() {
  return mockResponse(
    404,
    '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>',
  );
}
function tree() {
  const children = [
    [`L${selected.group}TOP`, 'FUGR/I'],
    [`L${selected.group}UXX`, 'FUGR/I'],
    [`SAPL${selected.group}`, 'FUGR/PX'],
    [selected.module, 'FUGR/FF'],
  ];
  if (fault === 'extra-member') children.push(['FOREIGN', 'FUGR/PD']);
  return `<s:objectStructureElement xmlns:s="${treeNs}" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F">${children.map(([name, type]) => `<s:objectStructureElement c:name="${name}" c:type="${type}"/>`).join('')}</s:objectStructureElement>`;
}
beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  deleted = locked = false;
  fault = '';
  mockFetch.mockImplementation(async (url, init: RequestInit = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({ method, path: uri.pathname + uri.search });
    const response = (body: string, media = 'application/xml') => mockResponse(200, body, { 'content-type': media });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
    if (path === '/sap/bc/adt/core/http/sessions') return response('');
    if (uri.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(200, '<DATA><LOCK_HANDLE>PRIVATE_LOCK</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=private-session; Path=/',
      });
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') return response('');
    if (path === '/sap/bc/adt/cts/transportchecks')
      return response(
        '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
      );
    if (method === 'DELETE') {
      if (path !== selected.groupUrl) throw new Error('A direct child DELETE is forbidden');
      deleted = true;
      return response('');
    }
    if (path === '/sap/bc/adt/activation/inactiveobjects')
      return response(
        fault === 'invalid-inactive-list'
          ? '<html/>'
          : fault === 'fixture-in-inactive-list'
            ? `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">${selected.module}</ioc:inactiveObjects>`
            : '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
        fault === 'inactive-media' ? 'text/html' : 'application/xml',
      );
    if (deleted && path === pool && fault === 'untyped-pool-404') return mockResponse(404, 'not found');
    if (deleted) return missing();
    if (path.endsWith('/objectstructure')) return response(tree(), 'application/vnd.sap.adt.objectstructure.v2+xml');
    if (path === selected.groupUrl) return response(group);
    if (path === selected.moduleUrl) return response(module);
    if (path === `${selected.moduleUrl}/source/main`)
      return response(fault === 'source-drift' ? `${source}*` : source, 'text/plain');
    if (path.startsWith(selected.groupUrl) && path.endsWith('/source/main'))
      return response(
        locked && fault === 'parent-drift' ? '* changed parent' : '* generated',
        fault === 'source-media' ? 'text/html' : 'text/plain',
      );
    if (path === pool)
      return response(
        `<r:textElement xmlns:r="http://www.sap.com/adt/textelements" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/PX" c:version="active"><c:packageRef c:name="$TMP" c:type="DEVC/K"/></r:textElement>`,
      );
    if (path.startsWith(`${pool}/source/`))
      return response('', `application/vnd.sap.adt.textelements.${path.split('/').at(-1)}.v1`);
    throw new Error(`Unexpected request ${method} ${path}`);
  });
});
function client() {
  return new AdtClient({
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
}
const capture = (base: InstanceType<typeof AdtClient>) =>
  captureOwnedFunctionInventory(base.http, selected, marker, receipt, () => {});
it('captures all 19 resources, then deletes only the unchanged inspected whole group and verifies absence', async () => {
  const base = client(),
    inspected = await capture(base);
  expect(Object.keys(inspected.hashes)).toHaveLength(19);
  const result = await recoverInspectedFunctionGroup({
    client: base,
    selection: selected,
    marker,
    receipt,
    inspected,
    record: () => {},
    verifySource: () => {},
    signal: new AbortController().signal,
  });
  expect(result, JSON.stringify(result)).toMatchObject({
    cleanupConfirmed: true,
    absenceConfirmed: true,
    deletion: { ok: true },
  });
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path.split('?')[0])).toEqual([
    selected.groupUrl,
  ]);
});
it.each(['extra-member', 'source-drift', 'source-media'])(
  'refuses an unqualified inspected inventory: %s',
  async (scenario) => {
    fault = scenario;
    await expect(capture(client())).rejects.toThrow();
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  },
);
it('refuses a parent change discovered while the group and pool locks are held', async () => {
  const base = client(),
    inspected = await capture(base);
  fault = 'parent-drift';
  const result = await recoverInspectedFunctionGroup({
    client: base,
    selection: selected,
    marker,
    receipt,
    inspected,
    record: () => {},
    verifySource: () => {},
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({ cleanupConfirmed: false, deletion: { ok: false, state: 'unchanged' } });
  expect(locked).toBe(true);
  expect(deleted).toBe(false);
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
});
it.each(['invalid-inactive-list', 'fixture-in-inactive-list', 'inactive-media', 'untyped-pool-404'])(
  'does not confirm cleanup from %s',
  async (scenario) => {
    const base = client(),
      inspected = await capture(base);
    fault = scenario;
    const result = await recoverInspectedFunctionGroup({
      client: base,
      selection: selected,
      marker,
      receipt,
      inspected,
      record: () => {},
      verifySource: () => {},
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ cleanupConfirmed: false, absenceConfirmed: false, deletion: { ok: true } });
  },
);
it('refuses a partial baseline and a cancelled recovery before any lock', async () => {
  const base = client(),
    inspected = await capture(base);
  expect(() => assertOwnedInventoryMatches(selected, { ...inspected, hashes: {} }, inspected)).toThrow();
  const controller = new AbortController();
  controller.abort();
  calls.length = 0;
  await expect(
    recoverInspectedFunctionGroup({
      client: base,
      selection: selected,
      marker,
      receipt,
      inspected,
      record: () => {},
      verifySource: () => {},
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
