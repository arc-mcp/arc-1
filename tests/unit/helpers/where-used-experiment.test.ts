import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  BASELINE,
  call,
  checkTarget,
  cleanupPair,
  createOwned,
  type Manifest,
  type Pair,
  preparePair,
  recordDescriptions,
  recordError,
  selectRetention,
  snapshotIndex,
} from '../../helpers/where-used-experiment.js';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), write: vi.fn(), rename: vi.fn() }));
vi.mock('../../../src/handlers/dispatch.js', () => ({ handleToolCall: mocks.dispatch }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  mkdirSync: vi.fn(),
  writeFileSync: mocks.write,
  renameSync: mocks.rename,
}));
function pair(suffix = 'EXAMPLE01'): Pair {
  return {
    root: `ZAR1057_ROOT_${suffix}`,
    consumer: `ZAR1057_USE_${suffix}`,
    absentBeforeCreate: false,
    attempts: [],
    conflicts: [],
    outcome: 'setup',
    cleanup: {},
  };
}
function state(value: Pair): Manifest {
  return { baseline: BASELINE, startedUtc: '2026-11-01T00:00:00Z', pairs: [value], trialFailures: 0 };
}
function fakeClient() {
  return {
    safety: { ...defaultSafetyConfig(), allowWrites: true },
    http: { get: vi.fn().mockRejectedValue({ statusCode: 404 }), post: vi.fn() },
    getInstalledComponents: vi.fn(),
    runTableQuery: vi.fn(),
  } as unknown as AdtClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('bounded owned-pair research lifecycle', () => {
  it('checks both metadata resources before registering either create', async () => {
    const p = pair();
    const client = fakeClient();
    const s = state(p);
    await preparePair(client, s, p);
    expect(client.http.get).toHaveBeenCalledTimes(2);
    expect(p.absentBeforeCreate).toBe(true);
    mocks.dispatch.mockImplementation(async () => {
      const saved = JSON.parse(mocks.write.mock.calls.at(-1)![1]);
      expect(saved.pairs[0].attempts).toEqual([p.root]);
      return { content: [{ type: 'text', text: '{}' }] };
    });
    await createOwned(client, s, p, p.root, 'owned source');
    expect(mocks.dispatch.mock.calls.map((args) => args[2])).toEqual(['SAPWrite', 'SAPActivate']);
  });
  it('refuses a pre-existing consumer before any mutation', async () => {
    const p = pair();
    const client = fakeClient();
    vi.mocked(client.http.get)
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({} as never);
    await expect(preparePair(client, state(p), p)).rejects.toMatchObject({ kind: 'ownership' });
    expect(p.attempts).toEqual([]);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('never deletes a name after an explicit create conflict', async () => {
    const p = pair();
    p.absentBeforeCreate = true;
    const client = fakeClient();
    const s = state(p);
    mocks.dispatch.mockResolvedValue({
      isError: true,
      content: [{ text: 'ADT API error: status 409. Category: object-exists.' }],
    });
    await expect(createOwned(client, s, p, p.root, 'source')).rejects.toMatchObject({ kind: 'conflict' });
    expect(await cleanupPair(client, s, p, 0)).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(p.cleanup[p.root]).toBe('conflict-refused');
  });
  it('cleans a registered partial create through SAPWrite and verifies 404', async () => {
    const p = pair();
    p.absentBeforeCreate = true;
    p.attempts = [p.root];
    const client = fakeClient();
    vi.mocked(client.http.get).mockResolvedValueOnce({} as never);
    expect(await cleanupPair(client, state(p), p, 0)).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledWith(client, expect.anything(), 'SAPWrite', {
      action: 'delete',
      type: 'CLAS',
      name: p.root,
    });
    expect(p.cleanup[p.root]).toBe('absent');
    expect(client.http.get).toHaveBeenCalledTimes(2);
  });
  it('refuses unowned names and a widened package allowlist', async () => {
    const p = pair();
    p.absentBeforeCreate = true;
    p.attempts = ['CL_STANDARD'];
    const client = fakeClient();
    await expect(cleanupPair(client, state(p), p, 0)).rejects.toMatchObject({ kind: 'ownership' });
    p.attempts = [p.root];
    client.safety.allowedPackages = ['*'];
    await expect(cleanupPair(client, state(p), p, 0)).rejects.toMatchObject({ kind: 'ownership' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('retries lock-only cleanup errors while preserving the test outcome', async () => {
    vi.useFakeTimers();
    const p = pair();
    p.absentBeforeCreate = true;
    p.attempts = [p.root];
    p.outcome = 'ordinary-scoped-failure';
    const client = fakeClient();
    vi.mocked(client.http.get)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({} as never);
    mocks.dispatch.mockResolvedValueOnce({ isError: true, content: [{ text: 'ADT API error: status 423.' }] });
    const cleanup = cleanupPair(client, state(p), p, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await cleanup).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(p.outcome).toBe('ordinary-scoped-failure');
  });
  it('does not retry a general cleanup failure', async () => {
    const p = pair();
    p.absentBeforeCreate = true;
    p.attempts = [p.root];
    const client = fakeClient();
    vi.mocked(client.http.get).mockResolvedValue({} as never);
    mocks.dispatch.mockResolvedValue({ isError: true, content: [{ text: 'private backend error' }] });
    expect(await cleanupPair(client, state(p), p, 100)).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('private backend error');
  });
  it('retains only one passing and one matching failing pair', () => {
    const first = pair();
    const s = state(first);
    const cases = [first, pair('EXAMPLE02'), pair('EXAMPLE03'), pair('EXAMPLE04')];
    s.pairs = cases;
    for (const [index, p] of cases.entries()) {
      p.activatedAt = 1;
      p.indexOk = true;
      p.activeSourcesMatch = true;
      p.outcome = index < 2 ? 'passed' : index === 2 ? 'ordinary-scoped-failure' : 'other-failure';
      selectRetention(s, p);
    }
    expect(cases.map((p) => p.retain)).toEqual(['control', undefined, 'failure', undefined]);
  });
  it('preserves an activated failure despite missing diagnostics but rejects unexpected source', () => {
    const p = pair();
    const s = state(p);
    p.outcome = 'ordinary-scoped-failure';
    selectRetention(s, p);
    expect(p.retain).toBeUndefined();
    p.activatedAt = 1;
    p.indexOk = false;
    selectRetention(s, p);
    expect(p.retain).toBe('failure');
    p.retain = undefined;
    p.indexOk = true;
    p.activeSourcesMatch = false;
    selectRetention(s, p);
    expect(p.retain).toBeUndefined();
  });
  it('rejects the wrong configured target before a native request', async () => {
    vi.stubEnv('TEST_SAP_URL', 'https://other.invalid');
    const client = fakeClient();
    await expect(checkTarget(client)).rejects.toMatchObject({ kind: 'target' });
    expect(client.getInstalledComponents).not.toHaveBeenCalled();
  });
  it('includes component keys and excludes unrelated identifying columns from snapshots', async () => {
    const p = pair();
    const client = fakeClient();
    vi.mocked(client.runTableQuery).mockResolvedValue({
      columns: ['NAME', 'INCLUDE'],
      rows: [{ NAME: `${p.root}\\DA:MARKER`, INCLUDE: 'UNRELATED_INCLUDE', UNAME: 'PRIVATE_USER' }],
    });
    await snapshotIndex(client, p, 'unit');
    const queries = vi.mocked(client.runTableQuery).mock.calls;
    expect(queries).toHaveLength(7);
    expect(queries.find(([table]) => table === 'WBCROSSGT')?.[1]?.where).toEqual([
      { field: 'NAME', op: 'LIKE', value: `${p.root}%` },
    ]);
    const saved = JSON.stringify(mocks.write.mock.calls);
    expect(saved).toContain('MARKER');
    expect(saved).not.toContain('PRIVATE_USER');
    expect(saved).not.toContain('UNRELATED_INCLUDE');
    for (const [, options] of queries) expect(options?.columns).not.toEqual(expect.arrayContaining(['UNAME']));
  });
  it('keeps completed index reads when a later query fails without publishing its error', async () => {
    const p = pair();
    const client = fakeClient();
    vi.mocked(client.runTableQuery)
      .mockResolvedValueOnce({ columns: ['PROGNAME'], rows: [{ PROGNAME: `${p.root}==CP` }] })
      .mockRejectedValueOnce(new Error('private query failure'));
    await expect(snapshotIndex(client, p, 'partial')).rejects.toThrow('private query failure');
    const saved = JSON.parse(mocks.write.mock.calls.at(-1)![1]);
    expect(saved.complete).toBe(false);
    expect(saved.reads).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain('private query failure');
  });
  it('excludes SQL LIKE underscore wildcard matches outside the exact owned prefix', async () => {
    const p = pair();
    const client = fakeClient();
    vi.mocked(client.runTableQuery).mockResolvedValue({
      columns: ['NAME'],
      rows: [{ NAME: p.root.replaceAll('_', 'X') }],
    });
    await snapshotIndex(client, p, 'wildcard');
    const saved = JSON.parse(mocks.write.mock.calls.at(-1)![1]);
    expect(saved.reads.find((read: { table: string }) => read.table === 'WBCROSSGT')).toMatchObject({
      rows: [],
      outsideExactPrefix: 1,
    });
  });
  it('publishes only fixed error fields from minimal tool failures', async () => {
    const p = pair();
    const s = state(p);
    mocks.dispatch.mockResolvedValue({
      isError: true,
      content: [{ text: 'ADT API error: status 503. Category: service-unavailable. private backend details' }],
    });
    const error = await call(fakeClient(), 'SAPWrite', {}).catch((caught) => caught);
    recordError(s, 'create', error);
    expect(s.errors).toEqual([{ phase: 'create', kind: 'tool', status: 503, category: 'service-unavailable' }]);
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('private backend details');
  });
  it('classifies unknown result descriptions without preserving their text', async () => {
    const client = fakeClient();
    const p = pair();
    vi.mocked(client.http.post).mockResolvedValue({
      body: '<result resultDescription="private error with identity"/>',
    } as never);
    const record = recordDescriptions(client, p.root);
    await client.http.post('/sap/bc/adt/repository/informationsystem/usageReferences');
    record.restore();
    expect(record.descriptions[0]?.classification).toBe('other');
    expect(JSON.stringify(record.descriptions)).not.toContain('private');
  });
});
