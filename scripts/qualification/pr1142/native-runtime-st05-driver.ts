/** The only remaining native stage; historical class/FLP/profiler operations cannot be replayed. */
import { runRuntimeSt05 } from './native-runtime-controls.js';
import type { RuntimeInput } from './native-runtime-slice-context.js';
import { RuntimeFailure } from './native-runtime-slice-fixed.js';
import { runtimeSt05History } from './native-runtime-st05-fixed.js';
export function runRetainedSt05(input: RuntimeInput) {
  if (input.stage !== 'st05') throw new RuntimeFailure('stage');
  return runRuntimeSt05(input, runtimeSt05History.baselineHash);
}
