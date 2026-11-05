/** Fixed ST05-only entry; no prior stage or claim can be resumed. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type RuntimeDependencies, runFixedRuntimeProtocol } from './native-runtime-entry-core.js';
import { runtimeReason } from './native-runtime-slice-fixed.js';
export const runNativeRuntimeSt05 = (args: string[], dependencies?: RuntimeDependencies) =>
  runFixedRuntimeProtocol(args, 'st05-tail', new URL(import.meta.url), dependencies);
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRuntimeSt05(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(`ST05 continuation stopped (${runtimeReason(error)}). Preserve all prior claims and baselines.`);
    process.exitCode = 1;
  }
}
