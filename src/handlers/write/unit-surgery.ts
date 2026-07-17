/** SAPWrite action for surgical FORM/MODULE replacement in PROG and INCL sources. */

import { safeUpdateSourceWithTransform } from '../../adt/crud.js';
import { mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import { type EditableUnitInfo, spliceUnit } from '../../context/unit-surgery.js';
import { cachedFeatures } from '../feature-cache.js';
import { resolveVersionAndDraftInfo } from '../read.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { runPreWriteLint, runPreWriteSyntaxCheck } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export async function writeActionEditUnit(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    cachingLayer,
    cacheSecurity,
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
  await enforcePackageForExistingObject();

  // If an inactive draft exists, splice into that draft so consecutive edit_unit calls do not
  // overwrite each other.
  const { effectiveVersion } = await resolveVersionAndDraftInfo(
    client,
    cachingLayer,
    type,
    name,
    'auto',
    cacheSecurity,
  );
  const cachedVersion = effectiveVersion === 'inactive' ? 'inactive' : 'active';
  const cachedSource = cachingLayer?.getCachedSourceWithEtag(type, name, cachedVersion) ?? null;
  const abaplintVersion = cachedFeatures?.abapRelease
    ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
    : undefined;

  let lintBlocked: ToolResult | undefined;
  let lintWarnings: string | undefined;
  let checkNotes = '';
  let splicedUnit: EditableUnitInfo | undefined;

  // Fetch the latest relevant bytes INSIDE the lock (not before it), so nothing can drift
  // between the read and the write — closes the TOCTOU gap `safeUpdateSource` alone leaves open.
  const outcome = await safeUpdateSourceWithTransform(
    client.http,
    client.safety,
    objectUrl,
    srcUrl,
    async (currentSource) => {
      const spliced = spliceUnit(currentSource, name, unit, source, abaplintVersion);
      if (!spliced.success) return { error: spliced.error ?? `Failed to splice unit "${unit}" in ${name}.` };
      splicedUnit = spliced.unit;

      const lint = runPreWriteLint(spliced.newSource, type, name, config, lintOverride);
      if (lint.blocked) {
        lintBlocked = lint.result;
        return { error: '__lint_blocked__' };
      }
      lintWarnings = lint.warnings;
      checkNotes = await runPreWriteSyntaxCheck(client, type, spliced.newSource, objectUrl, config, checkOverride);
      return { source: spliced.newSource };
    },
    transport,
    cachedFeatures?.abapRelease,
    effectiveVersion === 'inactive' ? 'inactive' : undefined,
    cachedSource,
  );

  if ('error' in outcome) return lintBlocked ?? errorResult(outcome.error);

  invalidateWrittenObject(type, name);

  const kind = splicedUnit?.kind ?? 'unit';
  const group = String(args.group ?? '').trim();
  const activationHint =
    type === 'INCL' && group
      ? ` Activate this structural include with SAPActivate(type="INCL", name="${name}", group="${group}").`
      : '';
  const message = `Successfully updated ${kind} "${unit}" in ${type} ${name}.${activationHint}`;
  const extras = [lintWarnings, checkNotes].filter(Boolean).join('\n\n');
  return extras ? textResult(`${message}\n\n${extras}`) : textResult(message);
}
