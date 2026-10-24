/**
 * ADT debugger building blocks (src/adt/debugger.ts).
 *
 * The XML documents below are REFERENCE-DERIVED — reconstructed from the shapes abap-adt-api and
 * vibing-steampunk parse (docs/research/2026-10-22-abap-debugger-one-shot-capture.md §3), not live
 * captures. Replace them with recorded bodies once the §9 live checks have run.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildBreakpointsXml,
  buildChildVariablesXml,
  buildVariablesXml,
  contextServer,
  createDebugIdentity,
  DebuggerSession,
  debuggerErrorSubType,
  deleteBreakpoint,
  endSession,
  findListenerConflict,
  listenForDebuggee,
  openSessionOnServer,
  openSessionsAhead,
  parseAttachResponse,
  parseBreakpointsResponse,
  parseChildVariablesResponse,
  parseDebuggee,
  parseDebuggerException,
  parseStackResponse,
  parseVariablesResponse,
  stopListener,
  syncBreakpoints,
} from '../../../src/adt/debugger.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const IDENTITY = { user: 'DEVELOPER', terminalId: 'T1', ideId: 'I1' };
const SAFETY = unrestrictedSafetyConfig();

const ok = (body = '') => ({ statusCode: 200, headers: {}, body });

function mockHttp(overrides: Partial<Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>> = {}) {
  return {
    get: overrides.get ?? vi.fn().mockResolvedValue(ok()),
    post: overrides.post ?? vi.fn().mockResolvedValue(ok()),
    put: overrides.put ?? vi.fn().mockResolvedValue(ok()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(ok()),
  } as unknown as AdtHttpClient & Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;
}

function debuggerException(subType: string, message = 'Debugger message', extra = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceFailure"/><message lang="EN">${message}</message><localizedMessage lang="EN">${message}</localizedMessage><properties><entry key="com.sap.adt.communicationFramework.subType">${subType}</entry>${extra}</properties></exc:exception>`;
}

const DEBUGGEE_XML = `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><STPDA_DEBUGGEE><CLIENT>001</CLIENT><DEBUGGEE_ID>DBGEE_42</DEBUGGEE_ID><TERMINAL_ID>%_USER</TERMINAL_ID><IDE_ID>DEVELOPER</IDE_ID><DEBUGGEE_USER>DEVELOPER</DEBUGGEE_USER><PRG_CURR>ZCL_ORDER=====================CP</PRG_CURR><INCL_CURR>ZCL_ORDER=====================CM002</INCL_CURR><LINE_CURR>12</LINE_CURR><DBGEE_KIND>DEBUGGEE</DBGEE_KIND><IS_ATTACH_IMPOSSIBLE>false</IS_ATTACH_IMPOSSIBLE><URI>/sap/bc/adt/oo/classes/zcl_order/source/main#start=42</URI><TYPE>CLAS/OC</TYPE><NAME>ZCL_ORDER</NAME></STPDA_DEBUGGEE></DATA></asx:values></asx:abap>`;

// Live shape (BTP ABAP Environment, 2026-10-23; user and pod names replaced): the debuggee names the
// application server it waits on, and that it is NOT the listener's.
const BTP_DEBUGGEE_XML = `<?xml version="1.0" encoding="utf-8"?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><STPDA_DEBUGGEE><CLIENT>100</CLIENT><DEBUGGEE_ID>26F50987F8801FD1B3D64A7DABE34570</DEBUGGEE_ID><TERMINAL_ID/><IDE_ID/><DEBUGGEE_USER>CB9900000001</DEBUGGEE_USER><PRG_CURR>ZCL_ARC1_DBG_DEMO=============CP</PRG_CURR><INCL_CURR>ZCL_ARC1_DBG_DEMO=============CM001</INCL_CURR><LINE_CURR>4</LINE_CURR><RFCDEST>appserver-rpsxx</RFCDEST><APPLSERVER/><SYSID>TRL</SYSID><SYSNR>0</SYSNR><DBGKEY/><TSTMP>0</TSTMP><DBGEE_KIND>DEBUGGEE</DBGEE_KIND><DUMPID/><DUMPDATE>0000-00-00</DUMPDATE><DUMPTIME>00:00:00</DUMPTIME><DUMPHOST/><DUMPMODNO>0</DUMPMODNO><LISTENER_CTX_ID/><IS_ATTACH_IMPOSSIBLE>false</IS_ATTACH_IMPOSSIBLE><APPSERVER>10-0-0-1.pod.cluster.local</APPSERVER><IS_SAME_SERVER>false</IS_SAME_SERVER><CAN_ADT_CROSS_SERVER>true</CAN_ADT_CROSS_SERVER><INSTANCE_NAME>appserver-rpsxx</INSTANCE_NAME><HOST>10-0-0-1</HOST><DUMP_ID/><DUMP_DATE>0000-00-00</DUMP_DATE><DUMP_TIME>00:00:00</DUMP_TIME><DUMP_HOST/><DUMP_UNAME/><DUMP_MODNO>0</DUMP_MODNO><DUMP_CLIENT/><DUMP_URI/><URI>/sap/bc/adt/oo/classes/zcl_arc1_dbg_demo/source/main#start=18,0</URI><TYPE>CLAS/OC</TYPE><NAME>ZCL_ARC1_DBG_DEMO</NAME><PARENT_URI/><PACKAGE_NAME/><DESCRIPTION/></STPDA_DEBUGGEE></DATA></asx:values></asx:abap>`;

const STACK_XML = `<?xml version="1.0" encoding="utf-8"?><dbg:stack xmlns:dbg="http://www.sap.com/adt/debugger" isRfc="false" isSameSystem="true" serverName="vhcala4hci"><stackEntry stackPosition="3" stackType="ABAP" stackUri="/sap/bc/adt/debugger/stack/type/ABAP/position/3" programName="ZCL_ORDER=====================CP" includeName="ZCL_ORDER=====================CM002" line="12" eventType="METHOD" eventName="GET_TOTAL" sourceType="ABAP" systemProgram="false" isVit="false" uri="/sap/bc/adt/oo/classes/zcl_order/source/main#start=42,4"/><stackEntry stackPosition="2" stackType="ABAP" programName="ZCL_ORDER=====================CP" includeName="ZCL_ORDER=====================CCAU" line="20" eventType="METHOD" eventName="TOTAL_IS_SUM" systemProgram="false" uri="/sap/bc/adt/oo/classes/zcl_order/includes/testclasses#start=20,4"/><stackEntry stackPosition="1" stackType="ABAP" programName="SAPLSAUNIT_TEST_RUNNER" includeName="LSAUNIT_TEST_RUNNERU01" line="7" eventType="FUNCTION" eventName="SAUNIT_RUN" systemProgram="true"/></dbg:stack>`;

describe('debug identity', () => {
  it('upper-cases the user and gives every capture fresh 32-char ids', () => {
    const a = createDebugIdentity(' developer ');
    const b = createDebugIdentity('developer');
    expect(a.user).toBe('DEVELOPER');
    expect(a.ideId).toMatch(/^[0-9A-F]{32}$/);
    expect(a.terminalId).toMatch(/^[0-9A-F]{32}$/);
    expect(a.ideId).not.toBe(b.ideId);
  });
});

describe('breakpoints', () => {
  it('builds a full-sync body with escaped identity, line and exception breakpoints', () => {
    const xml = buildBreakpointsXml(
      { user: 'DEV"<', terminalId: 'T1', ideId: 'I1' },
      [
        { kind: 'line', clientId: 'arc1-line-42', uri: '/sap/bc/adt/oo/classes/zcl_order/source/main', line: 42 },
        { kind: 'exception', clientId: 'arc1-exception', exceptionClass: 'CX_SY_ZERODIVIDE' },
      ],
      'external',
    );
    expect(xml).toContain('<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" scope="external"');
    expect(xml).toContain('debuggingMode="user"');
    expect(xml).toContain('requestUser="DEV&quot;&lt;"');
    expect(xml).toContain('terminalId="T1" ideId="I1" systemDebugging="false" deactivated="false"');
    expect(xml).toContain('<syncScope mode="full"></syncScope>');
    expect(xml).toContain(
      'kind="line" clientId="arc1-line-42" skipCount="0" adtcore:uri="/sap/bc/adt/oo/classes/zcl_order/source/main#start=42"',
    );
    expect(xml).toContain('kind="exception" clientId="arc1-exception" skipCount="0" exceptionClass="CX_SY_ZERODIVIDE"');
  });

  it('parses accepted and refused breakpoints, keeping SAP refusal text', () => {
    const states = parseBreakpointsResponse(
      `<?xml version="1.0" encoding="utf-8"?><dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" xmlns:adtcore="http://www.sap.com/adt/core"><breakpoint kind="line" clientId="arc1-line-41" errorMessage="Cannot create a breakpoint at this position"/><breakpoint kind="line" clientId="arc1-line-42" id="KIND=0.SOURCETYPE=ABAP.MAIN_PROGRAM=ZCL_ORDER=====CP.LINE_NR=12" adtcore:uri="/sap/bc/adt/oo/classes/zcl_order/source/main#start=42"/><breakpoint kind="exception" clientId="arc1-exception" id="KIND=5.EXCEPTION_CLASS=CX_SY_ZERODIVIDE" exceptionClass="CX_SY_ZERODIVIDE"/></dbg:breakpoints>`,
    );
    expect(states).toEqual([
      { clientId: 'arc1-line-41', kind: 'line', error: 'Cannot create a breakpoint at this position' },
      {
        clientId: 'arc1-line-42',
        kind: 'line',
        id: 'KIND=0.SOURCETYPE=ABAP.MAIN_PROGRAM=ZCL_ORDER=====CP.LINE_NR=12',
        uri: '/sap/bc/adt/oo/classes/zcl_order/source/main',
        line: 42,
      },
      {
        clientId: 'arc1-exception',
        kind: 'exception',
        id: 'KIND=5.EXCEPTION_CLASS=CX_SY_ZERODIVIDE',
        exceptionClass: 'CX_SY_ZERODIVIDE',
      },
    ]);
    expect(parseBreakpointsResponse('')).toEqual([]);
  });

  it('syncs the set with application/xml and deletes one by encoded id with the identity query', async () => {
    const http = mockHttp();
    await syncBreakpoints(http, SAFETY, IDENTITY, []);
    expect(http.post).toHaveBeenCalledWith(
      '/sap/bc/adt/debugger/breakpoints',
      expect.stringContaining('<syncScope mode="full"></syncScope></dbg:breakpoints>'),
      'application/xml',
      { Accept: 'application/xml' },
      undefined,
    );
    await deleteBreakpoint(http, SAFETY, IDENTITY, 'KIND=0.LINE_NR=12', 'debugger');
    const [url] = http.delete.mock.calls[0]!;
    expect(url).toBe(
      '/sap/bc/adt/debugger/breakpoints/KIND%3D0.LINE_NR%3D12?debuggingMode=user&requestUser=DEVELOPER&terminalId=T1&ideId=I1&scope=debugger',
    );
  });
});

describe('safety gate (checkDebug)', () => {
  const cases: Array<[string, SafetyConfig, RegExp]> = [
    ['allowDebug=false', { ...unrestrictedSafetyConfig(), allowDebug: false }, /SAP_ALLOW_DEBUG=true/],
    [
      'allowDataPreview=false',
      { ...unrestrictedSafetyConfig(), allowDataPreview: false },
      /SAP_ALLOW_DATA_PREVIEW=true/,
    ],
    ['the restrictive default', defaultSafetyConfig(), /allowDebug=false/],
  ];
  for (const [label, safety, message] of cases) {
    it(`blocks every debugger request before HTTP when ${label}`, async () => {
      const http = mockHttp();
      await expect(syncBreakpoints(http, safety, IDENTITY, [])).rejects.toThrow(message);
      await expect(listenForDebuggee(http, safety, IDENTITY, 10)).rejects.toBeInstanceOf(AdtSafetyError);
      await expect(stopListener(http, safety, 'DEVELOPER')).rejects.toBeInstanceOf(AdtSafetyError);
      await expect(new DebuggerSession(http, safety, IDENTITY).attach('X')).rejects.toBeInstanceOf(AdtSafetyError);
      await expect(openSessionOnServer(http, safety, 'appserver-a')).rejects.toBeInstanceOf(AdtSafetyError);
      await expect(openSessionsAhead(http, safety)).rejects.toBeInstanceOf(AdtSafetyError);
      await expect(endSession(http, safety)).rejects.toBeInstanceOf(AdtSafetyError);
      expect(http.post).not.toHaveBeenCalled();
      expect(http.delete).not.toHaveBeenCalled();
    });
  }
});

describe('listener', () => {
  it('parses the stopped debuggee', () => {
    expect(parseDebuggee(DEBUGGEE_XML)).toEqual({
      id: 'DBGEE_42',
      user: 'DEVELOPER',
      program: 'ZCL_ORDER=====================CP',
      include: 'ZCL_ORDER=====================CM002',
      line: 12,
      kind: 'DEBUGGEE',
      attachImpossible: false,
      uri: '/sap/bc/adt/oo/classes/zcl_order/source/main#start=42',
      objectType: 'CLAS/OC',
      objectName: 'ZCL_ORDER',
    });
    expect(
      parseDebuggee(DEBUGGEE_XML.replace('<IS_ATTACH_IMPOSSIBLE>false', '<IS_ATTACH_IMPOSSIBLE>X'))?.attachImpossible,
    ).toBe(true);
    expect(parseDebuggee('')).toBeUndefined();
    expect(parseDebuggee(DEBUGGEE_XML.replace('DBGEE_42', ''))).toBeUndefined();
  });

  it('reads the application server the debuggee waits on (BTP ABAP, live shape)', () => {
    expect(parseDebuggee(BTP_DEBUGGEE_XML)).toMatchObject({
      id: '26F50987F8801FD1B3D64A7DABE34570',
      user: 'CB9900000001',
      line: 4,
      instance: 'appserver-rpsxx',
      attachImpossible: false,
    });
    expect(parseDebuggee(DEBUGGEE_XML)?.instance).toBeUndefined();
  });

  it('long-polls with the identity, conflict flags and a server timeout, granting HTTP 30s of grace', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue(ok(DEBUGGEE_XML)) });
    const result = await listenForDebuggee(http, SAFETY, IDENTITY, 45);
    expect(result).toMatchObject({ status: 'caught', debuggee: { id: 'DBGEE_42', line: 12 } });
    const [url, body, contentType, headers, options] = http.post.mock.calls[0]!;
    expect(url).toBe(
      '/sap/bc/adt/debugger/listeners?debuggingMode=user&requestUser=DEVELOPER&terminalId=T1&ideId=I1&checkConflict=true&isNotifiedOnConflict=true&timeout=45',
    );
    expect(body).toBeUndefined();
    expect(contentType).toBeUndefined();
    expect(headers).toEqual({ Accept: 'application/vnd.sap.as+xml' });
    expect(options).toMatchObject({ fetchTimeoutMs: 75_000 });
  });

  it('reads an empty answer as "nobody stopped"', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue(ok('')) });
    expect(await listenForDebuggee(http, SAFETY, IDENTITY, 5)).toEqual({ status: 'timeout' });
  });

  it('reports a conflict delivered as an HTTP error or inside a 200 body', async () => {
    const conflictBody = debuggerException(
      'conflictDetected',
      'Listener conflict',
      '<entry key="conflictText">User DEVELOPER is already debugged by Eclipse</entry>',
    );
    const viaError = mockHttp({
      post: vi.fn().mockRejectedValue(new AdtApiError('conflict', 409, '/sap/bc/adt/debugger/listeners', conflictBody)),
    });
    expect(await listenForDebuggee(viaError, SAFETY, IDENTITY, 5)).toEqual({
      status: 'conflict',
      message: 'User DEVELOPER is already debugged by Eclipse',
    });
    const viaBody = mockHttp({ post: vi.fn().mockResolvedValue(ok(conflictBody)) });
    expect((await listenForDebuggee(viaBody, SAFETY, IDENTITY, 5)).status).toBe('conflict');
  });

  it('rethrows listener failures that are not conflicts', async () => {
    const http = mockHttp({
      post: vi
        .fn()
        .mockRejectedValue(
          new AdtApiError('nope', 403, '/x', debuggerException('notAuthorized', 'No debug authorization')),
        ),
    });
    await expect(listenForDebuggee(http, SAFETY, IDENTITY, 5)).rejects.toThrow(AdtApiError);
  });

  it('checks for a competing listener, tolerating releases without the check', async () => {
    expect(await findListenerConflict(mockHttp(), SAFETY, IDENTITY)).toBeUndefined();
    const conflict = mockHttp({
      get: vi
        .fn()
        .mockRejectedValue(
          new AdtApiError('conflict', 409, '/x', debuggerException('conflictNotification', 'Another IDE is listening')),
        ),
    });
    expect(await findListenerConflict(conflict, SAFETY, IDENTITY)).toBe('Another IDE is listening');
    const absent = mockHttp({ get: vi.fn().mockRejectedValue(new AdtApiError('missing', 404, '/x')) });
    expect(await findListenerConflict(absent, SAFETY, IDENTITY)).toBeUndefined();
    const broken = mockHttp({ get: vi.fn().mockRejectedValue(new AdtApiError('boom', 500, '/x')) });
    await expect(findListenerConflict(broken, SAFETY, IDENTITY)).rejects.toThrow(AdtApiError);
  });

  it('removes the listener by user alone — SAP does not key user-mode listeners by ide/terminal', async () => {
    const http = mockHttp();
    await stopListener(http, SAFETY, 'developer');
    expect(http.delete).toHaveBeenCalledWith(
      '/sap/bc/adt/debugger/listeners?debuggingMode=user&requestUser=DEVELOPER',
      { Accept: '*/*' },
      undefined,
    );
  });
});

