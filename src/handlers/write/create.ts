/**
 * SAPWrite actions — create + batch_create.
 */

import {
  createObject,
  lockObject,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
  updateObject,
} from '../../adt/crud.js';
import {
  formatKtdWriteReport,
  type KtdShortText,
  type KtdWriteReport,
  normalizeAdtLanguage,
  rewriteKtdDocument,
} from '../../adt/ddic-xml.js';
import { activate, activateBatch } from '../../adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { type FmParameter, spliceFmSignature } from '../../adt/fm-signature.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import { isServerDrivenObjectType } from '../../adt/server-driven.js';
import { getTransport } from '../../adt/transport.js';
import { escapeXmlAttr, parseFunctionModuleProperties } from '../../adt/xml-parser.js';
import { validateAffHeader } from '../../aff/validator.js';
import { activationDetailMatchesObject } from '../activation-results.js';
import { guardCdsSyntax } from '../cds-hints.js';
import {
  getCachedFeatures,
  isDomainsEndpointAvailable,
  isTablesEndpointAvailable,
  isTableTypesEndpointAvailable,
} from '../feature-cache.js';
import type { FunctionProcessingType, FunctionUpdateTaskKind } from '../function-processing.js';
import {
  canonicalTablType,
  functionGroupObjectUrl,
  functionModuleObjectUrl,
  normalizeWriteObjectType,
  objectBasePath,
  objectUrlForType,
  sourceUrlForType,
} from '../object-types.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import {
  buildCreateXml,
  createContentTypeForType,
  DOMA_WRITE_UNAVAILABLE_HINT,
  getMetadataWriteProperties,
  isMetadataWriteType,
  mergePreWriteWarnings,
  resolveWriteSystemType,
  runPreWriteLint,
  runRapPreflightValidation,
  SKTD_V2_CONTENT_TYPE,
  stripFmParamCommentBlock,
  TABL_DT_WRITE_UNAVAILABLE_HINT,
  TTYP_WRITE_UNAVAILABLE_HINT,
  tryPostSaveSyntaxCheck,
  vendorContentTypeForType,
} from '../write-helpers.js';
import {
  type BatchFailurePhase,
  batchCreateResult,
  batchEntryResult,
  batchFailureMessage,
  failBatchEntry,
} from './batch-results.js';
import type { SapWriteContext } from './context.js';
import { resolveCreateTransport } from './create-transport.js';

const FUNCTION_MODULE_MEDIA_TYPE = /^application\/vnd\.sap\.adt\.functions\.fmodules(?:\.v\d+)?\+xml\b/i;

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

