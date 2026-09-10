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
  /** ADT "person responsible" (logon user). Omitted when it cannot be an on-prem user name (#636). */
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
  shortLength?: number | string;
  mediumLabel?: string;
  mediumLength?: number | string;
  longLabel?: string;
  longLength?: number | string;
  headingLabel?: string;
  headingLength?: number | string;
  searchHelp?: string;
  searchHelpParameter?: string;
  setGetParameter?: string;
  defaultComponentName?: string;
  /** Negative ADT flag: true disables SAP GUI input history for fields using this data element. */
  deactivateInputHistory?: boolean;
  changeDocument?: boolean;
  /** ADT master/original language (2-char, e.g. "DE"). Defaults to "EN" when unset. */
  language?: string;
  /** ADT "person responsible" (logon user). Omitted when it cannot be an on-prem user name (#636). */
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
  /** ADT "person responsible" (logon user). Omitted when it cannot be an on-prem user name (#636). */
  responsible?: string;
  /** BTP cloud create: nest under the structure superPackage, SC defaults to ZLOCAL, recordChanges=false,
   *  responsible passed verbatim (the internal ABAP user). Handler-set when systemType=btp. */
  cloud?: boolean;
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
  /** ADT "person responsible" (logon user). Omitted when it cannot be an on-prem user name (#636). */
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

