import { describe, expect, it, vi } from 'vitest';
import { parseNativeJunitSummary } from '../../../src/adt/aunit.js';
import { CI_FINDINGS_LIMIT, runAtcCiCheck, verifyCiPackages } from '../../../src/adt/ci-quality.js';
import {
  buildAtcCiRunParametersXml,
  parseAtcCheckstyle,
  parseAtcCiRunStatus,
} from '../../../src/adt/ci-quality-xml.js';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const safety = defaultSafetyConfig();
const runPath = '/sap/bc/adt/api/atc/runs/123';
const resultPath = '/sap/bc/adt/api/atc/results/123';
const report =
  '<checkstyle><file name="ZTEST"><error line="1" message="Failure" severity="warning" source="CHK"/></file></checkstyle>';
const completed = `<run status="Completed"><link href="${runPath}" rel="self"/><link href="${resultPath}" type="application/vnd.sap.atc.checkstyle.v1+xml"/></run>`;
function httpFor(options: { report?: string; status?: string; location?: string; missingPackage?: string } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path.includes('00000000000000000000000000000000')) return { body: '', headers: {} };
    if (path.startsWith('/sap/bc/adt/packages/')) {
      const name = decodeURIComponent(path.split('/').at(-1)!);
      if (name === options.missingPackage) throw new AdtApiError('Not found', 404, path);
      return { body: `<pak:package xmlns:pak="pak" xmlns:adtcore="adt" adtcore:name="${name}"/>`, headers: {} };
    }
    if (path.includes('informationsystem'))
      return {
        body: '<objectReferences><objectReference name="ZTEST" type="PROG/P" packageName="ZPKG" uri="/sap/bc/adt/programs/programs/ztest"/></objectReferences>',
        headers: {},
      };
    if (path === runPath) return { body: options.status ?? completed, headers: {} };
    if (path === resultPath) return { body: options.report ?? report, headers: {} };
    throw new Error(`Unexpected request ${path}`);
  });
  const post = vi.fn(async () => ({ headers: { location: options.location ?? runPath }, body: '' }));
  return { http: { get, post } as unknown as AdtHttpClient, get, post };
}
function options() {
  return { objectSet: { packages: ['ZPKG'] }, timeoutSeconds: 1 };
}

describe('CI XML fails closed', () => {
  it.each([
    '',
    '<html>login</html>',
    '<error>failure</error>',
    '<checkstyle>',
    '<!DOCTYPE checkstyle><checkstyle/>',
    '<checkstyle><unknown/></checkstyle>',
    '<checkstyle><file name="Z"><error/></file></checkstyle>',
  ])('rejects non-report or malformed Checkstyle: %s', (body) => {
    expect(() => parseAtcCheckstyle(body)).toThrow();
  });
  it('parses a valid empty report and explicit findings', () => {
    expect(parseAtcCheckstyle('<checkstyle/>').summary.findingCount).toBe(0);
    expect(parseAtcCheckstyle(report)).toMatchObject({
      summary: { findingCount: 1, warningCount: 1 },
      findings: [{ file: 'ZTEST', line: 1, severity: 'warning' }],
    });
  });
  it.each([
    '',
    '<html/>',
    '<testsuites/>',
    '<testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite><testcase><failure/></testcase></testsuite></testsuites>',
    '<testsuites tests="1" failures="0" errors="0" skipped="0"/>',
  ])('rejects invalid JUnit evidence: %s', (body) => {
    expect(() => parseNativeJunitSummary(body)).toThrow();
  });
  it('walks nested suites and rejects missing root counters', () => {
    const cases = '<testsuite><testsuite><testcase name="fails"><failure/></testcase></testsuite></testsuite>';
    expect(
      parseNativeJunitSummary(`<testsuites tests="1" failures="1" errors="0" skipped="0">${cases}</testsuites>`)
        .outcome,
    ).toBe('failed');
    expect(() => parseNativeJunitSummary(`<testsuites>${cases}</testsuites>`)).toThrow();
  });
  it('selects only the Checkstyle result link and preserves progress', () => {
    expect(parseAtcCiRunStatus(completed).resultHref).toBe(resultPath);
    expect(
      parseAtcCiRunStatus('<run status="Not Yet Started"><progress description="Job not yet started"/></run>'),
    ).toEqual({ status: 'Not Yet Started', progress: 'Job not yet started' });
  });
  it('normalizes the verified selection once and preserves XML escaping', async () => {
    const { http } = httpFor();
    expect(
      await verifyCiPackages(http, safety, { packages: ['zpkg', 'ZPKG', '$TMP'], packageTrees: ['zpkg'] }, {}),
    ).toEqual({
      packages: ['$TMP'],
      packageTrees: ['ZPKG'],
    });
    expect(buildAtcCiRunParametersXml({ packages: ['ZPKG'], packageTrees: [] }, { variant: 'A&B' })).toContain(
      'checkVariant="A&amp;B"',
    );
    expect(buildAtcCiRunParametersXml({ packages: [], packageTrees: ['ZPKG'] })).toContain('includeSubpackages="true"');
  });
});

