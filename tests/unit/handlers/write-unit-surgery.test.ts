import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

type FetchCall = { method: string; url: string; body?: string };

function inactiveObjects(name: string, type: 'PROG' | 'INCL', hasDraft: boolean, adtTypeOverride?: string): string {
  if (!hasDraft) {
    return '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>';
  }
  const adtType = adtTypeOverride ?? (type === 'PROG' ? 'PROG/P' : 'PROG/I');
  return `<?xml version="1.0"?>
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects" xmlns:adtcore="http://www.sap.com/adt/core">
  <ioc:entry><ioc:object><adtcore:objectReference adtcore:type="${adtType}" adtcore:name="${name}" adtcore:uri="/source"/></ioc:object></ioc:entry>
</ioc:inactiveObjects>`;
}

function mockEditUnitFlow(opts: {
  type: 'PROG' | 'INCL';
  name: string;
  objectPath: string;
  activeSource: string;
  inactiveSource?: string;
  inactiveAdtType?: string;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string | URL, request?: { method?: string; body?: string | Buffer | null }) => {
    const method = request?.method ?? 'GET';
    const urlString = String(url);
    const parsed = new URL(urlString);
    calls.push({ method, url: urlString, body: typeof request?.body === 'string' ? request.body : undefined });

    if (method === 'GET' && parsed.pathname === '/sap/bc/adt/activation/inactiveobjects') {
      return Promise.resolve(
        mockResponse(
          200,
          inactiveObjects(opts.name, opts.type, opts.inactiveSource !== undefined, opts.inactiveAdtType),
          {
            'x-csrf-token': 'TOKEN',
          },
        ),
      );
    }
    if (method === 'GET' && parsed.pathname === opts.objectPath) {
      return Promise.resolve(
        mockResponse(
          200,
          '<abap:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></abap:object>',
          { 'x-csrf-token': 'TOKEN' },
        ),
      );
    }
    if (method === 'GET' && parsed.pathname === `${opts.objectPath}/source/main`) {
      const body =
        parsed.searchParams.get('version') === 'inactive'
          ? (opts.inactiveSource ?? opts.activeSource)
          : opts.activeSource;
      return Promise.resolve(mockResponse(200, body, { 'x-csrf-token': 'TOKEN' }));
    }
    if (method === 'POST' && parsed.pathname === opts.objectPath && parsed.searchParams.get('_action') === 'LOCK') {
      return Promise.resolve(
        mockResponse(
          200,
          '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
          { 'x-csrf-token': 'TOKEN' },
        ),
      );
    }
    if (method === 'PUT' && parsed.pathname === `${opts.objectPath}/source/main`) {
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
    }
    if (method === 'POST' && parsed.pathname === opts.objectPath && parsed.searchParams.get('_action') === 'UNLOCK') {
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
    }
    return Promise.resolve(mockResponse(404, `Unexpected ${method} ${urlString}`, { 'x-csrf-token': 'TOKEN' }));
  });
  return calls;
}

