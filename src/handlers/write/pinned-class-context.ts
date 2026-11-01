/** Request-owned state for class actions that enter the shared action handlers. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedOwner, type PinnedRecording, pinnedRecording } from '../../adt/pinned-write-policy.js';
import type { ServerConfig } from '../../server/types.js';
import { objectUrlForType } from '../object-types.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export interface PinnedClassState {
  readonly context: PinnedMutationContext;
  phase: string;
  state: string;
  pkg?: string;
  recording?: PinnedRecording;
  sourceHash?: string;
  warnings?: string;
  readVerified: boolean;
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
  if (args.action !== 'edit_method' || args.type !== 'CLAS' || args.include !== undefined)
    throw new AdtSafetyError('Only the admitted main-source method adapter is available.');
  if (typeof args.method !== 'string' || !args.method.trim() || /^(?:lhc_|lcl_|ltc_)/i.test(args.method))
    throw new AdtSafetyError('An admitted global-class method name is required.');
  if (typeof args.source !== 'string' || !args.source.trim())
    throw new AdtSafetyError('A non-empty source is required.');
  if (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
    throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
  const name = args.name as string;
  const owner = objectUrlForType('CLAS', name.toLowerCase());
  const client = mutationClient(original, context);
  const requested = args.transport === undefined ? undefined : String(args.transport).trim().toUpperCase();
  const state: PinnedClassState = {
    context,
    state: 'unchanged',
    phase: 'validation',
    readVerified: false,
    writeAttempted: false,
  };
  const ctx: SapWriteContext = Object.freeze({
    mutationContext: context,
    client,
    args: Object.freeze({ ...args }),
    config,
    cachingLayer: undefined,
    cacheSecurity: { isPerUserClient: true },
    type: 'CLAS',
    name,
    source: args.source,
    hasSource: true,
    include: undefined,
    includeProvided: false,
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
