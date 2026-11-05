/** Fixed read-only A adoption;607 and608 are already released and cannot replay. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';
export const runNativeRetainedCtsV6 = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained-v6');
if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCtsV6(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('CTS retained-v6 stopped. Preserve all claims and current/native history; never retry.');
    process.exitCode = 1;
  }
