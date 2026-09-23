/** Request-boundary coverage for issue #737's cumulative budget and data-result lease. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { Semaphore } = await import('../../../src/adt/semaphore.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { logger } = await import('../../../src/server/logger.js');

function dataPreviewXml(values: string[]): string {
  return `<abap><values><COLUMNS><COLUMN><METADATA name="OBJ_NAME"/><DATASET>${values
    .map((value) => `<DATA>${value}</DATA>`)
    .join('')}</DATASET></COLUMN></COLUMNS></values></abap>`;
}

function createBoundedClient(limitBytes: number, semaphore: InstanceType<typeof Semaphore>) {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
    maxDataPreviewResponseBytes: limitBytes,
    maxConcurrentDataResults: 2,
    dataResultSemaphore: semaphore,
  });
}

describe('request-scoped data-result safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('applies one cumulative budget across automatic SQL chunks and emits a stable safe error', async () => {
    const firstBody = dataPreviewXml(['Z01']);
    const secondBody = dataPreviewXml(['Z09']);
    const limitBytes = Buffer.byteLength(firstBody) + Buffer.byteLength(secondBody) - 1;
    const semaphore = new Semaphore(2);
    const client = createBoundedClient(limitBytes, semaphore);
    const auditSpy = vi.spyOn(logger, 'emitAudit');

    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(200, firstBody))
      .mockResolvedValueOnce(mockResponse(200, secondBody));

    const result = await handleToolCall(
      client,
      { ...DEFAULT_CONFIG, maxDataPreviewResponseBytes: limitBytes },
      'SAPQuery',
      { sql: "SELECT obj_name FROM tadir WHERE obj_name IN ('Z01','Z02','Z03','Z04','Z05','Z06','Z07','Z08','Z09')" },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'REQ-BUDGET',
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: 'DATA_RESPONSE_TOO_LARGE',
      message: expect.stringContaining('lower maxRows'),
      limitBytes,
      retryable: false,
      requestId: 'REQ-BUDGET',
    });
    expect(mockFetch.mock.calls.filter((call) => String(call[0]).includes('/datapreview/freestyle'))).toHaveLength(2);
    expect(semaphore.inflight).toBe(0);
    expect(semaphore.waiting).toBe(0);

    const limitedEvent = auditSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.event === 'data_response_limited');
    expect(limitedEvent).toMatchObject({
      requestId: 'REQ-BUDGET',
      limitBytes,
      endpointFamily: 'data-preview',
      queueWaitMs: expect.any(Number),
    });
    expect(limitedEvent).not.toHaveProperty('sql');
    expect(limitedEvent).not.toHaveProperty('responseBody');
  });

  it('keeps the limit contract in minimal-error multi-target mode and stops before XML parsing', async () => {
    const semaphore = new Semaphore(2);
    const client = createBoundedClient(8, semaphore);
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(200, 'not XML and already oversized'));

    const result = await handleToolCall(
      client,
      {
        ...DEFAULT_CONFIG,
        maxDataPreviewResponseBytes: 8,
        minimalErrors: true,
        targetId: 'A4H-001',
      },
      'SAPQuery',
      { sql: 'SELECT obj_name FROM tadir' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'REQ-TARGET-BUDGET',
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: 'DATA_RESPONSE_TOO_LARGE',
      message: expect.stringContaining('restrictive non-overlapping key-range WHERE'),
      limitBytes: 8,
      retryable: false,
      requestId: 'REQ-TARGET-BUDGET',
      target: 'A4H-001',
    });
    expect(semaphore.inflight).toBe(0);
  });

  it('makes hyperfocused query inherit one scope, request ID, and semaphore lease', async () => {
    const body = dataPreviewXml(['Z01']);
    const semaphore = new Semaphore(1);
    const client = createBoundedClient(Buffer.byteLength(body) - 1, semaphore);
    const auditSpy = vi.spyOn(logger, 'emitAudit');
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(200, body));

    const result = await handleToolCall(
      client,
      { ...DEFAULT_CONFIG, toolMode: 'hyperfocused' },
      'SAP',
      { action: 'query', params: { sql: 'SELECT obj_name FROM tadir' } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'REQ-HYPER-BUDGET',
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      error: 'DATA_RESPONSE_TOO_LARGE',
      requestId: 'REQ-HYPER-BUDGET',
    });
    expect(
      auditSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event.event === 'tool_call_start')
        .map((event) => event.requestId),
    ).toEqual(['REQ-HYPER-BUDGET', 'REQ-HYPER-BUDGET']);
    expect(semaphore.inflight).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });

  it('shares a FIFO process-wide lease, leaves source reads independent, and holds it through terminal audit', async () => {
    const semaphore = new Semaphore(2);
    const clients = [
      createBoundedClient(4096, semaphore),
      createBoundedClient(4096, semaphore),
      createBoundedClient(4096, semaphore),
    ];
    const releaseResponses: Array<() => void> = [];
    const terminalInflight: number[] = [];
    vi.spyOn(logger, 'emitAudit').mockImplementation((event) => {
      if (event.event === 'tool_call_end' && event.tool === 'SAPQuery') terminalInflight.push(semaphore.inflight);
    });

    mockFetch.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      if (String(url).includes('/datapreview/freestyle')) {
        return new Promise<Response>((resolve) => {
          releaseResponses.push(() => resolve(mockResponse(200, dataPreviewXml(['Z']))));
        });
      }
      return Promise.resolve(mockResponse(200, 'REPORT zhello.'));
    });

    const calls = clients.map((client, index) =>
      handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: `SELECT obj_name FROM tadir WHERE obj_name = 'Z${index}'` },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `REQ-DATA-${index}`,
      ),
    );

    await vi.waitFor(() => expect(releaseResponses).toHaveLength(2));
    expect(semaphore.inflight).toBe(2);
    expect(semaphore.waiting).toBe(1);

    const sourceResult = await handleToolCall(clients[0]!, DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZHELLO',
    });
    expect(sourceResult.isError).toBeUndefined();
    expect(semaphore.inflight).toBe(2);

    releaseResponses[0]!();
    await vi.waitFor(() => expect(releaseResponses).toHaveLength(3));
    expect(terminalInflight[0]).toBe(2);
    expect(semaphore.inflight).toBe(2);

    releaseResponses[1]!();
    releaseResponses[2]!();
    const results = await Promise.all(calls);
    expect(results.every((result) => result.isError === undefined)).toBe(true);
    expect(semaphore.inflight).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });
});