describe("the debuggee's application server", () => {
  const contextOn = (server: string) => `SID%3aANON%3a${server}%3aKX9qZ-NEW`;

  /** New stateful sessions land on `landings` in turn; a session learns its context from its first answer. */
  function balancedSap(landings: Array<string | undefined>, probe?: ReturnType<typeof vi.fn>) {
    type FakeSession = {
      get: ReturnType<typeof vi.fn>;
      endStatefulSession: ReturnType<typeof vi.fn>;
      sessionContextId?: string;
    };
    const sessions: FakeSession[] = [];
    const http = {
      openStatefulSession: vi.fn(() => {
        const landing = landings[sessions.length % landings.length];
        const session: FakeSession = { get: vi.fn(), endStatefulSession: vi.fn().mockResolvedValue(true) };
        session.get =
          probe ??
          vi.fn(async () => {
            session.sessionContextId ??= landing && contextOn(landing);
            return ok('{}');
          });
        sessions.push(session);
        return session;
      }),
    } as unknown as AdtHttpClient;
    const ended = () => sessions.filter((session) => session.endStatefulSession.mock.calls.length > 0);
    return { http, sessions, ended };
  }

  it('reads the server out of a sap-contextid, and nothing out of other shapes', () => {
    expect(contextServer(contextOn('appserver-t4w2x'))).toBe('appserver-t4w2x');
    expect(contextServer('SID%3aANON%3avhcala4hci_A4H_00%3aABC-NEW')).toBe('vhcala4hci_A4H_00');
    expect(contextServer(undefined)).toBeUndefined();
    expect(contextServer('opaque-context-42')).toBeUndefined();
    expect(contextServer('%E0%A4%A')).toBeUndefined();
  });

  it("opens sessions until one lands on the debuggee's server and ends the others", async () => {
    const { http, sessions, ended } = balancedSap(['appserver-t4w2x', 'appserver-t4w2x', 'appserver-rpsxx']);
    const pinned = await openSessionOnServer(http, SAFETY, 'APPSERVER-RPSXX');
    expect(pinned).toMatchObject({ instance: 'appserver-rpsxx', probes: 3 });
    expect(pinned.http).toBe(sessions[2]);
    expect(sessions[0]!.get).toHaveBeenNthCalledWith(
      1,
      '/sap/bc/adt/core/http/systeminformation',
      { Accept: 'application/vnd.sap.adt.core.http.systeminformation.v1+json' },
      { suppressNotFoundLog: true },
    );
    expect(sessions[0]!.get).toHaveBeenCalledTimes(1);
    expect(sessions[0]!.endStatefulSession).toHaveBeenCalledWith({});
    expect(ended()).toEqual([sessions[0], sessions[1]]);
  });

  it('opens sessions ahead of the run until two share a server', async () => {
    const { http, sessions, ended } = balancedSap(['appserver-t4w2x', 'appserver-rpsxx', 'appserver-t4w2x']);
    const ahead = await openSessionsAhead(http, SAFETY);
    expect([...ahead.byServer.entries()]).toEqual([
      ['APPSERVER-T4W2X', sessions[0]],
      ['APPSERVER-RPSXX', sessions[1]],
    ]);
    expect(ahead.trigger).toBe(sessions[2]);
    expect(ended()).toEqual([]);
  });

  it('opens nothing to pin when SAP names no server, and stops at maxProbes distinct servers', async () => {
    const unnamed = balancedSap([undefined]);
    expect(await openSessionsAhead(unnamed.http, SAFETY)).toEqual({ byServer: new Map() });
    expect(unnamed.sessions).toHaveLength(1);
    const absent = balancedSap(['appserver-t4w2x'], vi.fn().mockRejectedValue(new AdtApiError('no', 404, '/x')));
    expect(await openSessionsAhead(absent.http, SAFETY)).toEqual({ byServer: new Map() });

    const many = balancedSap(['appserver-a', 'appserver-b', 'appserver-c']);
    const ahead = await openSessionsAhead(many.http, SAFETY, { maxProbes: 3 });
    expect([...ahead.byServer.keys()]).toEqual(['APPSERVER-A', 'APPSERVER-B', 'APPSERVER-C']);
    expect(ahead.trigger).toBeUndefined();

    const broken = balancedSap(['appserver-a'], vi.fn().mockRejectedValue(new AdtApiError('boom', 500, '/x')));
    await expect(openSessionsAhead(broken.http, SAFETY)).rejects.toThrow(AdtApiError);
  });

  it('ends the sessions it already opened when a later probe fails', async () => {
    const first = {
      get: vi.fn().mockResolvedValue(ok('{}')),
      endStatefulSession: vi.fn().mockResolvedValue(true),
      sessionContextId: contextOn('appserver-a'),
    };
    const second = {
      get: vi.fn().mockRejectedValue(new AdtApiError('boom', 500, '/x')),
      endStatefulSession: vi.fn().mockResolvedValue(undefined),
      sessionContextId: undefined,
    };
    const http = {
      openStatefulSession: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    } as unknown as AdtHttpClient;
    await expect(openSessionsAhead(http, SAFETY)).rejects.toThrow(AdtApiError);
    expect(first.endStatefulSession).toHaveBeenCalledTimes(1);
    expect(second.get).toHaveBeenCalledTimes(1);
  });

  it('takes the first session as is when the debuggee names no server', async () => {
    const { http, sessions } = balancedSap(['appserver-t4w2x']);
    expect(await openSessionOnServer(http, SAFETY, undefined)).toEqual({ http: sessions[0], probes: 0 });
    expect(sessions[0]!.get).not.toHaveBeenCalled();
  });

  it('takes the probed session when SAP does not say where it landed', async () => {
    const { http, sessions, ended } = balancedSap([undefined]);
    expect(await openSessionOnServer(http, SAFETY, 'appserver-rpsxx')).toEqual({ http: sessions[0], probes: 1 });
    expect(ended()).toEqual([]);
  });

  it('takes the session as is when the release has no resource to probe with', async () => {
    const absent = balancedSap(['appserver-t4w2x'], vi.fn().mockRejectedValue(new AdtApiError('no', 404, '/x')));
    expect(await openSessionOnServer(absent.http, SAFETY, 'appserver-rpsxx')).toEqual({
      http: absent.sessions[0],
      probes: 1,
    });
    const broken = balancedSap(['appserver-t4w2x'], vi.fn().mockRejectedValue(new AdtApiError('boom', 500, '/x')));
    await expect(openSessionOnServer(broken.http, SAFETY, 'appserver-rpsxx')).rejects.toThrow(AdtApiError);
  });

  it('returns the last session after maxProbes misses, saying where it landed', async () => {
    const { http, sessions, ended } = balancedSap(['appserver-t4w2x']);
    const pinned = await openSessionOnServer(http, SAFETY, 'appserver-rpsxx', { maxProbes: 3 });
    expect(pinned).toMatchObject({ instance: 'appserver-t4w2x', probes: 3 });
    expect(pinned.http).toBe(sessions[2]);
    expect(ended()).toEqual([sessions[0], sessions[1]]);
  });

  it("ends a session through the transport's own close (the Eclipse close-session request)", async () => {
    const session = Object.assign(mockHttp(), { endStatefulSession: vi.fn().mockResolvedValue(false) });
    await expect(endSession(session, SAFETY, { deadline: 42 })).resolves.toBeUndefined();
    expect(session.endStatefulSession).toHaveBeenCalledWith({ deadline: 42 });
    expect(session.get).not.toHaveBeenCalled();
  });
});

