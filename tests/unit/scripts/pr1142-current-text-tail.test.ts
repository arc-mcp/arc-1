import { afterEach, expect, it, vi } from 'vitest';
import {
  textTailDescriptor,
  textTailPlan,
  textTailRoot,
} from '../../../scripts/qualification/pr1142/current-text-tail-history.mjs';
import {
  currentFixtureSources,
  currentSymbolsMatch,
  sha,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import { qualify } from '../../../scripts/qualification/pr1142/qualification.mjs';
import { textPartMatchesRequest } from '../../../src/adt/text-part-changes.js';
import { retainedFixture } from './pr1142-current-workflow-harness.js';

afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const f = await retainedFixture();
  f.config.root = textTailRoot;
  f.context.action.plan = textTailPlan;
  f.run.retained = textTailDescriptor;
  const program = f.manifest.fixtures[3],
    generated = currentFixtureSources(program, f.manifest.marker, f.manifest.fixtures);
  if (typeof generated.symbols !== 'string') throw new Error('fixed PROG symbols missing');
  const source = { ...generated, symbols: generated.symbols };
  f.sources.set(program.name, { source: source.updated, symbols: '' });
  f.request.tasks[0].objects.push({ pgmid: 'R3TR', type: 'PROG', name: program.name });
  f.history.proofs[program.name] = {
    kind: 'verified-pp-create',
    runId: textTailDescriptor.originalRunId,
    sourceRevision: textTailDescriptor.originalSourceRevision,
    actor: 'writerA',
    name: program.name,
    type: 'PROG',
    createReceiptHash: 'c'.repeat(64),
  };
  f.history.origins = Object.fromEntries(
    f.manifest.fixtures.map((o: any) => [
      o.name,
      o.type === 'PROG' ? textTailDescriptor.originalRunId : textTailDescriptor.prior.originalRunId,
    ]),
  );
  const original = f.native.getMockImplementation()!;
  const changes = { pool: false, heading: false, proof: false };
  f.native.mockImplementation(async (mode: string, name: string) => {
    const r: any = await original(mode, name);
    for (const e of r.fixtures)
      if (mode === 'identity' && e.type === 'PROG') {
        e.identity.createdBy = null;
        e.nativeCreatorEvidence = 'unavailable';
        e.ownedCreate = changes.proof
          ? { ...f.history.proofs[program.name], createReceiptHash: 'f'.repeat(64) }
          : f.history.proofs[program.name];
        const symbols = f.sources.get(program.name).symbols;
        e.textPool = {
          metadataHash: changes.pool ? 'changed' : 'pool',
          parts: {
            symbols: sha(symbols),
            selections: sha(''),
            headings: changes.heading ? sha('foreign') : sha('heading'),
          },
        };
      }
    return r;
  });
  f.history.expected[program.name] = structuredClone((await f.native('identity', program.name)).fixtures[0]);
  f.native.mockClear();
  return { ...f, program, source, changes };
}
it('fixed symbol fixture uses a sufficient annotation and public/native readback matches it', async () => {
  const f = await setup();
  expect(f.source.symbols).toMatch(/^@MaxLength:27\n001=[A-F0-9]{16} PP fixture\n$/);
  expect(textPartMatchesRequest('symbols', f.source.symbols, f.source.symbols)).toBe(true);
  expect(
    currentSymbolsMatch(
      f.source.symbols.replace('@MaxLength:', '@MaxLength: ').replaceAll('\n', '\r\n'),
      f.source.symbols,
    ),
  ).toBe(true);
});
it.each(['missing', 'changedLength', 'wrongValue', 'extraRow', 'duplicate', 'extraAnnotation'])(
  'readback refuses %s',
  async (kind) => {
    const f = await setup();
    let actual = f.source.symbols;
    if (kind === 'missing') actual = actual.split('\n').slice(1).join('\n');
    if (kind === 'changedLength') actual = actual.replace(':27', ':28');
    if (kind === 'wrongValue') actual = actual.replace('PP fixture', 'wrong text');
    if (kind === 'extraRow') actual += '002=unexpected\n';
    if (kind === 'duplicate') actual += actual;
    if (kind === 'extraAnnotation') actual = `@Other:true\n${actual}`;
    expect(currentSymbolsMatch(actual, f.source.symbols)).toBe(false);
  },
);
it('real router/shared McpSession sends only the unfinished text, denials and reverse PP deletion tail', async () => {
  const f = await setup(),
    result: any = await qualify(f.context);
  expect(result, JSON.stringify(f.result())).toMatchObject({ plan: textTailPlan, failure: false, remaining: [] });
  expect(f.calls.filter((c) => c.args.action === 'create' || c.tool === 'SAPActivate')).toEqual([]);
  expect(f.attempts.filter((a) => a.action === 'edit_text_symbols')).toEqual([
    expect.objectContaining({
      name: f.program.name,
      source: f.source.symbols,
      transport: f.manifest.bindings.recording.task,
    }),
  ]);
  expect(f.calls.filter((c) => c.args.action === 'delete').map((c) => [c.args.name, c.label])).toEqual(
    [...f.manifest.fixtures].reverse().map((o: any) => [o.name, o.actor]),
  );
  expect(f.result().operations).toHaveLength(9);
  expect(f.result().fixtures.every((o: any) => o.deleted)).toBe(true);
  expect(f.result().fixtures[3].retainedFrom).toBe(textTailDescriptor.originalRunId);
  expect(f.result().fixtures[0].retainedFrom).toBe(textTailDescriptor.prior.originalRunId);
  const count = f.calls.length;
  await expect(qualify(f.context)).rejects.toThrow('EEXIST');
  expect(f.calls).toHaveLength(count);
});
it.each(['source', 'metadata', 'pool', 'creator', 'proof', 'symbols'])(
  'changed retained program %s refuses before any mutation',
  async (kind) => {
    const f = await setup();
    if (kind === 'source') f.sources.get(f.program.name).source += 'foreign';
    if (kind === 'metadata') f.changed.driftNative = true;
    if (kind === 'pool') f.changes.pool = true;
    if (kind === 'symbols') f.sources.get(f.program.name).symbols = f.source.symbols;
    if (kind === 'proof') f.changes.proof = true;
    if (kind === 'creator') {
      const original = f.native.getMockImplementation()!;
      f.native.mockImplementation(async (m: string, n: string) => {
        const r: any = await original(m, n);
        if (n === f.program.name && m === 'identity') r.fixtures[0].identity.createdBy = 'FOREIGN';
        return r;
      });
    }
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.attempts).toHaveLength(0);
    expect(result.remaining).toHaveLength(4);
  },
);
it('text partial failure retains all four owners and never enters denial/delete tail', async () => {
  const f = await setup();
  f.changed.refuseAt = f.program.name;
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(r.remaining).toHaveLength(4);
  expect(f.attempts).toHaveLength(1);
  expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
});
it('unselected headings drift after text save prevents cleanup and retains historical source facts', async () => {
  const f = await setup(),
    original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (url: any, init: any) => {
    const r = await original(url, init);
    if (JSON.parse(init.body).params?.arguments?.action === 'edit_text_symbols') f.changes.heading = true;
    return r;
  });
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.result().error.code).toBe('TEXT_TAIL_UNSELECTED_PART_CHANGED');
  expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  expect(r.remaining).toHaveLength(4);
});
it('history drift at final text handoff prevents dispatch with all four retained', async () => {
  const f = await setup();
  f.context.currentDependencies.retainedSendProof = () => {
    if (f.result()?.operations.at(-1)?.phase === `text-${f.program.name}`) throw new Error('history changed');
  };
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.attempts).toHaveLength(0);
  expect(r.remaining).toHaveLength(4);
});
it.each(['root', 'plan', 'descriptor', 'resume'])('fixed tail refuses arbitrary %s before a claim', async (kind) => {
  const f = await setup();
  if (kind === 'root') f.config.root = '/private/other';
  if (kind === 'plan') f.context.action.plan = 'current-pp-workflows-v1';
  if (kind === 'descriptor') f.run.retained = { ...textTailDescriptor, originalRunId: 'foreign' };
  if (kind === 'resume') f.context.action.resume = 'delete';
  await expect(qualify(f.context)).rejects.toThrow();
  expect(f.attempts).toHaveLength(0);
  expect(f.files.has('current-workflow-claim.json')).toBe(false);
});
it('the retained PROG must already be recorded under the exact existing request/task', async () => {
  const f = await setup();
  f.request.tasks[0].objects = f.request.tasks[0].objects.filter((o: any) => o.name !== f.program.name);
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(f.attempts).toHaveLength(0);
  expect(r.remaining).toHaveLength(4);
});
it('an acknowledged PROG delete with unknown native absence retains it and stops before the INCL', async () => {
  const f = await setup(),
    original = f.native.getMockImplementation()!;
  f.native.mockImplementation(async (mode: string, name: string) => {
    if (mode === 'absence' && name === f.program.name) throw new Error('absence uncertain');
    return original(mode, name);
  });
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(r.remaining).toHaveLength(4);
  expect(f.calls.filter((c) => c.args.action === 'delete')).toHaveLength(1);
  expect(f.result().fixtures[3]).toMatchObject({ deleted: false, deletionAcknowledged: true });
});
it('a later cleanup refusal preserves the confirmed PROG deletion and exact three residual owners', async () => {
  const f = await setup();
  f.changed.refuseAt = f.manifest.fixtures[2].name;
  const r: any = await qualify(f.context);
  expect(r.failure).toBe(true);
  expect(r.remaining.map((o: any) => o.name)).toEqual(f.manifest.fixtures.slice(0, 3).map((o: any) => o.name));
  expect(f.result().fixtures[3]).toMatchObject({ deleted: true, deletionAcknowledged: true });
  expect(f.calls.filter((c) => c.args.action === 'delete')).toHaveLength(2);
});
