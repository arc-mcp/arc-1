/** Pinned PP policy and source adapter over the shared lock/session lifecycle. */
import type { AdtClient } from '../../adt/client.js';
import { safeUpdateClassInclude, withLockedMutation } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import { deletePinnedOwner } from '../../adt/pinned-delete.js';
import { assertPinnedOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import { assertSourceHash, editableSourceEquals, sourceHash } from '../../adt/source-precondition.js';
import type { ServerConfig } from '../../server/types.js';
import { getCachedFeatures } from '../feature-cache.js';
import {
  type ClassWriteInclude,
  classIncludeUrl,
  normalizeClassWriteInclude,
  objectUrlForType,
} from '../object-types.js';
import { pinnedOperationContext, pinnedOperationResult } from '../pinned-operation.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import {
  buildCreateXml,
  enforceAllowedPackageForObjectUrl,
  runPreWriteLint,
  runPreWriteSyntaxCheck,
} from '../write-helpers.js';
import { isClassSurgeryAction } from './class-surgery-dispatch.js';
import { handlePinnedClassSurgery } from './pinned-class-surgery.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { isPinnedWriteRejection, pinnedFailure } from './pinned-result.js';

export { pinnedFailure } from './pinned-result.js';

export async function handlePinnedWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  if (isClassSurgeryAction(args.action)) return handlePinnedClassSurgery(client, args, config);
  let state = 'unchanged';
  let phase = 'validation';
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let savedHash: string | undefined;
  let include: ClassWriteInclude | undefined;
  let includeInitialized: boolean | undefined;
  let recordingRequest: string | undefined;
  let warnings: string | undefined;
  try {
    // The HTTP gate validates all raw fields before Zod strips unknown fields. Recheck capability here.
    checkOperation(client.safety, OperationType.Update, 'PinnedWrite');
    const context = pinnedOperationContext(client, config, { tool: 'SAPWrite', args, timeoutMs: 300_000, cleanup });
    const { type, name } = args;
    assertPinnedOwner(type, name);
    const objectName = name as string;
    const action = String(args.action);
    if (action === 'delete') {
      const result = await deletePinnedOwner(client, context, {
        type,
        name: objectName,
        transport: args.transport as string | undefined,
      });
      return pinnedOperationResult(result, config, { action, type, name: objectName });
    }
    include = normalizeClassWriteInclude(args.include);
    if (args.include !== undefined && (action !== 'update' || type !== 'CLAS' || !include))
      throw new AdtSafetyError('Only CLAS update supports definitions, implementations, macros or testclasses.');
    if (
      typeof args.source !== 'string' ||
      (!args.source.trim() && (!include || args.source !== '' || typeof args.expectedSourceHash !== 'string'))
    )
      throw new AdtSafetyError(
        include
          ? 'Include source is required; source="" with an existing include hash clears it.'
          : 'A non-empty source is required.',
      );
    if (
      action !== 'create' &&
      (!include || args.expectedSourceHash !== undefined) &&
      (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
    )
      throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
    const owner = objectUrlForType(type, objectName.toLowerCase());
    const sourceUrl = `${owner}/source/main`;
    client = mutationClient(client, context);
    const options = context.requestPolicy;
    const scopedHttp = client.http;
    const requested = args.transport === undefined ? undefined : String(args.transport).trim().toUpperCase();
    let source = args.source;
    const lint = (value: string) => {
      const result = runPreWriteLint(value, type, objectName, config);
      if (result.blocked)
        throw new AdtSafetyError(
          result.result?.content.map((part) => part.text).join('\n') ?? 'Pre-write lint blocked the change.',
        );
      return result.warnings;
    };
    warnings = include ? undefined : lint(source);
    let pkg: string;
    if (action === 'create') {
      if (typeof args.package !== 'string' || !args.package.trim())
        throw new AdtSafetyError('Creation requires an explicit package.');
      pkg = args.package.trim().toUpperCase();
      await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver(options));
    } else {
      pkg = (await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned write', undefined, options)) ?? '';
    }
    phase = 'recording-preflight';
    const recording = await pinnedRecording(
      scopedHttp,
      client.safety,
      owner,
      pkg,
      action === 'create' ? 'I' : '',
      requested,
      options,
    );
    recordingRequest = recording.request;
    if (action === 'create') {
      throwIfRequestCancelled(options);
      phase = 'create';
      state = 'creation-unknown';
      const query = recording.request ? `?corrNr=${encodeURIComponent(recording.request)}` : '';
      // SAP assigns the mapped PP user; JWT display names are not SAP responsible-user evidence.
      checkOperation(client.safety, OperationType.Create, 'PinnedCreate');
      await scopedHttp.post(
        owner.replace(/\/[^/]+$/, '') + query,
        buildCreateXml(type, objectName, pkg, String(args.description ?? objectName), undefined, config.language),
        'application/*',
        undefined,
        options,
      );
      state = 'created-source-not-confirmed';
    }
    const lockPolicy = pinnedSourceLockPolicy(client, context, owner, pkg, recording, (value) => {
      phase = value;
    });
    if (include) {
      const result = await safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        classIncludeUrl(objectName.toLowerCase(), include),
        source,
        recording.request,
        getCachedFeatures()?.abapRelease,
        args.expectedSourceHash as string | undefined,
        {
          context,
          lockPolicy,
          onPhase: (value) => {
            if (value === 'include-initialization') state = 'include-initialization-unknown';
            if (value === 'source-save') {
              includeInitialized = phase === 'include-initialization';
              state = includeInitialized ? 'created-include-source-unknown' : 'source-save-unknown';
            }
            phase = value;
          },
        },
      );
      if (result.source === undefined || result.sourceHash === undefined)
        throw new AdtSafetyError('Pinned include read-back was not confirmed.');
      includeInitialized = result.initialized;
      source = result.source;
      savedHash = result.sourceHash;
      state = 'saved-inactive';
    } else
      await withLockedMutation(client.http, client.safety, context, owner, lockPolicy, async (http, lock) => {
        if (action !== 'create') {
          const current = await http.get(sourceUrl, { Accept: 'text/plain' }, options);
          assertSourceHash(current.body, args.expectedSourceHash as string, sourceUrl);
        }
        const syntaxNotes = await runPreWriteSyntaxCheck(
          { http, safety: client.safety },
          type,
          source,
          owner,
          config,
          undefined,
          options,
        );
        if (syntaxNotes) warnings = [warnings, syntaxNotes].filter(Boolean).join('\n');
        throwIfRequestCancelled(options);
        phase = 'source-save';
        state = action === 'create' ? 'created-source-unknown' : 'source-save-unknown';
        const query = new URLSearchParams({
          lockHandle: lock.lockHandle,
          ...(recording.request ? { corrNr: recording.request } : {}),
        });
        checkOperation(client.safety, OperationType.Update, 'PinnedSave');
        await http.put(`${sourceUrl}?${query}`, source, 'text/plain', undefined, options);
        phase = 'source-readback';
        const saved = await http.get(sourceUrl, { Accept: 'text/plain' }, options);
        if (!editableSourceEquals(saved.body, source))
          throw new AdtSafetyError(
            'Save returned but exact editable source read-back did not match. Inspect before continuing.',
          );
        source = saved.body; // SAP normalizes line endings; return the hash of its actual editable bytes.
        state = 'saved-inactive';
        savedHash = sourceHash(source);
      });
    if (cleanup.unlockFailed || cleanup.sessionClosed === false) {
      phase = cleanup.unlockFailed ? 'unlock' : 'session-close';
      throw new Error('Owning-session cleanup was not confirmed.');
    }
    return textResult(
      toolJson({
        target: config.targetId,
        type,
        name,
        action,
        state,
        ...(include ? { include, initialized: includeInitialized } : {}),
        sourceHash: sourceHash(source),
        ...(recording.request ? { transport: recording.request } : {}),
        ...(warnings ? { warnings } : {}),
        next: 'Review the inactive source. SAPActivate activates this complete owner, including all existing inactive drafts/includes.',
      }),
    );
  } catch (error) {
    // Definitive SAP rejections did not accept this phase; network/429/5xx outcomes remain unknown.
    if (isPinnedWriteRejection(error)) {
      if (phase === 'create') state = 'creation-rejected';
      if (phase === 'include-initialization') state = 'include-initialization-rejected';
      if (phase === 'source-save')
        state = includeInitialized
          ? 'created-include-source-rejected'
          : state.startsWith('created-')
            ? 'created-source-rejected'
            : 'source-save-rejected';
    }
    return pinnedFailure(error, state, phase, cleanup.unlockFailed, {
      sourceHash: savedHash,
      sessionClosed: cleanup.sessionClosed,
      include,
      initialized: includeInitialized,
      transport: recordingRequest,
      warnings: savedHash ? warnings : undefined,
    });
  }
}
