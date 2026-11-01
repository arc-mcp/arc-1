/** Request-owned state for class actions that enter the shared action handlers. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedOwner, type PinnedRecording, pinnedRecording } from '../../adt/pinned-write-policy.js';
import type { ServerConfig } from '../../server/types.js';
import {
  type ClassWriteInclude,
  detectLocalHandlerInclude,
  normalizeClassWriteInclude,
  objectUrlForType,
} from '../object-types.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { isClassSurgeryAction } from './class-surgery-dispatch.js';
import type { SapWriteContext } from './context.js';

export interface PinnedClassState {
  readonly context: PinnedMutationContext;
  readonly sourceUrl: string;
  readonly include?: ClassWriteInclude;
  readonly wholeIncludeReplacement: boolean;
  includeInitialized?: boolean;
  phase: string;
  state: string;
  pkg?: string;
  recording?: PinnedRecording;
  sourceHash?: string;
  warnings?: string;
  readVerified: boolean;
  readHash?: string;
  unchangedConfirmed?: boolean;
  writeAttempted: boolean;
}
// Transient call state, never indexed by target/user and never reused across requests.
const states = new WeakMap<SapWriteContext, PinnedClassState>();

export function createPinnedClassContext(
  original: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
): SapWriteContext {
  assertMutationContext(original.safety, context);
  assertPinnedOwner(args.type, args.name);
  if (
    (!isClassSurgeryAction(args.action) && !(args.action === 'update' && args.include !== undefined)) ||
    args.type !== 'CLAS'
  )
    throw new AdtSafetyError('Only the admitted class surgery adapter is available.');
  const needsMethod = !['edit_class_definition', 'update'].includes(String(args.action));
  if (needsMethod && (typeof args.method !== 'string' || !args.method.trim()))
    throw new AdtSafetyError('A method name or add_method declaration is required.');
  const method = typeof args.method === 'string' ? args.method.trim() : undefined;
  const include = normalizeClassWriteInclude(args.include);
  if (args.include !== undefined && !include)
    throw new AdtSafetyError('Select a supported class include or omit include for main source.');
  if (args.include !== undefined && !['edit_method', 'update', 'edit_class_definition'].includes(String(args.action)))
    throw new AdtSafetyError('This metadata surgery adapter selects main source only.');
  const wholeIncludeReplacement = !!include && ['update', 'edit_class_definition'].includes(String(args.action));
  const selectedInclude = include ?? (args.action === 'edit_method' ? detectLocalHandlerInclude(method!) : undefined);
  const needsSource = ['update', 'edit_method', 'edit_class_definition', 'edit_method_signature'].includes(
    String(args.action),
  );
  if (
    needsSource &&
    (typeof args.source !== 'string' ||
      (!args.source.trim() &&
        (!wholeIncludeReplacement || args.source !== '' || typeof args.expectedSourceHash !== 'string')))
  )
    throw new AdtSafetyError(
      wholeIncludeReplacement
        ? 'Include source is required; source="" with an existing include hash clears it.'
        : 'A non-empty source is required.',
    );
  if (
    (!wholeIncludeReplacement || args.expectedSourceHash !== undefined) &&
    (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
  )
    throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
  const name = args.name as string;
  const owner = objectUrlForType('CLAS', name.toLowerCase());
  const client = mutationClient(original, context);
  const requested = args.transport === undefined ? undefined : String(args.transport).trim().toUpperCase();
  const state: PinnedClassState = {
    context,
    sourceUrl: selectedInclude ? `${owner}/includes/${selectedInclude}` : `${owner}/source/main`,
    include: selectedInclude,
    wholeIncludeReplacement,
    state: 'unchanged',
    phase: 'validation',
    readVerified: false,
    writeAttempted: false,
  };
  const ctx: SapWriteContext = Object.freeze({
    mutationContext: context,
    client,
    args: Object.freeze({ ...args, ...(method !== undefined ? { method } : {}) }),
    config,
    cachingLayer: undefined,
    cacheSecurity: { isPerUserClient: true },
    type: 'CLAS',
    name,
    source: typeof args.source === 'string' ? args.source : '',
    hasSource: typeof args.source === 'string',
    include,
    includeProvided: args.include !== undefined,
    transport: requested,
    lintOverride: undefined,
    preflightOverride: undefined,
    checkOverride: undefined,
    objectUrl: owner,
    srcUrl: `${owner}/source/main`,
    invalidateWrittenObject: () => {}, // Multi-target has no source cache.
    async enforcePackageForExistingObject() {
      state.phase = 'package-preflight';
      const pkg = await enforceAllowedPackageForObjectUrl(
        client,
        owner,
        'Pinned class edit',
        undefined,
        context.requestPolicy,
      );
      if (!pkg) throw new AdtSafetyError('The owner package could not be verified.');
      state.pkg = pkg;
      state.phase = 'recording-preflight';
      state.recording = await pinnedRecording(
        client.http,
        client.safety,
        owner,
        pkg,
        '',
        requested,
        context.requestPolicy,
      );
      return pkg;
    },
  });
  states.set(ctx, state);
  return ctx;
}

export function pinnedClassState(ctx: SapWriteContext): PinnedClassState {
  const state = states.get(ctx);
  if (!state || state.context !== ctx.mutationContext)
    throw new AdtSafetyError('The pinned class surgery lifecycle requires a registered native adapter.');
  assertMutationContext(ctx.client.safety, state.context);
  return state;
}

export function forgetPinnedClassContext(ctx: SapWriteContext): void {
  states.delete(ctx);
}
