/** Separate fixed cleanup claim; never reopens the failed package lifecycle. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type PackagePhaseDependencies, runPackagePhases } from './native-package.js';
import { verifyPackageRecoveryHistory } from './native-package-recovery-history.js';

export async function runNativePackageRecovery(
  args: string[],
  dependencies?: PackagePhaseDependencies & { verifyHistory: () => void },
) {
  return runPackagePhases(args, dependencies, {
    entry: new URL(import.meta.url),
    verifyHistory: dependencies?.verifyHistory ?? verifyPackageRecoveryHistory,
  });
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativePackageRecovery(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed retained-package cleanup stopped. Preserve every claim; never repeat an attempt.');
    process.exitCode = 1;
  }
}