export const DTEL_MAX_LABEL_LENGTHS = {
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

/** On-prem `adtcore:responsible` deserializes into `XUBNAME`, which is CHAR12. */
const XUBNAME_MAX_LENGTH = 12;

/**
 * Normalize the ADT "person responsible" to the form SAP expects: trimmed and upper-case
 * (on-prem `USR02-BNAME` is upper-case). Returns `''` when the value cannot be an on-prem user
 * name, and callers then OMIT the attribute entirely.
 *
 * Omission is the correct behavior, not a fallback: ADT assigns the logged-on user, which under
 * principal propagation is exactly the propagated one (live: create without the attribute returns
 * `adtcore:responsible="<logged-on user>"`). It is safe even for a value that would have been
 * valid, since a real user is still the logged-on user.
 *
 * Why the guard exists (#636): under BTP principal propagation to an on-prem system the principal
 * is an email, and anything over CHAR12 overflows the field — the create fails in the object's
 * simple transformation before anything is written (400, e.g. `CLASS_TRANSFORMATION`; on 7.50 the
 * clearer "Data loss occurred when converting …"). Live-verified across 11 create STs on
 * 7.50 / 758 / 816 — see docs/research/issues/636-onprem-pp-responsible-char12-overflow.md.
 *
 * Note the length is what breaks, not the `@` — `A@B.DE` creates fine — but an email is never a
 * useful on-prem responsible, so both are rejected. BTP is unaffected: `cloudifyCreateBody` strips
 * the attribute on the cloud path, and cloud package create uses `normalizeCloudResponsible`.
 */
export function normalizeAdtResponsible(responsible?: string): string {
  const r = (responsible ?? '').trim();
  if (!r || r.length > XUBNAME_MAX_LENGTH || r.includes('@')) return '';
  return r.toUpperCase();
}

/**
 * The ` adtcore:responsible="…"` attribute for inline interpolation into a create template, or
 * `''` when it must be omitted (see above). The leading space belongs to the attribute so an
 * omitted one leaves no stray whitespace behind.
 */
export function adtResponsibleAttr(responsible?: string): string {
  const user = normalizeAdtResponsible(responsible);
  return user ? ` adtcore:responsible="${escapeXmlAttr(user)}"` : '';
}

/**
 * Cloud package "responsible": must be a real internal ABAP user (XUBNAME) — an email or `DEVELOPER`
 * is rejected by the SPAK_ST_PACKAGES deserializer — so pass it verbatim, no fallback (the handler
 * resolves + validates it first).
 */
export function normalizeCloudResponsible(responsible?: string): string {
  return (responsible ?? '').trim();
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

function formatLabelLength(label: string, maxLength: number, explicitLength?: number | string): string {
  if (explicitLength !== undefined && explicitLength !== null && String(explicitLength).trim() !== '') {
    return formatLength(explicitLength, 2);
  }
  if (!label) return String(maxLength).padStart(2, '0');
  return String(Math.min(label.length, maxLength)).padStart(2, '0');
}

function boolToXml(value: boolean | undefined): string {
  return value ? 'true' : 'false';
}

export function buildDomainXml(params: DomainCreateParams): string {
  const masterLanguage = normalizeAdtLanguage(params.language);
  const responsibleAttr = adtResponsibleAttr(params.responsible);
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
             adtcore:masterSystem="H00"${responsibleAttr}>
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
  const responsibleAttr = adtResponsibleAttr(params.responsible);
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
                adtcore:masterLanguage="${masterLanguage}"${responsibleAttr}>
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
  const responsibleAttr = adtResponsibleAttr(params.responsible);
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
            adtcore:masterSystem="H00"${responsibleAttr}>
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <dtel:dataElement xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements">
    <dtel:typeKind>${escapeXmlAttr(typeKind)}</dtel:typeKind>
    <dtel:typeName>${escapeXmlAttr(typeName)}</dtel:typeName>
    <dtel:dataType>${escapeXmlAttr(params.dataType ?? '')}</dtel:dataType>
    <dtel:dataTypeLength>${formatLength(params.length, 6)}</dtel:dataTypeLength>
    <dtel:dataTypeDecimals>${formatLength(params.decimals, 6)}</dtel:dataTypeDecimals>
    <dtel:shortFieldLabel>${escapeXmlAttr(shortLabel)}</dtel:shortFieldLabel>
    <dtel:shortFieldLength>${formatLabelLength(shortLabel, DTEL_MAX_LABEL_LENGTHS.short, params.shortLength)}</dtel:shortFieldLength>
    <dtel:shortFieldMaxLength>${String(DTEL_MAX_LABEL_LENGTHS.short).padStart(2, '0')}</dtel:shortFieldMaxLength>
    <dtel:mediumFieldLabel>${escapeXmlAttr(mediumLabel)}</dtel:mediumFieldLabel>
    <dtel:mediumFieldLength>${formatLabelLength(mediumLabel, DTEL_MAX_LABEL_LENGTHS.medium, params.mediumLength)}</dtel:mediumFieldLength>
    <dtel:mediumFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.medium}</dtel:mediumFieldMaxLength>
    <dtel:longFieldLabel>${escapeXmlAttr(longLabel)}</dtel:longFieldLabel>
    <dtel:longFieldLength>${formatLabelLength(longLabel, DTEL_MAX_LABEL_LENGTHS.long, params.longLength)}</dtel:longFieldLength>
    <dtel:longFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.long}</dtel:longFieldMaxLength>
    <dtel:headingFieldLabel>${escapeXmlAttr(headingLabel)}</dtel:headingFieldLabel>
    <dtel:headingFieldLength>${formatLabelLength(headingLabel, DTEL_MAX_LABEL_LENGTHS.heading, params.headingLength)}</dtel:headingFieldLength>
    <dtel:headingFieldMaxLength>${DTEL_MAX_LABEL_LENGTHS.heading}</dtel:headingFieldMaxLength>
    <dtel:searchHelp>${escapeXmlAttr(params.searchHelp ?? '')}</dtel:searchHelp>
    <dtel:searchHelpParameter>${escapeXmlAttr(params.searchHelpParameter ?? '')}</dtel:searchHelpParameter>
    <dtel:setGetParameter>${escapeXmlAttr(params.setGetParameter ?? '')}</dtel:setGetParameter>
    <dtel:defaultComponentName>${escapeXmlAttr(params.defaultComponentName ?? '')}</dtel:defaultComponentName>
    <dtel:deactivateInputHistory>${boolToXml(params.deactivateInputHistory)}</dtel:deactivateInputHistory>
    <dtel:changeDocument>${boolToXml(params.changeDocument)}</dtel:changeDocument>
    <dtel:leftToRightDirection>false</dtel:leftToRightDirection>
    <dtel:deactivateBIDIFiltering>false</dtel:deactivateBIDIFiltering>
  </dtel:dataElement>
</blue:wbobj>`;
}

export function buildPackageXml(params: PackageCreateParams): string {
  const cloud = params.cloud === true;
  const packageType = params.packageType ?? 'development';
  const superPackage = params.superPackage ?? '';
  const softwareComponent = params.softwareComponent?.trim() || (cloud ? 'ZLOCAL' : 'LOCAL');
  const transportLayer = params.transportLayer?.trim() ?? '';
  const normalizedSoftwareComponent = softwareComponent.toUpperCase();
  const isLocalSoftwareComponent = normalizedSoftwareComponent === 'LOCAL';
  // Cloud local packages (e.g. under ZLOCAL) are non-transportable → recordChanges defaults false;
  // do NOT let the on-prem non-LOCAL heuristic flip it to true for the ZLOCAL cloud SC.
  const recordChanges = params.recordChanges ?? (cloud ? false : !isLocalSoftwareComponent || transportLayer !== '');
  // Cloud keeps its verbatim internal-user contract (the handler validates it first); on-prem goes
  // through the CHAR12 guard. Both carry the leading space — see adtResponsibleAttr.
  const responsibleAttr = cloud
    ? ` adtcore:responsible="${escapeXmlAttr(normalizeCloudResponsible(params.responsible))}"`
    : adtResponsibleAttr(params.responsible);

  return `<?xml version="1.0" encoding="UTF-8"?>
<pak:package xmlns:pak="http://www.sap.com/adt/packages"
             xmlns:adtcore="http://www.sap.com/adt/core"
             adtcore:description="${escapeXmlAttr(params.description)}"
             adtcore:name="${escapeXmlAttr(params.name)}"
             adtcore:type="DEVC/K"
             adtcore:version="active"${responsibleAttr}>
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
  const responsibleAttr = adtResponsibleAttr(params.responsible);

  return `<?xml version="1.0" encoding="UTF-8"?>
<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXmlAttr(params.description)}"
                     adtcore:name="${escapeXmlAttr(params.name)}"
                     adtcore:type="SRVB/SVB"
                     adtcore:language="${masterLanguage}"
                     adtcore:masterLanguage="${masterLanguage}"${responsibleAttr}>
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
export function decodeKtdText(envelopeXml: string, options: { routeSafe?: boolean } = {}): string {
  // Extract all <sktd:element> blocks with their id and text
  const elementPattern = /<sktd:element[^>]*>[\s\S]*?<sktd:id>([^<]*)<\/sktd:id>[\s\S]*?<\/sktd:element>/g;
  const elements: Array<{ id: string; text: string }> = [];

  for (const match of envelopeXml.matchAll(elementPattern)) {
    const text = decodeKtdElementText(match[0]);
    if (text) elements.push({ id: match[1].trim(), text });
  }

  if (elements.length === 0) {
    // Fallback: try extracting a single <sktd:text> without element structure
    const text = decodeKtdElementText(envelopeXml) ?? '';
    return options.routeSafe === false ? text : escapeKtdBodyMetaMarkers(text);
  }

  // A lone documented node still needs its routing heading when writable empty siblings
  // exist. Otherwise appending one of the ids from formatKtdNodeIndex creates a
  // non-empty preamble that the inverse writer must refuse. A genuinely single-target
  // document keeps the compact, backwards-compatible bare body.
  const allElements = findKtdElements(envelopeXml);
  const documentedId = elements[0]?.id;
  const hasOtherWritableTarget = allElements.some(
    (element) => element.id && element.id !== documentedId && canWriteKtdLongText(element.xml),
  );
  if (elements.length === 1 && !hasOtherWritableTarget) {
    const routes = ktdRoutes(envelopeXml, allElements);
    if (options.routeSafe === false) return elements[0].text;
    const routeEscaped = elements[0].id ? escapeKtdBodyRouteHeadings(elements[0].text, routes) : elements[0].text;
    const escaped = escapeKtdBodyMetaMarkers(routeEscaped);
    // Keep the backwards-compatible bare body unless escaping exposed a line that the
    // section parser would otherwise consume as a route. Metadata-marker escapes are
    // independently reversible on the unaddressed path and need no outer heading.
    return routeEscaped === elements[0].text ? escaped : `## ${elements[0].id}\n\n${escaped}`;
  }

  // Multiple elements: format as structured Markdown with element headings. Escape
  // body headings that would otherwise be parsed as routing syntax on write. Prefixing
  // one backslash is reversible even when the stored line already starts with one.
  const routes = ktdRoutes(envelopeXml, allElements);
  return elements
    .map(
      (e) =>
        `## ${e.id}\n\n${
          options.routeSafe === false ? e.text : escapeKtdBodyMetaMarkers(escapeKtdBodyRouteHeadings(e.text, routes))
        }`,
    )
    .join('\n\n');
}

