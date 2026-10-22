/** Small reviewed write pipeline for pinned PP targets. General single-target writes stay separate. */
import type { AdtClient } from '../../adt/client.js';
import { lockObject } from '../../adt/crud.js';
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import type { AdtRequestOptions } from '../../adt/http.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { assertPinnedOwner, pinnedRecording, validatePinnedLock } from '../../adt/pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import { assertSourceHash, sourceHash } from '../../adt/source-precondition.js';
import { spliceMethod } from '../../context/method-surgery.js';
import { getCurrentContext } from '../../server/context.js';
import { pinnedMutationAllowed } from '../../server/multi-target-write-surface.js';
import type { ServerConfig } from '../../server/types.js';
import { getCachedFeatures } from '../feature-cache.js';
import { objectUrlForType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import {
  buildCreateXml,
  enforceAllowedPackageForObjectUrl,
  runPreWriteLint,
  runPreWriteSyntaxCheck,
} from '../write-helpers.js';

export function pinnedFailure(error: unknown, state: string, phase: string, cleanupFailed = false): ToolResult {
  const context = getCurrentContext();
  return errorResult(
    toolJson({
      error: state === 'unchanged' ? 'PINNED_WRITE_REFUSED' : 'PINNED_WRITE_INCOMPLETE',
      message:
        error instanceof AdtSafetyError
          ? error.message
          : 'SAP did not confirm the complete operation. Inspect the object and its inactive source before deciding the next action.',
      target: context?.target,
      requestId: context?.requestId,
      retryable: false,
      state,
      phase,
      ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
      ...(cleanupFailed
        ? {
            cleanupFailed: true,
            cleanup: 'Unlock failed; the owning session was closed. Verify the SAP lock before continuing.',
          }
        : {}),
    }),
  );
}

export async function handlePinnedWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  let state = 'unchanged';
  let phase = 'validation';
  let cleanupFailed = false;
  try {
    // The HTTP gate validates all raw fields before Zod strips unknown fields. Recheck capability here.
    checkOperation(client.safety, OperationType.Update, 'PinnedWrite');
    if (!client.safety.multiTargetWrite?.enabled || !pinnedMutationAllowed('SAPWrite', args, config))
      throw new AdtSafetyError('Pinned write inputs or policy are not allowed.');
    const { type, name } = args;
    assertPinnedOwner(type, name);
    const objectName = name as string;
    const action = String(args.action);
    if (typeof args.source !== 'string' || !args.source.trim())
      throw new AdtSafetyError('A non-empty source is required.');
    if (
      action !== 'create' &&
      (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
    )
      throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
    if (action === 'edit_method' && (typeof args.method !== 'string' || !args.method.trim()))
      throw new AdtSafetyError('edit_method requires a method name.');
    const owner = objectUrlForType(type, objectName.toLowerCase());
    const sourceUrl = `${owner}/source/main`;
    const options: AdtRequestOptions = {
      deadline: Date.now() + 300_000,
      signal: getCurrentContext()?.signal,
      retryTransientErrors: false,
    };
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
    let warnings = action === 'edit_method' ? undefined : lint(source);
    let pkg: string;
    if (action === 'create') {
      if (typeof args.package !== 'string' || !args.package.trim())
        throw new AdtSafetyError('Creation requires an explicit package.');
      pkg = args.package.trim().toUpperCase();
      await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
    } else {
      pkg = (await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned write')) ?? '';
    }
    phase = 'recording-preflight';
    const recording = await pinnedRecording(
      client.http,
      client.safety,
      owner,
      pkg,
      action === 'create' ? 'I' : '',
      requested,
      options,
    );
    if (action === 'create') {
      throwIfRequestCancelled(options);
      phase = 'create';
      state = 'creation-unknown';
      const query = recording.request ? `?corrNr=${encodeURIComponent(recording.request)}` : '';
      // SAP assigns the mapped PP user; JWT display names are not SAP responsible-user evidence.
      await client.http.post(
        owner.replace(/\/[^/]+$/, '') + query,
        buildCreateXml(type, objectName, pkg, String(args.description ?? objectName), undefined, config.language),
        'application/*',
        undefined,
        options,
      );
      state = 'created-source-not-confirmed';
    }
    await client.http.withStatefulSession(async (http) => {
      phase = 'lock';
      throwIfRequestCancelled(options);
      const lock = await lockObject(http, client.safety, owner, 'MODIFY', undefined, undefined, options);
      try {
        phase = 'locked-policy';
        const actualPackage = await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned write under lock');
        if (actualPackage !== pkg) throw new AdtSafetyError('The owner package changed since preflight.');
        const fresh = await pinnedRecording(http, client.safety, owner, pkg, '', recording.request, options);
        if (fresh.local !== recording.local || fresh.request !== recording.request)
          throw new AdtSafetyError('Recording context changed since preflight.');
        await validatePinnedLock(http, client.safety, lock, fresh, options);
        if (action !== 'create') {
          const current = await http.get(sourceUrl, { Accept: 'text/plain' }, options);
          assertSourceHash(current.body, args.expectedSourceHash as string, sourceUrl);
          if (action === 'edit_method') {
            const release = getCachedFeatures()?.abapRelease;
            const result = spliceMethod(
              current.body,
              objectName,
              String(args.method),
              source,
              release ? mapSapReleaseToAbaplintVersion(release) : undefined,
            );
            if (!result.success) throw new AdtSafetyError(result.error ?? 'Method splice failed.');
            source = result.newSource;
            warnings = lint(source);
          }
        }
        const syntaxNotes = await runPreWriteSyntaxCheck({ http, safety: client.safety }, type, source, owner, config);
        if (syntaxNotes) warnings = [warnings, syntaxNotes].filter(Boolean).join('\n');
        throwIfRequestCancelled(options);
        phase = 'source-save';
        state = action === 'create' ? 'created-source-unknown' : 'source-save-unknown';
        const query = new URLSearchParams({
          lockHandle: lock.lockHandle,
          ...(recording.request ? { corrNr: recording.request } : {}),
        });
        await http.put(`${sourceUrl}?${query}`, source, 'text/plain', undefined, options);
        phase = 'source-readback';
        const saved = await http.get(sourceUrl, { Accept: 'text/plain' }, options);
        // ADT normalizes CRLF and terminal line breaks (INTF removes them; CLAS may add them).
        const comparable = (value: string) => value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
        if (comparable(saved.body) !== comparable(source))
          throw new AdtSafetyError(
            'Save returned but exact editable source read-back did not match. Inspect before continuing.',
          );
        source = saved.body; // SAP normalizes line endings; return the hash of its actual editable bytes.
        state = 'saved-inactive';
      } finally {
        if (lock.lockHandle) {
          try {
            // Cleanup uses the owning session and a separate bounded budget even after cancellation.
            await http.post(
              `${owner}?_action=UNLOCK&lockHandle=${encodeURIComponent(lock.lockHandle)}`,
              undefined,
              undefined,
              undefined,
              { deadline: Date.now() + 5000, retryTransientErrors: false },
            );
          } catch {
            cleanupFailed = true;
          }
        }
      }
    });
    if (cleanupFailed) return pinnedFailure(new Error('Unlock failed'), state, 'unlock', true);
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
    return pinnedFailure(error, state, phase, cleanupFailed);
  }
}
