/**
 * SAPDiagnose action="debug" — one-shot capture orchestration, end to end through handleToolCall
 * over a real AdtClient and a fake SAP (mocked undici fetch).
 *
 * The SAP answers are REFERENCE-DERIVED (abap-adt-api / vibing-steampunk shapes, see
 * docs/research/2026-10-22-abap-debugger-one-shot-capture.md), not live captures.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { maxParallelCaptures, setDebugTimingsForTests } = await import('../../../src/handlers/debug.js');

const CONFIG = { ...DEFAULT_CONFIG, allowDataPreview: true, allowDebug: true };

const CLASS_SOURCE = [
  'CLASS zcl_order DEFINITION PUBLIC FINAL CREATE PUBLIC.',
  '  PUBLIC SECTION.',
  '    METHODS get_total RETURNING VALUE(rv_total) TYPE i.',
  'ENDCLASS.',
  '',
  'CLASS zcl_order IMPLEMENTATION.',
  '  METHOD get_total.',
  '    DATA lv_total TYPE i.',
  '    lv_total = 42.',
  '    rv_total = lv_total.',
  '  ENDMETHOD.',
  'ENDCLASS.',
].join('\n');

const DEBUGGEE_XML = `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><STPDA_DEBUGGEE><CLIENT>001</CLIENT><DEBUGGEE_ID>DBGEE_42</DEBUGGEE_ID><DEBUGGEE_USER>ADMIN</DEBUGGEE_USER><PRG_CURR>ZCL_ORDER=====================CP</PRG_CURR><INCL_CURR>ZCL_ORDER=====================CM001</INCL_CURR><LINE_CURR>3</LINE_CURR><DBGEE_KIND>DEBUGGEE</DBGEE_KIND><IS_ATTACH_IMPOSSIBLE>false</IS_ATTACH_IMPOSSIBLE></STPDA_DEBUGGEE></DATA></asx:values></asx:abap>`;

const AUNIT_PASSED = `<?xml version="1.0" encoding="utf-8"?><aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"><program name="ZCL_ORDER"><testClasses><testClass name="LTCL_ORDER" riskLevel="harmless"><testMethods><testMethod name="TOTAL" executionTime="0.1"/></testMethods></testClass></testClasses></program></aunit:runResult>`;

const ENDED = `<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceFailure"/><message lang="EN">Debuggee ended</message><properties><entry key="com.sap.adt.communicationFramework.subType">debuggeeEnded</entry></properties></exc:exception>`;

const MAIN = '/sap/bc/adt/oo/classes/zcl_order/source/main';
const REPORT = '/sap/bc/adt/programs/programs/zreport/source/main';

/** A source position the fake program passes: the source path and its line. */
interface Position {
  path: string;
  line: number;
}

/** `withUri: false` — SAP leaves the frame's uri out, so only reachedBreakpoints can name the stop.
 *  `inHelper`: the line belongs to HELPER, a method GET_TOTAL calls — one frame deeper. The `line`
 *  attribute counts within the method include on purpose: ARC-1 must number positions by the uri. */
function stackXml(at: Position, withUri = true, inHelper = false): string {
  const uri = (column: number) => (withUri ? ` uri="${at.path}#start=${at.line},${column}"` : '');
  const helper = inHelper
    ? `<stackEntry stackPosition="3" programName="ZCL_ORDER=====================CP" includeName="ZCL_ORDER=====================CM002" line="${at.line - 6}" eventType="METHOD" eventName="HELPER" systemProgram="false"${uri(4)}/>`
    : '';
  const top =
    at.path === MAIN
      ? `<stackEntry stackPosition="2" programName="ZCL_ORDER=====================CP" includeName="ZCL_ORDER=====================CM001" line="${inHelper ? 3 : at.line - 6}" eventType="METHOD" eventName="GET_TOTAL" systemProgram="false"${inHelper ? '' : uri(4)}/>`
      : `<stackEntry stackPosition="2" programName="ZREPORT" includeName="ZREPORT" line="${at.line}" eventType="EVENT" eventName="START-OF-SELECTION" systemProgram="false"${uri(1)}/>`;
  return `<?xml version="1.0" encoding="utf-8"?><dbg:stack xmlns:dbg="http://www.sap.com/adt/debugger">${helper}${top}<stackEntry stackPosition="1" programName="SAPLSAUNIT_TEST_RUNNER" includeName="LSAUNIT_TEST_RUNNERU01" line="7" eventType="FUNCTION" eventName="SAUNIT_RUN" systemProgram="true"/></dbg:stack>`;
}

/** SAP's breakpoint id for a position: location-derived, so the external breakpoint and its session copy share it. */
const breakpointId = (path: string, line: number) =>
  path === MAIN ? `BP-L${line}` : `BP-${path.split('/').at(-3)?.toUpperCase()}-L${line}`;
const positionKey = (path: string, line: number) => `${path}#${line}`;

function variable(id: string, metaType: string, value = '', extra = ''): string {
  return `<STPDA_ADT_VARIABLE><ID>${id}</ID><NAME>${id.replace(/^.*[-]/, '')}</NAME><DECLARED_TYPE_NAME>T_${metaType.toUpperCase()}</DECLARED_TYPE_NAME><META_TYPE>${metaType}</META_TYPE><VALUE>${value}</VALUE>${extra}</STPDA_ADT_VARIABLE>`;
}

