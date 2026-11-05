/** Closed protocol selection shared by fixed entry files; never a CLI resume argument. */

import {
  RUNTIME_RETAINED_PROTOCOL,
  RUNTIME_RETAINED_STAGES,
  runtimeRetainedHistory,
} from './native-runtime-retained-fixed.js';
import { RUNTIME_RETAINED_V2_PROTOCOL, runtimeRetainedV2History } from './native-runtime-retained-v2-fixed.js';
import { RUNTIME_PROTOCOL, RUNTIME_STAGES, type RuntimeStage } from './native-runtime-slice-fixed.js';
import { RUNTIME_ST05_PROTOCOL, runtimeSt05History } from './native-runtime-st05-fixed.js';
export type RuntimeProtocol = 'original' | 'retained' | 'retained-v2' | 'st05-tail';
export function runtimeProtocol(kind: RuntimeProtocol) {
  if (kind === 'st05-tail')
    return {
      retained: true,
      entry: './native-runtime-st05.ts',
      protocol: RUNTIME_ST05_PROTOCOL,
      stages: ['st05'] as readonly RuntimeStage[],
      command: 'runtime-st05',
      initialResultHash: runtimeSt05History.results.st05,
      retainedHistory: runtimeSt05History,
    };
  if (!['original', 'retained', 'retained-v2'].includes(kind)) throw new Error('Unknown fixed runtime protocol.');
  const retained = kind !== 'original',
    second = kind === 'retained-v2';
  const history = second ? runtimeRetainedV2History : runtimeRetainedHistory;
  return {
    retained,
    entry: second
      ? './native-runtime-retained-v2.ts'
      : retained
        ? './native-runtime-retained.ts'
        : './native-runtime-slice.ts',
    protocol: second ? RUNTIME_RETAINED_V2_PROTOCOL : retained ? RUNTIME_RETAINED_PROTOCOL : RUNTIME_PROTOCOL,
    stages: (retained ? RUNTIME_RETAINED_STAGES : RUNTIME_STAGES) as readonly RuntimeStage[],
    command: second ? 'runtime-retained-v2' : retained ? 'runtime-retained' : 'runtime',
    initialResultHash: retained ? history.failedQuickfixResultHash : null,
    ...(retained ? { retainedHistory: history } : {}),
  };
}
