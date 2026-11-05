import { assertRetainedObservation } from './current-retained-history.mjs';
import { requireEvidence, sha } from './current-workflow-contract.mjs';

/** Two exact observed lexical documents, not a general metadata normalization rule. */
export function proveOwnedIncludeRelationship(before, withProgram, include, program) {
  requireEvidence(
    typeof before === 'string' &&
      typeof withProgram === 'string' &&
      before.length < 65536 &&
      withProgram.length < 65536 &&
      include.type === 'INCL' &&
      program.type === 'PROG' &&
      include.actor === program.actor &&
      include.package === program.package &&
      /^[A-Z0-9_]+$/.test(include.name) &&
      /^[A-Z0-9_]+$/.test(program.name),
    'TEXT_V2_RELATIONSHIP_INPUT',
  );
  const own = `/sap/bc/adt/textelements/programs/${include.name.toLowerCase()}`,
    parent = `/sap/bc/adt/textelements/programs/${program.name.toLowerCase()}`,
    reference = `<include:contextRef adtcore:uri="/sap/bc/adt/programs/programs/${program.name.toLowerCase()}" adtcore:type="PROG/P" adtcore:name="${program.name}" adtcore:packageName="${program.package}" adtcore:description="PR1142 current PP owned workflow"/>`;
  const once = (value, fragment) => value.split(fragment).length === 2;
  requireEvidence(
    !before.includes('<include:contextRef ') &&
      once(before, 'include:contextRefCount="0"') &&
      once(withProgram, reference) &&
      once(withProgram, 'include:contextRefCount="1"') &&
      once(before, `href="${own}"`) &&
      once(withProgram, `href="${parent}"`) &&
      withProgram
        .replace(reference, '')
        .replace('include:contextRefCount="1"', 'include:contextRefCount="0"')
        .replace(`href="${parent}"`, `href="${own}"`) === before,
    'TEXT_V2_RELATIONSHIP_CHANGED',
  );
  return {
    withoutProgramHash: sha(before),
    withProgramHash: sha(withProgram),
    include: include.name,
    program: program.name,
  };
}

/** Only this run's acknowledged parent DELETE plus typed absence permits the zero-context state. */
export function programDeletionConfirmed(history, { journal, run, manifest }) {
  requireEvidence(
    journal?.runId === run?.runId &&
      journal?.sourceRevision === run?.sourceRevision &&
      journal?.harnessSha256 === run?.harnessSha256 &&
      journal?.manifestSha256 === sha(manifest) &&
      Array.isArray(journal?.operations) &&
      Array.isArray(journal?.fixtures),
    'TEXT_V2_CURRENT_JOURNAL_BINDING',
  );
  const program = manifest.fixtures[3],
    entries = journal.fixtures.filter((f) => f.name === program.name && f.type === 'PROG'),
    deletes = journal.operations.filter((o) => o.args?.action === 'delete' && o.args.name === program.name);
  requireEvidence(
    program.name === history.includeRelationship.program && entries.length === 1,
    'TEXT_V2_PARENT_CHANGED',
  );
  const entry = entries[0];
  if (!deletes.length && !entry.deleted && !entry.deletionAcknowledged && !entry.absenceEvidence)
    return false;
  const deletion = deletes[0],
    absence = entry.absenceEvidence;
  requireEvidence(
    deletes.length === 1 &&
      journal.operations.at(-1) === deletion &&
      entry.deleted === true &&
      entry.deletionAcknowledged === true &&
      deletion.phase === `delete-${program.name}` &&
      deletion.tool === 'SAPWrite' &&
      deletion.args.type === 'PROG' &&
      deletion.args.transport === manifest.bindings.recording.task &&
      deletion.outcome === 'response-received' &&
      deletion.isError === false &&
      deletion.result?.state === 'deleted' &&
      deletion.result.ok === true &&
      deletion.result.cleanupFailed !== true &&
      absence?.status === 'complete' &&
      absence.mode === 'absence' &&
      absence.runId === run.runId &&
      absence.sourceRevision === run.sourceRevision &&
      absence.manifestSha256 === sha(manifest) &&
      absence.fixtures?.length === 1 &&
      absence.fixtures[0].name === program.name &&
      absence.fixtures[0].type === 'PROG' &&
      absence.fixtures[0].absent === true &&
      absence.fixtures[0].absence === 'ExceptionResourceNotFound',
    'TEXT_V2_PARENT_ABSENCE_REQUIRED',
  );
  return true;
}

export function assertTextTailV2Observation(history, fixture, observed, context) {
  let selected = history;
  if (fixture.type === 'INCL') {
    const removed = programDeletionConfirmed(history, context);
    selected = {
      ...history,
      expected: {
        ...history.expected,
        [fixture.name]: {
          ...history.expected[fixture.name],
          metadataHash: removed
            ? history.includeRelationship.withoutProgramHash
            : history.includeRelationship.withProgramHash,
        },
      },
    };
  }
  const value = assertRetainedObservation(selected, fixture, observed);
  if (fixture.type === 'PROG')
    requireEvidence(
      sha(value.textPool) === sha(history.expected[fixture.name].textPool),
      'TEXT_TAIL_POOL_CHANGED',
    );
  return value;
}

export function assertTextTailV2BeforeDelete(history, fixture, observed, context) {
  const entry = context.journal.fixtures.find((f) => f.name === fixture.name);
  if (fixture.type !== 'INCL') {
    requireEvidence(sha(observed) === sha(entry.nativeIdentity), 'CURRENT_OWNER_CHANGED_BEFORE_DELETE');
    return;
  }
  requireEvidence(programDeletionConfirmed(history, context), 'TEXT_V2_PARENT_ABSENCE_REQUIRED');
  assertTextTailV2Observation(history, fixture, { fixtures: [observed] }, context);
  requireEvidence(
    entry.nativeIdentity.metadataHash === history.includeRelationship.withProgramHash &&
      sha({ ...observed, metadataHash: entry.nativeIdentity.metadataHash }) === sha(entry.nativeIdentity),
    'TEXT_V2_INCLUDE_CHANGED_BEFORE_DELETE',
  );
}