const asx = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>${inner}</DATA></asx:values></asx:abap>`;
const hierarchy = (parent: string, child: string, name = child) =>
  `<STPDA_ADT_VARIABLE_HIERARCHY><PARENT_ID>${parent}</PARENT_ID><CHILD_ID>${child}</CHILD_ID><CHILD_NAME>${name}</CHILD_NAME></STPDA_ADT_VARIABLE_HIERARCHY>`;

const VARIABLES: Record<string, string> = {
  LV_TOTAL: variable('LV_TOTAL', 'simple', '42'),
  LV_HELPER: variable('LV_HELPER', 'simple', '7'),
  // CONV string( 124 ): the sign position is a trailing blank, and in a string it counts.
  LV_TEXT: variable('LV_TEXT', 'string', '124 '),
  LV_CHAR: variable('LV_CHAR', 'simple', 'ABC   '),
  LS_HEAD: variable('LS_HEAD', 'structure'),
  LT_ITEMS: variable('LT_ITEMS', 'table', '', '<TABLE_LINES>2</TABLE_LINES>'),
  'LT_ITEMS[1]': variable('LT_ITEMS[1]', 'structure'),
  'LT_ITEMS[2]': variable('LT_ITEMS[2]', 'structure'),
  'LT_ITEMS[3]': variable('LT_ITEMS[3]', 'structure'),
};
const CHILDREN: Record<string, string[]> = {
  '@LOCALS': ['LV_TOTAL', 'LS_HEAD', 'LT_ITEMS'],
  LS_HEAD: ['LS_HEAD-VBELN', 'LS_HEAD-KUNNR'],
  'LT_ITEMS[1]': ['LT_ITEMS[1]-POSNR'],
  'LT_ITEMS[2]': ['LT_ITEMS[2]-POSNR'],
  'LT_ITEMS[3]': ['LT_ITEMS[3]-POSNR'],
};
const LEAF_VALUES: Record<string, string> = {
  'LS_HEAD-VBELN': '0000004711',
  'LS_HEAD-KUNNR': 'CUST01',
  'LT_ITEMS[1]-POSNR': '000010',
  'LT_ITEMS[2]-POSNR': '000020',
  'LT_ITEMS[3]-POSNR': '000030',
};

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  stateful: boolean;
  /** `X-sap-adt-sessiontype` as sent (stateful / stateless / undefined). */
  sessionType?: string;
  /** Multi-server fake: the application server the request's session is pinned to. */
  server?: string;
}

interface FakeSapOptions {
  /** The listener catches the debuggee (otherwise it waits until aborted, or times out at once). */
  hit?: boolean;
  /** With hit=false: answer the long poll with an empty body immediately (server timeout). */
  listenerTimesOut?: boolean;
  /** Breakpoint lines below this are refused ("no statement"). */
  acceptLinesFrom?: number;
  conflict?: boolean;
  /** SAP refuses breakpoints (the user lacks debug authorization). */
  breakpointsForbidden?: boolean;
  /** systeminformation names this session user; unset = the resource is absent (404, SAP_BASIS <= 7.50). */
  sessionUser?: string;
  /** Multi-server system: each new stateful session lands on the next of these (named in sap-contextid);
   *  while a debuggee waits, new sessions avoid its server — SAP's balancer prefers the least-loaded one. */
  servers?: string[];
  /** With servers: where a run ARC-1 did not pin stops (INSTANCE_NAME) — a stateless trigger or the user's
   *  own run. An attach from any other server is refused and spoils the debuggee for every later one. */
  debuggeeServer?: string;
  /** trigger="none": the user's own run reaches the breakpoint. */
  runByUser?: boolean;
  /** SAP flags the stopped debuggee IS_ATTACH_IMPOSSIBLE. */
  attachImpossible?: boolean;
  /** The OData service refuses the trigger (BTP ABAP: UCON blocks an unexposed custom service). */
  odataBlocked?: boolean;
  /** The positions the run passes, in order (a loop repeats one). It stops at the first one with an armed
   *  breakpoint; `stepContinue` runs on to the next one with a session breakpoint, or to the end. Unset: the
   *  run stops once at line 9 of ZCL_ORDER and `stepContinue` ends it. */
  execution?: Position[];
  /** attach / step / stepContinue answers name the breakpoint reached (reachedBreakpoints). */
  namesBreakpoints?: boolean;
  /** Stack frames carry no uri. */
  stackWithoutUri?: boolean;
  /** The lines successive steps land on (a loop goes back); past its end a step moves one line on. */
  stepPath?: number[];
  /** Lines of HELPER, a method GET_TOTAL calls: the stack is one frame deeper there. */
  helperLines?: number[];
  /** Variables that exist only on these lines (declared in the frame the run is in there). */
  visibleOn?: Record<string, number[]>;
  /** Expressions SAP refuses: a getVariables batch carrying one fails as a whole. */
  failingVariables?: string[];
  /** From this line on, LT_ITEMS has a third row (an APPEND ran). */
  appendAtLine?: number;
  /** The attach lands in a post-mortem (short dump) session: no stepping. */
  postMortem?: boolean;
}

const cannotAttach = (line: number) =>
  ENDED.replace('debuggeeEnded', 'invalidDebuggee')
    .replace('Debuggee ended', 'An exception was raised')
    .replace(
      '</properties>',
      `<entry key="previous2SourcePositionProgram">CL_ABDBG_ACT_FOR_ATTACH__USER=CP</entry><entry key="previous2SourcePositionSourceLine">${line} </entry><entry key="previous2ExceptionClassName">CX_ABDBG_ACTEXT_CANNOT_ATTACH</entry></properties>`,
    );

function installFakeSap(options: FakeSapOptions = {}) {
  const calls: Call[] = [];
  /** Where the debuggee stands; steps move it a line on (or along `stepPath`). */
  let position: Position = { path: MAIN, line: 9 };
  let cursor = 0;
  let stepCursor = 0;
  /** Armed breakpoints by position → id: the user's external ones, and the attached run's own copies. */
  const external = new Map<string, string>();
  let sessionBreakpoints = new Map<string, string>();
  let released: () => void = () => {};
  const releasedPromise = new Promise<void>((resolve) => {
    released = resolve;
  });
  let triggered: () => void = () => {};
  const triggeredPromise = new Promise<void>((resolve) => {
    triggered = resolve;
  });
  let sessionsOpened = 0;
  let spoiled = false;
  /** Multi-server: the server the debuggee waits on, from its stop to its release. */
  let stoppedOn: string | undefined;
  const debuggeeXml = () => {
    let xml = options.attachImpossible
      ? DEBUGGEE_XML.replace('<IS_ATTACH_IMPOSSIBLE>false', '<IS_ATTACH_IMPOSSIBLE>X')
      : DEBUGGEE_XML;
    // As on the BTP ABAP Environment: LINE_CURR counts within INCL_CURR, the URI like SAPRead.
    if (!options.stackWithoutUri) {
      xml = xml.replace('</STPDA_DEBUGGEE>', `<URI>${position.path}#start=${position.line},0</URI></STPDA_DEBUGGEE>`);
    }
    return stoppedOn
      ? xml.replace('</STPDA_DEBUGGEE>', `<INSTANCE_NAME>${stoppedOn}</INSTANCE_NAME></STPDA_DEBUGGEE>`)
      : xml;
  };

  mockFetch.mockReset();
  mockFetch.mockImplementation(
    async (
      url: string | URL,
      init?: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
    ) => {
      const parsed = new URL(String(url));
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      const headers = init?.headers ?? {};
      const sessionType = headers['X-sap-adt-sessiontype'];
      const context = /sap-contextid=SID%3aANON%3a([^%;]+)%3a/.exec(headers.Cookie ?? '')?.[1];
      // A stateful request without a context opens a session on the next server (load balancing).
      const unloaded = options.servers?.filter((server) => server !== stoppedOn);
      const balanced = unloaded?.length ? unloaded : options.servers;
      const opened =
        balanced && sessionType === 'stateful' && !context ? balanced[sessionsOpened++ % balanced.length] : undefined;
      const call: Call = {
        method,
        path: parsed.pathname,
        query: parsed.searchParams,
        body,
        stateful: sessionType === 'stateful',
        ...(sessionType ? { sessionType } : {}),
        ...((context ?? opened) ? { server: context ?? opened } : {}),
      };
      calls.push(call);
      const response = await answer(call, method, body, init);
      if (opened)
        response.headers.append(
          'set-cookie',
          `sap-contextid=SID%3aANON%3a${opened}%3aCTX${sessionsOpened}-NEW; path=/`,
        );
      return response;
    },
  );

  async function answer(call: Call, method: string, body: string, init?: { signal?: AbortSignal }): Promise<Response> {
    const parsed = new URL(`http://sap${call.path}?${call.query.toString()}`);
    const path = parsed.pathname.toLowerCase();
    const q = parsed.searchParams;

    if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery')
      return mockResponse(200, '', { 'x-csrf-token': 'T' });
    // Eclipse's close-session request (AdtHttpClient.endStatefulSession), sent on the context it closes.
    if (method === 'GET' && path === '/sap/bc/adt/core/http/sessions') return mockResponse(200, '');
    if (method === 'GET' && path === '/sap/bc/adt/core/http/systeminformation' && options.sessionUser)
      return mockResponse(
        200,
        JSON.stringify({ systemID: 'A4H', client: '001', userName: options.sessionUser, language: 'EN' }),
      );
    if (method === 'GET' && path === '/sap/bc/adt/oo/classes/zcl_order/source/main')
      return mockResponse(200, CLASS_SOURCE);
    if (path === '/sap/bc/adt/debugger/listeners') {
      if (method === 'GET') {
        return options.conflict
          ? mockResponse(
              409,
              ENDED.replace('debuggeeEnded', 'conflictDetected').replace(
                '</properties>',
                '<entry key="conflictText">ADMIN is debugged in Eclipse</entry></properties>',
              ),
            )
          : mockResponse(200, '');
      }
      if (method === 'DELETE') return mockResponse(200, '');
      // POST: the long poll.
      if (options.hit) {
        if (options.runByUser) stoppedOn = options.servers ? options.debuggeeServer : undefined;
        else await triggeredPromise;
        if (options.execution) {
          cursor = options.execution.findIndex((at) => external.has(positionKey(at.path, at.line)));
          position = { ...(options.execution[cursor] as Position) };
        }
        return mockResponse(200, debuggeeXml());
      }
      if (options.listenerTimesOut) return mockResponse(200, '');
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    }
    if (path === '/sap/bc/adt/debugger/breakpoints' && method === 'POST') {
      if (options.breakpointsForbidden) {
        return mockResponse(
          403,
          ENDED.replace('debuggeeEnded', 'notAuthorized').replace('Debuggee ended', 'No authorization to debug'),
        );
      }
      // A full sync replaces the scope's set: the user's external breakpoints, or the attached run's copies.
      const armed = new Map<string, string>();
      const items = [
        ...body.matchAll(/kind="line" clientId="([^"]+)" skipCount="0" adtcore:uri="([^"#]+)#start=(\d+)"/g),
      ].map((m) => {
        const [, clientId, path = '', text] = m;
        const line = Number(text);
        if (line < (options.acceptLinesFrom ?? 1))
          return `<breakpoint kind="line" clientId="${clientId}" errorMessage="Cannot create a breakpoint at this position"/>`;
        armed.set(positionKey(path, line), breakpointId(path, line));
        return `<breakpoint kind="line" clientId="${clientId}" id="${breakpointId(path, line)}" adtcore:uri="${path}#start=${line}"/>`;
      });
      if (body.includes('kind="exception"')) {
        items.push(
          '<breakpoint kind="exception" clientId="arc1-exception" id="BP-EXC" exceptionClass="CX_SY_ZERODIVIDE"/>',
        );
      }
      if (body.includes('scope="debugger"')) {
        sessionBreakpoints = armed;
        return mockResponse(200, '<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger"/>');
      }
      external.clear();
      for (const [key, id] of armed) external.set(key, id);
      return mockResponse(
        200,
        `<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" xmlns:adtcore="http://www.sap.com/adt/core">${items.join('')}</dbg:breakpoints>`,
      );
    }
    if (path.startsWith('/sap/bc/adt/debugger/breakpoints/') && method === 'DELETE') {
      const id = decodeURIComponent(call.path.split('/').at(-1) ?? '');
      const scope = q.get('scope') === 'debugger' ? sessionBreakpoints : external;
      for (const [key, value] of scope) if (value === id) scope.delete(key);
      return mockResponse(200, '');
    }
    if (path === '/sap/bc/adt/abapunit/testruns') {
      if (options.hit && options.servers) stoppedOn = call.server ?? options.debuggeeServer;
      triggered();
      if (options.hit) await releasedPromise;
      return mockResponse(200, AUNIT_PASSED);
    }
    if (path === '/sap/bc/adt/debugger/stack') {
      const inHelper = position.path === MAIN && (options.helperLines ?? []).includes(position.line);
      return mockResponse(200, stackXml(position, !options.stackWithoutUri, inHelper));
    }
    if (path === '/sap/bc/adt/debugger') {
      switch (q.get('method')) {
        case 'attach':
          if (stoppedOn && (spoiled || call.server !== stoppedOn)) {
            const line = spoiled ? 9 : 24;
            spoiled = true;
            released(); // SAP lets the unattached debuggee run on once its wait times out
            return mockResponse(500, cannotAttach(line));
          }
          // The attached run gets its own copies of the breakpoints armed when it stopped.
          sessionBreakpoints = new Map(external);
          return mockResponse(
            200,
            options.postMortem
              ? '<dbg:attach xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="false" isPostMortem="true"/>'
              : `<dbg:attach xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true">${reached()}</dbg:attach>`,
          );
        case 'stepOver':
        case 'stepInto':
        case 'stepReturn':
          position = { ...position, line: options.stepPath?.[stepCursor++] ?? position.line + 1 };
          // A step that lands on one of the run's breakpoints stops there as at a breakpoint.
          return mockResponse(
            200,
            `<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true">${reached()}</dbg:step>`,
          );
        case 'stepContinue':
          for (cursor++; options.execution && cursor < options.execution.length; cursor++) {
            const next = options.execution[cursor] as Position;
            if (sessionBreakpoints.has(positionKey(next.path, next.line))) {
              position = { ...next };
              return mockResponse(
                200,
                `<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true">${reached()}</dbg:step>`,
              );
            }
          }
          released();
          stoppedOn = undefined;
          return mockResponse(400, ENDED);
        case 'getChildVariables': {
          const parents = [...body.matchAll(/<PARENT_ID>([^<]+)<\/PARENT_ID>/g)].map((m) => m[1] as string);
          if (parents.includes('@ROOT'))
            return mockResponse(
              200,
              asx(`<HIERARCHIES>${hierarchy('@ROOT', '@LOCALS', 'Locals')}</HIERARCHIES><VARIABLES/>`),
            );
          const rows = parents.flatMap((parent) => (CHILDREN[parent] ?? []).map((child) => hierarchy(parent, child)));
          const vars = parents.flatMap((parent) =>
            (CHILDREN[parent] ?? []).map(
              (child) => VARIABLES[child] ?? variable(child, 'simple', LEAF_VALUES[child] ?? ''),
            ),
          );
          return mockResponse(
            200,
            asx(`<HIERARCHIES>${rows.join('')}</HIERARCHIES><VARIABLES>${vars.join('')}</VARIABLES>`),
          );
        }
        case 'getVariables': {
          const ids = [...body.matchAll(/<ID>([^<]+)<\/ID>/g)].map((m) => (m[1] as string).replace('ME-&gt;', 'ME->'));
          if (ids.some((id) => options.failingVariables?.includes(id))) {
            return mockResponse(
              500,
              ENDED.replace('debuggeeEnded', 'variableError').replace('Debuggee ended', 'Expression is not valid here'),
            );
          }
          const visible = (id: string) => options.visibleOn?.[id]?.includes(position.line) ?? true;
          const appended = options.appendAtLine !== undefined && position.line >= options.appendAtLine;
          const values = ids.flatMap((id) =>
            !visible(id)
              ? []
              : id === 'LV_TOTAL'
                ? [variable('LV_TOTAL', 'simple', String(30 + position.line))]
                : id === 'LT_ITEMS' && appended
                  ? [variable('LT_ITEMS', 'table', '', '<TABLE_LINES>3</TABLE_LINES>')]
                  : VARIABLES[id]
                    ? [VARIABLES[id]]
                    : [],
          );
          return mockResponse(200, asx(values.join('')));
        }
      }
    }
    if (path.startsWith('/sap/opu/odata4/') && options.odataBlocked) {
      return mockResponse(403, 'Application Server Error: The request has been blocked by UCON.');
    }
    if (path.startsWith('/sap/opu/odata4/')) {
      if (options.hit && options.servers) stoppedOn = call.server ?? options.debuggeeServer;
      triggered();
      return mockResponse(200, '{"value":[]}');
    }
    if (path === '/sap/bc/adt/repository/informationsystem/search') {
      return mockResponse(
        200,
        '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/ztc_order" adtcore:type="CLAS/OC" adtcore:name="ZTC_ORDER" adtcore:packageName="$TMP"/></adtcore:objectReferences>',
      );
    }
    return mockResponse(404, `unexpected ${method} ${parsed.pathname}${parsed.search}`);
  }

  /** `<reachedBreakpoints>` naming the session breakpoint at the current position, when SAP names it. */
  function reached(): string {
    const id = sessionBreakpoints.get(positionKey(position.path, position.line));
    return options.namesBreakpoints && id
      ? `<reachedBreakpoints><breakpoint id="${id}" kind="line"/></reachedBreakpoints>`
      : '';
  }
  return { calls };
}

