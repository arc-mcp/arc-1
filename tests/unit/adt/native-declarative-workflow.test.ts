import { beforeEach, expect, it } from 'vitest';
import { declarativeFixtures } from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import {
  type DeclarativeDriver,
  DeclarativeFailure,
  runNativeDeclarativeWorkflow,
} from '../../../scripts/qualification/pr1142/native-declarative-workflow.js';

const fixtures = declarativeFixtures('0123456789ABCDEF');
const calls: string[] = [];
const rows: any[] = [];
let fault = '',
  stopped = false,
  activation = 0,
  attempted = false;
const receipt = { sourceHash: 'a'.repeat(64), metadataHash: 'b'.repeat(64), activeVerified: false };
const role = fixtures.find((f) => f.type === 'DCLS')!;
const behavior = fixtures.find((f) => f.type === 'BDEF')!;
beforeEach(() => {
  calls.length = 0;
  rows.length = 0;
  fault = '';
  stopped = false;
  activation = 0;
  attempted = false;
});
function call(phase: string, owner = '') {
  calls.push(`${phase}:${owner}`);
  if (fault === `${phase}:${owner}`) throw new Error('private diagnostic');
}
const driver: DeclarativeDriver = {
  mutationAttempted() {
    return attempted;
  },
  async preflight() {
    call('preflight');
    if (fault === 'typed-preflight') throw new DeclarativeFailure('absence-not-typed', { status: 404 });
  },
  async create(f) {
    if (fault === `never-sent:${f.owner}`) throw new DeclarativeFailure('create-not-sent', { createNeverSent: true });
    attempted = true;
    if (fault === `sent-unknown:${f.owner}`) throw new DeclarativeFailure('write-unconfirmed');
    call('create', f.owner);
    return { ...receipt };
  },
  async activate(f) {
    call('activate', f.owner);
    activation++;
    if (fault === `second-activation:${f.owner}` && activation % 2 === 0) throw new Error('unknown activation');
    return { ...receipt, activeVerified: true };
  },
  async update(f, prior) {
    expect(prior.activeVerified).toBe(true);
    call('update', f.owner);
    if (fault === `stop-after-update:${f.owner}`) stopped = true;
    return { ...receipt, sourceHash: 'c'.repeat(64) };
  },
  async remove(f) {
    call('delete', f.owner);
    if (fault === `deleted-cleanup:${f.owner}`)
      throw new DeclarativeFailure('deleted-cleanup-unconfirmed', { ownerDeleted: true });
  },
  async finalAbsence() {
    call('final-absence');
  },
  verifySource() {
    if (fault === 'source') throw new Error('changed source');
  },
  shouldStop() {
    return stopped;
  },
  record(value) {
    call('record');
    rows.push(value);
    expect(JSON.stringify(value)).not.toContain('private diagnostic');
  },
};
const unconfirmed = () => rows.filter((row) => row.stage === 'unconfirmed');
it('qualifies each owner before creating dependent owners, then cleans up in reverse dependency order', async () => {
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result).toMatchObject({
    failure: false,
    remaining: [],
    pendingCreation: [],
    inspectionRequired: [],
    cleanupIssues: [],
    finalAbsenceConfirmed: true,
    stopped: false,
  });
  const mutations = calls.filter((c) => /^(create|activate|update|delete):/.test(c));
  expect(mutations).toEqual([
    ...fixtures.flatMap((f) => ['create', 'activate', 'update', 'activate'].map((phase) => `${phase}:${f.owner}`)),
    ...[...fixtures].reverse().map((f) => `delete:${f.owner}`),
  ]);
});
it.each(['create', 'activate', 'update', 'second-activation'])(
  'preserves an uncertain child and its base after %s',
  async (phase) => {
    fault = `${phase}:${role.owner}`;
    const result = await runNativeDeclarativeWorkflow(fixtures, driver);
    expect(result.failure).toBe(true);
    expect(result.inspectionRequired).toEqual(expect.arrayContaining([role.owner, ...role.dependencies]));
    expect(result.finalAbsenceConfirmed).toBe(false);
    expect(calls).not.toContain(`delete:${role.owner}`);
    expect(calls).not.toContain(`delete:${role.dependencies[0]}`);
    expect(calls).toContain(`delete:${fixtures[1].owner}`);
    expect(calls).not.toContain(`create:${behavior.owner}`);
    expect(result.pendingCreation).toEqual(phase === 'create' ? [role.owner] : []);
  },
);
it('preserves parent dependencies after an unconfirmed child deletion', async () => {
  fault = `delete:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result.cleanupIssues).toEqual([role.owner]);
  expect(result.remaining).toEqual(expect.arrayContaining([role.owner, ...role.dependencies]));
  expect(calls).not.toContain(`delete:${role.dependencies[0]}`);
  expect(calls).toContain(`delete:${behavior.owner}`);
});
it.each(['preflight:', 'source'])('performs no mutation when %s preflight fails', async (mode) => {
  fault = mode;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result.failure).toBe(true);
  expect(calls.some((c) => /^(create|activate|update|delete):/.test(c))).toBe(false);
  expect(result.remaining).toEqual([]);
  expect(result.pendingCreation).toEqual([]);
});
it('stops forward and cleanup mutations after an explicit stop', async () => {
  fault = `stop-after-update:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result.stopped).toBe(true);
  expect(calls.filter((c) => c === `activate:${role.owner}`)).toHaveLength(1);
  expect(calls.some((c) => c.startsWith('delete:'))).toBe(false);
  expect(result.finalAbsenceConfirmed).toBe(false);
});
it('does not claim cleanup when final absence cannot be established', async () => {
  fault = 'final-absence:';
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result).toMatchObject({
    failure: true,
    remaining: [],
    cleanupUnconfirmed: true,
    finalAbsenceConfirmed: false,
  });
});
it('does not mutate without a durable preflight intent', async () => {
  fault = 'record:';
  await expect(runNativeDeclarativeWorkflow(fixtures, driver)).rejects.toThrow();
  expect(calls.some((c) => /^(create|activate|update|delete):/.test(c))).toBe(false);
});
it('reports a preflight refusal as no mutation, without cleanup uncertainty, and keeps its fixed reason', async () => {
  fault = 'typed-preflight';
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result).toMatchObject({
    failure: true,
    mutationAttempted: false,
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
    remaining: [],
    pendingCreation: [],
    createNeverSent: [],
  });
  expect(unconfirmed()).toEqual([
    { phase: 'preflight', stage: 'unconfirmed', reason: 'absence-not-typed', status: 404 },
  ]);
});
it('never journals an arbitrary exception message as a reason', async () => {
  fault = `delete:${role.owner}`;
  await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(unconfirmed()).toEqual([{ phase: 'delete', owner: role.owner, stage: 'unconfirmed', reason: 'unclassified' }]);
});
it('releases a never-sent create from uncertainty, so its base can still be cleaned', async () => {
  fault = `never-sent:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result).toMatchObject({
    failure: true,
    mutationAttempted: true,
    createNeverSent: [role.owner],
    pendingCreation: [],
    inspectionRequired: [],
    remaining: [],
    finalAbsenceConfirmed: true,
    cleanupUnconfirmed: false,
  });
  expect(calls).toContain(`delete:${role.dependencies[0]}`);
  expect(unconfirmed()).toEqual([
    { phase: 'create', owner: role.owner, stage: 'unconfirmed', reason: 'create-not-sent' },
  ]);
});
it('keeps a possibly sent create uncertain and preserves its base', async () => {
  fault = `sent-unknown:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result).toMatchObject({
    failure: true,
    createNeverSent: [],
    pendingCreation: [role.owner],
    cleanupUnconfirmed: true,
    finalAbsenceConfirmed: false,
  });
  expect(result.inspectionRequired).toEqual(expect.arrayContaining([role.owner, ...role.dependencies]));
  expect(calls).not.toContain(`delete:${role.dependencies[0]}`);
});
it('separates a confirmed deletion with failed cleanup from owners that remain', async () => {
  fault = `deleted-cleanup:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result.confirmedDeleted).toContain(role.owner);
  expect(result.remaining).toEqual([role.dependencies[0]]);
  expect(result.cleanupIssues).toEqual([role.owner]);
  expect(result.inspectionRequired).toEqual(expect.arrayContaining([role.owner, role.dependencies[0]]));
  expect(calls).not.toContain(`delete:${role.dependencies[0]}`);
  expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true });
});
it('cannot report confirmed cleanup when the only remaining doubt is a deleted owner’s lock', async () => {
  const solo = [fixtures[1]];
  fault = `deleted-cleanup:${solo[0].owner}`;
  const result = await runNativeDeclarativeWorkflow(solo, driver);
  expect(result).toMatchObject({
    failure: true,
    remaining: [],
    pendingCreation: [],
    finalAbsenceConfirmed: true,
    cleanupIssues: [solo[0].owner],
    cleanupUnconfirmed: true,
  });
});
it('reports owners skipped by a stop as not attempted rather than failed deletions', async () => {
  fault = `stop-after-update:${role.owner}`;
  const result = await runNativeDeclarativeWorkflow(fixtures, driver);
  expect(result.cleanupIssues).toEqual([]);
  // The stopped child and its view are preserved by closure; only the unrelated owner reaches the refused intent.
  expect(result.cleanupNotAttempted).toEqual([fixtures[1].owner]);
  expect(result.remaining).toEqual([fixtures[0].owner, fixtures[1].owner, role.owner]);
  expect(result).toMatchObject({ stopped: true, failure: true, cleanupUnconfirmed: true });
  expect(rows.filter((row) => row.stage === 'not-attempted').every((row) => row.reason === 'stopped')).toBe(true);
});

it('refuses binding drift during the last absence await while preserving every confirmed deletion', async () => {
  const result = await runNativeDeclarativeWorkflow(fixtures, {
    ...driver,
    finalAbsence: async () => {
      fault = 'source';
    },
  });
  expect(result).toMatchObject({
    failure: true,
    finalAbsenceConfirmed: false,
    cleanupUnconfirmed: true,
    remaining: [],
  });
  expect(result.confirmedDeleted).toEqual([...fixtures].reverse().map((f) => f.owner));
  expect(result.inspectionRequired).toEqual(fixtures.map((f) => f.owner));
});
