/**
 * Write + pre-write-validation helpers.
 *
 * Content-type negotiation, DDIC metadata write properties, buildCreateXml, the pre-write
 * lint/syntax/RAP-preflight gates, package enforcement, and the server-driven-object write engine.
 * Shared by the SAPWrite and SAPLint handlers.
 */

import type { AdtClient } from '../adt/client.js';
import {
  buildDataElementXml,
  buildDomainXml,
  buildMessageClassXml,
  buildServiceBindingXml,
  type DataElementCreateParams,
  type DomainCreateParams,
  type MessageClassCreateParams,
  normalizeAdtLanguage,
  normalizeAdtResponsible,
  type ServiceBindingCreateParams,
} from '../adt/ddic-xml.js';
import { syntaxCheck } from '../adt/devtools.js';
import { AdtSafetyError } from '../adt/errors.js';
import { formatRapPreflightFindings, validateRapSource } from '../adt/rap-preflight.js';
import { checkPackage } from '../adt/safety.js';
import {
  createServerDrivenObject,
  deleteServerDrivenObject,
  serverDrivenBlueContentType,
  serverDrivenObjectUrl,
  supportsServerDrivenObject,
  updateServerDrivenObjectSource,
} from '../adt/server-driven.js';
import type { ResolvedFeatures } from '../adt/types.js';
import { escapeXmlAttr } from '../adt/xml-parser.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import type { LintConfigOptions, RuleOverrides } from '../lint/config-builder.js';
import { detectFilename, validateBeforeWrite } from '../lint/lint.js';
import type { ServerConfig } from '../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from './cache-security.js';
import { cachedFeatures } from './feature-cache.js';
import { canonicalTablType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

/**
 * Build LintConfigOptions from server config and cached features.
 *
 * Uses cachedFeatures (from SAPManage probe) when available, but falls back
 * to config.systemType so that --system-type btp works even before the first
 * probe. Without this fallback, cloud lint rules wouldn't apply until a probe
 * populates cachedFeatures.
 */
export function buildLintConfigOptions(config: ServerConfig, ruleOverrides?: RuleOverrides): LintConfigOptions {
  // Probe-detected system type is most accurate; fall back to CLI config
  const systemType = cachedFeatures?.systemType ?? (config.systemType !== 'auto' ? config.systemType : undefined);
  return {
    systemType,
    abapRelease: cachedFeatures?.abapRelease ?? config.abapRelease,
    configFile: config.abaplintConfig,
    ruleOverrides,
  };
}

// ─── Object Creation XML ─────────────────────────────────────────────

export const DOMAIN_V2_CONTENT_TYPE = 'application/vnd.sap.adt.domains.v2+xml; charset=utf-8';
export const DATAELEMENT_V2_CONTENT_TYPE = 'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8';
export const SERVICEBINDING_V2_CONTENT_TYPE =
  'application/vnd.sap.adt.businessservices.servicebinding.v2+xml; charset=utf-8';
// Accept variant WITHOUT media-type parameters. On-prem 758 rejects an Accept that carries
// "; charset=utf-8" on the bindings resource with 406 SADT_RESOURCE 037 ("The message content
// is not acceptable", no accepted-types list — so the generic negotiation retry cannot infer a
// fallback either). Live-verified on S/4HANA 2023: bare type → 200, charset-suffixed → 406.
// Use this for reads (the publish/unpublish package gate); keep the charset form for PUT/POST
// Content-Type only.
export const SERVICEBINDING_V2_ACCEPT = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';
const BDEF_CONTENT_TYPE = 'application/vnd.sap.adt.blues.v1+xml';
const MESSAGECLASS_CONTENT_TYPE = 'application/vnd.sap.adt.mc.messageclass+xml';
export const SKTD_V2_CONTENT_TYPE = 'application/vnd.sap.adt.sktdv2+xml';
// Function group + function module content types — verified live on a4h S/4HANA 2023
// (issue #250). FUGR uses the v3 group envelope; FUNC uses the unversioned fmodule envelope.
const FUNCTION_GROUP_CONTENT_TYPE = 'application/vnd.sap.adt.functions.groups.v3+xml';
const FUNCTION_MODULE_CONTENT_TYPE = 'application/vnd.sap.adt.functions.fmodules+xml';

export function isMetadataWriteType(type: string): boolean {
  return type === 'DOMA' || type === 'DTEL' || type === 'MSAG' || type === 'SRVB';
}

/** Types that require a specific vendor content type for creation (not application/*) */
function needsVendorContentType(type: string): boolean {
  return (
    type === 'DOMA' ||
    type === 'DTEL' ||
    type === 'BDEF' ||
    type === 'MSAG' ||
    type === 'SKTD' ||
    type === 'FUGR' ||
    type === 'FUNC'
  );
}

/** Content type used for create POST */
export function createContentTypeForType(type: string): string {
  // SRVB creation works with wildcard content type; updates use vendor v2 type.
  if (type === 'SRVB') return 'application/*';
  return needsVendorContentType(type) ? vendorContentTypeForType(type) : 'application/*';
}

/**
 * Check if a DTEL create has properties that SAP ignores on POST but accepts on PUT.
 * SAP's DTEL POST only stores the shell (name, description, package, typeKind, typeName, dataType, length).
 * Labels, searchHelp, setGetParameter, etc. require a follow-up PUT to take effect.
 */
export function dtelNeedsPostCreateUpdate(props: Record<string, unknown>): boolean {
  return Boolean(
    props.shortLabel ||
      props.mediumLabel ||
      props.longLabel ||
      props.headingLabel ||
      props.searchHelp ||
      props.searchHelpParameter ||
      props.setGetParameter ||
      props.defaultComponentName ||
      props.changeDocument,
  );
}

export function vendorContentTypeForType(type: string): string {
  switch (type) {
    case 'DOMA':
      return DOMAIN_V2_CONTENT_TYPE;
    case 'DTEL':
      return DATAELEMENT_V2_CONTENT_TYPE;
    case 'SRVB':
      return SERVICEBINDING_V2_CONTENT_TYPE;
    case 'BDEF':
      return BDEF_CONTENT_TYPE;
    case 'MSAG':
      return MESSAGECLASS_CONTENT_TYPE;
    case 'SKTD':
      return SKTD_V2_CONTENT_TYPE;
    case 'FUGR':
      return FUNCTION_GROUP_CONTENT_TYPE;
    case 'FUNC':
      return FUNCTION_MODULE_CONTENT_TYPE;
    default:
      // Wildcard lets the SAP server resolve the correct handler.
      // Sending 'application/xml' causes 415 on DDL-based endpoints
      // (DDLS, SRVD, DDLX) whose resource classes reject that literal type.
      return 'application/*';
  }
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

export function getMetadataWriteProperties(input: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {
    dataType: input.dataType,
    length: input.length,
    decimals: input.decimals,
    outputLength: input.outputLength,
    conversionExit: input.conversionExit,
    signExists: input.signExists,
    lowercase: input.lowercase,
    fixedValues: input.fixedValues,
    valueTable: input.valueTable,
    typeKind: input.typeKind,
    typeName: input.typeName,
    domainName: input.domainName,
    shortLabel: input.shortLabel,
    mediumLabel: input.mediumLabel,
    longLabel: input.longLabel,
    headingLabel: input.headingLabel,
    searchHelp: input.searchHelp,
    searchHelpParameter: input.searchHelpParameter,
    setGetParameter: input.setGetParameter,
    defaultComponentName: input.defaultComponentName,
    changeDocument: input.changeDocument,
    messages: input.messages,
    serviceDefinition: input.serviceDefinition,
    bindingType: input.bindingType,
    category: input.category,
    version: input.version,
    odataVersion: input.odataVersion,
    // Function-module create needs the parent function-group name for the
    // <adtcore:containerRef> in the create payload (issue #250).
    group: input.group,
  };

  return props;
}

/**
 * Fetch existing DDIC metadata and merge with provided properties.
 * This ensures that updating a single field (e.g., shortLabel) doesn't
 * reset other fields (e.g., dataType, typeKind) to defaults, since
 * DDIC updates are full-XML-replace operations.
 *
 * Internal _description and _package fields carry the existing values
 * for the caller to use as fallbacks.
 */
function normalizeSrvbCategory(value: unknown): '0' | '1' | undefined {
  if (value === '0' || value === 0 || value === 'UI') return '0';
  if (value === '1' || value === 1 || value === 'Web API') return '1';
  return undefined;
}

export async function mergeMetadataWriteProperties(
  client: AdtClient,
  type: string,
  name: string,
  provided: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    if (type === 'MSAG') {
      const existing = await client.getMessageClassInfo(name);
      return {
        _description: existing.description,
        _package: existing.package,
        messages: provided.messages ?? existing.messages,
      };
    }
    if (type === 'DOMA') {
      const existing = await client.getDomain(name);
      return {
        _description: existing.description,
        _package: existing.package,
        dataType: provided.dataType ?? existing.dataType,
        length: provided.length ?? existing.length,
        decimals: provided.decimals ?? existing.decimals,
        outputLength: provided.outputLength ?? existing.outputLength,
        conversionExit: provided.conversionExit ?? existing.conversionExit,
        signExists: provided.signExists ?? existing.signExists,
        lowercase: provided.lowercase ?? existing.lowercase,
        fixedValues: provided.fixedValues ?? existing.fixedValues,
        valueTable: provided.valueTable ?? existing.valueTable,
      };
    }
    if (type === 'DTEL') {
      const existing = await client.getDataElement(name);
      return {
        _description: existing.description,
        _package: existing.package,
        dataType: provided.dataType ?? existing.dataType,
        length: provided.length ?? existing.length,
        decimals: provided.decimals ?? existing.decimals,
        typeKind: provided.typeKind ?? existing.typeKind,
        typeName: provided.typeName ?? existing.typeName,
        domainName: provided.domainName ?? existing.typeName, // DTEL stores domain in typeName
        shortLabel: provided.shortLabel ?? existing.shortLabel,
        mediumLabel: provided.mediumLabel ?? existing.mediumLabel,
        longLabel: provided.longLabel ?? existing.longLabel,
        headingLabel: provided.headingLabel ?? existing.headingLabel,
        searchHelp: provided.searchHelp ?? existing.searchHelp,
        searchHelpParameter: provided.searchHelpParameter,
        setGetParameter: provided.setGetParameter,
        defaultComponentName: provided.defaultComponentName ?? existing.defaultComponentName,
        changeDocument: provided.changeDocument,
      };
    }
    if (type === 'SRVB') {
      const { source: existingRaw } = await client.getSrvb(name);
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      return {
        _description: existing.description,
        _package: existing.package,
        serviceDefinition: provided.serviceDefinition ?? existing.serviceDefinition,
        bindingType: provided.bindingType ?? existing.bindingType,
        category: provided.category ?? normalizeSrvbCategory(existing.bindingCategory),
        version: provided.version ?? existing.serviceVersion,
        odataVersion: provided.odataVersion ?? existing.odataVersion,
      };
    }
  } catch {
    // If we can't read existing metadata (e.g., object is new/inactive), fall through
  }
  return provided;
}

/**
 * Build the type-specific XML body for ADT object creation.
 *
 * SAP ADT requires each object type to have its own root XML element.
 * Using a generic body (e.g. adtcore:objectReferences) returns 400:
 *   "System expected the element '{http://www.sap.com/adt/programs/programs}abapProgram'"
 */

export function buildCreateXml(
  type: string,
  name: string,
  pkg: string,
  description: string,
  properties?: Record<string, unknown>,
  language?: string,
  responsible?: string,
): string {
  // Master/original language for the created object. Derived from the configured
  // SAP_LANGUAGE (passed by callers as config.language) so the create-XML body
  // matches the sap-language URL param ARC-1 already sends. Defaults to "EN" when
  // unset, preserving legacy output. See issue #343.
  const masterLanguage = normalizeAdtLanguage(language);
  // Person responsible for the created object. Derived from the configured logon
  // user (passed by callers as config.username). The legacy hard-coded "DEVELOPER"
  // only exists on SAP demo systems, so on a real system it fails with
  // 400 [?/049] "Enter a valid user, not DEVELOPER, as the person responsible".
  // Defaults to "DEVELOPER" only when no user is configured. Same threading as #343.
  const responsibleUser = normalizeAdtResponsible(responsible);
  switch (type) {
    case 'PROG':
      return `<?xml version="1.0" encoding="UTF-8"?>
<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXmlAttr(description)}"
                     adtcore:name="${escapeXmlAttr(name)}"
                     adtcore:type="PROG/P"
                     adtcore:masterLanguage="${masterLanguage}"
                     adtcore:masterSystem="H00"
                     adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</program:abapProgram>`;
    case 'CLAS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(description)}"
                 adtcore:name="${escapeXmlAttr(name)}"
                 adtcore:type="CLAS/OC"
                 adtcore:masterLanguage="${masterLanguage}"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</class:abapClass>`;
    case 'INTF':
      return `<?xml version="1.0" encoding="UTF-8"?>
<intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces"
                    xmlns:adtcore="http://www.sap.com/adt/core"
                    adtcore:description="${escapeXmlAttr(description)}"
                    adtcore:name="${escapeXmlAttr(name)}"
                    adtcore:type="INTF/OI"
                    adtcore:masterLanguage="${masterLanguage}"
                    adtcore:masterSystem="H00"
                    adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</intf:abapInterface>`;
    case 'INCL':
      return `<?xml version="1.0" encoding="UTF-8"?>
<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXmlAttr(description)}"
                     adtcore:name="${escapeXmlAttr(name)}"
                     adtcore:type="PROG/I"
                     adtcore:masterLanguage="${masterLanguage}"
                     adtcore:masterSystem="H00"
                     adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</include:abapInclude>`;
    case 'DDLS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"
               xmlns:adtcore="http://www.sap.com/adt/core"
               adtcore:description="${escapeXmlAttr(description)}"
               adtcore:name="${escapeXmlAttr(name)}"
               adtcore:type="DDLS/DF"
               adtcore:masterLanguage="${masterLanguage}"
               adtcore:masterSystem="H00"
                 adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</ddl:ddlSource>`;
    case 'DCLS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<dcl:dclSource xmlns:dcl="http://www.sap.com/adt/acm/dclsources"
               xmlns:adtcore="http://www.sap.com/adt/core"
               adtcore:description="${escapeXmlAttr(description)}"
               adtcore:name="${escapeXmlAttr(name)}"
               adtcore:type="DCLS/DL"
               adtcore:masterLanguage="${masterLanguage}"
               adtcore:masterSystem="H00"
               adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</dcl:dclSource>`;
    case 'TABL':
    case 'TABL/DT':
    case 'TABL/DS': {
      // Bare TABL is the legacy alias for TABL/DT (transparent table). The same
      // <blue:blueSource> envelope works for both subtypes — only adtcore:type
      // and the POST URL differ. See docs/plans/completed/fix-tabl-ds-create-routing.md.
      const adtType = type === 'TABL/DS' ? 'TABL/DS' : 'TABL/DT';
      return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(description)}"
                 adtcore:name="${escapeXmlAttr(name)}"
                 adtcore:type="${adtType}"
                 adtcore:masterLanguage="${masterLanguage}"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</blue:blueSource>`;
    }
    case 'BDEF':
      // BDEF uses SAP's "blue" framework — blue:blueSource with http://www.sap.com/wbobj/blue namespace.
      // Confirmed by vibing-steampunk (Go) and fr0ster (TypeScript) reference implementations.
      return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(description)}"
                 adtcore:name="${escapeXmlAttr(name)}"
                 adtcore:type="BDEF/BDO"
                 adtcore:masterLanguage="${masterLanguage}"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</blue:blueSource>`;
    case 'SRVD':
      return `<?xml version="1.0" encoding="UTF-8"?>
