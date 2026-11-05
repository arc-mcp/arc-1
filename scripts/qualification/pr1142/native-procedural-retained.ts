/** Fixed remaining tail for the consumed original graph. Original claims are never replayed. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type ProceduralDependencies, runNativeProcedural } from './native-procedural.js';
import {
  ORIGINAL_INTENT,
  ORIGINAL_RESULT,
  RETAINED_PROCEDURAL,
  RETAINED_STAGES,
} from './native-procedural-retained-fixed.js';
import { verifyProceduralRetainedHistory } from './native-procedural-retained-history.js';
export function runNativeRetainedProcedural(
  args: string[],
  dependencies?: ProceduralDependencies & { verifyHistory: () => void },
) {
  const flags = new Map([
    ['--prepare-reviewed-procedural-retained', '--prepare-reviewed-procedural'],
    ['--preflight-reviewed-procedural-retained', '--preflight-reviewed-procedural'],
    ['--check-reviewed-procedural-retained', '--check-reviewed-procedural'],
    ['--execute-reviewed-procedural-retained', '--execute-reviewed-procedural'],
    ['--verify-reviewed-procedural-retained-cleanup', '--verify-reviewed-procedural-cleanup'],
  ]);
  const flag = flags.get(args[0]);
  if (!flag) throw new Error('Fixed retained procedural phase required.');
  return runNativeProcedural([flag, ...args.slice(1)], dependencies, {
    protocol: RETAINED_PROCEDURAL,
    stages: RETAINED_STAGES,
    entry: new URL(import.meta.url),
    history: { intent: ORIGINAL_INTENT, result: ORIGINAL_RESULT },
    verifyHistory: dependencies?.verifyHistory ?? verifyProceduralRetainedHistory,
    native: async () => {
      const [{ nativeProceduralDefaults }, { runRetainedProcedural }] = await Promise.all([
        import('./native-procedural-runtime.js'),
        import('./native-procedural-retained-driver.js'),
      ]);
      return { ...nativeProceduralDefaults, execute: runRetainedProcedural };
    },
  });
}
if (isDirectEntry(process.argv[1], import.meta.url))
  runNativeRetainedProcedural(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failure) process.exitCode = 1;
    })
    .catch(() => {
      console.error('RETAINED_PROCEDURAL_STOPPED_PRESERVE_ALL_EVIDENCE');
      process.exitCode = 1;
    });
