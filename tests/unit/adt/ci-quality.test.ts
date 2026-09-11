import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATC_CI_ACCEPT_CHECKSTYLE,
  ATC_CI_ACCEPT_RUN,
  ATC_CI_CONTENT_TYPE_RUN,
  ATC_CI_DUMMY_RUN_ID,
  ATC_CI_LOCATION_PREFIX,
  ATC_CI_POLL_INTERVAL_MS,
  ATC_CI_RUNS_PATH,
  AUNIT_CI_ACCEPT_JUNIT,
  AUNIT_CI_ACCEPT_STATUS,
  AUNIT_CI_CONTENT_TYPE_RUN,
  AUNIT_CI_LOCATION_PREFIX,
  AUNIT_CI_POLL_INTERVAL_MS,
  AUNIT_CI_RUNS_PATH,
  type CiQualityClock,
  clampTimeoutSeconds,
  resolveCiApiLocation,
  runAtcCiCheck,
  runAunitCiCheck,
} from '../../../src/adt/ci-quality.js';
import {
  atcFindingsFail,
  buildAunitCiRunXml,
  buildOslObjectSetXml,
  DEFAULT_AUNIT_CI_CONTEXT,
  DEFAULT_AUNIT_CI_TITLE,
  normalizeCiObjectSet,
  parseAtcCheckstyle,
  parseAunitJunit,
} from '../../../src/adt/ci-quality-xml.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtResponse } from '../../../src/adt/http.js';
import * as safety from '../../../src/adt/safety.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { logger } from '../../../src/server/logger.js';

const FIXTURES = join(__dirname, '../../fixtures/xml');
const ATC_COMPLETED_XML = readFileSync(join(FIXTURES, 'atc-ci-run-status.xml'), 'utf8');
const ATC_CHECKSTYLE_XML = readFileSync(join(FIXTURES, 'atc-ci-checkstyle.xml'), 'utf8');
const AUNIT_FINISHED_XML = readFileSync(join(FIXTURES, 'aunit-ci-run-status.xml'), 'utf8');
const AUNIT_JUNIT_XML = readFileSync(join(FIXTURES, 'aunit-ci-junit.xml'), 'utf8');

