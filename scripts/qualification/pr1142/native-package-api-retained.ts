/** Fixed retained four-owner package/API tail; no fresh request or repository owner creation. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type PackagePhaseDependencies, runPackagePhases } from './native-package.js';
import { verifyPackageApiRetainedHistory } from './native-package-api-retained-history.js';
export function runNativePackageApiRetained(
  args: string[],
  dependencies?: PackagePhaseDependencies,
  verifyHistory = verifyPackageApiRetainedHistory,
) {
  return runPackagePhases(args, dependencies, { entry: new URL(import.meta.url), retainedApi: true, verifyHistory });
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativePackageApiRetained(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained package/API qualification stopped. Preserve the consumed claim and evidence.');
    process.exitCode = 1;
  }
}
