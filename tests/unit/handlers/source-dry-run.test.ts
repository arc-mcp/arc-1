import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unifiedDiff } from '../../../src/adt/source-diff.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const config = { ...DEFAULT_CONFIG, abapRelease: '758' };
const classPath = '/sap/bc/adt/oo/classes/ZDRY';
const progPath = '/sap/bc/adt/programs/programs/ZDRYP';
const classSource = [
  'CLASS zdry DEFINITION PUBLIC FINAL CREATE PUBLIC.',
  '  PUBLIC SECTION.',
  '    METHODS pub.',
  '  PRIVATE SECTION.',
  '    METHODS priv.',
  'ENDCLASS.',
  'CLASS zdry IMPLEMENTATION.',
  '  METHOD pub.',
  "    DATA(value) = 'pub'.",
  '  ENDMETHOD.',
  '  METHOD priv.',
  "    DATA(value) = 'priv'.",
  '  ENDMETHOD.',
  'ENDCLASS.',
  '',
].join('\n');
const progSource = "REPORT zdryp.\nFORM target.\n  WRITE 'old'.\nENDFORM.\n";

const link = (rel: string, range: string) =>
  `<atom:link rel="http://www.sap.com/adt/relations/source/${rel}" href="./../zdry/source/main#${range}"/>`;
const methodXml = (name: string, visibility: string, def: string, impl: string) =>
  `<abapsource:objectStructureElement adtcore:type="CLAS/OM" adtcore:name="${name}" level="instance" clif_name="ZDRY" visibility="${visibility}">${link('definitionBlock', def)}${link('implementationBlock', impl)}</abapsource:objectStructureElement>`;
const classStructure =
  '<abapsource:objectStructureElement adtcore:name="ZDRY" visibility="public" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:atom="http://www.w3.org/2005/Atom">' +
  link('definitionBlock', 'start=1,0;end=6,8') +
  link('implementationBlock', 'start=7,0;end=14,8') +
  methodXml('PUB', 'public', 'start=3,4;end=3,15', 'start=8,2;end=10,11') +
  methodXml('PRIV', 'private', 'start=5,4;end=5,16', 'start=11,2;end=13,11') +
  '</abapsource:objectStructureElement>';

interface Send {
  method: string;
  url: URL;
  body?: string;
  locked: boolean;
}

function backend(
  options: {
    classMain?: string;
    prog?: string;
    packageName?: string;
    missingInclude?: boolean;
    checkrun?: string;
    /** Called after every source GET, e.g. to simulate a concurrent writer. */
    afterRead?: (path: string, state: { sources: Map<string, string> }) => void;
  } = {},
) {
  const state = {
    sources: new Map<string, string>([
      [`${classPath}/source/main`, options.classMain ?? classSource],
      [`${classPath}/includes/implementations`, '* local implementations\n'],
      [`${progPath}/source/main`, options.prog ?? progSource],
    ]),
    locked: false,
    sends: [] as Send[],
  };
  if (options.missingInclude) state.sources.delete(`${classPath}/includes/implementations`);
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    state.sends.push({ method, url, body: init?.body, locked: state.locked });
    const respond = (status: number, body = '') => mockResponse(status, body, { 'x-csrf-token': 'T' });
    if (method === 'HEAD') return respond(200);
    if (url.pathname === '/sap/bc/adt/activation/inactiveobjects')
      return respond(200, '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>');
    if (method === 'GET' && url.pathname.endsWith('/objectstructure')) return respond(200, classStructure);
    if (method === 'GET' && (url.pathname === classPath || url.pathname === progPath))
      return respond(
        200,
        `<object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${options.packageName ?? '$TMP'}"/></object>`,
      );
    if (method === 'GET') {
      const body = state.sources.get(url.pathname);
      options.afterRead?.(url.pathname, state);
      return body === undefined ? respond(404, 'Not found') : respond(200, body);
    }
    if (method === 'POST' && url.pathname === '/sap/bc/adt/checkruns' && options.checkrun)
      return respond(200, options.checkrun);
    if (method === 'POST' && url.searchParams.get('_action') === 'LOCK') {
      state.locked = true;
      return respond(
        200,
        '<asx:abap><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values></asx:abap>',
      );
    }
    if (method === 'POST' && url.searchParams.get('_action') === 'UNLOCK') {
      state.locked = false;
      return respond(200);
    }
    if (method === 'PUT') {
      state.sources.set(url.pathname, String(init?.body));
      return respond(200);
    }
    return respond(404, `Unexpected ${method} ${url.pathname}`);
  });
  return state;
}

