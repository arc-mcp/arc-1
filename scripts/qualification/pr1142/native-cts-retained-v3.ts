/** Fixed retained607/608 continuation after the partial class create; all three consumed claims stay closed. */
import { type NativeCtsDependencies, runNativeCts } from './native-cts.js';
import { isDirectEntry } from './native-declarative-entry.js';

export const runNativeRetainedCtsV3 = (args: string[], dependencies?: NativeCtsDependencies) =>
  runNativeCts(args, dependencies, 'retained-v3');

if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeRetainedCtsV3(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained CTS qualification stopped. Preserve all claims and IDs; no retry or compensation.');
    process.exitCode = 1;
  }
