/** Fixed retained607/608 continuation. The consumed original A CREATE is never replayed. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';

export const runNativeRetainedCts = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained');

if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCts(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained CTS qualification stopped. Preserve all claims and IDs; no retry or compensation.');
    process.exitCode = 1;
  }