<srvd:srvdSource xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(description)}"
                 adtcore:name="${escapeXmlAttr(name)}"
                 adtcore:type="SRVD/SRV"
                 adtcore:masterLanguage="${masterLanguage}"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="${escapeXmlAttr(responsibleUser)}"
                 srvd:srvdSourceType="S">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</srvd:srvdSource>`;
    case 'SRVB': {
      const serviceDefinition = String(properties?.serviceDefinition ?? '').trim();
      if (!serviceDefinition) {
        throw new Error('SRVB create/update requires "serviceDefinition" (referenced SRVD name).');
      }
      const categoryRaw = properties?.category;
      const category =
        categoryRaw === '1' || categoryRaw === 1 ? '1' : categoryRaw === '0' || categoryRaw === 0 ? '0' : undefined;
      const params: ServiceBindingCreateParams = {
        name,
        description,
        package: pkg,
        serviceDefinition,
        bindingType: properties?.bindingType ? String(properties.bindingType) : undefined,
        category,
        version: properties?.version ? String(properties.version) : undefined,
        odataVersion: properties?.odataVersion ? String(properties.odataVersion) : undefined,
        language: masterLanguage,
        responsible: responsibleUser,
      };
      return buildServiceBindingXml(params);
    }
    case 'DDLX':
      return `<?xml version="1.0" encoding="UTF-8"?>
