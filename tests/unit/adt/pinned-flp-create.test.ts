import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { executePinnedFlpMutation, parsePinnedFlpMutation } from '../../../src/adt/pinned-flp.js';
import { flpEntityPath, PINNED_FLP_ENTITY_LIMIT } from '../../../src/adt/pinned-flp-entity.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

// Sanitized native GET evidence; POST and state transitions below are explicit offline mocks.
const lookup = JSON.parse(
  readFileSync(new URL('../../fixtures/flp/cust-resource-lookup-604.json', import.meta.url), 'utf8'),
);
const safety = {
  ...defaultSafetyConfig(),
  allowWrites: true,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
const catalog = {
  id: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
  domainId: 'ZCAT',
  title: 'New',
  type: 'CATALOG_PAGE',
  scope: 'CUSTOMIZING',
  isReadOnly: '',
};
const group = {
  id: 'ZGROUP',
  title: 'New',
  catalogId: '/UI2/FLPD_CATALOG',
  layout: '',
  scope: 'CUSTOMIZING',
  isReadOnly: '',
  isCatalogPage: '',
};
const plans = [
  { args: { action: 'flp_create_catalog', domainId: 'ZCAT', title: 'New' }, entity: catalog, set: 'Catalogs' as const },
  { args: { action: 'flp_create_group', groupId: 'ZGROUP', title: 'New' }, entity: group, set: 'Pages' as const },
];
const response = (entity: unknown) => ({ statusCode: 200, headers: {}, body: JSON.stringify({ d: entity }) });
const unresolved = (path: string, body: unknown = lookup, status = 404) =>
  new AdtApiError('lookup failed', status, path, JSON.stringify(body));

function fixture(
  plan = plans[0],
  overrides: {
    before?: unknown;
    post?: unknown;
    after?: unknown;
    signal?: AbortSignal;
    budget?: DataResponseBudget;
  } = {},
) {
  const path = flpEntityPath(plan.set, plan.entity.id);
  const calls: Array<{ method: string; path: string; body?: string; options?: AdtRequestOptions }> = [];
  const reply = (value: unknown) => {
    if (value instanceof Error) throw value;
    return value;
  };
  let gets = 0;
  const http = {
    get: vi.fn(async (url: string, _headers: unknown, options?: AdtRequestOptions) => {
      calls.push({ method: 'GET', path: url, options });
      return reply(gets++ === 0 ? (overrides.before ?? unresolved(path)) : (overrides.after ?? response(plan.entity)));
    }),
    post: vi.fn(
      async (url: string, body?: string, _type?: unknown, _headers?: unknown, options?: AdtRequestOptions) => {
        calls.push({ method: 'POST', path: url, body, options });
        return reply(overrides.post ?? response(plan.entity));
      },
    ),
    delete: vi.fn(async () => ({ statusCode: 204, headers: {}, body: '' })),
  };
  const context = pinnedMutationContext(
    safety,
    { deadline: Date.now() + 60000, signal: overrides.signal, responseBudget: overrides.budget },
    { unlockFailed: false },
  );
  return {
    http,
    calls,
    context,
    path,
    run: () => executePinnedFlpMutation(http as unknown as AdtHttpClient, safety, context, plan.args),
  };
}

describe('private native create-only FLP candidate', () => {
  it.each(plans)(
    'uses one bounded POST and fresh owned readback for $set, without asserting prior absence',
    async (plan) => {
      const f = fixture(plan);
      const result = await f.run();
      expect(result).toMatchObject({
        ok: true,
        state: 'created',
        phase: 'readback',
        priorExistence: 'unknown',
        recording: 'not-established',
        retryable: false,
      });
      expect(f.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
      expect(f.calls.filter((c) => c.method === 'GET').every((c) => c.path === f.path)).toBe(true);
      expect(
        f.calls.every(
          (c) =>
            c.options?.noReplay === true &&
            c.options?.retryTransientErrors === false &&
            c.options?.deadline === f.context.requestPolicy.deadline &&
            c.options?.responseBudget?.countAllResponses,
        ),
      ).toBe(true);
      expect(JSON.parse(f.calls[1].body!)).toEqual(
        plan.set === 'Catalogs'
          ? { domainId: 'ZCAT', title: 'New', type: 'CATALOG_PAGE' }
          : { id: 'ZGROUP', title: 'New', catalogId: '/UI2/FLPD_CATALOG', layout: '' },
      );
    },
  );

  it.each(plans)('refuses an existing $set key, including readonly content, before POST', async (plan) => {
    const f = fixture(plan, { before: response({ ...plan.entity, isReadOnly: 'X', scope: 'CONFIGURATION' }) });
    expect(await f.run()).toMatchObject({
      ok: false,
      state: 'unchanged',
      phase: 'preflight',
      message: expect.stringContaining('already exists'),
    });
    expect(f.http.post).not.toHaveBeenCalled();
  });

  it.each([
    ['generic404', { error: { code: '005056A509B11EE1B9A8FEC11C21D78E' } }],
    [
      'wrong service',
      {
        error: {
          ...lookup.error,
          innererror: {
            ...lookup.error.innererror,
            application: { ...lookup.error.innererror.application, service_id: 'PAGE_BUILDER_CONF' },
          },
        },
      },
    ],
    [
      'missing application',
      { error: { ...lookup.error, innererror: { errordetails: lookup.error.innererror.errordetails } } },
    ],
    [
      'mixed authorization details',
      {
        error: {
          ...lookup.error,
          innererror: {
            ...lookup.error.innererror,
            errordetails: [...lookup.error.innererror.errordetails, { code: '/UI2/FND/607', severity: 'error' }],
          },
        },
      },
    ],
    ['wrong code', { error: { ...lookup.error, code: '/UI2/FND/401' } }],
    ['unknown error shape', []],
  ])('does not submit after %s', async (_label, body) => {
    const f = fixture();
    f.http.get.mockRejectedValueOnce(unresolved(f.path, body));
    expect(await f.run()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(f.http.post).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])('preserves unrelated HTTP%s before mutation even with the604 envelope', async (status) => {
    const f = fixture();
    f.http.get.mockRejectedValueOnce(unresolved(f.path, lookup, status));
    expect(await f.run()).toMatchObject({ state: 'unchanged', statusCode: status });
    expect(f.http.post).not.toHaveBeenCalled();
  });

  it.each(['foreign path', 'malformed JSON', 'oversized error', 'oversized entity', 'mismatched entity'])(
    'fails closed on %s',
    async (kind) => {
      const f = fixture();
      const failure =
        kind === 'foreign path'
          ? unresolved(flpEntityPath('Pages', 'OTHER'))
          : kind === 'malformed JSON'
            ? new AdtApiError('bad', 404, f.path, '{')
            : kind === 'oversized error'
              ? new AdtApiError('big', 404, f.path, JSON.stringify(lookup) + ' '.repeat(PINNED_FLP_ENTITY_LIMIT))
              : kind === 'oversized entity'
                ? response({ ...catalog, opaque: 'x'.repeat(PINNED_FLP_ENTITY_LIMIT) })
                : response({ ...catalog, id: 'OTHER' });
      if (failure instanceof Error) f.http.get.mockRejectedValueOnce(failure);
      else f.http.get.mockResolvedValueOnce(failure);
      expect(await f.run()).toMatchObject({ state: 'unchanged' });
      expect(f.http.post).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 404, 409, 412, 415, 422, 423, 429, 500])(
    'retains possible partial changes for a submitted HTTP%s, including duplicates',
    async (status) => {
      const f = fixture(plans[0], {
        post: new AdtApiError('native error', status, '/Catalogs', '{"error":{"code":"/UI2/FND/605"}}'),
      });
      expect(await f.run()).toMatchObject({
        ok: false,
        state: 'create-unconfirmed',
        phase: 'write',
        priorExistence: 'unknown',
        retryable: false,
        statusCode: status,
      });
      expect(f.http.post).toHaveBeenCalledTimes(1);
      expect(f.http.get).toHaveBeenCalledTimes(1);
    },
  );

  it.each(plans)(
    'does not retry $set on a lost response or infer that native duplicate protection failed',
    async (plan) => {
      const f = fixture(plan, { post: new AdtNetworkError('lost') });
      expect(await f.run()).toMatchObject({ state: 'create-unconfirmed', retryable: false });
      expect(f.http.post).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['wrong id', { ...catalog, id: 'OTHER' }],
    ['wrong domain', { ...catalog, domainId: 'OTHER' }],
    ['wrong title', { ...catalog, title: 'Other' }],
    ['unknown type', { ...catalog, type: 'REMOTE' }],
    ['foreign scope', { ...catalog, scope: 'CONFIGURATION' }],
    ['missing flag', { ...catalog, isReadOnly: undefined }],
  ])('keeps an accepted catalog unconfirmed after %s in readback', async (_label, stored) => {
    const f = fixture(plans[0], { after: response(stored) });
    expect(await f.run()).toMatchObject({ state: 'create-unconfirmed', phase: 'readback' });
    expect(f.http.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...group, catalogId: 'OTHER' },
    { ...group, isCatalogPage: 'X' },
    { ...group, isReadOnly: undefined },
    { ...group, scope: undefined },
    { ...group, layout: 'other' },
  ])('refuses a nonmatching created group', async (stored) => {
    const f = fixture(plans[1], { after: response(stored) });
    expect(await f.run()).toMatchObject({ state: 'create-unconfirmed', phase: 'readback' });
    expect(f.http.post).toHaveBeenCalledTimes(1);
  });

  it('does not convert a second604 into successful creation or deletion', async () => {
    const f = fixture();
    f.http.get.mockRejectedValueOnce(unresolved(f.path)).mockRejectedValueOnce(unresolved(f.path));
    expect(await f.run()).toMatchObject({ state: 'create-unconfirmed', phase: 'readback' });
    const d = fixture();
    d.http.get.mockResolvedValueOnce(response(catalog)).mockRejectedValueOnce(unresolved(d.path));
    expect(
      await executePinnedFlpMutation(d.http as unknown as AdtHttpClient, safety, d.context, {
        action: 'flp_delete_catalog',
        catalogId: 'ZCAT',
      }),
    ).toMatchObject({ state: 'delete-unconfirmed', phase: 'readback' });
    expect(d.http.delete).toHaveBeenCalledTimes(1);
  });

  it.each([
    response({ ...catalog, id: 'OTHER' }),
    response({ ...catalog, title: 'Other' }),
    response({ ...catalog, domainId: 'OTHER' }),
    response({ ...catalog, scope: 'CONFIGURATION' }),
    response({ ...catalog, opaque: 'x'.repeat(PINNED_FLP_ENTITY_LIMIT) }),
    { statusCode: 201, headers: {}, body: 'not JSON' },
  ])('rejects an unrecognized POST body without another write', async (post) => {
    const f = fixture(plans[0], { post });
    expect(await f.run()).toMatchObject({ ok: false, state: 'create-unconfirmed' });
    expect(f.http.post).toHaveBeenCalledTimes(1);
    expect(f.http.get).toHaveBeenCalledTimes(1);
  });

  it('carries an existing cumulative budget and cancellation through the shared native helpers', async () => {
    const budget = new DataResponseBudget(1000, 'outer', true);
    const control = new AbortController();
    const f = fixture(plans[0], { signal: control.signal, budget });
    f.http.post.mockImplementationOnce(async () => {
      control.abort();
      return response(catalog);
    });
    expect(await f.run()).toMatchObject({ state: 'create-unconfirmed' });
    expect(f.http.get).toHaveBeenCalledTimes(1);
    expect(f.calls[0].options?.responseBudget).toBe(budget);
  });

  it('stops before POST when the unresolved read consumes the remaining deadline', async () => {
    const f = fixture();
    f.http.get.mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(f.context.requestPolicy.deadline + 1);
      throw unresolved(f.path);
    });
    try {
      expect(await f.run()).toMatchObject({ ok: false, state: 'unchanged', phase: 'preflight' });
      expect(f.http.post).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('does not expose native error bodies or network diagnostics in outcomes', async () => {
    const f = fixture(plans[0], { post: new AdtNetworkError('PRIVATE_DIAGNOSTIC_TOKEN') });
    const result = await f.run();
    expect(result).toMatchObject({ state: 'create-unconfirmed' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DIAGNOSTIC_TOKEN');
  });

  it('enforces the native create lengths while keeping other ID operations compatible', () => {
    expect(() =>
      parsePinnedFlpMutation({ action: 'flp_create_catalog', domainId: 'Z'.repeat(36), title: 'x' }),
    ).toThrow('35');
    expect(() =>
      parsePinnedFlpMutation({ action: 'flp_create_group', groupId: `/NAMESPACE/${'Z'.repeat(60)}`, title: 'x' }),
    ).toThrow('70');
    expect(() => parsePinnedFlpMutation({ action: 'flp_delete_catalog', catalogId: 'Z'.repeat(36) })).not.toThrow();
  });
});
