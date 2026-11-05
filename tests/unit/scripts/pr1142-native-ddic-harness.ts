/** Real undici dispatchers, including activation/proxy paths, are confined to a MockAgent .invalid origin. */
import { Socket } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { DdicFixture } from '../../../scripts/qualification/pr1142/native-ddic-fixtures.js';
import type {
  DdicWorkflowFixture,
  DdicWorkflowInput,
} from '../../../scripts/qualification/pr1142/native-ddic-workflow.js';
import { nativeMessageSave } from './pr1142-native-msag-store.js';

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
export const { ddicFixtures, DDIC_STAGES, DDIC_PROTOCOL } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-fixtures.js'
);
export const { ddicRuntime, ddicClient } = await import('../../../scripts/qualification/pr1142/native-ddic-runner.js');
export const { runNativeDdic } = await import('../../../scripts/qualification/pr1142/native-ddic-driver.js');
export const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
export const fixtures = ddicFixtures('0123456789ABCDEF');
const core = 'http://www.sap.com/adt/core',
  absent =
    '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>';
let mock: MockAgent,
  prior: ReturnType<typeof getGlobalDispatcher>,
  sequence = 0;
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('Offline DDIC socket forbidden.');
  });
  resetCachedFeatures();
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
  resetCachedFeatures();
});
export function ddicHarness<F extends DdicWorkflowFixture = DdicFixture>(
  options: {
    fixtures?: F[];
    execute?: (input: DdicWorkflowInput<F>) => ReturnType<typeof runNativeDdic>;
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    token?: () => Promise<string>;
    proxy?: boolean;
  } = {},
) {
  const selectedFixtures = options.fixtures ?? (fixtures as unknown as F[]);
  const execute =
    options.execute ?? (runNativeDdic as unknown as (input: DdicWorkflowInput<F>) => ReturnType<typeof runNativeDdic>);
  const origin = `https://native-ddic-${++sequence}.invalid`;
  const world = {
    objects: new Map<string, { metadata: string; nativeType: string; source?: string }>(),
    faults: new Set<string>(),
    calls: [] as { path: string; method: string; body: string }[],
    unexpected: [] as string[],
  };
  const records: any[] = [],
    hooks: {
      record?: (row: any) => void;
      before?: (url: URL, init: any) => void;
      verify?: () => void;
      reply?: (
        url: URL,
        method: string,
        body: string,
      ) => { statusCode: number; data: string; responseOptions?: { headers: Record<string, string> } } | undefined;
    } = {};
  let stopped = false,
    broken = false;
  const useFixtures = (rows = selectedFixtures) => {
    world.objects.clear();
    for (const f of rows)
      world.objects.set(f.owner, {
        metadata: '',
        nativeType: (
          {
            DOMA: 'DOMA/DD',
            DTEL: 'DTEL/DE',
            'TABL/DS': 'TABL/DS',
            'TABL/DT': 'TABL/DT',
            'TABL/DTT': 'TABL/DTT',
            'TABL/DTI': 'TABL/DTI',
            ENQU: 'ENQU/DL',
            TTYP: 'TTYP/DA',
            MSAG: 'MSAG/N',
          } as Record<string, string>
        )[f.type],
        ...(['TABL/DS', 'TABL/DT', 'TABL/DTI'].includes(f.type)
          ? { source: 'Native generated structure template' }
          : {}),
      });
  };
  useFixtures();
  const store = (body: string, type: string, version: string) => {
    const start = body.indexOf('<', body.startsWith('<?xml') ? body.indexOf('?>') + 2 : 0),
      end = body.indexOf('>', start);
    let open = body.slice(start, end).replace(/\s+adtcore:(?:type|version|createdBy|changedBy)="[^"]*"/g, '');
    open += ` adtcore:type="${type}" adtcore:version="${version}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN"`;
    return (body.slice(0, start) + open + body.slice(end))
      .replace(/(<adtcore:packageRef\b)(?![^>]*adtcore:type=)/, '$1 adtcore:type="DEVC/K"')
      .replace('adtcore:masterSystem="H00"', 'adtcore:masterSystem="A4H"');
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
      const chunks: Buffer[] = [];
      const input = options.body as any;
      let body: string;
      if (input?.[Symbol.asyncIterator]) {
        for await (const chunk of input) chunks.push(Buffer.from(chunk));
        body = Buffer.concat(chunks).toString('utf8');
      } else body = String(input ?? '');
      const method = String(options.method),
        path = uri.pathname;
      world.calls.push({ method, path: path + uri.search, body });
      hooks.before?.(uri, { method, body });
      const custom = hooks.reply?.(uri, method, body);
      if (custom) return custom;
      if (method === 'HEAD') return reply(200, '', { 'x-csrf-token': 'synthetic-token' });
      if (path === '/sap/bc/adt/core/http/sessions') return reply(200);
      if (path === '/sap/bc/adt/activation/inactiveobjects')
        return reply(200, '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"/>');
      if (uri.searchParams.get('_action') === 'LOCK')
        return reply(200, '<DATA><LOCK_HANDLE>native-lock</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>', {
          'set-cookie': 'sap-contextid=owned; Path=/',
        });
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(world.faults.has('unlock') ? 503 : 200);
      if (path === '/sap/bc/adt/cts/transportchecks')
        return reply(
          200,
          `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${body.includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
        );
      if (path === '/sap/bc/adt/repository/informationsystem/search') {
        const name = uri.searchParams.get('query');
        const found = [...world.objects].filter(([owner, o]) => owner.endsWith(`/${name}`) && o.metadata);
        return reply(
          200,
          `<adtcore:objectReferences xmlns:adtcore="${core}">${found.map(([owner, o]) => `<adtcore:objectReference adtcore:name="${name}" adtcore:type="${o.nativeType}" adtcore:uri="${owner}" adtcore:packageName="$TMP"/>`).join('')}</adtcore:objectReferences>`,
        );
      }
      if (path.endsWith('/source/main')) {
        const o = world.objects.get(path.slice(0, -12));
        if (!o?.metadata || o.source === undefined) return reply(404, absent);
        if (method === 'GET') return reply(200, o.source, { 'content-type': 'text/plain' });
        if (method === 'PUT') {
          if (world.faults.has('save-unknown')) return reply(503);
          if (!world.faults.has('readback')) o.source = body;
          o.metadata = o.metadata.replace(/adtcore:version="(?:active|new)"/, 'adtcore:version="inactive"');
          return reply(200);
        }
      }
      if (path === '/sap/bc/adt/activation') {
        const uriValue = /adtcore:uri="([^"]*)"/.exec(body)?.[1],
          nameValue = /adtcore:name="([^"]*)"/.exec(body)?.[1];
        const ref = uriValue && nameValue ? ['', uriValue, nameValue] : undefined;
        if (!ref) return reply(599, 'bad activation');
        if (uri.searchParams.get('preauditRequested') === 'true')
          return reply(
            200,
            `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref adtcore:uri="${ref[1]}" adtcore:name="${ref[2]}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          );
        const o = world.objects.get(ref[1]);
        if (o && !world.faults.has('still-inactive'))
          o.metadata = o.metadata.replace(/adtcore:version="(?:inactive|new)"/, 'adtcore:version="active"');
        return reply(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
        );
      }
      if (method === 'POST')
        for (const [owner, value] of world.objects)
          if (owner.startsWith(`${path}/`) && !value.metadata) {
            if (world.faults.has('create-unknown')) return reply(503);
            value.metadata = store(body, value.nativeType, 'inactive');
            return reply(201, value.metadata);
          }
      const o = world.objects.get(path);
      if (!o?.metadata) return reply(404, absent);
      if (method === 'GET') return reply(200, o.metadata);
      if (method === 'PUT') {
        if (world.faults.has('save-unknown')) return reply(503);
        if (!world.faults.has('readback'))
          o.metadata = store(
            o.nativeType === 'MSAG/N' ? nativeMessageSave(o.metadata, body) : body,
            o.nativeType,
            'inactive',
          );
        return reply(200);
      }
      if (method === 'DELETE') {
        if (world.faults.has('delete-unknown')) return reply(503);
        o.metadata = '';
        return reply(200);
      }
      world.unexpected.push(`${method} ${path}`);
      return reply(599);
    })
    .persist();
  const runtime = {
    ...ddicRuntime,
    execute,
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'SYNTHETIC-ONLY-DDIC',
      SAP_CLIENT: '001',
    })),
    createClient: vi.fn(
      (input: ConstructorParameters<typeof AdtClient>[0]) =>
        new AdtClient({
          ...input,
          baseUrl: origin,
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
        }),
    ),
  };
  const verify = () => {
    hooks.verify?.();
    if (broken) throw new Error('Synthetic source drift.');
  };
  const client = ddicClient(runtime, '/synthetic', verify, true);
  return {
    world,
    records,
    hooks,
    runtime,
    client,
    verify,
    useFixtures,
    breakSource: () => {
      broken = true;
    },
    stop: () => {
      stopped = true;
    },
    run: (rows = selectedFixtures) =>
      execute({
        base: client,
        fixtures: rows,
        freshUntil: Date.now() + 240000,
        record: (r) => {
          records.push(r);
          hooks.record?.(r);
        },
        verify,
        shouldStop: () => stopped,
      }),
  };
}
