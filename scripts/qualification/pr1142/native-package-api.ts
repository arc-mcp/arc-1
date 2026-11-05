/** Separate fixed claim; never reuses the consumed local package or CTS experiments. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type PackagePhaseDependencies, runPackagePhases } from './native-package.js';
export const runNativePackageApiPhases = (args: string[], dependencies?: PackagePhaseDependencies) =>
  runPackagePhases(args, dependencies, { entry: new URL(import.meta.url), recordedApi: true });
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativePackageApiPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed package API qualification stopped. Preserve the claim and every native receipt.');
    process.exitCode = 1;
  }
}
