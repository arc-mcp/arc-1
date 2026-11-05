/** Synthetic HTTP model, not native evidence. Real Undici dispatch with all external sockets disabled. */
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, vi } from 'vitest';

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
export const { ctsSafety, runNativeCtsRound } = await import(
  '../../../scripts/qualification/pr1142/native-cts-driver.js'
);
export const { ctsFixtures, CTS_BASE, CTS_PROTOCOL, CTS_STEPS } = await import(
  '../../../scripts/qualification/pr1142/native-cts-fixtures.js'
);

import type { CtsGraph, CtsRound, CtsRoundResult } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
export const TM = 'http://www.sap.com/cts/adt/tm',
  CORE = 'http://www.sap.com/adt/core',
  PAK = 'http://www.sap.com/adt/packages';
export const absent =
  '<e:exception xmlns:e="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></e:exception>';
export const packageXml = `<p:package xmlns:p="${PAK}" xmlns:c="${CORE}" c:name="ZARC1_DEMO" c:type="DEVC/K" c:version="active" c:masterSystem="A4H" c:responsible="MARIAN"><c:packageRef c:name="ZARC1_DEMO"/><p:attributes p:packageType="development" p:recordChanges="true" p:isAddingObjectsAllowed="false"/><p:transport><p:softwareComponent p:name="HOME"/><p:transportLayer p:name=""/></p:transport></p:package>`;
let mock: MockAgent,
  prior: ReturnType<typeof getGlobalDispatcher>,
  sequence = 0;
beforeEach(() => {
  prior = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});
