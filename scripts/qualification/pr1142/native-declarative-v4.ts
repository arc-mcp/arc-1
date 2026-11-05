/** Fixed v4 qualification entry; no caller-selected protocol, root, fixtures or native operation. */
import { assertDeclarativeRuntime, declarativeStopCode, isDirectEntry } from './native-declarative-entry.js';
import { runDeclarativePhases, type DeclarativePhaseDependencies } from './native-declarative-phases.js';
import { DECLARATIVE_V4, readV4Intent, readV4Prerequisites } from './native-declarative-v4-evidence.js';
import { DECLARATIVE_V4_HISTORY, verifyDeclarativeV4History } from './native-declarative-v4-history.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
export function assertDeclarativeV4Runtime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new DeclarativeFailure('v4-runtime');
}
export function runNativeDeclarativeV4(args: string[], dependencies?: DeclarativePhaseDependencies) {
  return runDeclarativePhases(
    args,
    new URL(import.meta.url),
    {
      version: 'v4',
      protocol: DECLARATIVE_V4,
      history: { facts: DECLARATIVE_V4_HISTORY, verify: verifyDeclarativeV4History },
      validateRuntime: assertDeclarativeV4Runtime,
      readIntent: readV4Intent,
      readPrerequisites: readV4Prerequisites,
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeV4(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Declarative v4 stopped (${declarativeStopCode(error)}). Preserve every receipt; never repeat a claimed attempt.`,
    );
    process.exitCode = 1;
  }
}
