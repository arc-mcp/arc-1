/**
 * SAPWrite actions — create + batch_create. Split from write.ts (Stage D).
 */

import {
  createObject,
  lockObject,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
  updateObject,
} from '../../adt/crud.js';
import { normalizeAdtLanguage, rewriteKtdText } from '../../adt/ddic-xml.js';
import { activate, activateBatch } from '../../adt/devtools.js';
import { AdtApiError } from '../../adt/errors.js';
import { type FmParameter, spliceFmSignature } from '../../adt/fm-signature.js';
import { checkPackage } from '../../adt/safety.js';
import { getTransport, getTransportInfo } from '../../adt/transport.js';
import { validateAffHeader } from '../../aff/validator.js';
import { logger } from '../../server/logger.js';
import {
  type BatchActivationObject,
  buildBatchActivationStatuses,
  formatBatchActivationStatuses,
} from '../activate.js';
import { invalidateInactiveList } from '../cache-security.js';
import { guardCdsSyntax } from '../cds-hints.js';
import { cachedFeatures, isTablesEndpointAvailable } from '../feature-cache.js';
import {
  normalizeObjectType,
  normalizeWriteObjectType,
  objectBasePath,
  objectUrlForType,
  sourceUrlForType,
} from '../object-types.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import {
  buildCreateXml,
  createContentTypeForType,
  dtelNeedsPostCreateUpdate,
  escapeXml,
  getMetadataWriteProperties,
  isMetadataWriteType,
  mergePreWriteWarnings,
  runPreWriteLint,
  runRapPreflightValidation,
  SKTD_V2_CONTENT_TYPE,
  stripFmParamCommentBlock,
  TABL_DT_WRITE_UNAVAILABLE_HINT,
  tryPostSaveSyntaxCheck,
  vendorContentTypeForType,
} from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

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

export async function writeActionCreate(ctx: SapWriteContext): Promise<ToolResult> {
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
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
  } = ctx;
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

export async function writeActionBatchCreate(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    cachingLayer,
    cacheSecurity,
    transport,
    lintOverride,
    preflightOverride,
    invalidateWrittenObject,
  } = ctx;
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
  const warningSuffix = batchWarnings.length > 0 ? `\n\nRAP preflight warnings:\n- ${batchWarnings.join('\n- ')}` : '';
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