async function debug(args: Record<string, unknown>, client = createClient()) {
  const result = await handleToolCall(client, CONFIG, 'SAPDiagnose', { action: 'debug', ...args });
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  let json: Record<string, any> | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { result, text, json };
}

const named = (calls: Call[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path.toLowerCase() === path.toLowerCase());

beforeAll(() => {
  setDebugTimingsForTests({ armDelayMs: 0, triggerSettleMs: 200 });
});

afterEach(() => {
  mockFetch.mockReset();
});

describe('SAPDiagnose action="debug" — a hit', () => {
  it('stops in a method, returns stack + frame variables, then releases and cleans up', async () => {
    const { calls } = installFakeSap({ hit: true, acceptLinesFrom: 9 });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ method: 'get_total' }] });

    expect(result.isError).toBeFalsy();
    expect(json).toMatchObject({
      hit: true,
      user: 'ADMIN',
      attached: true,
      breakpoints: [
        { kind: 'line', status: 'set', line: 9, uri: '/sap/bc/adt/oo/classes/zcl_order/source/main#start=9', hits: 1 },
      ],
      stops: [
        {
          stop: 1,
          at: 'CLAS ZCL_ORDER method get_total',
          // Numbered like SAPRead and the breakpoint — not within the method include.
          stoppedAt: { procedure: 'METHOD GET_TOTAL', line: 9, uri: `${MAIN}#start=9,4` },
          hiddenSystemFrames: 1,
        },
      ],
      release: { released: true, via: 'continue' },
      trigger: { kind: 'unittest', target: 'ABAP Unit CLAS ZCL_ORDER', status: 'completed' },
    });
    // The debuggee's position in the same numbering: its URI's line, not LINE_CURR (3, within the include).
    expect(json?.debuggee).toMatchObject({ program: 'ZCL_ORDER=====================CP', line: 9 });
    expect(json?.debuggee).not.toHaveProperty('includeLine');
    expect(json?.stops[0].stoppedAt).not.toHaveProperty('include');
    expect(json?.stops).toHaveLength(1);
    expect(json?.stops[0].stack).toHaveLength(1);
    expect(json?.stops[0].variables).toEqual([
      { name: 'LV_TOTAL', scope: 'Locals', type: 'T_SIMPLE', kind: 'simple', value: '42' },
      {
        name: 'LS_HEAD',
        scope: 'Locals',
        type: 'T_STRUCTURE',
        kind: 'structure',
        components: { VBELN: '0000004711', KUNNR: 'CUST01' },
      },
      { name: 'LT_ITEMS', scope: 'Locals', type: 'T_TABLE', kind: 'table', lines: 2 },
    ]);

    // Probe: METHOD (7) .. ENDMETHOD (11) in one POST; SAP refused 7-8; a second sync keeps only 9.
    const syncs = named(calls, 'POST', '/sap/bc/adt/debugger/breakpoints').filter((c) =>
      c.body.includes('scope="external"'),
    );
    expect(syncs).toHaveLength(2);
    expect([...syncs[0]!.body.matchAll(/arc1-0-line-(\d+)/g)].map((m) => m[1])).toEqual(['7', '8', '9', '10', '11']);
    expect([...syncs[1]!.body.matchAll(/arc1-0-line-(\d+)/g)].map((m) => m[1])).toEqual(['9']);
    expect(syncs[0]!.body).toContain('requestUser="ADMIN"');

    // Listener + breakpoints stateless; attach/stack/variables/release on one stateful session.
    const listen = named(calls, 'POST', '/sap/bc/adt/debugger/listeners')[0]!;
    expect(listen.stateful).toBe(false);
    expect(listen.query.get('requestUser')).toBe('ADMIN');
    expect(listen.query.get('timeout')).toBe('60');
    const sessionCalls = calls.filter(
      (c) => c.path.toLowerCase().startsWith('/sap/bc/adt/debugger') && c.query.get('method'),
    );
    expect(sessionCalls.length).toBeGreaterThan(0);
    expect(sessionCalls.every((c) => c.stateful)).toBe(true);
    expect(named(calls, 'GET', '/sap/bc/adt/debugger/stack')[0]?.stateful).toBe(true);
    // The read used the ACTIVE source.
    expect(named(calls, 'GET', '/sap/bc/adt/oo/classes/ZCL_ORDER/source/main')[0]?.query.get('version')).toBe('active');

    // Cleanup: the external breakpoint by id, then the listener by user only.
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/breakpoints/BP-L9')).toHaveLength(1);
    const stop = named(calls, 'DELETE', '/sap/bc/adt/debugger/listeners');
    expect(stop).toHaveLength(1);
    expect(stop[0]!.query.get('requestUser')).toBe('ADMIN');
    expect(stop[0]!.query.has('ideId')).toBe(false);
  });

  it('reads named variables (table rows, unknown names) and records steps', async () => {
    installFakeSap({ hit: true });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      line: 9,
      variables: ['lv_total', 'LT_ITEMS', 'LV_NOPE'],
      steps: 2,
    });
    expect(json?.hit).toBe(true);
    expect(json?.stops[0].variables).toEqual([
      { name: 'LV_TOTAL', type: 'T_SIMPLE', kind: 'simple', value: '39' },
      {
        name: 'LT_ITEMS',
        type: 'T_TABLE',
        kind: 'table',
        lines: 2,
        rows: [{ POSNR: '000010' }, { POSNR: '000020' }],
      },
      { name: 'LV_NOPE', kind: 'unknown', error: 'not visible in the stopped frame' },
    ]);
    // After a step too, a table shows its rows — `unchanged` when equal to the previous step's.
    expect(json?.stops[0].steps).toEqual([
      expect.objectContaining({
        step: 1,
        line: 10,
        values: { LV_TOTAL: '40', LT_ITEMS: { lines: 2, rows: [{ POSNR: '000010' }, { POSNR: '000020' }] } },
        notVisible: ['LV_NOPE'],
      }),
      expect.objectContaining({
        step: 2,
        line: 11,
        values: { LV_TOTAL: '41', LT_ITEMS: 'unchanged' },
        notVisible: ['LV_NOPE'],
      }),
    ]);
  });

  it('shows a table growing across steps', async () => {
    installFakeSap({ hit: true, appendAtLine: 11 });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, variables: ['LT_ITEMS'], steps: 3 });
    expect(json?.stops[0].steps.map((step: Record<string, any>) => step.values.LT_ITEMS)).toEqual([
      { lines: 2, rows: [{ POSNR: '000010' }, { POSNR: '000020' }] },
      { lines: 3, rows: [{ POSNR: '000010' }, { POSNR: '000020' }, { POSNR: '000030' }] },
      'unchanged',
    ]);
  });

  it('reads a variable once a step enters the method that declares it, and marks the frame moves', async () => {
    installFakeSap({ hit: true, helperLines: [10, 11], visibleOn: { LV_HELPER: [10, 11] } });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      line: 9,
      variables: ['LV_TOTAL', 'LV_HELPER'],
      steps: 3,
      stepMode: 'into',
    });
    expect(json?.stops[0].variables[1]).toEqual({
      name: 'LV_HELPER',
      kind: 'unknown',
      error: 'not visible in the stopped frame',
    });
    expect(json?.stops[0].steps).toEqual([
      expect.objectContaining({
        step: 1,
        procedure: 'METHOD HELPER',
        frame: 'entered',
        values: { LV_TOTAL: '40', LV_HELPER: '7' },
      }),
      expect.objectContaining({ step: 2, procedure: 'METHOD HELPER', values: { LV_TOTAL: '41', LV_HELPER: '7' } }),
      expect.objectContaining({
        step: 3,
        procedure: 'METHOD GET_TOTAL',
        frame: 'returned',
        values: { LV_TOTAL: '42' },
        notVisible: ['LV_HELPER'],
      }),
    ]);
    expect(json?.stops[0].steps[1]).not.toHaveProperty('frame');
    // A same-named variable in the new frame is another variable: the result says so.
    expect(json?.warnings).toContainEqual(expect.stringContaining('a variable of the same name is a different'));
  });

  it('leaves an expression SAP refuses out of the later reads of the same frame', async () => {
    const { calls } = installFakeSap({ hit: true, failingVariables: ['LV_BAD'] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      line: 9,
      variables: ['LV_TOTAL', 'LV_BAD'],
      steps: 3,
    });
    expect(json?.stops[0].variables).toEqual([
      expect.objectContaining({ name: 'LV_TOTAL', value: '39' }),
      { name: 'LV_BAD', kind: 'unknown', error: 'Expression is not valid here' },
    ]);
    expect(json?.stops[0].steps).toEqual(
      [40, 41, 42].map((total) =>
        expect.objectContaining({
          values: { LV_TOTAL: String(total) },
          errors: { LV_BAD: 'Expression is not valid here' },
        }),
      ),
    );
    // The stop: the failed batch, then one read per name; each step: one batch without the refused name.
    const reads = calls.filter((c) => c.query.get('method') === 'getVariables');
    expect(reads).toHaveLength(6);
    expect(reads.slice(3).every((c) => !c.body.includes('LV_BAD'))).toBe(true);
  });

  it('runs the unit tests and attaches on one server, both pinned before the stop (multi-server system)', async () => {
    const { calls } = installFakeSap({
      hit: true,
      sessionUser: 'ADMIN',
      servers: ['appserver-t4w2x', 'appserver-rpsxx'],
    });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, variables: ['LV_TOTAL'] });

    expect(result.isError).toBeFalsy();
    expect(json).toMatchObject({
      hit: true,
      attached: true,
      debuggee: { server: 'appserver-t4w2x' },
      stops: [{ variables: [{ name: 'LV_TOTAL', value: '39' }] }],
      release: { released: true, via: 'continue' },
      trigger: { status: 'completed', server: 'appserver-t4w2x' },
    });
    // Before the run, while the balancer still alternates: sessions until two share a server.
    const probes = calls.filter((c) => c.path === '/sap/bc/adt/core/http/systeminformation' && c.stateful);
    expect(probes.map((c) => c.server)).toEqual(['appserver-t4w2x', 'appserver-rpsxx', 'appserver-t4w2x']);
    // The unit tests run on the pair's second session, so the debuggee stops on its server ...
    expect(named(calls, 'POST', '/sap/bc/adt/abapunit/testruns').map((c) => c.server)).toEqual(['appserver-t4w2x']);
    // ... where the first one waits: a single attach and the whole debugger session there, no probing after the stop.
    const session = calls.filter((c) => c.path.startsWith('/sap/bc/adt/debugger') && c.query.get('method'));
    expect(session.filter((c) => c.query.get('method') === 'attach')).toHaveLength(1);
    expect(session.every((c) => c.server === 'appserver-t4w2x')).toBe(true);
    // Every session ARC-1 opened ends with Eclipse's close-session request on its own context: the unused
    // one, the debugger's after the release, the trigger's after its run.
    const closes = calls.filter((c) => c.sessionType === 'stateless');
    expect(closes.every((c) => c.method === 'GET' && c.path === '/sap/bc/adt/core/http/sessions')).toBe(true);
    expect(
      calls
        .filter((c) => c.sessionType === 'stateless')
        .map((c) => c.server)
        .sort(),
    ).toEqual(['appserver-rpsxx', 'appserver-t4w2x', 'appserver-t4w2x']);
  });

  it("attaches to the user's own run from the session already waiting on its server", async () => {
    const { calls } = installFakeSap({
      hit: true,
      runByUser: true,
      sessionUser: 'ADMIN',
      servers: ['appserver-t4w2x', 'appserver-rpsxx'],
      debuggeeServer: 'appserver-rpsxx',
    });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, trigger: 'none' });

    expect(json).toMatchObject({
      hit: true,
      attached: true,
      debuggee: { server: 'appserver-rpsxx' },
      release: { released: true },
    });
    expect(calls.filter((c) => c.query.get('method') === 'attach').map((c) => c.server)).toEqual(['appserver-rpsxx']);
    // The sessions opened ahead covered both servers: nothing probed after the stop.
    expect(calls.filter((c) => c.path === '/sap/bc/adt/core/http/systeminformation' && c.stateful)).toHaveLength(3);
  });

  it('shows a structure watched across steps by its components', async () => {
    installFakeSap({ hit: true });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, variables: ['LS_HEAD'], steps: 1 });
    expect(json?.stops[0].steps).toEqual([
      expect.objectContaining({ step: 1, values: { LS_HEAD: { VBELN: '0000004711', KUNNR: 'CUST01' } } }),
    ]);
  });

  it("keeps a string's blanks (they count) and drops a fixed-length field's padding", async () => {
    installFakeSap({ hit: true });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      line: 9,
      variables: ['LV_TEXT', 'LV_CHAR'],
      steps: 1,
    });
    expect(json?.stops[0].variables).toEqual([
      expect.objectContaining({ name: 'LV_TEXT', kind: 'string', value: '124 ' }),
      expect.objectContaining({ name: 'LV_CHAR', kind: 'simple', value: 'ABC' }),
    ]);
    expect(json?.stops[0].steps[0].values).toEqual({ LV_TEXT: '124 ', LV_CHAR: 'ABC' });
  });

  it("runs the unit tests of the breakpoint's object when the call names no top-level object", async () => {
    installFakeSap({ hit: true });
    const { result, json } = await debug({ breakpoints: [{ type: 'CLAS', name: 'zcl_order', line: 9 }] });
    expect(result.isError).toBeFalsy();
    expect(json).toMatchObject({
      hit: true,
      trigger: { kind: 'unittest', target: 'ABAP Unit CLAS ZCL_ORDER', status: 'completed' },
    });
  });

  it("gives the debuggee's line within its include, labelled so, when SAP sends no URI", async () => {
    installFakeSap({ hit: true, stackWithoutUri: true });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(json?.debuggee).toMatchObject({ include: 'ZCL_ORDER=====================CM001', includeLine: 3 });
    expect(json?.debuggee).not.toHaveProperty('line');
  });

  it('refuses a second capture for the same SAP user while one is running', async () => {
    installFakeSap({ hit: true });
    const client = createClient();
    const first = debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, client);
    const second = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, client);
    expect(second.result.isError).toBe(true);
    expect(second.text).toContain('already running');
    expect((await first).json?.hit).toBe(true);
  });
});

