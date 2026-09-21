/** SAPWrite action for surgical FORM/MODULE replacement in PROG and INCL sources. */

import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import { ABAPLINT_MAX_RELEASE, mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { spliceUnit } from '../../context/unit-surgery.js';
import { getCachedFeatures } from '../feature-cache.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { runPreWriteLint, runPreWriteSyntaxCheck } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export async function writeActionEditUnit(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    transport,
    lintOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;
  const unit = String(args.unit ?? '').trim();
  if (!unit) return errorResult('"unit" is required for edit_unit action.');
  if (!source.trim()) {
    return errorResult('"source" (complete FORM...ENDFORM or MODULE...ENDMODULE block) is required for edit_unit.');
  }
  if (type !== 'PROG' && type !== 'INCL') {
    return errorResult('edit_unit is only supported for type=PROG or type=INCL.');
  }
  checkOperation(client.safety, OperationType.Update, 'EditUnit');
  await enforcePackageForExistingObject();

  const cachedFeatures = getCachedFeatures();
  // Match unit lookup's on-prem ceiling only when the target release is unknown.
  // Keep this fallback local: standalone lint and other write actions still use their defaults.
  const release = cachedFeatures?.abapRelease ?? config.abapRelease ?? String(ABAPLINT_MAX_RELEASE);
  const abaplintVersion = mapSapReleaseToAbaplintVersion(release);
  return client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
    let writeAttempted = false;
    try {
      checkOperation(client.safety, OperationType.Read, 'GetSource');
      // Omit version: SAP returns the editable draft, or active source when no draft exists.
      // Read after locking, without source or inactive-list caches.
      const currentSource = (await session.get(srcUrl, { 'Cache-Control': 'no-cache' })).body;
      const spliced = spliceUnit(currentSource, name, unit, source, abaplintVersion);
      if (!spliced.success) return errorResult(spliced.error ?? `Failed to splice unit "${unit}" in ${name}.`);

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
      writeAttempted = true;
      await updateSource(
        session,
        client.safety,
        srcUrl,
        spliced.newSource,
        lock.lockHandle,
        transport ?? (lock.corrNr || undefined),
      );
      const kind = spliced.unit?.kind ?? 'unit';
      const group = String(args.group ?? '').trim();
      const activationHint =
        type === 'INCL' && group
          ? ` Activate this structural include with SAPActivate(type="INCL", name="${name}", group="${group}").`
          : '';
      const message = `Successfully updated ${kind} "${unit}" in ${type} ${name}.${activationHint}`;
      const extras = [lint.warnings, checkNotes].filter(Boolean).join('\n\n');
      return extras ? textResult(`${message}\n\n${extras}`) : textResult(message);
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
