/** Fixed single-parent cleanup after the consumed 4e tail; all earlier claims remain consumed. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type ProceduralDependencies, runNativeProcedural } from './native-procedural.js';
import { owners } from './native-procedural-fixed.js';
import {
  GROUP_CLEANUP_INTENT,
  GROUP_CLEANUP_PROTOCOL,
  GROUP_CLEANUP_RESULT,
  GROUP_CLEANUP_STAGES,
} from './native-procedural-group-cleanup-fixed.js';
import { verifyProceduralGroupCleanupHistory } from './native-procedural-group-cleanup-history.js';
export function runNativeProceduralGroupCleanup(
  args: string[],
  dependencies?: ProceduralDependencies & { verifyHistory: () => void },
) {
  const flags = new Map([
    ['--prepare-reviewed-procedural-group-cleanup', '--prepare-reviewed-procedural'],
    ['--preflight-reviewed-procedural-group-cleanup', '--preflight-reviewed-procedural'],
    ['--check-reviewed-procedural-group-cleanup', '--check-reviewed-procedural'],
    ['--execute-reviewed-procedural-group-cleanup', '--execute-reviewed-procedural'],
    ['--verify-reviewed-procedural-group-cleanup', '--verify-reviewed-procedural-cleanup'],
  ]);
  const flag = flags.get(args[0]);
  if (!flag) throw new Error('Fixed retained procedural phase required.');
  return runNativeProcedural([flag, ...args.slice(1)], dependencies, {
    protocol: GROUP_CLEANUP_PROTOCOL,
    stages: GROUP_CLEANUP_STAGES,
    finalDeletionOwners: [owners[0]],
    entry: new URL(import.meta.url),
    history: { intent: GROUP_CLEANUP_INTENT, result: GROUP_CLEANUP_RESULT },
    verifyHistory: dependencies?.verifyHistory ?? verifyProceduralGroupCleanupHistory,
    native: async () => {
      const [{ nativeProceduralDefaults }, { runProceduralGroupCleanup }] = await Promise.all([
        import('./native-procedural-runtime.js'),
        import('./native-procedural-group-cleanup-driver.js'),
      ]);
      return { ...nativeProceduralDefaults, execute: runProceduralGroupCleanup };
    },
  });
}
if (isDirectEntry(process.argv[1], import.meta.url))
  runNativeProceduralGroupCleanup(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failure) process.exitCode = 1;
    })
    .catch(() => {
      console.error('GROUP_CLEANUP_PROTOCOL_STOPPED_PRESERVE_ALL_EVIDENCE');
      process.exitCode = 1;
    });
