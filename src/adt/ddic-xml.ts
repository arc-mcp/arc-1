/**
 * XML builders for DDIC metadata objects (DOMA, DTEL, MSAG).
 *
 * Unlike source-based objects, these ADT object types are fully defined by
 * structured XML payloads on create/update.
 */

import { escapeXmlAttr, parseXml } from './xml-parser.js';

export interface DomainFixedValue {
  low: string;
  high?: string;
  description?: string;
}

export interface DomainCreateParams {
  name: string;
  description: string;
  package: string;
  dataType: string;
  length: number | string;
  decimals?: number | string;
  outputLength?: number | string;
  conversionExit?: string;
  signExists?: boolean;
  lowercase?: boolean;
  fixedValues?: DomainFixedValue[];
  valueTable?: string;
  /** ADT master/original language (2-char, e.g. "DE"). Defaults to "EN" when unset. */
  language?: string;
  /** ADT "person responsible" (logon user). Defaults to "DEVELOPER" when unset. */
  responsible?: string;
}

export interface DataElementCreateParams {
  name: string;
  description: string;
  package: string;
  typeKind?: 'domain' | 'predefinedAbapType';
  typeName?: string;
  domainName?: string;
  dataType?: string;
  length?: number | string;
  decimals?: number | string;
  shortLabel?: string;
  mediumLabel?: string;
  longLabel?: string;
  headingLabel?: string;
  searchHelp?: string;
  searchHelpParameter?: string;
  setGetParameter?: string;
  defaultComponentName?: string;
  changeDocument?: boolean;
  /** ADT master/original language (2-char, e.g. "DE"). Defaults to "EN" when unset. */
  language?: string;
  /** ADT "person responsible" (logon user). Defaults to "DEVELOPER" when unset. */
  responsible?: string;
}

export interface PackageCreateParams {
  name: string;
  description: string;
  superPackage?: string;
  softwareComponent?: string;
  transportLayer?: string;
  packageType?: 'development' | 'structure' | 'main';
  /**
   * Whether the package records object changes in transport requests
   * (`pak:recordChanges`, backend KORRFLAG). When omitted, ARC-1 infers it
   * from transportability metadata and keeps literal LOCAL packages off.
   */
  recordChanges?: boolean;
  /** ADT "person responsible" (logon user). Defaults to "DEVELOPER" when unset. */
  responsible?: string;
}

export interface ServiceBindingCreateParams {
  name: string;
  description: string;
  package: string;
  serviceDefinition: string;
  bindingType?: string;
  category?: '0' | '1';
  version?: string;
  odataVersion?: string;
  /** ADT master/original language (2-char, e.g. "DE"). Defaults to "EN" when unset. */
  language?: string;
  /** ADT "person responsible" (logon user). Defaults to "DEVELOPER" when unset. */
  responsible?: string;
}

/**
 * Normalize LLM-friendly binding type strings into SAP ADT values.
 *
 * SAP ADT expects:
 *   - `srvb:type`     = "ODATA" (always)
 *   - `srvb:version`  = "V2" | "V4" (OData protocol version on <srvb:binding>)
 *   - `srvb:category` = "0" (UI) | "1" (Web API)
 *
 * LLMs commonly send human-readable values like "ODataV4-UI", "ODATA_V2_WEB_API",
 * "OData V4 - Web API", etc. This function parses them into the correct triple.
 */
export function normalizeSrvbBindingType(input?: string): {
  type: string;
  odataVersion: string;
  category?: '0' | '1';
} {
  if (!input?.trim()) return { type: 'ODATA', odataVersion: 'V2' };

  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

  // Extract OData version: look for V4 or V2 in the string
  let odataVersion = 'V2'; // default
  if (normalized.includes('V4')) odataVersion = 'V4';
  else if (normalized.includes('V2')) odataVersion = 'V2';

  // Extract category hint from the string
  let category: '0' | '1' | undefined;
  if (normalized.includes('WEBAPI') || normalized.includes('API')) category = '1';
  else if (normalized.includes('UI')) category = '0';

  return { type: 'ODATA', odataVersion, category };
}

