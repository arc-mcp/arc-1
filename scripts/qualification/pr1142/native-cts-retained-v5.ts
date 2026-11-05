/** New fixed A-parent-only profile; task608 release is historical and cannot replay. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';
export const runNativeRetainedCtsV5 = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained-v5');
if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCtsV5(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('CTS retained-v5 stopped. Preserve all claims and current/native history; never retry.');
    process.exitCode = 1;
  }
