import { afterEach, expect, it, vi } from 'vitest';
import {
  retainedProfileForRoot,
  textTailV2Profile,
} from '../../../scripts/qualification/pr1142/current-retained-profiles.mjs';
import { proveOwnedIncludeRelationship } from '../../../scripts/qualification/pr1142/current-text-tail-v2-context.mjs';
import {
  textTailV2Descriptor,
  textTailV2Plan,
  textTailV2Root,
} from '../../../scripts/qualification/pr1142/current-text-tail-v2-history.mjs';
import { currentFixtureSources, sha } from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import { qualify } from '../../../scripts/qualification/pr1142/qualification.mjs';
import { retainedFixture } from './pr1142-current-workflow-harness.js';

afterEach(() => vi.unstubAllGlobals());

// Sanitized lexical structure of the observed transition; complete native bodies are replayed externally.
const include = { name: 'ZARC1_PP_I_TEST', type: 'INCL', actor: 'writerA', package: 'ZARC1_TEST' };
const program = { name: 'ZARC1_PP_P_TEST', type: 'PROG', actor: 'writerA', package: 'ZARC1_TEST' };
const before =
  '<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="http://www.sap.com/adt/core" xmlns:atom="http://www.w3.org/2005/Atom" include:contextRefCount="0" adtcore:name="ZARC1_PP_I_TEST"><atom:link rel="http://www.sap.com/adt/relations/sources/textelements" href="/sap/bc/adt/textelements/programs/zarc1_pp_i_test"/><adtcore:packageRef adtcore:name="ZARC1_TEST"/></include:abapInclude>';
const reference =
  '<include:contextRef adtcore:uri="/sap/bc/adt/programs/programs/zarc1_pp_p_test" adtcore:type="PROG/P" adtcore:name="ZARC1_PP_P_TEST" adtcore:packageName="ZARC1_TEST" adtcore:description="PR1142 current PP owned workflow"/>';
const after = before
  .replace('contextRefCount="0"', 'contextRefCount="1"')
  .replace('programs/zarc1_pp_i_test', 'programs/zarc1_pp_p_test')
  .replace('</include:abapInclude>', `${reference}</include:abapInclude>`);
it('proves exactly the three observed lexical changes while retaining complete raw hashes', () => {
  expect(proveOwnedIncludeRelationship(before, after, include, program)).toEqual({
    withoutProgramHash: sha(before),
    withProgramHash: sha(after),
    include: include.name,
    program: program.name,
  });
});
it.each(['foreign', 'extra', 'moved', 'link', 'package', 'opaque', 'count', 'namespace'])(
  'refuses %s relationship drift',
  (kind) => {
    let value = after;
    if (kind === 'foreign') value = value.replace('adtcore:name="ZARC1_PP_P_TEST"', 'adtcore:name="ZFOREIGN"');
    if (kind === 'extra') value = value.replace(reference, reference + reference);
    if (kind === 'moved') value = value.replace(reference, `<opaque>${reference}</opaque>`);
    if (kind === 'link')
      value = value.replace(
        'href="/sap/bc/adt/textelements/programs/zarc1_pp_p_test"',
        'href="/sap/bc/adt/textelements/programs/foreign"',
      );
    if (kind === 'package') value = value.replace('adtcore:packageName="ZARC1_TEST"', 'adtcore:packageName="FOREIGN"');
    if (kind === 'opaque')
      value = value.replace('/></include:abapInclude>', ' other="changed"/></include:abapInclude>');
    if (kind === 'count') value = value.replace('contextRefCount="1"', 'contextRefCount="2"');
    if (kind === 'namespace') value = value.replace('http://www.sap.com/adt/programs/includes', 'urn:foreign');
    expect(() => proveOwnedIncludeRelationship(before, value, include, program)).toThrow();
  },
);

