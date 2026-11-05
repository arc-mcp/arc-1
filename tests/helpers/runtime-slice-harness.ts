import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, type Mock, vi } from 'vitest';

const proxy = vi.hoisted(() => ({ pool: undefined as any }));
vi.mock('undici', async (original) => {
  const actual = await original<typeof import('undici')>();
  return {
    ...actual,
    Client: class {
      request(options: any) {
        const url = new URL(options.path);
        return proxy.pool.request({ ...options, path: url.pathname + url.search });
      }
      async close() {}
    },
  };
});
vi.mock('../../scripts/qualification/pr1142/native-flp-evidence.js', () => ({
  flpNativeEvidence: { metadataHash: createHash('sha256').update('<synthetic/>').digest('hex') },
}));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
const { AdtClient } = await import('../../src/adt/client.js');
const { defaultSafetyConfig } = await import('../../src/adt/safety.js');
const { runRuntimeSlice } = await import('../../scripts/qualification/pr1142/native-runtime-slice-driver.js');
const {
  runtimeConfig,
  runtimeFixture: f,
  runtimeClassOwner: owner,
  runtimeStoredSource,
  runtimeProposal,
  RUNTIME_STAGES,
} = await import('../../scripts/qualification/pr1142/native-runtime-slice-fixed.js');
const {
  FORMATTER_SETTINGS_PATH: formatter,
  FORMATTER_SETTINGS_CONTENT_TYPE: formatterType,
  parsePinnedFormatterDocument,
} = await import('../../src/adt/pinned-formatter.js');
const { ST05_STATE_URL: st05, ST05_STATE_CONTENT_TYPE: st05Type } = await import('../../src/adt/diagnostics.js');
const { TRACE_BASE } = await import('../../src/adt/trace-requests.js');
const { FLP_SERVICE } = await import('../../scripts/qualification/pr1142/native-flp-fixed.js');
const missingFlp = readFileSync(new URL('../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8');
const st05Xml = readFileSync(new URL('../fixtures/xml/st05-trace-state.xml', import.meta.url), 'utf8');
const formatterXml =
  '<p:PrettyPrinterSettings xmlns:p="http://www.sap.com/adt/prettyprintersettings" p:indentation="true" p:style="keywordUpper" extra="keep"/>';
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>';
const previous = getGlobalDispatcher(),
  origin = 'https://runtime.invalid';
let agent: InstanceType<typeof MockAgent>, calls: any[], rows: any[];
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  proxy.pool = agent.get(origin);
  calls = [];
  rows = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  setGlobalDispatcher(previous);
  await agent.close();
  expect(JSON.stringify(rows)).not.toContain('secret-lock');
  expect(JSON.stringify(rows)).not.toContain('own-context-secret');
});
function harness(
  stage: (typeof RUNTIME_STAGES)[number],
  useProxy = false,
  change?: (call: any, state: any, response: any) => any,
): {
  input: {
    base: InstanceType<typeof AdtClient>;
    stage: (typeof RUNTIME_STAGES)[number];
    deadline: number;
    record: (row: unknown) => void;
    verifySource: Mock<() => void>;
    shouldStop: () => boolean;
  };
  state: Record<string, any>;
  run: () => ReturnType<typeof runRuntimeSlice>;
  setProvider: (next: () => Promise<string>) => void;
} {
  const state = {
    formatter: formatterXml,
    st05: st05Xml,
    armed: false,
    expires: '',
    exists: false,
    source: runtimeStoredSource,
    saved: false,
    group: false,
    catalog: false,
    tile: undefined as any,
    member: undefined as any,
  };
  const requestId = `${TRACE_BASE}/requests/server%2c1%2c20261103`;
  const feed = () =>
    `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">${state.armed ? `<atom:entry><atom:author trc:role="admin" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN</atom:name></atom:author><atom:author trc:role="trace" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN</atom:name></atom:author><atom:id>${requestId}</atom:id><atom:content src="${requestId}"/><atom:title>${f.title}</atom:title><trc:extendedData xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><trc:client trc:role="trace">001</trc:client><trc:expires>${state.expires}</trc:expires><trc:processType trc:processTypeId="${TRACE_BASE}/processtypes/dialog"/><trc:object trc:objectTypeId="${TRACE_BASE}/objecttypes/transaction"/><trc:executions trc:maximal="1" trc:completed="0"/></trc:extendedData></atom:entry>` : ''}</atom:feed>`;
  const catalogKey = `X-SAP-UI2-CATALOGPAGE:${f.catalogId}`;
  const entity = (catalog: boolean, page: boolean) =>
    catalog && !page
      ? {
          id: catalogKey,
          domainId: f.catalogId,
          title: f.title,
          type: 'CATALOG_PAGE',
          scope: 'CUSTOMIZING',
          isReadOnly: '',
          chipCount: state.tile ? '1' : '0',
        }
      : {
          id: catalog ? catalogKey : f.groupId,
          title: f.title,
          catalogId: catalog ? '' : '/UI2/FLPD_CATALOG',
          scope: 'CUSTOMIZING',
          isCatalogPage: catalog ? 'X' : '',
          isReadOnly: '',
          layout: '',
        };
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
    agent
      .get(origin)
      .intercept({ method, path: /.*/ })
      .reply((options) => {
        const url = new URL(options.path, origin),
          path = url.pathname,
          body = String(options.body ?? '');
        const call = { method, path: options.path, body };
        calls.push(call);
        const xml = (body: string, status = 200, type = 'application/xml') => ({
          status,
          body,
          headers: { 'content-type': type },
        });
        const json = (d: unknown, status = 200) => ({
          status,
          body: JSON.stringify({ d }),
          headers: { 'content-type': 'application/json' },
        });
        let response: any = { status: 599, body: 'unexpected synthetic path' };
        if (method === 'HEAD')
          response = {
            status: 200,
            body: '',
            headers: { 'x-csrf-token': 'test', 'set-cookie': 'sap-contextid=own-context-secret' },
          };
        else if (path === '/sap/bc/adt/core/http/sessions')
          response = { status: 200, body: '', headers: { 'set-cookie': 'sap-contextid=0' } };
        else if (path === formatter) {
          if (method === 'PUT') state.formatter = body;
          response = xml(method === 'PUT' ? '' : state.formatter, method === 'PUT' ? 204 : 200, formatterType);
        } else if (path === st05) {
          // Captured kernel OFF clears the user filter; it does not echo the submitted MARIAN filter.
          if (method === 'PUT')
            state.st05 = body.includes('<ts:sqlOn>false</ts:sqlOn>')
              ? body.replace('<ts:traceUser>MARIAN</ts:traceUser>', '<ts:traceUser/>')
              : body;
          response = xml(method === 'PUT' ? '' : state.st05, method === 'PUT' ? 204 : 200, st05Type);
        } else if (path === `${TRACE_BASE}/parameters`)
          response = { status: 201, body: '', headers: { location: `${TRACE_BASE}/parameters/123` } };
        else if (path === `${TRACE_BASE}/requests`) {
          if (method === 'POST') {
            state.armed = true;
            state.expires = url.searchParams.get('expires')!;
          }
          response = xml(feed());
        } else if (method === 'DELETE' && path === requestId) {
          state.armed = false;
          response = { status: 204, body: '' };
        } else if (path === owner && url.searchParams.get('_action') === 'LOCK')
          response = xml('<DATA><LOCK_HANDLE>secret-lock</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL><CORRNR/></DATA>');
        else if (path === owner && url.searchParams.get('_action') === 'UNLOCK') response = xml('');
        else if (path === owner && method === 'DELETE') {
          state.exists = false;
          response = { status: 204, body: '' };
        } else if (path === owner)
          response = state.exists
            ? xml(
                `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${f.className}" adtcore:type="CLAS/OC" adtcore:description="${f.title}" adtcore:createdBy="MARIAN" adtcore:version="${state.saved ? 'inactive' : 'new'}"><adtcore:packageRef adtcore:name="$TMP"/></c:abapClass>`,
              )
            : xml(absent, 404);
        else if (path === `${owner}/source/main`) {
          if (method === 'PUT') {
            state.source = body;
            state.saved = true;
          }
          response = xml(state.source, 200, 'text/plain');
        } else if (path === '/sap/bc/adt/oo/classes' && method === 'POST') {
          state.exists = true;
          response = { status: 201, body: '', headers: { location: owner } };
        } else if (path === '/sap/bc/adt/cts/transportchecks')
          response = xml(
            `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${body.includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
          );
        else if (path === '/sap/bc/adt/quickfixes/evaluation')
          response = xml(
            `<q:evaluationResults xmlns:q="http://www.sap.com/adt/quickfixes" xmlns:a="http://www.sap.com/adt/core"><evaluationResult><a:objectReference a:uri="${runtimeProposal}" a:type="quickfix/proposal"/><userContent>opaque</userContent></evaluationResult></q:evaluationResults>`,
          );
        else if (path === runtimeProposal)
          response =
            xml(`<q:proposalResult xmlns:q="http://www.sap.com/adt/quickfixes" xmlns:a="http://www.sap.com/adt/core"><deltas><unit><content>DATA lv_missing TYPE i.
</content><a:objectReference a:uri="${owner}/source/main#start=8,4;end=8,4"/></unit></deltas></q:proposalResult>`);
        else if (path === `${FLP_SERVICE}/$metadata`) response = xml('<synthetic/>');
        else if (path.startsWith(FLP_SERVICE)) {
          const catalog = decodeURIComponent(path).includes(catalogKey),
            page = path.includes('/Pages(');
          if (method === 'POST') {
            const data = JSON.parse(body);
            if (path.endsWith('/Catalogs')) {
              state.catalog = true;
              response = json(entity(true, false), 201);
            } else if (path.endsWith('/Pages')) {
              state.group = true;
              response = json(entity(false, true), 201);
            } else if (data.pageId === catalogKey) {
              state.tile = { ...data, instanceId: '0001' };
              response = json(state.tile, 201);
            } else {
              state.member = { ...data, instanceId: '0002' };
              response = json(state.member, 201);
            }
          } else if (method === 'DELETE') {
            if (catalog) {
              state.catalog = false;
              state.tile = undefined;
            } else {
              state.group = false;
              state.member = undefined;
            }
            response = { status: 204, body: '' };
          } else if (path.endsWith('/Bags')) response = json({ results: [], __count: '0' });
          else if (path.endsWith('/PageChipInstances')) {
            const item = catalog ? state.tile : state.member;
            response = json({ results: item ? [item] : [], __count: item ? '1' : '0' });
          } else
            response = (catalog ? state.catalog : state.group)
              ? json(entity(catalog, page))
              : { status: 404, body: missingFlp };
        }
        response = change?.(call, state, response) ?? response;
        return {
          statusCode: response.status,
          data: response.body,
          responseOptions: { headers: response.headers ?? {} },
        };
      })
      .persist();
  let provider = async () => 'synthetic';
  const config = runtimeConfig();
  const base = new AdtClient({
    baseUrl: origin,
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
    maxConcurrent: 1,
    ...(useProxy
      ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 80, getProxyToken: () => provider() } }
      : { bearerTokenProvider: () => provider() }),
  });
  const input = {
    base,
    stage,
    deadline: Date.now() + 120000,
    record: (row: unknown) => {
      rows.push(row);
    },
    verifySource: vi.fn<() => void>(),
    shouldStop: () => false,
  };
  return {
    input,
    state,
    run: () => runRuntimeSlice(input),
    setProvider: (next: () => Promise<string>) => {
      provider = next;
    },
  };
}

export {
  AdtClient,
  calls,
  defaultSafetyConfig,
  FLP_SERVICE,
  f,
  formatter,
  formatterType,
  formatterXml,
  harness,
  origin,
  owner,
  parsePinnedFormatterDocument,
  RUNTIME_STAGES,
  rows,
  runRuntimeSlice,
  runtimeConfig,
  runtimeProposal,
  runtimeStoredSource,
  st05,
  st05Type,
  st05Xml,
  TRACE_BASE,
};