const ORIGIN = 'https://ci.example.abap.ondemand.com';
const ATC_OBJECT_SET = {
  packages: ['Z_TEST'],
  packageTrees: ['Z_TEST_TREE'],
  softwareComponents: ['Z_TEST', '/DMO/SWC'],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function fixtureXml(status: string, href?: string): string {
  const link = href ? `<atom:link href="${href}" rel="http://www.sap.com/adt/relations/atc/result"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><atc:run xmlns:atc="http://www.sap.com/adt/atc" xmlns:atom="http://www.w3.org/2005/Atom" status="${status}">${link}</atc:run>`;
}

function aunitStatusXml(status: string, href?: string): string {
  const link = href ? `<atom:link href="${href}" rel="http://www.sap.com/adt/relations/abapunit/result"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><aunit:run xmlns:aunit="http://www.sap.com/adt/api/aunit" xmlns:atom="http://www.w3.org/2005/Atom"><aunit:progress status="${status}"/>${link}</aunit:run>`;
}

function createFakeClock(): CiQualityClock {
  let now = 0;
  return {
    now: () => now,
    async sleep(ms, signal) {
      if (signal?.aborted) throw new AdtApiError('CI quality run was aborted', 408, '');
      now += ms;
    },
  };
}

function ok(body: string, headers: Record<string, string> = {}): AdtResponse {
  return { statusCode: 200, headers, body };
}

function mockHttp(handlers: {
  get: (path: string, headers?: Record<string, string>) => AdtResponse | Promise<AdtResponse>;
  post: (
    path: string,
    body?: string,
    contentType?: string,
    headers?: Record<string, string>,
  ) => AdtResponse | Promise<AdtResponse>;
}): AdtHttpClient {
  return {
    get: vi.fn((path: string, headers?: Record<string, string>) => handlers.get(path, headers)),
    post: vi.fn((path: string, body?: string, contentType?: string, headers?: Record<string, string>) =>
      handlers.post(path, body, contentType, headers),
    ),
    put: vi.fn(),
    delete: vi.fn(),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

function mockAtcHttp(opts?: {
  pollBodies?: string[];
  location?: string;
  checkstyle?: string;
  csrfStatus?: number;
}): AdtHttpClient {
  const pollBodies = [...(opts?.pollBodies ?? [ATC_COMPLETED_XML])];
  return mockHttp({
    get: (path) => {
      if (path === `${ATC_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`) {
        if (opts?.csrfStatus && opts.csrfStatus >= 400) {
          throw new AdtApiError('missing', opts.csrfStatus, path);
        }
        return ok('', { 'x-csrf-token': 'csrf-tok' });
      }
      if (path.startsWith(`${ATC_CI_RUNS_PATH}/`) && !path.endsWith(ATC_CI_DUMMY_RUN_ID)) {
        const body = pollBodies.shift();
        if (!body) throw new Error(`unexpected extra ATC poll GET ${path}`);
        return ok(body);
      }
      if (path.startsWith('/sap/bc/adt/api/atc/results/')) {
        return ok(opts?.checkstyle ?? ATC_CHECKSTYLE_XML);
      }
      throw new Error(`unexpected ATC GET ${path}`);
    },
    post: (path) => {
      if (!path.startsWith(ATC_CI_RUNS_PATH)) throw new Error(`unexpected ATC POST ${path}`);
      return {
        statusCode: 201,
        headers: { location: opts?.location ?? '/sap/bc/adt/api/atc/runs/run-1' },
        body: '',
      };
    },
  });
}

function mockAunitHttp(opts?: { pollBodies?: string[]; location?: string; junit?: string }): AdtHttpClient {
  const pollBodies = [...(opts?.pollBodies ?? [AUNIT_FINISHED_XML])];
  return mockHttp({
    get: (path) => {
      if (path === `${AUNIT_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`) {
        return ok('', { 'x-csrf-token': 'csrf-tok' });
      }
      if (path.startsWith(`${AUNIT_CI_RUNS_PATH}/`) && !path.endsWith(ATC_CI_DUMMY_RUN_ID)) {
        const body = pollBodies.shift();
        if (!body) throw new Error(`unexpected extra AUnit poll GET ${path}`);
        return ok(body);
      }
      if (path.startsWith('/sap/bc/adt/api/abapunit/results/')) {
        return ok(opts?.junit ?? AUNIT_JUNIT_XML);
      }
      throw new Error(`unexpected AUnit GET ${path}`);
    },
    post: (path) => {
      if (path !== AUNIT_CI_RUNS_PATH) throw new Error(`unexpected AUnit POST ${path}`);
      return {
        statusCode: 201,
        headers: { location: opts?.location ?? '/sap/bc/adt/api/abapunit/runs/run-1' },
        body: '',
      };
    },
  });
}

describe('CI quality XML', () => {
  it('T1 builds OSL XML for package, package tree, and software component', () => {
    const xml = buildOslObjectSetXml(normalizeCiObjectSet(ATC_OBJECT_SET));
    expect(xml).toContain('<osl:package name="Z_TEST"/>');
    expect(xml).toContain('<osl:package name="Z_TEST_TREE" includeSubpackages="true"/>');
    expect(xml).toContain('<osl:softwareComponent name="Z_TEST"/>');
    expect(xml).toContain('<osl:softwareComponent name="/DMO/SWC"/>');
    expect(xml).toContain('xsi:type="multiPropertySet"');
    expect(xml).toContain('xmlns:osl="http://www.sap.com/api/osl"');
  });

  it('T1 escapes object-set names at the XML sink', () => {
    const xml = buildOslObjectSetXml({
      packages: ['A&B<"x">'],
      packageTrees: [],
      softwareComponents: ["O'K"],
    });
    expect(xml).toContain('name="A&amp;B&lt;&quot;x&quot;&gt;"');
    expect(xml).toContain('name="O&apos;K"');
    expect(xml).not.toContain('name="A&B');
  });

  it('T2 refuses an empty object set before HTTP', async () => {
    const http = mockAtcHttp();
    await expect(
      runAtcCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: { packages: ['  ', ''], packageTrees: [], softwareComponents: [] },
        clock: createFakeClock(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe('ATC CI client', () => {
  it('T3 posts checkVariant rather than check_variant', async () => {
    const http = mockAtcHttp();
    await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      variant: 'MY_TEST',
      configuration: 'MY_CONFIG',
      clock: createFakeClock(),
    });
    expect(http.post).toHaveBeenCalledWith(
      `${ATC_CI_RUNS_PATH}?clientWait=false`,
      expect.stringContaining('checkVariant="MY_TEST"'),
      ATC_CI_CONTENT_TYPE_RUN,
      expect.objectContaining({ Accept: ATC_CI_ACCEPT_RUN }),
    );
    const body = vi.mocked(http.post).mock.calls[0]?.[1] as string;
    expect(body).toContain('configuration="MY_CONFIG"');
    expect(body).toContain('xmlns:obj="http://www.sap.com/adt/objectset"');
    expect(body).not.toContain('check_variant');
  });

  it('T4 fetches CSRF from the dummy UUID with Accept and does not use discovery', async () => {
    const http = mockAtcHttp();
    await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    expect(http.get).toHaveBeenCalledWith(
      `${ATC_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`,
      { 'X-CSRF-Token': 'fetch', Accept: ATC_CI_ACCEPT_RUN },
      expect.objectContaining({ probe: true, suppressNotFoundLog: true }),
    );
    expect(http.fetchCsrfToken).not.toHaveBeenCalled();
    const resultCall = vi
      .mocked(http.get)
      .mock.calls.find((call) => String(call[0]).startsWith('/sap/bc/adt/api/atc/results/'));
    expect(resultCall?.[1]).toEqual(
      expect.objectContaining({ Accept: ATC_CI_ACCEPT_CHECKSTYLE, 'X-CSRF-Token': 'csrf-tok' }),
    );
  });

  it('T4 continues when the CSRF dummy UUID returns 404', async () => {
    const http = mockAtcHttp({ csrfStatus: 404 });
    const result = await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    expect(result.status).toBe('completed');
    expect(http.post).toHaveBeenCalled();
    expect(http.fetchCsrfToken).not.toHaveBeenCalled();
  });

  it('T5 posts clientWait=false with the ATC run Content-Type', async () => {
    const http = mockAtcHttp();
    await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    expect(http.post).toHaveBeenCalledWith(
      `${ATC_CI_RUNS_PATH}?clientWait=false`,
      expect.stringContaining('<atc:runparameters'),
      ATC_CI_CONTENT_TYPE_RUN,
      expect.any(Object),
    );
  });

  it('T6 follows a relative Location under the ATC CI prefix', async () => {
    const http = mockAtcHttp({ location: '/sap/bc/adt/api/atc/runs/run-1' });
    await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/api/atc/runs/run-1', {
      Accept: ATC_CI_ACCEPT_RUN,
    });
    expect(resolveCiApiLocation('/sap/bc/adt/api/atc/runs/run-1', ORIGIN, ATC_CI_LOCATION_PREFIX)).toBe(
      '/sap/bc/adt/api/atc/runs/run-1',
    );
    expect(resolveCiApiLocation(`${ORIGIN}/sap/bc/adt/api/atc/runs/run-1`, ORIGIN, ATC_CI_LOCATION_PREFIX)).toBe(
      '/sap/bc/adt/api/atc/runs/run-1',
    );
  });

  it('T7 refuses Location values that leave the SAP origin or use .. / backslash', async () => {
    const cases = [
      'https://evil.example/sap/bc/adt/api/atc/runs/x',
      '/sap/bc/adt/api/atc/runs/../secrets',
      '/sap/bc/adt/api/atc/runs/foo\\bar',
      '/sap/bc/adt/programs/programs/ZFOO',
    ];
    for (const location of cases) {
      const http = mockAtcHttp({ location });
      await expect(
        runAtcCiCheck(http, unrestrictedSafetyConfig(), {
          origin: ORIGIN,
          objectSet: ATC_OBJECT_SET,
          clock: createFakeClock(),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(vi.mocked(http.get).mock.calls.some((call) => String(call[0]).includes('/runs/run'))).toBe(false);
    }
  });

  it('T8 polls Running then Completed and fetches the result once', async () => {
    const http = mockAtcHttp({
      pollBodies: [fixtureXml('Running'), fixtureXml('Completed', '/sap/bc/adt/api/atc/results/atc-result-1')],
    });
    const result = await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    expect(result.status).toBe('completed');
    expect(result.reportXml).toBe(ATC_CHECKSTYLE_XML);
    const pollGets = vi
      .mocked(http.get)
      .mock.calls.filter((call) => String(call[0]) === '/sap/bc/adt/api/atc/runs/run-1');
    const resultGets = vi
      .mocked(http.get)
      .mock.calls.filter((call) => String(call[0]) === '/sap/bc/adt/api/atc/results/atc-result-1');
    expect(pollGets).toHaveLength(2);
    expect(resultGets).toHaveLength(1);
  });

  it('T9 fails Aborted, empty, and Not Created without a result GET', async () => {
    const cases = [fixtureXml('Aborted', '/sap/bc/adt/api/atc/results/x'), fixtureXml(''), fixtureXml('Not Created')];
    for (const body of cases) {
      const http = mockAtcHttp({ pollBodies: [body] });
      await expect(
        runAtcCiCheck(http, unrestrictedSafetyConfig(), {
          origin: ORIGIN,
          objectSet: ATC_OBJECT_SET,
          clock: createFakeClock(),
        }),
      ).rejects.toBeInstanceOf(AdtApiError);
      expect(vi.mocked(http.get).mock.calls.some((call) => String(call[0]).includes('/atc/results/'))).toBe(false);
    }
  });

  it('T10 stops on poll timeout without looping forever', async () => {
    const http = mockAtcHttp({ pollBodies: Array.from({ length: 20 }, () => fixtureXml('Running')) });
    await expect(
      runAtcCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: ATC_OBJECT_SET,
        timeoutSeconds: 30,
        clock: createFakeClock(),
      }),
    ).rejects.toMatchObject({ statusCode: 504 });
    const pollGets = vi
      .mocked(http.get)
      .mock.calls.filter((call) => String(call[0]) === '/sap/bc/adt/api/atc/runs/run-1');
    expect(pollGets.length).toBeGreaterThan(0);
    expect(pollGets.length).toBeLessThanOrEqual(Math.ceil(30_000 / ATC_CI_POLL_INTERVAL_MS) + 1);
    expect(clampTimeoutSeconds(5)).toBe(30);
    expect(clampTimeoutSeconds(9999)).toBe(1800);
  });

  it('T10 honours AbortSignal before contacting SAP', async () => {
    const http = mockAtcHttp();
    const signal = AbortSignal.abort();
    await expect(
      runAtcCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: ATC_OBJECT_SET,
        signal,
        clock: createFakeClock(),
      }),
    ).rejects.toMatchObject({ statusCode: 408 });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('T11 parses Checkstyle and applies failOnSeverity', async () => {
    const parsed = parseAtcCheckstyle(ATC_CHECKSTYLE_XML);
    expect(parsed.findings).toEqual([
      {
        file: 'testFile',
        message: 'testMessage1',
        source: 'sourceTester',
        line: 1,
        severity: 'error',
      },
      {
        file: 'testFile',
        message: 'testMessage2',
        source: 'sourceTester',
        line: 2,
        severity: 'info',
      },
    ]);
    expect(parsed.summary.findingCount).toBe(2);
    expect(atcFindingsFail(parsed.findings, 'error')).toBe(true);
    expect(atcFindingsFail(parsed.findings, 'warning')).toBe(true);
    expect(atcFindingsFail(parsed.findings, 'info')).toBe(true);
    expect(atcFindingsFail([{ ...parsed.findings[1]! }], 'error')).toBe(false);
    expect(atcFindingsFail([{ ...parsed.findings[1]! }], 'info')).toBe(true);
    expect(atcFindingsFail([], 'info')).toBe(false);

    const emptyHttp = mockAtcHttp({ checkstyle: '<checkstyle/>' });
    const empty = await runAtcCiCheck(emptyHttp, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      failOnSeverity: 'info',
      clock: createFakeClock(),
    });
    expect(empty.fail).toBe(false);
    expect(empty.summary.findingCount).toBe(0);
    expect(empty.reportXml).toBe('<checkstyle/>');
  });
});

describe('AUnit CI client', () => {
  it('T12 fetches CSRF from the AUnit dummy UUID', async () => {
    const http = mockAunitHttp();
    await runAunitCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      clock: createFakeClock(),
    });
    expect(http.get).toHaveBeenCalledWith(
      `${AUNIT_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`,
      { 'X-CSRF-Token': 'fetch', Accept: AUNIT_CI_ACCEPT_STATUS },
      expect.objectContaining({ probe: true }),
    );
    expect(http.fetchCsrfToken).not.toHaveBeenCalled();
  });

  it('T13 posts AUnit options defaults and OSL object set', async () => {
    const http = mockAunitHttp();
    await runAunitCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      clock: createFakeClock(),
    });
    expect(http.post).toHaveBeenCalledWith(
      AUNIT_CI_RUNS_PATH,
      expect.stringContaining('<aunit:measurements type="none"/>'),
      AUNIT_CI_CONTENT_TYPE_RUN,
      expect.objectContaining({ Accept: AUNIT_CI_ACCEPT_STATUS }),
    );
    const body = vi.mocked(http.post).mock.calls[0]?.[1] as string;
    expect(body).toContain(`title="${DEFAULT_AUNIT_CI_TITLE}"`);
    expect(body).toContain(`context="${DEFAULT_AUNIT_CI_CONTEXT}"`);
    expect(body).toContain('<aunit:scope ownTests="true" foreignTests="true"/>');
    expect(body).toContain('<aunit:riskLevel harmless="true" dangerous="true" critical="true"/>');
    expect(body).toContain('<aunit:duration short="true" medium="true" long="true"/>');
    expect(body).toContain('<osl:softwareComponent name="/DMO/REPO"/>');
    expect(body).toContain('xmlns:aunit="http://www.sap.com/adt/api/aunit"');
    expect(buildAunitCiRunXml(normalizeCiObjectSet({ softwareComponents: ['/DMO/REPO'] }))).toContain(
      'ownTests="true"',
    );
  });

  it('T14 accepts FINISHED and Completed poll status', async () => {
    for (const status of ['FINISHED', 'Completed'] as const) {
      const http = mockAunitHttp({
        pollBodies: [aunitStatusXml(status, '/sap/bc/adt/api/abapunit/results/aunit-result-1')],
      });
      const result = await runAunitCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: { softwareComponents: ['/DMO/REPO'] },
        clock: createFakeClock(),
      });
      expect(result.status).toBe('completed');
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/api/abapunit/results/aunit-result-1', {
        Accept: AUNIT_CI_ACCEPT_JUNIT,
        'X-CSRF-Token': 'csrf-tok',
      });
    }
    expect(
      resolveCiApiLocation('/sap/bc/adt/api/abapunit/results/aunit-result-1', ORIGIN, AUNIT_CI_LOCATION_PREFIX),
    ).toBe('/sap/bc/adt/api/abapunit/results/aunit-result-1');
  });

  it('T15 treats AUnit Aborted as an error', async () => {
    const http = mockAunitHttp({
      pollBodies: [aunitStatusXml('Aborted', '/sap/bc/adt/api/abapunit/results/x')],
    });
    await expect(
      runAunitCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: { softwareComponents: ['/DMO/REPO'] },
        clock: createFakeClock(),
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(vi.mocked(http.get).mock.calls.some((call) => String(call[0]).includes('/abapunit/results/'))).toBe(false);
  });

  it('T16 parses JUnit and fails only on errors or failures', async () => {
    const parsed = parseAunitJunit(AUNIT_JUNIT_XML);
    expect(parsed.summary).toMatchObject({
      title: 'ARC-1 AUnit run',
      tests: 4,
      failures: 1,
      errors: 1,
      skipped: 1,
      executedBy: 'COMM_USER',
    });
    expect(parsed.tests.map((test) => test.status)).toEqual(['passed', 'failed', 'error', 'skipped']);

    const failingHttp = mockAunitHttp();
    const failing = await runAunitCiCheck(failingHttp, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      clock: createFakeClock(),
    });
    expect(failing.fail).toBe(true);
    expect(failing.reportXml).toBe(AUNIT_JUNIT_XML);

    const skippedOnly = `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="1" failures="0" errors="0" skipped="1"><testcase classname="C" name="S"><skipped/></testcase></testsuites>`;
    const skippedHttp = mockAunitHttp({ junit: skippedOnly });
    const skipped = await runAunitCiCheck(skippedHttp, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      evaluateResults: true,
      clock: createFakeClock(),
    });
    expect(skipped.fail).toBe(false);
    expect(skipped.summary.skipped).toBe(1);

    const inspectHttp = mockAunitHttp();
    const inspect = await runAunitCiCheck(inspectHttp, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      evaluateResults: false,
      clock: createFakeClock(),
    });
    expect(inspect.fail).toBe(false);
  });
});

