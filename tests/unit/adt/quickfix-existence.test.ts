import { expect, it, vi } from 'vitest';
import { applyFixProposal, getFixProposals } from '../../../src/adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const proposal = {
  uri: '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable',
  type: 'quickfix/proposal',
  name: 'Declare variable',
  description: 'Declare variable',
  userContent: '',
};

function setup() {
  const get = vi.fn().mockResolvedValue({ body: '<metadata/>' });
  const post = vi.fn().mockResolvedValue({ body: '<evaluationResults/>' });
  const http = { get, post } as unknown as AdtHttpClient;
  const evaluate = (uri: string) => getFixProposals(http, defaultSafetyConfig(), uri, 'unsaved source', 2, 4);
  return { get, post, http, evaluate };
}

it.each(['classes/zcl_missing', 'interfaces/zif_missing'])(
  'rejects an absent OO owner before evaluation: %s',
  async (object) => {
    const { get, post, evaluate } = setup();
    const owner = `/sap/bc/adt/oo/${object}`;
    const error = new AdtApiError('Resource does not exist', 404, owner);
    get.mockRejectedValue(error);
    await expect(evaluate(`${owner}/source/main`)).rejects.toBe(error);
    expect(error.extraHint).toContain('Quick-fix request was not sent');
    expect(get).toHaveBeenCalledExactlyOnceWith(owner);
    expect(post).not.toHaveBeenCalled();
  },
);

it('refuses a stale proposal when its class was deleted after evaluation', async () => {
  const { get, post, http } = setup();
  const owner = '/sap/bc/adt/oo/classes/zcl_deleted';
  const error = new AdtApiError('Resource does not exist', 404, owner);
  get.mockRejectedValue(error);
  await expect(
    applyFixProposal(http, unrestrictedSafetyConfig(), proposal, `${owner}/source/main`, 'source', 2, 4),
  ).rejects.toBe(error);
  expect(error.extraHint).toContain('Quick-fix request was not sent');
  expect(get).toHaveBeenCalledExactlyOnceWith(owner);
  expect(post).not.toHaveBeenCalled();
});

it('checks an existing owner before applying an unchanged proposal', async () => {
  const { get, post, http } = setup();
  const owner = '/sap/bc/adt/oo/classes/zcl_test';
  await applyFixProposal(http, unrestrictedSafetyConfig(), proposal, `${owner}/source/main`, 'source', 2, 4);
  expect(get).toHaveBeenCalledExactlyOnceWith(owner);
  expect(get.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]!);
  expect(post.mock.calls[0]![0]).toBe(proposal.uri);
});

it('applies write and proposal-URI gates before reading metadata', async () => {
  const { get, post, http } = setup();
  const uri = '/sap/bc/adt/oo/classes/zcl_test/source/main';
  await expect(applyFixProposal(http, defaultSafetyConfig(), proposal, uri, 'source', 2, 4)).rejects.toThrow(
    'blocked by safety configuration',
  );
  await expect(
    applyFixProposal(http, unrestrictedSafetyConfig(), { ...proposal, uri: '/unrelated' }, uri, 'source', 2, 4),
  ).rejects.toThrow('non-quickfix proposal URI');
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it.each([
  ['classes/zcl_inactive', 'source/main'],
  ['classes/%2FNS%2FCL_TEST', 'includes/testclasses'],
  ['interfaces/zif_test', 'source/main'],
])('checks only owner metadata and evaluates the unchanged buffer: %s/%s', async (object, suffix) => {
  const { get, post, evaluate } = setup();
  const owner = `/sap/bc/adt/oo/${object}`;
  const uri = `${owner}/${suffix}`;
  await evaluate(uri);
  expect(get).toHaveBeenCalledExactlyOnceWith(owner);
  expect(post).toHaveBeenCalledExactlyOnceWith(
    `/sap/bc/adt/quickfixes/evaluation?uri=${encodeURIComponent(`${uri}#start=2,4`)}`,
    'unsaved source',
    'application/*',
    { Accept: 'application/*' },
  );
});

it.each([401, 403, 406, 500])('propagates a metadata %i without evaluating or claiming absence', async (status) => {
  const { get, post, evaluate } = setup();
  const error = new AdtApiError('Failure', status, '/metadata');
  get.mockRejectedValue(error);
  await expect(evaluate('/sap/bc/adt/oo/classes/zcl_test/source/main')).rejects.toBe(error);
  expect(error.extraHint).toBeUndefined();
  expect(post).not.toHaveBeenCalled();
});

it.each(['%2e%2e', '%252fadmin', 'zcl_test\\..', 'zcl_test%00'])(
  'rejects an ambiguous owner path before the metadata request: %s',
  async (name) => {
    const { get, post, evaluate } = setup();
    await expect(evaluate(`/sap/bc/adt/oo/classes/${name}/source/main`)).rejects.toBeInstanceOf(AdtSafetyError);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  },
);

it('preserves evaluation without a repository object for programs', async () => {
  const { get, post, evaluate } = setup();
  await evaluate('/sap/bc/adt/programs/programs/zunsaved/source/main');
  expect(get).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledOnce();
});

it.each([404, 406])('retains the unsupported evaluation endpoint fallback for %i', async (status) => {
  const { get, post, evaluate } = setup();
  post.mockRejectedValue(new AdtApiError('Unavailable', status, '/sap/bc/adt/quickfixes/evaluation'));
  await expect(evaluate('/sap/bc/adt/oo/classes/zcl_test/source/main')).resolves.toEqual([]);
  expect(get).toHaveBeenCalledOnce();
});
