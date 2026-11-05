/** Fixed original entry. Its existing root/claims and stage semantics remain unchanged. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type RuntimeDependencies, runFixedRuntimeProtocol } from './native-runtime-entry-core.js';
import { runtimeReason } from './native-runtime-slice-fixed.js';

export { assertRuntimeSliceRuntime } from './native-runtime-entry-core.js';
export const runNativeRuntimeSlice = (args: string[], dependencies?: RuntimeDependencies) =>
  runFixedRuntimeProtocol(args, 'original', new URL(import.meta.url), dependencies);
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRuntimeSlice(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Runtime qualification stopped (${runtimeReason(error)}). Preserve all claims; never repeat a consumed stage.`,
    );
    process.exitCode = 1;
  }
}