describe('SAPDiagnose action="debug" — several stops in one run', () => {
  const at9 = { path: MAIN, line: 9 };
  const at11 = { path: MAIN, line: 11 };
  const line9 = 'CLAS ZCL_ORDER the main source line 9';
  const line11 = 'CLAS ZCL_ORDER the main source line 11';
  const method = (calls: Call[], name: string) => calls.filter((c) => c.query.get('method') === name);

  it('follows the run from one breakpoint to the next, retiring each after its stop', async () => {
    const { calls } = installFakeSap({ hit: true, execution: [at9, at11] });
    const { result, json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9 }, { line: 11 }],
      variables: ['LV_TOTAL'],
    });

    expect(result.isError).toBeFalsy();
    expect(json?.breakpoints).toEqual([
      expect.objectContaining({ location: line9, status: 'set', line: 9, hits: 1 }),
      expect.objectContaining({ location: line11, status: 'set', line: 11, hits: 1 }),
    ]);
    expect(json?.stops).toEqual([
      expect.objectContaining({
        stop: 1,
        at: line9,
        stoppedAt: expect.objectContaining({ uri: `${MAIN}#start=9,4` }),
        variables: [expect.objectContaining({ name: 'LV_TOTAL', value: '39' })],
      }),
      expect.objectContaining({
        stop: 2,
        at: line11,
        stoppedAt: expect.objectContaining({ uri: `${MAIN}#start=11,4` }),
        variables: [expect.objectContaining({ name: 'LV_TOTAL', value: '41' })],
      }),
    ]);
    // Each breakpoint shows the call stack on its first stop.
    expect(json?.stops[1].stack).toHaveLength(1);
    expect(json?.release).toEqual({ released: true, via: 'continue' });
    // Line 9 left the run (its session copy, on the attached session) before the run went on to 11.
    const retired = calls.filter((c) => c.method === 'DELETE' && c.query.get('scope') === 'debugger');
    expect(retired.map((c) => c.path)).toEqual(['/sap/bc/adt/debugger/breakpoints/BP-L9']);
    expect(retired.every((c) => c.stateful)).toBe(true);
    // One continue to the second stop, one to release the run after it.
    expect(method(calls, 'stepContinue')).toHaveLength(2);
    // Both locations were probed in one POST, under their own client ids.
    const probe = named(calls, 'POST', '/sap/bc/adt/debugger/breakpoints')[0]!;
    expect(probe.body).toContain('clientId="arc1-0-line-9"');
    expect(probe.body).toContain('clientId="arc1-1-line-11"');
  });

  it('stops at a loop breakpoint as often as its hits allow, then runs on to the next one', async () => {
    const loop = Array.from({ length: 5 }, () => at9);
    installFakeSap({ hit: true, execution: [...loop, at11] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9, hits: 3 }, { line: 11 }],
      variables: ['LV_TOTAL'],
    });

    expect(json?.stops.map((stop: Record<string, unknown>) => [stop.at, stop.hit ?? null])).toEqual([
      [line9, 1],
      [line9, 2],
      [line9, 3],
      [line11, null],
    ]);
    // A loop's later stops would only repeat the call stack.
    expect(json?.stops.map((stop: Record<string, unknown>) => 'stack' in stop)).toEqual([true, false, false, true]);
    expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([3, 1]);
  });

  it('records at most 10 stops, then lets the run go on', async () => {
    const loop = Array.from({ length: 12 }, () => at9);
    installFakeSap({ hit: true, execution: [...loop, at11] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9, hits: 10 }, { line: 11 }],
      variables: ['LV_TOTAL'],
    });

    expect(json?.stops).toHaveLength(10);
    expect(json?.warnings).toContainEqual(expect.stringContaining('at most 10 stops'));
    expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([10, 0]);
    expect(json?.release).toMatchObject({ released: true, via: 'continue' });
  });

  it('reports a breakpoint the run never reached and needs no release once the run ended', async () => {
    const { calls } = installFakeSap({ hit: true, execution: [at9] });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9 }, { line: 11 }] });

    expect(json?.stops).toHaveLength(1);
    expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([1, 0]);
    expect(json?.release).toEqual({ released: true, via: 'continue' });
    // The continue toward line 11 ran the program to its end: nothing left to release.
    expect(method(calls, 'stepContinue')).toHaveLength(1);
    expect(calls.some((c) => c.method === 'POST' && c.body.includes('scope="debugger"'))).toBe(false);
  });

  it('stops in another object of the same run', async () => {
    installFakeSap({ hit: true, execution: [at9, { path: REPORT, line: 30 }] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9 }, { type: 'PROG', name: 'zreport', line: 30 }],
    });

    expect(json?.breakpoints[1]).toMatchObject({
      location: 'PROG ZREPORT line 30',
      status: 'set',
      uri: `${REPORT}#start=30`,
      hits: 1,
    });
    expect(json?.stops.map((stop: Record<string, unknown>) => stop.at)).toEqual([line9, 'PROG ZREPORT line 30']);
    expect(json?.stops[1].stoppedAt).toMatchObject({ program: 'ZREPORT', line: 30 });
    // The unit tests of the top-level object still run the code.
    expect(json?.trigger).toMatchObject({ target: 'ABAP Unit CLAS ZCL_ORDER' });
  });

  it('names a stop by the breakpoint SAP reports when the stack carries no position', async () => {
    installFakeSap({ hit: true, namesBreakpoints: true, stackWithoutUri: true, execution: [at9, at11] });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9 }, { line: 11 }] });
    expect(json?.stops.map((stop: Record<string, unknown>) => stop.at)).toEqual([line9, line11]);
  });

  it('leaves a stop it cannot place unnamed and keeps following the run', async () => {
    installFakeSap({ hit: true, stackWithoutUri: true, execution: [at9, at11] });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9 }, { line: 11 }] });
    expect(json?.stops).toHaveLength(2);
    expect(json?.stops.some((stop: Record<string, unknown>) => 'at' in stop)).toBe(false);
    expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([0, 0]);
  });

  it('reports two locations on the same line once', async () => {
    installFakeSap({ hit: true, acceptLinesFrom: 9 });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9 }, { method: 'get_total' }],
    });
    expect(json?.breakpoints).toEqual([
      expect.objectContaining({ location: line9, status: 'set', line: 9, hits: 1 }),
      { kind: 'line', location: 'CLAS ZCL_ORDER method get_total', status: 'duplicate', of: line9 },
    ]);
    expect(json?.stops).toHaveLength(1);
  });

  it('steps into calls or out to the caller as stepMode says', async () => {
    const into = installFakeSap({ hit: true });
    const stepped = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, steps: 2, stepMode: 'into' });
    expect(stepped.json?.stops[0].steps).toHaveLength(2);
    expect(method(into.calls, 'stepInto')).toHaveLength(2);
    expect(method(into.calls, 'stepOver')).toHaveLength(0);

    const out = installFakeSap({ hit: true });
    await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, steps: 1, stepMode: 'out' });
    expect(method(out.calls, 'stepReturn')).toHaveLength(1);
  });

  it('makes a step that runs into a breakpoint the next stop, and counts its hit', async () => {
    const line10 = 'CLAS ZCL_ORDER the main source line 10';
    // SAP names the breakpoint in the step answer, or only the stack's position shows it.
    for (const namesBreakpoints of [true, false]) {
      const { calls } = installFakeSap({ hit: true, namesBreakpoints, execution: [at9] });
      const { json } = await debug({
        type: 'CLAS',
        name: 'ZCL_ORDER',
        breakpoints: [{ line: 9 }, { line: 10 }],
        variables: ['LV_TOTAL'],
        steps: 2,
      });
      expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([1, 1]);
      expect(json?.stops).toEqual([
        expect.objectContaining({
          stop: 1,
          at: line9,
          steps: [expect.objectContaining({ step: 1, breakpoint: line10 })],
        }),
        expect.objectContaining({
          stop: 2,
          at: line10,
          variables: [expect.objectContaining({ name: 'LV_TOTAL', value: '40' })],
          steps: [expect.objectContaining({ step: 1 }), expect.objectContaining({ step: 2 })],
        }),
      ]);
      // The stop right after the interrupted step reads its values.
      expect(json?.stops[0].steps[0]).not.toHaveProperty('values');
      // The run already stood at the second stop: no continue to reach it, one to release the run.
      expect(method(calls, 'stepContinue')).toHaveLength(1);
    }
  });

  it('takes a step back onto a loop breakpoint as its next hit, and none after its last', async () => {
    const { calls } = installFakeSap({ hit: true, execution: [at9], stepPath: [10, 9, 10, 9, 10] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9, hits: 2 }],
      variables: ['LV_TOTAL'],
      steps: 3,
    });
    expect(json?.stops.map((stop: Record<string, unknown>) => [stop.at, stop.hit])).toEqual([
      [line9, 1],
      [line9, 2],
    ]);
    expect(json?.stops[0].steps).toEqual([
      expect.objectContaining({ step: 1, values: { LV_TOTAL: '40' } }),
      expect.objectContaining({ step: 2, breakpoint: line9 }),
    ]);
    // Its hits made, the breakpoint left the run before the steps: back on line 9 is just a step.
    expect(json?.stops[1].steps).toHaveLength(3);
    expect(json?.stops[1].steps.some((step: Record<string, unknown>) => 'breakpoint' in step)).toBe(false);
    expect(json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([2]);
    const retired = calls.filter((c) => c.method === 'DELETE' && c.query.get('scope') === 'debugger');
    expect(retired.map((c) => c.path)).toEqual(['/sap/bc/adt/debugger/breakpoints/BP-L9']);
  });

  it("back in the caller, takes a breakpoint on the line it returned to only on SAP's word", async () => {
    const at10 = { path: MAIN, line: 10 };
    const returned: FakeSapOptions = { hit: true, helperLines: [10, 11], execution: [at10], stepPath: [11, 12] };
    const args = { type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 10 }, { line: 12 }], steps: 2 };

    installFakeSap({ ...returned });
    const byPosition = await debug(args);
    expect(byPosition.json?.stops).toHaveLength(1);
    expect(byPosition.json?.stops[0].steps[1]).toMatchObject({ step: 2, frame: 'returned' });
    expect(byPosition.json?.stops[0].steps[1]).not.toHaveProperty('breakpoint');
    expect(byPosition.json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([1, 0]);

    installFakeSap({ ...returned, namesBreakpoints: true });
    const named = await debug(args);
    expect(named.json?.stops).toHaveLength(2);
    expect(named.json?.breakpoints.map((bp: Record<string, unknown>) => bp.hits)).toEqual([1, 1]);
  });

  it('inspects a post-mortem session once, retiring and following nothing', async () => {
    const { calls } = installFakeSap({ hit: true, postMortem: true, execution: [at9, at11] });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9 }, { line: 11 }] });
    expect(json?.stops).toHaveLength(1);
    expect(json?.warnings).toContainEqual(expect.stringContaining('post-mortem'));
    expect(calls.some((c) => c.method === 'DELETE' && c.query.get('scope') === 'debugger')).toBe(false);
  });

  it('stops stepping when the inspection budget runs low, and still releases the run', async () => {
    setDebugTimingsForTests({ continueMarginMs: 10 * 60_000 });
    try {
      installFakeSap({ hit: true });
      const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, steps: 3 });
      expect(json?.stops[0]).not.toHaveProperty('steps');
      expect(json?.warnings).toContainEqual(expect.stringContaining('inspection budget ran low after 0 step(s)'));
      expect(json?.release).toMatchObject({ released: true });
    } finally {
      setDebugTimingsForTests({ continueMarginMs: 15_000 });
    }
  });

  it('records at most 40 steps across all stops', async () => {
    installFakeSap({ hit: true, execution: [at9, at9, at9] });
    const { json } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: [{ line: 9, hits: 3 }],
      steps: 20,
      variables: ['LV_TOTAL'],
    });
    expect(
      json?.stops.map((stop: Record<string, unknown>) => (stop.steps as unknown[] | undefined)?.length ?? 0),
    ).toEqual([20, 20, 0]);
    expect(json?.warnings).toContainEqual(expect.stringContaining('at most 40 steps'));
  });

  it('validates each breakpoint before anything reaches SAP', async () => {
    installFakeSap();
    const both = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9, method: 'get_total' }] });
    expect(both.text).toContain('breakpoints[0] needs line or method');
    const noObject = await debug({ breakpoints: [{ line: 9 }] });
    expect(noObject.text).toContain('needs type (CLAS, PROG or FUNC) and name');
    const tooMany = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      breakpoints: Array.from({ length: 7 }, (_, index) => ({ line: index + 1 })),
    });
    expect(tooMany.result.isError).toBe(true);
    const tooManyHits = await debug({ type: 'CLAS', name: 'ZCL_ORDER', breakpoints: [{ line: 9, hits: 11 }] });
    expect(tooManyHits.result.isError).toBe(true);
    // The method is a breakpoints item now, not a top-level argument.
    const topLevelMethod = await debug({ type: 'CLAS', name: 'ZCL_ORDER', method: 'get_total' });
    expect(topLevelMethod.result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SAPDiagnose action="debug" — an attach SAP refuses', () => {
  it('names the server it could not reach and releases nothing it never attached', async () => {
    // The balancer only ever offers t4w2x; the user's run stops on rpsxx.
    const { calls } = installFakeSap({
      hit: true,
      runByUser: true,
      sessionUser: 'ADMIN',
      servers: ['appserver-t4w2x'],
      debuggeeServer: 'appserver-rpsxx',
    });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, trigger: 'none' });

    expect(result.isError).toBeFalsy();
    expect(json).toMatchObject({ hit: true, attached: false, debuggee: { server: 'appserver-rpsxx' } });
    expect(json?.error).toContain('(invalidDebuggee)');
    expect(json?.error).toContain(
      "SAP attaches only from the debuggee's application server (appserver-rpsxx), and none of 8 new sessions landed there (the last on appserver-t4w2x)",
    );
    // Not attached = nothing to release: no stepContinue, no "released" claim.
    expect(json?.release).toBeUndefined();
    expect(calls.filter((c) => c.query.get('method') === 'attach')).toHaveLength(1);
    expect(calls.some((c) => c.query.get('method') === 'stepContinue')).toBe(false);
    // Every session ARC-1 opened is ended again: two ahead of the run, eight after the stop.
    expect(calls.filter((c) => c.sessionType === 'stateless')).toHaveLength(10);
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/listeners')).toHaveLength(1);
  });
});