const DTEL_MAX_LABEL_LENGTHS = {
  short: 10,
  medium: 20,
  long: 40,
  heading: 55,
} as const;

/**
 * Normalize an ADT master/original language to the 2-char upper-case form ADT
 * expects (e.g. "de" → "DE"). Defaults to "EN" when unset or blank, preserving
 * the legacy hard-coded behavior for callers that pass no language.
 *
 * The created object's master language must match the developer's logon language
 * (SAP doc ABENORIGINAL_LANGU_GUIDL; SAP Note 727896). ARC-1 already sends that
 * as the `sap-language` URL param; this keeps the create-XML body consistent so
 * DDIC texts (DD04T/DD01T) are filed under the correct language. See issue #343
 * and docs/research/2026-06-04-issue-343-masterlanguage-on-create.md.
 */
export function normalizeAdtLanguage(language?: string): string {
  return (language ?? '').trim().toUpperCase() || 'EN';
}

/**
 * Normalize the ADT "person responsible" to the form SAP expects: trimmed and
 * upper-case (on-prem `USR02-BNAME` is upper-case). Defaults to "DEVELOPER"
 * only as a last-resort fallback when no user is configured, preserving the
 * legacy hard-coded value for callers that pass nothing. In practice
 * `config.username` is empty only under cookie-file or OAuth service-key auth
 * (basic auth and principal propagation both supply a real user), so the
 * "DEVELOPER" fallback realistically applies only in those two modes.
 *
 * `adtcore:responsible` must name a user that exists on the target system. The
 * historical hard-coded literal "DEVELOPER" only exists on SAP's own demo
 * systems; on a real system the create fails with
 * `HTTP 400 [?/049] "Enter a valid user, not DEVELOPER, as the person responsible"`.
 * Threading the connection's logon user (ARC-1 passes it as `config.username`)
 * fixes that. Mirrors the `normalizeAdtLanguage` / issue #343 master-language pattern.
 */
export function normalizeAdtResponsible(responsible?: string): string {
  const r = (responsible ?? '').trim();
  if (!r) return 'DEVELOPER';
  // Cloud (BTP) users are email-style and case-sensitive; classic SAP users are upper-case.
  return r.includes('@') ? r : r.toUpperCase();
}

function formatLength(value: number | string | undefined, width: number): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    return ''.padStart(width, '0');
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    return raw.padStart(width, '0');
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return String(Math.floor(parsed)).padStart(width, '0');
  }
  return ''.padStart(width, '0');
}

function formatLabelLength(label: string, maxLength: number): string {
  if (!label) return String(maxLength).padStart(2, '0');
  return String(Math.min(label.length, maxLength)).padStart(2, '0');
}

function boolToXml(value: boolean | undefined): string {
  return value ? 'true' : 'false';
}

