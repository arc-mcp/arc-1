/** One reviewed native CDS/RAP qualification; Basic-native evidence only, never public admission or PP proof. */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { declarativeFixtures } from './native-declarative-fixtures.js';
import {
  assertDeclarativeRuntime,
  declarativeStopCode,
  isDirectEntry,
} from './native-declarative-entry.js';
import { declarativeRunDefaults, runClaimedDeclarative, type DeclarativeRunDependencies } from './native-declarative-runner.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding } from './native-lock-binding.js';

interface Dependencies extends DeclarativeRunDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;

}
const defaults: Dependencies = {
  validateRuntime: assertDeclarativeRuntime,
  bind: nativeLockBinding,
  ...declarativeRunDefaults,
};

/** Injectable edges allow phase/credential/claim tests without importing an executing CLI. */
export async function runNativeDeclarativeQualification(args: string[], dependencies: Dependencies = defaults) {
  if (args.length !== 2 || args[0] !== '--execute-reviewed-declarative' || !/^[a-f0-9]{40}$/.test(args[1]))
    throw new Error('Requires --execute-reviewed-declarative <full reviewed commit>.');
  dependencies.validateRuntime();
  const binding = await dependencies.bind(args[1], new URL(import.meta.url));
  process.umask(0o077);
  claimDirectory(binding.root);
  const fixtures = declarativeFixtures(randomBytes(8).toString('hex').toUpperCase());
  durableRecord(join(binding.root, 'manifest.json'), {
    time: new Date().toISOString(),
    binding: binding.evidence,
    fixtures,
    identity: 'MARIAN',
    target: 'A4H/001',
    authentication: 'Basic-native-contract-only',
    purpose: 'six disposable CDS/RAP owners: create, activate, comment update, activate, then guarded reverse-order deletion',
  });
  const record = journal(join(binding.root, 'run'));
  return runClaimedDeclarative(binding, fixtures, record, dependencies);
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeQualification(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure || result.cleanupUnconfirmed ? 1 : 0;
  } catch (error) {
    console.error(
      `Native declarative qualification stopped (${declarativeStopCode(error)}). Inspect private receipts; never repeat a claimed run.`,
    );
    process.exitCode = 1;
  }
}
