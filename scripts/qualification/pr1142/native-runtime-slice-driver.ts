/** Fixed dispatch only; no argument can add a native phase or select an owner. */

import { runRuntimeFormatter, runRuntimeProfiler, runRuntimeSt05 } from './native-runtime-controls.js';
import { runRuntimePopulatedFlp } from './native-runtime-populated-flp.js';
import { runRuntimeQuickfix } from './native-runtime-quickfix.js';
import type { RuntimeInput } from './native-runtime-slice-context.js';
import { RuntimeFailure } from './native-runtime-slice-fixed.js';
export async function runRuntimeSlice(input: RuntimeInput) {
  switch (input.stage) {
    case 'formatter':
      return runRuntimeFormatter(input);
    case 'quickfix':
      return runRuntimeQuickfix(input);
    case 'profiler':
      return runRuntimeProfiler(input);
    case 'populated-flp':
      return runRuntimePopulatedFlp(input);
    case 'st05':
      return runRuntimeSt05(input);
    default:
      throw new RuntimeFailure('stage');
  }
}