export function buildDomainXml(params: DomainCreateParams): string {
  const masterLanguage = normalizeAdtLanguage(params.language);
  const responsible = normalizeAdtResponsible(params.responsible);
  const fixedValues = params.fixedValues ?? [];
  const valueTable = params.valueTable?.trim();
  const fixValuesXml =
    fixedValues.length === 0
      ? '      <doma:fixValues/>'
      : [
          '      <doma:fixValues>',
          ...fixedValues.map(
            (value, index) => `        <doma:fixValue>
          <doma:position>${String(index + 1).padStart(4, '0')}</doma:position>
          <doma:low>${escapeXmlAttr(value.low)}</doma:low>
          <doma:high>${escapeXmlAttr(value.high ?? '')}</doma:high>
          <doma:text>${escapeXmlAttr(value.description ?? '')}</doma:text>
        </doma:fixValue>`,
          ),
          '      </doma:fixValues>',
        ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<doma:domain xmlns:doma="http://www.sap.com/dictionary/domain"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:description="${escapeXmlAttr(params.description)}"
             adtcore:name="${escapeXmlAttr(params.name)}"
             adtcore:type="DOMA/DD"
             adtcore:masterLanguage="${masterLanguage}"
             adtcore:masterSystem="H00"
             adtcore:responsible="${escapeXmlAttr(responsible)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <doma:content>
    <doma:typeInformation>
      <doma:datatype>${escapeXmlAttr(params.dataType)}</doma:datatype>
      <doma:length>${formatLength(params.length, 6)}</doma:length>
      <doma:decimals>${formatLength(params.decimals, 6)}</doma:decimals>
    </doma:typeInformation>
    <doma:outputInformation>
      <doma:length>${formatLength(params.outputLength ?? params.length, 6)}</doma:length>
      <doma:style>00</doma:style>
      <doma:conversionExit>${escapeXmlAttr(params.conversionExit ?? '')}</doma:conversionExit>
      <doma:signExists>${boolToXml(params.signExists)}</doma:signExists>
      <doma:lowercase>${boolToXml(params.lowercase)}</doma:lowercase>
      <doma:ampmFormat>false</doma:ampmFormat>
    </doma:outputInformation>
    <doma:valueInformation>
${valueTable ? `      <doma:valueTableRef adtcore:type="TABL/DT" adtcore:name="${escapeXmlAttr(valueTable)}"/>` : ''}
      <doma:appendExists>false</doma:appendExists>
${fixValuesXml}
    </doma:valueInformation>
  </doma:content>
</doma:domain>`;
}

/** ABAP built-in types accepted as a table-type row (typeKind=predefinedAbapType). */
const TTYP_BUILTIN_ROW_TYPES = new Set([
  'STRING',
  'XSTRING',
  'I',
  'INT8',
  'F',
  'P',
  'D',
  'T',
  'C',
  'N',
  'X',
  'B',
  'S',
  'DECFLOAT16',
  'DECFLOAT34',
  'UTCLONG',
]);

const TTYP_ROW_TYPE_NAME_RE = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/;

export interface TableTypeCreateParams {
  name: string;
  description: string;
  package: string;
  /** The row type: a built-in ABAP type (STRING, I, …) or a DDIC structure/type name. */
  rowType: string;
  /** Defaults to "builtin" for a known ABAP type, else "structure". */
  rowTypeKind?: 'builtin' | 'structure';
  language?: string;
  responsible?: string;
}

/**
 * Build the create XML for a DDIC table type (TTYP). Live-verified on a4h 758 + 816 (201): the
 * `<ttyp:rowType>` children are XSD-required IN ORDER — typeKind, typeName, builtInType, rangeType.
 * Built-in row → predefinedAbapType + builtInType.dataType=<builtin>; structure row → dictionaryType +
 * typeName=<struct> + builtInType.dataType=STRU. Standard table, non-unique standard key (advanced
 * options not yet exposed). See docs/research/abap-types/types/ttyp.md.
 */
export function buildTableTypeXml(params: TableTypeCreateParams): string {
  const masterLanguage = normalizeAdtLanguage(params.language);
  const responsible = normalizeAdtResponsible(params.responsible);
  const rowType = params.rowType.trim().toUpperCase();
  // TTYP_BUILTIN_ROW_TYPES is a best-effort heuristic for AUTO-DETECTION ONLY (when the caller omits
  // rowTypeKind). It must not gate an EXPLICIT rowTypeKind: SAP adds built-in types over releases
  // (e.g. UTCLONG in 7.54), so allow-listing them and throwing on a miss would reject a valid type
  // ARC-1 simply hasn't enumerated. When rowTypeKind is given we trust it and let SAP be the
  // authority (it rejects a genuinely wrong type). See the UTCLONG case in docs/research/abap-types/types/ttyp.md.
  const kind = params.rowTypeKind ?? (TTYP_BUILTIN_ROW_TYPES.has(rowType) ? 'builtin' : 'structure');
  if (!TTYP_ROW_TYPE_NAME_RE.test(rowType)) {
    throw new Error(
      `Invalid TTYP rowType "${params.rowType}". Use a built-in ABAP type or a DDIC type name such as BAPIRET2 or /NS/TYPE.`,
    );
  }
  // A row type whose NAME is a known built-in cannot be a DDIC structure (built-in names are reserved),
  // so an explicit rowTypeKind="structure" there is a caller mistake we can catch cheaply. The inverse
  // (rowTypeKind="builtin" for an unlisted name) is NOT checked — see the heuristic note above.
  if (kind === 'structure' && TTYP_BUILTIN_ROW_TYPES.has(rowType)) {
    throw new Error(`TTYP rowType "${rowType}" is a built-in ABAP row type; omit rowTypeKind or use "builtin".`);
  }

  const rowTypeXml =
    kind === 'builtin'
      ? `<ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType><ttyp:dataType>${escapeXmlAttr(rowType)}</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/>`
      : `<ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>${escapeXmlAttr(rowType)}</ttyp:typeName><ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType><ttyp:rangeType/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype"
                xmlns:adtcore="http://www.sap.com/adt/core"
                adtcore:description="${escapeXmlAttr(params.description)}"
                adtcore:name="${escapeXmlAttr(params.name)}"
                adtcore:type="TTYP/DA"
                adtcore:masterLanguage="${masterLanguage}"
                adtcore:responsible="${escapeXmlAttr(responsible)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <ttyp:rowType>${rowTypeXml}</ttyp:rowType>
  <ttyp:initialRowCount>00000</ttyp:initialRowCount>
  <ttyp:accessType>standard</ttyp:accessType>
  <ttyp:primaryKey ttyp:isVisible="true" ttyp:isEditable="true"><ttyp:definition>standard</ttyp:definition><ttyp:kind>nonUnique</ttyp:kind><ttyp:components ttyp:isVisible="false"/><ttyp:alias/></ttyp:primaryKey>
  <ttyp:secondaryKeys ttyp:isVisible="true" ttyp:isEditable="true"><ttyp:allowed>notSpecified</ttyp:allowed></ttyp:secondaryKeys>
</ttyp:tableType>`;
}

export interface TableTypeInfo {
  name: string;
  description: string;
  rowType: string;
  rowTypeKind: string;
  accessType: string;
  keyKind: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Parse the key fields of a table-type read response (`<ttyp:tableType>`). */
export function parseTableType(xml: string): TableTypeInfo {
  const parsed = parseXml(xml);
  const tt = asRecord(parsed.tableType);
  if (!tt) {
    throw new Error('Invalid TTYP response: expected <ttyp:tableType>.');
  }
  const adtType = String(tt['@_type'] ?? '').trim();
  if (adtType && adtType !== 'TTYP/DA') {
    throw new Error(`Invalid TTYP response: expected adtcore:type="TTYP/DA", got "${adtType}".`);
  }
  const rowTypeNode = asRecord(tt.rowType);
  if (!rowTypeNode) {
    throw new Error('Invalid TTYP response: missing <ttyp:rowType>.');
  }
  const builtIn = asRecord(rowTypeNode.builtInType) ?? {};
  const pk = asRecord(tt.primaryKey) ?? {};
  const typeName = String(rowTypeNode.typeName ?? '').trim();
  const builtInDataType = String(builtIn.dataType ?? '').trim();
  const typeKind = String(rowTypeNode.typeKind ?? '').trim();
  if (!typeKind) {
    throw new Error('Invalid TTYP response: missing row type kind.');
  }
  // NOTE: we intentionally do NOT allow-list typeKind values. A read must stay permissive — SAP has
  // several row-type kinds (dictionaryType, predefinedAbapType, refTo*, rangeType*, and possibly more
  // in newer releases); 264 real table types across a4h 758+816 only exercised four. Hard-failing a
  // read on an unlisted-but-valid kind is worse than returning it verbatim, and genuine junk/error XML
  // is already caught above by the missing <ttyp:tableType>/<ttyp:rowType> checks.
  const rowType = typeName || builtInDataType;
  if (!rowType) {
    throw new Error('Invalid TTYP response: missing row type name.');
  }
  return {
    name: String(tt['@_name'] ?? ''),
    description: String(tt['@_description'] ?? ''),
    rowType,
    rowTypeKind: typeKind,
    accessType: String(tt.accessType ?? ''),
    keyKind: String(pk.kind ?? ''),
  };
}

export interface MessageClassMessage {
  number: string;
  shortText: string;
}

export interface MessageClassCreateParams {
  name: string;
  description: string;
  package: string;
  messages?: MessageClassMessage[];
  /** Maintenance + master language (e.g. "EN", "DE"), emitted as BOTH
   *  adtcore:language and adtcore:masterLanguage — matching the server's own
   *  GET serialization. Live-verified on a4h (S/4HANA 2023, 7.58): the MSAG
   *  handler keys the T100 text rows by the BODY adtcore:language; without it
   *  every message is stored under a BLANK language key (SPRSL = space), so
   *  MESSAGE ... INTO never resolves the text at runtime and ATC/SLIN flags
   *  every message number as missing. The sap-language URL param and
   *  adtcore:masterLanguage alone do NOT prevent this. Defaults to "EN". */
  language?: string;
}

export function buildMessageClassXml(params: MessageClassCreateParams): string {
  const masterLanguage = normalizeAdtLanguage(params.language);
  const messages = params.messages ?? [];
  const messagesXml =
    messages.length === 0
      ? ''
      : '\n' +
        messages
          .map(
            (m) =>
              `  <mc:messages mc:msgno="${escapeXmlAttr(m.number)}" mc:msgtext="${escapeXmlAttr(m.shortText)}" mc:selfexplainatory="true" mc:documented="false"/>`,
          )
          .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXmlAttr(params.description)}"
                 adtcore:name="${escapeXmlAttr(params.name)}"
                 adtcore:language="${masterLanguage}"
                 adtcore:masterLanguage="${masterLanguage}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>${messagesXml}
</mc:messageClass>`;
}

export function buildDataElementXml(params: DataElementCreateParams): string {
  const masterLanguage = normalizeAdtLanguage(params.language);
  const responsible = normalizeAdtResponsible(params.responsible);
  const typeKind = params.typeKind ?? (params.dataType ? 'predefinedAbapType' : 'domain');
  const shortLabel = params.shortLabel ?? '';
  const mediumLabel = params.mediumLabel ?? '';
  const longLabel = params.longLabel ?? '';
  const headingLabel = params.headingLabel ?? '';
  const typeName = params.typeName ?? params.domainName ?? '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<blue:wbobj xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel"
            xmlns:adtcore="http://www.sap.com/adt/core"
            adtcore:description="${escapeXmlAttr(params.description)}"
            adtcore:name="${escapeXmlAttr(params.name)}"
            adtcore:type="DTEL/DE"
            adtcore:masterLanguage="${masterLanguage}"
            adtcore:masterSystem="H00"
            adtcore:responsible="${escapeXmlAttr(responsible)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <dtel:dataElement xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements">
    <dtel:typeKind>${escapeXmlAttr(typeKind)}</dtel:typeKind>
    <dtel:typeName>${escapeXmlAttr(typeName)}</dtel:typeName>
    <dtel:dataType>${escapeXmlAttr(params.dataType ?? '')}</dtel:dataType>
    <dtel:dataTypeLength>${formatLength(params.length, 6)}</dtel:dataTypeLength>
    <dtel:dataTypeDecimals>${formatLength(params.decimals, 6)}</dtel:dataTypeDecimals>
    <dtel:shortFieldLabel>${escapeXmlAttr(shortLabel)}</dtel:shortFieldLabel>
    <dtel:shortFieldLength>${formatLabelLength(shortLabel, DTEL_MAX_LABEL_LENGTHS.short)}</dtel:shortFieldLength>
    <dtel:shortFieldMaxLength>${String(DTEL_MAX_LABEL_LENGTHS.short).padStart(2, '0')}</dtel:shortFieldMaxLength>
    <dtel:mediumFieldLabel>${escapeXmlAttr(mediumLabel)}</dtel:mediumFieldLabel>
    <dtel:mediumFieldLength>${formatLabelLength(mediumLabel, DTEL_MAX_LABEL_LENGTHS.medium)}</dtel:mediumFieldLength>
    <dtel:mediumFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.medium}</dtel:mediumFieldMaxLength>
    <dtel:longFieldLabel>${escapeXmlAttr(longLabel)}</dtel:longFieldLabel>
    <dtel:longFieldLength>${formatLabelLength(longLabel, DTEL_MAX_LABEL_LENGTHS.long)}</dtel:longFieldLength>
    <dtel:longFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.long}</dtel:longFieldMaxLength>
    <dtel:headingFieldLabel>${escapeXmlAttr(headingLabel)}</dtel:headingFieldLabel>
    <dtel:headingFieldLength>${formatLabelLength(headingLabel, DTEL_MAX_LABEL_LENGTHS.heading)}</dtel:headingFieldLength>
    <dtel:headingFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.heading}</dtel:headingFieldMaxLength>
    <dtel:searchHelp>${escapeXmlAttr(params.searchHelp ?? '')}</dtel:searchHelp>
    <dtel:searchHelpParameter>${escapeXmlAttr(params.searchHelpParameter ?? '')}</dtel:searchHelpParameter>
    <dtel:setGetParameter>${escapeXmlAttr(params.setGetParameter ?? '')}</dtel:setGetParameter>
    <dtel:defaultComponentName>${escapeXmlAttr(params.defaultComponentName ?? '')}</dtel:defaultComponentName>
    <dtel:deactivateInputHistory>false</dtel:deactivateInputHistory>
    <dtel:changeDocument>${boolToXml(params.changeDocument)}</dtel:changeDocument>
    <dtel:leftToRightDirection>false</dtel:leftToRightDirection>
    <dtel:deactivateBIDIFiltering>false</dtel:deactivateBIDIFiltering>
  </dtel:dataElement>
