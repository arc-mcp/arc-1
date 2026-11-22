/** SAPWrite actions: locked text replacement (PROG/INCL/TABL) and FORM/MODULE surgery (PROG/INCL). */

import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import { ABAPLINT_MAX_RELEASE, mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { assertResultHash, assertSourceHash } from '../../adt/source-precondition.js';
import { spliceContent } from '../../context/content-splice.js';
import { insertUnit, spliceUnit } from '../../context/unit-surgery.js';
import { supportsEditContent } from '../editable-source.js';
import { getCachedFeatures } from '../feature-cache.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { runPreWriteLint, runPreWriteSyntaxCheck, runRapPreflightValidation } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';
import { isDryRun, readEditableForPreview, sourcePreviewResult } from './dry-run.js';

export async function writeActionUnit(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    transport,
    lintOverride,
    preflightOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;
  const action = String(args.action);
  const adding = action === 'add_unit';
  const editingContent = action === 'edit_content';
  const unit = String(args.unit ?? '').trim();
  if (!editingContent && !unit) return errorResult(`"unit" is required for ${action} action.`);
  if (!editingContent && !source.trim()) {
    return errorResult(`"source" (complete FORM...ENDFORM or MODULE...ENDMODULE block) is required for ${action}.`);
  }
  if (editingContent ? !supportsEditContent(type) : type !== 'PROG' && type !== 'INCL') {
    return errorResult(
      `${action} is only supported for type=PROG${editingContent ? ', type=INCL or type=TABL' : ' or type=INCL'}.`,
    );
  }
  const dryRun = isDryRun(args);
  if (!dryRun) {
    checkOperation(client.safety, OperationType.Update, 'EditUnit');
    await enforcePackageForExistingObject();
  }

  const cachedFeatures = getCachedFeatures();
  // Match unit lookup's on-prem ceiling only when the target release is unknown.
  // Keep this fallback local: standalone lint and other write actions still use their defaults.
  const release = cachedFeatures?.abapRelease ?? config.abapRelease ?? String(ABAPLINT_MAX_RELEASE);
  const abaplintVersion = mapSapReleaseToAbaplintVersion(release);
  // The preview runs the same splice and checks on the same uncached read, without a lock.
  const edit = async (
    session: AdtHttpClient,
    currentSource: string,
    write?: (newSource: string) => Promise<void>,
  ): Promise<ToolResult> => {
    const spliced = editingContent
      ? { ...spliceContent(currentSource, String(args.oldContent), String(args.newContent)), unit: undefined }
      : adding
        ? insertUnit(currentSource, name, unit, source, abaplintVersion)
        : spliceUnit(currentSource, name, unit, source, abaplintVersion);
    if (!spliced.success) return errorResult(spliced.error ?? `Failed to splice unit "${unit}" in ${name}.`);
    // Same rule as a whole-source TABL update: never PUT an empty definition.
    if (type === 'TABL' && !spliced.newSource.trim()) {
      return errorResult(`edit_content would leave TABL ${name} without source; no write was made.`);
    }

    // Same deterministic preflight as a whole-source update, on the complete resulting source.
    const preflight = runRapPreflightValidation(
      spliced.newSource,
      type,
      name,
      cachedFeatures,
      config.systemType,
      preflightOverride,
    );
    if (preflight.blocked) return preflight.result!;

    const lint = runPreWriteLint(spliced.newSource, type, name, { ...config, abapRelease: release }, lintOverride);
    if (lint.blocked) return lint.result!;

    const checkNotes = await runPreWriteSyntaxCheck(
      { http: session, safety: client.safety },
      type,
      spliced.newSource,
      objectUrl,
      config,
      checkOverride,
    );
    if (!write) {
      const notes = [preflight.warnings, lint.warnings, checkNotes].filter(Boolean).join('\n\n');
      return sourcePreviewResult({
        type,
        name,
        current: currentSource,
        proposed: spliced.newSource,
        notes,
        expectedResultHash: args.expectedResultHash as string | undefined,
      });
    }
    await write(spliced.newSource);
    const kind = spliced.unit?.kind ?? 'unit';
    const group = String(args.group ?? '').trim();
    const activationHint =
      type === 'INCL' && group
        ? ` Activate this structural include with SAPActivate(type="INCL", name="${name}", group="${group}").`
        : '';
    const message = editingContent
      ? `Successfully ${args.newContent === '' ? 'removed' : 'replaced'} the matching text in ${type} ${name}.${activationHint}`
      : `Successfully ${adding ? 'added' : 'updated'} ${kind} "${unit}" in ${type} ${name}.${activationHint}`;
    const extras = [preflight.warnings, lint.warnings, checkNotes].filter(Boolean).join('\n\n');
    return extras ? textResult(`${message}\n\n${extras}`) : textResult(message);
  };
  const expectedHash = args.expectedSourceHash as string | undefined;
  if (dryRun) return edit(client.http, await readEditableForPreview(client, type, srcUrl, expectedHash));
  return client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
    let writeAttempted = false;
    try {
      checkOperation(client.safety, OperationType.Read, 'GetSource');
      // Omit version: SAP returns the editable draft, or active source when no draft exists.
      // Read after locking, without source or inactive-list caches.
      const currentSource = (await session.get(srcUrl, { 'Cache-Control': 'no-cache' })).body;
      assertSourceHash(currentSource, expectedHash, srcUrl);
      return await edit(session, currentSource, async (newSource) => {
        assertResultHash(newSource, args.expectedResultHash as string | undefined, srcUrl);
        writeAttempted = true;
        await updateSource(
          session,
          client.safety,
          srcUrl,
          newSource,
          lock.lockHandle,
          transport ?? (lock.corrNr || undefined),
        );
      });
    } finally {
      // Surface failed unlocks: SAP may still hold the lock after a successful write.
      try {
        await unlockObject(session, objectUrl, lock.lockHandle);
      } finally {
        if (writeAttempted) invalidateWrittenObject(type, name);
      }
    }
  });
}
