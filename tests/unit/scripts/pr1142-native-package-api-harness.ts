/** Offline real transport fixture: all dispatchers use MockAgent and every Socket.connect is blocked. */
import { Socket } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  type PackageGraph,
  type PackageOwner,
  packageFixtures,
} from '../../../scripts/qualification/pr1142/native-package-fixtures.js';

vi.mock('undici', async (original) => {
  const actual = await original<typeof import('undici')>();
  return {
    ...actual,
    Agent: class extends actual.Dispatcher {
      dispatch(options: any, handler: any) {
        return actual.getGlobalDispatcher().dispatch(options, handler);
      }
    },
    Client: class {
      async request(options: any) {
        const uri = new URL(options.path);
        return actual
          .getGlobalDispatcher()
          .request({ ...options, origin: uri.origin, path: uri.pathname + uri.search });
      }
      async close() {}
    },
  };
});
export const { AdtClient } = await import('../../../src/adt/client.js');
export const { packageSafety, runNativePackageApi, runNativePackageApiRetainedTail, runNativePackageApiMovedTail } =
  await import('../../../scripts/qualification/pr1142/native-package-driver.js');

import { readFileSync } from 'node:fs';
import { packageApiInterface } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { buildPreviewXml } from '../../../src/adt/refactoring.js';
export const graph = packageFixtures('0123456789ABCDEF'),
  core = 'http://www.sap.com/adt/core',
  pak = 'http://www.sap.com/adt/packages';
export const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>';
export const nonempty = (owner: PackageOwner) =>
  `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceError"/><message lang="EN">Package ${owner.name} still contains development objects or other packages.</message><properties><entry key="T100KEY-MSGID">PAK</entry><entry key="T100KEY-MSGNO">051</entry><entry key="T100KEY-V1">${owner.name}</entry></properties></exc:exception>`;
export function packageMetadata(owner: PackageOwner, child = false, selected = graph) {
  return `<p:package xmlns:p="${pak}" xmlns:c="${core}" c:name="${owner.name}" c:type="DEVC/K" c:description="${owner.description}" c:responsible="MARIAN" c:createdBy="MARIAN" c:changedBy="MARIAN" c:version="active"><c:packageRef c:name="${owner.name}"/><p:superPackage${owner.parent ? ` c:name="${owner.parent}"` : ''}/><p:attributes p:packageType="development" p:recordChanges="false"/><p:transport><p:softwareComponent p:name="LOCAL"/><p:transportLayer p:name=""/></p:transport><p:subPackages>${child ? `<p:packageRef c:name="${selected.child.name}" c:type="DEVC/K" c:uri="${selected.child.owner}" c:description="${selected.child.description}"/>` : ''}</p:subPackages></p:package>`;
}
export function classMetadata(active: boolean, graph = packageFixtures('0123456789ABCDEF')) {
  return `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:adtcore="${core}" adtcore:name="${graph.clas.name}" adtcore:type="CLAS/OC" adtcore:description="${graph.clas.description}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN" adtcore:version="${active ? 'active' : 'inactive'}"><adtcore:packageRef adtcore:name="${graph.child.name}" adtcore:type="DEVC/K"/></c:abapClass>`;
}
let sequence = 0;
let mock: MockAgent, prior: ReturnType<typeof getGlobalDispatcher>;
beforeEach(() => {
  sequence = 0;
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('All sockets forbidden in native package tests.');
  });
  prior = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});
