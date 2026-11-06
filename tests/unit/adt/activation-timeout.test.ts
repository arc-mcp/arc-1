import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { activate, activateBatch } = await import('../../../src/adt/devtools.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const object = { url: '/sap/bc/adt/programs/programs/zdeadline', name: 'ZDEADLINE' };
const preaudit = `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"
  xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object>
  <ioc:ref adtcore:uri="${object.url}" adtcore:name="${object.name}"/>
  </ioc:object></ioc:entry></ioc:inactiveObjects>`;
const ed064 = '<messages><msg type="E" shortText="ED064 no next/previous object found"/></messages>';

function client() {
  return new AdtHttpClient({ baseUrl: 'https://sap.example.test', username: 'test', password: 'test' });
}

function delayedResponse(delay: number, body: string) {
  return (_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(mockResponse(200, body));
      }, delay);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
}

function activationCalls() {
  return mockFetch.mock.calls.filter(([url]) => String(url).includes('/activation?'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  // Native AbortSignal timers do not use Vitest's clock. Keep their abort semantics
  // while making a five-minute operation deterministic and instant in this suite.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('deadline exceeded', 'TimeoutError')), delay);
    return controller.signal;
  });
  mockFetch.mockReset();
  mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('activation operation deadline', () => {
  it.each(['single', 'batch'] as const)('allows a %s activation to finish after 120 seconds', async (mode) => {
    mockFetch.mockImplementationOnce(delayedResponse(130_000, ''));
    const pending =
      mode === 'single'
        ? activate(client(), unrestrictedSafetyConfig(), object.url, { name: object.name })
        : activateBatch(client(), unrestrictedSafetyConfig(), [object]);
    const outcome = pending.then(
      (value) => value,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await outcome).toMatchObject({ success: true });
    expect(activationCalls()).toHaveLength(1);
  });

  it('shares the five-minute deadline with preaudit confirmation', async () => {
    mockFetch.mockImplementationOnce(delayedResponse(200_000, preaudit));
    mockFetch.mockImplementationOnce(delayedResponse(110_000, ''));
    const outcome = activate(client(), unrestrictedSafetyConfig(), object.url).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await outcome).toMatchObject({ name: 'AdtNetworkError', cause: { name: 'TimeoutError' } });
    expect(await outcome).toMatchObject({ extraHint: expect.stringContaining('completion is unconfirmed') });
    expect(activationCalls()).toHaveLength(2);
    expect(String(activationCalls()[1]![0])).toContain('preauditRequested=false');
  });

  it('shares the batch deadline with ED064 fallback and its preaudit confirmation', async () => {
    mockFetch.mockImplementationOnce(delayedResponse(150_000, preaudit));
    mockFetch.mockImplementationOnce(delayedResponse(50_000, ed064));
    mockFetch.mockImplementationOnce(delayedResponse(50_000, preaudit));
    mockFetch.mockImplementationOnce(delayedResponse(60_000, ''));
    const outcome = activateBatch(client(), unrestrictedSafetyConfig(), [object]).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await outcome).toMatchObject({ name: 'AdtNetworkError', cause: { name: 'TimeoutError' } });
    expect(activationCalls()).toHaveLength(4);
  });

  it('does not submit the confirmation after the deadline has expired', async () => {
    mockFetch.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 300_001);
      return mockResponse(200, preaudit);
    });
    mockFetch.mockResolvedValue(mockResponse(200, ''));
    await expect(activate(client(), unrestrictedSafetyConfig(), object.url)).rejects.toBeInstanceOf(AdtNetworkError);
    expect(activationCalls()).toHaveLength(1);
  });

  it.each([
    [503, 'temporarily unavailable'],
    [500, 'database connection is not open'],
    [429, 'too many requests'],
  ])('does not replay an activation after HTTP %i', async (status, body) => {
    mockFetch.mockResolvedValue(mockResponse(status, body, { 'retry-after': '1' }));
    const outcome = activate(client(), unrestrictedSafetyConfig(), object.url).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcome).toBeInstanceOf(AdtApiError);
    expect(activationCalls()).toHaveLength(1);
  });

  it.each([undefined, 'client cancelled', new Error('client cancelled')])(
    'stops before SAP for cancellation reason %s',
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      await expect(
        requestContext.run({ requestId: 'cancel-before-activation', signal: controller.signal }, () =>
          activate(client(), unrestrictedSafetyConfig(), object.url),
        ),
      ).rejects.toMatchObject({ name: 'AdtNetworkError', cause: { name: 'AbortError' } });
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'client cancelled', new Error('client cancelled')])(
    'cancels an in-flight activation with reason %s without replay',
    async (reason) => {
      const controller = new AbortController();
      mockFetch.mockImplementationOnce(delayedResponse(130_000, ''));
      const outcome = requestContext
        .run({ requestId: 'cancel-during-activation', signal: controller.signal }, () =>
          activate(client(), unrestrictedSafetyConfig(), object.url),
        )
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(130_000);
      expect(await outcome).toMatchObject({ name: 'AdtNetworkError', cause: { name: 'AbortError' } });
      expect(activationCalls()).toHaveLength(1);
    },
  );
});
