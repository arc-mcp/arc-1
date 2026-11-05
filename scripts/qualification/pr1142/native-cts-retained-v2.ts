/** Fixed retained607/608 continuation after native reassign refusal; both consumed claims stay closed. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';

export const runNativeRetainedCtsV2 = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained-v2');

if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCtsV2(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained CTS qualification stopped. Preserve all claims and IDs; no retry or compensation.');
    process.exitCode = 1;
  }
