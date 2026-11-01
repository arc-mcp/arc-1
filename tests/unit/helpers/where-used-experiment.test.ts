import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  BASELINE,
  call,
  captureReferenceFailure,
  checkTarget,
  cleanupPair,
  createOwned,
  MANIFEST,
  type Manifest,
  type Pair,
  preparePair,
  readManifest,
  recordDescriptions,
  recordError,
  registerPair,
  snapshotIndex,
  snapshotPair,
  validatePair,
} from '../../helpers/where-used-experiment.js';
import { generateUniqueName } from '../../integration/crud-harness.js';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), write: vi.fn(), rename: vi.fn(), read: vi.fn() }));
vi.mock('../../../src/handlers/dispatch.js', () => ({ handleToolCall: mocks.dispatch }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      mocks.read(...args) ?? actual.readFileSync(...args),
    mkdirSync: vi.fn(),
    writeFileSync: mocks.write,
    renameSync: mocks.rename,
  };
});
function pair(suffix = 'AB12345'): Pair {
  return {
    root: `ZAR1018_ROOT_${suffix}`,
    consumer: `ZAR1018_USE_${suffix}`,
    absentBeforeCreate: false,
    attempts: [],
    conflicts: [],
    outcome: 'setup',
    cleanup: {},
  };
}
function state(value: Pair): Manifest {
  return { baseline: BASELINE, startedUtc: '2026-11-01T00:00:00Z', pairs: [value], suiteExitCode: 0 };
}
function fakeClient() {
  return {
    safety: { ...defaultSafetyConfig(), allowWrites: true },
    http: { get: vi.fn().mockRejectedValue({ statusCode: 404 }), post: vi.fn() },
    getInstalledComponents: vi.fn(),
    runTableQuery: vi.fn(),
    getClass: vi.fn(),
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
  it('registers only one original-name pair with independent suffixes and the same run ID', () => {
    const s = state(pair());
    s.pairs = [];
    const p = registerPair(s, 'ZAR1018_ROOT_AB12345', 'ZAR1018_USE_AB67890');
    expect(s.pairs).toEqual([p]);
    expect(() => registerPair(s, p.root, p.consumer)).toThrow();
    expect(() => validatePair({ ...p, consumer: 'ZAR1018_USE_CD67890' })).toThrow();
    expect(() => validatePair({ ...p, root: 'CL_STANDARD' })).toThrow();
    mocks.read.mockReturnValueOnce(JSON.stringify({ ...s, pairs: [p, p] }));
    expect(() => readManifest()).toThrow();
  });
  it('accepts actual original fixture names produced by the shared generator', () => {
    const p = { ...pair(), root: generateUniqueName('ZAR1018_ROOT'), consumer: generateUniqueName('ZAR1018_USE') };
    expect(() => validatePair(p)).not.toThrow();
  });
  function captureSetup() {
    const p = pair();
    p.activatedAt = 1;
    const s = state(p);
    const client = fakeClient();
    vi.mocked(client.runTableQuery).mockResolvedValue({ columns: [], rows: [] });
    vi.mocked(client.http.get).mockResolvedValue({ body: '<class/>' } as never);
    vi.mocked(client.getClass).mockImplementation(async (name) => ({ source: name }) as never);
    const sources: [string, string][] = [
      [p.root, p.root],
      [p.consumer, p.consumer],
    ];
    return { p, s, client, sources, error: new Error('original assertion') };
  }
  it('persists retention before any index/source read and rethrows the same assertion', async () => {
    const { p, s, client, sources, error } = captureSetup();
    vi.mocked(client.runTableQuery).mockImplementation(async () => {
      const saved = JSON.parse(mocks.write.mock.calls.findLast(([path]) => path === `${MANIFEST}.tmp`)![1]);
      expect(saved.pairs[0]).toMatchObject({ retain: 'failure', outcome: 'ordinary-scoped-failure' });
      expect(mocks.rename).toHaveBeenCalledWith(`${MANIFEST}.tmp`, MANIFEST);
      expect(client.getClass).not.toHaveBeenCalled();
      return { columns: [], rows: [] };
    });
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now())).rejects.toBe(error);
    expect(p).toMatchObject({ retain: 'failure', indexOk: true, activeSourcesMatch: true });
  });
  it('keeps a failed pair despite unavailable diagnostic reads', async () => {
    const { p, s, client, sources, error } = captureSetup();
    vi.mocked(client.runTableQuery).mockRejectedValue(new Error('private index error'));
    vi.mocked(client.getClass).mockRejectedValue(new Error('private source error'));
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now())).rejects.toBe(error);
    expect(p.retain).toBe('failure');
    expect(p.activeSourcesMatch).toBeUndefined();
    expect(s.stop).toBe('index');
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('private');
  });
  it('clears retention on a proven active-source mismatch, preserving the assertion error', async () => {
    const { p, s, client, sources, error } = captureSetup();
    vi.mocked(client.getClass).mockResolvedValue({ source: 'different source' } as never);
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now())).rejects.toBe(error);
    expect(p.retain).toBeUndefined();
    expect(p.activeSourcesMatch).toBe(false);
    expect(s.stop).toBe('setup');
  });
  it('retains a late failure without exceeding the original test budget with extra reads', async () => {
    const { p, s, client, sources, error } = captureSetup();
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now() - 45_000)).rejects.toBe(error);
    expect(p).toMatchObject({ retain: 'failure', phase: 'immediate-capture-skipped-time-budget' });
    expect(client.runTableQuery).not.toHaveBeenCalled();
    expect(client.getClass).not.toHaveBeenCalled();
  });
  it('never starts retention after cleanup or before activation', async () => {
    const { p, s, client, sources, error } = captureSetup();
    p.phase = 'cleanup';
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now())).rejects.toBe(error);
    expect(p.retain).toBeUndefined();
    p.phase = 'setup';
    p.activatedAt = undefined;
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now())).rejects.toBe(error);
    expect(p.retain).toBeUndefined();
    expect(client.runTableQuery).not.toHaveBeenCalled();
  });
  it('does not classify an assertion arriving after the test deadline as a qualifying failure', async () => {
    const { p, s, client, sources, error } = captureSetup();
    await expect(captureReferenceFailure(client, s, p, sources, error, Date.now() - 90_000)).rejects.toBe(error);
    expect(p).toMatchObject({ outcome: 'other-failure', phase: 'assertion-after-test-deadline' });
    expect(p.retain).toBeUndefined();
    expect(client.runTableQuery).not.toHaveBeenCalled();
    expect(s.errors).toEqual([
      { phase: 'assertion-after-test-deadline', kind: 'unexpected', status: null, category: null },
    ]);
  });
  it('records a passing source/index check without retaining a passing control', async () => {
    const { p, s, client, sources } = captureSetup();
    p.outcome = 'passed';
    await snapshotPair(client, s, p, sources);
    expect(p).toMatchObject({ outcome: 'passed', indexOk: true, activeSourcesMatch: true });
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