<ddlx:ddlxSource xmlns:ddlx="http://www.sap.com/adt/ddic/ddlxsources"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(description)}"
                 adtcore:name="${escapeXmlAttr(name)}"
                 adtcore:type="DDLX/EX"
                 adtcore:masterLanguage="${masterLanguage}"
                 adtcore:masterSystem="H00"
                     adtcore:responsible="${escapeXmlAttr(responsibleUser)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</ddlx:ddlxSource>`;
    case 'DOMA': {
      const fixedValuesRaw = Array.isArray(properties?.fixedValues) ? properties.fixedValues : [];
      const fixedValues = fixedValuesRaw
        .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
        .map((value) => ({
          low: String(value.low ?? ''),
          high: value.high === undefined ? undefined : String(value.high),
          description: value.description === undefined ? undefined : String(value.description),
        }));

      const params: DomainCreateParams = {
        name,
        description,
        package: pkg,
        dataType: String(properties?.dataType ?? 'CHAR'),
        length: (properties?.length as string | number | undefined) ?? 0,
        decimals: properties?.decimals as string | number | undefined,
        outputLength: properties?.outputLength as string | number | undefined,
        conversionExit: properties?.conversionExit ? String(properties.conversionExit) : undefined,
        signExists: toBoolean(properties?.signExists),
        lowercase: toBoolean(properties?.lowercase),
        fixedValues,
        valueTable: properties?.valueTable ? String(properties.valueTable) : undefined,
        language: masterLanguage,
        responsible: responsibleUser,
      };
      return buildDomainXml(params);
    }
    case 'DTEL': {
      const typeKindRaw = String(properties?.typeKind ?? '');
      const typeKind: DataElementCreateParams['typeKind'] =
        typeKindRaw === 'domain' || typeKindRaw === 'predefinedAbapType' ? typeKindRaw : undefined;
      const params: DataElementCreateParams = {
        name,
        description,
        package: pkg,
        typeKind,
        typeName: properties?.typeName ? String(properties.typeName) : undefined,
        domainName: properties?.domainName ? String(properties.domainName) : undefined,
        dataType: properties?.dataType ? String(properties.dataType) : undefined,
        length: properties?.length as string | number | undefined,
        decimals: properties?.decimals as string | number | undefined,
        shortLabel: properties?.shortLabel ? String(properties.shortLabel) : undefined,
        mediumLabel: properties?.mediumLabel ? String(properties.mediumLabel) : undefined,
        longLabel: properties?.longLabel ? String(properties.longLabel) : undefined,
        headingLabel: properties?.headingLabel ? String(properties.headingLabel) : undefined,
        searchHelp: properties?.searchHelp ? String(properties.searchHelp) : undefined,
        searchHelpParameter: properties?.searchHelpParameter ? String(properties.searchHelpParameter) : undefined,
        setGetParameter: properties?.setGetParameter ? String(properties.setGetParameter) : undefined,
        defaultComponentName: properties?.defaultComponentName ? String(properties.defaultComponentName) : undefined,
        changeDocument: toBoolean(properties?.changeDocument),
        language: masterLanguage,
        responsible: responsibleUser,
      };
      return buildDataElementXml(params);
    }
    case 'MSAG': {
      const messagesRaw = Array.isArray(properties?.messages) ? properties.messages : [];
      const messages = messagesRaw
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          number: String(m.number ?? ''),
          shortText: String(m.shortText ?? ''),
        }));
      const params: MessageClassCreateParams = {
        name,
        description,
        package: pkg,
        messages: messages.length > 0 ? messages : undefined,
        // Thread the configured language into the body (same spirit as #343).
        // Live-verified on a4h 7.58: the MSAG handler keys T100.SPRSL by the
        // BODY adtcore:language — without it the messages are stored under a
        // BLANK language key (texts never resolve at runtime; ATC/SLIN flags
        // every number as missing). The sap-language URL param alone does NOT
        // prevent this.
        language: masterLanguage,
      };
      return buildMessageClassXml(params);
    }
    case 'FUGR':
      // Function group create envelope. POSTed to /sap/bc/adt/functions/groups
      // with Content-Type: application/vnd.sap.adt.functions.groups.v3+xml.
      // Verified live on a4h S/4HANA 2023 (issue #250).
      return `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${escapeXmlAttr(description)}" adtcore:language="${masterLanguage}" adtcore:name="${escapeXmlAttr(name)}" adtcore:type="FUGR/F" adtcore:masterLanguage="${masterLanguage}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</group:abapFunctionGroup>`;
    case 'FUNC': {
      // Function module create envelope. POSTed to
      // /sap/bc/adt/functions/groups/{group_lc}/fmodules with
      // Content-Type: application/vnd.sap.adt.functions.fmodules+xml.
      // No <adtcore:packageRef> — FM inherits package from the parent FUGR.
      // adtcore:uri must be lowercase (verified live on a4h).
      const group = String(properties?.group ?? '').trim();
      if (!group) {
        throw new Error(
          'FUNC create requires "group" property — pass it via SAPWrite args (the parent function group must already exist).',
        );
      }
      const groupLc = encodeURIComponent(group.toLowerCase());
      return `<?xml version="1.0" encoding="UTF-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${escapeXmlAttr(description)}" adtcore:name="${escapeXmlAttr(name)}" adtcore:type="FUGR/FF">
  <adtcore:containerRef adtcore:name="${escapeXmlAttr(group)}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/${groupLc}"/>
</fmodule:abapFunctionModule>`;
    }
    default:
      // Fallback — generic objectReferences using the correct URL for the type
      return `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrlForType(type, name))}" adtcore:type="${escapeXmlAttr(type)}" adtcore:name="${escapeXmlAttr(name)}" adtcore:packageName="${escapeXmlAttr(pkg)}"/>
</adtcore:objectReferences>`;
  }
}