function prepareFunctionModuleCreateSource(
  name: string,
  source: string | undefined,
  parameters: FmParameter[] | undefined,
): { shouldWrite: boolean; source: string; warnings: string[] } {
  const shouldWrite = !!source || (parameters !== undefined && parameters.length > 0);
  if (!shouldWrite) return { shouldWrite: false, source: '', warnings: [] };

  let prepared = source ?? '';
  const warnings: string[] = [];
  if (parameters !== undefined) {
    const baseSource =
      !prepared || prepared.trim() === ''
        ? `FUNCTION ${name}.\nENDFUNCTION.\n`
        : /^\s*FUNCTION\s+/i.test(prepared)
          ? prepared
          : `FUNCTION ${name}.\n${prepared}\nENDFUNCTION.\n`;
    try {
      prepared = spliceFmSignature(baseSource, name, parameters);
    } catch {
      prepared = baseSource;
      warnings.push(
        'Could not splice structured parameters: source did not start with FUNCTION keyword. Used the supplied source verbatim.',
      );
    }
  }

  const stripped = stripFmParamCommentBlock(prepared);
  if (stripped.wasStripped) {
    warnings.push(
      'Stripped *"…IMPORTING/EXPORTING…*" parameter comment blocks (pass `parameters` as a structured array instead).',
    );
  }
  return { shouldWrite: true, source: stripped.source, warnings };
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

/**
 * Change only the processing attributes on the server-provided FUNC metadata
 * envelope. SAP creates a normal function-module shell first; processing type
 * is persisted by a subsequent locked metadata PUT (the same lifecycle used by
 * the ADT Properties → Specific view).
 */
function rewriteFunctionModuleProcessingMetadata(
  xml: string,
  processingType: FunctionProcessingType,
  updateTaskKind?: FunctionUpdateTaskKind,
): string {
  const rootMatch = /<fmodule:abapFunctionModule\b[^>]*>/i.exec(xml);
  if (!rootMatch || rootMatch.index === undefined) {
    throw new Error('FUNC processing metadata update failed: SAP did not return an abapFunctionModule envelope.');
  }

  const withoutProcessingAttributes = rootMatch[0]
    .replace(/\s+fmodule:processingType\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s+fmodule:updateTaskKind\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const attributes = ` fmodule:processingType="${escapeXmlAttr(processingType)}"${
    updateTaskKind === undefined ? '' : ` fmodule:updateTaskKind="${escapeXmlAttr(updateTaskKind)}"`
  }`;
  const rewrittenRoot = withoutProcessingAttributes.replace(
    /<fmodule:abapFunctionModule/i,
    (root) => `${root}${attributes}`,
  );

  return `${xml.slice(0, rootMatch.index)}${rewrittenRoot}${xml.slice(rootMatch.index + rootMatch[0].length)}`;
}

async function persistFunctionModuleProcessingMetadata(
  client: SapWriteContext['client'],
  objectUrl: string,
  name: string,
  processingType: FunctionProcessingType,
  updateTaskKind: FunctionUpdateTaskKind | undefined,
  transport: string | undefined,
): Promise<void> {
  try {
    const inactiveUrl = `${objectUrl}?version=inactive`;
    const current = await client.getObjectMetadata(inactiveUrl);
    const body = rewriteFunctionModuleProcessingMetadata(current.body, processingType, updateTaskKind);
    // Send the bare media type: SAP returns "…fmodules.v3+xml; charset=utf-8"
    // (v2 on 750), and on-prem backends are known to reject vendor media types
    // carrying parameters — same reason `resolveObjectPackage` strips them.
    const responseContentType = getHeader(current.headers, 'content-type');
    const discoveredContentType = client.http.discoveryAcceptFor(objectUrl);
    const contentType =
      [responseContentType, discoveredContentType]
        .find((candidate): candidate is string => candidate !== undefined && FUNCTION_MODULE_MEDIA_TYPE.test(candidate))
        ?.split(';')[0]
        ?.trim() ?? vendorContentTypeForType('FUNC');

    await safeUpdateObject(
      client.http,
      client.safety,
      objectUrl,
      body,
      contentType,
      transport,
      getCachedFeatures()?.abapRelease,
    );

    // A 2xx response alone is insufficient evidence: the collection POST accepts
    // these attributes and still retains `normal` (live-verified on 758).
    const persisted = await client.getObjectMetadata(inactiveUrl);
    const { processingType: actualProcessingType, updateTaskKind: actualUpdateTaskKind } =
      parseFunctionModuleProperties(persisted.body);
    if (
      actualProcessingType !== processingType ||
      (updateTaskKind === undefined ? actualUpdateTaskKind !== undefined : actualUpdateTaskKind !== updateTaskKind)
    ) {
      throw new Error(
        `SAP retained processingType="${actualProcessingType ?? 'unknown'}"${
          actualUpdateTaskKind === undefined ? '' : ` and updateTaskKind="${actualUpdateTaskKind}"`
        }.`,
      );
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `FUNC post-create processing update failed for ${name} after SAP accepted the create POST. ` +
        `The object may remain as a normal function-module shell. Review it with SAPRead or delete it before retrying. ` +
        detail,
    );
  }
}

async function resolveFunctionGroupCreatePackage(
  client: SapWriteContext['client'],
  group: string,
  requestedPackage: unknown,
  childType: 'FUNC' | 'INCL' = 'FUNC',
): Promise<string> {
  const actualPackage = await client.resolveObjectPackage(functionGroupObjectUrl(group));
  if (!actualPackage) {
    throw new Error(
      `${childType} create blocked: ARC-1 could not determine the parent function group "${group}" package from ADT metadata.`,
    );
  }
  const explicitPackage =
    requestedPackage === undefined || requestedPackage === null ? undefined : String(requestedPackage).trim();
  if (explicitPackage && explicitPackage.toUpperCase() !== actualPackage.toUpperCase()) {
    throw new Error(
      `${childType} inherits package "${actualPackage}" from parent function group "${group}"; requested package "${explicitPackage}" does not match.`,
    );
  }
  return actualPackage;
}

function ttypPostCreateFailureMessage(name: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return (
    `TTYP post-create update failed for ${name} after SAP accepted the create POST. ` +
    `The object may remain as SAP's default metadata shell (CHAR). To recover, run ` +
    `SAPWrite(action="update", type="TTYP", name="${name}", rowType=…) to write the intended row type, ` +
    `or delete it — a plain re-create fails with "already exists". Verify with SAPRead first. ` +
    detail
  );
}

async function putTtypMetadataAfterCreate(
  client: SapWriteContext['client'],
  objectUrl: string,
  name: string,
  body: string,
  contentType: string,
  transport: string | undefined,
): Promise<void> {
  try {
    await client.http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', getCachedFeatures()?.abapRelease);
      const lockTransport = transport ?? (lock.corrNr || undefined);
      try {
        await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, contentType, lockTransport);
      } finally {
        await unlockObject(session, objectUrl, lock.lockHandle);
      }
    });
  } catch (err) {
    throw new Error(ttypPostCreateFailureMessage(name, err));
  }
}

const KTD_REF_OBJECT_TYPES_ROUTABLE_BY_ARC = new Set([
  'BDEF/BAC',
  'BDEF/BAE',
  'BDEF/BAF',
  'BDEF/BAS',
  'BDEF/BDE',
  'BDEF/BDO',
  'BDEF/BSO',
  'BDEF/BVA',
  'DDLS/DF',
  'DEVC/K',
  'SRVB/SVB',
  'SRVD/SRV',
]);

// Live WBOBJTYPES_SCOPE registry entries for SCOPE_ID = 'DOCUMENTATION' observed on
// SAP_BASIS 758 and 816. This is diagnostic evidence, not a create allowlist:
// KTD create still needs a verified ADT parent URI route for <sktd:refObject>.
const KTD_REF_OBJECT_TYPES_SAP_DOCUMENTATION_SCOPE = new Set([
  ...KTD_REF_OBJECT_TYPES_ROUTABLE_BY_ARC,
  'APIC/TYP',
  'CFDB/CFB',
  'CFDG/CFG',
  'CFDS/CFS',
  'CHKO/TYP',
  'DDLA/ADF',
  'DRTY/STY',
  'DSFD/SCF',
  'EEEC/EVC',
  'EVTB/EVB',
  'PARA/R',
  'RONT/ROT',
  'SMBC/TYP',
  'SOD1',
  'SOD2',
]);

