import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

beforeEach(() => vi.resetAllMocks());

describe('network error guidance', () => {
  it.each([
    ['TimeoutError', 'exceeded its client time limit'],
    ['AbortError', 'was cancelled'],
  ])('does not label %s as a connectivity failure', async (name, expected) => {
    mockFetch.mockRejectedValue(new DOMException('stopped', name));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(expected);
    expect(result.content[0]?.text).not.toMatch(/Cannot reach|connectivity probe/i);
  });

  it.each(['TimeoutError', 'AbortError'])('retains activation recovery guidance for %s', async (name) => {
    for (const minimalErrors of [false, true]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
      mockFetch.mockRejectedValueOnce(new DOMException('private-sentinel', name));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('If activation was submitted');
      expect(result.content[0]?.text).toContain('completion is unconfirmed');
      expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
      expect(result.content[0]?.text).toContain('force_refresh=true');
      expect(result.content[0]?.text).not.toMatch(/Cannot reach|Successfully activated/);
      if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
    }
  });

  it.each([429, 500, 503])(
    'requires inspection after activation HTTP %i, including minimal-error mode',
    async (status) => {
      for (const minimalErrors of [false, true]) {
        mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
        mockFetch.mockResolvedValueOnce(mockResponse(status, 'private-sentinel'));
        const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
          type: 'PROG',
          name: 'ZTEST',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('completion is unconfirmed');
        expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
        expect(result.content[0]?.text).not.toMatch(/wait 10-30 seconds and retry|Cannot reach/);
        if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
      }
    },
  );

  it.each([
    [
      'dependent syntax error',
      '<html><head><title>Application Server Error</title></head><body><span id="msgText">Syntax error in program ZBP_R_TRAVEL==================BD .</span></body></html>',
      'The program "ZBP_R_TRAVEL" has syntax errors',
    ],
    [
      'structured SAP diagnostics',
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><message>Activation terminated</message><localizedMessage>Activation terminated</localizedMessage><properties><entry key="T100KEY-ID">EU</entry><entry key="T100KEY-NO">510</entry><entry key="LINE">42</entry></properties></exc:exception>',
      '[EU/510] Line 42: Activation terminated',
    ],
  ])('preserves %s after activation HTTP 500 without generic replay guidance', async (_label, body, expected) => {
    for (const minimalErrors of [false, true]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(500, body));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      const text = result.content[0]?.text;
      expect(result.isError).toBe(true);
      expect(text).toContain('completion is unconfirmed');
      expect(text).toContain('INACTIVE_OBJECTS');
      expect(text).not.toContain('wait 10-30 seconds and retry');
      if (minimalErrors) {
        expect(text).not.toMatch(/ZBP_R_TRAVEL|EU\/510|Line 42|Activation terminated/);
      } else {
        expect(text).toContain(expected);
      }
    }
  });

  it('retains connectivity guidance for connection errors containing timeout text', async () => {
    mockFetch.mockRejectedValue(new Error('connect ETIMEDOUT: connection timeout'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Cannot reach the SAP system');
    expect(result.content[0]?.text).not.toContain('client time limit');
  });
});

describe('network error cause (#1272)', () => {
  const fetchFailed = (cause?: unknown) => new TypeError('fetch failed', cause === undefined ? undefined : { cause });
  const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
  const read = async (minimalErrors = false) => {
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', {
      type: 'PROG',
      name: 'ZTEST',
    });
    expect(result.isError).toBe(true);
    return result.content[0]?.text ?? '';
  };

  it.each([
    [
      coded('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'),
      'ADT network error: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate)',
    ],
    [
      coded('ENOTFOUND', 'getaddrinfo ENOTFOUND sap.example'),
      'ADT network error: fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND sap.example)',
    ],
    [
      Object.assign(new AggregateError([coded('ECONNREFUSED', 'connect ECONNREFUSED ::1:443')], ''), {
        code: 'ECONNREFUSED',
      }),
      'ADT network error: fetch failed (ECONNREFUSED: connect ECONNREFUSED ::1:443)',
    ],
    [
      new AggregateError([coded('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443')], ''),
      'ADT network error: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:443)',
    ],
    [new Error('other side closed'), 'ADT network error: fetch failed (other side closed)'],
  ])('appends the low-level cause once (%#)', async (cause, expected) => {
    mockFetch.mockRejectedValue(fetchFailed(cause));
    const text = await read();
    expect(text.split('\n')[0]).toBe(expected);
    expect(text).toContain('Cannot reach the SAP system');
  });

  it('keeps the message unchanged without a cause', async () => {
    mockFetch.mockRejectedValue(fetchFailed());
    expect((await read()).split('\n')[0]).toBe('ADT network error: fetch failed');
  });

  it('keeps timeouts unchanged', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const text = await read();
    expect(text.split('\n')[0]).toBe('ADT network error: The operation was aborted due to timeout');
    expect(text).toContain('exceeded its client time limit');
  });

  it('shows only the code under ARC1_MINIMAL_ERRORS', async () => {
    mockFetch.mockRejectedValue(
      fetchFailed(
        coded(
          'ERR_TLS_CERT_ALTNAME_INVALID',
          "Hostname/IP does not match certificate's altnames: IP: 10.1.2.3 is not in the cert's list: sap.internal",
        ),
      ),
    );
    const text = await read(true);
    expect(text).toContain('ADT network error (ERR_TLS_CERT_ALTNAME_INVALID).');
    expect(text).toContain('Cannot reach the SAP system');
    expect(text).not.toMatch(/10\.1\.2\.3|sap\.internal|altnames|fetch failed/);

    // undici's proxy Client.request rejects with the coded error itself, not under `fetch failed`.
    mockFetch.mockRejectedValue(coded('ECONNREFUSED', 'connect ECONNREFUSED 10.9.9.9:20003'));
    const proxyText = await read(true);
    expect(proxyText).toContain('ADT network error (ECONNREFUSED).');
    expect(proxyText).not.toContain('10.9.9.9');
  });
});

// SAP 7.50 sends a 404 without sap-cache-control and its ICM repeats it for 60 seconds;
// 7.58 and 8.16 send "+0" (#1261).
it.each([
  [{}, true],
  [{ 'sap-cache-control': '+0' }, false],
])('says a not-found answer may be repeated only without sap-cache-control (%j)', async (headers, repeated) => {
  mockFetch.mockResolvedValue(mockResponse(404, 'Not found', headers));
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZNEW' });
  expect(result.content[0]?.text).toContain('Object "ZNEW" (type PROG) was not found');
  expect(result.content[0]?.text.includes('wait 60 seconds and retry')).toBe(repeated);
});