/**
 * Compact index of EVERY writable node of a KTD, documented or not — the only way to learn a
 * node's address by reading, since `decodeKtdText` renders sections only for nodes that hold
 * text. Empty string when the document has no writable node.
 *
 * Each node is listed by the spelling that resolves back to it: its node name, or its full id
 * when the name would resolve elsewhere (a BDEF's root-entity node is named like the object
 * itself, and that name resolves to the root) or is shared by several nodes. Names are grouped
 * under their <base> and <TYPE> so a 90-node document costs a few lines, not 90 URIs.
 */
export function formatKtdNodeIndex(envelopeXml: string): string {
  const all = findKtdElements(envelopeXml);
  const routes = ktdRoutes(envelopeXml, all);
  if (routes.duplicateIds.size > 0) {
    return (
      `SAPWrite unavailable: duplicate node ids (${[...routes.duplicateIds].join(', ')}). ` +
      'The documentation remains readable, but these elements cannot be addressed separately.'
    );
  }
  const writable = all.filter((element) => element.id && canWriteKtdLongText(element.xml));
  if (writable.length === 0) return '';

  const roots: string[] = [];
  const namesByBaseAndType = new Map<string, Map<string, string[]>>();
  // Listed on their own line, so the tokens above stay exactly what a caller may copy back —
  // a marker glued onto a name would itself be a heading that resolves to nothing.
  const empty: string[] = [];
  for (const element of writable) {
    const id = element.id;
    const label = addressableKtdRoute(routes, element);
    if (!elementBase64(element.xml)) empty.push(label);
    const typeAt = id.indexOf('#type=');
    const nameAt = typeAt < 0 ? -1 : id.indexOf(';name=', typeAt);
    if (typeAt < 0 || nameAt < 0) {
      roots.push(label);
      continue;
    }
    const base = id.slice(0, typeAt);
    const type = id.slice(typeAt + '#type='.length, nameAt);
    const byType = namesByBaseAndType.get(base) ?? new Map<string, string[]>();
    byType.set(type, [...(byType.get(type) ?? []), label]);
    namesByBaseAndType.set(base, byType);
  }

  const lines = [
    `Nodes: ${writable.length}${empty.length ? ` (${empty.length} with no text yet, listed under "empty")` : ''}. ` +
      'Address one with a "## <name>" section in SAPWrite "source", or as shortTexts[].node — every name below is ' +
      'accepted verbatim. An update only touches the nodes it addresses; the rest keep their current text. ' +
      'For a root-only H2 edit, keep the complete SAPRead context; when only the root has text, you can also omit its H2.',
  ];
  for (const root of roots) lines.push(`root: ${root}`);
  for (const [base, byType] of namesByBaseAndType) {
    lines.push(`base: ${base}`);
    for (const [type, names] of byType) lines.push(`${type} (${names.length}): ${names.join(', ')}`);
  }
  if (empty.length > 0) lines.push(`empty (${empty.length}): ${empty.join(', ')}`);
  return lines.join('\n');
}

/** Compare in-place rewrites and label changed nodes for create, update, and preview reports. */
export function summarizeKtdChanges(before: string, after: string): { changed: string[]; untouched: number } {
  // Positional: a rewrite replaces element blocks in place and never adds or removes one, so
  // index i is the same node on both sides — even for elements sharing or lacking an id.
  const previous = findKtdElements(before);
  const current = findKtdElements(after);
  // The legacy write fallback can replace one envelope-level text slot without any elements.
  if (previous.length === 0 && current.length === 0 && decodeKtdElementText(after) !== undefined) {
    return before === after ? { changed: [], untouched: 1 } : { changed: ['(document body)'], untouched: 0 };
  }
  const routes = ktdRoutes(after, current);
  const changed: string[] = [];
  let untouched = 0;
  current.forEach((element, index) => {
    if (previous[index]?.xml === element.xml) untouched += 1;
    else changed.push(element.id ? addressableKtdRoute(routes, element) : `(element ${index + 1})`);
  });
  return { changed, untouched };
}

/** The same routing feedback for a preview, an update, or a post-create documentation write. */
export function formatKtdWriteReport(before: string, after: string, report: KtdWriteReport, dryRun = false): string {
  const { changed, untouched } = summarizeKtdChanges(before, after);
  const changedList = changed.length > 0 ? `:\n${changed.map((node) => `  ${node}`).join('\n')}` : '.';
  const proseNote =
    report.proseHeadings.length > 0
      ? `\nHeadings kept as prose inside their node (not node routes): ${report.proseHeadings.join(', ')}`
      : '';
  return (
    `${dryRun ? 'Would change' : 'Changed'} ${changed.length} node(s); ${untouched} node(s) ` +
    `${dryRun ? 'would keep' : 'kept'} their current text${changedList}${proseNote}`
  );
}

