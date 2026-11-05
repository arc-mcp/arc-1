/** Fixed v3 qualification entry; no caller-selected protocol, root, fixtures or native operation. */
import { assertDeclarativeRuntime, declarativeStopCode, isDirectEntry } from './native-declarative-entry.js';
import { runDeclarativePhases, type DeclarativePhaseDependencies } from './native-declarative-phases.js';
import {
  DECLARATIVE_V3,
  DECLARATIVE_V3_NODE,
  readV3Intent,
  readV3Prerequisites,
} from './native-declarative-v3-evidence.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
export function assertDeclarativeV3Runtime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== DECLARATIVE_V3_NODE || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new DeclarativeFailure('v3-runtime');
}
export function runNativeDeclarativeV3(args: string[], dependencies?: DeclarativePhaseDependencies) {
  return runDeclarativePhases(
    args,
    new URL(import.meta.url),
    {
      version: 'v3',
      protocol: DECLARATIVE_V3,
      validateRuntime: assertDeclarativeV3Runtime,
      readIntent: readV3Intent,
      readPrerequisites: readV3Prerequisites,
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeV3(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Declarative v3 stopped (${declarativeStopCode(error)}). Preserve every receipt; never repeat a claimed attempt.`,
    );
    process.exitCode = 1;
  }
}