const KTD_REF_OBJECT_TYPES_HINT = 'DDLS/DF, BDEF/BDO, SRVD/SRV, SRVB/SVB, DEVC/K';
const KTD_SAP_DOCUMENTATION_SCOPE_HINT =
  'APIC/TYP, BDEF/*, CFDB/CFB, CFDG/CFG, CFDS/CFS, CHKO/TYP, DDLA/ADF, DDLS/DF, DEVC/K, ' +
  'DRTY/STY, DSFD/SCF, EEEC/EVC, EVTB/EVB, PARA/R, RONT/ROT, SMBC/TYP, SOD1, SOD2, ' +
  'SRVB/SVB, SRVD/SRV';

function normalizeKtdRefObjectType(refObjectType: string): string {
  return refObjectType.trim().toUpperCase();
}

function validateKtdRefObjectType(refObjectType: string): string | undefined {
  const normalized = normalizeKtdRefObjectType(refObjectType);
  if (KTD_REF_OBJECT_TYPES_ROUTABLE_BY_ARC.has(normalized)) {
    return undefined;
  }
  if (KTD_REF_OBJECT_TYPES_SAP_DOCUMENTATION_SCOPE.has(normalized)) {
    return (
      `SKTD/KTD create recognizes refObjectType "${normalized}" as observed SAP-registered for KTD DOCUMENTATION scope on SAP_BASIS 758/816, ` +
      `but ARC-1 does not yet have verified ADT parent URI routing for this type. ` +
      `ARC-1 only creates KTDs when it can build both the SAP refObjectType and the parent adtcore:uri. ` +
      `ARC-1 currently supports KTD creation for: ${KTD_REF_OBJECT_TYPES_HINT}. ` +
      `Other SAP-registered KTD parent types verified from WBOBJTYPES_SCOPE: ${KTD_SAP_DOCUMENTATION_SCOPE_HINT}.`
    );
  }
  const codeDocumentationHint =
    normalized === 'CLAS/OC' || normalized === 'INTF/OI' || normalized === 'PROG/P'
      ? '\n\nUse ABAP Doc for classes, interfaces, and programs. These object types were not registered for KTD DOCUMENTATION scope on the tested SAP_BASIS 758 and 816 systems; SAP documentation positions ABAP Doc as the source-code documentation mechanism for classes and interfaces.'
      : '';
  return (
    `SKTD/KTD create will not attempt unverified refObjectType "${normalized}". ` +
    `KTD creation requires both a SAP Workbench DOCUMENTATION scope handler for the parent object type and an exact ADT parent object URI; ` +
    `posting unknown parent types can trigger a SAP short dump in CL_KTD_UTILITY=>GET_DOCU_STRUCTURE before SAP returns a normal validation error. ` +
    `ARC-1 currently supports KTD creation for: ${KTD_REF_OBJECT_TYPES_HINT}.` +
    codeDocumentationHint
  );
}

const BDEF_IDENTIFIER_PATTERN = '(?:/[A-Za-z0-9_]+/[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)';
const BDEF_EXTENSION_PATTERN = new RegExp(String.raw`\bextend\s+behavior\s+for\s+(${BDEF_IDENTIFIER_PATTERN})\b`, 'i');

function replaceNonNewlineWithSpaces(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

function stripBdefCommentsAndStrings(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, replaceNonNewlineWithSpaces);
  return withoutBlockComments
    .split('\n')
    .map((line) => {
      if (/^\s*\*/.test(line)) return '';
      let stripped = '';
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];
        if (!inString) {
          if (ch === '"' || (ch === '/' && next === '/')) break;
          if (ch === "'") {
            inString = true;
            stripped += ' ';
            continue;
          }
          stripped += ch;
          continue;
        }
        if (ch === "'" && next === "'") {
          stripped += '  ';
          i++;
          continue;
        }
        if (ch === "'") {
          inString = false;
          stripped += ' ';
          continue;
        }
        stripped += ' ';
      }
      return stripped;
    })
    .join('\n');
}

function extractBdefBehaviorExtensionBase(source: string): string | undefined {
  return BDEF_EXTENSION_PATTERN.exec(stripBdefCommentsAndStrings(source))?.[1];
}