describe('SAPDiagnose action="debug" — a debuggee SAP cannot attach', () => {
  it('ends the session that waited for it', async () => {
    const { calls } = installFakeSap({
      hit: true,
      attachImpossible: true,
      sessionUser: 'ADMIN',
      servers: ['appserver-t4w2x', 'appserver-rpsxx'],
    });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });

    expect(json).toMatchObject({ hit: true, attached: false, debuggee: { server: 'appserver-t4w2x' } });
    expect(json?.error).toContain('IS_ATTACH_IMPOSSIBLE');
    expect(calls.some((c) => c.query.get('method') === 'attach')).toBe(false);
    // Both sessions opened ahead of the run end — the one waiting on the debuggee's server included.
    expect(
      calls
        .filter((c) => c.sessionType === 'stateless')
        .map((c) => c.server)
        .sort(),
    ).toEqual(['appserver-rpsxx', 'appserver-t4w2x']);
  });
});

describe('SAPDiagnose action="debug" — no hit', () => {
  it('ends the long poll when the unit tests finish first and still cleans up', async () => {
    const { calls } = installFakeSap({ hit: false });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(result.isError).toBeFalsy();
    expect(json).toMatchObject({
      hit: false,
      reason: 'trigger finished without reaching the breakpoint',
      trigger: { kind: 'unittest', status: 'completed' },
    });
    expect(json?.hint).toContain('coverage=true');
    expect(json?.hint).toContain('Right after an activation, wait about a minute');
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/breakpoints/BP-L9')).toHaveLength(1);
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/listeners')).toHaveLength(1);
    expect(calls.some((c) => c.query.get('method') === 'attach')).toBe(false);
  });

  it('reports a server-side timeout with trigger="none"', async () => {
    const { calls } = installFakeSap({ hit: false, listenerTimesOut: true });
    const { json } = await debug({ type: 'PROG', name: 'ZREPORT', line: 30, trigger: 'none', timeoutSeconds: 5 });
    expect(json).toMatchObject({ hit: false, reason: 'timeout', trigger: { kind: 'none' } });
    expect(json?.hint).toContain('same user');
    expect(named(calls, 'POST', '/sap/bc/adt/abapunit/testruns')).toHaveLength(0);
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')[0]?.query.get('timeout')).toBe('5');
  });

  it('refuses to take over another IDE listening for the same user', async () => {
    const { calls } = installFakeSap({ conflict: true });
    const { result, text } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(result.isError).toBe(true);
    expect(text).toContain('ADMIN is debugged in Eclipse');
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/breakpoints')).toHaveLength(0);
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')).toHaveLength(0);
  });

  it('reports a line SAP refuses everywhere without starting a listener', async () => {
    const { calls } = installFakeSap({ acceptLinesFrom: 100 });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 5 });
    expect(result.isError).toBe(true);
    expect(json?.breakpoints).toEqual([
      expect.objectContaining({
        status: 'refused',
        error: 'Cannot create a breakpoint at this position',
        triedLines: [5, 6, 7, 8, 9],
      }),
    ]);
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')).toHaveLength(0);
  });
});

