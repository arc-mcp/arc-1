/** Private server-driven profile: registry body/MIME contract over the shared owning-lock lifecycle. */
import { withLockedMutation } from '../../adt/crud.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedDdicSelection, readPinnedDdicEvidence } from '../../adt/pinned-ddic-owner.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import {
  buildServerDrivenMetadataXml,
  requireServerDrivenSupport,
  serverDrivenMetadataContentType,
  serverDrivenSourceContentType,
  serverDrivenSourceFormat,
} from '../../adt/server-driven.js';
import { assertSourceHash, editableSourceEquals, sourceHash } from '../../adt/source-precondition.js';
import { parseUiadSource, type UiadValidation, uiadValidationSummary, validateUiadSource } from '../../adt/uiad.js';
import { type ToolResult, textResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { assertCreationStepCleanup, createRepositoryObject, prepareCreationRecording } from './creation.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';

/** Saved active by SAP: there is no separate review-before-activation step (plan section 4). */
const IMMEDIATE_ACTIVE = new Set(['APLO', 'UIAD']);

const hasSource = (ctx: SapWriteContext) => typeof ctx.args.source === 'string' && ctx.args.source.trim() !== '';

function validatedSource(ctx: SapWriteContext): string {
  const source = String(ctx.args.source);
  if (serverDrivenSourceFormat(ctx.type) === 'json') {
    try {
      JSON.parse(source);
    } catch {
      throw new AdtSafetyError(`${ctx.type} source must be valid AFF JSON. No request was changed.`);
    }
  }
  return source;
}

/**
 * Index source reads must name the draft (an unversioned read can hide another user's); other types
 * retain their verified developer view.
 */
function sourceReadUrl(ctx: SapWriteContext): string {
  return `${ctx.objectUrl}/source/main${ctx.type === 'TABL/DTI' ? '?version=inactive' : ''}`;
}

async function readSource(ctx: SapWriteContext, http: AdtHttpClient): Promise<string> {
  checkOperation(ctx.client.safety, OperationType.Read, 'PinnedServerDrivenSource');
  const response = await http.get(
    sourceReadUrl(ctx),
    { Accept: serverDrivenSourceContentType(ctx.type), 'Cache-Control': 'no-cache' },
    { responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'server-driven-source', true) },
  );
  return response.body;
}

/** SAP may add AFF defaults; everything submitted must survive with the same value and array order. */
function jsonContains(expected: unknown, stored: unknown, ignore: (path: string) => boolean, path = ''): boolean {
  if (ignore(path)) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(stored) &&
      stored.length === expected.length &&
      expected.every((item, index) => jsonContains(item, stored[index], ignore, `${path}/${index}`))
    );
  if (expected && typeof expected === 'object') {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
    const record = stored as Record<string, unknown>;
    return Object.entries(expected).every(([key, value]) => jsonContains(value, record[key], ignore, `${path}/${key}`));
  }
  return expected === stored;
}

function savedSourceMatches(ctx: SapWriteContext, requested: string, stored: string): boolean {
  if (serverDrivenSourceFormat(ctx.type) !== 'json') return editableSourceEquals(stored, requested);
  try {
    // 758 ignores header description edits in a source PUT (docs/research/2026-10-12-table-indexes.md).
    const ignore = (path: string) => ctx.type === 'TABL/DTI' && path === '/header/description';
    return jsonContains(JSON.parse(requested), JSON.parse(stored), ignore);
  } catch {
    return false;
  }
}

async function saveSource(ctx: SapWriteContext, source: string, expectedHash?: string): Promise<void> {
  const state = pinnedSourceState(ctx);
  const { client, objectUrl } = ctx;
  const { context, recording, pkg } = state;
  if (!pkg || !recording)
    throw new AdtSafetyError('The source save requires verified package and recording preflight.');
  const policy = pinnedSourceLockPolicy(client, context, objectUrl, pkg, recording, (phase) => {
    state.phase = phase;
  });
  await withLockedMutation(client.http, client.safety, context, objectUrl, policy, async (session, lock) => {
    state.phase = 'source-read';
    const current = await readSource(ctx, session);
    assertSourceHash(current, expectedHash, sourceReadUrl(ctx));
    state.readVerified = true;
    state.readHash = sourceHash(current);
    checkOperation(client.safety, OperationType.Update, 'PinnedServerDrivenSave');
    throwIfRequestCancelled(context.requestPolicy);
    state.phase = 'source-save';
    state.state = state.createdOwner ? 'created-source-unknown' : 'source-save-unknown';
    state.writeAttempted = true;
    const params = new URLSearchParams({ lockHandle: lock.lockHandle });
    if (recording.request) params.set('corrNr', recording.request);
    await session.put(`${objectUrl}/source/main?${params}`, source, serverDrivenSourceContentType(ctx.type));
    state.phase = 'source-readback';
    const saved = await readSource(ctx, session);
    if (!savedSourceMatches(ctx, source, saved))
      throw new AdtSafetyError('Save returned, but the source read-back did not contain the requested definition.');
    state.sourceHash = sourceHash(saved);
    if (IMMEDIATE_ACTIVE.has(ctx.type)) {
      state.phase = 'immediate-active-verification';
      const metadata = await readPinnedDdicEvidence(
        mutationClient(client, context, session),
        pinnedDdicSelection(ctx.type, ctx.name),
      );
      if (metadata.version !== 'active')
        throw new AdtSafetyError(`${ctx.type} saves are expected to be active, but SAP reports ${metadata.version}.`);
      state.state = 'saved-active';
    } else state.state = 'saved-inactive';
  });
}

