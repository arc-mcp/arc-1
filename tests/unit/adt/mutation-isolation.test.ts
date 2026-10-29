import { expect, it, vi } from 'vitest';
import { updateSource, withLockedMutation } from '../../../src/adt/crud.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { mutationHttp } from '../../../src/adt/mutation-http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');

it('isolates overlapping users, targets, cancellation and owning-session cleanup', async () => {
  const requests: Array<{ target: string; url: string; method: string; headers: Record<string, string> }> = [];
  let unlockBarrier!: () => void;
  const bothLocked = new Promise<void>((resolve) => {
    unlockBarrier = resolve;
  });
  let locked = 0;
  mockFetch.mockImplementation(async (url: string, options) => {
    const target = new URL(url).hostname.split('.')[0]!;
    requests.push({ target, url, method: options.method, headers: { ...options.headers } });
    if (options.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': `csrf-${target}` });
    if (url.includes('_action=LOCK')) {
      if (++locked === 2) unlockBarrier();
      await bothLocked;
      return mockResponse(200, `<DATA><LOCK_HANDLE>lock-${target}</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>`, {}, [
        `sap-contextid=session-${target}; Path=/`,
      ]);
    }
    return mockResponse(200, '');
  });

  const contexts = ['first', 'second'].map((target) => {
    const safety = {
      ...defaultSafetyConfig(),
      allowWrites: true,
      multiTargetWrite: {
        target,
        enabled: true,
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    };
    const controller = new AbortController();
    const cleanup = { unlockFailed: false, sessionClosed: undefined as boolean | undefined };
    const context = pinnedMutationContext(
      safety,
      { deadline: Date.now() + 300_000, signal: controller.signal },
      cleanup,
    );
    const raw = new AdtHttpClient({ baseUrl: `https://${target}.example.com`, username: target, password: 'test' });
    return { safety, controller, cleanup, context, http: mutationHttp(raw, safety, context), target };
  });
  const owner = '/sap/bc/adt/oo/classes/zcl_same';
  const results = await Promise.allSettled(
    contexts.map(({ http, safety, context, controller, target }) =>
      withLockedMutation(
        http,
        safety,
        context,
        owner,
        {
          beforeLock: () => {},
          validateLock: async () => {
            if (target === 'first') controller.abort();
          },
        },
        (session, lock) => updateSource(session, safety, `${owner}/source/main`, target, lock.lockHandle),
      ),
    ),
  );
  expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
  expect(requests.filter((request) => request.method === 'PUT').map((request) => request.target)).toEqual(['second']);
  for (const { target, cleanup } of contexts) {
    expect(cleanup).toEqual({ unlockFailed: false, sessionClosed: true });
    const unlocks = requests.filter((request) => request.target === target && request.url.includes('_action=UNLOCK'));
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]!.headers.Cookie).toContain(`sap-contextid=session-${target}`);
    const close = requests.find((request) => request.target === target && request.url.includes('/core/http/sessions'));
    expect(close?.headers['sap-contextid']).toBe(`session-${target}`);
    expect(
      requests
        .filter((request) => request.target === target)
        .every(
          (request) => request.headers.Authorization === `Basic ${Buffer.from(`${target}:test`).toString('base64')}`,
        ),
    ).toBe(true);
  }
});
