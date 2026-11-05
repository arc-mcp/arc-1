/** Exercise the entry's actual safety options with the real driver and synthetic native transport. */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RetainedDependencies } from '../../../scripts/qualification/pr1142/native-v5-retained.js';
import { inspectRetained } from '../../../scripts/qualification/pr1142/native-v5-retained-evidence.js';
import {
  originalResultHash,
  RETAINED_PROTOCOL,
  RETAINED_SUFFIX,
  retainedHash,
  retainedStages,
} from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';
import { AdtClient, retainedHarness, runRetainedContinuation } from './pr1142-native-v5-retained-harness.js';

// Load the entry only after the shared harness installs all native transport mocks.
const { runNativeRetained } = await import('../../../scripts/qualification/pr1142/native-v5-retained.js');
const revision = 'a'.repeat(40);
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
let temporary: string;
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'retained-composed-'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(temporary, { recursive: true, force: true });
});

it.each([false, true])('composes actual entry/client/driver, dropped policy=%s', async (dropPolicy) => {
  const h = retainedHarness();
  const clients: ConstructorParameters<typeof AdtClient>[0][] = [];
  const dependencies: RetainedDependencies = {
    validateRuntime: () => {},
    bind: async () => ({
      repo: temporary,
      root: join(temporary, RETAINED_PROTOCOL),
      verifySource: () => {},
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: 'v22.21.1',
        repo: temporary,
        dependencyLimit: 'synthetic',
      },
    }),
    verifyHistory: () => {},
    readEnv: () => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: 'SYNTHETIC-ONLY',
      SAP_CLIENT: '001',
    }),
    createClient: (options) => {
      if (!options?.safety) throw new Error('Entry safety options are missing.');
      clients.push(options);
      return new AdtClient({
        ...options,
        baseUrl: h.origin,
        ...(dropPolicy ? { safety: { ...options.safety, multiTargetWrite: undefined } } : {}),
      });
    },
    inspect: inspectRetained,
    execute: runRetainedContinuation,
  };
  const invoke = (phase: string, sample?: string) =>
    runNativeRetained([`--${phase}-reviewed-v5-retained`, revision, ...(sample ? [sample] : [])], dependencies);
  const prepared = await invoke('prepare');
  vi.setSystemTime(Date.now() + 1);
  const sample = await invoke('preflight');
  if (!('sample' in sample)) throw new Error('Missing sample.');
  expect(sample.failure).toBe(false);
  expect(clients[0]!.safety).toMatchObject({ allowWrites: false, allowedPackages: ['$TMP'] });
  expect(clients[0]!.safety!.multiTargetWrite).toBeUndefined();
  expect(h.calls.every((call) => call.method === 'GET')).toBe(true);
  vi.setSystemTime(Date.now() + 1);
  const observation = {
    observedAt: new Date().toISOString(),
    client: '001',
    table: '*',
    lockCount: 0,
    evidenceSha256: retainedHash(jpeg),
  };
  writeFileSync(
    join(sample.root, 'sm12-baseline.json'),
    JSON.stringify({
      protocol: RETAINED_PROTOCOL,
      revision,
      intentHash: prepared.intentHash,
      preflightId: sample.sample,
      originalResultHash,
      suffixSearch: { ...observation, user: '*', argument: `*${RETAINED_SUFFIX}*` },
      userSearch: { ...observation, user: 'MARIAN', argument: '*' },
    }),
    { mode: 0o600 },
  );
  for (const name of ['suffix', 'user']) writeFileSync(join(sample.root, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
  const result = await invoke('execute', sample.sample);
  expect(clients[1]!.safety).toMatchObject({
    allowWrites: true,
    allowedPackages: ['$TMP'],
    multiTargetWrite: {
      enabled: true,
      target: 'A4H/001',
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  });
  if (dropPolicy) {
    expect(result).toMatchObject({ failure: true, mutationAttempted: false, mutationSubmitted: false, completed: [] });
    expect(h.calls.every((call) => call.method === 'GET')).toBe(true);
  } else {
    const journal = join(sample.root, '../../attempt/run');
    const outcomes = readdirSync(journal)
      .sort()
      .map((name) => JSON.parse(readFileSync(join(journal, name), 'utf8')).value)
      .filter((row) => row.operation || row.continuationUnconfirmed);
    expect(result, JSON.stringify(outcomes)).toMatchObject({
      failure: false,
      completed: [...retainedStages],
      finalAbsenceConfirmed: true,
      cleanupConfirmed: true,
      remaining: [],
    });
    expect(h.calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
    expect(h.existing.size).toBe(0);
  }
});
