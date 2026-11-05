import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runNativeDeclarativeQualification } from '../../../scripts/qualification/pr1142/native-declarative-contract.js';
import {
  assertDeclarativeRuntime,
  declarativeStopCode,
  invalidNativeCredentialFields,
  isDirectEntry,
} from '../../../scripts/qualification/pr1142/native-declarative-entry.js';
import { DeclarativeFailure } from '../../../scripts/qualification/pr1142/native-declarative-workflow.js';
import { HarnessError } from '../../../scripts/qualification/pr1142/safe-io.mjs';
import type { AdtClient } from '../../../src/adt/client.js';

let temporary: string;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeQualification>[1]>;
let mode = '';
const revision = 'a'.repeat(40);
const args = ['--execute-reviewed-declarative', revision];
const privateValue = 'fixture-only';
const claimed = () => join(temporary, 'claimed');
function journalRows() {
  const directory = join(claimed(), 'run');
  return readdirSync(directory)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')).value);
}
const storedResult = () => JSON.parse(readFileSync(join(claimed(), 'result.json'), 'utf8'));
beforeEach(() => {
  mode = '';
  temporary = mkdtempSync(join(tmpdir(), 'pr1142-declarative-'));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => ({
      repo: temporary,
      root: claimed(),
      verifySource: vi.fn(),
      evidence: {
        revision,
        entryHash: 'a'.repeat(64),
        packageLockHash: 'b'.repeat(64),
        node: process.version,
        repo: temporary,
        dependencyLimit: 'fixture',
      },
    })),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: privateValue,
    })),
    createClient: vi.fn(() => ({ http: {} }) as AdtClient),
    execute: vi.fn(async (input: Parameters<typeof dependencies.execute>[0]) => ({
      failure: mode === 'failure',
      mutationAttempted: true,
      completed: mode === 'incomplete' ? [] : input.fixtures.map((fixture) => fixture.owner),
      remaining: [],
      confirmedDeleted: [],
      pendingCreation: [],
      createNeverSent: [],
      inspectionRequired: [],
      cleanupIssues: [],
      cleanupNotAttempted: [],
      cleanupUnconfirmed: mode === 'failure',
      finalAbsenceConfirmed: mode !== 'failure',
      stopped: false,
    })),
    confirmAbsence: vi.fn(async () => {
      if (mode === 'absence') throw new DeclarativeFailure('absence-not-typed', { status: 500 });
      if (mode === 'absence-arbitrary') throw new Error(privateValue);
    }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(temporary, { recursive: true, force: true });
});
it.each([
  { selected: [] },
  { selected: ['--execute-reviewed-active-delete', revision] },
  { selected: ['--execute-reviewed-declarative', 'short'] },
])('rejects %j before credentials or claim', async ({ selected }) => {
  await expect(runNativeDeclarativeQualification(selected, dependencies)).rejects.toThrow();
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it('requires runtime validation before loading credentials or creating a claim', async () => {
  dependencies.validateRuntime = () => {
    throw new Error('invalid runtime');
  };
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toThrow('invalid runtime');
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it('claims once before credentials and never repeats a claimed run', async () => {
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({ failure: false, finalAbsenceConfirmed: true, independentAbsence: 'confirmed' });
  expect(dependencies.confirmAbsence).toHaveBeenCalledOnce();
  expect(dependencies.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: 'MARIAN',
      insecure: false,
      safety: expect.objectContaining({ allowWrites: true, allowedPackages: ['$TMP'] }),
    }),
  );
  for (const name of ['manifest.json', 'result.json'])
    expect(readFileSync(join(result.root, name), 'utf8')).not.toContain(privateValue);
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toThrow();
  expect(dependencies.readEnv).toHaveBeenCalledOnce();
  expect(dependencies.execute).toHaveBeenCalledOnce();
});
it('journals exact field names, never values, when the existing credentials are for another identity', async () => {
  dependencies.readEnv = vi.fn(() => ({
    SAP_URL: 'https://secret-user:secret-pass@a4h.marianzeis.de',
    SAP_CLIENT: '100',
    SAP_USER: 'OTHER',
    SAP_PASSWORD: privateValue,
  }));
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toMatchObject({
    reason: 'configuration-env-invalid',
  });
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(dependencies.execute).not.toHaveBeenCalled();
  const refusal = {
    reason: 'configuration-env-invalid',
    invalidFields: ['SAP_URL', 'SAP_USER', 'SAP_CLIENT'],
  };
  expect(journalRows()).toEqual([{ qualificationStopped: 'configuration', ...refusal }]);
  expect(storedResult()).toEqual({
    failure: true,
    mutationAttempted: false,
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
    independentAbsence: 'not-run',
    stoppedAt: 'configuration',
    ...refusal,
  });
  const persisted = JSON.stringify([journalRows(), storedResult()]);
  for (const value of [privateValue, 'secret-user', 'secret-pass', 'OTHER']) expect(persisted).not.toContain(value);
});
it('journals a fixed reason for an unreadable credentials file, never its path or error text', async () => {
  dependencies.readEnv = vi.fn(() => {
    throw new Error(`ENOENT ${privateValue}`);
  });
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toMatchObject({
    reason: 'configuration-env-unreadable',
  });
  expect(journalRows()).toEqual([{ qualificationStopped: 'configuration', reason: 'configuration-env-unreadable' }]);
  expect(storedResult()).toMatchObject({ failure: true, mutationAttempted: false, cleanupUnconfirmed: false });
  expect(JSON.stringify([journalRows(), storedResult()])).not.toContain(privateValue);
});
it('journals a fixed reason when the client cannot be constructed, and still clears the password', async () => {
  const env = {
    SAP_URL: 'https://a4h.marianzeis.de',
    SAP_CLIENT: '001',
    SAP_USER: 'MARIAN',
    SAP_PASSWORD: privateValue as string | undefined,
  };
  dependencies.readEnv = vi.fn(() => env as Record<string, string>);
  dependencies.createClient = vi.fn(() => {
    throw new Error(privateValue);
  });
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toMatchObject({
    reason: 'configuration-client',
  });
  expect(env.SAP_PASSWORD).toBeUndefined();
  expect(journalRows()).toEqual([{ qualificationStopped: 'configuration', reason: 'configuration-client' }]);
});
it('keeps the workflow absence result when the run failed for another reason', async () => {
  mode = 'incomplete';
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
    independentAbsence: 'not-run',
  });
  expect(dependencies.confirmAbsence).not.toHaveBeenCalled();
});
it('does not run independent absence after a workflow failure, or overstate its evidence', async () => {
  mode = 'failure';
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: true,
    finalAbsenceConfirmed: false,
    independentAbsence: 'not-run',
  });
  expect(dependencies.execute).toHaveBeenCalledOnce();
  expect(dependencies.confirmAbsence).not.toHaveBeenCalled();
});
it('cannot pass when independent absence refuses, and retains both results and the fixed reason', async () => {
  mode = 'absence';
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({
    failure: true,
    cleanupUnconfirmed: true,
    finalAbsenceConfirmed: true,
    independentAbsence: 'unconfirmed',
  });
  expect(journalRows()).toContainEqual({ finalAbsenceUnconfirmed: true, reason: 'absence-not-typed', status: 500 });
  expect(dependencies.execute).toHaveBeenCalledOnce();
  expect(storedResult()).toMatchObject({ independentAbsence: 'unconfirmed', failure: true });
});
it('reduces an arbitrary independent-absence failure to a fixed reason', async () => {
  mode = 'absence-arbitrary';
  await runNativeDeclarativeQualification(args, dependencies);
  expect(journalRows()).toContainEqual({ finalAbsenceUnconfirmed: true, reason: 'unclassified' });
  expect(JSON.stringify(journalRows())).not.toContain(privateValue);
});
it('treats a binding failure before independent absence as a fixed reason, without reading', async () => {
  let bindingBroken = false;
  const execute = dependencies.execute;
  dependencies.execute = vi.fn(async (input: Parameters<typeof execute>[0]) => {
    const result = await execute(input);
    bindingBroken = true;
    return result;
  });
  const bind = dependencies.bind;
  dependencies.bind = vi.fn(async (...input: Parameters<typeof bind>) => ({
    ...(await bind(...input)),
    verifySource: () => {
      if (bindingBroken) throw new Error(privateValue);
    },
  }));
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({ failure: true, independentAbsence: 'unconfirmed' });
  expect(dependencies.confirmAbsence).not.toHaveBeenCalled();
  expect(journalRows()).toContainEqual({ finalAbsenceUnconfirmed: true, reason: 'source-binding' });
});
it('refuses an initially broken binding before loading credentials or constructing the native client', async () => {
  const bind = dependencies.bind;
  dependencies.bind = vi.fn(async (...input: Parameters<typeof bind>) => ({
    ...(await bind(...input)),
    verifySource: () => {
      throw new Error(privateValue);
    },
  }));
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toMatchObject({
    reason: 'source-binding',
  });
  for (const fn of [dependencies.readEnv, dependencies.createClient, dependencies.execute, dependencies.confirmAbsence])
    expect(fn).not.toHaveBeenCalled();
  expect(storedResult()).toMatchObject({ failure: true, mutationAttempted: false, reason: 'source-binding' });
  expect(JSON.stringify(journalRows())).not.toContain(privateValue);
});
it('journals a stop signal, removes its listeners and refuses qualification', async () => {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const before = signals.map((signal) => process.listenerCount(signal));
  const execute = dependencies.execute;
  dependencies.execute = vi.fn(async (input: Parameters<typeof execute>[0]) => {
    Reflect.apply(process.listeners('SIGTERM').at(-1)!, process, ['SIGTERM']);
    expect(input.shouldStop()).toBe(true);
    return execute(input);
  });
  const result = await runNativeDeclarativeQualification(args, dependencies);
  expect(result).toMatchObject({ failure: true, stopped: true, independentAbsence: 'not-run' });
  expect(journalRows()).toContainEqual({ stopSignal: 'SIGTERM' });
  expect(dependencies.confirmAbsence).not.toHaveBeenCalled();
  expect(signals.map((signal) => process.listenerCount(signal))).toEqual(before);
});
it('journals an unexpected execution failure with a fixed reason', async () => {
  dependencies.execute = vi.fn(async () => {
    throw new Error(privateValue);
  });
  await expect(runNativeDeclarativeQualification(args, dependencies)).rejects.toThrow(privateValue);
  expect(journalRows()).toEqual([{ qualificationStopped: 'execution-error', reason: 'unclassified' }]);
});

