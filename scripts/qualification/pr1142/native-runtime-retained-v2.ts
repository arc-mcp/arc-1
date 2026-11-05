/** New fixed claim after the consumed result-parser stop; no prior phase is reopened. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type RuntimeDependencies, runFixedRuntimeProtocol } from './native-runtime-entry-core.js';
import { runtimeReason } from './native-runtime-slice-fixed.js';
export const runNativeRuntimeRetainedV2 = (args: string[], dependencies?: RuntimeDependencies) =>
  runFixedRuntimeProtocol(args, 'retained-v2', new URL(import.meta.url), dependencies);
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRuntimeRetainedV2(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(`Retained runtime v2 stopped (${runtimeReason(error)}). Preserve every consumed claim.`);
    process.exitCode = 1;
  }
}
