import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  assertNativeQualificationEnvironment,
  runNativeFunctionQualification,
} from '../../../scripts/qualification/pr1142/native-function-contract.js';
import type { runNativeFunctionContract } from '../../../scripts/qualification/pr1142/native-function-contract-run.js';
import type { AdtClient } from '../../../src/adt/client.js';

const revision = 'a'.repeat(40);
let parent: string;
const success = {
  failure: false,
  remaining: [],
  pendingCreation: [],
  cleanupIssues: [],
  inspectionRequired: [],
  stopped: false,
  cleanupUnconfirmed: false,
  activeDeletionVerified: true,
};
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'arc1-native-entry-'));
});
afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});
function dependencies() {
  const root = join(parent, 'fixed-run');
  return {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => ({
      root,
      repo: parent,
      verifySource: vi.fn(),
      evidence: {
        revision,
        entryHash: 'b'.repeat(64),
        packageLockHash: 'c'.repeat(64),
        node: process.version,
        repo: parent,
        dependencyLimit: 'fixture',
      },
    })),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_CLIENT: '001',
      SAP_PASSWORD: 'test-only',
    })),
    createClient: vi.fn(() => ({ http: {} }) as AdtClient),
    execute: vi.fn<typeof runNativeFunctionContract>(async () => ({ ...success })),
    confirmAbsence: vi.fn(async () => {}),
  };
}
it.each(
  [
    [],
    ['--execute-reviewed-revision', revision],
    ['--execute-reviewed-active-delete', 'short'],
    ['--execute-reviewed-active-delete', revision, 'extra'],
  ].map((args) => ({ args })),
)('refuses non-explicit or malformed invocation before binding or credentials', async ({ args }) => {
  const d = dependencies();
  await expect(runNativeFunctionQualification(args, d)).rejects.toThrow('Requires');
  expect(d.bind).not.toHaveBeenCalled();
  expect(d.readEnv).not.toHaveBeenCalled();
});
it('checks runtime restrictions before binding or loading credentials', async () => {
  const d = dependencies();
  d.validateRuntime.mockImplementationOnce(() => {
    throw new Error('runtime refused');
  });
  await expect(runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d)).rejects.toThrow(
    'runtime refused',
  );
  expect(d.bind).not.toHaveBeenCalled();
  expect(d.readEnv).not.toHaveBeenCalled();
});
it('does not load credentials after a failed source binding', async () => {
  const d = dependencies();
  d.bind.mockRejectedValueOnce(new Error('binding refused'));
  await expect(runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d)).rejects.toThrow(
    'binding refused',
  );
  expect(d.readEnv).not.toHaveBeenCalled();
  expect(existsSync(join(parent, 'fixed-run'))).toBe(false);
});
it('claims once before credentials and selects only the explicit private active-delete mode', async () => {
  const d = dependencies();
  const result = await runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d);
  expect(result).toMatchObject({ failure: false, finalAbsenceConfirmed: true, activeDeletionVerified: true });
  expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ activatedCleanup: 'delete-verified-active' }));
  expect(d.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      insecure: false,
      username: 'MARIAN',
      client: '001',
      safety: expect.objectContaining({ allowedPackages: ['$TMP'], allowTransportWrites: false }),
    }),
  );
  expect(d.confirmAbsence).toHaveBeenCalledOnce();
  const manifest = JSON.parse(readFileSync(join(parent, 'fixed-run/manifest.json'), 'utf8'));
  expect(manifest.identity).toBe('MARIAN');
  await expect(runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d)).rejects.toThrow();
  expect(d.readEnv).toHaveBeenCalledOnce();
  expect(d.execute).toHaveBeenCalledOnce();
});
it('refuses invalid credentials after claiming, without constructing a client or retrying', async () => {
  const d = dependencies();
  d.readEnv.mockReturnValueOnce({
    SAP_URL: 'https://wrong.example',
    SAP_USER: 'MARIAN',
    SAP_CLIENT: '001',
    SAP_PASSWORD: 'test-only',
  });
  await expect(runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d)).rejects.toThrow(
    'approved HTTPS',
  );
  expect(d.createClient).not.toHaveBeenCalled();
  expect(existsSync(join(parent, 'fixed-run/manifest.json'))).toBe(true);
});
it.each(['failure', 'cleanupUnconfirmed', 'missing-active-proof', 'absence-failed'])(
  'cannot report successful qualification with %s',
  async (fault) => {
    const d = dependencies();
    if (fault === 'failure') d.execute.mockResolvedValueOnce({ ...success, failure: true });
    if (fault === 'cleanupUnconfirmed') d.execute.mockResolvedValueOnce({ ...success, cleanupUnconfirmed: true });
    if (fault === 'missing-active-proof')
      d.execute.mockResolvedValueOnce({ ...success, activeDeletionVerified: false });
    if (fault === 'absence-failed') d.confirmAbsence.mockRejectedValueOnce(new Error('not absent'));
    const result = await runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d);
    expect(result.failure).toBe(true);
    expect(result.finalAbsenceConfirmed).toBe(false);
    if (fault !== 'absence-failed') expect(d.confirmAbsence).not.toHaveBeenCalled();
  },
);
it('installs and removes stop listeners and refuses to qualify after stop', async () => {
  const d = dependencies(),
    signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const before = signals.map((signal) => process.listenerCount(signal));
  d.execute.mockImplementationOnce(async (...args) => {
    const input = args[0] as unknown as { shouldStop: () => boolean };
    expect(input.shouldStop()).toBe(false);
    signals.forEach((signal, i) => {
      expect(process.listenerCount(signal)).toBe(before[i] + 1);
    });
    const listener = process.listeners('SIGINT').at(-1)!;
    Reflect.apply(listener, process, []);
    expect(input.shouldStop()).toBe(true);
    return { ...success };
  });
  const result = await runNativeFunctionQualification(['--execute-reviewed-active-delete', revision], d);
  expect(result.failure).toBe(true);
  expect(d.confirmAbsence).not.toHaveBeenCalled();
  expect(signals.map((signal) => process.listenerCount(signal))).toEqual(before);
});
it.each([{ NODE_OPTIONS: '--import unsafe' }, { GIT_DIR: '/elsewhere' }, { GIT_PAGER: 'cat' }])(
  'refuses runtime preload or Git overrides',
  (env) => {
    expect(() => assertNativeQualificationEnvironment(env, ['--import', 'tsx'])).toThrow('unset');
  },
);
it('accepts only the documented Node loader arguments', () => {
  expect(() => assertNativeQualificationEnvironment({}, ['--import', 'tsx'])).not.toThrow();
  expect(() => assertNativeQualificationEnvironment({}, ['--require', 'another'])).toThrow();
});

it('applies TLS and diagnostic restrictions to the supplied runtime environment', () => {
  expect(() =>
    assertNativeQualificationEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, ['--import', 'tsx']),
  ).toThrow('TLS_VERIFICATION_REQUIRED');
  expect(() => assertNativeQualificationEnvironment({ NODE_DEBUG: 'http' }, ['--import', 'tsx'])).toThrow(
    'UNSAFE_RUNTIME_DIAGNOSTICS',
  );
});