async function setup() {
  const f = await retainedFixture();
  f.config.root = textTailV2Root;
  f.context.action.plan = textTailV2Plan;
  f.run.retained = textTailV2Descriptor;
  const program = f.manifest.fixtures[3],
    include = f.manifest.fixtures[2];
  const generated = currentFixtureSources(program, f.manifest.marker, f.manifest.fixtures);
  f.sources.set(program.name, { source: generated.updated, symbols: '' });
  f.request.tasks[0].objects.push({ pgmid: 'R3TR', type: 'PROG', name: program.name });
  f.history.proofs[program.name] = {
    kind: 'verified-pp-create',
    runId: textTailV2Descriptor.prior.originalRunId,
    sourceRevision: textTailV2Descriptor.prior.originalSourceRevision,
    actor: 'writerA',
    name: program.name,
    type: 'PROG',
    createReceiptHash: 'c'.repeat(64),
  };
  f.history.includeRelationship = {
    include: include.name,
    program: program.name,
    withoutProgramHash: 'without',
    withProgramHash: 'with',
  };
  f.history.expected[include.name].metadataHash = 'with';
  const original = f.native.getMockImplementation()!;
  const changes = {
    context: '',
    uncertainAbsence: false,
    wrongAbsence: false,
    droppedProof: false,
    changedSource: false,
    changedIdentity: false,
  };
  f.native.mockImplementation(async (mode: string, name: string) => {
    if (mode === 'absence' && name === program.name && changes.uncertainAbsence) throw new Error('uncertain');
    const r: any = await original(mode, name);
    r.mode = mode;
    for (const entry of r.fixtures) {
      if (mode === 'absence') entry.absence = changes.wrongAbsence ? 'generic404' : 'ExceptionResourceNotFound';
      if (mode === 'identity' && entry.type === 'PROG') {
        entry.identity.createdBy = null;
        entry.nativeCreatorEvidence = 'unavailable';
        entry.ownedCreate = f.history.proofs[program.name];
        entry.textPool = {
          metadataHash: 'pool',
          parts: {
            symbols: sha(f.sources.get(program.name).symbols),
            selections: sha(''),
            headings: sha('heading'),
          },
        };
      }
      if (mode === 'identity' && entry.type === 'INCL') {
        entry.metadataHash = changes.context || (f.sources.has(program.name) ? 'with' : 'without');
        if (changes.changedSource) entry.sourceHash = 'foreign';
        if (changes.changedIdentity) entry.identity.package = 'foreign';
        if (changes.droppedProof && f.result()?.fixtures[3].deleted) delete f.result().fixtures[3].absenceEvidence;
        // This is the real shared assertion used by the native child, not a canned passing observation.
        textTailV2Profile.assertObservation(f.history, include, r, {
          journal: f.result(),
          run: f.run,
          manifest: f.manifest,
        });
      }
    }
    return r;
  });
  f.history.expected[program.name] = structuredClone((await f.native('identity', program.name)).fixtures[0]);
  f.native.mockClear();
  return { ...f, program, include, changes };
}
it('registers a distinct new fixed root and runs only text, denials and owning reverse deletion', async () => {
  const f = await setup();
  expect(retainedProfileForRoot(textTailV2Root)).toBe(textTailV2Profile);
  const result: any = await qualify(f.context);
  expect(result, JSON.stringify(f.result())).toMatchObject({ plan: textTailV2Plan, failure: false, remaining: [] });
  expect(f.calls.some((c) => c.args.action === 'create' || c.tool === 'SAPActivate')).toBe(false);
  expect(f.calls.filter((c) => c.args.action === 'delete').map((c) => c.args.name)).toEqual(
    [...f.manifest.fixtures].reverse().map((o: any) => o.name),
  );
  expect(f.result().fixtures[3].absenceEvidence.fixtures[0].absence).toBe('ExceptionResourceNotFound');
  const count = f.calls.length;
  await expect(qualify(f.context)).rejects.toThrow('EEXIST');
  expect(f.calls).toHaveLength(count);
});
it.each(['without', 'foreign'])('refuses %s context before any mutation', async (context) => {
  const f = await setup();
  f.changes.context = context;
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.attempts).toHaveLength(0);
  expect(r.remaining).toHaveLength(4);
});
it.each(['uncertainAbsence', 'wrongAbsence', 'droppedProof'] as const)(
  'refuses include deletion with %s after one parent deletion',
  async (kind) => {
    const f = await setup();
    f.changes[kind] = true;
    const r: any = await qualify(f.context);
    expect(r.failure).toBe(true);
    expect(f.calls.filter((c) => c.args.action === 'delete').map((c) => c.args.name)).toEqual([f.program.name]);
    expect(r.remaining.some((o: any) => o.name === f.include.name)).toBe(true);
    if (kind !== 'droppedProof') expect(f.result().fixtures[3].deleted).toBe(false);
  },
);
it.each(['source', 'identity', 'with', 'foreign'])('refuses %s drift after parent cleanup', async (kind) => {
  const f = await setup(),
    original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url: any, init: any) => {
    const r = await original(url, init),
      args = JSON.parse(init.body).params?.arguments;
    if (args?.action === 'delete' && args.name === f.program.name) {
      if (kind === 'source') f.changes.changedSource = true;
      else if (kind === 'identity') f.changes.changedIdentity = true;
      else f.changes.context = kind;
    }
    return r;
  });
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.calls.filter((c) => c.args.action === 'delete')).toHaveLength(1);
  expect(r.remaining.map((o: any) => o.name)).toEqual(f.manifest.fixtures.slice(0, 3).map((o: any) => o.name));
});
it('source/history drift at final text dispatch refuses without native mutation', async () => {
  const f = await setup();
  f.context.currentDependencies.retainedSendProof = () => {
    if (f.result()?.operations.at(-1)?.phase === `text-${f.program.name}`) throw new Error('history changed');
  };
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.attempts).toHaveLength(0);
});
