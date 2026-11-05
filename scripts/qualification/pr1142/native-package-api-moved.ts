/** A separately claimed API/reverse-cleanup tail for the one already moved native class. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type PackagePhaseDependencies, runPackagePhases } from './native-package.js';
import { verifyPackageApiMovedHistory } from './native-package-api-moved-history.js';
export function runNativePackageApiMoved(
  args: string[],
  dependencies?: PackagePhaseDependencies,
  verifyHistory = verifyPackageApiMovedHistory,
) {
  return runPackagePhases(args, dependencies, {
    entry: new URL(import.meta.url),
    retainedApi: true,
    movedApi: true,
    verifyHistory,
  });
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativePackageApiMoved(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed moved package tail stopped. Preserve all consumed claims and observed state.');
    process.exitCode = 1;
  }
}