describe('CI quality safety and logging', () => {
  it('T17 never logs Authorization, CSRF tokens, or passwords', async () => {
    const spies = [
      vi.spyOn(logger, 'debug').mockImplementation(() => undefined),
      vi.spyOn(logger, 'info').mockImplementation(() => undefined),
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
      vi.spyOn(logger, 'error').mockImplementation(() => undefined),
      vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined),
    ];
    const http = mockAtcHttp();
    await runAtcCiCheck(http, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: ATC_OBJECT_SET,
      clock: createFakeClock(),
    });
    const aunitHttp = mockAunitHttp();
    await runAunitCiCheck(aunitHttp, unrestrictedSafetyConfig(), {
      origin: ORIGIN,
      objectSet: { softwareComponents: ['/DMO/REPO'] },
      clock: createFakeClock(),
    });
    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        const text = JSON.stringify(args).toLowerCase();
        expect(text).not.toMatch(/authorization|bearer |x-csrf-token|password|csrf-tok/);
      }
    }
  });

  it('T18 runs checkOperation before every POST', async () => {
    const spy = vi.spyOn(safety, 'checkOperation').mockImplementation(() => {
      throw new AdtSafetyError('blocked by safety configuration');
    });
    const atcHttp = mockAtcHttp();
    await expect(
      runAtcCiCheck(atcHttp, defaultSafetyConfig(), {
        origin: ORIGIN,
        objectSet: ATC_OBJECT_SET,
        clock: createFakeClock(),
      }),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(atcHttp.get).not.toHaveBeenCalled();
    expect(atcHttp.post).not.toHaveBeenCalled();

    const aunitHttp = mockAunitHttp();
    await expect(
      runAunitCiCheck(aunitHttp, defaultSafetyConfig(), {
        origin: ORIGIN,
        objectSet: { softwareComponents: ['/DMO/REPO'] },
        clock: createFakeClock(),
      }),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(aunitHttp.get).not.toHaveBeenCalled();
    expect(aunitHttp.post).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('T10 AUnit poll interval stays bounded', async () => {
    const http = mockAunitHttp({
      pollBodies: Array.from({ length: 20 }, () => aunitStatusXml('Running')),
    });
    await expect(
      runAunitCiCheck(http, unrestrictedSafetyConfig(), {
        origin: ORIGIN,
        objectSet: { softwareComponents: ['/DMO/REPO'] },
        timeoutSeconds: 30,
        clock: createFakeClock(),
      }),
    ).rejects.toMatchObject({ statusCode: 504 });
    const pollGets = vi
      .mocked(http.get)
      .mock.calls.filter((call) => String(call[0]) === '/sap/bc/adt/api/abapunit/runs/run-1');
    expect(pollGets.length).toBeLessThanOrEqual(Math.ceil(30_000 / AUNIT_CI_POLL_INTERVAL_MS) + 1);
  });
});
