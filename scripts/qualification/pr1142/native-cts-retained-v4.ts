/** Fixed release-only A tail; consumed creates/class operations/reassignments never replay. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';
export const runNativeRetainedCtsV4 = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained-v4');
if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCtsV4(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained CTS release stopped. Preserve all old/new claims and exact IDs; never retry.');
    process.exitCode = 1;
  }