afterEach(async () => {
  setGlobalDispatcher(prior);
  await mock.close();
  vi.restoreAllMocks();
});
export function harness(
  graph: CtsGraph = ctsFixtures('0123456789ABCDEF'),
  options: {
    proxy?: boolean;
    token?: () => Promise<string>;
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    creationResponse?: 'organizer' | 'bare' | 'legacy-record';
  } = {},
) {
  const creationResponse = options.creationResponse,
    origin = `https://native-cts-${++sequence}.invalid`,
    calls: { method: string; path: string; body: string }[] = [],
    records: any[] = [],
    unexpected: string[] = [];
  const trees = new Map<
      string,
      {
        parent: string;
        task: string;
        description: string;
        parentStatus: string;
        taskStatus: string;
        taskOwner: string;
        taskType: string;
        taskExists: boolean;
        exists: boolean;
        objects: string[];
      }
    >(),
    classes = new Map<string, { exists: boolean; active: boolean; source: string }>();
  for (const c of graph.classes) classes.set(c.owner, { exists: false, active: false, source: '' });
  let stopped = false,
    broken = false,
    next = 910001;
  const hooks: {
    before?: (r: (typeof calls)[number]) => void;
    reply?: (r: (typeof calls)[number]) => { statusCode: number; data: string } | undefined;
    record?: (r: any) => void;
    verify?: () => void;
  } = {};
  const row = (id: string, kind: 'request' | 'task', tree: ReturnType<typeof trees.get>): string => {
    const t = tree!;
    return `<t:${kind} t:number="${id}" t:parent="${kind === 'task' ? t.parent : ''}" t:owner="${kind === 'task' ? t.taskOwner : 'MARIAN'}" t:desc="${kind === 'request' ? t.description : 'Developer task'}" t:type="${kind === 'request' ? 'K' : t.taskType}" t:status="${kind === 'request' ? t.parentStatus : t.taskStatus}" t:target="" t:source_client="001" t:uri="${CTS_BASE}${id}">${kind === 'request' ? (t.taskExists ? row(t.task, 'task', t) : '') : t.objects.join('')}</t:${kind}>`;
  };
  const xml = (t: ReturnType<typeof trees.get>) =>
    `<t:root xmlns:t="${TM}">${t?.exists ? row(t.parent, 'request', t) : ''}</t:root>`;
  const object = (name: string) =>
    `<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="${name}" t:position="000010" t:lock_status="X" t:obj_desc="Synthetic fixture"/>`;
  const metadata = (owner: string) => {
    const c = graph.classes.find((c) => c.owner === owner)!,
      s = classes.get(owner)!;
    return `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:adtcore="${CORE}" adtcore:name="${c.name}" adtcore:type="CLAS/OC" adtcore:description="${c.description}" adtcore:version="${s.active ? 'active' : 'inactive'}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN"><adtcore:packageRef adtcore:name="ZARC1_DEMO" adtcore:type="DEVC/K"/></c:abapClass>`;
  };
  const reply = (statusCode: number, data = '', headers: Record<string, string> = {}) => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': 'application/xml', ...headers } },
  });
  mock
    .get(origin)
    .intercept({ path: () => true, method: () => true })
    .reply(async (options) => {
      const uri = new URL(options.path, origin);
      uri.searchParams.delete('sap-client');
      uri.searchParams.delete('sap-language');
      let body = '';
      if (options.body && typeof options.body !== 'string' && Symbol.asyncIterator in Object(options.body)) {
        for await (const chunk of options.body as AsyncIterable<Uint8Array | string>)
          body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      } else body = String(options.body ?? '');
      const r = { method: String(options.method), path: uri.pathname + uri.search, body };
      calls.push(r);
      hooks.before?.(r);
      const custom = hooks.reply?.(r);
      if (custom) return reply(custom.statusCode, custom.data);
      if (r.method === 'HEAD') return reply(200, '', { 'x-csrf-token': 'SYNTHETIC-CSRF' });
      if (uri.pathname === '/sap/bc/adt/core/http/sessions') return reply(200);
      if (uri.pathname.toUpperCase() === '/SAP/BC/ADT/PACKAGES/ZARC1_DEMO') return reply(200, packageXml);
      if (uri.pathname === '/sap/bc/adt/activation/inactiveobjects')
        return reply(200, '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"/>');
      if (uri.pathname === '/sap/bc/adt/cts/transports' && r.method === 'POST') {
        const parent = `A4HK${next++}`,
          task = `A4HK${next++}`;
        trees.set(parent, {
          parent,
          task,
          description: /<REQUEST_TEXT>(.*?)<\/REQUEST_TEXT>/.exec(r.body)![1],
          parentStatus: 'D',
          taskStatus: 'D',
          taskOwner: 'MARIAN',
          taskType: 'Unclassified',
          taskExists: true,
          exists: true,
          objects: [],
        });
        const returned =
          creationResponse === 'organizer'
            ? CTS_BASE + parent
            : creationResponse === 'bare'
              ? parent
              : `/com.sap.cts/object_record/${parent}`;
        return reply(200, returned, { 'content-type': 'text/plain' });
      }
      const req = [...trees.values()].find(
        (t) =>
          uri.pathname === CTS_BASE + t.parent ||
          uri.pathname === CTS_BASE + t.task ||
          uri.pathname === `${CTS_BASE + t.parent}/newreleasejobs` ||
          uri.pathname === `${CTS_BASE + t.task}/newreleasejobs`,
      );
      if (req) {
        const isTask = uri.pathname.includes(req.task);
        if (r.method === 'PUT' && r.body.includes('changeowner')) req.taskOwner = uri.searchParams.get('targetuser')!;
        if (r.method === 'PUT' && r.body.includes('removeobject')) req.objects = [];
        if (r.method === 'DELETE') {
          if (isTask) req.taskExists = false;
          else req.exists = false;
        }
        if (r.method === 'POST') {
          if (isTask) req.taskStatus = 'R';
          else req.parentStatus = 'R';
          return reply(200, `<t:root xmlns:t="${TM}"/>`);
        }
        return reply(200, xml(req));
      }
      if (uri.pathname === '/sap/bc/adt/cts/transportchecks') {
        const owner = /<URI>(.*?)<\/URI>/.exec(r.body)![1],
          cls = graph.classes.find((c) => c.owner === owner)!,
          t = [...trees.values()].find((t) => t.description === cls.description),
          op = /<OPERATION>(.*?)<\/OPERATION>/.exec(r.body)?.[1] ?? '';
        const locks = t?.objects.length
          ? `<CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>${t.parent}</TRKORR></REQ_HEADER><TASK_HEADERS><CTS_TASK_HEADER><TRKORR>${t.task}</TRKORR></CTS_TASK_HEADER></TASK_HEADERS></LOCK_HOLDER></CTS_OBJECT_LOCK>`
          : '';
        return reply(
          200,
          `<DATA><DEVCLASS>ZARC1_DEMO</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION>${op}</OPERATION><RESULT>S</RESULT><RECORDING>X</RECORDING><LOCKS>${locks}</LOCKS></DATA>`,
        );
      }
      const cls = graph.classes.find(
        (c) =>
          uri.pathname === c.owner || uri.pathname === `${c.owner}/source/main` || r.body.includes(`name="${c.name}"`),
      );
      if (cls) {
        const s = classes.get(cls.owner)!,
          t = [...trees.values()].find((t) => t.description === cls.description)!;
        if (uri.searchParams.get('_action') === 'LOCK')
          return reply(
            200,
            `<DATA><LOCK_HANDLE>SECRET-HANDLE</LOCK_HANDLE><CORRNR>${t.task}</CORRNR><IS_LOCAL/></DATA>`,
            { 'set-cookie': 'sap-contextid=SECRET-SESSION; Path=/' },
          );
        if (uri.searchParams.get('_action') === 'UNLOCK') return reply(200);
        if (uri.pathname === '/sap/bc/adt/oo/classes' && r.method === 'POST') {
          s.exists = true;
          t.objects = [object(cls.name)];
          t.taskType = 'Development/Correction';
          return reply(201);
        }
        if (uri.pathname === '/sap/bc/adt/activation') {
          if (uri.searchParams.get('preauditRequested') === 'true')
            return reply(
              200,
              `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"><i:entry><i:object><i:ref xmlns:c="${CORE}" c:uri="${cls.owner}" c:name="${cls.name}"/></i:object></i:entry></i:inactiveObjects>`,
            );
          s.active = true;
          return reply(
            200,
            '<c:messages xmlns:c="http://www.sap.com/abapxml/checklist"><c:properties activationExecuted="true"/></c:messages>',
          );
        }
        if (r.method === 'DELETE') {
          s.exists = false;
          t.objects = [object(cls.name)];
          return reply(200);
        }
        if (!s.exists) return reply(404, absent);
        if (uri.pathname.endsWith('/source/main')) {
          if (r.method === 'PUT') s.source = r.body;
          return reply(200, s.source, { 'content-type': 'text/plain' });
        }
        return reply(200, metadata(cls.owner));
      }
      unexpected.push(`${r.method} ${r.path}`);
      throw new Error('Unexpected synthetic native CTS request.');
    })
    .persist();
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    language: 'EN',
    username: 'MARIAN',
    password: 'SYNTHETIC-PASSWORD',
    safety: ctsSafety(),
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
  const run = (round: CtsRound, prior?: CtsRoundResult, extra: Partial<Parameters<typeof runNativeCtsRound>[0]> = {}) =>
    runNativeCtsRound({
      base: client,
      graph,
      round,
      prior,
      freshUntil: Date.now() + 240_000,
      verify: () => {
        hooks.verify?.();
        if (broken) throw new Error('Synthetic source drift.');
      },
      shouldStop: () => stopped,
      record: (r) => {
        records.push(r);
        hooks.record?.(r);
      },
      ...extra,
    });
  return {
    origin,
    graph,
    client,
    calls,
    records,
    trees,
    classes,
    hooks,
    run,
    xml,
    metadata,
    unexpected,
    stop: () => {
      stopped = true;
    },
    breakSource: () => {
      broken = true;
    },
    assertSafe: () => {
      expect(unexpected).toEqual([]);
      expect(JSON.stringify(records)).not.toMatch(/SECRET-HANDLE|SECRET-SESSION|SYNTHETIC-PASSWORD|synthetic-token/);
    },
  };
}