function sameBdefName(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function applyBdefBehaviorExtensionMetadata(
  type: string,
  source: string | undefined,
  metadataProperties: Record<string, unknown>,
): string | undefined {
  if (type !== 'BDEF' || !source) return undefined;
  const baseBdef = extractBdefBehaviorExtensionBase(source);
  if (!baseBdef) return undefined;
  metadataProperties.behaviorExtension = true;
  metadataProperties.baseBdef = baseBdef;
  return baseBdef;
}

/**
 * After a behavior-extension create+PUT, read the inactive draft back and confirm it really is an
 * `extend behavior for <base>` extension. Returns a NON-BLOCKING warning string if it isn't (the
 * object was still created — SAP may have scaffolded a plain definition, e.g. if a future release
 * ignores the ADT template). On the tested releases (758/816) this never fires; it's a cheap
 * data-integrity hint, not a hard gate. Returns undefined when the extension is confirmed.
 */
async function warnIfBdefExtensionUnconfirmed(
  client: SapWriteContext['client'],
  name: string,
  expectedBaseBdef: string,
): Promise<string | undefined> {
  const readBack = await client.getBdef(name, { version: 'inactive' });
  const actualBaseBdef = extractBdefBehaviorExtensionBase(readBack.source);
  if (actualBaseBdef && sameBdefName(actualBaseBdef, expectedBaseBdef)) return undefined;

  const actual =
    actualBaseBdef !== undefined
      ? `read-back shows \`extend behavior for ${actualBaseBdef}\` instead`
      : 'read-back shows no `extend behavior for` declaration';
  return (
    `Warning: created BDEF ${name}, but the inactive read-back did not confirm ` +
    `\`extend behavior for ${expectedBaseBdef}\` (${actual}). SAP may have scaffolded a plain behavior ` +
    'definition (e.g. if the ADT template was ignored or the base BDEF is not extensible). ' +
    `Verify with SAPRead(type="BDEF", name="${name}", version="inactive") before activating.`
  );
}

function isKtdCreateEndpointUnavailable(err: unknown): err is AdtApiError {
  if (!(err instanceof AdtApiError)) return false;
  if (err.statusCode !== 404 || err.path !== '/sap/bc/adt/documentation/ktd/documents') return false;
  const combined = `${err.message}\n${err.responseBody ?? ''}`.toLowerCase();
  return combined.includes('resource') && combined.includes('/sap/bc/adt/documentation/ktd/documents');
}

export async function writeActionCreate(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    type,
    name,
    source,
    hasSource,
    transport,
    lintOverride,
    preflightOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
  } = ctx;
  // FUNC and FUGR structural includes both INHERIT the parent group's package — SAP ignores
  // _package for them — so the allowlist must be checked against the group's real package.
  // Gating on args.package here would let a caller write into a disallowed package by claiming $TMP.
  const groupArg = String(args.group ?? '').trim();
  const inheritsGroupPackage = type === 'FUNC' || (type === 'INCL' && groupArg !== '');
  const pkg = inheritsGroupPackage
    ? await resolveFunctionGroupCreatePackage(client, groupArg, args.package, type === 'INCL' ? 'INCL' : 'FUNC')
    : String(args.package ?? '$TMP');
  await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
  const description = String(args.description ?? name);

  let effectiveTransport = transport;
  if (!transport) {
    const resolved = await resolveCreateTransport(client, objectUrl, pkg, config.minimalErrors);
    if (resolved.error) return errorResult(resolved.error);
    effectiveTransport = resolved.transport;
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
  const cdsGuard = guardCdsSyntax(type, source, getCachedFeatures());
  if (cdsGuard) return cdsGuard;

  // RAP deterministic preflight validation (before object creation to avoid stubs)
  const preflightWarnings = runRapPreflightValidation(
    source,
    type,
    name,
    getCachedFeatures(),
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
    // A KTD is not a standalone object — it documents a parent object with a WB DOCUMENTATION handler.
    // The create POST goes to the collection URL with a sktd:docu XML body that references the parent.
    const refType = normalizeKtdRefObjectType(String(args.refObjectType ?? ''));
    if (!refType) {
      return errorResult(
        `"refObjectType" is required for SKTD/KTD create — the ADT type+subtype of the parent object being documented (for example: ${KTD_REF_OBJECT_TYPES_HINT}).`,
      );
    }
    const refTypeError = validateKtdRefObjectType(refType);
    if (refTypeError) return errorResult(refTypeError);
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
<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:language="${ktdLang}" adtcore:name="${escapeXmlAttr(name)}" adtcore:type="SKTD/TYP" adtcore:masterLanguage="${ktdLang}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
  <sktd:refObject adtcore:description="${escapeXmlAttr(refDescription)}" adtcore:name="${escapeXmlAttr(refName)}" adtcore:type="${escapeXmlAttr(refType)}" adtcore:uri="${escapeXmlAttr(refUri)}"/>
</sktd:docu>`;

    const ktdCreateUrl = '/sap/bc/adt/documentation/ktd/documents';
    let ktdResult: string;
    try {
      ktdResult = await createObject(
        client.http,
        client.safety,
        ktdCreateUrl,
        ktdBody,
        SKTD_V2_CONTENT_TYPE,
        effectiveTransport,
        undefined,
        getCachedFeatures()?.abapRelease,
      );
    } catch (err) {
      if (isKtdCreateEndpointUnavailable(err)) {
        return errorResult(
          `SKTD/KTD create endpoint is not available on this SAP system: ${ktdCreateUrl} returned 404. ` +
            `KTD creation requires SAP_BASIS 7.55+ with the ADT Knowledge Transfer Document service active. ` +
            `ARC-1 did not create "${name}". On older systems, use the documentation mechanism supported by that release or connect to a KTD-capable backend.`,
        );
      }
      throw err;
    }

    // Bodies and/or short texts require a follow-up PUT of the server-provided envelope.
    // The POST already succeeded, so every later failure is reported as partial success.
    const shortTexts = args.shortTexts as KtdShortText[] | undefined;
    if (hasSource || shortTexts?.length) {
      let summary: string;
      try {
        const { source: currentEnvelope } = await client.getKtd(name);
        const report: KtdWriteReport = { proseHeadings: [] };
        const body = rewriteKtdDocument(currentEnvelope, hasSource ? source : undefined, shortTexts, report);
        summary = formatKtdWriteReport(currentEnvelope, body, report);
        await safeUpdateObject(
          client.http,
          client.safety,
          objectUrl,
          body,
          SKTD_V2_CONTENT_TYPE,
          effectiveTransport,
          getCachedFeatures()?.abapRelease,
        );
      } catch (err) {
        // The POST above already succeeded, so the KTD exists. Say so — a generic
        // read/rewrite/PUT failure invites the same create again, which 409s.
        invalidateWrittenObject(type, name);
        const documentationPart = shortTexts?.length ? 'documentation' : 'documentation body';
        return errorResult(
          `Created SKTD ${name} in package ${pkg}, but the ${documentationPart} was NOT written: ` +
            `${err instanceof Error ? err.message : String(err)}\n` +
            `The object exists — verify it with SAPRead. Inspect the reported cause: correct or remove invalid ` +
            `${[hasSource && 'source', shortTexts?.length && 'shortTexts'].filter(Boolean).join(' and ')} input, ` +
            `or wait for a transient read/PUT failure to recover. Then use ` +
            `SAPWrite(action="update", type="SKTD", name="${name}", …); do not retry create.`,
        );
      }
      invalidateWrittenObject(type, name);
      const writtenPart = shortTexts?.length ? 'its documentation' : 'Markdown content';
      return textResult(
        `Created SKTD ${name} in package ${pkg} and wrote ${writtenPart}.\n${summary}\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
      );
    }
    invalidateWrittenObject();
    return textResult(
      `Created SKTD ${name} in package ${pkg} (no Markdown content written — pass "source" for node bodies, and optionally "shortTexts" for per-node short texts).\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
    );
  }

  // Build type-specific creation XML body.
  // SAP ADT requires the root element to match the object type —
  // a generic objectReferences body returns 400 "System expected the element ...".
  const metadataProperties = getMetadataWriteProperties(args);
  const bdefExtensionBase = applyBdefBehaviorExtensionMetadata(type, source, metadataProperties);
  // BTP/Steampunk needs cloud-correct create XML (G-3) and a real responsible user (G-5).
  const systemType = resolveWriteSystemType(config, client);
  const cloud = systemType === 'btp';
  const responsible = config.username || (await client.getEffectiveUser());
  const body = buildCreateXml(type, name, pkg, description, metadataProperties, config.language, responsible, cloud);

  // Step 1: Create the object (metadata only)
  const createUrl = objectUrl.replace(/\/[^/]+$/, ''); // parent collection URL
  // DOMA/DTEL/BDEF require vendor-specific content types; all other types use
  // 'application/*' — the wildcard lets the SAP server resolve the correct
  // handler (matching how ADT Eclipse and abap-adt-api send requests).
  const contentType = createContentTypeForType(type, cloud, type === 'INCL' && String(args.group ?? '').trim() !== '');
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
      getCachedFeatures()?.abapRelease,
      systemType,
      name,
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

  // Cache the session's internal ABAP user (createdBy of this cloud create) for BTP package create —
  // no whoami endpoint exists. Best-effort, once per session: try the 201 body, then one GET.
  if (cloud && !client.getInternalUser()) {
    try {
      const createdBy =
        result.match(/adtcore:createdBy="([^"]*)"/)?.[1] ??
        (await client.http.get(objectUrl)).body.match(/adtcore:createdBy="([^"]*)"/)?.[1];
      client.noteInternalUser(createdBy);
    } catch {
      // opportunistic only — package create falls back to an explicit `responsible`
    }
  }

  if (type === 'FUNC' && metadataProperties.processingType !== undefined) {
    await persistFunctionModuleProcessingMetadata(
      client,
      objectUrl,
      name,
      metadataProperties.processingType as FunctionProcessingType,
      metadataProperties.updateTaskKind as FunctionUpdateTaskKind | undefined,
      effectiveTransport,
    );
  }

  if (isMetadataWriteType(type)) {
    // SAP's DTEL POST stores only a shell without the description, labels or custom lengths, so
    // every DTEL create needs this follow-up PUT.
    // Use withStatefulSession directly (not safeUpdateObject) to keep the lock cycle
    // on the main client's session, avoiding lock contention with subsequent operations.
    if (type === 'DTEL') {
      const ct = vendorContentTypeForType(type);
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(
          session,
          client.safety,
          objectUrl,
          'MODIFY',
          getCachedFeatures()?.abapRelease,
          systemType,
        );
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
        const lock = await lockObject(
          session,
          client.safety,
          objectUrl,
          'MODIFY',
          getCachedFeatures()?.abapRelease,
          systemType,
        );
        const lockTransport = effectiveTransport ?? (lock.corrNr || undefined);
        try {
          await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, ct, lockTransport);
        } finally {
          await unlockObject(session, objectUrl, lock.lockHandle);
        }
      });
    }
    // TTYP: the POST creates a default-typed (CHAR) shell — a follow-up PUT writes the real row type.
    if (type === 'TTYP') {
      const ct = vendorContentTypeForType(type);
      await putTtypMetadataAfterCreate(client, objectUrl, name, body, ct, effectiveTransport);
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
  const funcPreparation =
    type === 'FUNC'
      ? prepareFunctionModuleCreateSource(name, source, args.parameters as FmParameter[] | undefined)
      : { shouldWrite: !!source, source: source ?? '', warnings: [] };
  const shouldWriteSource = funcPreparation.shouldWrite;
  if (shouldWriteSource) {
    // FUNC processing metadata is paired with a source signature prepared above;
    // other object types use their supplied source unchanged.
    const createSource = funcPreparation.source;

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
      getCachedFeatures()?.abapRelease,
    );
    const bdefExtensionWarning = bdefExtensionBase
      ? await warnIfBdefExtensionUnconfirmed(client, name, bdefExtensionBase)
      : undefined;
    invalidateWrittenObject(type, name);
    const msg = `Created ${type} ${name} in package ${pkg} and wrote source code.`;
    const warnings = mergePreWriteWarnings(
      preflightWarnings.warnings,
      lintWarnings.warnings,
      ...funcPreparation.warnings,
      bdefExtensionWarning,
    );
    return warnings ? textResult(`${msg}\n\n${warnings}`) : textResult(msg);
  }

  return textResult(`Created ${type} ${name} in package ${pkg}.\n${result}`);
}

export async function writeActionBatchCreate(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, args, config, transport, lintOverride, preflightOverride, invalidateWrittenObject } = ctx;
  const objects = args.objects as Array<Record<string, unknown>> | undefined;
  if (!objects || !Array.isArray(objects) || objects.length === 0) {
    return errorResult('"objects" array is required and must be non-empty for batch_create action.');
  }
  checkOperation(client.safety, OperationType.Create, 'CreateObject');
  const activateAtEnd = args.activateAtEnd === true || String(args.activateAtEnd) === 'true';
  const defaultPackage = normalizePackageOverride(args.package, '$TMP');
  const warnings: string[] = [];
  const batchPlan = objects.map((obj, index) => {
    const type = normalizeWriteObjectType(String(obj.type ?? ''));
    const name = String(obj.name ?? '');
    const packageName = normalizePackageOverride(obj.package, defaultPackage);
    const group = type === 'FUNC' ? String(obj.group ?? args.group ?? '').trim() : undefined;
    const objectUrl =
      type === 'FUNC' ? (group ? functionModuleObjectUrl(group, name) : '') : objectUrlForType(type, name);
    const metadata = getMetadataWriteProperties(obj);
    if (type === 'FUNC') metadata.group = group;
    const source = obj.source ? String(obj.source) : undefined;
    return {
      obj,
      type,
      name,
      packageName,
      group,
      objectUrl,
      metadata,
      source,
      transport: normalizeTransportOverride(obj.transport) ?? transport,
      description: String(obj.description ?? name),
      metadataObject: isMetadataWriteType(type),
      body: '',
      contentType: '',
      sourceUrl: '',
      result: batchEntryResult(index, type, name, packageName),
    };
  });
  const results = batchPlan.map((plan) => plan.result);
  const activationMessages: string[] = [];
  const report = (preflight = false) =>
    batchCreateResult(results, { preflight, activateAtEnd, warnings, activationMessages });
  const seen = new Map<string, number>();

  // Validate the complete input before package/transport reads or the first create.
  for (const plan of batchPlan) {
    const errors: string[] = [];
    try {
      if (!plan.name.trim() || plan.name !== plan.name.trim() || plan.name !== plan.name.toUpperCase()) {
        errors.push(
          `Object name "${plan.name}" must be non-empty, uppercase, and have no surrounding whitespace (e.g. "${plan.name.trim().toUpperCase()}"); source may stay mixed case.`,
        );
      }
      const keyType =
        plan.type === 'INCL' ? 'PROG' : ['CLAS', 'INTF'].includes(plan.type) ? 'OO' : canonicalTablType(plan.type);
      const key = `${keyType}\0${plan.name.toUpperCase()}`;
      const previous = seen.get(key);
      if (previous !== undefined)
        errors.push(`Duplicate object: entry ${plan.result.index + 1} repeats entry ${previous + 1}.`);
      else seen.set(key, plan.result.index);
      if (plan.type === 'FUNC' && !plan.group) {
        errors.push(`FUNC ${plan.name} in batch_create requires "group" on the object entry or top-level request.`);
      }
      if (isServerDrivenObjectType(plan.type)) {
        errors.push(
          `batch_create does not support server-driven object type ${plan.type}. Create it with a single SAPWrite(action="create", type="${plan.type}", name="${plan.name}") call.`,
        );
      }
      if ((plan.type === 'TABL' || plan.type === 'TABL/DT') && isTablesEndpointAvailable() === false)
        errors.push(TABL_DT_WRITE_UNAVAILABLE_HINT);
      if (plan.type === 'DOMA' && isDomainsEndpointAvailable() === false) errors.push(DOMA_WRITE_UNAVAILABLE_HINT);
      if (plan.type === 'TTYP' && isTableTypesEndpointAvailable() === false) errors.push(TTYP_WRITE_UNAVAILABLE_HINT);
      if (plan.type === 'INCL' && plan.name.startsWith('L')) {
        errors.push(
          'Function-group structural includes require a single SAPWrite create with group; batch_create does not support them.',
        );
      }
      const aff = validateAffHeader(plan.type, { description: plan.description, originalLanguage: 'en' });
      if (!aff.valid) errors.push(`AFF metadata validation failed:\n- ${(aff.errors ?? []).join('\n- ')}`);
      if (plan.type === 'FUNC') {
        const prepared = prepareFunctionModuleCreateSource(
          plan.name,
          plan.source,
          plan.obj.parameters as FmParameter[] | undefined,
        );
        plan.source = prepared.shouldWrite ? prepared.source : undefined;
        warnings.push(...prepared.warnings.map((warning) => `${plan.type} ${plan.name}: ${warning}`));
      }
      if (!plan.metadataObject && plan.source && !isServerDrivenObjectType(plan.type)) {
        const cds = guardCdsSyntax(plan.type, plan.source, getCachedFeatures());
        if (cds) errors.push(cds.content[0].text);
        const rap = runRapPreflightValidation(
          plan.source,
          plan.type,
          plan.name,
          getCachedFeatures(),
          config.systemType,
          preflightOverride,
        );
        if (rap.blocked) errors.push(rap.result!.content[0].text);
        if (rap.warnings) warnings.push(`${plan.type} ${plan.name}: ${rap.warnings}`);
        const lint = runPreWriteLint(plan.source, plan.type, plan.name, config, lintOverride);
        if (lint.blocked) errors.push(`source rejected by lint: ${lint.result!.content[0].text}`);
        if (lint.warnings) warnings.push(`${plan.type} ${plan.name}: ${lint.warnings}`);
      }
      if (!isServerDrivenObjectType(plan.type)) {
        plan.sourceUrl =
          plan.type === 'FUNC' ? `${plan.objectUrl}/source/main` : sourceUrlForType(plan.type, plan.name);
      }
      if (
        plan.type === 'DTEL' ||
        plan.type === 'TTYP' ||
        (plan.type === 'FUNC' && plan.metadata.processingType !== undefined) ||
        (!plan.metadataObject && plan.source)
      ) {
        plan.result.write = 'not_attempted';
      }
    } catch (err) {
      errors.push(batchFailureMessage(err, false));
    }
    if (errors.length) failBatchEntry(plan.result, 'preflight', errors.join('\n'));
  }
  if (results.some((entry) => entry.status === 'failed')) return report(true);

  // Resolve FUNC's actual inherited package and enforce every package before mutations.
  for (const plan of batchPlan) {
    try {
      if (plan.type === 'FUNC') {
        plan.packageName = await resolveFunctionGroupCreatePackage(client, plan.group!, plan.obj.package);
        plan.result.packageName = plan.packageName;
      }
      await checkPackage(client.safety, plan.packageName, client.getPackageHierarchyResolver());
    } catch (err) {
      failBatchEntry(plan.result, 'preflight', batchFailureMessage(err, config.minimalErrors));
    }
  }
  if (results.some((entry) => entry.status === 'failed')) return report(true);

  const autoTransportByPackage = new Map<string, string | undefined>();
  for (const plan of batchPlan) {
    if (plan.transport || autoTransportByPackage.has(plan.packageName)) continue;
    autoTransportByPackage.set(plan.packageName, undefined);
    try {
      const resolved = await resolveCreateTransport(client, plan.objectUrl, plan.packageName, config.minimalErrors);
      if (resolved.error) failBatchEntry(plan.result, 'preflight', resolved.error);
      else autoTransportByPackage.set(plan.packageName, resolved.transport);
    } catch (error) {
      failBatchEntry(plan.result, 'preflight', batchFailureMessage(error, config.minimalErrors));
    }
  }
  if (results.some((entry) => entry.status === 'failed')) return report(true);

  const systemType = resolveWriteSystemType(config, client);
  const cloud = systemType === 'btp';
  const responsible = config.username || (await client.getEffectiveUser());
  const transportLookupCache = new Map<string, Awaited<ReturnType<typeof getTransport>>>();
  for (const plan of batchPlan) {
    try {
      plan.transport ??= autoTransportByPackage.get(plan.packageName);
      if (plan.type === 'MSAG' && plan.transport) {
        if (!transportLookupCache.has(plan.transport))
          transportLookupCache.set(plan.transport, await getTransport(client.http, client.safety, plan.transport));
        if (!transportLookupCache.get(plan.transport)) {
          failBatchEntry(
            plan.result,
            'preflight',
            `Transport "${plan.transport}" is not a valid transport request. MSAG creation requires a transport request number, not a task number.`,
          );
          continue;
        }
      }
    } catch (err) {
      failBatchEntry(plan.result, 'preflight', batchFailureMessage(err, config.minimalErrors));
      continue;
    }
    try {
      applyBdefBehaviorExtensionMetadata(plan.type, plan.source, plan.metadata);
      plan.body = buildCreateXml(
        plan.type,
        plan.name,
        plan.packageName,
        plan.description,
        plan.metadata,
        config.language,
        responsible,
        cloud,
      );
      plan.contentType = createContentTypeForType(plan.type, cloud);
    } catch (err) {
      // Construction errors are local input diagnostics, not SAP response details.
      failBatchEntry(plan.result, 'preflight', batchFailureMessage(err, false));
    }
  }
  if (results.some((entry) => entry.status === 'failed')) return report(true);

  const writtenPlans: typeof batchPlan = [];
  for (const plan of batchPlan) {
    const entry = plan.result;
    let phase: BatchFailurePhase = 'create';
    try {
      const needsPackage = plan.type === 'BDEF' || canonicalTablType(plan.type) === 'TABL';
      entry.creation = 'unknown';
      try {
        await createObject(
          client.http,
          client.safety,
          plan.objectUrl.replace(/\/[^/]+$/, ''),
          plan.body,
          plan.contentType,
          plan.transport,
          needsPackage ? plan.packageName : undefined,
          getCachedFeatures()?.abapRelease,
          systemType,
          plan.name,
        );
      } catch (err) {
        if (err instanceof AdtSafetyError) entry.creation = 'not_attempted';
        // Keep the original create failure even if the optional diagnostic cannot run.
        if (!config.minimalErrors && err instanceof AdtApiError && [400, 409].includes(err.statusCode)) {
          const detail = await tryPostSaveSyntaxCheck(client, plan.type, plan.name).catch(() => undefined);
          if (detail) err.message += detail;
        }
        throw err;
      }
      entry.creation = 'confirmed';
      phase = 'write';
      if (entry.write !== 'not_required') entry.write = 'unknown';
      if (plan.type === 'FUNC' && plan.metadata.processingType !== undefined) {
        await persistFunctionModuleProcessingMetadata(
          client,
          plan.objectUrl,
          plan.name,
          plan.metadata.processingType as FunctionProcessingType,
          plan.metadata.updateTaskKind as FunctionUpdateTaskKind | undefined,
          plan.transport,
        );
      }
      if (plan.type === 'DTEL') {
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(
            session,
            client.safety,
            plan.objectUrl,
            'MODIFY',
            getCachedFeatures()?.abapRelease,
          );
          try {
            await updateObject(
              session,
              client.safety,
              plan.objectUrl,
              plan.body,
              lock.lockHandle,
              plan.contentType,
              plan.transport ?? (lock.corrNr || undefined),
            );
          } finally {
            await unlockObject(session, plan.objectUrl, lock.lockHandle);
          }
        });
      }
      if (plan.type === 'TTYP')
        await putTtypMetadataAfterCreate(
          client,
          plan.objectUrl,
          plan.name,
          plan.body,
          plan.contentType,
          plan.transport,
        );
      if (!plan.metadataObject && plan.source) {
        await safeUpdateSource(
          client.http,
          client.safety,
          plan.objectUrl,
          plan.sourceUrl,
          plan.source,
          plan.transport,
          getCachedFeatures()?.abapRelease,
        );
      }
      if (entry.write !== 'not_required') entry.write = 'confirmed';
      if (activateAtEnd) {
        writtenPlans.push(plan);
      } else {
        phase = 'activate';
        entry.activation = 'unknown';
        const outcome = await activate(client.http, client.safety, plan.objectUrl);
        if (!outcome.success) {
          entry.activation = 'failed';
          failBatchEntry(
            entry,
            phase,
            `activation failed: ${batchFailureMessage(outcome.messages.join('; '), config.minimalErrors)}`,
          );
          break;
        }
        entry.activation = 'confirmed';
      }
      entry.status = 'success';
    } catch (err) {
      failBatchEntry(entry, phase, batchFailureMessage(err, config.minimalErrors));
      break;
    } finally {
      if (entry.creation !== 'not_attempted') invalidateWrittenObject(plan.type, plan.name);
    }
  }

  if (activateAtEnd && writtenPlans.length > 0) {
    for (const plan of writtenPlans) plan.result.activation = 'unknown';
    try {
      const outcome = await activateBatch(
        client.http,
        client.safety,
        writtenPlans.map((plan) => ({ type: plan.type, name: plan.name, url: plan.objectUrl })),
      );
      if (!outcome.success) {
        activationMessages.push(`${writtenPlans.length}/${writtenPlans.length} written, batch activation failed.`);
        const unassigned = outcome.details.filter(
          (detail) => !writtenPlans.some((plan) => activationDetailMatchesObject(detail.uri, plan.objectUrl)),
        );
        // Flat messages duplicate structured details; retain only otherwise-unrepresented messages.
        const messages = [
          ...unassigned.map((detail) => detail.text),
          ...outcome.messages.filter((message) => !outcome.details.some((detail) => detail.text === message)),
        ];
        if (messages.length)
          activationMessages.push(batchFailureMessage([...new Set(messages)].join('; '), config.minimalErrors));
      }
      for (const plan of writtenPlans) {
        if (outcome.success) {
          plan.result.activation = 'confirmed';
          continue;
        }
        const errors = outcome.details.filter(
          (detail) => detail.severity === 'error' && activationDetailMatchesObject(detail.uri, plan.objectUrl),
        );
        plan.result.activation = errors.length ? 'failed' : 'unknown';
        const message = errors.length
          ? batchFailureMessage(errors.map((detail) => detail.text).join('; '), config.minimalErrors)
          : 'Activation remains unknown: batch activation failed without an object-specific error.';
        failBatchEntry(plan.result, 'activate', message);
      }
    } catch (err) {
      for (const plan of writtenPlans)
        failBatchEntry(plan.result, 'activate', batchFailureMessage(err, config.minimalErrors));
    } finally {
      for (const plan of writtenPlans) invalidateWrittenObject(plan.type, plan.name);
    }
  }
  return report();
}
