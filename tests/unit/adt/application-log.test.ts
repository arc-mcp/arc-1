import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readApplicationLog } from '../../../src/adt/application-log.js';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { redactAuditEvent, sanitizeArgs } from '../../../src/server/audit.js';
import { requestContext } from '../../../src/server/context.js';

const logNumber = '00000000000000000042';
const handle = '0123456789012345678901';
const overview = {
  LogNumber: logNumber,
  LogHandle: handle,
  Object: 'Z_DEMO',
  SubObject: 'IMPORT',
  ExternalNumber: 'job-42',
  Severity: 'E',
  CreatedAt: '/Date(1792278000000)/',
};
const message = (number: string) => ({
  LogHandle: handle,
  MessageNumber: number,
  Type: 'E',
  Text: 'Änderung 未完成: invoice 42',
  Timestamp: '/Date(1792278000000)/',
  HasLongText: true,
  HasDetailText: false,
  __metadata: { uri: 'https://untrusted.invalid/' },
  ContextField1: 'unrequested detail',
});
const response = (rows: unknown[], next?: string) => ({
  statusCode: 200,
  headers: {},
  body: JSON.stringify({ d: { results: rows, ...(next ? { __next: next } : {}) } }),
});
function setup() {
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    client: '001',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true },
  });
  const get = vi
    .spyOn(client.http, 'get')
    .mockResolvedValueOnce(response([overview]))
    .mockResolvedValueOnce(response([message('000001'), message('000002')]));
  return { client, get };
}
beforeEach(() => vi.restoreAllMocks());

