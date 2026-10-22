/**
 * SAPRead expand_includes for PROG and INCL (FEAT-23): the program and its nested includes in one
 * bounded response, grep across them, and the include hint for a grep of the program alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const PROGRAM = [
  'REPORT zdemo_report.',
  'INCLUDE zdemo_report_top.',
  'INCLUDE: zdemo_report_f01,',
  '         zdemo_report_o01.',
  'INCLUDE <icon>.',
].join('\n');

const INCLUDES: Record<string, string> = {
  zdemo_report_top: 'DATA gv_count TYPE i.\nINCLUDE zdemo_report_opt IF FOUND.\nINCLUDE lsvimtdt.',
  zdemo_report_f01: "FORM run.\n  CALL FUNCTION 'ENQUEUE_EZDEMO'.\nENDFORM.\nINCLUDE zdemo_report_f02.",
  zdemo_report_o01: 'MODULE status_0100 OUTPUT.\nENDMODULE.',
  zdemo_report_f02: "FORM save.\n  CALL FUNCTION 'ENQUEUE_EZDEMO'.\nENDFORM.",
};

/** The user's inactive objects: a draft of zdemo_report_f01 only. */
const INACTIVE_F01 =
  '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/programs/includes/zdemo_report_f01" adtcore:type="PROG/I" adtcore:name="ZDEMO_REPORT_F01"/></ioc:object></ioc:entry></ioc:inactiveObjects>';

function serve(overrides: Record<string, string> = {}): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/activation/inactiveobjects')) {
      return Promise.resolve(
        overrides.inactive ? mockResponse(200, overrides.inactive) : mockResponse(404, 'not found'),
      );
    }
    if (
      url.includes('/programs/programs/zdemo_report/source/main') ||
      url.includes('/programs/programs/ZDEMO_REPORT/source/main')
    ) {
      return Promise.resolve(mockResponse(200, overrides.root ?? PROGRAM));
    }
    const include = /\/programs\/includes\/([^/]+)\/source\/main/.exec(url)?.[1]?.toLowerCase();
    const body = include ? (overrides[include] ?? INCLUDES[include]) : undefined;
    return Promise.resolve(body === undefined ? mockResponse(404, 'not found') : mockResponse(200, body));
  });
}

async function read(args: Record<string, unknown>, client = createClient()) {
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
    type: 'PROG',
    name: 'ZDEMO_REPORT',
    ...args,
  });
  return { isError: result.isError, text: result.content[0]?.text ?? '' };
}

const includeUrls = () =>
  mockFetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/programs/includes/'));