/**
 * Strip SAPGUI-style function-module parameter comment blocks from an FM source body.
 *
 * SAP rejects PUT-to-source/main with parameter comment blocks (verified live on a4h
 * S/4HANA 2023 — issue #250):
 *   HTTP 400 / com.sap.adt.sedi / ExceptionResourceScanDuringSaveFailure
 *   "Parameter comment blocks are not allowed" (T100KEY FUNC_ADT028)
 *
 * The signature is metadata, not source. LLMs frequently emit the SAPGUI block out
 * of muscle memory (every released FM ships with one). This helper strips lines whose
 * first non-whitespace tokens are `*"` so the PUT succeeds, and reports back whether
 * stripping occurred so the caller can append a warning to the response.
 *
 * Only `*"…` lines are stripped — single `*` ABAP comments and inline `"` comments
 * are preserved. Exported for unit tests.
 */
export function stripFmParamCommentBlock(source: string): { source: string; wasStripped: boolean } {
  const lines = source.split('\n');
  const kept = lines.filter((line) => !/^\s*\*"/.test(line));
  return { source: kept.join('\n'), wasStripped: kept.length !== lines.length };
}

// ─── SAPWrite Handler ────────────────────────────────────────────────

/**
 * Single-object actions whose top-level `name` is an SAP object name and must be
 * uppercase (TADIR convention). `batch_create` is excluded — its names live in
 * the `objects[]` items and are validated per item in the batch_create branch.
 */
export const NAME_CASE_GUARD_ACTIONS = new Set(['create', 'update', 'edit_method', 'delete']);

/**
 * Enforce the `allowedPackages` ceiling for an EXISTING object addressed by its
 * ADT object URL. Resolves the object's REAL package from ADT metadata and gates
 * it via `checkPackage`. Fail-closed: if the package can't be determined, refuse
 * the operation rather than passing the gate. No-op (and no HTTP round-trip) when
 * no package restrictions are configured.
 *
 * Shared by every mutating operation that targets an existing object —
 * update/delete/surgery (via `enforcePackageForExistingObject`), activation, and
 * change_package — so they all honor the same package boundary against the
 * object's true package, never a caller-supplied package string.
 */
export async function enforceAllowedPackageForObjectUrl(
  client: AdtClient,
  objectUrl: string,
  label: string,
  accept?: string,
): Promise<string | undefined> {
  if (client.safety.allowedPackages.length === 0) return undefined;
  const pkg = await client.resolveObjectPackage(objectUrl, accept);
  if (!pkg) {
    throw new AdtSafetyError(
      `${label} blocked: ARC-1 could not determine the object's package from ADT metadata ` +
        `(no adtcore:packageRef/containerRef). Fail-closed because allowedPackages is restricted.`,
    );
  }
  await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
  return pkg;
}

/**
 * SAPWrite for server-driven objects (8.16+): create / update-source / delete via the generic AFF
 * blue:blueSource + JSON-source engine. Discovery-gated (clean 8.16 error otherwise), allowWrites-gated
 * (through the engine's checkOperation), and allowedPackages-gated against the REAL package
 * (create gates the caller-supplied package like every create; update/delete resolve the object's true
 * package under the blues Accept). The `source` param carries the AFF JSON — parse-validated before the
 * PUT; ABAP-specific pre-write steps (lint, RAP preflight, CDS guard) do not apply. Create leaves the
 * object inactive — callers follow with SAPActivate (never auto-activated).
 */
export async function handleServerDrivenObjectWrite(
  client: AdtClient,
  action: string,
  type: string,
  name: string,
  args: Record<string, unknown>,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  // Discovery gate — mirror handleSAPRead's server-driven branch.
  if (supportsServerDrivenObject(client.http, type) === false) {
    return errorResult(
      `SAPWrite type=${type} (server-driven object) requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ` +
        'This system does not expose this object type.',
    );
  }

  const transport = args.transport as string | undefined;
  const objUrl = serverDrivenObjectUrl(type, name);
  const blueAccept = serverDrivenBlueContentType(type);

  const invalidate = (): void => {
    cachingLayer?.invalidate(type, name, 'all');
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  };

  // SDO source is AFF JSON (not ABAP) — validate it parses before any PUT.
  const validateSource = (): { ok: true; json: string } | { ok: false; result: ToolResult } => {
    const src = String(args.source ?? '');
    try {
      JSON.parse(src);
    } catch {
      return {
        ok: false,
        result: errorResult(
          `SAPWrite ${action} for ${type} ${name}: "source" must be valid AFF JSON ` +
            '(e.g. {"formatVersion":"1","header":{"description":"…","originalLanguage":"en"}}).',
        ),
      };
    }
    return { ok: true, json: src };
  };

  const hasSourceArg = typeof args.source === 'string' && args.source.trim() !== '';

  switch (action) {
    case 'create': {
      const pkg = String(args.package ?? '$TMP');
      await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
      const description = String(args.description ?? name);
      await createServerDrivenObject(client.http, client.safety, type, name, {
        package: pkg,
        description,
        transport,
      });
      let wroteSource = false;
      if (hasSourceArg) {
        const v = validateSource();
        if (!v.ok) return v.result;
        await updateServerDrivenObjectSource(client.http, client.safety, type, name, v.json, { transport });
        wroteSource = true;
      }
      invalidate();
      return textResult(
        `Created ${type} ${name} in package ${pkg}${wroteSource ? ' and wrote AFF JSON source' : ''}.\n` +
          `Next step: SAPActivate(type="${type}", name="${name}").`,
      );
    }
    case 'update': {
      if (!hasSourceArg) {
        return errorResult(`SAPWrite update for ${type} ${name} requires "source" (the AFF JSON body).`);
      }
      const v = validateSource();
      if (!v.ok) return v.result;
      await enforceAllowedPackageForObjectUrl(client, objUrl, `Operations on ${type} '${name}'`, blueAccept);
      await updateServerDrivenObjectSource(client.http, client.safety, type, name, v.json, { transport });
      invalidate();
      return textResult(`Updated source of ${type} ${name}.\nNext step: SAPActivate(type="${type}", name="${name}").`);
    }
    case 'delete': {
      await enforceAllowedPackageForObjectUrl(client, objUrl, `Operations on ${type} '${name}'`, blueAccept);
      await deleteServerDrivenObject(client.http, client.safety, type, name, { transport });
      invalidate();
      return textResult(`Deleted ${type} ${name}.`);
    }
    default:
      return errorResult(
        `Action "${action}" is not supported for server-driven object type ${type}. ` +
          'Supported: create, update, delete (source is AFF JSON) — then SAPActivate to activate.',
      );
  }
}

/** Pre-write lint check result */
export interface PreWriteLintResult {
  /** Whether the write was blocked by lint errors */
  blocked: boolean;
  /** Error result to return if blocked */
  result?: ToolResult;
  /** Warning text to append to success message */
  warnings?: string;
}

/** Pre-write RAP preflight check result */
interface PreWriteRapPreflightResult {
  /** Whether the write was blocked by RAP preflight errors */
  blocked: boolean;
  /** Error result to return if blocked */
  result?: ToolResult;
  /** Warning text to append to success message */
  warnings?: string;
}

/**
 * Run deterministic RAP preflight checks for non-ABAP RAP artifact types.
 *
 * Unlike lint, this check is intentionally narrow and rule-based. It focuses on
 * known activation churn patterns (TABL curr/quan semantics, BDEF enum/header
 * misuse, DDLX scope/duplicate annotations) and can cover types that offline
 * abaplint does not parse well.
 */
export function runRapPreflightValidation(
  source: string,
  type: string,
  name: string,
  features: ResolvedFeatures | undefined,
  configSystemType: ServerConfig['systemType'],
  perCallOverride?: boolean,
): PreWriteRapPreflightResult {
  const enabled = perCallOverride ?? true;
  if (!enabled || !source) {
    return { blocked: false };
  }

  const systemType = features?.systemType ?? (configSystemType !== 'auto' ? configSystemType : undefined);
  // Canonicalize so validateRapSource's 'TABL' case matches TABL/DT and TABL/DS.
  const result = validateRapSource(canonicalTablType(type), source, {
    systemType,
    abapRelease: features?.abapRelease,
  });

  if (result.errors.length > 0) {
    const details = formatRapPreflightFindings(result.errors);
    return {
      blocked: true,
      result: errorResult(
        `RAP preflight validation failed for ${type} ${name}. Fix these issues before writing:\n${details}\n\n` +
          'Set preflightBeforeWrite=false only when you intentionally need to bypass these checks.',
      ),
    };
  }

  if (result.warnings.length > 0) {
    return {
      blocked: false,
      warnings: `RAP preflight warnings:\n${formatRapPreflightFindings(result.warnings)}`,
    };
  }

  return { blocked: false };
}

export function mergePreWriteWarnings(...warnings: Array<string | undefined>): string | undefined {
  const parts = warnings.filter((w): w is string => Boolean(w));
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/**
 * Run pre-write lint validation on source code.
 *
 * This is a "lint-before-lock" optimization (pattern from vibing-steampunk):
 * by validating locally before acquiring the SAP object lock, we avoid
 * holding locks on objects that would fail validation anyway.
 *
 * Only runs a strict subset of correctness rules (parser_error, cloud_types, etc.)
 * — not style/formatting rules. This prevents false rejections from opinionated
 * style checks while catching genuine errors that would fail server-side anyway.
 *
 * If lint itself throws (e.g., abaplint bug on unusual syntax), we don't block
 * the write — we let the SAP server-side syntax check handle it instead.
 */
export function runPreWriteLint(
  source: string,
  type: string,
  name: string,
  config: ServerConfig,
  perCallOverride?: boolean,
): PreWriteLintResult {
  // Per-call override takes precedence over server config
  const enabled = perCallOverride ?? config.lintBeforeWrite;
  if (!enabled || !source) {
    return { blocked: false };
  }

  // abaplint supports ABAP source (PROG/CLAS/INTF/INCL) and CDS views (DDLS) via
  // its CDS parser. DDLS lint catches syntax errors (cds_parser_error) like missing commas,
  // wrong keywords, and invalid DDL constructs. BDEF/SRVD/SRVB/DDLX are silently ignored
  // by abaplint (no parser for those types — garbage passes without errors). TABL (define
  // table syntax) is not supported by the CDS parser and produces false cds_parser_error.
  // For unsupported types, SAP server-side compilation handles validation.
  //
  // FUNC is intentionally excluded: abaplint's FM-source parser does not understand
  // source-based signatures (`FUNCTION X\n  IMPORTING …\n.`) and emits a structural
  // parser_error that blocks the write. Issue #252 made this visible — once we
  // started emitting real signatures from structured `parameters`, every FUNC PUT
  // hit the lint gate. Pre-#252 lint coverage was effectively trivial (only
  // signature-less FUNCTION/ENDFUNCTION stubs passed). Validation falls back to
  // SAP's server-side syntax check (opt-in via `SAP_CHECK_BEFORE_WRITE`) and the
  // activate step.
  const LINTABLE_TYPES = new Set(['PROG', 'CLAS', 'INTF', 'INCL', 'DDLS']);
  if (!LINTABLE_TYPES.has(type)) {
    return { blocked: false };
  }

  try {
    let filename = detectFilename(source, name);
    if (type === 'INCL' && filename.endsWith('.clas.abap')) {
      // ABAP includes are often source fragments (FORM/MODULE/DATA...) without a REPORT/CLASS header.
      // Lint them as program-style source; treating the fallback as a class rejects valid include fragments.
      filename = `${name.toLowerCase()}.prog.abap`;
    }
    // Reuse the single systemType/abapRelease/configFile resolution (avoids drift with SAPLint's
    // own config — a release-ceiling fix applied to one copy only would split lint behavior).
    const configOptions = buildLintConfigOptions(config);
    const result = validateBeforeWrite(source, filename, configOptions);

    if (!result.pass) {
      const errorLines = result.errors.map((e) => `  Line ${e.line}: [${e.rule}] ${e.message}`).join('\n');
      return {
        blocked: true,
        result: errorResult(
          `Pre-write lint check failed for ${type} ${name}. Fix these errors before writing:\n${errorLines}\n\n` +
            'Use SAPLint action="lint_and_fix" to auto-fix, or disable with --lint-before-write=false.',
        ),
      };
    }

    if (result.warnings.length > 0) {
      const warningLines = result.warnings.map((w) => `  Line ${w.line}: [${w.rule}] ${w.message}`).join('\n');
      return {
        blocked: false,
        warnings: `Lint warnings:\n${warningLines}`,
      };
    }

    return { blocked: false };
  } catch {
    // If lint itself fails, don't block the write
    return { blocked: false };
  }
}

/** Types that carry source code that SAP's /checkruns endpoint can meaningfully compile.
 *  Metadata-write types (DOMA/DTEL/TABL/MSAG/DEVC/SKTD) have no /source/main artifact. */
const SYNTAX_CHECKABLE_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
]);