describe('native application-log reader', () => {
  it('resolves one exact log and pages native messages without following URLs or expanding details', async () => {
    const { client, get } = setup();
    const result = await readApplicationLog(client, { logNumber, maxRows: 1 });
    expect(result).toMatchObject({
      status: 'ok',
      logNumber,
      offset: 0,
      more: true,
      nextOffset: 1,
      snapshotGuaranteed: false,
      messages: [{ number: '000001', type: 'E', text: message('000001').Text, hasLongText: true }],
    });
    expect(JSON.stringify(result)).not.toContain('unrequested detail');
    expect(JSON.stringify(result)).not.toContain(handle);
    expect(get).toHaveBeenCalledTimes(2);
    const first = new URL(get.mock.calls[0]![0], 'https://sap.invalid');
    expect(first.searchParams.get('$filter')).toBe(`LogNumber eq '${logNumber}'`);
    expect(first.searchParams.get('$top')).toBe('2');
    const second = new URL(get.mock.calls[1]![0], 'https://sap.invalid');
    expect(second.pathname).toBe(
      `/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/ApplicationLogOverviewSet('${handle}')/ApplicationLogMessageSet`,
    );
    expect(Object.fromEntries(second.searchParams)).toEqual({ $top: '2', $skip: '0', $format: 'json' });
    const options = get.mock.calls[0]![2]!;
    expect(options.responseBudget).toBe(get.mock.calls[1]![2]!.responseBudget);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('distinguishes no visible log from an empty successful log', async () => {
    const { client, get } = setup();
    get.mockReset().mockResolvedValueOnce(response([]));
    expect(await readApplicationLog(client, { logNumber })).toMatchObject({ status: 'not_found_or_not_visible' });
    expect(get).toHaveBeenCalledTimes(1);
    get
      .mockReset()
      .mockResolvedValueOnce(response([overview]))
      .mockResolvedValueOnce(response([]));
    expect(await readApplicationLog(client, { logNumber })).toMatchObject({ status: 'ok', messages: [], more: false });
  });
  it.each([0, -1, 101, 1.1, Number.NaN])('refuses invalid maxRows %s before SAP', async (maxRows) => {
    const { client, get } = setup();
    await expect(readApplicationLog(client, { logNumber, maxRows })).rejects.toThrow('maxRows');
    expect(get).not.toHaveBeenCalled();
  });
  it.each([-1, 5001, 1.1, Infinity])('refuses invalid offset %s before SAP', async (offset) => {
    const { client, get } = setup();
    await expect(readApplicationLog(client, { logNumber, offset })).rejects.toThrow('offset');
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['42', "0000000000000000004'", '00000000000000000042\n', '1'.repeat(21)])(
    'rejects invalid identity %j',
    async (bad) => {
      const { client, get } = setup();
      await expect(readApplicationLog(client, { logNumber: bad })).rejects.toThrow('20-digit');
      expect(get).not.toHaveBeenCalled();
    },
  );
  it('requires data opt-in and refuses opaque lineage under any table blocklist', async () => {
    const { client, get } = setup();
    client.safety.allowDataPreview = false;
    await expect(readApplicationLog(client, { logNumber })).rejects.toThrow();
    client.safety.allowDataPreview = true;
    client.safety.blockedDataSources = ['UNRELATED_TABLE'];
    await expect(readApplicationLog(client, { logNumber })).rejects.toThrow('no provable table lineage');
    expect(get).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500])('preserves native HTTP %s failures', async (status) => {
    const { client, get } = setup();
    const failure = new AdtApiError('native failure', status, '/service');
    get.mockReset().mockRejectedValue(failure);
    await expect(readApplicationLog(client, { logNumber })).rejects.toBe(failure);
  });
  it('rejects ambiguous/mismatched overview results instead of guessing a handle', async () => {
    for (const rows of [[overview, overview], [{ ...overview, LogNumber: '0'.repeat(20) }]]) {
      const { client, get } = setup();
      get.mockReset().mockResolvedValueOnce(response(rows));
      await expect(readApplicationLog(client, { logNumber })).rejects.toThrow('unexpected response');
      expect(get).toHaveBeenCalledTimes(1);
    }
  });
  it('escapes a returned opaque key as OData and URL syntax', async () => {
    const { client, get } = setup();
    const unusualHandle = "01234567890123456'/&?%";
    expect(unusualHandle.length).toBe(22);
    get
      .mockReset()
      .mockResolvedValueOnce(response([{ ...overview, LogHandle: unusualHandle }]))
      .mockResolvedValueOnce(response([]));
    await readApplicationLog(client, { logNumber });
    expect(get.mock.calls[1]![0]).toContain('01234567890123456%27%27%2F%26%3F%25');
  });
  it.each([
    [message('000001'), message('000001')],
    [{ ...message('000001'), LogHandle: 'another log' }],
    [{ ...message('000001'), Text: null }],
    [{ ...message('000001'), HasLongText: 'false' }],
    [{ ...message('000001'), MessageNumber: '1' }],
  ])('refuses malformed/mixed/duplicate messages', async (...rows) => {
    const { client, get } = setup();
    get
      .mockReset()
      .mockResolvedValueOnce(response([overview]))
      .mockResolvedValueOnce(response(rows));
    await expect(readApplicationLog(client, { logNumber })).rejects.toThrow('unexpected response');
  });
  it('refuses a server that ignores the requested row cap', async () => {
    const { client, get } = setup();
    get
      .mockReset()
      .mockResolvedValueOnce(response([overview]))
      .mockResolvedValueOnce(response(Array(3).fill(message('000001'))));
    await expect(readApplicationLog(client, { logNumber, maxRows: 1 })).rejects.toThrow('unexpected response');
  });
  it('never follows a next link and stops pagination at the offset ceiling', async () => {
    const { client, get } = setup();
    get
      .mockReset()
      .mockResolvedValueOnce(response([overview]))
      .mockResolvedValueOnce(response([message('000001')], 'https://evil.invalid/secret'));
    const result = await readApplicationLog(client, { logNumber, offset: 5000 });
    expect(result).toMatchObject({ more: true, limitReached: true });
    expect(result).not.toHaveProperty('nextOffset');
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('inherits request cancellation and the cumulative response allowance', async () => {
    const { client, get } = setup();
    const controller = new AbortController();
    const scope = client.createDataResultScope();
    await requestContext.run({ requestId: 'log-test', signal: controller.signal, dataResultScope: scope }, async () => {
      await readApplicationLog(client, { logNumber });
      expect(get.mock.calls[0]![2]?.responseBudget).toBe(scope.responseBudget);
      controller.abort();
      expect(get.mock.calls[0]![2]?.signal?.aborted).toBe(true);
    });
    scope.release();
  });
  it.each(['overview', 'messages'])(
    'reports the session deadline during %s without a connectivity hint',
    async (phase) => {
      const { client, get } = setup();
      const controller = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      get.mockReset();
      if (phase === 'messages') get.mockResolvedValueOnce(response([overview]));
      get.mockImplementationOnce(async (_path, _headers, options) => {
        controller.abort();
        throwIfRequestCancelled(options);
        throw new Error('Expected the request deadline to stop the native call');
      });
      const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
      const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
      const output = await handleToolCall(
        client,
        { ...DEFAULT_CONFIG, systemType: 'onprem', allowDataPreview: true },
        'SAPQuery',
        { action: 'application_log', applicationLog: { logNumber } },
      );
      expect(output.isError).toBe(true);
      expect(output.content[0]?.text).toContain('30-second deadline');
      expect(output.content[0]?.text).not.toMatch(/Cannot reach|connectivity|SYSTEM/);
      expect(get).toHaveBeenCalledTimes(phase === 'messages' ? 2 : 1);
    },
  );
  it('reports cancellation while awaiting admission and releases its owned scope', async () => {
    const { client, get } = setup();
    const controller = new AbortController();
    const scope = client.createDataResultScope();
    vi.spyOn(client, 'createDataResultScope').mockReturnValue(scope);
    const release = vi.spyOn(scope, 'release');
    vi.spyOn(scope, 'acquire').mockImplementation(async () => {
      controller.abort();
      throw new Error('admission aborted');
    });
    await requestContext.run({ requestId: 'cancelled-log', signal: controller.signal }, async () => {
      await expect(readApplicationLog(client, { logNumber })).rejects.toThrow('read was cancelled');
    });
    expect(release).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('application-log audit privacy', () => {
  it('redacts valid, malformed and hyperfocused arguments before validation', () => {
    for (const args of [
      { action: 'application_log', applicationLog: { logNumber } },
      { action: ['APPLICATION_LOG'], wrong: logNumber },
      { action: 'query', params: { action: 'application_log', wrong: logNumber } },
    ])
      expect(JSON.stringify(sanitizeArgs(args))).not.toContain(logNumber);
  });
  it('redacts request filters/handles and payloads in audit sinks', () => {
    const event = redactAuditEvent({
      event: 'http_request',
      timestamp: 'now',
      level: 'info',
      method: 'GET',
      statusCode: 200,
      durationMs: 1,
      path: `/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/ApplicationLogOverviewSet('${handle}')?LogNumber=${logNumber}`,
      responseBody: message('000001').Text,
    });
    expect(JSON.stringify(event)).not.toContain(handle);
    expect(JSON.stringify(event)).not.toContain(logNumber);
    expect(JSON.stringify(event)).not.toContain('Änderung');
    expect(JSON.stringify(event)).toContain('APL_LOG_MANAGEMENT_SRV');
  });
});
