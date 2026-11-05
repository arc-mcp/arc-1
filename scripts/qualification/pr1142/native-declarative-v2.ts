/** Fixed v2 qualification entry; no caller-selected protocol, root, fixtures or native operation. */
import { assertDeclarativeRuntime, declarativeStopCode, isDirectEntry } from './native-declarative-entry.js';
import { runDeclarativePhases, type DeclarativePhaseDependencies } from './native-declarative-phases.js';
import {
  DECLARATIVE_V2,
  DECLARATIVE_V2_NODE,
  readV2Intent,
  readV2Prerequisites,
} from './native-declarative-v2-intent.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
export function assertDeclarativeV2Runtime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== DECLARATIVE_V2_NODE || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new DeclarativeFailure('v2-runtime');
}
export function runNativeDeclarativeV2(args: string[], dependencies?: DeclarativePhaseDependencies) {
  return runDeclarativePhases(
    args,
    new URL(import.meta.url),
    {
      version: 'v2',
      protocol: DECLARATIVE_V2,
      validateRuntime: assertDeclarativeV2Runtime,
      readIntent: readV2Intent,
      readPrerequisites: readV2Prerequisites,
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeV2(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Declarative v2 stopped (${declarativeStopCode(error)}). Preserve every receipt; never repeat a claimed attempt.`,
    );
    process.exitCode = 1;
  }
}