describe('SAPDiagnose action="debug" — whose run is caught', () => {
  /** A per-user client as principal propagation builds it: a token authenticates, `username` is display-only. */
  const ppClient = (displayName: string) =>
    new AdtClient({
      baseUrl: 'http://sap:8000',
      username: displayName,
      sapConnectivityAuth: 'saml-assertion',
      safety: unrestrictedSafetyConfig(),
    });

  it('debugs the SAP user SAP names for this session under principal propagation, not the JWT name', async () => {
    const { calls } = installFakeSap({ hit: false, sessionUser: 'pp_user' });
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, ppClient('JDOE'));
    expect(result.isError).toBeFalsy();
    expect(json?.user).toBe('PP_USER');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/sap/bc/adt/core/http/systeminformation' });
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/breakpoints')[0]?.body).toContain('requestUser="PP_USER"');
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')[0]?.query.get('requestUser')).toBe('PP_USER');
    expect(calls.some((c) => c.body.includes('JDOE') || c.query.toString().includes('JDOE'))).toBe(false);
  });

  it('refuses under principal propagation when SAP cannot name the user, instead of trusting the token', async () => {
    const { calls } = installFakeSap();
    const { result, text } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, ppClient('JDOE'));
    expect(result.isError).toBe(true);
    expect(text).toContain('Cannot tell which SAP user this session runs as');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /sap/bc/adt/core/http/systeminformation']);
  });

  it("prefers SAP's answer over the configured SAP_USER", async () => {
    const { calls } = installFakeSap({ hit: false, sessionUser: 'DEVELOPER' });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(json?.user).toBe('DEVELOPER');
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')[0]?.query.get('requestUser')).toBe('DEVELOPER');
  });

  it('falls back to SAP_USER behind Basic auth where the release lacks systeminformation', async () => {
    const { calls } = installFakeSap({ hit: false });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(json?.user).toBe('ADMIN');
    // The stateless "who am I" finds no resource; so does the one probe ahead of the run, which then stops.
    expect(named(calls, 'GET', '/sap/bc/adt/core/http/systeminformation').map((c) => c.stateful)).toEqual([
      false,
      true,
    ]);
  });

  it('caps parallel captures per instance at a quarter of ARC1_MAX_CONCURRENT', async () => {
    expect([2, 3, 4, 7, 8, 10, 20].map(maxParallelCaptures)).toEqual([1, 1, 1, 1, 2, 2, 5]);
    installFakeSap({ hit: true });
    const withSlots = (username: string) =>
      new AdtClient({
        baseUrl: 'http://sap:8000',
        username,
        password: 'secret',
        maxConcurrent: 4,
        safety: unrestrictedSafetyConfig(),
      });
    const first = debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, withSlots('admin'));
    const second = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, withSlots('other'));
    expect(second.result.isError).toBe(true);
    expect(second.text).toContain('at most 1, a quarter of ARC1_MAX_CONCURRENT=4');
    expect((await first).json?.hit).toBe(true);
  });
});