const call = (args: Record<string, unknown>, client = createClient()) =>
  handleToolCall(client, config, 'SAPWrite', { lintBeforeWrite: false, ...args });
const text = (result: { content: Array<{ text: string }> }) => result.content[0]?.text ?? '';
const summaryOf = (result: { content: Array<{ text: string }> }) =>
  JSON.parse(text(result).split('\n\n')[1] ?? '{}') as Record<string, unknown>;
const mutations = (state: ReturnType<typeof backend>) =>
  state.sends.filter((s) => !(s.method === 'GET' || s.method === 'HEAD'));

const cls = { type: 'CLAS', name: 'ZDRY' };
const prog = { type: 'PROG', name: 'ZDRYP' };
const actions: Array<{ label: string; args: Record<string, unknown>; url: string; current: string }> = [
  {
    label: 'edit_method',
    args: { ...cls, action: 'edit_method', method: 'pub', source: "METHOD pub.\n    DATA(value) = 'new'.\nENDMETHOD." },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'edit_class_definition include=implementations',
    args: {
      ...cls,
      action: 'edit_class_definition',
      include: 'implementations',
      source: '* local implementations v2',
    },
    url: `${classPath}/includes/implementations`,
    current: '* local implementations\n',
  },
  {
    label: 'add_method',
    args: { ...cls, action: 'add_method', method: 'METHODS extra.', visibility: 'private' },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'edit_method_signature',
    args: { ...cls, action: 'edit_method_signature', method: 'pub', source: 'METHODS pub IMPORTING input TYPE i.' },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'change_method_visibility',
    args: { ...cls, action: 'change_method_visibility', method: 'priv', visibility: 'public' },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'delete_method',
    args: { ...cls, action: 'delete_method', method: 'priv' },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'edit_class_definition',
    args: {
      ...cls,
      action: 'edit_class_definition',
      source:
        'CLASS zdry DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS pub.\n    "! changed\n  PRIVATE SECTION.\n    METHODS priv.\nENDCLASS.',
    },
    url: `${classPath}/source/main`,
    current: classSource,
  },
  {
    label: 'edit_unit',
    args: { ...prog, action: 'edit_unit', unit: 'target', source: "FORM target.\n  WRITE 'new'.\nENDFORM." },
    url: `${progPath}/source/main`,
    current: progSource,
  },
  {
    label: 'add_unit',
    args: { ...prog, action: 'add_unit', unit: 'extra', source: "FORM extra.\n  WRITE 'x'.\nENDFORM." },
    url: `${progPath}/source/main`,
    current: progSource,
  },
  {
    label: 'edit_content',
    args: {
      ...prog,
      action: 'edit_content',
      oldContent: "WRITE 'old'.",
      newContent: "WRITE 'new'.",
      expectedSourceHash: sourceHash(progSource),
    },
    url: `${progPath}/source/main`,
    current: progSource,
  },
  {
    label: 'update',
    args: { ...prog, action: 'update', source: "REPORT zdryp.\nFORM target.\n  WRITE 'replaced'.\nENDFORM.\n" },
    url: `${progPath}/source/main`,
    current: progSource,
  },
  {
    label: 'update include=implementations',
    args: { ...cls, action: 'update', include: 'implementations', source: '* local implementations v3\n' },
    url: `${classPath}/includes/implementations`,
    current: '* local implementations\n',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

describe('SAPWrite dryRun on source edits', () => {
  it.each(actions)('$label previews without lock, write or activation', async ({ args, url, current }) => {
    const state = backend();
    const result = await call({ ...args, dryRun: true });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/^Dry run for .* — nothing was written\./);
    expect(mutations(state)).toEqual([]);
    expect(state.sources.get(url)).toBe(current);
    const summary = summaryOf(result);
    expect(summary).toMatchObject({ changed: true, sourceHash: sourceHash(current) });
    expect(Number(summary.linesAdded) + Number(summary.linesRemoved)).toBeGreaterThan(0);
    const reads = state.sends.filter((s) => s.method === 'GET' && s.url.pathname === url);
    expect(reads.length).toBeGreaterThan(0);
  });

  it.each(actions)('$label writes exactly the previewed diff with the preview hash', async ({ args, url, current }) => {
    const state = backend();
    const preview = await call({ ...args, dryRun: true });
    const { sourceHash: hash, resultHash } = summaryOf(preview);
    const write = await call({ ...args, expectedSourceHash: hash, expectedResultHash: resultHash });
    expect(write.isError, text(write)).toBeUndefined();
    expect(sourceHash(state.sources.get(url)!)).toBe(resultHash);
    const written = state.sources.get(url)!;
    expect(written).not.toBe(current);
    const target = text(preview).match(/^Dry run for (.*?) — /)![1];
    // SAP drops the final line break on save; the preview settles it on both sides.
    const settle = (t: string) => (t.endsWith('\n') ? t : `${t}\n`);
    const replay = unifiedDiff(settle(current), settle(written), `${target} (current)`, `${target} (proposed)`).diff;
    expect(text(preview)).toContain(replay);
    expect(state.locked).toBe(false);
  });

  it.each(actions)('$label refuses a divergent expectedSourceHash before any lock', async ({ args }) => {
    const state = backend();
    const result = await call({ ...args, dryRun: true, expectedSourceHash: 'a'.repeat(64) });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Source changed, or expectedSourceHash came from a different object/include');
    expect(mutations(state)).toEqual([]);
  });

  it('accepts a string "true" from loose clients as a preview', async () => {
    const state = backend();
    const result = await call({ ...actions[0]!.args, dryRun: 'true' });
    expect(text(result)).toMatch(/^Dry run for CLAS ZDRY/);
    expect(mutations(state)).toEqual([]);
  });

  it('refuses the write when the source changed after the preview', async () => {
    const state = backend();
    const args = actions[0]!.args;
    const { sourceHash: hash } = summaryOf(await call({ ...args, dryRun: true }));
    state.sources.set(`${classPath}/source/main`, classSource.replace("'priv'", "'manual'"));
    const write = await call({ ...args, expectedSourceHash: hash });
    expect(write.isError).toBe(true);
    expect(text(write)).toContain('No write was made');
    expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
    expect(state.locked).toBe(false);
  });

  it.each([
    [{ ...cls, action: 'add_method', method: 'METHODS pub.' }, 'already exists'],
    [{ ...cls, action: 'delete_method', method: 'missing' }, 'not found in CLAS ZDRY'],
    [{ ...cls, action: 'change_method_visibility', method: 'pub', visibility: 'protected' }, 'No PROTECTED SECTION'],
    [
      {
        ...cls,
        action: 'edit_class_definition',
        source:
          'CLASS zdry DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS pub.\n    METHODS fresh.\n  PRIVATE SECTION.\n    METHODS priv.\nENDCLASS.',
      },
      'Cannot apply edit_class_definition',
    ],
    [{ ...cls, action: 'edit_method', method: 'missing', source: 'METHOD missing.\nENDMETHOD.' }, 'missing'],
    [{ ...prog, action: 'edit_unit', unit: 'missing', source: 'FORM missing.\nENDFORM.' }, 'missing'],
    [
      {
        ...prog,
        action: 'edit_content',
        oldContent: 'nope',
        newContent: 'x',
        expectedSourceHash: sourceHash(progSource),
      },
      'oldContent was not found',
    ],
  ])('returns the surgery refusal in the preview (%#)', async (args, message) => {
    const state = backend();
    const result = await call({ ...args, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
    expect(mutations(state)).toEqual([]);
  });

  it('returns the no-op answer for a visibility already in place', async () => {
    const state = backend();
    const result = await call({
      ...cls,
      action: 'change_method_visibility',
      method: 'pub',
      visibility: 'public',
      dryRun: true,
    });
    expect(text(result)).toContain('No change made');
    expect(summaryOf(result)).toMatchObject({ changed: false, linesAdded: 0, sourceHash: sourceHash(classSource) });
    expect(mutations(state)).toEqual([]);
  });

  it('applies the same hashes to a no-op write as to its preview', async () => {
    const state = backend();
    const noop = { ...cls, action: 'change_method_visibility', method: 'pub', visibility: 'public' };
    const { sourceHash: hash, resultHash } = summaryOf(await call({ ...noop, dryRun: true }));
    const wrong = { expectedSourceHash: hash, expectedResultHash: 'b'.repeat(64) };
    expect((await call({ ...noop, ...wrong, dryRun: true })).isError).toBe(true);
    const refused = await call({ ...noop, ...wrong });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('differs from the approved dry run');
    const approved = await call({ ...noop, expectedSourceHash: hash, expectedResultHash: resultHash });
    expect(approved.isError, text(approved)).toBeUndefined();
    expect(text(approved)).toContain('No change made');
    expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
    expect(state.locked).toBe(false);
  });

  it('returns blocking lint results without writing', async () => {
    const state = backend();
    const result = await call({
      ...prog,
      action: 'edit_unit',
      unit: 'target',
      source: 'FORM target.\n  not_an_abap_statement.\nENDFORM.',
      dryRun: true,
      lintBeforeWrite: true,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain('Dry run for');
    expect(mutations(state)).toEqual([]);
  });

  it('runs the optional syntax check on the proposed source without a lock and words it for a preview', async () => {
    const checkrun =
      '<?xml version="1.0" encoding="utf-8"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="processed"><chkrun:checkMessageList><chkrun:checkMessage chkrun:uri="/sap/bc/adt/programs/programs/zdryp/source/main#start=3,2" chkrun:type="E" chkrun:shortText="Field NEW is unknown"/></chkrun:checkMessageList></chkrun:checkReport></chkrun:checkRunReports>';
    const state = backend({ checkrun });
    const result = await call({ ...actions[7]!.args, dryRun: true, checkBeforeWrite: true });
    expect(result.isError, text(result)).toBeUndefined();
    const checks = mutations(state);
    expect(checks.map((s) => s.url.pathname)).toEqual(['/sap/bc/adt/checkruns']);
    expect(checks[0]!.locked).toBe(false);
    const sent = Buffer.from(checks[0]!.body!.match(/<chkrun:content>([^<]+)</)![1]!, 'base64').toString('utf8');
    expect(sent).toContain("WRITE 'new'.");
    expect(text(result)).toContain('Server syntax check errors (a write would still proceed');
    expect(text(result)).toContain('Field NEW is unknown');
    expect(text(result)).not.toContain('source was still written');
  });

  const notProcessed =
    '<?xml version="1.0" encoding="utf-8"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="notProcessed" chkrun:statusText="Resource does not exist"/></chkrun:checkRunReports>';
  it.each([true, false])('reports a requested check that SAP did not process (dryRun=%s)', async (dryRun) => {
    backend({ checkrun: notProcessed });
    const result = await call({ ...actions[7]!.args, dryRun, checkBeforeWrite: true });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain(
      'Server syntax check not confirmed (checkBeforeWrite=true): SAP returned no processed check report',
    );
  });

  it('stays silent about an unprocessed check enabled only by server configuration', async () => {
    const state = backend({ checkrun: notProcessed });
    const result = await handleToolCall(createClient(), { ...config, checkBeforeWrite: true }, 'SAPWrite', {
      lintBeforeWrite: false,
      ...actions[7]!.args,
      dryRun: true,
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toMatch(/^Dry run for PROG ZDRYP/);
    expect(mutations(state).map((s) => s.url.pathname)).toEqual(['/sap/bc/adt/checkruns']);
    expect(text(result)).not.toContain('Server syntax check');
  });

  it.each([false, true])('reports a failed requested check, minimal errors=%s', async (minimalErrors) => {
    backend();
    const result = await handleToolCall(createClient(), { ...config, minimalErrors }, 'SAPWrite', {
      lintBeforeWrite: false,
      ...actions[7]!.args,
      dryRun: true,
      checkBeforeWrite: true,
    });
    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain('Server syntax check not confirmed (checkBeforeWrite=true)');
    expect(text(result)).toContain('ARC-1 cannot confirm that SAP checked this source');
    // The mock answers 404 "Unexpected POST /sap/bc/adt/checkruns"; minimal mode withholds that text.
    if (minimalErrors) {
      expect(text(result)).toContain('SAP request failed (status 404)');
      expect(text(result)).not.toContain('/sap/bc/adt/checkruns');
    }
  });

  it('does not report a CRLF-only difference as a change', async () => {
    const crlf = progSource.replace(/\n/g, '\r\n');
    const state = backend({ prog: crlf });
    const unchanged = await call({ ...prog, action: 'update', source: progSource, dryRun: true });
    expect(summaryOf(unchanged)).toMatchObject({
      changed: false,
      linesAdded: 0,
      linesRemoved: 0,
      sourceHash: sourceHash(crlf),
    });
    const edited = await call({ ...actions[7]!.args, dryRun: true });
    expect(summaryOf(edited)).toMatchObject({ changed: true, linesAdded: 1, linesRemoved: 1 });
    expect(mutations(state)).toEqual([]);
  });

  it('does not show the final line break SAP drops on save as a change', async () => {
    const stored = progSource.replace(/\n$/, '');
    const state = backend({ prog: stored });
    const result = await call({
      ...prog,
      action: 'add_unit',
      unit: 'extra',
      source: 'FORM extra.\nENDFORM.',
      dryRun: true,
    });
    expect(summaryOf(result)).toMatchObject({ changed: true, linesAdded: 2, linesRemoved: 0 });
    expect(text(result)).not.toContain('No newline at end of file');
    const unchanged = await call({ ...prog, action: 'update', source: `${stored}\n`, dryRun: true });
    expect(summaryOf(unchanged)).toMatchObject({ changed: false });
    expect(mutations(state)).toEqual([]);
  });

  it.each([1, 11])('refuses to approve the creation of a missing class include (%#)', async (index) => {
    const state = backend({ missingInclude: true });
    const result = await call({ ...actions[index]!.args, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('A dry run cannot approve its creation');
    expect(text(result)).not.toContain('sourceHash');
    expect(mutations(state)).toEqual([]);
  });

  it.each(actions)('$label refuses a write whose rebuilt result differs from the preview', async ({ args, url }) => {
    const state = backend();
    const { sourceHash: hash } = summaryOf(await call({ ...args, dryRun: true }));
    const before = state.sources.get(url);
    const write = await call({ ...args, expectedSourceHash: hash, expectedResultHash: 'b'.repeat(64) });
    expect(write.isError).toBe(true);
    expect(text(write)).toContain('differs from the approved dry run');
    expect(state.sends.some((s) => s.method === 'PUT')).toBe(false);
    expect(state.sources.get(url)).toBe(before);
    expect(state.locked).toBe(false);
    // The comparison runs under the lock, after the fresh read, immediately before the PUT would.
    const lockIndex = state.sends.findIndex((s) => s.url.searchParams.get('_action') === 'LOCK');
    const sequence = state.sends
      .slice(lockIndex)
      .filter((s) => s.url.searchParams.get('_action') || s.url.pathname === url)
      .map((s) => s.url.searchParams.get('_action') ?? s.method);
    expect(sequence).toEqual(['LOCK', 'GET', 'UNLOCK']);
  });

  it('requires expectedSourceHash with expectedResultHash', async () => {
    backend();
    const result = await call({ ...actions[0]!.args, expectedResultHash: 'b'.repeat(64) });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('expectedResultHash requires expectedSourceHash');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a class preview whose source changed while its structure was read', async () => {
    let reads = 0;
    const state = backend({
      afterRead: (path, s) => {
        if (path === `${classPath}/source/main` && ++reads === 1)
          s.sources.set(path, classSource.replace("'priv'", "'concurrent'"));
      },
    });
    const result = await call({ ...actions[3]!.args, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('changed during the dry run');
    expect(mutations(state)).toEqual([]);
  });

  it.each([
    ['SAPRead.INCL', 'INCL', { ...actions[7]!.args, type: 'INCL', name: 'ZDRYI' }],
    ['SAPRead', 'CLAS', actions[0]!.args],
  ])('refuses the preview when SAP_DENY_ACTIONS has %s', async (pattern, type, args) => {
    const state = backend();
    const client = createClient();
    const denied = client.withSafety({ ...client.safety, denyActions: [pattern] });
    const result = await call({ ...args, dryRun: true }, denied);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`SAPRead(type="${type}"), which SAP_DENY_ACTIONS denies`);
    expect(state.sends.some((s) => s.url.pathname.includes('/source/') || s.url.pathname.includes('/includes/'))).toBe(
      false,
    );
  });

  it('hashes an L* include without group exactly like SAPRead(format="editable")', async () => {
    const path = '/sap/bc/adt/functions/groups/zarc1/includes/lzarc1f01';
    const state = backend();
    state.sources.set(`${path}/source/main`, progSource);
    const client = createClient();
    const match = { objectName: 'LZARC1F01', objectType: 'FUGR/I', uri: path, packageName: '$TMP', description: '' };
    vi.spyOn(client, 'lookupObjects').mockResolvedValue([{ name: 'LZARC1F01', found: true, matches: [match] }]);
    const read = await handleToolCall(client, config, 'SAPRead', {
      type: 'INCL',
      name: 'LZARC1F01',
      format: 'editable',
    });
    expect(read.isError, text(read)).toBeUndefined();
    const preview = await call({ ...actions[7]!.args, type: 'INCL', name: 'LZARC1F01', dryRun: true }, client);
    expect(preview.isError, text(preview)).toBeUndefined();
    expect(summaryOf(preview).sourceHash).toBe(JSON.parse(text(read)).sourceHash);
    expect(summaryOf(preview).sourceHash).toBe(sourceHash(progSource));
  });

  it('marks an oversized diff as incomplete instead of offering approval', async () => {
    const big = `REPORT zdryp.\nFORM target.\n  WRITE 'old'.\nENDFORM.\n`;
    backend({ prog: big });
    const lines = Array.from({ length: 1200 }, (_, i) => `  WRITE ${i}.`).join('\n');
    const result = await call({ ...prog, action: 'update', source: `REPORT zdryp.\n${lines}\n`, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('The preview is incomplete');
    expect(text(result)).not.toContain('resultHash');
  });

  it('marks a source over the preview size limit as incomplete', async () => {
    backend();
    const huge = `REPORT zdryp.\n${'* x\n'.repeat(300_000)}`;
    const result = await call({ ...prog, action: 'update', source: huge, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('1-MiB preview limit');
  });

  it('reads outside the package allowlist like SAPRead; the write still enforces it', async () => {
    const state = backend({ packageName: 'ZFORBIDDEN' });
    const client = createClient();
    const restricted = client.withSafety({ ...client.safety, allowedPackages: ['$TMP'] });
    const preview = await call({ ...actions[0]!.args, dryRun: true }, restricted);
    expect(preview.isError, text(preview)).toBeUndefined();
    const write = await call(actions[0]!.args, restricted);
    expect(write.isError).toBe(true);
    expect(mutations(state)).toEqual([]);
  });

  it.each([
    { action: 'create', type: 'PROG', name: 'ZNEW', source: 'REPORT znew.', package: '$TMP' },
    { action: 'delete', type: 'PROG', name: 'ZDRYP' },
    { action: 'update', type: 'DOMA', name: 'ZDOMA', dataType: 'CHAR', length: 10 },
    { action: 'scaffold_rap_handlers', type: 'CLAS', name: 'ZDRY', bdefName: 'ZI_X', autoApply: true },
  ])('refuses dryRun on $action $type instead of writing', async (args) => {
    backend();
    const result = await call({ ...args, dryRun: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('No write was made; omit dryRun');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
