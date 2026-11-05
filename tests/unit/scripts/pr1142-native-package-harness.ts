/** Offline real transport fixture: all dispatchers use MockAgent and every Socket.connect is blocked. */
import { Socket } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  type PackageGraph,
  type PackageOwner,
  packageFixtures,
} from '../../../scripts/qualification/pr1142/native-package-fixtures.js';

vi.mock('dotenv', async (original) => ({
  ...(await original<typeof import('dotenv')>()),
  config: vi.fn(() => ({ parsed: {} })),
}));
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
export const { packageSafety, runNativePackageContract } = await import(
  '../../../scripts/qualification/pr1142/native-package-driver.js'
);
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
export function harness(
  options: {
    graph?: PackageGraph;
    retained?: { metadata: Record<string, string>; source: string };
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    proxy?: boolean;
    token?: () => Promise<string>;
  } = {},
) {
  const retained = options.retained;
  const graph = options.graph ?? packageFixtures('0123456789ABCDEF');
  const origin = `https://native-package-${++sequence}.invalid`;
  const existing = new Set<string>(retained ? [graph.root.owner, graph.child.owner, graph.clas.owner] : []),
    calls: { method: string; path: string; body: string }[] = [],
    records: any[] = [];
  let active = !!retained,
    source = retained?.source ?? '',
    stopped = false,
    broken = false;
  const hooks: {
    before?: (r: (typeof calls)[number]) => void;
    reply?: (r: (typeof calls)[number]) => { statusCode: number; data: string } | undefined;
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
      if (custom) return reply(custom.statusCode, custom.data);
      if (r.method === 'HEAD') return reply(200, '', { 'x-csrf-token': 'synthetic-csrf' });
      if (uri.pathname === '/sap/bc/adt/core/http/sessions') return reply(200);
      if (uri.pathname === '/sap/bc/adt/activation/inactiveobjects')
        return reply(
          200,
          '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"><i:unrelated>UNRELATED_DRAFT</i:unrelated></i:inactiveObjects>',
        );
      if (uri.pathname === '/sap/bc/adt/cts/transportchecks') {
        const pkg = /<DEVCLASS>([^<]+)<\/DEVCLASS>/.exec(r.body)?.[1],
          op = /<OPERATION>([^<]*)<\/OPERATION>/.exec(r.body)?.[1] ?? '';
        return reply(
          200,
          `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${op}</OPERATION><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>`,
        );
      }
      if (uri.searchParams.get('_action') === 'LOCK')
        return reply(200, '<DATA><LOCK_HANDLE>SECRET-HANDLE</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>', {
          'set-cookie': 'sap-contextid=SECRET-SESSION; Path=/',
        });
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(200);
      if (uri.pathname === '/sap/bc/adt/packages' && r.method === 'POST') {
        const owner = r.body.includes(`name="${graph.child.name}"`) ? graph.child : graph.root;
        existing.add(owner.owner);
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
            `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"><ioc:entry><ioc:object><ioc:ref xmlns:adtcore="${core}" adtcore:uri="${graph.clas.owner}" adtcore:name="${graph.clas.name}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          );
        active = true;
        return reply(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
        );
      }
      if (uri.pathname === '/sap/bc/adt/repository/nodestructure') return reply(200, '');
      const owner = [graph.root, graph.child, graph.clas].find(
        (o) =>
          uri.pathname === o.owner ||
          uri.pathname.toLowerCase() === o.owner.toLowerCase() ||
          uri.pathname.toLowerCase() === `${o.owner}/source/main`.toLowerCase(),
      );
      if (!owner) throw new Error(`Unexpected mock request ${r.method} ${r.path}`);
      if (r.method === 'DELETE') {
        if (
          (owner.kind === 'root' && existing.has(graph.child.owner)) ||
          (owner.kind === 'child' && existing.has(graph.clas.owner))
        )
          return reply(500, nonempty(owner));
        existing.delete(owner.owner);
        return reply(200);
      }
      if (!existing.has(owner.owner)) return reply(404, absent);
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
      return reply(200, retained?.metadata[owner.owner] ?? classMetadata(active, graph));
    })
    .persist();
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    language: 'EN',
    username: 'MARIAN',
    password: 'SYNTHETIC-PASSWORD',
    safety: packageSafety(graph),
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
    runNativePackageContract({
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
