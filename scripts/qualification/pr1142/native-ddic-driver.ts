/** Historical fixed DOMA→DTEL profile; fixture/stage and native evidence contracts are unchanged. */
import { ddicAbsence, ddicSnapshot } from './native-ddic-evidence.js';
import { DDIC_STAGES, type DdicFixture, type DdicStage, ddicFixtures } from './native-ddic-fixtures.js';
import { checkDdicRequest, ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';

export { ddicConfig, ddicSafety } from './native-ddic-workflow.js';
export type DdicRunInput = DdicWorkflowInput<DdicFixture>;
export async function runNativeDdic(input: DdicRunInput) {
  const { fixtures } = input;
  if (fixtures.length !== 2 || JSON.stringify(fixtures) !== JSON.stringify(ddicFixtures(fixtures[0].name.slice(-16))))
    throw new Error('The exact fixed DDIC fixture graph is required.');
  return runFixedDdicWorkflow(input, {
    stages: DDIC_STAGES,
    snapshot: ddicSnapshot,
    absence: ddicAbsence,
    check: (f, selected, stage, m, p, b) => checkDdicRequest(f, selected, stage as DdicStage | undefined, m, p, b),
    unlock: ddicUnlock,
    source: () => false,
    postCreateCleanup: (f) => f.type === 'DTEL',
    changedPaths: (f) =>
      f.type === 'DOMA'
        ? ['@adtcore:description']
        : ['/dtel:dataElement/dtel:shortFieldLabel', '/dtel:dataElement/dtel:shortFieldLength'],
  });
}
