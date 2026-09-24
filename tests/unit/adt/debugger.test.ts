import { describe, expect, it, vi } from 'vitest';
import {
  addBreakpoint,
  buildBreakpointXml,
  deleteBreakpoint,
  listenDebugger,
  parseBreakpoints,
} from '../../../src/adt/debugger.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';

function http(responses: string[] = []): AdtHttpClient {
  return {
    post: vi.fn(async () => ({ body: responses.shift() ?? '' })),
    delete: vi.fn(async () => ({ body: '' })),
  } as unknown as AdtHttpClient;
}

describe('ADT debugger', () => {
  it('escapes a line breakpoint and preserves its source URI', () => {
    expect(
      buildBreakpointXml(
        { kind: 'line', uri: '/sap/bc/adt/programs/programs/Z<TEST', line: 7, condition: "x = 'y'" },
        'DEV&USER',
        'arc1<local',
      ),
    ).toContain('adtcore:uri="/sap/bc/adt/programs/programs/Z&lt;TEST#start=7"');
    expect(
      buildBreakpointXml(
        { kind: 'line', uri: '/sap/bc/adt/programs/programs/Z<TEST', line: 7, condition: "x = 'y'" },
        'DEV&USER',
        'arc1<local',
      ),
    ).toContain('requestUser="DEV&amp;USER"');
  });

  it('parses the breakpoint response returned by ADT', () => {
    expect(
      parseBreakpoints(
        '<dbg:breakpoints xmlns:dbg="x"><breakpoint id="bp-1" kind="line" uri="/source#start=12" condition="a = b"/></dbg:breakpoints>',
      ),
    ).toEqual([
      {
        id: 'bp-1',
        kind: 'line',
        uri: '/source',
        line: 12,
        condition: 'a = b',
        statement: undefined,
        exception: undefined,
        error: undefined,
      },
    ]);
  });

  it('uses encoded ADT URLs for breakpoint writes and deletes', async () => {
    const client = http(['<breakpoints><breakpoint id="bp-1" kind="exception"/></breakpoints>']);
    await addBreakpoint(client, { kind: 'exception', exception: 'CX_SY_NO_HANDLER' }, 'DEV', 'arc1-local');
    await deleteBreakpoint(client, 'bp / 1', 'DEV', 'arc1-local');
    expect(client.post).toHaveBeenCalledWith(
      '/sap/bc/adt/debugger/breakpoints',
      expect.stringContaining('exceptionClass="CX_SY_NO_HANDLER"'),
      'application/xml',
      { Accept: 'application/xml' },
    );
    expect(client.delete).toHaveBeenCalledWith(expect.stringContaining('/bp%20%2F%201?'));
  });

  it('extracts an opaque debuggee identifier from the listener response', async () => {
    const client = http([
      '<asx:abap xmlns:asx="x"><asx:values><DATA><DEBUGGEE_ID>abc-123</DEBUGGEE_ID></DATA></asx:values></asx:abap>',
    ]);
    await expect(listenDebugger(client, 'DEV', 'arc1-local', 60)).resolves.toMatchObject({ debuggeeId: 'abc-123' });
  });
});