describe('SAPDiagnose action="debug" — gates and input', () => {
  it('refuses when the SAP logon user is unknown (no requestUser can be sent)', async () => {
    const { calls } = installFakeSap();
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: unrestrictedSafetyConfig() });
    const { result, text } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, client);
    expect(result.isError).toBe(true);
    expect(text).toContain('Cannot tell which SAP user this session runs as');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /sap/bc/adt/core/http/systeminformation']);
  });

  it('is blocked by the safety ceiling without SAP_ALLOW_DEBUG', async () => {
    installFakeSap();
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'admin',
      password: 'secret',
      safety: { ...unrestrictedSafetyConfig(), allowDebug: false },
    });
    const { result, text } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 }, client);
    expect(result.isError).toBe(true);
    expect(text).toContain('SAP_ALLOW_DEBUG=true');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validates the breakpoint and keeps debug parameters off other actions', async () => {
    installFakeSap();
    const missing = await debug({ type: 'CLAS', name: 'ZCL_ORDER' });
    expect(missing.result.isError).toBe(true);
    expect(missing.text).toContain('needs a breakpoint');
    const tooLong = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, timeoutSeconds: 600 });
    expect(tooLong.text).toContain('1-240');
    const http = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, trigger: 'http' });
    expect(http.text).toContain('needs url');
    const methodOnProg = await debug({ type: 'PROG', name: 'ZREPORT', breakpoints: [{ method: 'x' }] });
    expect(methodOnProg.text).toContain('only supported for type="CLAS"');
    const stray = await handleToolCall(createClient(), CONFIG, 'SAPDiagnose', {
      action: 'syntax',
      type: 'CLAS',
      name: 'X',
      steps: 2,
    });
    expect(stray.isError).toBe(true);
    expect(stray.content[0]?.type === 'text' ? stray.content[0].text : '').toContain(
      'only supported for action="debug"',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('only accepts host-relative OData paths for trigger="http"', async () => {
    const { calls } = installFakeSap();
    const { result, text } = await debug({
      type: 'CLAS',
      name: 'ZCL_ORDER',
      line: 9,
      trigger: 'http',
      url: 'https://evil.example/sap/opu/odata4/x',
    });
    expect(result.isError).toBe(true);
    expect(text).toContain('host-relative OData path');
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/breakpoints')).toHaveLength(0);
  });

  it('resolves triggerName to its object type before arming', async () => {
    const { calls } = installFakeSap({ hit: false });
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, triggerName: 'ztc_order' });
    expect(json?.trigger).toMatchObject({ target: 'ABAP Unit CLAS ZTC_ORDER' });
    expect(named(calls, 'POST', '/sap/bc/adt/abapunit/testruns')[0]?.body).toContain(
      '/sap/bc/adt/oo/classes/ZTC_ORDER',
    );
  });

  it('surfaces SAP authorization refusals as tool errors without starting a listener', async () => {
    const { calls } = installFakeSap({ breakpointsForbidden: true });
    const { result, text } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9 });
    expect(result.isError).toBe(true);
    expect(text).toContain('No authorization to debug');
    expect(named(calls, 'POST', '/sap/bc/adt/debugger/listeners')).toHaveLength(0);
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/listeners')).toHaveLength(0);
  });

  it('runs an OData GET as the trigger', async () => {
    const { calls } = installFakeSap({ hit: false });
    const url = '/sap/opu/odata4/sap/zui_travel/srvd/sap/ztravel/0001/Travel?$top=1';
    const { json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, trigger: 'http', url });
    expect(json).toMatchObject({
      hit: false,
      reason: 'trigger finished without reaching the breakpoint',
      trigger: { kind: 'http', target: `GET ${url}`, status: 'completed', result: { statusCode: 200 } },
    });
    const get = calls.find((c) => c.path.startsWith('/sap/opu/odata4/'));
    expect(get?.method).toBe('GET');
    expect(get?.query.get('$top')).toBe('1');
    expect(named(calls, 'POST', '/sap/bc/adt/abapunit/testruns')).toHaveLength(0);
  });

  it('says the trigger itself failed when the OData service refuses the call', async () => {
    const { calls } = installFakeSap({ hit: false, odataBlocked: true });
    const url = '/sap/opu/odata4/sap/zui_travel/srvd/sap/ztravel/0001/Travel';
    const { result, json } = await debug({ type: 'CLAS', name: 'ZCL_ORDER', line: 9, trigger: 'http', url });
    expect(result.isError).toBeFalsy();
    expect(json?.reason).toMatch(/^trigger failed: .*403.*blocked by UCON/);
    expect(json?.trigger).toMatchObject({ kind: 'http', status: 'failed' });
    expect(json?.hint).toContain('The trigger request itself failed');
    expect(json?.hint).toContain('odata_perf');
    expect(json?.hint).not.toContain('finished without reaching the breakpoint');
    // Cleanup as always.
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/breakpoints/BP-L9')).toHaveLength(1);
    expect(named(calls, 'DELETE', '/sap/bc/adt/debugger/listeners')).toHaveLength(1);
  });
});
