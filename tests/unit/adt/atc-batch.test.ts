import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runAtcCheck } from '../../../src/adt/atc.js';
import { type AtcBatchObject, runAtcBatch } from '../../../src/adt/atc-batch.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

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