it('starts through a symlinked path and refuses anything that is not this module', () => {
  const entry = join(temporary, 'entry.ts');
  const other = join(temporary, 'other.ts');
  writeFileSync(entry, '// entry\n');
  writeFileSync(other, '// other\n');
  const link = join(temporary, 'link.ts');
  symlinkSync(entry, link);
  const moduleUrl = pathToFileURL(entry).href;
  expect(isDirectEntry(entry, moduleUrl)).toBe(true);
  expect(isDirectEntry(link, moduleUrl)).toBe(true);
  // A linked module URL resolves the same way, as Node's main-module loader does by default.
  expect(isDirectEntry(entry, pathToFileURL(link).href)).toBe(true);
  expect(isDirectEntry(other, moduleUrl)).toBe(false);
  expect(isDirectEntry(join(temporary, 'missing.ts'), moduleUrl)).toBe(false);
  expect(isDirectEntry(undefined, moduleUrl)).toBe(false);
});
it.each([
  ['NODE_EXTRA_CA_CERTS', '/tmp/ca.pem'],
  ['NODE_EXTRA_CA_CERTS', ''],
  ['NODE_USE_SYSTEM_CA', '1'],
  ['NODE_PATH', '/elsewhere'],
  ['TSX_TSCONFIG_PATH', '/elsewhere/tsconfig.json'],
  ['TSX_DISABLE_CACHE', '1'],
])('refuses the %s=%j override', (name, value) => {
  expect(() => assertDeclarativeRuntime({ [name]: value }, ['--import', 'tsx'])).toThrow('UNSAFE_RUNTIME_OVERRIDE');
});
it('retains the shared runtime refusals and accepts the documented loader', () => {
  expect(() => assertDeclarativeRuntime({}, ['--import', 'tsx'])).not.toThrow();
  expect(() => assertDeclarativeRuntime({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, ['--import', 'tsx'])).toThrow(
    'TLS_VERIFICATION_REQUIRED',
  );
  expect(() => assertDeclarativeRuntime({ GIT_DIR: '/elsewhere' }, ['--import', 'tsx'])).toThrow('unset');
  expect(() => assertDeclarativeRuntime({ NODE_OPTIONS: '--import x' }, ['--import', 'tsx'])).toThrow('unset');
  expect(() => assertDeclarativeRuntime({}, ['--require', 'another'])).toThrow('unset');
});
it('reports every invalid credential field by name only', () => {
  expect(
    invalidNativeCredentialFields({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_USER: 'MARIAN',
      SAP_CLIENT: '001',
      SAP_PASSWORD: privateValue,
    }),
  ).toEqual([]);
  expect(invalidNativeCredentialFields({})).toEqual(['SAP_URL', 'SAP_USER', 'SAP_CLIENT', 'SAP_PASSWORD']);
});
it('prints only allow-listed stop codes', () => {
  expect(declarativeStopCode(new DeclarativeFailure('configuration-env-invalid'))).toBe('configuration-env-invalid');
  expect(declarativeStopCode(new HarnessError('UNSAFE_RUNTIME_OVERRIDE'))).toBe('UNSAFE_RUNTIME_OVERRIDE');
  expect(declarativeStopCode(new HarnessError(privateValue))).toBe('QUALIFICATION_STOPPED');
  expect(declarativeStopCode(new Error(privateValue))).toBe('QUALIFICATION_STOPPED');
});