describe('SAPRead PROG/INCL expand_includes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serve();
  });

  it('returns the program and its nested includes as blocks, then names what it did not expand', async () => {
    const { isError, text } = await read({ expand_includes: true });

    expect(isError).toBeUndefined();
    const headings = [...text.matchAll(/^=== (.+) ===$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'PROG ZDEMO_REPORT',
      'zdemo_report_top (ZDEMO_REPORT line 2)',
      'zdemo_report_f01 (ZDEMO_REPORT line 3)',
      'zdemo_report_o01 (ZDEMO_REPORT line 4)',
      'zdemo_report_f02 (zdemo_report_f01 line 4)',
      '[include expansion]',
    ]);
    expect(text).toContain('=== zdemo_report_f02 (zdemo_report_f01 line 4) ===\nFORM save.');
    expect(text).toContain('Not expanded (system include): <icon> (ZDEMO_REPORT line 5).');
    expect(text).toContain('Not expanded (SAP include): lsvimtdt (zdemo_report_top line 3).');
    expect(text).toContain('Not present (INCLUDE ... IF FOUND): zdemo_report_opt (zdemo_report_top line 2).');
    // SAP and system includes are named, never read.
    expect(includeUrls().some((url) => /lsvimtdt|%3Cicon/i.test(url))).toBe(false);
  });

  it('greps every include on its own and keeps the notes', async () => {
    const { isError, text } = await read({ expand_includes: true, grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toMatch(/^2 match\(es\) for \/ENQUEUE_EZDEMO\/i in 2 of 5 source\(s\):/);
    expect(text).toContain(">    2:   CALL FUNCTION 'ENQUEUE_EZDEMO'.");
    expect(text).toContain('=== zdemo_report_f02 (zdemo_report_f01 line 4) ===');
    expect(text).toContain('Not searched (system include): <icon> (ZDEMO_REPORT line 5).');
    expect(text).not.toContain('gv_count');
  });

  it('hints at the includes when grep searched the program alone', async () => {
    const { isError, text } = await read({ grep: 'ENQUEUE_EZDEMO' });

    expect(isError).toBeUndefined();
    expect(text).toContain('No matches found for /ENQUEUE_EZDEMO/i.');
    expect(text).toContain(
      'Searched ZDEMO_REPORT only; its INCLUDE statements name 3 include(s) that expand_includes=true also searches (ZDEMO_REPORT_TOP, ZDEMO_REPORT_F01, ZDEMO_REPORT_O01).',
    );
    expect(includeUrls()).toEqual([]);
  });

  it('counts the includes the hint does not name', async () => {
    serve({ root: Array.from({ length: 7 }, (_, i) => `INCLUDE zdemo_inc${i}.`).join('\n') });
    const { text } = await read({ grep: 'ENQUEUE_EZDEMO' });
    expect(text).toContain(
      'name 7 include(s) that expand_includes=true also searches (ZDEMO_INC0, ZDEMO_INC1, ZDEMO_INC2, ZDEMO_INC3, ZDEMO_INC4 and 2 more).',
    );
  });

  it('adds no hint when the expansion would read none of the named includes', async () => {
    serve({ root: 'REPORT zdemo_report.\nINCLUDE <icon>.\nINCLUDE lsvimtdt.\nINCLUDE /abc/demo_top.' });
    const { text } = await read({ grep: 'ENQUEUE_EZDEMO' });
    expect(text).toBe('No matches found for /ENQUEUE_EZDEMO/i.');
  });

  it('refuses an unsupported grep pattern before reading any source', async () => {
    const { isError, text } = await read({ expand_includes: true, grep: '(?=ENQUEUE)' });
    expect(isError).toBe(true);
    expect(text).toContain('Unsupported grep pattern: lookaround assertions are disabled');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('adds no hint to a grep of a program without includes', async () => {
    serve({ root: "REPORT zdemo_report.\nCALL FUNCTION 'ENQUEUE_EZDEMO'." });
    const { text } = await read({ grep: 'ENQUEUE_EZDEMO' });
    expect(text).not.toContain('expand_includes');
  });

  it('expands from an include as the root', async () => {
    const { isError, text } = await read({ type: 'INCL', name: 'zdemo_report_f01', expand_includes: true });

    expect(isError).toBeUndefined();
    expect(text).toBe(
      `=== INCL zdemo_report_f01 ===\n${INCLUDES.zdemo_report_f01}\n\n=== zdemo_report_f02 (zdemo_report_f01 line 4) ===\n${INCLUDES.zdemo_report_f02}`,
    );
  });

  it('shortens at the character limit and points to the remaining lines', async () => {
    const big = Array.from({ length: 9_000 }, (_, i) => `  WRITE / ${String(i).padStart(4, '0')}.`).join('\n');
    serve({ zdemo_report_f01: big });
    const { isError, text } = await read({ expand_includes: true });

    expect(isError).toBeUndefined();
    expect(text.length).toBeLessThan(42_000);
    expect(text).toMatch(/\[\.\.\. lines \d+-9000 not shown \(character limit\)\]/);
    expect(text).toContain('Limit reached (40,000 characters). zdemo_report_f01 shows lines 1-');
    expect(text).toContain('Not expanded: zdemo_report_o01 (ZDEMO_REPORT line 4)');
    expect(includeUrls().some((url) => url.includes('zdemo_report_o01'))).toBe(false);
  });

  it("reads each include by the version rule of the request and marks the user's drafts", async () => {
    const versions = () =>
      Object.fromEntries(
        includeUrls().map((url) => [/includes\/([^/]+)\//.exec(url)?.[1], new URL(url).searchParams.get('version')]),
      );

    // active (default): every include active, nothing marked.
    let { text } = await read({ expand_includes: true });
    expect(Object.values(versions()).includes('inactive')).toBe(false);
    expect(text).not.toContain('inactive draft');

    // auto: only the user's own draft is read inactive, like the program itself, and it is marked.
    vi.resetAllMocks();
    serve({ inactive: INACTIVE_F01 });
    ({ text } = await read({ expand_includes: true, version: 'auto' }));
    expect(versions()).toMatchObject({ zdemo_report_f01: 'inactive', zdemo_report_top: 'active' });
    expect(versions().zdemo_report_o01).not.toBe('inactive');
    expect(text).toContain('=== zdemo_report_f01 (ZDEMO_REPORT line 3, inactive draft) ===');
    expect(text).toContain('=== zdemo_report_top (ZDEMO_REPORT line 2) ===');

    // inactive: every include inactive (SAP returns the active source without a draft), only the draft marked.
    vi.resetAllMocks();
    serve({ inactive: INACTIVE_F01 });
    ({ text } = await read({ expand_includes: true, version: 'inactive' }));
    expect(Object.values(versions()).every((version) => version === 'inactive')).toBe(true);
    expect(text).toContain('=== zdemo_report_f01 (ZDEMO_REPORT line 3, inactive draft) ===');
    expect(text).not.toContain('zdemo_report_top (ZDEMO_REPORT line 2, inactive draft)');
  });

  it('refuses the expansion where SAPRead type=INCL is denied', async () => {
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'admin',
      password: 'secret',
      safety: { ...unrestrictedSafetyConfig(), denyActions: ['SAPRead.INCL'] },
    });
    const { isError, text } = await read({ expand_includes: true }, client);

    expect(isError).toBe(true);
    expect(text).toContain('SAP_DENY_ACTIONS denies');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads the program alone without expand_includes', async () => {
    const { isError, text } = await read({});
    expect(isError).toBeUndefined();
    expect(text).toBe(PROGRAM);
    expect(includeUrls()).toEqual([]);
  });

  it('fails like a plain read when the program does not exist, without reading includes', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(mockResponse(404, 'Program ZDEMO_REPORT does not exist')));
    const expanded = await read({ expand_includes: true });
    const plain = await read({});
    expect(expanded.isError).toBe(true);
    expect(expanded.text).toContain('404');
    expect(expanded.text).toBe(plain.text);
    expect(includeUrls()).toEqual([]);
  });

  it('keeps line ranges a plain read', async () => {
    const { isError, text } = await read({ expand_includes: true, lineStart: 1, lineEnd: 2 });
    expect(isError).toBe(true);
    expect(text).toContain('omit format, includeSignature and expand_includes');
  });
});
