/** Request-owned state and package/recording preflight for admitted source adapters. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { pinnedFunctionSelection, readPinnedFunctionOwner } from '../../adt/pinned-function-owner.js';
import { verifyPinnedProgramOwner } from '../../adt/pinned-program-owner.js';
import { assertPinnedSourceOwner, type PinnedRecording, pinnedRecording } from '../../adt/pinned-write-policy.js';
import type { TextElementPart, TextElementWriteResult } from '../../adt/text-elements.js';
import type { ServerConfig } from '../../server/types.js';
import { type ClassWriteInclude, normalizeClassWriteInclude, objectUrlForType } from '../object-types.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export interface PinnedSourceState {
  readonly context: PinnedMutationContext;
  readonly sourceUrl: string;
  readonly include?: ClassWriteInclude;
  readonly wholeIncludeReplacement: boolean;
  includeInitialized?: boolean;
  createdOwner?: boolean;
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
  textPool?: { part: TextElementPart; result?: TextElementWriteResult };
  functionGroup?: { name: string; sourceHash: string; includeReferenced: true };
}
// Transient call state, never indexed by target/user and never reused across requests.
const states = new WeakMap<SapWriteContext, PinnedSourceState>();

export function createPinnedSourceContext(
  original: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
  selection: { selectedInclude?: ClassWriteInclude; wholeIncludeReplacement: boolean; method?: string },
): SapWriteContext {
  assertMutationContext(original.safety, context);
  const functionOwner =
    args.type === 'FUGR' || args.type === 'FUNC' || (args.type === 'INCL' && args.group !== undefined)
      ? pinnedFunctionSelection(args.type, args.name, args.group)
      : undefined;
  if (!functionOwner) assertPinnedSourceOwner(args.type, args.name);
  const { selectedInclude, wholeIncludeReplacement, method } = selection;
  const include = normalizeClassWriteInclude(args.include);
  const name = args.name as string;
  const owner = functionOwner?.objectUrl ?? objectUrlForType(args.type as string, name.toLowerCase());
  const client = mutationClient(original, context);
  const requested = args.transport === undefined ? undefined : String(args.transport).trim().toUpperCase();
  const state: PinnedSourceState = {
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
    type: args.type as string,
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
      const nativePackage =
        (await readPinnedFunctionOwner(client, owner))?.packageName ?? (await verifyPinnedProgramOwner(client, owner));
      const pkg =
        nativePackage ??
        (await enforceAllowedPackageForObjectUrl(
          client,
          owner,
          'Pinned source edit',
          undefined,
          context.requestPolicy,
        ));
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

export function pinnedSourceState(ctx: SapWriteContext): PinnedSourceState {
  const state = states.get(ctx);
  if (!state || state.context !== ctx.mutationContext)
    throw new AdtSafetyError('The pinned source lifecycle requires a registered native adapter.');
  assertMutationContext(ctx.client.safety, state.context);
  return state;
}

export function forgetPinnedSourceContext(ctx: SapWriteContext): void {
  states.delete(ctx);
}
