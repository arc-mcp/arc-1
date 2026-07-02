/**
 * SAPWrite actions — update + delete.
 */

import {
  deleteObject,
  lockObject,
  safeUpdateClassInclude,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
} from '../../adt/crud.js';
import { rewriteKtdText } from '../../adt/ddic-xml.js';
import { AdtApiError } from '../../adt/errors.js';
import { type FmParameter, spliceFmSignature } from '../../adt/fm-signature.js';
import {
  buildCdsDeleteDependencyHint,
  buildCdsUpdateCrudHint,
  CDS_DEPENDENCY_SENSITIVE_TYPES,
  guardCdsSyntax,
} from '../cds-hints.js';
import { cachedFeatures } from '../feature-cache.js';
import { CLASS_WRITE_INCLUDES, canonicalTablType, classIncludeUrl } from '../object-types.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import {
  buildCreateXml,
  getMetadataWriteProperties,
  isMetadataWriteType,
  mergeMetadataWriteProperties,
  mergePreWriteWarnings,
  resolveWriteSystemType,
  runPreWriteLint,
  runPreWriteSyntaxCheck,
  runRapPreflightValidation,
  SKTD_V2_CONTENT_TYPE,
  stripFmParamCommentBlock,
  vendorContentTypeForType,
} from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

function isDeleteDependencyError(err: AdtApiError): boolean {
  const clean = AdtApiError.extractCleanMessage(err.responseBody ?? err.message).toLowerCase();
  const body = (err.responseBody ?? '').toLowerCase();
  const diagnostics = err.responseBody ? AdtApiError.extractDdicDiagnostics(err.responseBody) : [];

  if (diagnostics.some((diag) => diag.messageNumber === '039')) return true;

  return /could not be deleted|cannot be deleted|still in use|used by|dependent object|existing reference/.test(
    `${clean}\n${body}`,
  );
}

