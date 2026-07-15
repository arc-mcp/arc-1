/** SAPWrite action for surgical FORM/MODULE replacement in PROG and INCL sources. */

import { safeUpdateSource } from '../../adt/crud.js';
import { mapSapReleaseToAbaplintVersion } from '../../adt/features.js';
import { spliceUnit } from '../../context/unit-surgery.js';
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

  // Read the latest relevant bytes directly from SAP. If an inactive draft exists,
  // splice into that draft so consecutive edit_unit calls do not overwrite each other.
  const { effectiveVersion } = await resolveVersionAndDraftInfo(
    client,
    cachingLayer,
    type,
    name,
    'auto',
    cacheSecurity,
  );
  const currentSource = (await client.getSourceAtObjectUrl(objectUrl, { version: effectiveVersion })).source;
  const abaplintVersion = cachedFeatures?.abapRelease
    ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
    : undefined;
  const spliced = spliceUnit(currentSource, name, unit, source, abaplintVersion);
  if (!spliced.success) return errorResult(spliced.error ?? `Failed to splice unit "${unit}" in ${name}.`);

  const lint = runPreWriteLint(spliced.newSource, type, name, config, lintOverride);
  if (lint.blocked) return lint.result!;
  const checkNotes = await runPreWriteSyntaxCheck(client, type, spliced.newSource, objectUrl, config, checkOverride);

  await safeUpdateSource(
    client.http,
    client.safety,
    objectUrl,
    srcUrl,
    spliced.newSource,
    transport,
    cachedFeatures?.abapRelease,
  );
  invalidateWrittenObject(type, name);

  const kind = spliced.unit?.kind ?? 'unit';
  const group = String(args.group ?? '').trim();
  const activationHint =
    type === 'INCL' && group
      ? ` Activate this structural include with SAPActivate(type="INCL", name="${name}", group="${group}").`
      : '';
  const message = `Successfully updated ${kind} "${unit}" in ${type} ${name}.${activationHint}`;
  const extras = [lint.warnings, checkNotes].filter(Boolean).join('\n\n');
  return extras ? textResult(`${message}\n\n${extras}`) : textResult(message);
}