</blue:wbobj>`;
}

export function buildPackageXml(params: PackageCreateParams): string {
  const packageType = params.packageType ?? 'development';
  const superPackage = params.superPackage ?? '';
  const softwareComponent = params.softwareComponent?.trim() || 'LOCAL';
  const transportLayer = params.transportLayer?.trim() ?? '';
  const normalizedSoftwareComponent = softwareComponent.toUpperCase();
  const isLocalSoftwareComponent = normalizedSoftwareComponent === 'LOCAL';
  const recordChanges = params.recordChanges ?? (!isLocalSoftwareComponent || transportLayer !== '');
  const responsible = normalizeAdtResponsible(params.responsible);

  return `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:description="${escapeXmlAttr(params.description)}"
             adtcore:name="${escapeXmlAttr(params.name)}"
             adtcore:type="DEVC/K"
             adtcore:version="active"
             adtcore:responsible="${escapeXmlAttr(responsible)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.name)}"/>
  <pak:attributes pak:packageType="${escapeXmlAttr(packageType)}" pak:recordChanges="${boolToXml(recordChanges)}"/>
  <pak:superPackage adtcore:name="${escapeXmlAttr(superPackage)}"/>
  <pak:applicationComponent/>
  <pak:transport>
    <pak:softwareComponent pak:name="${escapeXmlAttr(softwareComponent)}"/>
    <pak:transportLayer pak:name="${escapeXmlAttr(transportLayer)}"/>
  </pak:transport>
  <pak:translation/>
  <pak:useAccesses/>
  <pak:packageInterfaces/>
  <pak:subPackages/>