/**
 * The spelling a caller can copy back for this node: its name when that name resolves to this
 * very element, otherwise the full id. Duplicate IDs are display-only; their read context warns
 * that writes are unavailable.
 */
function addressableKtdRoute(routes: KtdRoutes, element: KtdElement): string {
  const name = ktdNodeNameSpellings(element.id)[0];
  const candidates = ktdRouteCandidates(routes, name);
  return candidates.length === 1 && candidates[0] === element ? name : element.id;
}

/** Exact transport line separating writable KTD Markdown from ARC-1 read-only context. */
export const KTD_META_MARKER = '<!-- arc1:ktd-meta — read-only context below; SAPWrite ignores it -->';

/** A Markdown level-two heading line. Greedy capture avoids quadratic matching on long input. */
const KTD_HEADING_LINE = /^##[ \t]+(.*)$/m;

/**
 * Remove the read-only context that SAPRead appends after `KTD_META_MARKER`.
 *
 * A route-safe SAPRead escapes the same line when it belongs to a stored body. When a complete
 * read contains both that escaped body line and an appended trailer, the final unescaped marker
 * is therefore the delimiter. Using the final marker also keeps older complete reads lossless if
 * their body still contains an unescaped occurrence. A heading below the delimiter is refused
 * because it is most likely a node section appended in the wrong place.
 */
export function stripKtdMetaTrailer(markdown: string): string {
  let markerAt = -1;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const newlineAt = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineAt < 0 ? markdown.length : newlineAt;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (line === KTD_META_MARKER) {
      markerAt = lineStart;
    }
    if (newlineAt < 0) break;
    lineStart = newlineAt + 1;
  }
  if (markerAt < 0) return markdown;
  const trailer = markdown.slice(markerAt + KTD_META_MARKER.length);
  const strayHeading = trailer.match(KTD_HEADING_LINE);
  if (strayHeading) {
    throw new Error(
      `KTD documentation update has a "## ${strayHeading[1].trim()}" section below the read-only SAPRead ` +
        `marker "${KTD_META_MARKER}". Move the section above that line, or remove the marker and its context.`,
    );
  }
  return markdown.slice(0, markerAt).trimEnd();
}

/**
 * Replace the per-node <sktd:text> bodies of a <sktd:docu> envelope with
 * base64(markdown), preserving all other attributes and elements (responsible,
 * packageRef, refObject, and every node the body does not address).
 *
 * ADDRESSING: a KTD holds one <sktd:element> per documented node — the object
 * root plus one per documentable element (BDEF actions, savers, entities, …).
 * `decodeKtdText` renders those as `## <node id>` sections, and this function
 * consumes that exact-id section format to write each section back to its node.
 * A body that addresses no node used to be written into whichever element came
 * first, which silently overwrote the root and dropped every other node's edit.
 *
 * The returned XML is suitable for a PUT to the KTD object URL with
 * content-type `application/vnd.sap.adt.sktdv2+xml`.
 */
export function rewriteKtdText(envelopeXml: string, markdown: string, report?: KtdWriteReport): string {
  const hasReadOnlyContext = markdown.split(/\r?\n/).includes(KTD_META_MARKER);
  markdown = stripKtdMetaTrailer(markdown);
  if (!markdown.trim()) {
    throw new Error(
      'KTD documentation update has an empty body. ARC-1 will not erase documentation from a bodyless ' +
        'update; to clear one node, address it with "## <node id>" followed by an empty section.',
    );
  }
  const elements = findKtdElements(envelopeXml);
  const routes = ktdRoutes(envelopeXml, elements);
  assertWritableKtdRoutes(routes);
  const documented = elements.filter((element) => elementBase64(element.xml));
  const root = rootKtdElement(envelopeXml, elements);
  const unaddressedTarget = documented.length <= 1 ? (documented[0] ?? root) : undefined;
  // A route-safe SAPRead prefixes one backslash to body H2s that would otherwise
  // be parsed as node boundaries. Its presence makes a lone root route unambiguous,
  // even when that read had no metadata context to append. Compute the inverse once
  // as well so the unaddressed/recovery path cannot persist the transport escape.
  const routeUnescapedMarkdown = unescapeKtdBodyRouteHeadings(markdown, routes);
  const hasBodyRouteEscape = routeUnescapedMarkdown !== markdown;
  const unescapedMarkdown = unescapeKtdBodyMetaMarkers(routeUnescapedMarkdown);
  const perElement = splitKtdMarkdownByElementId(markdown, routes, report);
  if (perElement) {
    // The root id is a bare ABAP object name, so a lone `## ZI_FOO` is also a very
    // natural document title. When the unaddressed fallback already resolves to that
    // root, consuming the line as routing syntax would silently delete the title.
    // A complete SAPRead result is unambiguous because it carries the metadata marker;
    // several addressed nodes are likewise unambiguous. Refuse the remaining collision.
    if (
      !hasReadOnlyContext &&
      !hasBodyRouteEscape &&
      root &&
      root.id.toUpperCase() === envelopeKtdName(envelopeXml).toUpperCase() &&
      unaddressedTarget === root &&
      perElement.size === 1 &&
      perElement.has(root.id)
    ) {
      throw new Error(
        `KTD heading "## ${root.id}" is ambiguous: it can be the root-node route or a visible Markdown title. ` +
          `ARC-1 will not silently remove it. Omit that heading to update the sole root body, use "# ${root.id}" ` +
          'for a visible title, or start a multi-node edit from the complete SAPRead result.',
      );
    }
    return rewriteKtdElementTexts(envelopeXml, elements, perElement);
  }

  // An unaddressed body still has one unambiguous destination whenever at most one
  // node currently holds text — that is exactly what `decodeKtdText` rendered, and
  // it is the shape a freshly created KTD comes back in. More than one documented
  // node, though, and the body would overwrite one and silently drop the others.
  if (documented.length > 1) {
    const addressable = documented.map((element) => element.id).filter(Boolean);
    throw new Error(
      `KTD documentation update addresses no node. "${envelopeKtdName(envelopeXml)}" documents ` +
        `${documented.length} nodes, so the body must address them with "## <node id>" headings. ` +
        `Documented node ids in the version this write would modify:\n${addressable.map((id) => `  ${id}`).join('\n')}`,
    );
  }
  const target = unaddressedTarget;
  if (target) {
    return (
      envelopeXml.slice(0, target.start) + setKtdElementText(target, unescapedMarkdown) + envelopeXml.slice(target.end)
    );
  }

  // No <sktd:element> at all — rewrite the lone <sktd:text> wherever it sits.
  const spliced = spliceKtdTextBody(envelopeXml, unescapedMarkdown);
  if (spliced !== undefined) return spliced;
  throw new Error('KTD envelope missing <sktd:text> element — cannot update documentation body.');
}

