import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runAtcCheck } from '../../../src/adt/atc.js';
import { type AtcBatchObject, runAtcBatch } from '../../../src/adt/atc-batch.js';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { logger } from '../../../src/server/logger.js';

const a: AtcBatchObject = { type: 'CLAS', name: 'ZCL_A', uri: '/sap/bc/adt/oo/classes/ZCL_A' };
const b: AtcBatchObject = { type: 'CLAS', name: 'ZCL_B', uri: '/sap/bc/adt/oo/classes/ZCL_B' };
const finding =
  '<finding priority="2" checkTitle="Syntax" messageTitle="Check include" location="/sap/bc/adt/oo/classes/zcl_a/includes/implementations#start=4,1"/>';
function row(object = a, findings = '') {
  return `<object type="${object.type}" name="${object.name}" uri="/sap/bc/adt/atc/objects/R3TR/${object.type}/${encodeURIComponent(object.name)}"><findings>${findings}</findings></object>`;
}

function fixture(
  rows: string[],
  options: {
    legacy?: boolean;
    status?: string | string[];
    unknownVariant?: boolean;
    unverified?: boolean;
    failSecond?: boolean;
    afterRead?: () => void;
    rootFinding?: string;
    secondError?: () => Error;
  } = {},
) {
  let run = 0;
  let clock = 0;
  const calls: { method: string; path: string; body?: string; options?: AdtRequestOptions }[] = [];
  const http = {
    get: vi.fn(async (path: string, _headers: unknown, requestOptions?: AdtRequestOptions) => {
      calls.push({ method: 'GET', path, options: requestOptions });
      if (path.includes('/variants?')) {
        if (options.unverified) throw new AdtApiError('Unavailable', 503, path);
        return { body: '<namedItems><namedItem name="DEFAULT"/></namedItems>' };
      }
      if (path.includes('/customizing'))
        return {
          body: options.unknownVariant
            ? '<customizing/>'
            : '<customizing><properties><property name="systemCheckVariant" value="DEFAULT"/></properties></customizing>',
        };
      if (path.includes('/runs/'))
        return {
          body: `<run status="${(Array.isArray(options.status) ? options.status[run - 1] : options.status) ?? 'Completed'}"/>`,
        };
      options.afterRead?.();
      return {
        body: `<worklist id="WL${run}" objectSetIsComplete="true"><objects>${rows[run - 1] ?? ''}</objects>${options.rootFinding ?? ''}</worklist>`,
      };
    }),
    post: vi.fn(
      async (path: string, body: string, _type: string, _headers: unknown, requestOptions?: AdtRequestOptions) => {
        calls.push({ method: 'POST', path, body, options: requestOptions });
        if (path.includes('/worklists')) {
          if (options.secondError && run === 1) throw options.secondError();
          if (options.failSecond && run === 1) throw new AdtApiError('Sensitive backend details', 403, path);
          return { body: `WL${++run}` };
        }
        return {
          statusCode: options.legacy ? 200 : 201,
          body: '',
          headers: options.legacy ? {} : { location: `/sap/bc/adt/atc/runs/R${run}` },
        };
      },
    ),
  } as unknown as AdtHttpClient;
  const poll = {
    timeoutMs: 30_000,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
  return {
    http,
    calls,
    poll,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('native ATC batches', () => {
  it.each([
    ['FUGR', 'FUGR/FF', 'FUNC', 5],
    ['PROG', 'PROG/I', 'INCL', 4],
    ['CLAS', 'UNKNOWN_CHILD', 'UNKNOWN_CHILD', 2],
  ] as const)(
    'retains possible %s child findings without claiming a clean container',
    async (type, childType, canonicalType, count) => {
      const parent = { type, name: 'ZPARENT', uri: `/sap/bc/adt/atc/objects/R3TR/${type}/ZPARENT` };
      const child = [1, count - 1]
        .map((size, index) => {
          const name = `ZCHILD${index}`;
          const path = type === 'FUGR' ? `functions/groups/zparent/fmodules/${name}` : `programs/programs/${name}`;
          return `<object type="${childType}" name="${name}" uri="/sap/bc/adt/${path}"><findings>${finding.replace('priority="2"', 'priority="1"').repeat(size)}</findings></object>`;
        })
        .join('');
      const { http, poll, calls } = fixture([row(parent) + child]);
      const result = await runAtcBatch(http, defaultSafetyConfig(), [parent], undefined, poll);
      expect(result).toMatchObject({ complete: false, findingCount: count, verificationAttempted: false });
      expect(result.coverage[0]).toMatchObject({ status: 'reported', findingCount: null });
      expect(result.findings.every((entry) => entry.priority === 1 && entry.object?.type === canonicalType)).toBe(true);
      expect(result.runs[0]?.excludedFindingCount).toBe(0);
      expect(result.incompleteReasons.join(' ')).toContain('unassigned');
      expect(calls.filter((call) => call.path.includes('/runs?'))).toHaveLength(1);
    },
  );

  it('retains unassigned child findings from verification without counting them as unrelated roots', async () => {
    const child = row({ ...a, name: 'Z_INCLUDE' }, finding).replace('type="CLAS"', 'type="PROG/I"');
    const { http, poll } = fixture([row(a), row(b) + child]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 1, verificationAttempted: true });
    expect(result.findings[0]).toMatchObject({ object: { type: 'INCL', name: 'Z_INCLUDE' }, worklistId: 'WL2' });
    expect(result.coverage.map((entry) => entry.findingCount)).toEqual([0, null]);
  });

  it('keeps counts unknown when an unassigned child record has no findings', async () => {
    const child = row({ ...a, name: 'Z_INCLUDE' }).replace('type="CLAS"', 'type="PROG/I"');
    const { http, poll } = fixture([row(a) + child]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 0, verificationAttempted: false });
    expect(result.coverage[0]?.findingCount).toBeNull();
  });

  it.each(['tables', 'structures'])('recognizes TABL %s source/main without a metadata request', async (collection) => {
    const table: AtcBatchObject = { type: 'TABL', name: 'ZTABLE', uri: '/sap/bc/adt/atc/objects/R3TR/TABL/ZTABLE' };
    const xml = row(table, finding).replace(table.uri, `/sap/bc/adt/ddic/${collection}/ztable/source/main`);
    const { http, poll, calls } = fixture([xml]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [table], undefined, poll);
    expect(result).toMatchObject({ complete: true, findingCount: 1, verificationAttempted: false });
    expect(result.coverage[0]?.findingCount).toBe(1);
    expect(calls.every((call) => call.path.startsWith('/sap/bc/adt/atc/'))).toBe(true);
  });

  it.each(['DOMA', 'DTEL', 'SRVB'] as const)('rejects a fabricated source/main on metadata-only %s', async (type) => {
    const root = { DOMA: 'ddic/domains', DTEL: 'ddic/dataelements', SRVB: 'businessservices/bindings' }[type];
    const object = { type, name: 'ZOBJECT', uri: `/sap/bc/adt/${root}/ZOBJECT` };
    const xml = row(object).replace(`/atc/objects/R3TR/${type}/ZOBJECT`, `/${root}/zobject/source/main`);
    const { http, poll } = fixture([xml]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.coverage[0]?.findingCount).toBeNull();
  });

  it.each(['businessservices/bindings/zservice', 'atc/objects/R3TR/SRVB/ZSERVICE'])(
    'recognizes a service-binding root: %s',
    async (path) => {
      const object: AtcBatchObject = {
        type: 'SRVB',
        name: 'ZSERVICE',
        uri: '/sap/bc/adt/businessservices/bindings/ZSERVICE',
      };
      const xml = row(object).replace('/atc/objects/R3TR/SRVB/ZSERVICE', `/${path}`);
      const { http, poll } = fixture([xml]);
      expect(await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll)).toMatchObject({
        complete: true,
        findingCount: 0,
      });
    },
  );

  it.each([
    ['ZCL_MASSE', 'zcl_maße'],
    ['ZCL_FILE', 'zcl_ﬁle'],
    ['ZCL_I', 'zcl_ı'],
  ])('does not match requested %s to a Unicode SAP-reported name %s', async (name, reportedName) => {
    const object = { ...a, name, uri: `/sap/bc/adt/oo/classes/${name}` };
    const xml = row(object).replace(`name="${name}"`, `name="${reportedName}"`);
    const { http, poll } = fixture([xml], { unknownVariant: true });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.coverage[0]).toMatchObject({ status: 'notReported', findingCount: null });
  });

  it('retains good findings when another selected row has contradictory URI evidence', async () => {
    const xml = row(a, finding) + row(b, finding).replace('/R3TR/CLAS/ZCL_B', '/R3TR/CLAS/ZCL_OTHER');
    const { http, poll } = fixture([xml]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 2, verificationAttempted: false });
    expect(result.coverage.map((entry) => entry.findingCount)).toEqual([null, null]);
    expect(result.findings[0]).toMatchObject({ object: { type: 'CLAS', name: 'ZCL_A' } });
  });

  it('counts only the objects selected for each run, including overlapping verification responses', async () => {
    const { http, poll } = fixture([row(a, finding), row(a, finding) + row(b)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: true, findingCount: 1, reportedObjectCount: 2 });
    expect(result.coverage.reduce((sum, object) => sum + object.findingCount!, 0)).toBe(result.findingCount);
    expect(result.runs[1]).toMatchObject({ findingCount: 1, excludedFindingCount: 1 });
    expect(result.findings[0]!.object).toEqual({ type: 'CLAS', name: 'ZCL_A' });
  });

  it('excludes findings for an unrelated object from the explicit selection totals', async () => {
    const { http, poll } = fixture([row(a, finding) + row(b, finding.repeat(5))]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
    expect(result).toMatchObject({ complete: true, findingCount: 1, reportedObjectCount: 1 });
    expect(result.runs[0]).toMatchObject({ findingCount: 6, excludedFindingCount: 5 });
  });

  it('does not retry contradictory URI evidence or duplicate its findings', async () => {
    const bad = row(a, finding).replace('/R3TR/CLAS/ZCL_A', '/R3TR/CLAS/ZCL_OTHER');
    const { http, poll } = fixture([bad, bad]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false, findingCount: 1 });
    expect(result.coverage[0]).toMatchObject({ status: 'notReported', findingCount: null });
  });

  it('recognizes the exact source/main subresource of the selected source object', async () => {
    const object: AtcBatchObject = { type: 'DDLS', name: 'ZI_ORDER', uri: '/sap/bc/adt/ddic/ddl/sources/ZI_ORDER' };
    const xml = row(object, finding).replace(
      '/atc/objects/R3TR/DDLS/ZI_ORDER',
      '/ddic/ddl/sources/zi_order/source/main',
    );
    const { http, poll } = fixture([xml]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll);
    expect(result).toMatchObject({ complete: true, findingCount: 1, verificationAttempted: false });
  });

  it.each([
    ['TABL', 'TABL/DT', 'tables'],
    ['TABL', 'TABL/DS', 'structures'],
    ['DTEL', 'DTEL/DE', 'dataelements'],
    ['DOMA', 'DOMA/DD', 'domains'],
  ])('recognizes %s metadata echo %s without a lookup', async (type, reportedType, collection) => {
    const object = { type, name: 'ZDICT', uri: `/sap/bc/adt/atc/objects/R3TR/${type}/ZDICT` } as AtcBatchObject;
    const xml = row(object)
      .replace(`type="${type}"`, `type="${reportedType}"`)
      .replace(object.uri, `/sap/bc/adt/ddic/${collection}/zdict`);
    const { http, poll } = fixture([xml]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll);
    expect(result).toMatchObject({ complete: true, verificationAttempted: false, findingCount: 0 });
  });

  it('does not collapse a function module into its same-named function group', async () => {
    const group: AtcBatchObject = { type: 'FUGR', name: 'ZFG', uri: '/sap/bc/adt/functions/groups/ZFG' };
    const groupRow = row(group).replace('type="FUGR"', 'type="FUGR/F"');
    const moduleRow =
      '<object type="FUGR/FF" name="ZFG" uri="/sap/bc/adt/functions/groups/zfg/fmodules/zfg"><findings>' +
      finding +
      '</findings></object>';
    const { http, poll } = fixture([groupRow + moduleRow]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [group], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 1, reportedObjectCount: 1 });
    expect(result.coverage[0]?.findingCount).toBeNull();
    expect(result.findings[0]?.object?.type).toBe('FUNC');
    expect(result.runs[0]).toMatchObject({ excludedFindingCount: 0 });
  });

  it('skips a legacy verification when less than the minimum settlement time remains', async () => {
    const { http, poll, calls } = fixture([row(a), row(b)], { legacy: true });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, { ...poll, timeoutMs: 18_000 });
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.coverage[0]?.findingCount).toBe(0);
    expect(result.incompleteReasons.join(' ')).toContain('settlement');
    expect(calls.filter((call) => call.path.includes('/runs?'))).toHaveLength(1);
  });

  it.each(['caller', 'network'])('propagates independent %s cancellation during verification', async (kind) => {
    const controller = new AbortController();
    const error =
      kind === 'network'
        ? new AdtNetworkError('Aborted', new DOMException('Aborted', 'AbortError'))
        : new AdtApiError('Failed after caller cancelled', 503, '/sap/bc/adt/atc/worklists');
    const { http, poll } = fixture([row(a)], {
      secondError: () => {
        if (kind === 'caller') controller.abort();
        return error;
      },
    });
    await expect(
      runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, { ...poll, signal: controller.signal }),
    ).rejects.toBe(error);
  });

  it('softens an ordinary network failure during verification without exposing its cause', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { http, poll } = fixture([row(a, finding)], {
        secondError: () => new AdtNetworkError('Sensitive network details', new Error('Sensitive cause')),
      });
      const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
      expect(result).toMatchObject({ complete: false, findingCount: 1, verificationAttempted: true });
      expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errorClass: 'AdtNetworkError' }));
      expect(JSON.stringify([result, warn.mock.calls])).not.toContain('Sensitive');
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    new TypeError('Unexpected code defect'),
    new AdtSafetyError('Denied'),
    new AdtResponseLimitError(100, 101, 'test'),
  ])('propagates non-recoverable verification errors: %s', async (error) => {
    const { http, poll } = fixture([row(a)], { secondError: () => error });
    await expect(runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll)).rejects.toBe(error);
  });

  it('logs a safe verification failure and preserves initial findings', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { http, poll } = fixture([row(a, finding)], { failSecond: true });
      const result = await requestContext.run({ requestId: 'ATC-REVIEW' }, () =>
        runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll),
      );
      expect(result).toMatchObject({ complete: false, findingCount: 1 });
      expect(warn).toHaveBeenCalledWith(
        'ATC verification failed; initial findings retained.',
        expect.objectContaining({
          errorClass: 'AdtApiError',
          statusCode: 403,
          worklistId: 'WL1',
          requestId: 'ATC-REVIEW',
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('Sensitive backend details');
    } finally {
      warn.mockRestore();
    }
  });

  it('classifies invalid direct arguments locally, without a fabricated SAP status', async () => {
    const { http, poll } = fixture([]);
    await expect(runAtcBatch(http, defaultSafetyConfig(), [], undefined, poll)).rejects.not.toBeInstanceOf(AdtApiError);
  });

  it('deduplicates selections, preserves enclosing object identity and requires clean-object records', async () => {
    const { http, calls, poll } = fixture([row(a, finding) + row(b)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b, a], undefined, poll);
    expect(result).toMatchObject({
      complete: true,
      requestedObjectCount: 3,
      uniqueObjectCount: 2,
      reportedObjectCount: 2,
      findingCount: 1,
      verificationAttempted: false,
      incompleteReasons: [],
    });
    expect(result.coverage.map((object) => object.findingCount)).toEqual([1, 0]);
    expect(result.findings[0]).toMatchObject({ object: { type: 'CLAS', name: 'ZCL_A' }, worklistId: 'WL1', line: 4 });
    const posts = calls.filter((call) => call.path.includes('/runs?'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body?.match(/<adtcore:objectReference /g)).toHaveLength(2);
    expect(calls.every((call) => call.options?.deadline === 30_000)).toBe(true);
    expect(result.runs[0]).not.toHaveProperty('findings');
  });

  it('rechecks only missing objects once under the original deadline and variant', async () => {
    const { http, calls, poll, advance } = fixture([row(a, finding), row(b)], { afterRead: () => advance(4_000) });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({
      complete: true,
      findingCount: 1,
      verificationAttempted: true,
      reportedObjectCount: 2,
    });
    expect(result.coverage.map((object) => object.worklistId)).toEqual(['WL1', 'WL2']);
    expect(result.runs).toHaveLength(2);
    expect(calls.filter((call) => call.path.includes('/customizing'))).toHaveLength(1);
    expect(
      calls.filter((call) => call.method === 'POST' && call.path.includes('/worklists')).map((call) => call.path),
    ).toEqual(Array(2).fill('/sap/bc/adt/atc/worklists?checkVariant=DEFAULT'));
    const second = calls.filter((call) => call.path.includes('/runs?'))[1]!;
    expect(second.body).toContain(b.uri);
    expect(second.body).not.toContain(a.uri);
    expect(calls.every((call) => call.options?.deadline === 30_000)).toBe(true);
  });

  it('stops after a verification run that still does not report the requested object', async () => {
    const { http, calls, poll } = fixture([row(a), row(a)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result.complete).toBe(false);
    expect(result.coverage[1]).toMatchObject({ status: 'notReported', findingCount: null, worklistId: null });
    expect(calls.filter((call) => call.path.includes('/runs?'))).toHaveLength(2);
  });

  it('keeps first-run findings if creating the verification worklist fails', async () => {
    const { http, poll } = fixture([row(a, finding)], { failSecond: true });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 1, verificationAttempted: true });
    expect(result.runs).toHaveLength(1);
    expect(result.incompleteReasons.join(' ')).toContain('initial findings are retained');
    expect(JSON.stringify(result)).not.toContain('Sensitive backend details');
  });

  it.each(['Failed', 'Running'])(
    'does not retry a %s initial run or claim its reported objects are clean',
    async (status) => {
      const { http, calls, poll } = fixture([row(a, finding)], { status });
      const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
      expect(result).toMatchObject({ complete: false, findingCount: 1, verificationAttempted: false });
      expect(result.coverage[0]).toMatchObject({ status: 'reported', findingCount: null });
      expect(calls.filter((call) => call.path.includes('/runs?'))).toHaveLength(1);
    },
  );

  it.each(['deadline', 'cancellation'])('skips verification after %s', async (condition) => {
    const controller = new AbortController();
    const { http, poll, advance } = fixture([row(a)], {
      afterRead: () => (condition === 'deadline' ? advance(30_000) : controller.abort()),
    });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, {
      ...poll,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.incompleteReasons.join(' ')).toContain('deadline expired');
  });

  it.each([false, true])('does not guess the variant for verification (requestedUnverified=%s)', async (unverified) => {
    const { http, poll } = fixture([row(a)], { unknownVariant: true, unverified });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], unverified ? 'DEFAULT' : undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.incompleteReasons.join(' ')).toContain('variant could not be confirmed');
  });

  it('retains the 750 full-worklist quiet interval for both runs', async () => {
    const { http, poll } = fixture([row(a), row(b)], { legacy: true });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result.complete).toBe(true);
    expect(poll.now()).toBeGreaterThanOrEqual(20_000);
    expect(result.runs.map((run) => run.completionEvidence)).toEqual([
      'legacyWorklistSettled',
      'legacyWorklistSettled',
    ]);
  });

  it('recognizes encoded namespace identities without using finding URIs for ownership', async () => {
    const namespaced = { ...a, name: '/ARC/CL_A', uri: '/sap/bc/adt/oo/classes/%2FARC%2FCL_A' };
    const { http, calls, poll } = fixture([row(namespaced, finding)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [namespaced], undefined, poll);
    expect(result.complete).toBe(true);
    expect(result.findings[0]?.object?.name).toBe('/ARC/CL_A');
    expect(calls.find((call) => call.path.includes('/runs?'))?.body).toContain('%2FARC%2FCL_A');
  });

  it.each(['%2fARC%2fCL_A', '/ARC/CL_A'])('recognizes namespace echo spelling %s', async (nameInUri) => {
    const object = { ...a, name: '/ARC/CL_A', uri: '/sap/bc/adt/oo/classes/%2FARC%2FCL_A' };
    const { http, poll } = fixture([row(object, finding).replace('%2FARC%2FCL_A', nameInUri)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [object], undefined, poll);
    expect(result).toMatchObject({ complete: true, findingCount: 1, verificationAttempted: false });
  });

  it.each(['/R3TR/PROG/ZCL_A', '/R3TR/CLAS/ZCL_A?version=inactive', '/R3TR/CLAS/ZCL_A/extra', '/R3TR/CLAS/../ZCL_A'])(
    'does not expand URI matching to another object/subresource: %s',
    async (suffix) => {
      const xml = row(a, finding).replace('/R3TR/CLAS/ZCL_A', suffix);
      const { http, poll } = fixture([xml]);
      const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
      expect(result).toMatchObject({ complete: false, verificationAttempted: false });
      expect(result.coverage[0]?.findingCount).toBeNull();
    },
  );

  it('retains observed findings but does not certify counts from a malformed worklist', async () => {
    const { http, poll } = fixture([row(a, finding) + row(b, '<finding messageTitle="Missing priority"/>')]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, findingCount: 2, verificationAttempted: false });
    expect(result.coverage.map((object) => object.findingCount)).toEqual([null, null]);
    expect(result.findings[0]).toMatchObject({ priority: 2, object: { type: 'CLAS', name: 'ZCL_A' } });
  });

  it.each([
    row(a).replace('name="ZCL_A"', 'name="ZCL_OTHER"'),
    row(a).replace('type="CLAS"', 'type="PROG"'),
    row(a).replace('/R3TR/CLAS/ZCL_A', '/R3TR/CLAS/ZCL_OTHER'),
    row(a).replace('uri="/sap', 'uri="https://evil.test/sap'),
  ])('rejects mismatched or unsafe returned identity: %s', async (xml) => {
    const { http, poll } = fixture([xml], { unknownVariant: true });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
    expect(result.coverage[0]).toMatchObject({ status: 'notReported', findingCount: null });
  });

  it('refuses duplicate object evidence instead of counting it as a clean result', async () => {
    const { http, poll } = fixture([row(a) + row(a)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
    expect(result.complete).toBe(false);
    expect(result.coverage[0]?.findingCount).toBeNull();
  });

  it.each(
    [
      [],
      Array(21).fill(a),
      [{ ...a, type: 'DEVC' }],
      [{ ...a, name: '../escape' }],
      [{ ...a, uri: 'https://evil.test/sap/bc/adt/classes/a' }],
    ].map((objects) => [objects]),
  )('rejects invalid direct selections before any SAP call', async (objects) => {
    const { http, calls, poll } = fixture([]);
    await expect(
      runAtcBatch(http, defaultSafetyConfig(), objects as AtcBatchObject[], undefined, poll),
    ).rejects.toThrow('Invalid ATC batch selection');
    expect(calls).toHaveLength(0);
  });

  it('keeps unowned findings but refuses complete coverage or a verification retry', async () => {
    const { http, poll } = fixture([row(a)], { rootFinding: finding });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false, findingCount: 1 });
    expect(result.incompleteReasons.join(' ')).toContain('no valid enclosing object');
  });

  it('does not retry an initial worklist with duplicate evidence', async () => {
    const { http, poll } = fixture([row(a) + row(a)]);
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: false });
  });

  it.each(['<finding/>', '<finding>invalid</finding>', 'invalid'])(
    'does not turn malformed findings into a clean batch: %s',
    async (malformed) => {
      const { http, poll } = fixture([row(a, malformed)]);
      const result = await runAtcBatch(http, defaultSafetyConfig(), [a], undefined, poll);
      expect(result).toMatchObject({ complete: false, verificationAttempted: false });
      expect(result.coverage[0]?.findingCount).toBeNull();
    },
  );

  it.each(['Failed', 'Running'])('retains both runs when verification is %s', async (status) => {
    const { http, poll } = fixture([row(a, finding), row(b, finding)], { status: ['Completed', status] });
    const result = await runAtcBatch(http, defaultSafetyConfig(), [a, b], undefined, poll);
    expect(result).toMatchObject({ complete: false, verificationAttempted: true, findingCount: 2 });
    expect(result.findings.map((f) => f.worklistId)).toEqual(['WL1', 'WL2']);
    expect(result.coverage.map((object) => object.findingCount)).toEqual([1, null]);
  });

  it('replays the live 20-class coverage gap and recovery without losing 150 findings', async () => {
    const capture = JSON.parse(
      readFileSync(new URL('../../fixtures/atc-batch-758-coverage.json', import.meta.url), 'utf8'),
    ) as {
      selection: { type: 'CLAS'; name: string }[];
      initial: { type: 'CLAS'; name: string; uri: string; findings: number }[];
      verification: { type: 'CLAS'; name: string; uri: string; findings: number }[];
    };
    const selections = capture.selection.map((object) => ({ ...object, uri: `/sap/bc/adt/oo/classes/${object.name}` }));
    const { http, poll } = fixture(
      [capture.initial, capture.verification].map((rows) =>
        rows.map((object) => row(object, finding.repeat(object.findings))).join(''),
      ),
    );
    const result = await runAtcBatch(http, defaultSafetyConfig(), selections, undefined, poll);
    expect(result).toMatchObject({
      complete: true,
      findingCount: 150,
      reportedObjectCount: 20,
      verificationAttempted: true,
    });
    expect(result.runs.map((run) => run.processedObjectCount)).toEqual([13, 7]);
    expect(result.coverage.filter((object) => object.findingCount === 0)).toHaveLength(7);
  });

  it('leaves the single-object result without batch metadata or enclosing identities', async () => {
    const { http, poll } = fixture([row(a, finding)]);
    const result = await runAtcCheck(http, defaultSafetyConfig(), a.uri, undefined, poll);
    expect(result.complete).toBe(true);
    expect(result).not.toHaveProperty('processedObjects');
    expect(result.findings[0]).not.toHaveProperty('object');
  });
});
