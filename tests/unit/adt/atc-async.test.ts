import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runAtcCheck } from '../../../src/adt/devtools.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const ATC_CUSTOMIZING_EMPTY =
  '<?xml version="1.0"?><atc:customizing xmlns:atc="http://www.sap.com/adt/atc"><properties/></atc:customizing>';
const ATC_RUN_STATUS_RUNNING = readFileSync(
  join(import.meta.dirname, '../../fixtures/xml/atc-run-status-running.xml'),
  'utf-8',
);
const ATC_RUN_STATUS_COMPLETED = readFileSync(
  join(import.meta.dirname, '../../fixtures/xml/atc-run-status-completed.xml'),
  'utf-8',
);

function mockAsyncAtcHttp(
  worklistId: string,
  worklist: string,
  ...statuses: string[]
): AdtHttpClient & { runStatusGet: ReturnType<typeof vi.fn>; worklistGet: ReturnType<typeof vi.fn> } {
  const runStatusPath = `/sap/bc/adt/atc/runs/RUN-${worklistId}`;
  const post = vi
    .fn()
    .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: worklistId })
    .mockResolvedValueOnce({ statusCode: 201, headers: { Location: runStatusPath }, body: '' });
  const runStatusGet = vi.fn();
  for (const body of statuses) runStatusGet.mockResolvedValueOnce({ statusCode: 200, headers: {}, body });
  if (statuses.length > 0) {
    runStatusGet.mockResolvedValue({ statusCode: 200, headers: {}, body: statuses.at(-1)! });
  }
  const worklistGet = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: worklist });
  const get = vi.fn((url: string, ...rest: unknown[]) => {
    if (url.includes('/atc/customizing')) {
      return Promise.resolve({ statusCode: 200, headers: {}, body: ATC_CUSTOMIZING_EMPTY });
    }
    return url === runStatusPath ? runStatusGet(url, ...rest) : worklistGet(url, ...rest);
  });
  return {
    get,
    runStatusGet,
    worklistGet,
    post,
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient & {
    runStatusGet: ReturnType<typeof vi.fn>;
    worklistGet: ReturnType<typeof vi.fn>;
  };
}

describe('asynchronous ATC run lifecycle', () => {
  it('follows captured run statuses to completion before fetching the worklist', async () => {
    const worklist = `<worklist id="WL-STATUS" objectSetIsComplete="true"><objects>
      <object uri="/sap/bc/adt/programs/programs/ZTEST" type="PROG" name="ZTEST"/>
    </objects></worklist>`;
    const notYetStarted = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" status="Not Yet Started"/>';
    const http = mockAsyncAtcHttp(
      'WL-STATUS',
      worklist,
      notYetStarted,
      ATC_RUN_STATUS_RUNNING,
      ATC_RUN_STATUS_COMPLETED,
    );
    let clock = 0;

    const result = await runAtcCheck(
      http,
      unrestrictedSafetyConfig(),
      '/sap/bc/adt/programs/programs/ZTEST',
      undefined,
      { timeoutMs: 30_000, now: () => clock, sleep: async (ms) => void (clock += ms) },
    );

    expect(http.post).toHaveBeenLastCalledWith(
      '/sap/bc/adt/atc/runs?worklistId=WL-STATUS&clientWait=false',
      expect.any(String),
      'application/xml',
      { Accept: 'application/xml' },
      expect.objectContaining({ deadline: 30_000 }),
    );
    expect(http.runStatusGet).toHaveBeenCalledTimes(3);
    expect(http.runStatusGet).toHaveBeenCalledWith(
      '/sap/bc/adt/atc/runs/RUN-WL-STATUS',
      { Accept: 'application/vnd.sap.atc.run.v1+xml' },
      expect.objectContaining({ deadline: 30_000 }),
    );
    expect(http.worklistGet).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      complete: true,
      completionEvidence: 'asyncRunCompleted',
      runStatusCode: 201,
      runStatus: 'Completed',
      findingStatistics: null,
      expectedFindingCount: null,
      truncated: false,
      incompleteReasons: [],
    });
  });

  it.each([
    ['absolute URL', 'https://attacker.example/sap/bc/adt/atc/runs/EVIL'],
    ['protocol-relative URL', '//attacker.example/sap/bc/adt/atc/runs/EVIL'],
    ['dot-segment path', '/sap/bc/adt/atc/runs/SAFE/../../admin'],
    ['nested path', '/sap/bc/adt/atc/runs/SAFE/child'],
    ['query-bearing path', '/sap/bc/adt/atc/runs/SAFE?redirect=/sap/bc/adt/admin'],
  ])('refuses a run-status location with a %s without following it', async (_label, location) => {
    const http = mockAsyncAtcHttp('WL-UNSAFE', '<worklist/>', ATC_RUN_STATUS_COMPLETED);
    (http.post as ReturnType<typeof vi.fn>).mockReset();
    (http.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: 'WL-UNSAFE' })
      .mockResolvedValueOnce({ statusCode: 201, headers: { location }, body: '' });

    const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');

    expect(result).toMatchObject({ complete: false, completionEvidence: null, truncated: false });
    expect(result.incompleteReasons.join(' ')).toMatch(/unsafe or malformed/i);
    expect(http.runStatusGet).not.toHaveBeenCalled();
    expect(http.worklistGet).not.toHaveBeenCalled();
  });

  it('does not treat a 201 response without a run-status location as a legacy completed run', async () => {
    const http = mockAsyncAtcHttp('WL-NO-LOCATION', '<worklist/>', ATC_RUN_STATUS_COMPLETED);
    (http.post as ReturnType<typeof vi.fn>).mockReset();
    (http.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: 'WL-NO-LOCATION' })
      .mockResolvedValueOnce({ statusCode: 201, headers: {}, body: '' });

    const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');

    expect(result).toMatchObject({ complete: false, runStatusCode: 201, completionEvidence: null });
    expect(result.incompleteReasons.join(' ')).toMatch(/without a run-status location/i);
    expect(http.worklistGet).not.toHaveBeenCalled();
  });

  it('returns explicit incomplete evidence for a cancelled run', async () => {
    const cancelled = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" status="Cancelled"/>';
    const http = mockAsyncAtcHttp('WL-CANCELLED', '<worklist/>', cancelled);

    const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');

    expect(result).toMatchObject({ complete: false, runStatus: 'Cancelled', completionEvidence: null });
    expect(result.incompleteReasons.join(' ')).toMatch(/instead of "Completed"/i);
    expect(http.worklistGet).not.toHaveBeenCalled();
  });

  it('returns explicit incomplete evidence when status polling reaches the deadline', async () => {
    const http = mockAsyncAtcHttp('WL-RUNNING', '<worklist/>', ATC_RUN_STATUS_RUNNING);
    let clock = 0;

    const result = await runAtcCheck(
      http,
      unrestrictedSafetyConfig(),
      '/sap/bc/adt/programs/programs/ZTEST',
      undefined,
      { timeoutMs: 250, now: () => clock, sleep: async (ms) => void (clock += ms) },
    );

    expect(result).toMatchObject({ complete: false, runStatus: 'Running', completionEvidence: null });
    expect(result.incompleteReasons.join(' ')).toMatch(/request deadline/i);
    expect(http.runStatusGet).toHaveBeenCalledTimes(1);
    expect(http.worklistGet).not.toHaveBeenCalled();
  });
});