/** One exact-node short-text assignment for a Knowledge Transfer Document. */
export interface KtdShortText {
  node: string;
  text: string;
}

/** Eclipse ADT applies this limit to its KTD short-text input widget. */
export const KTD_SHORT_TEXT_MAX_LENGTH = 60;

/**
 * Apply optional Markdown bodies and optional short texts to one server-provided envelope.
 * All mutations stay local until validation succeeds and the caller performs the PUT.
 */
export function rewriteKtdDocument(
  envelopeXml: string,
  markdown: string | undefined,
  shortTexts: KtdShortText[] | undefined,
  report?: KtdWriteReport,
): string {
  const assignments = shortTexts ?? [];
  if (markdown === undefined && assignments.length === 0) {
    throw new Error(
      'KTD documentation update has nothing to write: pass "source" (node bodies), "shortTexts", or both.',
    );
  }
  const withBodies = markdown === undefined ? envelopeXml : rewriteKtdText(envelopeXml, markdown, report);
  return assignments.length === 0 ? withBodies : rewriteKtdShortTexts(withBodies, assignments);
}

/** One `<sktd:element>` block located inside a `<sktd:docu>` envelope. */
interface KtdElement {
  /** Value of `<sktd:id>`, or '' when the element carries none. */
  id: string;
  /** Offsets of the block within the envelope, for byte-preserving splices. */
  start: number;
  end: number;
  xml: string;
}

/** Base64 payload currently held by an element, '' when it is empty or absent. */
function elementBase64(elementXml: string): string {
  return elementXml.match(/<sktd:text[^>]*>([\s\S]*?)<\/sktd:text>/)?.[1]?.trim() ?? '';
}

/** Mirror Eclipse KtdElementUtil.canHaveLongText while retaining old envelopes with no flags. */
function canWriteKtdLongText(elementXml: string): boolean {
  const obligation = elementXml.match(/\bsktd:longTextObligation="([^"]*)"/)?.[1]?.toLowerCase();
  if (obligation) return obligation === 'mandatory' || obligation === 'optional';
  const canHaveDocumentation = elementXml.match(/\bsktd:canHaveDocumentation="([^"]*)"/)?.[1]?.toLowerCase();
  if (canHaveDocumentation) return canHaveDocumentation === 'true';
  // Older/simplified envelopes do not always carry either optional attribute. The
  // server-provided text slot remains the strongest backwards-compatible evidence.
  return /<sktd:text(?:\s|\/|>)/.test(elementXml);
}

const KTD_SHORT_TEXT_TAG = /<sktd:shortText\b[^>]*\/?>/;
const KTD_SHORT_TEXT_VALUE = /\bsktd:text="([^"]*)"/;
const KTD_SHORT_TEXT_OBLIGATION = /\bsktd:obligation="([^"]*)"/;

