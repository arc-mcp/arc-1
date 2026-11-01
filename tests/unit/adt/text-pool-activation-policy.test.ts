import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivationOptions } from '../../../src/adt/devtools.js';
import type { AdtHttpClient as Http } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (original) => ({ ...(await original<typeof import('undici')>()), fetch: mockFetch }));
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { withLockedMutation } = await import('../../../src/adt/crud.js');
const { activate } = await import('../../../src/adt/devtools.js');
const { pinnedTextPoolActivationOptions } = await import('../../../src/adt/pinned-text-pool-activation.js');
const pool = '/sap/bc/adt/textelements/programs/ZTEXT';
const success =
  '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>';
const activationCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/activation?'));
let response = success;
beforeEach(() => {
  response = success;
  mockFetch.mockReset().mockImplementation(async (url: string, request: RequestInit) => {
    if (request.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (url.includes('_action=LOCK'))
      return mockResponse(200, '<DATA><LOCK_HANDLE>pool-lock</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL><CORRNR/></DATA>', {}, [
        'sap-contextid=owner; Path=/',
      ]);
    return mockResponse(200, url.includes('/activation?') ? response : '');
  });
});
function fixture() {
  const safety = {
    ...defaultSafetyConfig(),
    allowWrites: true,
    multiTargetWrite: {
      target: 'A4H/001',
      enabled: true,
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  const http = new AdtHttpClient({ baseUrl: 'https://sap.example', username: 'writer', password: 'fixture' });
  const controller = new AbortController();
  const context = pinnedMutationContext(
    safety,
    { deadline: Date.now() + 300_000, signal: controller.signal },
    { unlockFailed: false },
  );
  const run = (afterUnlock: (session: Http) => Promise<void>) =>
    withLockedMutation(
      http,
      safety,
      context,
      pool,
      {
        beforeLock: () => {},
        validateLock: async () => {},
        afterUnlock,
      },
      async () => {},
    );
  return { http, safety, context, controller, run };
}

describe('internal exact-pool activation grants', () => {
  it('requires the owning post-unlock phase and refuses a stale borrowed session', async () => {
    const { http, safety, run } = fixture();
    const validate = vi.fn(),
      submit = vi.fn();
    expect(() => pinnedTextPoolActivationOptions(http, safety, 'PROG', 'ZTEXT', validate, submit)).toThrow(
      'post-unlock',
    );
    expect(mockFetch).not.toHaveBeenCalled();
    let saved!: { session: Http; options: ActivationOptions };
    await run(async (session) => {
      saved = { session, options: pinnedTextPoolActivationOptions(session, safety, 'PROG', 'ZTEXT', validate, submit) };
    });
    const count = mockFetch.mock.calls.length;
    await expect(activate(saved.session, safety, pool, saved.options)).rejects.toThrow('post-unlock');
    expect(mockFetch).toHaveBeenCalledTimes(count);
    expect(validate).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits only the exact pool once after validation, with native execution evidence', async () => {
    const { safety, run } = fixture();
    const order: string[] = [];
    await run(async (session) => {
      const options = pinnedTextPoolActivationOptions(
        session,
        safety,
        'PROG',
        'ZTEXT',
        async () => {
          order.push('validate');
        },
        () => {
          order.push('submit');
        },
      );
      expect((await activate(session, safety, pool, options)).success).toBe(true);
      await expect(activate(session, safety, pool, options)).rejects.toThrow('validation context');
    });
    expect(order).toEqual(['validate', 'submit']);
    expect(activationCalls()).toHaveLength(1);
    const [url, request] = activationCalls()[0];
    expect(new URL(String(url)).searchParams.get('preauditRequested')).toBe('false');
    expect(request.body).toContain(`adtcore:uri="${pool}"`);
    expect(String(request.body).match(/<adtcore:objectReference /g)).toHaveLength(1);
    expect(new Headers(request.headers).get('Cookie')).toContain('sap-contextid=owner');
  });

  it.each(['plain', 'clone', 'foreign-uri', 'other-session'] as const)(
    'refuses %s without activation',
    async (fault) => {
      const { http, safety, run } = fixture();
      const validate = vi.fn(),
        submit = vi.fn();
      await run(async (session) => {
        const options = pinnedTextPoolActivationOptions(session, safety, 'PROG', 'ZTEXT', validate, submit);
        await expect(
          activate(
            fault === 'other-session' ? http : session,
            safety,
            fault === 'foreign-uri' ? '/sap/bc/adt/oo/classes/zforeign' : pool,
            fault === 'plain'
              ? { preaudit: false, validateReferences: validate }
              : fault === 'clone'
                ? { ...options }
                : options,
          ),
        ).rejects.toThrow('validation context');
      });
      expect(activationCalls()).toHaveLength(0);
      expect(validate).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each(['drift', 'cancellation'] as const)(
    'stops %s during fresh owner validation before submission',
    async (fault) => {
      const { safety, run, controller } = fixture();
      const submit = vi.fn();
      await expect(
        run(async (session) => {
          const options = pinnedTextPoolActivationOptions(
            session,
            safety,
            'PROG',
            'ZTEXT',
            async () => {
              if (fault === 'drift') throw new Error('owner changed');
              controller.abort();
            },
            submit,
          );
          await activate(session, safety, pool, options);
        }),
      ).rejects.toThrow();
      expect(activationCalls()).toHaveLength(0);
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it('does not follow a preaudit expansion or accept an empty success body', async () => {
    const { safety, run } = fixture();
    for (const body of [
      '',
      '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zforeign" adtcore:name="ZFOREIGN"/></ioc:object></ioc:entry></ioc:inactiveObjects>',
    ]) {
      response = body;
      await run(async (session) => {
        const options = pinnedTextPoolActivationOptions(
          session,
          safety,
          'PROG',
          'ZTEXT',
          async () => {},
          () => {},
        );
        if (body === '')
          await expect(activate(session, safety, pool, options)).rejects.toThrow('Cannot verify malformed');
        else expect((await activate(session, safety, pool, options)).success).toBe(false);
      });
    }
    expect(activationCalls()).toHaveLength(2);
    expect(activationCalls().every(([, request]) => !String(request.body).includes('zforeign'))).toBe(true);
  });
});
