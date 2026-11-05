/** Fixed v5 qualification entry; no caller-selected protocol, root, fixtures or native operation. */
import { assertDeclarativeRuntime, declarativeStopCode, isDirectEntry } from './native-declarative-entry.js';
import { runDeclarativePhases, type DeclarativePhaseDependencies } from './native-declarative-phases.js';
import { DECLARATIVE_V5, readV5Intent, readV5Prerequisites } from './native-declarative-v5-evidence.js';
import { DECLARATIVE_V5_HISTORY, verifyDeclarativeV5History } from './native-declarative-v5-history.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
export function assertDeclarativeV5Runtime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new DeclarativeFailure('v5-runtime');
}
export function runNativeDeclarativeV5(args: string[], dependencies?: DeclarativePhaseDependencies) {
  return runDeclarativePhases(
    args,
    new URL(import.meta.url),
    {
      version: 'v5',
      protocol: DECLARATIVE_V5,
      history: { facts: DECLARATIVE_V5_HISTORY, verify: verifyDeclarativeV5History },
      validateRuntime: assertDeclarativeV5Runtime,
      readIntent: readV5Intent,
      readPrerequisites: readV5Prerequisites,
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeV5(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Declarative v5 stopped (${declarativeStopCode(error)}). Preserve every receipt; never repeat a claimed attempt.`,
    );
    process.exitCode = 1;
  }
}