/** Existing short texts, each labelled with a reference that resolves back to its node. */
export function formatKtdShortTexts(envelopeXml: string): string {
  const elements = findKtdElements(envelopeXml);
  const routes = ktdRoutes(envelopeXml, elements);
  const lines = elements
    .map((element) => {
      const tag = element.xml.match(KTD_SHORT_TEXT_TAG)?.[0];
      const encoded = tag?.match(KTD_SHORT_TEXT_VALUE)?.[1] ?? '';
      if (!element.id || !encoded) return undefined;
      const text = Buffer.from(encoded, 'base64').toString('utf-8').replace(/\s+/g, ' ').trim();
      if (!text) return undefined;
      const obligation = tag?.match(KTD_SHORT_TEXT_OBLIGATION)?.[1] || 'unspecified';
      return `  ${addressableKtdRoute(routes, element)} [${obligation}]: ${text}`;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length === 0
    ? ''
    : [
        routes.duplicateIds.size > 0
          ? 'Short texts (read-only; duplicate node IDs prevent updates):'
          : 'Short texts (read-only; update with SAPWrite shortTexts=[{node,text}] using the name shown):',
        ...lines,
      ].join('\n');
}

/** Validate all assignments, then splice only their existing short-text value attributes. */
function rewriteKtdShortTexts(envelopeXml: string, assignments: KtdShortText[]): string {
  const elements = findKtdElements(envelopeXml);
  // The same resolver the "## " section headings use, so one spelling addresses a node
  // everywhere: exact id, case variant, or the node name the SAPRead index prints.
  const routes = ktdRoutes(envelopeXml, elements);
  assertWritableKtdRoutes(routes);
  const resolved = new Map<string, { element: KtdElement; text: string }>();

  for (const assignment of assignments) {
    const requestedId = assignment.node.trim();
    const element = resolveKtdRoute(routes, requestedId);
    if (!element) throw unknownKtdNodeError([requestedId], routes);
    const key = element.id;
    if (resolved.has(key)) {
      throw new Error(`KTD node "${element.id}" appears twice in shortTexts — keep one entry per node.`);
    }

    const text = assignment.text.replace(/\s+/g, ' ').trim();
    if (text.length > KTD_SHORT_TEXT_MAX_LENGTH) {
      throw new Error(
        `Short text for KTD node "${element.id}" is ${text.length} characters; Eclipse ADT allows ` +
          `${KTD_SHORT_TEXT_MAX_LENGTH}.`,
      );
    }
    const tag = element.xml.match(KTD_SHORT_TEXT_TAG)?.[0];
    if (!tag || !KTD_SHORT_TEXT_VALUE.test(tag)) {
      throw new Error(
        `KTD node "${element.id}" has no writable <sktd:shortText sktd:text="…"> value; ARC-1 will not synthesize one.`,
      );
    }
    const obligation = tag.match(KTD_SHORT_TEXT_OBLIGATION)?.[1]?.toLowerCase();
    if (obligation !== 'mandatory' && obligation !== 'optional') {
      throw new Error(
        `KTD node "${element.id}" does not take a writable short text ` +
          `(sktd:obligation="${obligation ?? 'missing'}"; expected "mandatory" or "optional").`,
      );
    }
    resolved.set(key, { element, text });
  }

  let rewritten = envelopeXml;
  for (const { element, text } of [...resolved.values()].sort(
    (left, right) => right.element.start - left.element.start,
  )) {
    const encoded = text ? Buffer.from(text, 'utf-8').toString('base64') : '';
    const replacement = element.xml.replace(KTD_SHORT_TEXT_TAG, (tag) =>
      tag.replace(KTD_SHORT_TEXT_VALUE, `sktd:text="${encoded}"`),
    );
    rewritten = rewritten.slice(0, element.start) + replacement + rewritten.slice(element.end);
  }
  return rewritten;
}

/**
 * The element documenting the object itself, for an envelope where nothing is
 * documented yet. Live reads show the root node's `<sktd:id>` repeating the
 * object name from `<sktd:docu adtcore:name>`; when nothing matches, fall back to
 * document order, which is where an unaddressed body has always gone.
 */
function rootKtdElement(envelopeXml: string, elements: KtdElement[]): KtdElement | undefined {
  const name = envelopeKtdName(envelopeXml);
  return (
    elements.find((element) => element.id === name) ??
    elements.find((element) => element.id.toUpperCase() === name.toUpperCase()) ??
    elements[0]
  );
}

/** `<sktd:element>` blocks, paired or self-closing, in document order. */
function findKtdElements(envelopeXml: string): KtdElement[] {
  const pattern = /<sktd:element\b(?:[^>]*\/>|[\s\S]*?<\/sktd:element>)/g;
  const elements: KtdElement[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(envelopeXml)) !== null) {
    const xml = match[0];
    elements.push({
      id: xml.match(/<sktd:id>([\s\S]*?)<\/sktd:id>/)?.[1]?.trim() ?? '',
      start: match.index,
      end: match.index + xml.length,
      xml,
    });
  }
  return elements;
}

function envelopeKtdName(envelopeXml: string): string {
  return envelopeXml.match(/<sktd:docu\b[^>]*\badtcore:name="([^"]*)"/)?.[1] ?? 'this KTD';
}

/** Everything a `## ` heading is resolved against. Built once per envelope. */
interface KtdRoutes {
  objectName: string;
  /** Exact wire id → element. Distinct SAP elements must never collapse into one target. */
  byId: Map<string, KtdElement>;
  /** Reads retain every element; writes must refuse IDs that cannot distinguish them. */
  duplicateIds: Set<string>;
  /** Case-insensitive aliases are usable only when they identify exactly one element. */
  byFoldedId: Map<string, KtdElement[]>;
  byName: Map<string, KtdElement[]>;
  /** Upper-cased qualifiers of node names (`ZI_TravelTP` in `ZI_TravelTP.GetPhoto`). */
  qualifiers: Set<string>;
  /** Namespace of the documented object (`/RHP/`), '' for a customer-namespace-free object. */
  namespace: string;
}

/**
 * Every spelling a node name is seen in: percent-decoded (`%_OWN`, what the index prints) and raw
 * as SAP encodes it on the wire (`%25_OWN`, what every `## <full id>` heading carries). One entry
 * when they coincide. Both must be routes, or the spelling a caller copies from one surface is
 * prose on the other.
 * SAP's optional displayName is a presentation label, not an address; never route by it.
 */
function ktdNodeNameSpellings(id: string): string[] {
  const at = id.indexOf(';name=');
  const raw = at < 0 ? id : id.slice(at + ';name='.length);
  try {
    return [...new Set([decodeURIComponent(raw), raw])];
  } catch {
    return [raw];
  }
}