describe('SAPWrite edit_unit', () => {
  beforeEach(() => vi.resetAllMocks());

  it('validates unit, source, and supported object type before I/O', async () => {
    for (const args of [
      { action: 'edit_unit', type: 'PROG', name: 'ZTEST', source: 'FORM foo.\nENDFORM.' },
      { action: 'edit_unit', type: 'PROG', name: 'ZTEST', unit: 'foo' },
      { action: 'edit_unit', type: 'CLAS', name: 'ZCL_TEST', unit: 'foo', source: 'FORM foo.\nENDFORM.' },
    ]) {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
      expect(result.isError).toBe(true);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('splices one FORM in a PROG and writes the full source under lock', async () => {
    const name = 'ZARC1_UNIT';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    const calls = mockEditUnitFlow({
      type: 'PROG',
      name,
      objectPath,
      activeSource: `REPORT zarc1_unit.
FORM alpha.
  WRITE 'alpha'.
ENDFORM.
FORM beta.
  WRITE 'old'.
ENDFORM.`,
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_unit',
      type: 'PROG',
      name,
      unit: 'beta',
      source: "FORM beta.\n  WRITE 'new'.\nENDFORM.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Successfully updated FORM "beta"');
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(`${objectPath}/source/main`);
    expect(put?.body).toContain("WRITE 'new'.");
    expect(put?.body).toContain("WRITE 'alpha'.");
    expect(put?.body).not.toContain("WRITE 'old'.");
  });

  it('splices into an existing inactive draft for consecutive edits', async () => {
    const name = 'ZARC1_DRAFT';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    const calls = mockEditUnitFlow({
      type: 'PROG',
      name,
      objectPath,
      activeSource: "REPORT zarc1_draft.\nFORM first.\n  WRITE 'active'.\nENDFORM.\nFORM second.\nENDFORM.",
      inactiveSource: "REPORT zarc1_draft.\nFORM first.\n  WRITE 'draft change'.\nENDFORM.\nFORM second.\nENDFORM.",
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_unit',
      type: 'PROG',
      name,
      unit: 'second',
      source: "FORM second.\n  WRITE 'second change'.\nENDFORM.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(calls.some((call) => call.method === 'GET' && call.url.includes('version=inactive'))).toBe(true);
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain("WRITE 'draft change'.");
    expect(put?.body).toContain("WRITE 'second change'.");
  });

  it('recognizes an inactive INCL draft reported by ADT as PROG/I', async () => {
    const name = 'ZARC1_INCLUDE';
    const objectPath = `/sap/bc/adt/programs/includes/${name}`;
    const calls = mockEditUnitFlow({
      type: 'INCL',
      name,
      objectPath,
      activeSource: "FORM first.\n  WRITE 'active'.\nENDFORM.\nFORM second.\nENDFORM.",
      inactiveSource: "FORM first.\n  WRITE 'draft change'.\nENDFORM.\nFORM second.\nENDFORM.",
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_unit',
      type: 'INCL',
      name,
      unit: 'second',
      source: "FORM second.\n  WRITE 'second change'.\nENDFORM.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(calls.some((call) => call.method === 'GET' && call.url.includes('version=inactive'))).toBe(true);
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain("WRITE 'draft change'.");
    expect(put?.body).toContain("WRITE 'second change'.");
  });

  it('supports MODULE surgery in a function-group structural INCL', async () => {
    const name = 'LZARC1O01';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const calls = mockEditUnitFlow({
      type: 'INCL',
      name,
      objectPath,
      activeSource: "MODULE status_0100 OUTPUT.\n  SET PF-STATUS 'OLD'.\nENDMODULE.",
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_unit',
      type: 'INCL',
      group,
      name,
      unit: 'status_0100',
      source: "MODULE status_0100 OUTPUT.\n  SET PF-STATUS 'NEW'.\nENDMODULE.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Successfully updated MODULE');
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(objectPath);
    expect(put?.body).toContain("SET PF-STATUS 'NEW'.");
  });

  it('splices into a FUGR/I inactive draft instead of overwriting it with active source', async () => {
    const name = 'LZARC1TOP';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const calls = mockEditUnitFlow({
      type: 'INCL',
      name,
      objectPath,
      activeSource: "FORM first.\n  WRITE 'active'.\nENDFORM.\nFORM second.\nENDFORM.",
      inactiveSource: "FORM first.\n  WRITE 'draft change'.\nENDFORM.\nFORM second.\nENDFORM.",
      inactiveAdtType: 'FUGR/I',
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_unit',
      type: 'INCL',
      group,
      name,
      unit: 'second',
      source: "FORM second.\n  WRITE 'second change'.\nENDFORM.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(calls.some((call) => call.method === 'GET' && call.url.includes('version=inactive'))).toBe(true);
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain("WRITE 'draft change'.");
    expect(put?.body).toContain("WRITE 'second change'.");
    expect(result.content[0]?.text).toContain('SAPActivate(type="INCL"');
  });
});
