/**
 * SAPWrite handler — create/update/delete ABAP source + DDIC metadata, class-section surgery,
 * RAP scaffolding, batch create. Extracted from intent.ts (Stage B; moved verbatim).
 * NOTE: this ~1.8K-line handler is a candidate for an internal write/ split (plan Stage D).
 */

import {
  diffMethodSets,
  extractMethodNameFromClause,
  findSectionAnchor,
  insertMethodPair,
  moveMethodDefinition,
  removeMethodPair,
  spliceClassDefinition,
  spliceMethodSignature,
} from '../adt/class-structure.js';
import type { AdtClient } from '../adt/client.js';
import {
  createObject,
  deleteObject,
  lockObject,
  safeUpdateClassInclude,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
  updateObject,
  updateSource,
} from '../adt/crud.js';
import { normalizeAdtLanguage, rewriteKtdText } from '../adt/ddic-xml.js';
import { activate, activateBatch } from '../adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import { type FmParameter, spliceFmSignature } from '../adt/fm-signature.js';
import { generateBehaviorImplementation, isRapGenerateResultSuccess } from '../adt/rap-generate.js';
import {
  applyRapHandlerScaffold,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
} from '../adt/rap-handlers.js';
import { checkPackage } from '../adt/safety.js';
import { isServerDrivenObjectType } from '../adt/server-driven.js';
import { getTransport, getTransportInfo } from '../adt/transport.js';
import type { ClassStructure } from '../adt/types.js';
import { validateAffHeader } from '../aff/validator.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { spliceMethod } from '../context/method-surgery.js';
import { logger } from '../server/logger.js';
import type { ServerConfig } from '../server/types.js';
import { type BatchActivationObject, buildBatchActivationStatuses, formatBatchActivationStatuses } from './activate.js';
import {
  buildCdsDeleteDependencyHint,
  buildCdsUpdateCrudHint,
  CDS_DEPENDENCY_SENSITIVE_TYPES,
  guardCdsSyntax,
} from './cds-hints.js';
import { type CacheSecurityContext, invalidateInactiveList } from './cache-security.js';
import { cachedFeatures, isTablesEndpointAvailable } from './feature-cache.js';
import {
  CLASS_WRITE_INCLUDES,
  type ClassWriteInclude,
  canonicalTablType,
  classIncludeUrl,
  detectLocalHandlerInclude,
  normalizeClassWriteInclude,
  normalizeObjectType,
  normalizeWriteObjectType,
  objectBasePath,
  objectUrlForType,
  sourceUrlForType,
  stripIncludeHeader,
} from './object-types.js';
import { resolveVersionAndDraftInfo, type SourceVersion } from './read.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import {
  buildCreateXml,
  createContentTypeForType,
  dtelNeedsPostCreateUpdate,
  enforceAllowedPackageForObjectUrl,
  escapeXml,
  getMetadataWriteProperties,
  handleServerDrivenObjectWrite,
  isMetadataWriteType,
  mergeMetadataWriteProperties,
  mergePreWriteWarnings,
  NAME_CASE_GUARD_ACTIONS,
  type PreWriteLintResult,
  runPreWriteLint,
  runPreWriteSyntaxCheck,
  runRapPreflightValidation,
  SKTD_V2_CONTENT_TYPE,
  stripFmParamCommentBlock,
  tryPostSaveSyntaxCheck,
  vendorContentTypeForType,
} from './write-helpers.js';

function isDeleteDependencyError(err: AdtApiError): boolean {
  const clean = AdtApiError.extractCleanMessage(err.responseBody ?? err.message).toLowerCase();
  const body = (err.responseBody ?? '').toLowerCase();
  const diagnostics = err.responseBody ? AdtApiError.extractDdicDiagnostics(err.responseBody) : [];

  if (diagnostics.some((diag) => diag.messageNumber === '039')) return true;

  return /could not be deleted|cannot be deleted|still in use|used by|dependent object|existing reference/.test(
    `${clean}\n${body}`,
  );
}

/** Stable hint surfaced when ARC-1 refuses a TABL/DT write because the connected
 *  system does not expose /sap/bc/adt/ddic/tables/. Shared between the
 *  resolver-driven update/delete/activate paths and the discovery-gated create
 *  paths so the LLM always sees the same recovery instructions. */
const TABL_DT_WRITE_UNAVAILABLE_HINT =
  'Transparent table writes via ADT REST are not available on this system ' +
  '(/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC ' +
  'structures endpoint only; the table editor was added in NW 7.52). ' +
  'Use SE11 in SAPGUI, or connect ARC-1 to an SAP_BASIS ≥ 7.52 system. ' +
  'Writing the source via /sap/bc/adt/ddic/structures/ would silently flip ' +
  'DD02L-TABCLASS to INTTAB and corrupt the table.';

/** BTP-specific error messages for unavailable operations */
function normalizePackageOverride(rawPackage: unknown, fallback: string): string {
  if (rawPackage === undefined || rawPackage === null) {
    return fallback;
  }
  const value = String(rawPackage).trim();
  return value || fallback;
}

function normalizeTransportOverride(rawTransport: unknown): string | undefined {
  if (rawTransport === undefined || rawTransport === null) {
    return undefined;
  }
  const value = String(rawTransport).trim();
  return value || undefined;
}

