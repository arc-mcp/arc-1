/** Pinned PP dispatch and creation adapter over the shared lock/session lifecycle. */
import type { AdtClient } from '../../adt/client.js';
import { withLockedMutation } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import { deletePinnedOwner } from '../../adt/pinned-delete.js';
import { assertPinnedOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import { editableSourceEquals, sourceHash } from '../../adt/source-precondition.js';
import type { ServerConfig } from '../../server/types.js';
import { objectUrlForType } from '../object-types.js';
import { pinnedOperationContext, pinnedOperationResult } from '../pinned-operation.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import { buildCreateXml, runPreWriteLint, runPreWriteSyntaxCheck } from '../write-helpers.js';
import { isClassSurgeryAction } from './class-surgery-dispatch.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { isPinnedWriteRejection, pinnedFailure, rejectedPinnedSourceState } from './pinned-result.js';
import { handlePinnedSourceWrite } from './pinned-source-write.js';

export { pinnedFailure } from './pinned-result.js';

export async function handlePinnedWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  if (
    isClassSurgeryAction(args.action) ||
    args.action === 'update' ||
    args.action === 'edit_unit' ||
    args.action === 'add_unit'
  )
    return handlePinnedSourceWrite(client, args, config);
  let state = 'unchanged';
  let phase = 'validation';
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let savedHash: string | undefined;
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
    if (action !== 'create') throw new AdtSafetyError('Select an admitted pinned write action.');
    if (typeof args.source !== 'string' || !args.source.trim())
      throw new AdtSafetyError('A non-empty source is required.');
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
    warnings = lint(source);
    if (typeof args.package !== 'string' || !args.package.trim())
      throw new AdtSafetyError('Creation requires an explicit package.');
    const pkg = args.package.trim().toUpperCase();
    await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver(options));
    phase = 'recording-preflight';
    const recording = await pinnedRecording(scopedHttp, client.safety, owner, pkg, 'I', requested, options);
    recordingRequest = recording.request;
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
    const lockPolicy = pinnedSourceLockPolicy(client, context, owner, pkg, recording, (value) => {
      phase = value;
    });
    await withLockedMutation(client.http, client.safety, context, owner, lockPolicy, async (http, lock) => {
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
      state = 'created-source-unknown';
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
        sourceHash: sourceHash(source),
        ...(recording.request ? { transport: recording.request } : {}),
        ...(warnings ? { warnings } : {}),
        next: 'Review the inactive source. SAPActivate activates this complete owner, including all existing inactive drafts/includes.',
      }),
    );
  } catch (error) {
    // Definitive SAP rejections did not accept this phase; network/429/5xx outcomes remain unknown.
    if (isPinnedWriteRejection(error)) state = rejectedPinnedSourceState(state, phase);
    return pinnedFailure(error, state, phase, cleanup.unlockFailed, {
      sourceHash: savedHash,
      sessionClosed: cleanup.sessionClosed,
      transport: recordingRequest,
      warnings: savedHash ? warnings : undefined,
    });
  }
}