function ktdRoutes(envelopeXml: string, elements: KtdElement[]): KtdRoutes {
  const byId = new Map<string, KtdElement>();
  const duplicateIds = new Set<string>();
  const byFoldedId = new Map<string, KtdElement[]>();
  const byName = new Map<string, KtdElement[]>();
  const qualifiers = new Set<string>();
  const register = (map: Map<string, KtdElement[]>, key: string, element: KtdElement) => {
    const candidates = map.get(key) ?? [];
    if (!candidates.includes(element)) candidates.push(element);
    map.set(key, candidates);
  };
  for (const element of elements) {
    if (!element.id) continue;
    if (byId.has(element.id)) duplicateIds.add(element.id);
    else byId.set(element.id, element);
    register(byFoldedId, element.id.toUpperCase(), element);
    for (const spelling of ktdNodeNameSpellings(element.id)) {
      const nameKey = spelling.toUpperCase();
      register(byName, nameKey, element);
      const dot = spelling.lastIndexOf('.');
      if (dot > 0) qualifiers.add(spelling.slice(0, dot).toUpperCase());
    }
  }
  const objectName = envelopeKtdName(envelopeXml);
  return {
    objectName,
    byId,
    duplicateIds,
    byFoldedId,
    byName,
    qualifiers,
    namespace: objectName.match(/^\/[^/]+\//)?.[0].toUpperCase() ?? '',
  };
}

/** Ambiguous envelopes remain inspectable; only mutation requires unique exact IDs. */
function assertWritableKtdRoutes(routes: KtdRoutes): void {
  if (routes.duplicateIds.size > 0) {
    throw new Error(
      `KTD envelope contains duplicate node ids (${[...routes.duplicateIds].join(', ')}); ARC-1 cannot address these elements separately.`,
    );
  }
}

/**
 * Shared lookup precedence: exact ID, then case-insensitive ID, then indexed node name.
 * Keep ambiguous candidates so writers can refuse them and readers can choose a full-ID label.
 */
function ktdRouteCandidates(routes: KtdRoutes, heading: string): KtdElement[] {
  const exact = routes.duplicateIds.has(heading) ? undefined : routes.byId.get(heading);
  if (exact) return [exact];
  const key = heading.toUpperCase();
  return routes.byFoldedId.get(key) ?? routes.byName.get(key) ?? [];
}

/** Writes require one target; display labels can fall back to the full ID without throwing. */
function resolveKtdRoute(routes: KtdRoutes, heading: string): KtdElement | undefined {
  const candidates = ktdRouteCandidates(routes, heading);
  if (candidates.length > 1) {
    throw new Error(
      `KTD node "${heading}" is ambiguous in "${routes.objectName}" — ${candidates.length} nodes carry ` +
        `that reference. Address one by its exact full id:\n${candidates.map((element) => `  ${element.id}`).join('\n')}`,
    );
  }
  return candidates[0];
}

/**
 * Whether an unresolved heading is unmistakably meant as a node reference — an ADT URI, a `#type=`
 * fragment, a name qualified by an entity this document knows, a name in the documented object's
 * own namespace, or an index label copied with its "(empty)" marker. Such a heading is a typo or
 * a node that does not exist, and folding it into the previous node's text is exactly the silent
 * corruption this guard exists to prevent. Ordinary prose headings ("## Shape", "## Where the data
 * comes from") match none of these; a prose heading that does can be kept as prose with a leading
 * backslash (`\## …`), the same escape the route-safe read uses.
 */
function looksLikeKtdRoute(routes: KtdRoutes, heading: string): boolean {
  const key = heading.toUpperCase();
  if (key.startsWith('/SAP/BC/ADT/') || key.includes('#TYPE=') || /\(empty\)$/i.test(heading)) return true;
  if (routes.namespace && key.startsWith(routes.namespace)) return true;
  return [...routes.qualifiers].some((qualifier) => key.startsWith(`${qualifier}.`));
}

/**
 * Refusal for a node reference that matches nothing. Lists the known nodes by the spelling the
 * SAPRead index prints (a name, or the full id where only that resolves), so a typo can be matched
 * against the list by eye instead of against ~140-character URIs.
 */
function unknownKtdNodeError(refs: string[], routes: KtdRoutes): Error {
  const subject =
    refs.length === 1
      ? `KTD node "${refs[0]}" does not`
      : `KTD nodes ${refs.map((ref) => `"${ref}"`).join(', ')} do not`;
  const known = [...routes.byId.values()].map((element) => `  ${addressableKtdRoute(routes, element)}`);
  return new Error(
    `${subject} exist in this document. SAP creates one <sktd:element> per documentable element of ` +
      'the referenced object; ARC-1 will not invent one. A heading meant as prose can be kept as prose with a ' +
      'leading backslash ("\\## …"). Known node ids (any spelling below is accepted):\n' +
      known.join('\n'),
  );
}

/** What a KTD body rewrite noticed but did not act on; filled for the caller when it passes one. */
export interface KtdWriteReport {
  /** `## ` headings kept as prose inside the enclosing node because they resolve to no node and look like none. */
  proseHeadings: string[];
}

/**
 * Split a Markdown body in the section format emitted by `decodeKtdText`.
 *
 * A line is a node boundary when it is `## ` followed by something `resolveKtdRoute` maps to an
 * element of this envelope: its exact id, a case variant, or the node NAME SAPRead's index prints.
 * Names resolve against EVERY node, documented or not — resolving them against the pending ones
 * only made a second write to the same node silently fold its section into the previous node's
 * body. A heading that is unmistakably a node reference but matches nothing aborts the write.
 * Ordinary Markdown headings inside a node's documentation survive the round-trip untouched.
 *
 * Returns undefined when the body addresses no node (single-node KTD, or a freshly
 * created one); the caller then treats the whole body as that one node's text.
 */
function splitKtdMarkdownByElementId(
  markdown: string,
  routes: KtdRoutes,
  report?: KtdWriteReport,
): Map<string, string> | undefined {
  const lines = markdown.split(/\r?\n/);
  const headings: Array<{ line: number; id: string }> = [];
  const unknown: string[] = [];

  lines.forEach((line, index) => {
    const id = line.match(KTD_HEADING_LINE)?.[1].trim();
    if (!id) return;
    const resolved = resolveKtdRoute(routes, id);
    if (resolved) headings.push({ line: index, id: resolved.id });
    else if (routes.byId.size > 0 && looksLikeKtdRoute(routes, id)) unknown.push(id);
    // Nothing distinguishes a typo in a bare node name from a prose heading when the document's
    // names carry no qualifier (DDLS fields, for instance) — so the caller is told what stayed prose.
    else if (routes.byId.size > 0) report?.proseHeadings.push(id);
  });

  if (unknown.length > 0) throw unknownKtdNodeError(unknown, routes);
  if (headings.length === 0) return undefined;

  const preamble = lines.slice(0, headings[0].line).join('\n').trim();
  if (preamble) {
    throw new Error(
      `KTD documentation update has text before its first "## <node id>" heading (the one for ` +
        `"${headings[0].id}"). Every line must belong to a node, so move that text under a heading. ` +
        `Stray text starts: "${preamble.slice(0, 80)}"`,
    );
  }

  const bodies = new Map<string, string>();
  headings.forEach((heading, index) => {
    const until = index + 1 < headings.length ? headings[index + 1].line : lines.length;
    if (bodies.has(heading.id)) {
      throw new Error(`KTD node "${heading.id}" appears twice in the update body — keep one section per node.`);
    }
    const body = lines
      .slice(heading.line + 1, until)
      .join('\n')
      .trim();
    bodies.set(heading.id, unescapeKtdBodyMetaMarkers(unescapeKtdBodyRouteHeadings(body, routes)));
  });
  return bodies;
}

/**
 * A heading shape reserved by the section parser, whether it resolves or aborts the write.
 * Node NAMES are reserved too, so a prose heading that happens to equal one is escaped on read
 * and restored on write instead of being consumed as a route.
 */
function isKtdRouteHeadingId(id: string, routes: KtdRoutes): boolean {
  const key = id.toUpperCase();
  return routes.byFoldedId.has(key) || routes.byName.has(key) || looksLikeKtdRoute(routes, id);
}

/**
 * Protect a stored body line that is indistinguishable from KTD section routing.
 *
 * One leading backslash is added to every run of zero or more existing backslashes,
 * so the inverse can remove exactly the transport escape and preserve the stored text.
 */
function escapeKtdBodyRouteHeadings(markdown: string, routes: KtdRoutes): string {
  return markdown.replace(/^(\\*)(##[ \t]+.*)$/gm, (line, _slashes: string, heading: string) => {
    const id = heading.match(KTD_HEADING_LINE)?.[1].trim();
    return id && isKtdRouteHeadingId(id, routes) ? `\\${line}` : line;
  });
}

/** Remove the one transport escape added by `escapeKtdBodyRouteHeadings`. */
function unescapeKtdBodyRouteHeadings(markdown: string, routes: KtdRoutes): string {
  return markdown.replace(/^\\(\\*##[ \t]+.*)$/gm, (line, escapedHeading: string) => {
    const heading = escapedHeading.replace(/^\\*/, '');
    const id = heading.match(KTD_HEADING_LINE)?.[1].trim();
    return id && isKtdRouteHeadingId(id, routes) ? escapedHeading : line;
  });
}

/** Escape an exact metadata-marker body line without losing existing leading backslashes. */
function escapeKtdBodyMetaMarkers(markdown: string): string {
  const marker = escapeRegExp(KTD_META_MARKER);
  return markdown.replace(new RegExp(`^(\\\\*)${marker}(\\r?)$`, 'gm'), (line) => `\\${line}`);
}

/** Remove the one transport escape added by `escapeKtdBodyMetaMarkers`. */
function unescapeKtdBodyMetaMarkers(markdown: string): string {
  const marker = escapeRegExp(KTD_META_MARKER);
  return markdown.replace(
    new RegExp(`^\\\\(\\\\*${marker})(\\r?)$`, 'gm'),
    (_line, escapedMarker: string, carriageReturn: string) => `${escapedMarker}${carriageReturn}`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splice new base64 bodies into the addressed elements, leaving every other byte alone. */
function rewriteKtdElementTexts(envelopeXml: string, elements: KtdElement[], bodies: Map<string, string>): string {
  let rewritten = envelopeXml;
  // Back to front, so the elements still ahead keep their offsets.
  for (const element of [...elements].reverse()) {
    const body = bodies.get(element.id);
    if (body === undefined) continue;
    rewritten = rewritten.slice(0, element.start) + setKtdElementText(element, body) + rewritten.slice(element.end);
  }
  return rewritten;
}

function setKtdElementText(element: KtdElement, markdown: string): string {
  const current = decodeKtdElementText(element.xml);
  // A complete SAPRead result includes documented nodes even when SAP marks one of
  // them non-writable. Preserve an unchanged section byte-for-byte; only an attempted
  // mutation needs the writability gate below.
  if (current !== undefined && normalizeKtdBodyForComparison(current) === normalizeKtdBodyForComparison(markdown)) {
    return element.xml;
  }
  const spliced = spliceKtdTextBody(element.xml, markdown);
  if (spliced === undefined) {
    throw new Error(
      `KTD node "${element.id}" has no <sktd:text> element to write into. SAP gives every documentable ` +
        `node an (initially empty) <sktd:text/>, so an element without one is not a documentation target; ` +
        `ARC-1 does not synthesize one.`,
    );
  }
  if (!canWriteKtdLongText(element.xml)) {
    throw new Error(
      `KTD node "${element.id}" does not accept long-text documentation according to SAP's ` +
        'canHaveDocumentation/longTextObligation contract.',
    );
  }
  return spliced;
}

/** Decode one existing text slot; undefined means the element has no slot at all. */
function decodeKtdElementText(elementXml: string): string | undefined {
  const paired = elementXml.match(/<sktd:text[^>]*>([\s\S]*?)<\/sktd:text>/);
  if (paired) {
    const base64 = paired[1].trim();
    return base64 ? Buffer.from(base64, 'base64').toString('utf-8') : '';
  }
  return /<sktd:text(?:\s[^>]*)?\/>/.test(elementXml) ? '' : undefined;
}

/** Section separators normalize outer whitespace and CRLF; compare the semantic body. */
function normalizeKtdBodyForComparison(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').trim();
}

/**
 * Swap the payload of the first <sktd:text> in `xml` — paired or self-closing — for
 * base64(markdown). Returns undefined when `xml` holds no <sktd:text> at all, so each
 * caller raises the error that fits its own context. `<sktd:shortText sktd:text="…"/>`
 * never matches: the literal `<sktd:text` requires the element name, not the attribute.
 */
function spliceKtdTextBody(xml: string, markdown: string): string | undefined {
  const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
  const paired = /(<sktd:text[^>]*>)([\s\S]*?)(<\/sktd:text>)/;
  if (paired.test(xml)) return xml.replace(paired, `$1${base64}$3`);
  const selfClosing = /<sktd:text([^>]*)\/>/;
  if (selfClosing.test(xml)) return xml.replace(selfClosing, `<sktd:text$1>${base64}</sktd:text>`);
  return undefined;
}