async function assertUiadCandidate(ctx: SapWriteContext, create: boolean): Promise<string | undefined> {
  if (ctx.type !== 'UIAD') return undefined;
  const state = pinnedSourceState(ctx);
  let languageVersion: string | undefined;
  let validation: UiadValidation = { schema: 'notRun', semantic: 'notRun', configuration: 'notRun', issues: [] };
  if (hasSource(ctx)) {
    let parsed: ReturnType<typeof parseUiadSource>;
    try {
      parsed = parseUiadSource(String(ctx.args.source));
    } catch {
      throw new AdtSafetyError('UIAD source must be a bounded AFF JSON object with a supported language version.');
    }
    languageVersion = parsed.languageVersion;
    state.phase = 'candidate-validation';
    validation = await validateUiadSource(
      ctx.client.http,
      ctx.client.safety,
      ctx.objectUrl,
      String(ctx.args.source),
      parsed.value,
      create,
    );
    if (validation.configuration === 'readonly')
      throw new AdtSafetyError('SAP marks this UIAD read-only. Edit its deployment source instead.');
    if (validation.schema === 'failed' || validation.semantic === 'failed')
      throw new AdtSafetyError('UIAD candidate validation found errors. No mutation was sent.');
  }
  state.serverDriven = {
    immediateActive: true,
    validation: uiadValidationSummary(validation, ctx.config.minimalErrors),
  };
  return languageVersion;
}

async function resolveCreatePackage(ctx: SapWriteContext): Promise<string> {
  const { client, args } = ctx;
  if (ctx.type !== 'TABL/DTI') {
    if (typeof args.package !== 'string' || !args.package)
      throw new AdtSafetyError('Creation requires an explicit package.');
    await checkPackage(client.safety, args.package, client.getPackageHierarchyResolver());
    return args.package;
  }
  // An index inherits its package: the caller's value can only confirm the parent table's native package.
  const parent = pinnedDdicSelection('TABL/DTI', ctx.name).parent!;
  const pkg = await readPinnedDdicEvidence(client, pinnedDdicSelection('TABL/DT', parent.name)).then(
    (table) => table.packageName,
  );
  if (args.package !== undefined && args.package !== pkg)
    throw new AdtSafetyError(`The index inherits package ${pkg} from its parent table; the requested package differs.`);
  return pkg;
}

function creationProperties(ctx: SapWriteContext, source: string | undefined) {
  if (ctx.type !== 'SAJC' && ctx.type !== 'SAJT') return undefined;
  const field = ctx.type === 'SAJC' ? 'className' : 'catalogName';
  const reference = source ? JSON.parse(source)?.generalInformation?.[field] : undefined;
  if (typeof reference !== 'string' || !reference.trim())
    throw new AdtSafetyError(
      `Creating ${ctx.type} requires source.generalInformation.${field} in the AFF JSON source.`,
    );
  return { [field]: reference };
}

async function createPinnedServerDriven(ctx: SapWriteContext): Promise<void> {
  const state = pinnedSourceState(ctx);
  const source = hasSource(ctx) ? validatedSource(ctx) : undefined;
  if (ctx.type === 'APLO' && ctx.name.length > 20)
    throw new AdtSafetyError('APLO names must be at most 20 characters.');
  const properties = creationProperties(ctx, source);
  state.phase = 'package-preflight';
  const pkg = await resolveCreatePackage(ctx);
  const uiadLanguage = await assertUiadCandidate(ctx, true);
  const recording = await prepareCreationRecording(ctx, pkg);
  await createRepositoryObject(ctx, {
    url: ctx.objectUrl.replace(/\/[^/]+$/, ''),
    body: buildServerDrivenMetadataXml(
      ctx.type,
      ctx.name,
      pkg,
      String(ctx.args.description ?? ctx.name),
      uiadLanguage as Parameters<typeof buildServerDrivenMetadataXml>[4],
      properties,
    ),
    contentType: serverDrivenMetadataContentType(ctx.type),
    transport: recording.transport,
  });
  assertCreationStepCleanup(ctx);
  if (source !== undefined) {
    await saveSource(ctx, source);
    assertCreationStepCleanup(ctx);
    return;
  }
  // A metadata-only shell has no save to verify: read its identity and generated source back.
  state.phase = 'source-readback';
  await readPinnedDdicEvidence(ctx.client, pinnedDdicSelection(ctx.type, ctx.name));
  const generated = await readSource(ctx, ctx.client.http);
  state.readVerified = true;
  state.sourceHash = sourceHash(generated);
  state.state = 'created';
}

export async function writePinnedServerDriven(ctx: SapWriteContext): Promise<ToolResult> {
  const state = pinnedSourceState(ctx);
  state.serverDriven = { immediateActive: IMMEDIATE_ACTIVE.has(ctx.type) };
  state.phase = 'discovery';
  await requireServerDrivenSupport(ctx.client.http, ctx.client.safety, ctx.type);
  if (ctx.args.action === 'create') await createPinnedServerDriven(ctx);
  else {
    if (!hasSource(ctx)) throw new AdtSafetyError(`Updating ${ctx.type} requires complete replacement source.`);
    const source = validatedSource(ctx);
    await ctx.enforcePackageForExistingObject();
    await assertUiadCandidate(ctx, false);
    await saveSource(ctx, source, ctx.args.expectedSourceHash as string);
  }
  return textResult('');
}
