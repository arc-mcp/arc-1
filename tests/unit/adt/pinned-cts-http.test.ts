import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { type CtsSubmission, pinnedCtsHttp } from '../../../src/adt/pinned-cts-http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock('undici', async (original) => ({ ...(await original<typeof import('undici')>()), fetch: mockFetch }));
const { AdtHttpClient } = await import('../../../src/adt/http.js');
function setup() {
  const safety = {
    ...unrestrictedSafetyConfig(),
    multiTargetWrite: {
      enabled: true,
      target: 'DEV/001',
      allowedPackages: ['$TMP'],
      allowedTransports: ['*'],
      serverAllowedTransports: [],
    },
  };
  const abort = new AbortController();
  const context = pinnedMutationContext(
    safety,
    { deadline: Date.now() + 300000, signal: abort.signal },
    { unlockFailed: false },
  );
  const submissions: CtsSubmission[] = [];
  const raw = new AdtHttpClient({ baseUrl: 'https://sap.example.test', username: 'test-only', password: 'test-only' });
  return { http: pinnedCtsHttp(raw, safety, context, submissions), abort, context, submissions };
}
beforeEach(() => mockFetch.mockReset());
describe('private CTS real HTTP policy', () => {
  it.each([401, 403, 406, 429, 500, 503])('does not replay mutation on HTTP %s', async (status) => {
    mockFetch.mockImplementation(async (_url, options) =>
      options?.method === 'HEAD'
        ? mockResponse(200, '', { 'x-csrf-token': 'test-token' })
        : mockResponse(status, 'secret upstream detail', { 'x-csrf-token': 'Required' }),
    );
    const s = setup();
    await expect(s.http.delete('/sap/bc/adt/cts/transportrequests/DEVK900001')).rejects.toThrow();
    expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1);
    expect(s.submissions).toEqual([
      { method: 'DELETE', path: '/sap/bc/adt/cts/transportrequests/DEVK900001', acknowledged: false },
    ]);
  });
  it('bounds cumulative successful bodies across reads and stops before a later send', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, 'x'.repeat(5 * 1024 * 1024)));
    const s = setup();
    await s.http.get('/sap/bc/adt/cts/transportrequests/DEVK900001');
    await expect(s.http.get('/sap/bc/adt/cts/transportrequests/DEVK900001')).rejects.toThrow(/limit|exceed/i);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it('does not send after cancellation or deadline expiration', async () => {
    const s = setup();
    s.abort.abort();
    await expect(s.http.put('/sap/bc/adt/cts/transportrequests/DEVK900001', 'x')).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(s.submissions).toEqual([]);
    const t = setup();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t.context.requestPolicy.deadline + 1);
    try {
      await expect(t.http.delete('/sap/bc/adt/cts/transportrequests/DEVK900001')).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
    expect(mockFetch).not.toHaveBeenCalled();
    expect(t.submissions).toEqual([]);
  });
});