afterEach(async () => {
  setGlobalDispatcher(prior);
  await mock.close();
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
export function packageApiHarness(
  options: {
    graph?: PackageGraph;
    retainedApi?: boolean;
    movedApi?: boolean;
    retained?: { metadata: Record<string, string>; source: string; intfSource?: string };
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    proxy?: boolean;
    token?: () => Promise<string>;
  } = {},
) {
  const retained = options.retained;
  const retainedApi = options.retainedApi;
  const request = retainedApi ? 'A4HK906609' : 'A4HK999991',
    task = retainedApi ? 'A4HK906610' : 'A4HK999992';
  const graph = options.graph ?? packageFixtures('0123456789ABCDEF');
  const intf = packageApiInterface(graph);
  const origin = `https://native-package-${++sequence}.invalid`;
  const existing = new Set<string>(
      retainedApi
        ? [graph.root.owner, graph.child.owner, graph.clas.owner, intf.owner]
        : retained
          ? [graph.root.owner, graph.child.owner, graph.clas.owner]
          : [],
    ),
    calls: { method: string; path: string; body: string }[] = [],
    records: any[] = [];
  let moved = options.movedApi === true,
    requestCreated = !!retainedApi,
    apiReleased = false,
    apiTouched = false;
  let active = !!retained || !!retainedApi,
    source = retained?.source ?? (retainedApi ? graph.clas.source : ''),
    intfSource = retained?.intfSource ?? (retainedApi ? intf.source : ''),
    stopped = false,
    broken = false;
  const hooks: {
    before?: (r: (typeof calls)[number]) => void;
    reply?: (
      r: (typeof calls)[number],
    ) => { statusCode: number; data: string; headers?: Record<string, string> } | undefined;
    record?: (r: any) => void;
    verify?: () => void;
  } = {};
  const reply = (statusCode: number, data = '', headers: Record<string, string> = {}) => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': 'application/xml', ...headers } },
  });
  mock
    .get(origin)
    .intercept({ path: () => true, method: () => true })
    .reply((options) => {
      const uri = new URL(options.path, origin);
      uri.searchParams.delete('sap-client');
      uri.searchParams.delete('sap-language');
      const r = { method: String(options.method), path: uri.pathname + uri.search, body: String(options.body ?? '') };
      calls.push(r);
      hooks.before?.(r);
      const custom = hooks.reply?.(r);
      if (custom) return reply(custom.statusCode, custom.data, custom.headers);
      if (r.method === 'HEAD') return reply(200, '', { 'x-csrf-token': 'synthetic-csrf' });
      if (uri.pathname === '/sap/bc/adt/core/http/sessions') return reply(200);
      if (uri.pathname === '/sap/bc/adt/activation/inactiveobjects')
        return reply(
          200,
          '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"><i:unrelated>UNRELATED_DRAFT</i:unrelated></i:inactiveObjects>',
        );
      if (uri.pathname === '/sap/bc/adt/packages/ZARC1_DEMO') return reply(200, recordedPackageXml());
      if (uri.pathname === '/sap/bc/adt/cts/transports' && r.method === 'POST') {
        requestCreated = true;
        return reply(200, '/com.sap.cts/object_record/A4HK999991', { 'content-type': 'text/plain' });
      }
      if (
        [`/sap/bc/adt/cts/transportrequests/${request}`, `/sap/bc/adt/cts/transportrequests/${task}`].includes(
          uri.pathname,
        )
      ) {
        if (!requestCreated) throw new Error('Read before request create');
        return reply(
          200,
          requestXml(graph, moved, apiTouched).replaceAll('A4HK999991', request).replaceAll('A4HK999992', task),
        );
      }
      if (uri.pathname === '/sap/bc/adt/refactorings') {
        if (uri.searchParams.get('step') === 'execute') moved = true;
        return reply(
          200,
          buildPreviewXml({
            objectUri: graph.clas.owner,
            objectName: graph.clas.name,
            objectType: 'CLAS/OC',
            oldPackage: graph.child.name,
            newPackage: 'ZARC1_DEMO',
            description: graph.clas.description,
            transport: request,
          }),
        );
      }
      if (uri.pathname.startsWith('/sap/bc/adt/apireleases/')) {
        if (r.method === 'PUT') {
          apiReleased = r.body.includes('ars:state="RELEASED"');
          apiTouched = true;
        }
        return reply(200, apiXml(graph, apiReleased));
      }
      if (uri.pathname === '/sap/bc/adt/cts/transportchecks') {
        const pkg = /<DEVCLASS>([^<]+)<\/DEVCLASS>/.exec(r.body)?.[1],
          op = /<OPERATION>([^<]*)<\/OPERATION>/.exec(r.body)?.[1] ?? '';
        if (pkg === 'ZARC1_DEMO')
          return reply(
            200,
            `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION>${op}</OPERATION><RECORDING>X</RECORDING><KORRFLAG>X</KORRFLAG><LOCKS/><RESULT>S</RESULT><REQUESTS><item><TRKORR>${request}</TRKORR><TRFUNCTION>K</TRFUNCTION><TRSTATUS>D</TRSTATUS><AS4USER>MARIAN</AS4USER></item></REQUESTS></DATA>`,
          );
        return reply(
          200,
          `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${op}</OPERATION><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>`,
        );
      }
      if (uri.searchParams.get('_action') === 'LOCK')
        return reply(
          200,
          `<DATA><LOCK_HANDLE>SECRET-HANDLE</LOCK_HANDLE><CORRNR>${moved && uri.pathname === graph.clas.owner ? request : ''}</CORRNR><IS_LOCAL>${moved && uri.pathname === graph.clas.owner ? '' : 'X'}</IS_LOCAL></DATA>`,
          {
            'set-cookie': 'sap-contextid=SECRET-SESSION; Path=/',
          },
        );
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(200);
      if (uri.pathname === '/sap/bc/adt/packages' && r.method === 'POST') {
        const owner = r.body.includes(`name="${graph.child.name}"`) ? graph.child : graph.root;
        existing.add(owner.owner);
        return reply(201);
      }
      if (uri.pathname === '/sap/bc/adt/oo/interfaces' && r.method === 'POST') {
        existing.add(intf.owner);
        return reply(201);
      }
      if (uri.pathname === '/sap/bc/adt/oo/classes' && r.method === 'POST') {
        existing.add(graph.clas.owner);
        return reply(201);
      }
      if (uri.pathname === '/sap/bc/adt/activation') {
        if (uri.searchParams.get('preauditRequested') === 'true')
          return reply(
            200,
            `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">${[intf, graph.clas].map((o) => `<ioc:entry><ioc:object><ioc:ref xmlns:adtcore="${core}" adtcore:uri="${o.owner}" adtcore:name="${o.name}"/></ioc:object></ioc:entry>`).join('')}</ioc:inactiveObjects>`,
          );
        active = true;
        return reply(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
        );
      }
      if (uri.pathname === '/sap/bc/adt/repository/nodestructure') return reply(200, '');
      const owner = [graph.root, graph.child, graph.clas, intf].find(
        (o) =>
          uri.pathname === o.owner ||
          uri.pathname.toLowerCase() === o.owner.toLowerCase() ||
          uri.pathname.toLowerCase() === `${o.owner}/source/main`.toLowerCase(),
      );
      if (!owner) throw new Error(`Unexpected mock request ${r.method} ${r.path}`);
      if (r.method === 'DELETE') {
        if (
          (owner.kind === 'root' && (existing.has(graph.child.owner) || existing.has(intf.owner))) ||
          (owner.kind === 'child' && existing.has(graph.clas.owner) && !moved)
        )
          return reply(500, nonempty(owner as PackageOwner));
        existing.delete(owner.owner);
        return reply(200);
      }
      if (!existing.has(owner.owner)) return reply(404, absent);
      if (owner.kind === 'interface') {
        if (uri.pathname.endsWith('/source/main')) {
          if (r.method === 'PUT') intfSource = r.body;
          return reply(200, intfSource, { 'content-type': 'text/plain' });
        }
        return reply(
          200,
          retained?.metadata[intf.owner] ??
            `<i:abapInterface xmlns:i="http://www.sap.com/adt/oo/interfaces" xmlns:adtcore="${core}" adtcore:name="${intf.name}" adtcore:type="INTF/OI" adtcore:description="${intf.description}" adtcore:version="${active ? 'active' : 'inactive'}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN"><adtcore:packageRef adtcore:name="${graph.root.name}" adtcore:type="DEVC/K"/></i:abapInterface>`,
        );
      }
      if (owner.kind !== 'class') {
        let metadata = retained?.metadata[owner.owner];
        if (metadata && owner.kind === 'root' && !existing.has(graph.child.owner))
          metadata = metadata.replace(/<pak:subPackages>[\s\S]*?<\/pak:subPackages>/, '<pak:subPackages/>');
        return reply(
          200,
          metadata ?? packageMetadata(owner, owner.kind === 'root' && existing.has(graph.child.owner), graph),
        );
      }
      if (uri.pathname.endsWith('/source/main')) {
        if (r.method === 'PUT') source = r.body;
        return reply(200, source, { 'content-type': 'text/plain' });
      }
      return reply(
        200,
        (retained?.metadata[owner.owner] ?? classMetadata(active, graph)).replace(
          `adtcore:name="${graph.child.name}"`,
          `adtcore:name="${moved ? 'ZARC1_DEMO' : graph.child.name}"`,
        ),
      );
    })
    .persist();
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    language: 'EN',
    username: 'MARIAN',
    password: 'SYNTHETIC-PASSWORD',
    safety: packageSafety(graph, true, retainedApi),
    adtSemaphore: options.semaphore,
    ...(options.proxy
      ? {
          btpProxy: {
            host: 'proxy.invalid',
            port: 20003,
            protocol: 'http' as const,
            getProxyToken: options.token ?? (async () => 'synthetic-token'),
          },
        }
      : options.token
        ? { bearerTokenProvider: options.token }
        : {}),
  });
  const run = (freshUntil = Date.now() + 240_000) =>
    (options.movedApi
      ? runNativePackageApiMovedTail
      : retainedApi
        ? runNativePackageApiRetainedTail
        : runNativePackageApi)({
      base: client,
      graph,
      freshUntil,
      record: (r) => {
        records.push(r);
        hooks.record?.(r);
      },
      verify: () => {
        hooks.verify?.();
        if (broken) throw new Error('Synthetic source changed.');
      },
      shouldStop: () => stopped,
    });
  return {
    client,
    calls,
    records,
    existing,
    hooks,
    run,
    stop: () => {
      stopped = true;
    },
    breakSource: () => {
      broken = true;
    },
  };
}

