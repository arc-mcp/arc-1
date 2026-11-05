/** Fixed once-per-stage tail; no original stage/claim is reopened or reset. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type RuntimeDependencies, runFixedRuntimeProtocol } from './native-runtime-entry-core.js';
import { runtimeReason } from './native-runtime-slice-fixed.js';
export const runNativeRuntimeRetained = (args: string[], dependencies?: RuntimeDependencies) =>
  runFixedRuntimeProtocol(args, 'retained', new URL(import.meta.url), dependencies);
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRuntimeRetained(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Retained runtime stopped (${runtimeReason(error)}). Preserve all claims; never repeat a consumed stage.`,
    );
    process.exitCode = 1;
  }
}