describe('ATC CI orchestration', () => {
  it('starts exactly once, passes deadline and signal to every request and omits duplicate XML by default', async () => {
    const { http, get, post } = httpFor();
    const signal = new AbortController().signal;
    const result = await runAtcCiCheck(http, safety, { ...options(), signal, failOnSeverity: 'warning' });
    expect(result).toMatchObject({
      status: 'completed',
      fail: true,
      summary: { findingCount: 1 },
      runPath,
      resultPath,
    });
    expect(result).not.toHaveProperty('reportXml');
    expect(post).toHaveBeenCalledTimes(1);
    for (const call of get.mock.calls)
      expect((call as unknown[])[2]).toMatchObject({ signal, deadline: expect.any(Number) });
    expect((post.mock.calls[0] as unknown[])[4]).toMatchObject({ signal, deadline: expect.any(Number) });
  });
  it('allows empty Checkstyle only following verified nonempty selection', async () => {
    const { http, post } = httpFor({ report: '<checkstyle/>' });
    expect(await runAtcCiCheck(http, safety, options())).toMatchObject({ status: 'completed', fail: false });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('checks every package before starting a run, including a late missing package', async () => {
    const { http, post } = httpFor({ missingPackage: 'ZMISSING' });
    await expect(
      runAtcCiCheck(http, safety, { ...options(), objectSet: { packages: ['ZPKG', 'ZMISSING'] } }),
    ).rejects.toThrow('ZMISSING');
    expect(post).not.toHaveBeenCalled();
  });
  it('refuses an unverified or empty selection before POST', async () => {
    const { http, get, post } = httpFor();
    get.mockImplementation(async (path: string) => ({
      body: path.includes('/packages/') ? '<package name="ZPKG"/>' : '<objectReferences/>',
      headers: {},
    }));
    await expect(runAtcCiCheck(http, safety, options())).rejects.toThrow('empty or could not be verified');
    expect(post).not.toHaveBeenCalled();
  });
  it.each(['DEVC', 'DEVC/K', 'devc/k'])(
    'rejects a selection containing only %s package rows before POST',
    async (type) => {
      const { http, get, post } = httpFor();
      get.mockImplementation(async (path: string) => ({
        body: path.includes('/packages/')
          ? '<package name="ZPKG"/>'
          : `<objectReferences><objectReference name="ZCHILD" type="${type}" packageName="ZPKG" uri="/sap/bc/adt/packages/ZCHILD"/></objectReferences>`,
        headers: {},
      }));
      for (const objectSet of [{ packages: ['ZPKG'] }, { packageTrees: ['ZPKG'] }]) {
        await expect(runAtcCiCheck(http, safety, { ...options(), objectSet })).rejects.toThrow(
          'empty or could not be verified',
        );
        expect(post).not.toHaveBeenCalled();
      }
    },
  );
  it('requires an actual object in the exact package but permits a tree descendant', async () => {
    const { http, get, post } = httpFor();
    get.mockImplementation(async (path: string) => ({
      body: path.includes('/packages/')
        ? '<package name="ZPKG"/>'
        : '<objectReferences><objectReference name="ZCHILD" type="DEVC/K" packageName="ZPKG"/><objectReference name="ZPROGRAM" type="PROG/P" packageName="ZCHILD"/></objectReferences>',
      headers: {},
    }));
    await expect(verifyCiPackages(http, safety, { packages: ['ZPKG'] }, {}, true)).rejects.toThrow('empty');
    expect(await verifyCiPackages(http, safety, { packageTrees: ['ZPKG'] }, {}, true)).toMatchObject({
      packageTrees: ['ZPKG'],
    });
    expect(post).not.toHaveBeenCalled();
  });
  it.each([404, 405, 406, 415])('reports unavailable API for probe HTTP %s', async (status) => {
    const { http, get, post } = httpFor();
    get.mockRejectedValueOnce(new AdtApiError('missing', status, '/probe'));
    await expect(runAtcCiCheck(http, safety, options())).rejects.toThrow('API is not available');
    expect(post).not.toHaveBeenCalled();
  });
  it('propagates authorization failure from the probe', async () => {
    const { http, get } = httpFor();
    const error = new AdtApiError('forbidden', 403, '/probe');
    get.mockRejectedValueOnce(error);
    await expect(runAtcCiCheck(http, safety, options())).rejects.toBe(error);
  });
  it('returns incomplete with last status/progress at the one overall deadline', async () => {
    const { http, post } = httpFor({
      status: '<run status="Not Yet Started"><progress description="Job not yet started"/></run>',
    });
    let now = Date.now();
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    const result = await runAtcCiCheck(http, safety, { ...options(), clock });
    expect(result).toMatchObject({
      status: 'incomplete',
      fail: true,
      durationMs: 1000,
      lastStatus: 'Not Yet Started',
      progress: 'Job not yet started',
      runPath,
    });
    expect(JSON.stringify(result)).not.toContain('504');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('classifies a request deadline as incomplete and never HTTP 504', async () => {
    const { http, get } = httpFor();
    get.mockRejectedValueOnce(new AdtNetworkError('timeout', new DOMException('deadline', 'TimeoutError')));
    expect(await runAtcCiCheck(http, safety, options())).toMatchObject({ status: 'incomplete', fail: true });
  });
  it.each(['Failed', 'ERROR', 'Aborted', 'Cancelled', 'Not Created'])('stops on terminal status %s', async (status) => {
    const { http } = httpFor({ status: `<run status="${status}"/>` });
    expect(await runAtcCiCheck(http, safety, options())).toMatchObject({
      status: 'incomplete',
      fail: true,
      lastStatus: status,
    });
  });
  it.each([
    'https://sap.example/sap/bc/adt/api/atc/runs/1',
    '//evil/run',
    '/sap/bc/adt/api/atc/runs/%252e%252e/results/1',
    '/sap/bc/adt/api/atc/runs/1#x',
    '/sap/bc/adt/packages/Z',
  ])('refuses unsafe run locations %s', async (location) => {
    const { http, get } = httpFor({ location });
    await expect(runAtcCiCheck(http, safety, options())).rejects.toThrow('canonical');
    expect(get.mock.calls.some((call) => call[0] === location)).toBe(false);
  });
  it('refuses an unsafe result link without requesting it', async () => {
    const { http, get } = httpFor({ status: completed.replace(resultPath, 'https://evil/result') });
    await expect(runAtcCiCheck(http, safety, options())).rejects.toThrow('canonical');
    expect(get.mock.calls.some((call) => call[0] === 'https://evil/result')).toBe(false);
  });
  it('never passes a malformed completed report', async () => {
    const { http } = httpFor({ report: '<html>login</html>' });
    await expect(runAtcCiCheck(http, safety, options())).rejects.toThrow('non-checkstyle');
  });
  it('evaluates all findings while capping returned rows and optional XML', async () => {
    const many =
      '<checkstyle><file name="Z">' +
      Array.from(
        { length: CI_FINDINGS_LIMIT + 1 },
        (_, i) => `<error severity="${i === CI_FINDINGS_LIMIT ? 'error' : 'info'}" message="${'x'.repeat(1500)}"/>`,
      ).join('') +
      '</file></checkstyle>';
    const { http } = httpFor({ report: many });
    const result = await runAtcCiCheck(http, safety, { ...options(), includeReportXml: true });
    expect(result).toMatchObject({
      status: 'completed',
      fail: true,
      truncated: true,
      summary: { findingCount: CI_FINDINGS_LIMIT + 1 },
      reportXmlOmitted: expect.any(String),
    });
    if (result.status !== 'completed') throw new Error('Expected completed result');
    expect(result.findings).toHaveLength(CI_FINDINGS_LIMIT);
  });
  it('includes small XML only on request', async () => {
    const { http } = httpFor();
    expect(await runAtcCiCheck(http, safety, { ...options(), includeReportXml: true })).toHaveProperty(
      'reportXml',
      report,
    );
  });
  it('honors cancellation before preflight', async () => {
    const { http, get, post } = httpFor();
    const controller = new AbortController();
    controller.abort();
    expect(await runAtcCiCheck(http, safety, { ...options(), signal: controller.signal })).toMatchObject({
      status: 'incomplete',
      fail: true,
    });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('package verifier passes controls without constructing another deadline', async () => {
    const { http, get } = httpFor();
    const control = { deadline: Date.now() + 1000, signal: new AbortController().signal };
    await verifyCiPackages(http, safety, { packages: ['ZPKG'] }, control);
    expect(get).toHaveBeenCalledWith('/sap/bc/adt/packages/ZPKG', undefined, control);
  });
});