describe('debugger exception documents', () => {
  it('extracts subType, message and conflict text, decoding entities', () => {
    const parsed = parseDebuggerException(
      debuggerException('debuggeeEnded', 'Debuggee &quot;X&quot; ended', '<entry key="conflictText">a &amp; b</entry>'),
    );
    expect(parsed).toEqual({
      type: 'ExceptionResourceFailure',
      subType: 'debuggeeEnded',
      message: 'Debuggee "X" ended',
      conflictText: 'a & b',
    });
    expect(parseDebuggerException('<other/>')).toBeUndefined();
    expect(parseDebuggerException(undefined)).toBeUndefined();
    expect(debuggerErrorSubType(new AdtApiError('x', 400, '/x', debuggerException('invalidDebuggee')))).toBe(
      'invalidDebuggee',
    );
    expect(debuggerErrorSubType(new Error('plain'))).toBeUndefined();
  });
});

describe('session documents', () => {
  it('parses the attach answer', () => {
    expect(
      parseAttachResponse(
        '<dbg:attach xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true" isPostMortem="false"><reachedBreakpoints><breakpoint id="BP1" kind="line"/></reachedBreakpoints></dbg:attach>',
      ),
    ).toEqual({ steppingPossible: true, postMortem: false, reachedBreakpoints: [{ id: 'BP1', kind: 'line' }] });
    expect(parseAttachResponse('<dbg:attach xmlns:dbg="http://www.sap.com/adt/debugger"/>').steppingPossible).toBe(
      true,
    );
  });

  it('parses stack entries in document order with the system-program flag', () => {
    const stack = parseStackResponse(STACK_XML);
    expect(stack).toHaveLength(3);
    expect(stack[0]).toEqual({
      position: 3,
      stackType: 'ABAP',
      program: 'ZCL_ORDER=====================CP',
      include: 'ZCL_ORDER=====================CM002',
      line: 12,
      eventType: 'METHOD',
      eventName: 'GET_TOTAL',
      systemProgram: false,
      uri: '/sap/bc/adt/oo/classes/zcl_order/source/main#start=42,4',
    });
    expect(stack[2]?.systemProgram).toBe(true);
  });

  it('builds escaped asXML request bodies', () => {
    expect(buildVariablesXml(['LS_A-B', 'ME->MV_X'])).toContain(
      '<DATA><STPDA_ADT_VARIABLE><ID>LS_A-B</ID></STPDA_ADT_VARIABLE><STPDA_ADT_VARIABLE><ID>ME-&gt;MV_X</ID></STPDA_ADT_VARIABLE></DATA>',
    );
    expect(buildChildVariablesXml(['@ROOT'])).toContain(
      '<DATA><HIERARCHIES><STPDA_ADT_VARIABLE_HIERARCHY><PARENT_ID>@ROOT</PARENT_ID></STPDA_ADT_VARIABLE_HIERARCHY></HIERARCHIES></DATA>',
    );
  });

  it("keeps a value's blanks as SAP sent them, and trims the identifying fields", () => {
    const [text] = parseVariablesResponse(
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><STPDA_ADT_VARIABLE><ID> LV_TEXT </ID><META_TYPE>string</META_TYPE><VALUE> 124 </VALUE></STPDA_ADT_VARIABLE></DATA></asx:values></asx:abap>',
    );
    expect(text).toMatchObject({ id: 'LV_TEXT', metaType: 'string', value: ' 124 ' });
  });

  it('parses variables and child variables', () => {
    const variables = parseVariablesResponse(
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><STPDA_ADT_VARIABLE><ID>LV_TOTAL</ID><NAME>LV_TOTAL</NAME><DECLARED_TYPE_NAME>I</DECLARED_TYPE_NAME><META_TYPE>simple</META_TYPE><VALUE>42</VALUE><TECHNICAL_TYPE>I</TECHNICAL_TYPE><IS_VALUE_INCOMPLETE/></STPDA_ADT_VARIABLE><STPDA_ADT_VARIABLE><ID>LT_ITEMS</ID><NAME>LT_ITEMS</NAME><DECLARED_TYPE_NAME>ZTT_ITEMS</DECLARED_TYPE_NAME><META_TYPE>TABLE</META_TYPE><VALUE/><TABLE_LINES>3</TABLE_LINES></STPDA_ADT_VARIABLE><STPDA_ADT_VARIABLE><ID>LV_TEXT</ID><NAME>LV_TEXT</NAME><META_TYPE>string</META_TYPE><VALUE>a &lt;b&gt; &#x41;</VALUE><IS_VALUE_INCOMPLETE>X</IS_VALUE_INCOMPLETE></STPDA_ADT_VARIABLE></DATA></asx:values></asx:abap>',
    );
    expect(variables[0]).toMatchObject({ id: 'LV_TOTAL', metaType: 'simple', value: '42', incomplete: false });
    expect(variables[1]).toMatchObject({ id: 'LT_ITEMS', metaType: 'table', tableLines: 3 });
    expect(variables[2]).toMatchObject({ value: 'a <b> A', incomplete: true });
    // An out-of-range numeric reference stays literal instead of failing the whole capture.
    const odd = parseVariablesResponse(
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><STPDA_ADT_VARIABLE><ID>LV_X</ID><VALUE>&#x110000;&#65;</VALUE></STPDA_ADT_VARIABLE></DATA></asx:values></asx:abap>',
    );
    expect(odd[0]?.value).toBe('&#x110000;A');

    const children = parseChildVariablesResponse(
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><HIERARCHIES><STPDA_ADT_VARIABLE_HIERARCHY><PARENT_ID>@ROOT</PARENT_ID><CHILD_ID>@LOCALS</CHILD_ID><CHILD_NAME>Locals</CHILD_NAME></STPDA_ADT_VARIABLE_HIERARCHY></HIERARCHIES><VARIABLES/></DATA></asx:values></asx:abap>',
    );
    expect(children).toEqual({
      hierarchies: [{ parentId: '@ROOT', childId: '@LOCALS', childName: 'Locals' }],
      variables: [],
    });
    expect(parseChildVariablesResponse('')).toEqual({ hierarchies: [], variables: [] });
  });
});

