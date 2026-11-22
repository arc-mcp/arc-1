import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { Client } = await import('undici');
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
        code: 'ETIMEDOUT',
      }),
      'ADT network error: fetch failed (ETIMEDOUT: connect ECONNREFUSED ::1:443)',
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
    for (const minimal of [false, true])
      expect((await read(minimal)).split('\n')[0]).toBe('ADT network error: fetch failed');
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
  });

  it.each([
    [
      coded('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error (proxy.internal:20003)'),
      'UND_ERR_CONNECT_TIMEOUT',
      'Connect Timeout Error (proxy.internal:20003)',
    ],
    [
      new AggregateError([coded('ECONNREFUSED', 'connect ECONNREFUSED 10.9.9.9:20003')], ''),
      'ECONNREFUSED',
      'connect ECONNREFUSED 10.9.9.9:20003',
    ],
  ] as const)('formats a proxy %s through Client.request', async (proxyFailure, code, reason) => {
    const proxyRequest = vi.spyOn(Client.prototype, 'request').mockRejectedValue(proxyFailure);
    try {
      const client = new AdtClient({
        baseUrl: 'http://sap.internal',
        btpProxy: { protocol: 'http', host: 'proxy.internal', port: 20003, getProxyToken: async () => 'test' },
      });
      // Batch handlers and deadline classifiers see only the outer message.
      await expect(client.getSystemInfo()).rejects.toMatchObject({ message: 'ADT network error: fetch failed' });
      for (const minimalErrors of [false, true]) {
        const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', {
          type: 'SYSTEM',
        });
        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('Connectivity probe failed');
        if (minimalErrors) {
          expect(text).toContain(`ADT network error (${code}).`);
          expect(text).not.toMatch(/10\.9\.9\.9|internal|20003/);
        } else {
          expect(text.split('\n')[0]).toBe(`ADT network error: fetch failed (${code}: ${reason})`);
        }
      }
      expect(proxyRequest).toHaveBeenCalledTimes(3);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      proxyRequest.mockRestore();
    }
  });

  it.each([
    ['SAPActivate', { type: 'PROG', name: 'ZTEST' }, 'If activation was submitted'],
    [
      'SAPWrite',
      { action: 'create', type: 'PROG', name: 'ZTEST', package: '$TMP' },
      'Create completion is unconfirmed',
    ],
  ] as const)('preserves the code and recovery advice for %s when CSRF fails', async (tool, args, hint) => {
    mockFetch.mockRejectedValue(fetchFailed(coded('ENOTFOUND', 'getaddrinfo ENOTFOUND sap.internal')));
    for (const minimalErrors of [false, true]) {
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, tool, args);
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(hint);
      if (minimalErrors) {
        expect(text).toContain('(ENOTFOUND)');
        expect(text).not.toContain('sap.internal');
      } else {
        expect(text.split('\n')[0]).toBe(
          'ADT network error: CSRF token fetch failed: fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND sap.internal)',
        );
      }
    }
  });

  it.each(['TimeoutError', 'AbortError'])('keeps %s separate from network causes in both modes', async (name) => {
    const cause = Object.assign(new Error('stopped for sap.internal'), {
      name,
      cause: coded('ENOTFOUND', 'private.example'),
    });
    mockFetch.mockRejectedValue(cause);
    for (const minimal of [false, true]) {
      const text = await read(minimal);
      expect(text).not.toMatch(/private\.example|ENOTFOUND|Cannot reach/);
      expect(text).toContain(name === 'TimeoutError' ? 'exceeded its client time limit' : 'was cancelled');
      if (minimal) expect(text).not.toContain('sap.internal');
      else expect(text.split('\n')[0]).toBe('ADT network error: stopped for sap.internal');
    }
  });

  it('preserves the built-in deadline message in both modes', async () => {
    const client = createClient();
    vi.spyOn(client, 'getSystemInfo').mockImplementation(
      async () => (await client.http.get('/unused', undefined, { deadline: 0 })).body,
    );
    for (const minimalErrors of [false, true]) {
      const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', { type: 'SYSTEM' });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text.split('\n')[0]).toBe('ADT network error: The ADT request deadline was exceeded.');
      expect(text).toContain('exceeded its client time limit');
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it('hides code-less details and non-symbolic code values in minimal mode', async () => {
    for (const cause of [
      new Error('bad port at sap.internal'),
      coded('ENOTFOUND: sap.internal', 'DNS lookup failed'),
    ]) {
      mockFetch.mockRejectedValue(fetchFailed(cause));
      const text = await read(true);
      expect(text.split('\n')[0]).toBe(
        'ADT network error. The full reason is hidden because ARC1_MINIMAL_ERRORS=true.',
      );
    }
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