</pak:package>`;
}

export function buildServiceBindingXml(params: ServiceBindingCreateParams): string {
  const normalized = normalizeSrvbBindingType(params.bindingType);
  // Explicit category from params takes precedence, then hint from bindingType string, then default '0'
  const category = params.category ?? normalized.category ?? '0';
  // Explicit odataVersion from params takes precedence, then parsed from bindingType
  const odataVersion = params.odataVersion?.trim().toUpperCase() || normalized.odataVersion;
  const serviceVersion = params.version?.trim() || '0001';
  const masterLanguage = normalizeAdtLanguage(params.language);
  const responsible = normalizeAdtResponsible(params.responsible);

  return `<?xml version="1.0" encoding="UTF-8"?>
<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXmlAttr(params.description)}"
                     adtcore:name="${escapeXmlAttr(params.name)}"
                     adtcore:type="SRVB/SVB"
                     adtcore:language="${masterLanguage}"
                     adtcore:masterLanguage="${masterLanguage}"
                     adtcore:responsible="${escapeXmlAttr(responsible)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <srvb:services srvb:name="${escapeXmlAttr(params.name)}">
    <srvb:content srvb:version="${escapeXmlAttr(serviceVersion)}">
      <srvb:serviceDefinition adtcore:name="${escapeXmlAttr(params.serviceDefinition)}"/>
    </srvb:content>
  </srvb:services>
  <srvb:binding srvb:category="${category}" srvb:type="${escapeXmlAttr(normalized.type)}" srvb:version="${escapeXmlAttr(odataVersion)}">
    <srvb:implementation adtcore:name=""/>
  </srvb:binding>
