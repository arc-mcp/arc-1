/** Only the uncompleted fixed tail; the retained class is never created or saved again. */
import { runRetainedRuntimeQuickfix } from './native-runtime-quickfix.js';
import type { RuntimeInput } from './native-runtime-slice-context.js';
import { runRuntimeSlice } from './native-runtime-slice-driver.js';
import { RuntimeFailure } from './native-runtime-slice-fixed.js';
export function runRetainedRuntimeSlice(input: RuntimeInput) {
  if (input.stage === 'formatter') throw new RuntimeFailure('stage');
  return input.stage === 'quickfix' ? runRetainedRuntimeQuickfix(input) : runRuntimeSlice(input);
}
