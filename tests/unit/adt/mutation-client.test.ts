import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { mutationClient, mutationResponsible } from '../../../src/adt/mutation-client.js';
import { pinnedMutationContext, singleTargetMutationContext } from '../../../src/adt/mutation-context.js';
import { getMutationContext } from '../../../src/adt/mutation-http.js';
import { pinnedRecording, resolvePinnedRequest, validatePinnedLock } from '../../../src/adt/pinned-write-policy.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const reply = (body = 'REPORT zdemo.') => ({ body, statusCode: 200, headers: {} });
function setup() {
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    username: 'unverified@example.com',
    safety: {
      ...unrestrictedSafetyConfig(),
      multiTargetWrite: {
        enabled: true,
        target: 'DEV/001',
        allowedPackages: ['ZROOT/**'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  const controller = new AbortController();
  const context = pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 300_000, signal: controller.signal },
    { unlockFailed: false },
  );
  return { client, context, controller };
}

describe('mutation client adapter', () => {
  it('binds existing readers without changing the original client, identity or cache fields', async () => {
    const { client, context } = setup();
    const get = vi.spyOn(client.http, 'get').mockResolvedValue(reply());
    const bound = mutationClient(client, context);
    expect(bound).toBeInstanceOf(AdtClient);
    expect(bound.http).not.toBe(client.http);
    expect(bound.safety).toBe(client.safety);
    for (const key of Reflect.ownKeys(client))
      if (key !== 'http') expect(Reflect.get(bound, key)).toBe(Reflect.get(client, key));
    expect((await bound.getProgram('ZDEMO')).source).toBe('REPORT zdemo.');
    expect(get.mock.calls[0][2]).toMatchObject(context.requestPolicy);
    expect(getMutationContext(client.http, client.safety)).toBeUndefined();
    expect(getMutationContext(bound.http, bound.safety)).toBe(context);
    expect(mutationClient(bound, context).http).toBe(bound.http);
  });

  it('rejects invented or cross-policy contexts and policy changes on safety clones', () => {
    const { client, context } = setup();
    expect(() => mutationClient(client, { ...context })).toThrow('Missing or mismatched');
    expect(() => mutationClient(client, setup().context)).toThrow('Missing or mismatched');
    const bound = mutationClient(client, context);
    const foreign = bound.withSafety(setup().client.safety);
    expect(() => foreign.getPackageHierarchyResolver()).toThrow('Missing or mismatched');
    expect(() => getMutationContext(bound.http, foreign.safety)).toThrow('Missing or mismatched');
  });

  it('derives fresh package evidence from the registered facade budget without explicit options', async () => {
    const { client, context } = setup();
    const bound = mutationClient(client, context);
    const fetcher = vi
      .spyOn(bound, 'getSubpackages')
      .mockImplementation(async (root) => (root === 'ZROOT' ? ['ZA'] : []));
    const resolver = bound.getPackageHierarchyResolver();
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
    for (const call of fetcher.mock.calls) expect(call[2]).toMatchObject(context.requestPolicy);
    fetcher.mockResolvedValue([]);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(false);
    expect(() => client.getPackageHierarchyResolver()).toThrow('bounded mutation request policy');
    expect(() => bound.getPackageHierarchyResolver({})).toThrow('bounded mutation request policy');
  });

  it('preserves the context through an isolated stateful session and gives cleanup its own budget', async () => {
    const { client, context } = setup();
    const session = new AdtClient({ baseUrl: 'https://sap.example', safety: client.safety });
    const get = vi.spyOn(session.http, 'get').mockResolvedValue(reply());
    const withSession = vi
      .spyOn(client.http, 'withStatefulSession')
      .mockImplementation(async (action) => action(session.http));
    await mutationClient(client, context).withStatefulSession(async (current) => {
      expect(getMutationContext(current.http, current.safety)).toBe(context);
      await current.getProgram('ZDEMO');
    });
    expect(get.mock.calls[0][2]).toMatchObject(context.requestPolicy);
    expect(withSession.mock.calls[0][1]).toMatchObject({ timeoutMs: 30_000, noReplay: true });
  });

  it('omits unverified PP responsibility without consulting JWT or cached identity', async () => {
    const { client, context } = setup();
    const effectiveUser = vi.spyOn(client, 'getEffectiveUser').mockResolvedValue('ALSO_UNVERIFIED');
    const bound = mutationClient(client, context);
    expect(await mutationResponsible(bound, 'idp@example.com')).toBeUndefined();
    expect(await mutationResponsible(bound, '')).toBeUndefined();
    expect(effectiveUser).not.toHaveBeenCalled();
    await expect(mutationResponsible(client, 'idp@example.com')).rejects.toThrow('Missing pinned mutation context');
  });

  it('keeps the single-target client and configured/effective identity behavior unchanged', async () => {
    const client = new AdtClient({ safety: unrestrictedSafetyConfig() });
    const context = singleTargetMutationContext(client.safety);
    const effectiveUser = vi.spyOn(client, 'getEffectiveUser').mockResolvedValue('SAPUSER');
    expect(mutationClient(client, context)).toBe(client);
    expect(await mutationResponsible(client, 'CONFIGURED')).toBe('CONFIGURED');
    expect(effectiveUser).not.toHaveBeenCalled();
    expect(await mutationResponsible(client, '')).toBe('SAPUSER');
  });

  it('refuses missing or weakened recording budgets before native policy lookups', async () => {
    const { client, context } = setup();
    const get = vi.spyOn(client.http, 'get').mockResolvedValue(reply());
    const post = vi.spyOn(client.http, 'post').mockResolvedValue(reply());
    for (const options of [
      undefined,
      {},
      { ...context.requestPolicy, deadline: Infinity },
      { ...context.requestPolicy, noReplay: false },
      { ...context.requestPolicy, retryTransientErrors: true },
    ])
      await expect(resolvePinnedRequest(client.http, client.safety, 'DEVK900001', options)).rejects.toThrow(
        'bounded, non-replayable',
      );
    await expect(pinnedRecording(client.http, client.safety, '/owner', '$TMP', '')).rejects.toThrow(
      'bounded, non-replayable',
    );
    await expect(
      validatePinnedLock(
        client.http,
        client.safety,
        { lockHandle: 'lock', isLocal: true, localityKnown: true, corrNr: '' },
        { local: true },
      ),
    ).rejects.toThrow('bounded, non-replayable');
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
