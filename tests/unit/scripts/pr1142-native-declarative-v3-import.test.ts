import { expect, it, vi } from 'vitest';

// An offline phase must not even initialize modules capable of credential/native work.
vi.mock('dotenv', () => {
  throw new Error('Offline import loaded dotenv');
});
vi.mock('undici', () => {
  throw new Error('Offline import loaded HTTP');
});
vi.mock('../../../src/adt/client.js', () => {
  throw new Error('Offline import loaded the native client');
});
vi.mock('../../../scripts/qualification/pr1142/native-declarative-runner.js', () => {
  throw new Error('Offline import loaded the native runner');
});
vi.mock('../../../scripts/qualification/pr1142/native-declarative-preflight.js', () => {
  throw new Error('Offline import loaded native preflight');
});

it('loads the fixed v3 entry and runtime guard without native dependencies', async () => {
  const entry = await import('../../../scripts/qualification/pr1142/native-declarative-v3.js');
  expect(entry.runNativeDeclarativeV3).toBeTypeOf('function');
  expect(() => entry.assertDeclarativeV3Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
});

it('loads the fixed v3 recovery entry without native or credential initialization', async () => {
  const entry = await import('../../../scripts/qualification/pr1142/native-declarative-v3-recovery.js');
  expect(entry.runNativeV3Recovery).toBeTypeOf('function');
  expect(() => entry.assertV3RecoveryRuntime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
});

it('loads the fixed v4 entry without native or credential initialization', async () => {
  const entry = await import('../../../scripts/qualification/pr1142/native-declarative-v4.js');
  expect(entry.runNativeDeclarativeV4).toBeTypeOf('function');
  expect(() => entry.assertDeclarativeV4Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
});

it('loads the fixed v5 entry and historical proofs without credential or native initialization', async () => {
  const entry = await import('../../../scripts/qualification/pr1142/native-declarative-v5.js');
  expect(entry.runNativeDeclarativeV5).toBeTypeOf('function');
  expect(() => entry.assertDeclarativeV5Runtime({}, ['--import', 'tsx'], 'v22.21.1')).not.toThrow();
});