export async function writeActionUpdate(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    hasSource,
    include,
    transport,
    lintOverride,
    preflightOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;
  const existingPackage = await enforcePackageForExistingObject();

  // Keep CLAS local include writes ahead of the generic /source/main fallthrough.
  // If CLAS ever gains separate metadata-update handling, this branch must still
  // win whenever callers pass include=definitions|implementations|macros|testclasses.
  if (args.include !== undefined) {
    if (!include) {
      return errorResult(
        `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
      );
    }
    if (type !== 'CLAS') {
      return errorResult('SAPWrite include is only supported for action="update" with type="CLAS".');
    }
    if (!hasSource) {
      return errorResult('"source" is required when updating a CLAS include.');
    }

    // Auto-initialise the include if it doesn't exist yet. On a fresh class
    // the testclasses (CCAU) include is absent — a content PUT alone fails
    // with HTTP 500 "…CCAU does not have any inactive version". safeUpdateClassInclude
    // probes the include and POST-creates it (under the same lock) before the PUT.
    const { initialized } = await safeUpdateClassInclude(
      client.http,
      client.safety,
      objectUrl,
      classIncludeUrl(name, include),
      source,
      transport,
      cachedFeatures?.abapRelease,
    );
    invalidateWrittenObject(type, name);
    const initNote = initialized ? ` (initialised the ${include} include first)` : '';
    return textResult(
      `Successfully updated ${type} ${name} include ${include}${initNote}. Active version remains unchanged until activation; read with SAPRead(version="inactive") to verify the draft.`,
    );
  }

  if (type === 'SKTD') {
    // KTD update requires the full <sktd:docu> XML envelope with the Markdown
    // body base64-encoded inside <sktd:text>, PUT with
    // `application/vnd.sap.adt.sktdv2+xml`. PUTting raw text/plain silently
    // no-ops (or 415s on strict systems). Fetch the current envelope,
    // replace only the <sktd:text> body, and PUT it back — preserves
    // responsible/masterLanguage/packageRef/refObject metadata.
    const { source: currentEnvelope } = await client.getKtd(name);
    const body = rewriteKtdText(currentEnvelope, source);
    await safeUpdateObject(
      client.http,
      client.safety,
      objectUrl,
      body,
      SKTD_V2_CONTENT_TYPE,
      transport,
      cachedFeatures?.abapRelease,
    );
    invalidateWrittenObject(type, name);
    return textResult(`Successfully updated ${type} ${name}.`);
  }

  if (isMetadataWriteType(type)) {
    // Metadata updates are full-XML-replace — we must fetch existing metadata
    // and merge with provided fields so omitted fields keep their current values.
    // Without this, updating just labels would reset dataType/typeKind to defaults.
    const metadataProps = getMetadataWriteProperties(args);
    const mergedProps = await mergeMetadataWriteProperties(client, type, name, metadataProps);
    const description = String(args.description ?? mergedProps._description ?? name);
    const pkg = String(args.package ?? existingPackage ?? mergedProps._package ?? '$TMP');
    // Keep the full-XML-replace body cloud-correct on BTP (G-3); resolve the user from the JWT (G-5).
    const systemType = resolveWriteSystemType(config, client);
    const responsible = config.username || (await client.getEffectiveUser());
    const body = buildCreateXml(
      type,
      name,
      pkg,
      description,
      mergedProps,
      config.language,
      responsible,
      systemType === 'btp',
    );
    await safeUpdateObject(
      client.http,
      client.safety,
      objectUrl,
      body,
      vendorContentTypeForType(type),
      transport,
      cachedFeatures?.abapRelease,
    );
    invalidateWrittenObject(type, name);
    return textResult(`Successfully updated ${type} ${name}.`);
  }

  // RAP deterministic preflight validation
  const preflightWarnings = runRapPreflightValidation(
    source,
    type,
    name,
    cachedFeatures,
    config.systemType,
    preflightOverride,
  );
  if (preflightWarnings.blocked) return preflightWarnings.result!;

  // CDS pre-write validation: reject unsupported syntax early
  const cdsGuardUpdate = guardCdsSyntax(type, source, cachedFeatures);
  if (cdsGuardUpdate) return cdsGuardUpdate;

  // FUNC-source sanitization: strip SAPGUI-style parameter comment blocks.
  // SAP rejects PUT-to-source/main with these blocks (HTTP 400 / FUNC_ADT028
  // "Parameter comment blocks are not allowed" — verified live a4h S/4HANA 2023,
  // issue #250). LLMs frequently emit them out of muscle memory because every
  // released FM has one. Strip and warn rather than fail.
  //
  // Issue #252: when `parameters` is supplied as a structured array, splice
  // it into the FM source as ABAP-source-based signature syntax. If `source`
  // is omitted entirely, fetch the existing source first to preserve the
  // body. The structured clause replaces any existing signature region.
  let effectiveSource = source;
  let fmParamStripWarning: string | undefined;
  let fmParamMergeWarning: string | undefined;
  if (type === 'FUNC') {
    const parameters = args.parameters as FmParameter[] | undefined;
    if (parameters !== undefined) {
      // If caller passed parameters but no source, fetch the current source so
      // the body is preserved (the parameters array re-emits only the signature).
      let baseSource = source;
      if (!baseSource || baseSource.trim() === '') {
        const groupName = String(args.group ?? '');
        const fetched = await client.getFunction(groupName, name).catch(() => null);
        baseSource = fetched?.source ?? `FUNCTION ${name}.\nENDFUNCTION.\n`;
      } else if (!/^\s*FUNCTION\s+/i.test(baseSource)) {
        // Body-only source: wrap in FUNCTION/ENDFUNCTION so the splicer has
        // something to work with. Common shape from LLMs: just the body.
        baseSource = `FUNCTION ${name}.\n${baseSource}\nENDFUNCTION.\n`;
      }
      try {
        effectiveSource = spliceFmSignature(baseSource, name, parameters);
      } catch {
        // No FUNCTION token in the supplied source — fall back to user's source.
        effectiveSource = baseSource;
        fmParamMergeWarning =
          'Could not splice structured parameters: source did not start with FUNCTION keyword. Used the supplied source verbatim.';
      }
    }
    // Defense-in-depth: strip *" comment blocks even after splicing — the
    // user's body may contain them (e.g. pasted from SAPGUI).
    const stripped = stripFmParamCommentBlock(effectiveSource);
    effectiveSource = stripped.source;
    if (stripped.wasStripped) {
      fmParamStripWarning =
        'Stripped *"…IMPORTING/EXPORTING…*" parameter comment blocks (SAP rejects them on PUT — pass `parameters` as a structured array instead).';
    }
  }

  // Pre-write lint validation (uses sanitized source for FUNC)
  const lintWarnings = runPreWriteLint(effectiveSource, type, name, config, lintOverride);
  if (lintWarnings.blocked) return lintWarnings.result!;

  // Pre-write server-side syntax check (opt-in; never blocks — warnings only).
  const checkNotes = await runPreWriteSyntaxCheck(client, type, effectiveSource, objectUrl, config, checkOverride);

  // If safeUpdateSource throws (lock conflict, network error, etc.), checkNotes
  // is intentionally discarded — pre-check warnings only matter when the write succeeded.
  await safeUpdateSource(
    client.http,
    client.safety,
    objectUrl,
    srcUrl,
    effectiveSource,
    transport,
    cachedFeatures?.abapRelease,
  );
  invalidateWrittenObject(type, name);
  const msg = `Successfully updated ${type} ${name}.`;
  const cdsUpdateHint = type === 'DDLS' ? await buildCdsUpdateCrudHint(client, name, objectUrl) : undefined;
  const warnings = mergePreWriteWarnings(
    preflightWarnings.warnings,
    lintWarnings.warnings,
    checkNotes,
    cdsUpdateHint,
    fmParamStripWarning,
    fmParamMergeWarning,
  );
  return warnings ? textResult(`${msg}\n\n${warnings}`) : textResult(msg);
}

export async function writeActionDelete(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, type, name, transport, objectUrl, invalidateWrittenObject, enforcePackageForExistingObject } = ctx;
  await enforcePackageForExistingObject();

  // Lock, delete, unlock pattern (works for all types including SKTD) — auto-propagate lock corrNr if no explicit transport
  try {
    await client.http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
      const effectiveTransport = transport ?? (lock.corrNr || undefined);
      try {
        await deleteObject(session, client.safety, objectUrl, lock.lockHandle, effectiveTransport);
      } finally {
        try {
          await unlockObject(session, objectUrl, lock.lockHandle);
        } catch {
          // Object may already be deleted — unlock failure is expected
        }
      }
    });
  } catch (err) {
    if (
      err instanceof AdtApiError &&
      CDS_DEPENDENCY_SENSITIVE_TYPES.has(canonicalTablType(type)) &&
      isDeleteDependencyError(err)
    ) {
      const hint = await buildCdsDeleteDependencyHint(client, type, name, objectUrl);
      if (hint) {
        // Attach via extraHint so the LLM-facing formatter renders it after
        // DDIC diagnostics ("what happened → diagnostics → how to fix").
        // Mutating err.message would surface the hint before diagnostics and
        // leak into any other consumer of the same error instance.
        err.extraHint = hint;
      }
    }
    throw err;
  }
  invalidateWrittenObject();
  return textResult(`Deleted ${type} ${name}.`);
}

/** Write a global class's text symbols via the ADT textelements service. type=CLAS only. The body is
 *  the properties-style pool (`@MaxLength:NN` per symbol, then `NNN=text`). Immediately active — no
 *  SAPActivate. The client method locks the textelements object, PUTs, and unlocks; the package gate
 *  here checks the class's real package (ctx.objectUrl is the /oo/classes/{n} URL). Not an
 *  ABAP-source write → no lint. (Selection texts are a program selection-screen concept — a class has
 *  none — so only text symbols are supported here.) */
export async function writeActionEditTextSymbols(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, type, name, source, hasSource, transport, enforcePackageForExistingObject, invalidateWrittenObject } =
    ctx;
  if (type !== 'CLAS') {
    return errorResult('action edit_text_symbols requires type=CLAS (global class text symbols).');
  }
  if (!hasSource) {
    return errorResult(
      'source is required for edit_text_symbols — the text-symbol body, e.g. "@MaxLength:20\\n001=Label\\n" (one @MaxLength per symbol, blank-line separated).',
    );
  }
  await enforcePackageForExistingObject();
  await client.writeClassTextSymbols(name, source, transport);
  invalidateWrittenObject();
  return textResult(`Updated text symbols for class ${name}.`);
}
