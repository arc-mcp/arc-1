/** Only the uncompleted activation/text/deletion tail of the twice-consumed exact graph. */
import { type ProceduralInput, runProceduralWorkflow } from './native-procedural-driver.js';
import { inspectRetainedProcedural } from './native-procedural-retained-evidence.js';
export const runProceduralTail = (input: ProceduralInput) =>
  runProceduralWorkflow(input, {
    startAt: 'include-activate',
    inspect: (client, record, policy) => inspectRetainedProcedural(client, record, policy, 'after-include-edit-add'),
  });
