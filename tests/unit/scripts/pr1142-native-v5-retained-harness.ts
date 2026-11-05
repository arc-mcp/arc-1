/** Real private adapters, entirely synthetic HTTP. Every dispatcher and OS socket is guarded. */
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  originalService,
  retainedService,
  retainedView,
  revisedLabel,
} from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';

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
export const { runRetainedContinuation } = await import(
  '../../../scripts/qualification/pr1142/native-v5-retained-driver.js'
);
export const { recoveryConfig } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js'
);
export const serviceMetadata = readFileSync(
  new URL('../../fixtures/xml/pr1142-v5-retained-service.xml', import.meta.url),
  'utf8',
);
export const viewMetadata = readFileSync(
  new URL('../../fixtures/xml/pr1142-v5-retained-view.xml', import.meta.url),
  'utf8',
);
export const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>';
const core = 'http://www.sap.com/adt/core',
  ns = 'http://www.sap.com/abapxml/inactiveCtsObjects';
let agent: MockAgent,
  prior: ReturnType<typeof getGlobalDispatcher>,
  sequence = 0;
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_SOCKET_GUARD');
  });
  prior = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  sequence = 0;
});
afterEach(async () => {
  setGlobalDispatcher(prior);
  await agent.close();
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
export function retainedHarness(
  options: {
    proxy?: boolean;
    token?: () => Promise<string>;
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    reflectLabel?: boolean;
  } = {},
) {
  const origin = `https://retained-v5-${++sequence}.invalid`,
    existing = new Set([retainedService.owner, retainedView.owner]);
  const calls: { method: string; path: string; body: string }[] = [],
    records: any[] = [];
  let source = originalService.source,
    activeSource: string | undefined,
    draft = true,
    changed = 0,
    broken = false,
    stopped = false;
  const hooks: {
    before?: (r: (typeof calls)[number]) => void;
    reply?: (r: (typeof calls)[number]) => { statusCode: number; data: string } | undefined;
    record?: (r: any) => void;
    verify?: () => void;
  } = {};
  function metadata(version: string | null) {
    if (!changed) return serviceMetadata;
    const active = activeSource !== undefined && (version === 'active' || !draft);
    const label =
      options.reflectLabel && (active ? activeSource : source)?.includes(revisedLabel)
        ? revisedLabel
        : originalService.description;
    let value = serviceMetadata
      .replace('adtcore:version="inactive"', `adtcore:version="${active ? 'active' : 'inactive'}"`)
      .replace('2026-11-03T08:41:21Z', `2026-11-03T09:00:${String(changed).padStart(2, '0')}Z`)
      .replace(`adtcore:description="${originalService.description}"`, `adtcore:description="${label}"`);
    if (draft && activeSource !== undefined)
      value = value.replace(
        '<adtcore:packageRef',
        `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${retainedService.name.toLowerCase()}?version=${active ? 'inactive' : 'active'}"/><adtcore:packageRef`,
      );
    return value;
  }
  const reply = (statusCode: number, data = '', headers: Record<string, string> = {}) => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': 'application/xml', ...headers } },
  });
  agent
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
          `<i:inactiveObjects xmlns:i="${ns}">${existing.has(retainedService.owner) && draft ? `<i:entry><i:object i:user="MARIAN" i:deleted="false"><i:ref xmlns:c="${core}" c:uri="${retainedService.owner}" c:name="${retainedService.name}" c:type="SRVD/SRV"/></i:object><i:transport/></i:entry>` : ''}</i:inactiveObjects>`,
        );
      if (uri.pathname === '/sap/bc/adt/cts/transportchecks') {
        const op = /<OPERATION>([^<]*)<\/OPERATION>/.exec(r.body)?.[1] ?? '';
        return reply(
          200,
          `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${op}</OPERATION><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>`,
        );
      }
      if (uri.searchParams.get('_action') === 'LOCK')
        return reply(
          200,
          '<DATA><LOCK_HANDLE>RETAINED-SECRET-HANDLE</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>',
          { 'set-cookie': 'sap-contextid=RETAINED-SECRET-SESSION; Path=/' },
        );
      if (uri.searchParams.get('_action') === 'UNLOCK') return reply(200);
      if (uri.pathname === '/sap/bc/adt/activation') {
        if (uri.searchParams.get('preauditRequested') === 'true')
          return reply(
            200,
            `<i:inactiveObjects xmlns:i="${ns}"><i:entry><i:object><i:ref xmlns:c="${core}" c:uri="${retainedService.owner}" c:name="${retainedService.name}"/></i:object></i:entry></i:inactiveObjects>`,
          );
        activeSource = source;
        draft = false;
        changed++;
        return reply(
          200,
          '<c:messages xmlns:c="http://www.sap.com/abapxml/checklist"><c:properties activationExecuted="true"/></c:messages>',
        );
      }
      const fixture = [retainedService, retainedView].find(
        (f) => uri.pathname === f.owner || uri.pathname === `${f.owner}/source/main`,
      );
      if (!fixture || !existing.has(fixture.owner)) return reply(404, absent);
      if (r.method === 'DELETE') {
        existing.delete(fixture.owner);
        return reply(200);
      }
      if (uri.pathname.endsWith('/source/main')) {
        if (r.method === 'PUT') {
          expect(fixture).toBe(retainedService);
          source = r.body;
          draft = true;
          changed++;
        }
        return reply(
          200,
          fixture === retainedView
            ? retainedView.updatedSource
            : uri.searchParams.get('version') === 'active' && activeSource !== undefined
              ? activeSource
              : source,
          { 'content-type': 'text/plain' },
        );
      }
      return reply(200, fixture === retainedView ? viewMetadata : metadata(uri.searchParams.get('version')));
    })
    .persist();
  const client = new AdtClient({
    baseUrl: origin,
    client: '001',
    username: 'MARIAN',
    password: 'SYNTHETIC-ONLY',
    safety: recoveryConfig,
    adtSemaphore: options.semaphore,
    ...(options.proxy
      ? {
          btpProxy: {
            host: 'proxy.invalid',
            port: 20003,
            protocol: 'http' as const,
            getProxyToken: options.token ?? (async () => 'synthetic'),
          },
        }
      : options.token
        ? { bearerTokenProvider: options.token }
        : {}),
  });
  const run = (deadline = Date.now() + 240_000) =>
    runRetainedContinuation({
      base: client,
      deadline,
      record: (r) => {
        records.push(r);
        hooks.record?.(r);
      },
      verifySource: () => {
        hooks.verify?.();
        if (broken) throw new Error('Synthetic binding drift.');
      },
      shouldStop: () => stopped,
    });
  return {
    origin,
    client,
    calls,
    records,
    existing,
    hooks,
    run,
    breakSource: () => {
      broken = true;
    },
    stop: () => {
      stopped = true;
    },
    metadata,
  };
}