</srvb:serviceBinding>`;
}

// ─── Knowledge Transfer Documents (SKTD) ─────────────────────────────
//
// KTD update requires the full <sktd:docu> XML envelope with the Markdown
// body base64-encoded inside <sktd:text>. PUTting raw text/plain silently
// no-ops on the server. The envelope carries metadata (responsible,
// masterLanguage, packageRef, refObject) that must be preserved from the
// current server-side version, so we fetch-modify-put.

/** Decode the Markdown body from a <sktd:docu> envelope returned by the ADT GET.
 *
 * A KTD may contain multiple `<sktd:element>` entries — one per documentable
 * element of the referenced object (e.g., one per CDS field). Each element has
 * an `<sktd:id>` and a Base64-encoded `<sktd:text>`. We extract all of them
 * and return a combined Markdown document with element headings.
 */
export function decodeKtdText(envelopeXml: string): string {
  // Extract all <sktd:element> blocks with their id and text
  const elementPattern = /<sktd:element[^>]*>[\s\S]*?<sktd:id>([^<]*)<\/sktd:id>[\s\S]*?<\/sktd:element>/g;
  const elements: Array<{ id: string; text: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(envelopeXml)) !== null) {
    const elementBlock = match[0];
    const id = match[1].trim();
    const textMatch = elementBlock.match(/<sktd:text[^>]*>([\s\S]*?)<\/sktd:text>/);
    const base64 = textMatch?.[1]?.trim() ?? '';
    let decoded = '';
    if (base64) {
      try {
        decoded = Buffer.from(base64, 'base64').toString('utf-8');
      } catch {
        decoded = '';
      }
    }
    if (decoded) {
      elements.push({ id, text: decoded });
    }
  }

  if (elements.length === 0) {
    // Fallback: try extracting a single <sktd:text> without element structure
    const singleMatch = envelopeXml.match(/<sktd:text[^>]*>([\s\S]*?)<\/sktd:text>/);
    if (!singleMatch) return '';
    const base64 = singleMatch[1].trim();
    if (!base64) return '';
    try {
      return Buffer.from(base64, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }

  // Single element: return just the text (most common case — root element doc)
  if (elements.length === 1) {
    return elements[0].text;
  }

  // Multiple elements: format as structured Markdown with element headings
  return elements.map((e) => `## ${e.id}\n\n${e.text}`).join('\n\n');
}

/**
 * Replace the <sktd:text> body of a <sktd:docu> envelope with base64(markdown),
 * preserving all other attributes and elements (responsible, packageRef, refObject, etc.).
 *
 * The returned XML is suitable for a PUT to the KTD object URL with
 * content-type `application/vnd.sap.adt.sktdv2+xml`.
 */
export function rewriteKtdText(envelopeXml: string, markdown: string): string {
  const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
  const textPattern = /(<sktd:text[^>]*>)([\s\S]*?)(<\/sktd:text>)/;
  if (textPattern.test(envelopeXml)) {
    return envelopeXml.replace(textPattern, `$1${base64}$3`);
  }
  // Self-closing form: <sktd:text ... /> (rare but possible on an empty KTD)
  const selfClosing = /<sktd:text([^>]*)\/>/;
  if (selfClosing.test(envelopeXml)) {
    return envelopeXml.replace(selfClosing, `<sktd:text$1>${base64}</sktd:text>`);
  }
  throw new Error('KTD envelope missing <sktd:text> element — cannot update documentation body.');
}
