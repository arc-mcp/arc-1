/** Fixed consumed graph only. No source-changing prefix is replayed. */
import { type ProceduralInput, runProceduralWorkflow } from './native-procedural-driver.js';
import { inspectRetainedProcedural } from './native-procedural-retained-evidence.js';
export const runRetainedProcedural = (input: ProceduralInput) =>
  runProceduralWorkflow(input, { inspect: inspectRetainedProcedural });