export async function handleSAPWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer?: CachingLayer,
  cacheSecurity?: CacheSecurityContext,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const type = normalizeWriteObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const source = String(args.source ?? '');
  const hasSource = typeof args.source === 'string';
  const include = normalizeClassWriteInclude(args.include);
  // Whether a non-empty include was actually requested. Some MCP clients serialize
  // an omitted optional string as "" — treat empty/whitespace as "not provided" so
  // those clients aren't rejected with a bogus "Invalid CLAS include" on the MAIN path.
  const includeProvided = typeof args.include === 'string' && args.include.trim() !== '';
  const transport = args.transport as string | undefined;
  const lintOverride = args.lintBeforeWrite as boolean | undefined;
  const preflightOverride = args.preflightBeforeWrite as boolean | undefined;
  const checkOverride = args.checkBeforeWrite as boolean | undefined;

  // type and name are required for all actions except batch_create
  if (action !== 'batch_create' && (!type || !name)) {
    return errorResult('"type" and "name" are required for this action.');
  }

  // SAP TADIR stores object names uppercase. Mixed-case names cause silent corruption
  // on create (e.g. DDLS "Zc_MyView" registers as "ZC_MYVIEW" in TADIR but the source body
  // still contains "Zc_MyView", confusing every downstream tool) and broken URL lookups on
  // mutate/delete — the lock is held against the canonical uppercase name while the request
  // URL carries the mixed-case one, which surfaces on ECC as 423 "... is not locked" (issue
  // #293, original report used name "Z_HELLO_world"). Reject pre-flight for every name-bearing
  // single-object action — universal SAP convention, not a 7.50 quirk. (batch_create validates
  // each item separately below.)
  // Note: source code INSIDE the object can use mixed case (e.g. for DDLS: name="ZC_MYVIEW"
  // but `define view entity Zc_MyView` is fine inside the source body).
  if (NAME_CASE_GUARD_ACTIONS.has(action) && name && name !== name.toUpperCase()) {
    return errorResult(
      `Object name "${name}" contains lowercase characters. SAP object names must be uppercase (e.g. "${name.toUpperCase()}").\n\n` +
        `Note: the object NAME in TADIR must be uppercase, but the source code inside the object can use mixed case ` +
        `(e.g. for DDLS: name="${name.toUpperCase()}" but source can contain "define view entity ${name}").`,
    );
  }

  // Server-driven objects (ABAP Platform 2025 / SAP_BASIS 8.16+): DESD, EVTB, DTSC, CSNM, EVTO, COTA
  // share one AFF generic-object write contract (POST blue:blueSource metadata → PUT AFF JSON source
  // → activate). They route through the dedicated engine instead of the per-type switch below —
  // objectBasePath(<sdo>) throws, so this MUST come before the objectUrl computation. Mirrors the
  // server-driven branch in handleSAPRead.
  if (isServerDrivenObjectType(type)) {
    return handleServerDrivenObjectWrite(client, action, type, name, args, cachingLayer, cacheSecurity);
  }

  // For TABL update/delete/edit_method, the existing object may live at /tables/
  // (transparent) or /structures/ (DDIC structure). Resolve once via the client's
  // cached URL probe. For 'create' the default /tables/ URL is correct (we only
  // create transparent tables today; structure creation is out of scope).
  //
  // For FUNC, the URL has the parent function group baked into the path:
  //   /sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}
  // `objectBasePath('FUNC')` deliberately throws (PR #223 — generic URL builders
  // must fail loudly for FM since they can't know the parent group). Issue #250:
  // we pre-resolve the URL here from `args.group` (required for create; auto-
  // resolved via search for update/delete) so the action switch downstream uses
  // the correct URL. We also mirror the resolved group back onto args so
  // `buildCreateXml('FUNC', …, properties)` finds it.
  let objectUrl: string;
  let srcUrl: string;
  if (
    (type === 'TABL' || type === 'TABL/DT' || type === 'TABL/DS') &&
    action !== 'create' &&
    action !== 'batch_create'
  ) {
    // All TABL forms route through the search-first resolver on update/delete/activate
    // so the PR #286 SE11-hint refusal applies even when callers pass an explicit slash form.
    try {
      objectUrl = await client.resolveTablObjectUrlForWrite(name, {
        tablesEndpointAvailable: isTablesEndpointAvailable(),
      });
    } catch (resolveErr) {
      if (resolveErr instanceof AdtSafetyError) {
        return errorResult(resolveErr.message);
      }
      throw resolveErr;
    }
    srcUrl = `${objectUrl}/source/main`;
  } else if (type === 'FUNC') {
    let group = String(args.group ?? '').trim();
    if (!group) {
      if (action === 'create') {
        return errorResult(
          '"group" is required to create a FUNC. Create the parent function group first (SAPWrite type=FUGR) or pass group explicitly.',
        );
      }
      // For update/delete try to auto-resolve the group via search
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(
          `Cannot resolve function group for FM "${name}". Provide the "group" parameter explicitly, or use SAPSearch to find the parent group.`,
        );
      }
      group = resolved;
    }
    const groupLc = encodeURIComponent(group.toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(name.toLowerCase())}`;
    srcUrl = `${objectUrl}/source/main`;
    // Pass the resolved group through to buildCreateXml via args.group
    (args as Record<string, unknown>).group = group;
  } else {
    // Discovery gate: refuse transparent-table creates upfront on systems that
    // don't expose /ddic/tables/ (NW 7.50/7.51). TABL/DS skips this — /structures/
    // is always available. See issue #285.
    if ((type === 'TABL' || type === 'TABL/DT') && (action === 'create' || action === 'batch_create')) {
      if (isTablesEndpointAvailable() === false) {
        return errorResult(TABL_DT_WRITE_UNAVAILABLE_HINT);
      }
    }
    objectUrl = objectUrlForType(type, name);
    srcUrl = sourceUrlForType(type, name);
  }

  const invalidateWrittenObject = (objType = type, objName = name): void => {
    // Source cache is keyed by canonical type (SAPRead collapses TABL/DT, TABL/DS).
    cachingLayer?.invalidate(canonicalTablType(objType), objName, 'all');
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  };

  // Helper: enforce allowedPackages for existing objects (update/delete/edit_method/scaffold_rap_handlers).
  // Only fetches metadata when package restrictions are configured — no extra HTTP call otherwise.
  // Fail-closed: if the package cannot be determined from ADT metadata, refuse the write
  // rather than silently passing through the allowlist gate.
  async function enforcePackageForExistingObject(): Promise<string | undefined> {
    return enforceAllowedPackageForObjectUrl(client, objectUrl, `Operations on ${type} '${name}'`);
  }

  // Helper for class-section surgery (issue #303): fetch the class structure AND
  // /source/main at the SAME effective version, so the spliced line ranges line
  // up with the bytes being edited. resolveVersionAndDraftInfo picks 'inactive'
  // when an unactivated draft exists. We pass that version to BOTH getClassStructure
  // (the /objectstructure?version= read) and the source read, AND to the cache opts
  // (so inactive bytes aren't cached under the 'active' key). Without this, a chained
  // surgery call on a draft would splice active-version line ranges into inactive
  // source and silently corrupt the draft.
  async function fetchClassStructureAndMain(
    clsName: string,
  ): Promise<{ structure: ClassStructure; main: string; effectiveVersion: SourceVersion }> {
    const { effectiveVersion } = await resolveVersionAndDraftInfo(
      client,
      cachingLayer,
      'CLAS',
      clsName,
      'auto',
      cacheSecurity,
    );
    const structure = await client.getClassStructure(clsName, effectiveVersion);
    const main = cachingLayer
      ? (
          await cachingLayer.getSource(
            'CLAS',
            clsName,
            (ifNoneMatch) => client.getClass(clsName, undefined, { ifNoneMatch, version: effectiveVersion }),
            { version: effectiveVersion },
          )
        ).source
      : (await client.getClass(clsName, undefined, { version: effectiveVersion })).source;
    return { structure, main, effectiveVersion };
  }

  switch (action) {
    case 'update': {
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
        const body = buildCreateXml(type, name, pkg, description, mergedProps, config.language, config.username);
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
    case 'create': {
      const pkg = String(args.package ?? '$TMP');
      await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
      const description = String(args.description ?? name);

      // Pre-flight: check transport requirements for non-$TMP packages when no transport provided.
      // SAP requires a transport number for objects in transportable packages.
      // Instead of letting SAP return a cryptic error, we detect this early and return
      // an actionable error message guiding the LLM to use SAPTransport first.
      let effectiveTransport = transport;
      if (!transport && pkg.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, objectUrl, pkg, 'I');
          if (transportInfo.lockedTransport) {
            // Object is already locked in a transport — use it automatically
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            // Transport IS required but none provided — return guidance
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${pkg}" requires a transport number for object creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPWrite(action="create", ..., transport="<transport_id>")` +
                existingList,
            );
          }
          // isLocal=true or recording=false → no transport needed, proceed without one
        } catch {
          // If transportInfo check fails (older system, permissions, etc.), proceed without it.
          // SAP will return its own error if a transport is actually needed.
        }
      }

      // MSAG transport-vs-task guard. Some SAP releases silently drop message inserts when
      // given a task number as corrNr — CL_ADT_MESSAGE_CLASS_API=>create() passes corrNr to
      // CTS_WBO_API_INSERT_OBJECTS which only accepts request numbers. The TADIR entry is
      // created but T100/T100A are never written, leaving a phantom MSAG. Confirmed on NW 7.50;
      // unclear whether later releases fixed it, so validate everywhere.
      // Cost: one extra HTTP roundtrip per MSAG create (negligible vs. the data loss risk).
      if (type === 'MSAG' && effectiveTransport) {
        const tr = await getTransport(client.http, client.safety, effectiveTransport);
        if (!tr) {
          return errorResult(
            `Transport "${effectiveTransport}" is not a valid transport request. ` +
              `MSAG creation requires a transport request number, not a task number. ` +
              `Use SAPTransport(action="get", id="<request>") to verify, or SAPTransport(action="list") to find modifiable requests.`,
          );
        }
      }

      // CDS pre-write validation: reject unsupported syntax early
      const cdsGuard = guardCdsSyntax(type, source, cachedFeatures);
      if (cdsGuard) return cdsGuard;

      // RAP deterministic preflight validation (before object creation to avoid stubs)
      const preflightWarnings = runRapPreflightValidation(
        source,
        type,
        name,
        cachedFeatures,
        config.systemType,
        preflightOverride,
      );
      if (preflightWarnings.blocked) return preflightWarnings.result!;

      // AFF header validation (if schema available for this type)
      const affResult = validateAffHeader(type, { description, originalLanguage: 'en' });
      if (!affResult.valid) {
        return errorResult(
          `AFF metadata validation failed for ${type} ${name}:\n- ${(affResult.errors ?? []).join('\n- ')}\n\nFix the metadata and retry.`,
        );
      }

      if (type === 'SKTD') {
        // A KTD is not a standalone object — it documents a parent object (e.g., a DDLS view or a CLAS).
        // The create POST goes to the collection URL with a sktd:docu XML body that references the parent.
        const refType = String(args.refObjectType ?? '');
        if (!refType) {
          return errorResult(
            '"refObjectType" is required for SKTD create — the ADT type+subtype of the parent object being documented (e.g., "DDLS/DF", "CLAS/OC", "PROG/P", "INTF/OI", "BDEF/BDO", "SRVD/SRV").',
          );
        }
        const refName = String(args.refObjectName ?? name);
        // SAP rule: a KTD's own name must equal the parent object's name (one KTD per object).
        // Creating a KTD named differently from its parent fails server-side with a cryptic
        // "Check of condition failed" — fail fast with a clear message instead.
        if (refName.toUpperCase() !== name.toUpperCase()) {
          return errorResult(
            `SKTD name "${name}" must match refObjectName "${refName}" — a Knowledge Transfer Document inherits the name of the ABAP object it documents (one KTD per object). To document "${refName}", call SAPWrite(action="create", type="SKTD", name="${refName}", refObjectType="${refType}", ...).`,
          );
        }
        const refDescription = String(args.refObjectDescription ?? '');
        // Build the parent URI. ADT URIs use lowercase names by convention (matches the Eclipse trace).
        const refParentType = refType.split('/')[0] ?? '';
        const refUri = `${objectBasePath(refParentType)}${encodeURIComponent(refName.toLowerCase())}`;

        const ktdLang = normalizeAdtLanguage(config.language);
        const ktdBody = `<?xml version="1.0" encoding="UTF-8"?>
<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:language="${ktdLang}" adtcore:name="${escapeXml(name)}" adtcore:type="SKTD/TYP" adtcore:masterLanguage="${ktdLang}">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
  <sktd:refObject adtcore:description="${escapeXml(refDescription)}" adtcore:name="${escapeXml(refName)}" adtcore:type="${escapeXml(refType)}" adtcore:uri="${escapeXml(refUri)}"/>
</sktd:docu>`;

        const ktdCreateUrl = '/sap/bc/adt/documentation/ktd/documents';
        const ktdResult = await createObject(
          client.http,
          client.safety,
          ktdCreateUrl,
          ktdBody,
          SKTD_V2_CONTENT_TYPE,
          effectiveTransport,
          undefined,
          cachedFeatures?.abapRelease,
        );

        // If initial Markdown was provided, follow up with an update PUT to write it.
        // Same envelope contract as the update path: fetch-then-rewrite ensures we
        // PUT back exactly the shape SAP gave us (with all the server-assigned
        // metadata), only swapping <sktd:text>.
        if (source) {
          const { source: currentEnvelope } = await client.getKtd(name);
          const body = rewriteKtdText(currentEnvelope, source);
          await safeUpdateObject(
            client.http,
            client.safety,
            objectUrl,
            body,
            SKTD_V2_CONTENT_TYPE,
            effectiveTransport,
            cachedFeatures?.abapRelease,
          );
          invalidateWrittenObject(type, name);
          return textResult(
            `Created SKTD ${name} in package ${pkg} and wrote Markdown content.\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
          );
        }
        invalidateWrittenObject();
        return textResult(
          `Created SKTD ${name} in package ${pkg} (no Markdown content written — pass "source" to write the body).\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
        );
      }

      // Build type-specific creation XML body.
      // SAP ADT requires the root element to match the object type —
      // a generic objectReferences body returns 400 "System expected the element ...".
      const metadataProperties = getMetadataWriteProperties(args);
      const body = buildCreateXml(type, name, pkg, description, metadataProperties, config.language, config.username);

      // Step 1: Create the object (metadata only)
      const createUrl = objectUrl.replace(/\/[^/]+$/, ''); // parent collection URL
      // DOMA/DTEL/BDEF require vendor-specific content types; all other types use
      // 'application/*' — the wildcard lets the SAP server resolve the correct
      // handler (matching how ADT Eclipse and abap-adt-api send requests).
      const contentType = createContentTypeForType(type);
      const needsPackageParam = type === 'BDEF' || type === 'TABL' || type === 'TABL/DT' || type === 'TABL/DS';
      let result: string;
      try {
        result = await createObject(
          client.http,
          client.safety,
          createUrl,
          body,
          contentType,
          effectiveTransport,
          needsPackageParam ? pkg : undefined,
          cachedFeatures?.abapRelease,
        );
      } catch (createErr) {
        if (createErr instanceof AdtApiError && (createErr.statusCode === 400 || createErr.statusCode === 409)) {
          const syntaxDetail = await tryPostSaveSyntaxCheck(client, type, name);
          if (syntaxDetail) {
            createErr.message += syntaxDetail;
          }
        }
        throw createErr;
      }

      if (isMetadataWriteType(type)) {
        // SAP's DTEL POST ignores labels, searchHelp, etc. — they require a follow-up PUT.
        // Use withStatefulSession directly (not safeUpdateObject) to keep the lock cycle
        // on the main client's session, avoiding lock contention with subsequent operations.
        if (type === 'DTEL' && dtelNeedsPostCreateUpdate(metadataProperties)) {
          const ct = vendorContentTypeForType(type);
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
            const lockTransport = effectiveTransport ?? (lock.corrNr || undefined);
            try {
              await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, ct, lockTransport);
            } finally {
              await unlockObject(session, objectUrl, lock.lockHandle);
            }
          });
        }
        // MSAG: POST creates empty container — follow-up PUT to write messages
        if (type === 'MSAG' && Array.isArray(metadataProperties.messages) && metadataProperties.messages.length > 0) {
          const ct = vendorContentTypeForType(type);
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
            const lockTransport = effectiveTransport ?? (lock.corrNr || undefined);
            try {
              await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, ct, lockTransport);
            } finally {
              await unlockObject(session, objectUrl, lock.lockHandle);
            }
          });
        }
        invalidateWrittenObject();
        const followUpHint =
          type === 'SRVB'
            ? `\n\nNext steps:\n1. SAPActivate(type="SRVB", name="${name}")\n2. SAPActivate(action="publish_srvb", name="${name}")`
            : '';
        return textResult(`Created ${type} ${name} in package ${pkg}.\n${result}${followUpHint}`);
      }

      // Step 2: Write source code if provided.
      // Issue #252: FUNC create accepts a structured `parameters` array; if
      // provided we must follow up with a source PUT even when `source` is
      // omitted (the array alone synthesizes a minimal FUNCTION/ENDFUNCTION
      // body containing the signature clause).
      const funcParameters = type === 'FUNC' ? (args.parameters as FmParameter[] | undefined) : undefined;
      const shouldWriteSource = !!source || (funcParameters !== undefined && funcParameters.length > 0);
      if (shouldWriteSource) {
        // FUNC: build/splice the signature, then strip SAPGUI parameter comment
        // blocks as defense-in-depth (see update path for rationale).
        let createSource = source ?? '';
        let fmParamStripWarning: string | undefined;
        let fmParamMergeWarning: string | undefined;
        if (type === 'FUNC') {
          if (funcParameters !== undefined) {
            let baseSource: string;
            if (!createSource || createSource.trim() === '') {
              baseSource = `FUNCTION ${name}.\nENDFUNCTION.\n`;
            } else if (!/^\s*FUNCTION\s+/i.test(createSource)) {
              // Body-only source — wrap so the splicer has a signature region.
              baseSource = `FUNCTION ${name}.\n${createSource}\nENDFUNCTION.\n`;
            } else {
              baseSource = createSource;
            }
            try {
              createSource = spliceFmSignature(baseSource, name, funcParameters);
            } catch {
              createSource = baseSource;
              fmParamMergeWarning =
                'Could not splice structured parameters: source did not start with FUNCTION keyword. Used the supplied source verbatim.';
            }
          }
          const stripped = stripFmParamCommentBlock(createSource);
          createSource = stripped.source;
          if (stripped.wasStripped) {
            fmParamStripWarning =
              'Stripped *"…IMPORTING/EXPORTING…*" parameter comment blocks (pass `parameters` as a structured array instead).';
          }
        }

        // Pre-write lint validation
        const lintWarnings = runPreWriteLint(createSource, type, name, config, lintOverride);
        if (lintWarnings.blocked) {
          return textResult(
            `Created ${type} ${name} in package ${pkg}, but source was rejected by lint:\n${lintWarnings.result!.content[0].text}`,
          );
        }

        await safeUpdateSource(
          client.http,
          client.safety,
          objectUrl,
          srcUrl,
          createSource,
          effectiveTransport,
          cachedFeatures?.abapRelease,
        );
        invalidateWrittenObject(type, name);
        const msg = `Created ${type} ${name} in package ${pkg} and wrote source code.`;
        const warnings = mergePreWriteWarnings(
          preflightWarnings.warnings,
          lintWarnings.warnings,
          fmParamStripWarning,
          fmParamMergeWarning,
        );
        return warnings ? textResult(`${msg}\n\n${warnings}`) : textResult(msg);
      }

      return textResult(`Created ${type} ${name} in package ${pkg}.\n${result}`);
    }
    case 'edit_method': {
      const method = String(args.method ?? '');
      if (!method) return errorResult('"method" is required for edit_method action.');
      if (!source) return errorResult('"source" (new method body) is required for edit_method action.');
      if (type !== 'CLAS') return errorResult('edit_method is only supported for type=CLAS.');
      await enforcePackageForExistingObject();

      // ── Resolve which class section the method body lives in ──
      // Order:
      //   1. Explicit `include` parameter wins (must be a valid CLAS include).
      //      If the user passed something but normalization rejected it,
      //      report it the same way `case 'update'` does.
      //   2. Auto-detect from local-class prefix in `method` specifier
      //      (lhc_*/lcl_* → implementations, ltc_* → testclasses). This is
      //      transparent to RAP-skill callers passing `lhc_project~approve_project`.
      //   3. Fall through to MAIN (existing behavior — covers global classes
      //      and `zif_order~create` style interface methods).
      if (args.include !== undefined && !include) {
        return errorResult(
          `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
        );
      }
      const detectedInclude = include ? undefined : detectLocalHandlerInclude(method);
      const resolvedInclude: ClassWriteInclude | undefined = include ?? detectedInclude;

      // Fetch the source that contains the method.
      // Note: include reads bypass the source cache because the cache key is
      // `(type, name, active|inactive)` and does not differentiate by include.
      // Mixing MAIN and CCIMP bytes under the same key would silently corrupt
      // subsequent reads. Future enhancement: extend cache key with include.
      let currentSource: string;
      if (resolvedInclude) {
        // **Draft-aware include reads (PR-D review fix, P1).**
        // After `SAPWrite update include=...` or `scaffold_rap_handlers`, the
        // edited CCDEF/CCIMP lives as an inactive draft; the active include
        // is often still the empty placeholder. Reading "active" here would
        // splice against stale content (and frequently "method not found").
        // Use the standard inactive-list lookup to pick the right version —
        // same auto-resolution semantics SAPRead exposes via `version='auto'`.
        const { effectiveVersion } = await resolveVersionAndDraftInfo(
          client,
          cachingLayer,
          'CLAS',
          name,
          'auto',
          cacheSecurity,
        );
        const fetched = await client.getClass(name, resolvedInclude, { version: effectiveVersion });
        currentSource = stripIncludeHeader(fetched.source);
        // If the include itself has no draft (only MAIN does), SAP returns the
        // active include body for `?version=inactive`. That's correct — we
        // splice whatever the editor would see. If the include source isn't
        // available at all (response contains the "not available" placeholder
        // injected by client.getClass on 404), splice will surface a clean
        // "method not found" with the include name.
      } else {
        currentSource = cachingLayer
          ? (
              await cachingLayer.getSource('CLAS', name, (ifNoneMatch) =>
                client.getClass(name, undefined, { ifNoneMatch }),
              )
            ).source
          : (await client.getClass(name)).source;
      }

      // Use detected ABAP version from probe if available
      const abaplintVer = cachedFeatures?.abapRelease
        ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
        : undefined;

      // Splice in the new method body
      const spliced = spliceMethod(currentSource, name, method, source, abaplintVer);
      if (!spliced.success) {
        // Augment the error with which include was searched, so the LLM can
        // either correct the method specifier or override include= explicitly.
        const where = resolvedInclude ? `include "${resolvedInclude}"` : 'main source';
        const baseError = spliced.error ?? `Failed to splice method "${method}" in ${name}.`;
        const hint = detectedInclude
          ? ` (auto-routed via "${method}" prefix; pass include= explicitly to override).`
          : '';
        return errorResult(`${baseError} Searched ${where} of ${name}.${hint}`);
      }

      // Pre-write lint + server-side syntax check on the spliced source.
      //
      // Skip BOTH for include= writes. abaplint cannot parse a CCIMP/CCDEF
      // fragment as a complete class (the DEFINITION/IMPLEMENTATION halves
      // live in different files), so it would block legitimate writes with
      // "Expected CLASSDEFINITION" errors. The existing `case 'update'` include=
      // path also bypasses these checks for the same reason — keep parity.
      // The full-class activation pass after the write is the authoritative
      // syntax check.
      let lintWarnings: ReturnType<typeof runPreWriteLint> = { blocked: false } as ReturnType<typeof runPreWriteLint>;
      let checkNotes = '';
      if (!resolvedInclude) {
        lintWarnings = runPreWriteLint(spliced.newSource, type, name, config, lintOverride);
        if (lintWarnings.blocked) return lintWarnings.result!;

        checkNotes = await runPreWriteSyntaxCheck(client, type, spliced.newSource, objectUrl, config, checkOverride);
      }

      // Write the full source back (existing lock/modify/unlock flow).
      // For include writes, the parent class lock auto-applies; the include URL
      // takes the body. See `compare/eclipse-adt/api/05-lock-create-update-transport.md`.
      const writeUrl = resolvedInclude ? classIncludeUrl(name, resolvedInclude) : srcUrl;
      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        writeUrl,
        spliced.newSource,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const where = resolvedInclude ? ` (include: ${resolvedInclude})` : '';
      const msg = `Successfully updated method "${method}" in ${type} ${name}${where}.`;
      const extras = [lintWarnings.warnings, checkNotes].filter(Boolean).join('\n\n');
      return extras ? textResult(`${msg}\n\n${extras}`) : textResult(msg);
    }

    // ─── Class-section surgery actions (issue #303) ─────────────────────
    //
    // Four actions share a common shape: fetch objectstructure → optional
    // diff/refuse → splice into /source/main (or /includes/<inc> when
    // include= is set) → PUT under lock → no auto-activate.
    //
    // Pre-write lint runs on the SPLICED FULL source (not the partial input
    // fragment) because a raw DEFINITION block alone fails abaplint with
    // "Expected CLASSIMPLEMENTATION" — verified live on a4h. Lint is skipped
    // for include= writes (same precedent as `update include=` path).
    case 'edit_class_definition': {
      if (type !== 'CLAS') return errorResult('edit_class_definition is only supported for type=CLAS.');
      if (!hasSource)
        return errorResult('"source" (new CLASS DEFINITION block) is required for edit_class_definition.');
      if (includeProvided && !include) {
        return errorResult(
          `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
        );
      }
      await enforcePackageForExistingObject();

      const writeUrl = include ? classIncludeUrl(name, include) : srcUrl;
      let spliced: string;
      if (include) {
        // include= path: whole-replace the local include (CCDEF/CCIMP/macros/
        // testclasses). The structure-based diff/refuse doesn't apply — the
        // /objectstructure endpoint reports the GLOBAL class, not the local
        // include's split DEFINITION/IMPLEMENTATION halves. SAP activation is the
        // validator here (same precedent as `update include=`). No structure or
        // source fetch is needed: the caller's `source` IS the new include body.
        spliced = source.endsWith('\n') ? source : `${source}\n`;
      } else {
        // MAIN path: fetch structure + source at the same effective version so
        // the spliced line ranges align with the bytes being edited.
        const { structure, main } = await fetchClassStructureAndMain(name);

        // Refuse-policy: compute the method-set diff against the NEW DEFINITION.
        const diff = diffMethodSets(structure, source);
        const missingImpls: string[] = [];
        const orphanImpls: string[] = [];
        for (const add of diff.added) {
          // Exempt declarations that never have a METHOD…ENDMETHOD body.
          if (add.isAbstract || add.isEvent || add.isInterface || add.isAlias) continue;
          // Does IMPLEMENTATION already have a METHOD <name> header? Match the
          // method name followed by a word-boundary so AMDP / event-handler /
          // multi-line headers (`METHOD x BY DATABASE PROCEDURE…`, `METHOD x FOR
          // EVENT…`, `METHOD x\n  IMPORTING…`) are recognized — NOT only the bare
          // `METHOD x.` form. \b after the name prevents matching a longer name
          // with the same prefix (METHOD x_helper for added X).
          const re = new RegExp(`^\\s*METHOD\\s+${add.name}\\b`, 'im');
          if (!re.test(main)) missingImpls.push(add.name);
        }
        for (const rem of diff.removed) {
          if (rem.implementation) {
            // Was concrete, still has impl range — caller didn't remove the body.
            orphanImpls.push(rem.name);
          }
        }
        if (missingImpls.length > 0 || orphanImpls.length > 0) {
          const parts: string[] = [];
          if (missingImpls.length > 0) {
            parts.push(
              `Cannot apply edit_class_definition: the new DEFINITION declares method(s) ${missingImpls.join(', ')} but the existing IMPLEMENTATION block has no matching METHOD…ENDMETHOD body. Either include a METHOD <name>. ENDMETHOD. block per added method in your new source, or use SAPWrite(action="add_method", name="${name}", method="<METHODS clause>") to insert each one atomically.`,
            );
          }
          if (orphanImpls.length > 0) {
            parts.push(
              `Cannot apply edit_class_definition: the new DEFINITION removes method(s) ${orphanImpls.join(', ')} but the existing IMPLEMENTATION block still has METHOD…ENDMETHOD bodies for them (orphan implementation). Either remove those METHOD blocks in your edit, or use SAPWrite(action="delete_method", name="${name}", method="<name>") to drop each one atomically.`,
            );
          }
          return errorResult(parts.join('\n\n'));
        }
        spliced = spliceClassDefinition(main, structure, source);
      }

      // Pre-write lint on the spliced full source (MAIN path only — include=
      // fragments can't be lint-parsed standalone).
      if (!include) {
        const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
        if (lintWarnings.blocked) return lintWarnings.result!;
      }

      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        writeUrl,
        spliced,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const whereLabel = include ? ` (include: ${include})` : '';
      return textResult(
        `Successfully updated DEFINITION of ${type} ${name}${whereLabel}. Active version unchanged until activation; read with SAPRead(version="inactive") to verify, then SAPActivate.`,
      );
    }

    case 'edit_method_signature': {
      if (type !== 'CLAS') return errorResult('edit_method_signature is only supported for type=CLAS.');
      const methodSpecifier = String(args.method ?? '').trim();
      if (!methodSpecifier) {
        return errorResult('"method" (the method NAME to re-sign) is required for edit_method_signature.');
      }
      if (!hasSource) {
        return errorResult('"source" (the new METHODS clause) is required for edit_method_signature.');
      }
      // MAIN-only action: include= is rejected at the schema layer (this action is
      // not in SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls
      // that bypass Zod.
      if (includeProvided) {
        return errorResult(
          'edit_method_signature targets the global class DEFINITION (/source/main). For local-class (CCDEF) signatures, use edit_class_definition with include=definitions.',
        );
      }
      await enforcePackageForExistingObject();

      const { structure, main } = await fetchClassStructureAndMain(name);
      const upperName = methodSpecifier.toUpperCase();
      const method = structure.methods.find((m) => m.name === upperName);
      if (!method) {
        const available = structure.methods.map((m) => m.name).join(', ');
        const hint = methodSpecifier.includes('~')
          ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here — objectstructure lists the implementing method under its bare name; for interface/local-handler bodies use edit_method.'
          : '';
        return errorResult(
          `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
        );
      }

      const spliced = spliceMethodSignature(main, method, source);
      // No pre-write lint: edit_method_signature changes ONLY the declaration; the
      // method body still references the old signature until the caller follows up
      // with edit_method. Linting the spliced full source here would flag legitimate
      // in-progress renames (e.g. "param `name` not declared"). SAP activation is the
      // authoritative check — same rationale as the include= lint skip on edit_method.
      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        srcUrl,
        spliced,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      return textResult(
        `Successfully updated signature of method "${method.name}" in ${type} ${name}. Active version unchanged until activation; if the body still references the old signature, follow up with edit_method, then SAPActivate.`,
      );
    }

    case 'add_method': {
      if (type !== 'CLAS') return errorResult('add_method is only supported for type=CLAS.');
      const clause = String(args.method ?? '');
      if (!clause.trim()) {
        return errorResult(
          '"method" (the full METHODS clause, e.g. "METHODS greet IMPORTING who TYPE string.") is required for add_method.',
        );
      }
      const methodName = extractMethodNameFromClause(clause);
      if (!methodName) {
        return errorResult(
          'Could not extract method name from the METHODS clause. Provide a clause starting with "METHODS <name>" or "CLASS-METHODS <name>".',
        );
      }
      // Interface-qualified names (lhc_x~y, zif_x~m) can't be added to a global
      // class's DEFINITION/IMPLEMENTATION — `~` is interface-method scope and would
      // produce invalid ABAP in the METHOD stub. Reject with a clear pointer.
      if (methodName.includes('~')) {
        return errorResult(
          `add_method cannot add the interface-qualified method "${methodName}" to a global class. Implement the interface via "INTERFACES <name>." in the DEFINITION (use edit_class_definition), then provide the body with edit_method.`,
        );
      }
      const visibility = (args.visibility as 'public' | 'protected' | 'private' | undefined) ?? 'public';
      const isAbstract = args.abstract === true;
      // MAIN-only action: include= is rejected at the schema layer (not in
      // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
      if (includeProvided) {
        return errorResult(
          'add_method targets the global class DEFINITION (/source/main). For local-class (CCDEF) method additions, use edit_class_definition with include=definitions.',
        );
      }
      await enforcePackageForExistingObject();

      const { structure, main } = await fetchClassStructureAndMain(name);
      // Refuse if method already exists (would silently duplicate).
      if (structure.methods.some((m) => m.name === methodName)) {
        return errorResult(
          `Method "${methodName}" already exists in CLAS ${name}. Use SAPWrite(action="edit_method_signature", method="${methodName}", source="<new METHODS clause>") to change its signature.`,
        );
      }

      // A concrete (non-abstract) method needs an IMPLEMENTATION block to receive
      // its METHOD…ENDMETHOD stub. A purely-abstract class has no IMPLEMENTATION
      // half, so inserting a concrete declaration there would leave it unimplemented.
      if (!isAbstract && !structure.classImplementationBlock) {
        return errorResult(
          `CLAS ${name} has no IMPLEMENTATION block (purely abstract class). Pass abstract=true to add an abstract method, or add the IMPLEMENTATION half first via edit_class_definition.`,
        );
      }

      // Refuse with hint if the target visibility section header is missing.
      const anchor = findSectionAnchor(main, structure, visibility);
      if (!anchor) {
        return errorResult(
          `No ${visibility.toUpperCase()} SECTION exists in CLAS ${name}. Use SAPWrite(action="edit_class_definition") to add the section header first, then re-run add_method.`,
        );
      }

      const spliced = insertMethodPair(main, structure, {
        decl: clause,
        visibility,
        methodName,
        isAbstract,
      });

      const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
      if (lintWarnings.blocked) return lintWarnings.result!;

      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        srcUrl,
        spliced,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const stubNote = isAbstract ? ' (abstract — no IMPL stub inserted)' : '';
      return textResult(
        `Successfully added method "${methodName}" (${visibility}) to ${type} ${name}${stubNote}. Active version unchanged until activation; SAPActivate next.`,
      );
    }

    case 'delete_method': {
      if (type !== 'CLAS') return errorResult('delete_method is only supported for type=CLAS.');
      const methodSpecifier = String(args.method ?? '').trim();
      if (!methodSpecifier) {
        return errorResult('"method" (the method NAME to delete) is required for delete_method.');
      }
      // MAIN-only action: include= is rejected at the schema layer (not in
      // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
      if (includeProvided) {
        return errorResult(
          'delete_method targets the global class DEFINITION (/source/main). For local-class (CCDEF/CCIMP) method removal, use edit_class_definition with include=...',
        );
      }
      await enforcePackageForExistingObject();

      const { structure, main } = await fetchClassStructureAndMain(name);
      const upperName = methodSpecifier.toUpperCase();
      const method = structure.methods.find((m) => m.name === upperName);
      if (!method) {
        const available = structure.methods.map((m) => m.name).join(', ');
        const hint = methodSpecifier.includes('~')
          ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here; objectstructure lists methods under their bare names.'
          : '';
        return errorResult(
          `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
        );
      }

      const spliced = removeMethodPair(main, method);
      const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
      if (lintWarnings.blocked) return lintWarnings.result!;

      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        srcUrl,
        spliced,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const where = method.implementation ? ' (DEFINITION + IMPLEMENTATION)' : ' (DEFINITION only — was ABSTRACT)';
      return textResult(
        `Successfully deleted method "${method.name}" from ${type} ${name}${where}. Active version unchanged until activation; SAPActivate next.`,
      );
    }

    case 'change_method_visibility': {
      // Body-preserving visibility move (issue #303 follow-up). Moves the METHODS
      // clause from its current section to the target section; the IMPLEMENTATION
      // block is never touched, so the method body survives. This is the safe
      // alternative to delete_method + add_method (which discards the body).
      if (type !== 'CLAS') return errorResult('change_method_visibility is only supported for type=CLAS.');
      const methodSpecifier = String(args.method ?? '').trim();
      if (!methodSpecifier) {
        return errorResult('"method" (the method NAME to move) is required for change_method_visibility.');
      }
      const target = args.visibility as 'public' | 'protected' | 'private' | undefined;
      if (!target) {
        return errorResult(
          '"visibility" (target section: public, protected, or private) is required for change_method_visibility.',
        );
      }
      // MAIN-only action: include= is rejected at the schema layer (not in
      // SAPWRITE_INCLUDE_AWARE_ACTIONS). Defensive guard for direct CLI calls.
      if (includeProvided) {
        return errorResult(
          'change_method_visibility targets the global class DEFINITION (/source/main). For local-class (CCDEF) methods, use edit_class_definition with include=definitions.',
        );
      }
      await enforcePackageForExistingObject();

      const { structure, main } = await fetchClassStructureAndMain(name);
      const upperName = methodSpecifier.toUpperCase();
      const method = structure.methods.find((m) => m.name === upperName);
      if (!method) {
        const available = structure.methods.map((m) => m.name).join(', ');
        const hint = methodSpecifier.includes('~')
          ? ' Interface-qualified names (e.g. "zif_x~m") are not addressable here; objectstructure lists methods under their bare names.'
          : '';
        return errorResult(
          `Method "${methodSpecifier}" not found in CLAS ${name}. Available methods: ${available || '(none)'}.${hint}`,
        );
      }

      // Idempotent: already in the requested section → no write.
      if (method.visibility === target) {
        return textResult(
          `Method "${method.name}" is already in the ${target.toUpperCase()} SECTION of ${type} ${name}. No change made.`,
        );
      }

      // The target section header must already exist (same constraint as add_method).
      const anchor = findSectionAnchor(main, structure, target);
      if (!anchor) {
        return errorResult(
          `No ${target.toUpperCase()} SECTION exists in CLAS ${name}. Use SAPWrite(action="edit_class_definition") to add the section header first, then re-run change_method_visibility.`,
        );
      }

      // DEFINITION-only move — IMPLEMENTATION (the method body) is preserved verbatim.
      const spliced = moveMethodDefinition(main, method, anchor.afterLine);
      const lintWarnings = runPreWriteLint(spliced, type, name, config, lintOverride);
      if (lintWarnings.blocked) return lintWarnings.result!;

      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        srcUrl,
        spliced,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      return textResult(
        `Successfully moved method "${method.name}" from ${method.visibility.toUpperCase()} to ${target.toUpperCase()} SECTION of ${type} ${name} (IMPLEMENTATION preserved). Active version unchanged until activation; SAPActivate next.`,
      );
    }

    case 'scaffold_rap_handlers': {
      // What this action does:
      //   Given a behavior-pool class (ZBP_*) and its interface BDEF, inspect
      //   the class for every `lhc_<alias>` local handler class and make
      //   sure it declares a METHOD for every action / determination /
      //   validation / authorization master the BDEF requires. When autoApply
      //   is true, missing METHODS signatures plus empty METHOD stubs are
      //   inserted directly and the class is saved.
      //
      // Why this exists:
      //   Without it, the LLM agent trying to author a RAP behavior pool has
      //   to manually read the BDEF, compute the required handler signatures,
      //   paste them into the correct local class, and then save — a
      //   boilerplate-heavy step that is easy to get wrong (alias case,
      //   RESULT vs no RESULT, factory/static modifiers). The activation
      //   errors for an incomplete pool are particularly unhelpful. See
      //   docs/plans/completed/rap-onprem-agent-gap-closure.md.
      if (type !== 'CLAS') {
        return errorResult('scaffold_rap_handlers is only supported for type=CLAS behavior pool classes.');
      }
      const bdefName = String(args.bdefName ?? '').trim();
      if (!bdefName) {
        return errorResult('"bdefName" is required for scaffold_rap_handlers (interface behavior definition name).');
      }
      const autoApply = Boolean(args.autoApply ?? false);
      const targetAlias = String(args.targetAlias ?? '')
        .trim()
        .toLowerCase();

      if (autoApply) {
        await enforcePackageForExistingObject();
      }

      // Why scan all three CLAS includes (main, definitions, implementations):
      //   Behavior-pool handler classes CAN live in any of the three, and
      //   which include they occupy depends on how the pool was generated:
      //     - "main" (source/main) — unusual; some hand-written pools put
      //       lhc_* alongside the global class definition
      //     - "definitions" (CCDEF) — the ADT "Create Behavior Impl Class"
      //       wizard default target
      //     - "implementations" (CCIMP) — older SAP templates and every
      //       example under /DMO/* ship the handler classes here
      //   We read all three so the diff (findMissingRapHandlerRequirements)
      //   reflects what's actually declared anywhere in the class, and the
      //   apply flow can fall through main → definitions → implementations.
      const classStructured = await client.getClassStructured(name);
      const classMainSource = classStructured.main ?? '';
      const classDefinitionsSource = classStructured.definitions ?? '';
      const classImplementationsSource = classStructured.implementations ?? '';
      const classCombinedSource = [classMainSource, classDefinitionsSource, classImplementationsSource]
        .filter(Boolean)
        .join('\n\n');
      const bdefSource = cachingLayer
        ? (await cachingLayer.getSource('BDEF', bdefName, (ifNoneMatch) => client.getBdef(bdefName, { ifNoneMatch })))
            .source
        : (await client.getBdef(bdefName)).source;

      let requirements = extractRapHandlerRequirements(bdefSource);
      if (targetAlias) {
        requirements = requirements.filter((req) => req.entityAlias.toLowerCase() === targetAlias);
      }

      if (requirements.length === 0) {
        const allAliases = Array.from(new Set(extractRapHandlerRequirements(bdefSource).map((req) => req.entityAlias)));
        const aliasHint =
          targetAlias && allAliases.length > 0
            ? ` Available aliases in ${bdefName}: ${allAliases.join(', ')}.`
            : ' No RAP action/determination/validation/auth handler declarations were found in the BDEF source.';
        return errorResult(`No RAP handler requirements were found for the requested scope.${aliasHint}`);
      }

      const missing = findMissingRapHandlerRequirements(requirements, classCombinedSource);
      const missingImplementationStubs = findMissingRapHandlerImplementationStubs(requirements, classCombinedSource);
      const summary = {
        className: name,
        bdefName,
        targetAlias: targetAlias || undefined,
        scannedSections: [
          'main',
          classDefinitionsSource ? 'definitions' : undefined,
          classImplementationsSource ? 'implementations' : undefined,
        ].filter(Boolean),
        requiredCount: requirements.length,
        missingCount: missing.length,
        missing,
        missingImplementationStubCount: missingImplementationStubs.length,
        missingImplementationStubs,
      };

      if (!autoApply || (missing.length === 0 && missingImplementationStubs.length === 0)) {
        return textResult(JSON.stringify({ ...summary, applied: false }, null, 2));
      }

      // Pure RAP transformation planning lives in rap-handlers.ts. Keep this
      // handler focused on MCP/ADT concerns: safety, linting, locking, writes.
      const scaffoldPlan = applyRapHandlerScaffold(
        {
          main: classMainSource,
          definitions: classDefinitionsSource || undefined,
          implementations: classImplementationsSource || undefined,
        },
        missing,
        missingImplementationStubs,
      );

      if (scaffoldPlan.changedSections.length === 0) {
        const unresolvedHandlerClasses = Array.from(
          new Set(scaffoldPlan.unresolved.map((req) => req.targetHandlerClass)),
        );
        const unresolvedHint =
          unresolvedHandlerClasses.length > 0
            ? `No source changes were applied because handler class skeleton(s) ${unresolvedHandlerClasses.join(', ')} were not found in main, definitions, or implementations. Create the local handler class skeleton(s) first (for example with the ADT quick fix "Create local handler class"), then rerun with autoApply=true.`
            : undefined;
        return textResult(
          JSON.stringify(
            {
              ...summary,
              applied: false,
              hint: unresolvedHint,
              applyResult: {
                skeletons: scaffoldPlan.skeletons,
                main: scaffoldPlan.signatures.main,
                definitions: scaffoldPlan.signatures.definitions,
                implementations: scaffoldPlan.signatures.implementations,
                implementationStubs: scaffoldPlan.implementationStubs,
                unresolved: scaffoldPlan.unresolved,
              },
            },
            null,
            2,
          ),
        );
      }

      const finalMainSource = scaffoldPlan.sections.main;
      const finalDefinitionsSource = scaffoldPlan.sections.definitions;
      const finalImplementationsSource = scaffoldPlan.sections.implementations;
      const { changed } = scaffoldPlan;

      // Run lint for every section we are about to update; block before any write to avoid partial state.
      let lintWarningsMain: PreWriteLintResult | undefined;
      if (changed.main) {
        lintWarningsMain = runPreWriteLint(finalMainSource, type, name, config, lintOverride);
        if (lintWarningsMain.blocked) return lintWarningsMain.result!;
      }
      let lintWarningsDefinitions: PreWriteLintResult | undefined;
      if (changed.definitions && finalDefinitionsSource) {
        lintWarningsDefinitions = runPreWriteLint(finalDefinitionsSource, type, name, config, lintOverride);
        if (lintWarningsDefinitions.blocked) return lintWarningsDefinitions.result!;
      }
      let lintWarningsImplementations: PreWriteLintResult | undefined;
      if (changed.implementations && finalImplementationsSource) {
        lintWarningsImplementations = runPreWriteLint(finalImplementationsSource, type, name, config, lintOverride);
        if (lintWarningsImplementations.blocked) return lintWarningsImplementations.result!;
      }
      // All modified includes share one lock so we never end up in a partial-state
      // (e.g. main written, implementations errored → handler class declares but
      // doesn't implement methods → class cannot activate). The lock is taken once
      // at the class object URL, and every include PUT carries the same lockHandle.
      // This mirrors how ADT-in-Eclipse saves a multi-include class in one commit.
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
        const effectiveTransport = transport ?? (lock.corrNr || undefined);
        try {
          if (changed.main) {
            await updateSource(session, client.safety, srcUrl, finalMainSource, lock.lockHandle, effectiveTransport);
          }
          if (changed.definitions && finalDefinitionsSource) {
            await updateSource(
              session,
              client.safety,
              classIncludeUrl(name, 'definitions'),
              finalDefinitionsSource,
              lock.lockHandle,
              effectiveTransport,
            );
          }
          if (changed.implementations && finalImplementationsSource) {
            await updateSource(
              session,
              client.safety,
              classIncludeUrl(name, 'implementations'),
              finalImplementationsSource,
              lock.lockHandle,
              effectiveTransport,
            );
          }
        } finally {
          // Best-effort unlock — if the object was already removed or the session
          // expired, we still want to surface the original error instead of masking
          // it with an unlock failure.
          try {
            await unlockObject(session, objectUrl, lock.lockHandle);
          } catch {
            // Swallowed intentionally; see comment above.
          }
        }
      });
      invalidateWrittenObject();

      const msg =
        `Scaffolded ${scaffoldPlan.insertedSignatureCount} RAP handler signature(s) and ${scaffoldPlan.insertedImplementationStubCount} implementation stub(s) in ${type} ${name} from BDEF ${bdefName}. ` +
        `Auto-created ${scaffoldPlan.skeletons.createdDefinitions.length + scaffoldPlan.skeletons.createdImplementations.length} handler skeleton section(s). ` +
        `Updated section(s): ${scaffoldPlan.changedSections.join(', ')}.`;
      const warnings = mergePreWriteWarnings(
        lintWarningsMain?.warnings,
        lintWarningsDefinitions?.warnings,
        lintWarningsImplementations?.warnings,
      );
      const details = JSON.stringify(
        {
          ...summary,
          applied: true,
          applyResult: {
            skeletons: scaffoldPlan.skeletons,
            main: scaffoldPlan.signatures.main,
            definitions: scaffoldPlan.signatures.definitions,
            implementations: scaffoldPlan.signatures.implementations,
            implementationStubs: scaffoldPlan.implementationStubs,
            unresolved: scaffoldPlan.unresolved,
          },
        },
        null,
        2,
      );
      return warnings ? textResult(`${msg}\n\n${warnings}\n\n${details}`) : textResult(`${msg}\n\n${details}`);
    }
    case 'generate_behavior_implementation': {
      // PR-C: high-level RAP one-shot — auto-discover BDEF via class metadata's
      // rootEntityRef, scaffold every required handler (creating lhc_<alias>
      // skeletons when missing), write under one lock, and (by default) activate.
      // Reliable equivalent of Eclipse ADT's "Generate Behavior Implementation"
      // Cmd+1 quickfix; avoids the broken /sap/bc/adt/quickfixes/proposals/
      // create_class_implementation server endpoint (HTTP 500 on a4h, verified
      // live during PR-C research). See docs/plans/add-generate-behavior-implementation.md.
      if (type !== 'CLAS') {
        return errorResult('generate_behavior_implementation is only supported for type=CLAS behavior pool classes.');
      }
      if (!name) {
        return errorResult('"name" is required for generate_behavior_implementation.');
      }
      const dryRun = args.dryRun === true || String(args.dryRun ?? '') === 'true';
      const activate = args.activate === undefined ? true : args.activate === true || String(args.activate) === 'true';
      const explicitBdef = (args.bdefName as string | undefined)?.trim() || undefined;
      const targetAlias = (args.targetAlias as string | undefined)?.trim() || undefined;

      // Package gate only when we'll actually mutate. dryRun=true is read-only;
      // bypassing the gate matches the scaffold_rap_handlers preview pattern.
      if (!dryRun) {
        await enforcePackageForExistingObject();
      }

      const result = await generateBehaviorImplementation(client, name, {
        bdefName: explicitBdef,
        targetAlias,
        activate,
        dryRun,
        transport,
      });
      invalidateWrittenObject();
      // MCP result-code mapping via the exported helper — see
      // `isRapGenerateResultSuccess` for the success/error contract (Codex review on PR #260, P1).
      // The structured JSON is preserved in both branches so the caller can still see what
      // was discovered, written, and what activation reported.
      const json = JSON.stringify(result, null, 2);
      return isRapGenerateResultSuccess(result) ? textResult(json) : errorResult(json);
    }
    case 'delete': {
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
    case 'batch_create': {
      const objects = args.objects as Array<Record<string, unknown>> | undefined;
      if (!objects || !Array.isArray(objects) || objects.length === 0) {
        return errorResult('"objects" array is required and must be non-empty for batch_create action.');
      }

      // Opt-in deferred-activation: writes every object as an inactive draft first,
      // then issues a single terminal activateBatch over the written subset. Use case:
      // composition-linked DDLS / interdependent RAP graphs where per-object inline
      // activate() can't resolve cross-references to not-yet-active siblings.
      const activateAtEnd = args.activateAtEnd === true || String(args.activateAtEnd) === 'true';

      const defaultPackage = normalizePackageOverride(args.package, '$TMP');

      const batchPlan = objects.map((obj) => {
        const objType = normalizeWriteObjectType(String(obj.type ?? ''));
        const objName = String(obj.name ?? '');
        const objPackage = normalizePackageOverride(obj.package, defaultPackage);
        const explicitTransport = normalizeTransportOverride(obj.transport) ?? transport;
        return { obj, type: objType, name: objName, packageName: objPackage, explicitTransport };
      });

      // Check every target package before starting any creates.
      // Resolver is shared across the loop so subtree BFS happens once even when
      // many objects target descendants of the same `ZFOO/**` root.
      {
        const resolver = client.getPackageHierarchyResolver();
        for (const pkg of new Set(batchPlan.map((item) => item.packageName))) {
          await checkPackage(client.safety, pkg, resolver);
        }
      }

      // Pre-flight transport check for batch_create (same logic as single create),
      // but keyed by each effective package because objects can override package.
      const autoTransportByPackage = new Map<string, string | undefined>();
      const firstPlanNeedingTransportByPackage = new Map<string, (typeof batchPlan)[number]>();
      for (const plan of batchPlan) {
        if (
          !plan.explicitTransport &&
          plan.packageName.toUpperCase() !== '$TMP' &&
          !firstPlanNeedingTransportByPackage.has(plan.packageName)
        ) {
          firstPlanNeedingTransportByPackage.set(plan.packageName, plan);
        }
      }
      for (const [pkg, plan] of firstPlanNeedingTransportByPackage) {
        try {
          const firstUrl = objectUrlForType(plan.type, plan.name);
          const transportInfo = await getTransportInfo(client.http, client.safety, firstUrl, pkg, 'I');
          if (transportInfo.lockedTransport) {
            autoTransportByPackage.set(pkg, transportInfo.lockedTransport);
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${pkg}" requires a transport number for object creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPWrite(action="batch_create", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch (err) {
          logger.warn('SAPWrite batch_create transport preflight failed; continuing without auto transport', {
            package: pkg,
            type: plan.type,
            name: plan.name,
            error: err instanceof Error ? err.message : String(err),
          });
          // If transportInfo check fails, proceed — SAP will return its own error if needed.
        }
      }

      const results: Array<{
        type: string;
        name: string;
        packageName: string;
        status: 'success' | 'failed';
        error?: string;
      }> = [];
      const batchWarnings: string[] = [];
      // Per-batch cache for the MSAG transport-vs-task guard. The bug is universal so the
      // guard fires for every MSAG entry, but a batch typically shares one transport — cache
      // the lookup result to avoid one HTTP roundtrip per object.
      const transportLookupCache = new Map<string, Awaited<ReturnType<typeof getTransport>>>();
      // Accumulated objects whose create + source-write phase succeeded — used by the
      // terminal activateBatch when activateAtEnd=true. Order matches the input order.
      const writtenObjects: BatchActivationObject[] = [];

      for (const plan of batchPlan) {
        const { obj, type: objType, name: objName, packageName: objPackage } = plan;
        const objTransport = plan.explicitTransport ?? autoTransportByPackage.get(objPackage);
        const metadataObject = isMetadataWriteType(objType);
        const objSource = obj.source ? String(obj.source) : undefined;
        const objDescription = String(obj.description ?? objName);

        // Mixed-case object name rejection (matches the create-path check above).
        // Universal SAP convention — TADIR is uppercase on every release.
        // Cheap check first: no HTTP call, fail fast on bad names.
        if (objName && objName !== objName.toUpperCase()) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: `Object name "${objName}" contains lowercase characters. SAP object names must be uppercase (e.g. "${objName.toUpperCase()}"). Source code inside the object can use mixed case.`,
          });
          break;
        }

        // MSAG transport-vs-task guard (per-batch cache to avoid per-object roundtrip).
        if (objType === 'MSAG' && objTransport) {
          let tr = transportLookupCache.get(objTransport);
          if (tr === undefined) {
            tr = await getTransport(client.http, client.safety, objTransport);
            transportLookupCache.set(objTransport, tr);
          }
          if (!tr) {
            results.push({
              type: objType,
              name: objName,
              packageName: objPackage,
              status: 'failed',
              error: `Transport "${objTransport}" is not a valid transport request. MSAG creation requires a transport request number, not a task number.`,
            });
            break;
          }
        }

        // AFF header validation per object (if schema available)
        const affResult = validateAffHeader(objType, { description: objDescription, originalLanguage: 'en' });
        if (!affResult.valid) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: `AFF metadata validation failed:\n- ${(affResult.errors ?? []).join('\n- ')}`,
          });
          break;
        }

        try {
          // Pre-validate source with lint BEFORE creating the object to avoid orphaned objects.
          // Metadata objects (DOMA/DTEL) are XML-only and intentionally skip source lint.
          if (!metadataObject && objSource) {
            const preflightWarnings = runRapPreflightValidation(
              objSource,
              objType,
              objName,
              cachedFeatures,
              config.systemType,
              preflightOverride,
            );
            if (preflightWarnings.blocked) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: preflightWarnings.result!.content[0].text,
              });
              break;
            }
            if (preflightWarnings.warnings) {
              batchWarnings.push(`${objType} ${objName}: ${preflightWarnings.warnings}`);
            }

            const lintWarnings = runPreWriteLint(objSource, objType, objName, config, lintOverride);
            if (lintWarnings.blocked) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: `source rejected by lint: ${lintWarnings.result!.content[0].text}`,
              });
              break;
            }
          }

          // Step 1: Create the object (per-entry transparent-table discovery gate;
          // mirrors the single-create site above. TABL/DS skips it — /structures/ always exists.)
          if ((objType === 'TABL' || objType === 'TABL/DT') && isTablesEndpointAvailable() === false) {
            results.push({
              type: objType,
              name: objName,
              packageName: objPackage,
              status: 'failed',
              error: TABL_DT_WRITE_UNAVAILABLE_HINT,
            });
            break;
          }
          const objUrl = objectUrlForType(objType, objName);
          const createUrl = objUrl.replace(/\/[^/]+$/, '');
          const objMetadataProps = getMetadataWriteProperties(obj);
          const body = buildCreateXml(
            objType,
            objName,
            objPackage,
            objDescription,
            objMetadataProps,
            config.language,
            config.username,
          );
          const contentType = createContentTypeForType(objType);
          const needsPackageParam =
            objType === 'BDEF' || objType === 'TABL' || objType === 'TABL/DT' || objType === 'TABL/DS';
          try {
            await createObject(
              client.http,
              client.safety,
              createUrl,
              body,
              contentType,
              objTransport,
              needsPackageParam ? objPackage : undefined,
              cachedFeatures?.abapRelease,
            );
          } catch (createErr) {
            if (createErr instanceof AdtApiError && (createErr.statusCode === 400 || createErr.statusCode === 409)) {
              const syntaxDetail = await tryPostSaveSyntaxCheck(client, objType, objName);
              if (syntaxDetail) {
                createErr.message += syntaxDetail;
              }
            }
            throw createErr;
          }

          // Step 1b: DTEL POST ignores labels — follow up with PUT on main session
          if (objType === 'DTEL' && dtelNeedsPostCreateUpdate(objMetadataProps)) {
            await client.http.withStatefulSession(async (session) => {
              const lock = await lockObject(session, client.safety, objUrl, 'MODIFY', cachedFeatures?.abapRelease);
              const lockTransport = objTransport ?? (lock.corrNr || undefined);
              try {
                await updateObject(session, client.safety, objUrl, body, lock.lockHandle, contentType, lockTransport);
              } finally {
                await unlockObject(session, objUrl, lock.lockHandle);
              }
            });
          }

          // Step 2: Write source if provided
          if (!metadataObject && objSource) {
            const srcUrl = sourceUrlForType(objType, objName);
            await safeUpdateSource(
              client.http,
              client.safety,
              objUrl,
              srcUrl,
              objSource,
              objTransport,
              cachedFeatures?.abapRelease,
            );
          }

          // Resolve the activation URL up front so both the inline path and the
          // deferred terminal-activate path use the same URL. FUNC needs the parent
          // function-group baked into the path (issue #250); objectUrlForType throws
          // for FUNC so we mirror the FUNC-aware resolver from handleSAPActivate. For
          // TABL we keep objUrl (already resolved to /tables/) — DDIC-structure FMs
          // aren't a real concept and the create path doesn't expose one.
          let activationUrl = objUrl;
          if (objType === 'FUNC') {
            let group = String(obj.group ?? args.group ?? '').trim();
            if (!group) {
              const resolved = cachingLayer
                ? await cachingLayer.resolveFuncGroup(client, objName)
                : await client.resolveFunctionGroup(objName);
              if (!resolved) {
                throw new Error(
                  `Cannot resolve function group for FM "${objName}" in batch_create activation step. Provide "group" on the FUNC entry.`,
                );
              }
              group = resolved;
            }
            const groupLc = encodeURIComponent(group.toLowerCase());
            activationUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(objName.toLowerCase())}`;
          }

          if (activateAtEnd) {
            // Step 3 deferred: track this object for the terminal activateBatch call.
            // Cache invalidation also moves to AFTER the terminal activate succeeds —
            // invalidating now would let the next read see a draft we couldn't activate.
            writtenObjects.push({ type: objType, name: objName, url: activationUrl });
            results.push({ type: objType, name: objName, packageName: objPackage, status: 'success' });
          } else {
            // Step 3: Activate the object (inline, default behavior).
            const activationResult = await activate(client.http, client.safety, activationUrl);
            if (!activationResult.success) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: `activation failed: ${activationResult.messages.join('; ')}`,
              });
              break;
            }

            invalidateWrittenObject(objType, objName);
            results.push({ type: objType, name: objName, packageName: objPackage, status: 'success' });
          }
        } catch (err) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          break;
        }
      }

      // Add 'skipped' entries for objects that were never attempted due to early break
      for (let i = results.length; i < objects.length; i++) {
        const skippedPlan = batchPlan[i];
        const skipped = skippedPlan?.obj ?? objects[i];
        results.push({
          type: skippedPlan?.type ?? normalizeObjectType(String(skipped?.type ?? '')),
          name: skippedPlan?.name ?? String(skipped?.name ?? ''),
          packageName: skippedPlan?.packageName ?? normalizePackageOverride(skipped?.package, defaultPackage),
          status: 'failed',
          error: 'skipped — stopped after previous failure',
        });
      }

      // ── Terminal activateBatch (activateAtEnd=true) ─────────────────────
      // After every write-phase succeeded (or broke off early), issue ONE batch
      // activate over the already-written subset. This is the killer feature
      // for composition-linked DDLS and RAP behavior stacks — SAP's activator
      // sees the whole graph in a single POST and resolves cross-references
      // internally, so parent → child siblings activate cleanly.
      let terminalActivationFailure: string | undefined;
      if (activateAtEnd && writtenObjects.length > 0) {
        const activationOutcome = await activateBatch(client.http, client.safety, writtenObjects);
        if (activationOutcome.success) {
          // Defensive: per-object status was already 'success' from the write phase.
          // Cache invalidation moves here so a failed terminal activate doesn't strand
          // a stale 'active' cache entry. Invalidate inactive-lists once for the user.
          for (const o of writtenObjects) {
            cachingLayer?.invalidate(o.type, o.name, 'all');
          }
          invalidateInactiveList(cachingLayer, client, cacheSecurity);
        } else {
          // Flip every written-but-not-yet-activated entry to 'failed', preserving the
          // "create + source-write succeeded" context. Reuse the existing per-object
          // diagnostic mapper so callers see the activation messages keyed by object name.
          const batchStatuses = buildBatchActivationStatuses(writtenObjects, activationOutcome);
          const statusDetails = formatBatchActivationStatuses(batchStatuses);
          terminalActivationFailure = statusDetails;
          const statusByName = new Map(batchStatuses.map((s) => [`${s.type}\x00${s.name}`, s]));
          for (const result of results) {
            if (result.status !== 'success') continue;
            const key = `${result.type}\x00${result.name}`;
            const matched = statusByName.get(key);
            if (!matched) continue;
            // Some entries may still report status 'active' if the activator returned
            // success: false but had no per-object error details — keep them as 'success'.
            if (matched.status === 'active') continue;
            result.status = 'failed';
            const detail = matched.messages.length > 0 ? ` — ${matched.messages.join('; ')}` : '';
            // Preserve the "create + source-write succeeded" context so the user sees that
            // the failure was specifically the activation step, not the write step.
            result.error = `${writtenObjects.length}/${writtenObjects.length} written, batch activation failed${detail}`;
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────

      const summary = results
        .map((r) =>
          r.status === 'success'
            ? `${r.name} (${r.type}) ✓ [${r.packageName}]`
            : `${r.name} (${r.type}) ✗ [${r.packageName}] — ${r.error}`,
        )
        .join(', ');
      const successCount = results.filter((r) => r.status === 'success').length;
      const hasFailure = results.some((r) => r.status === 'failed');
      const warningSuffix =
        batchWarnings.length > 0 ? `\n\nRAP preflight warnings:\n- ${batchWarnings.join('\n- ')}` : '';
      const activateAtEndSuffix =
        terminalActivationFailure !== undefined ? `\n\nBatch activation diagnostics:${terminalActivationFailure}` : '';
      const packageNames = [...new Set(batchPlan.map((item) => item.packageName))];
      const packageSummary =
        packageNames.length === 1
          ? `in package ${packageNames[0]}`
          : packageNames.length <= 3
            ? `across packages [${packageNames.join(', ')}]`
            : `across ${packageNames.length} packages`;
      const activateAtEndPrefix = activateAtEnd ? '; activated as a single batch' : '';

      if (hasFailure) {
        const cleanupHint =
          successCount > 0
            ? ` Note: ${successCount} already-created object(s) remain on the SAP system and may need manual cleanup.`
            : '';
        return errorResult(
          `Batch created ${successCount}/${objects.length} objects ${packageSummary}${activateAtEndPrefix}: ${summary}${cleanupHint}${warningSuffix}${activateAtEndSuffix}`,
        );
      }
      return textResult(
        `Batch created ${successCount} objects ${packageSummary}${activateAtEndPrefix}: ${summary}${warningSuffix}${activateAtEndSuffix}`,
      );
    }
    default:
      return errorResult(
        `Unknown SAPWrite action: ${action}. Supported: create, update, delete, edit_method, batch_create, scaffold_rap_handlers, generate_behavior_implementation`,
      );
  }
}