export function recordedPackageXml() {
  return packageMetadata({
    name: 'ZARC1_DEMO',
    owner: '/sap/bc/adt/packages/ZARC1_DEMO',
    description: 'ARC1 PK root recorded-reference',
    parent: '',
    kind: 'root',
  })
    .replace('p:recordChanges="false"', 'p:recordChanges="true"')
    .replace('p:name="LOCAL"', 'p:name="HOME"');
}
export function requestXml(g = graph, moved = false, api = false) {
  const record = (type: string, name: string, pos: string) =>
    `<tm:abap_object tm:pgmid="R3TR" tm:type="${type}" tm:name="${name}" tm:position="${pos}" tm:lock_status="X"/>`;
  return `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK999991" tm:type="K" tm:owner="MARIAN" tm:desc="ARC1 package API ${g.suffix}" tm:status="D" tm:target="" tm:source_client="001"><tm:task tm:number="A4HK999992" tm:type="Unclassified" tm:owner="MARIAN" tm:status="D" tm:target="">${moved ? record('CLAS', g.clas.name, '000001') : ''}${api ? record('APIS', `${g.clas.name.padEnd(35)}CLAS`, '000002') : ''}</tm:task></tm:request></tm:root>`;
}
const apiTemplate = readFileSync(new URL('../../fixtures/xml/api-release-unreleased.xml', import.meta.url), 'utf8');
export function apiXml(g = graph, released = false) {
  let xml = apiTemplate
    .replaceAll('ZCL_ARC1_APIFIX                     CLAS', `${g.clas.name.padEnd(35)}CLAS`)
    .replaceAll(
      `ZCL_ARC1_APIFIX${encodeURIComponent('                     CLAS')}`,
      encodeURIComponent(`${g.clas.name.padEnd(35)}CLAS`),
    )
    .replaceAll('ZCL_ARC1_APIFIX', g.clas.name)
    .replaceAll('zcl_arc1_apifix', g.clas.name.toLowerCase())
    .replaceAll('$TMP', 'ZARC1_DEMO');
  if (released)
    xml = xml
      .replace('ars:isAnyContractReleased="false"', 'ars:isAnyContractReleased="true"')
      .replace(/(<ars:c1Release[\s\S]*?<ars:status ars:state=)"NOT_RELEASED"/, '$1"RELEASED"')
      .replace(/(<ars:c1Release[^>]*ars:useInSAPCloudPlatform=)"false"/, '$1"true"');
  return xml;
}