/** Pre-write SAP server-side syntax check via /checkruns with inline <chkrun:content>.
 *  Sends the proposed source to SAP's compiler without writing. Surfaces errors AND
 *  warnings as informational text appended to the write's success message — never
 *  blocks the write. Rationale: multi-file edits have inter-object dependencies, so
 *  intermediate writes legitimately trip compile errors that resolve once the whole
 *  sequence lands. Real blocking is deferred to SAPActivate, which runs after all
 *  dependencies are in place. Best-effort: network/endpoint failures return ''. */
export async function runPreWriteSyntaxCheck(
  client: AdtClient,
  type: string,
  source: string,
  objectUrl: string,
  config: ServerConfig,
  perCallOverride?: boolean,
): Promise<string> {
  const enabled = perCallOverride ?? config.checkBeforeWrite;
  if (!enabled || !source) return '';
  if (!SYNTAX_CHECKABLE_TYPES.has(type.toUpperCase())) return '';

  try {
    const result = await syntaxCheck(client.http, client.safety, objectUrl, { content: source, version: 'active' });
    if (result.messages.length === 0) return '';

    const errors = result.messages.filter((m) => m.severity === 'error');
    const warnings = result.messages.filter((m) => m.severity === 'warning');
    const parts: string[] = [];

    if (errors.length > 0) {
      const lines = errors.map((m) => `  Line ${m.line || '?'}${m.column ? `:${m.column}` : ''}: ${m.text}`).join('\n');
      parts.push(
        `Server syntax check errors (source was still written — activate to confirm whether these resolve once dependencies are in place):\n${lines}`,
      );
    }
    if (warnings.length > 0) {
      const lines = warnings.map((m) => `  Line ${m.line || '?'}: ${m.text}`).join('\n');
      parts.push(`Server syntax check warnings:\n${lines}`);
    }
    return parts.join('\n\n');
  } catch {
    // Best-effort: never let a failing pre-check fail the write.
    return '';
  }
}