describe('DebuggerSession', () => {
  it('attaches with the debuggee id, user mode and dynpro debugging', async () => {
    const http = mockHttp({
      post: vi
        .fn()
        .mockResolvedValue(ok('<dbg:attach xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true"/>')),
    });
    const attach = await new DebuggerSession(http, SAFETY, IDENTITY).attach('DBGEE_42');
    expect(attach.steppingPossible).toBe(true);
    expect(http.post.mock.calls[0]?.[0]).toBe(
      '/sap/bc/adt/debugger?method=attach&debuggeeId=DBGEE_42&dynproDebugging=true&debuggingMode=user&requestUser=DEVELOPER',
    );
    expect(http.post.mock.calls[0]?.[3]).toEqual({ Accept: '*/*' });
  });

  it('reads the stack from /debugger/stack', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue(ok(STACK_XML)) });
    const stack = await new DebuggerSession(http, SAFETY, IDENTITY).stack();
    expect(stack).toHaveLength(3);
    expect(http.get.mock.calls[0]?.[0]).toBe('/sap/bc/adt/debugger/stack?method=getStack&emode=_&semanticURIs=true');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('falls back to the dispatcher on 7.50 (no /debugger/stack) and remembers the shape', async () => {
    const http = mockHttp({
      get: vi.fn().mockRejectedValue(new AdtApiError('No suitable resource found', 404, '/sap/bc/adt/debugger/stack')),
      post: vi.fn().mockResolvedValue(ok(STACK_XML)),
    });
    const session = new DebuggerSession(http, SAFETY, IDENTITY);
    expect(await session.stack()).toHaveLength(3);
    expect(await session.stack()).toHaveLength(3);
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post.mock.calls[0]?.[0]).toBe('/sap/bc/adt/debugger?method=getStack&emode=_&semanticURIs=true');
  });

  it('treats a 404 after the resource already answered as a real failure', async () => {
    const http = mockHttp({
      get: vi
        .fn()
        .mockResolvedValueOnce(ok(STACK_XML))
        .mockRejectedValueOnce(new AdtApiError('gone', 404, '/sap/bc/adt/debugger/stack')),
    });
    const session = new DebuggerSession(http, SAFETY, IDENTITY);
    await session.stack();
    await expect(session.stack()).rejects.toThrow(AdtApiError);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('posts variable requests with the asXML content type', async () => {
    const http = mockHttp();
    const session = new DebuggerSession(http, SAFETY, IDENTITY);
    await session.variables(['LV_X']);
    await session.childVariables(['@ROOT']);
    expect(http.post.mock.calls[0]?.slice(0, 4)).toEqual([
      '/sap/bc/adt/debugger?method=getVariables',
      buildVariablesXml(['LV_X']),
      'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.debugger.Variables',
      { Accept: 'application/vnd.sap.as+xml' },
    ]);
    expect(http.post.mock.calls[1]?.[2]).toBe(
      'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.debugger.ChildVariables',
    );
    expect(await session.variables([])).toEqual([]);
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('reports a finished debuggee as ended instead of throwing', async () => {
    const http = mockHttp({
      post: vi
        .fn()
        .mockResolvedValueOnce(ok('<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="false"/>'))
        .mockRejectedValueOnce(new AdtApiError('ended', 400, '/x', debuggerException('debuggeeEnded')))
        .mockRejectedValueOnce(new AdtApiError('boom', 500, '/x', debuggerException('internalError'))),
    });
    const session = new DebuggerSession(http, SAFETY, IDENTITY);
    expect(await session.step('stepOver')).toEqual({
      status: 'stopped',
      steppingPossible: false,
      reachedBreakpoints: [],
    });
    expect(await session.step('stepOver')).toEqual({ status: 'ended', reason: 'debuggeeEnded' });
    await expect(session.step('stepOver')).rejects.toThrow(AdtApiError);
  });

  it('names the breakpoint a stepContinue stopped at, when SAP reports it', async () => {
    const http = mockHttp({
      post: vi
        .fn()
        .mockResolvedValue(
          ok(
            '<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger" isSteppingPossible="true"><reachedBreakpoints><breakpoint id="KIND=0.LINE_NR=40" kind="line"/></reachedBreakpoints></dbg:step>',
          ),
        ),
    });
    const session = new DebuggerSession(http, SAFETY, IDENTITY);
    expect(await session.step('stepContinue')).toEqual({
      status: 'stopped',
      steppingPossible: true,
      reachedBreakpoints: ['KIND=0.LINE_NR=40'],
    });
    expect(http.post.mock.calls[0]?.[0]).toBe('/sap/bc/adt/debugger?method=stepContinue');
  });

  it('retires one breakpoint from the attached run by deleting its session copy', async () => {
    const http = mockHttp();
    const session = new DebuggerSession(http, SAFETY, IDENTITY, { deadline: 123 });
    await session.removeBreakpoint('KIND=0.LINE_NR=40');
    const [url, , options] = http.delete.mock.calls[0] as [string, unknown, unknown];
    expect(url.startsWith('/sap/bc/adt/debugger/breakpoints/KIND%3D0.LINE_NR%3D40?')).toBe(true);
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('scope')).toBe('debugger');
    expect(query.get('requestUser')).toBe('DEVELOPER');
    expect(options).toEqual({ deadline: 123 });
    await expect(
      new DebuggerSession(http, { ...SAFETY, allowDebug: false }, IDENTITY).removeBreakpoint('X'),
    ).rejects.toThrow(AdtSafetyError);
  });

  describe('release', () => {
    const ended = () => new AdtApiError('ended', 400, '/x', debuggerException('debuggeeEnded'));

    it('clears the session breakpoints, then continues until SAP reports the end', async () => {
      const http = mockHttp({
        post: vi
          .fn()
          .mockResolvedValueOnce(ok('<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger"/>'))
          .mockResolvedValueOnce(ok('<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger"/>'))
          .mockRejectedValueOnce(ended()),
      });
      const result = await new DebuggerSession(http, SAFETY, IDENTITY).release(['BP1']);
      expect(result).toEqual({ released: true, via: 'continue' });
      expect(http.post.mock.calls[0]?.[0]).toBe('/sap/bc/adt/debugger/breakpoints');
      expect(http.post.mock.calls[0]?.[1]).toContain('scope="debugger"');
      expect(http.post.mock.calls.slice(1).map((call) => call[0])).toEqual([
        '/sap/bc/adt/debugger?method=stepContinue',
        '/sap/bc/adt/debugger?method=stepContinue',
      ]);
    });

    it('deletes session breakpoints by id when the empty sync fails', async () => {
      const http = mockHttp({
        post: vi
          .fn()
          .mockRejectedValueOnce(new AdtApiError('no', 400, '/x'))
          .mockRejectedValueOnce(ended()),
      });
      expect(await new DebuggerSession(http, SAFETY, IDENTITY).release(['BP1'])).toEqual({
        released: true,
        via: 'continue',
      });
      expect(http.delete.mock.calls[0]?.[0]).toContain('/sap/bc/adt/debugger/breakpoints/BP1?');
      expect(http.delete.mock.calls[0]?.[0]).toContain('scope=debugger');
    });

    it('terminates as the last resort when the debuggee keeps stopping', async () => {
      const post = vi.fn().mockResolvedValue(ok('<dbg:step xmlns:dbg="http://www.sap.com/adt/debugger"/>'));
      const result = await new DebuggerSession(mockHttp({ post }), SAFETY, IDENTITY).release([], 2);
      expect(result).toEqual({ released: true, via: 'terminate', detail: 'the debuggee kept stopping' });
      expect(post.mock.calls.map((call) => call[0])).toEqual([
        '/sap/bc/adt/debugger/breakpoints',
        '/sap/bc/adt/debugger?method=stepContinue',
        '/sap/bc/adt/debugger?method=stepContinue',
        '/sap/bc/adt/debugger?method=terminateDebuggee',
      ]);
    });

    it('reports a debuggee it could not release', async () => {
      const post = vi
        .fn()
        .mockResolvedValueOnce(ok())
        .mockRejectedValue(new AdtApiError('boom', 500, '/x', debuggerException('internalError', 'Kernel said no')));
      const result = await new DebuggerSession(mockHttp({ post }), SAFETY, IDENTITY).release([]);
      expect(result.released).toBe(false);
      expect(result.via).toBe('none');
      expect(result.detail).toContain('stepContinue failed: Kernel said no');
      expect(result.detail).toContain('terminateDebuggee failed: Kernel said no');
    });
  });
});
