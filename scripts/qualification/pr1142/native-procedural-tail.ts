/** Fixed remaining tail for the consumed original graph. Original claims are never replayed. */
import { isDirectEntry } from './native-declarative-entry.js';
import { type ProceduralDependencies, runNativeProcedural } from './native-procedural.js';
import { TAIL_INTENT, TAIL_PROTOCOL, TAIL_RESULT, TAIL_STAGES } from './native-procedural-tail-fixed.js';
import { verifyProceduralTailHistory } from './native-procedural-tail-history.js';
export function runNativeProceduralTail(
  args: string[],
  dependencies?: ProceduralDependencies & { verifyHistory: () => void },
) {
  const flags = new Map([
    ['--prepare-reviewed-procedural-tail', '--prepare-reviewed-procedural'],
    ['--preflight-reviewed-procedural-tail', '--preflight-reviewed-procedural'],
    ['--check-reviewed-procedural-tail', '--check-reviewed-procedural'],
    ['--execute-reviewed-procedural-tail', '--execute-reviewed-procedural'],
    ['--verify-reviewed-procedural-tail-cleanup', '--verify-reviewed-procedural-cleanup'],
  ]);
  const flag = flags.get(args[0]);
  if (!flag) throw new Error('Fixed retained procedural phase required.');
  return runNativeProcedural([flag, ...args.slice(1)], dependencies, {
    protocol: TAIL_PROTOCOL,
    stages: TAIL_STAGES,
    entry: new URL(import.meta.url),
    history: { intent: TAIL_INTENT, result: TAIL_RESULT },
    verifyHistory: dependencies?.verifyHistory ?? verifyProceduralTailHistory,
    native: async () => {
      const [{ nativeProceduralDefaults }, { runProceduralTail }] = await Promise.all([
        import('./native-procedural-runtime.js'),
        import('./native-procedural-tail-driver.js'),
      ]);
      return { ...nativeProceduralDefaults, execute: runProceduralTail };
    },
  });
}
if (isDirectEntry(process.argv[1], import.meta.url))
  runNativeProceduralTail(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failure) process.exitCode = 1;
    })
    .catch(() => {
      console.error('TAIL_PROTOCOL_STOPPED_PRESERVE_ALL_EVIDENCE');
      process.exitCode = 1;
    });