// ─── Post-save syntax check ───
const DDIC_POST_SAVE_CHECK_TYPES = new Set(['TABL', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'SRVB', 'DDLX']);

/** Run a syntax check on the inactive version and format the errors for appending to an
 *  error message. Returns '' on any failure or when no errors are reported. */
export async function inactiveSyntaxDiagnostic(client: AdtClient, type: string, name: string): Promise<string> {
  try {
    const checkResult = await syntaxCheck(client.http, client.safety, objectUrlForType(type, name), {
      version: 'inactive',
    });
    if (!checkResult.hasErrors) return '';

    const errors = checkResult.messages.filter((msg) => msg.severity === 'error');
    if (errors.length === 0) return '';

    const lines = errors.map((msg) => {
      const prefix = msg.line ? `[line ${msg.line}] ` : '';
      const suffix = msg.uri ? ` (${msg.uri})` : '';
      return `- ${prefix}${msg.text}${suffix}`;
    });

    return `\nServer syntax check (inactive):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

export async function tryPostSaveSyntaxCheck(client: AdtClient, type: string, name: string): Promise<string> {
  if (!DDIC_POST_SAVE_CHECK_TYPES.has(canonicalTablType(type.toUpperCase()))) return '';
  return inactiveSyntaxDiagnostic(client, type, name);
}

// Stable hint surfaced when ARC-1 refuses a TABL/DT write because the connected system does not
// expose /sap/bc/adt/ddic/tables/. Shared by the discovery gate (write.ts prologue) and batch create.
export const TABL_DT_WRITE_UNAVAILABLE_HINT =
  'Transparent table writes via ADT REST are not available on this system ' +
  '(/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC ' +
  'structures endpoint only; the table editor was added in NW 7.52). ' +
  'Use SE11 in SAPGUI, or connect ARC-1 to an SAP_BASIS ≥ 7.52 system. ' +
  'Writing the source via /sap/bc/adt/ddic/structures/ would silently flip ' +
  'DD02L-TABCLASS to INTTAB and corrupt the table.';
