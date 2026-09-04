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

function formatLabelLength(label: string, maxLength: number): string {
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
 * Compact index of the nodes SAP pre-created in a KTD that nobody has documented yet —
 * exactly the elements `decodeKtdText` leaves out. Empty string when every node has text.
 *
 * Lists names, not ~140-character URIs, one per line: the root is the object name, and
 * every other node is grouped by <base> and <TYPE> and listed by the spelling
 * `addressableKtdName` guarantees to resolve back to that very node under a "## <name>"
 * heading — the same rule `formatKtdShortTexts` follows, so both trailer blocks teach one
 * addressing rule.
 */
export function formatKtdUndocumentedIndex(envelopeXml: string): string {
  const elements = findKtdElements(envelopeXml);
  const undocumented = elements.filter((element) => element.id && !elementBase64(element.xml));
  if (undocumented.length === 0) return '';
  return [
    `Undocumented nodes: ${undocumented.length}. SAP pre-created them with empty text; document one by adding a ` +
      '"## <name>" section using one of the node names listed below (a "root:" line is the root node\'s own ' +
      'name; "base:" lines are context, not names).',
    ...formatKtdNodeNames(
      undocumented.map((element) => ({ id: element.id, name: addressableKtdName(envelopeXml, elements, element) })),
    ),
  ].join('\n');
}

/**
 * `root:` / `base:` / `<TYPE> (n): names` lines for a set of nodes — the compact form the
 * undocumented index and the unknown-node refusal share, so an error never costs ~100
 * characters per node the way a raw id list does.
 */
function formatKtdNodeNames(nodes: Array<{ id: string; name: string }>): string[] {
  const roots: string[] = [];
  const namesByBaseAndType = new Map<string, Map<string, string[]>>();
  for (const { id, name } of nodes) {
    const type = ktdNodeType(id);
    if (!type) {
      roots.push(name);
      continue;
    }
    const base = ktdNodeBase(id);
    const byType = namesByBaseAndType.get(base) ?? new Map<string, string[]>();
    byType.set(type, [...(byType.get(type) ?? []), name]);
    namesByBaseAndType.set(base, byType);
  }
  const lines = roots.map((root) => `root: ${root}`);
  for (const [base, byType] of namesByBaseAndType) {
    lines.push(`base: ${base}`);
    for (const [type, names] of byType) lines.push(`${type} (${names.length}): ${names.join(', ')}`);
  }
  return lines;
}

/**
 * The spelling a caller can copy back for this node: its qualified, percent-decoded name when
 * the heading resolver maps that name back to this very element, otherwise the full id (which
 * always does). Every printed name therefore round-trips. The guard matters on BDEFs: the root
 * entity's node is named like the object itself, and that name resolves to the root element,
 * not to the entity.
 */
function addressableKtdName(envelopeXml: string, elements: KtdElement[], element: KtdElement): string {
  const name = ktdNodeQualifiedName(element.id);
  try {
    return resolveKtdNodeIn(envelopeXml, elements, name, HEADING_SPELLINGS)?.id === element.id ? name : element.id;
  } catch {
    return element.id;
  }
}

/** Stable prefix of `KTD_META_MARKER`; `stripKtdMetaTrailer` looks for it at the start of a line. */
const KTD_META_MARKER_PREFIX = '<!-- arc1:ktd-meta';

/**
 * First line of the read-only metadata trailer `SAPRead` appends to a KTD (short texts,
 * undocumented-node index). An HTML comment: invisible when the Markdown renders, and the
 * writer cuts everything from this line on, so a whole SAPRead result pasted back into
 * SAPWrite never folds the trailer into the last node's body. The prefix is a wire contract
 * with SAPRead output — do not reword it once released.
 */
export const KTD_META_MARKER = `${KTD_META_MARKER_PREFIX} — read-only context below; SAPWrite ignores it -->`;

/**
 * Drop a SAPRead metadata trailer: everything from the first LINE that starts with the
 * marker prefix on. Slices the original string, so a body without a trailer is returned
 * untouched (byte-identical) and a body with one keeps its own line endings.
 *
 * A `## ` heading below the marker is refused rather than dropped: the trailer itself tells
 * the caller to "add a ## <name> section", and the end of the pasted text is where one lands.
 */
export function stripKtdMetaTrailer(markdown: string): string {
  const at = markdown.startsWith(KTD_META_MARKER_PREFIX) ? 0 : markdown.indexOf(`\n${KTD_META_MARKER_PREFIX}`);
  if (at < 0) return markdown;
  const stray = markdown.slice(at).match(HEADING_LINE);
  if (stray) {
    throw new Error(
      `KTD documentation update has a "## ${stray[1].trim()}" section below the read-only SAPRead trailer ` +
        `(the line starting "${KTD_META_MARKER_PREFIX}"), which SAPWrite would discard. Move the section above ` +
        'that line, or delete the marker line and everything after it.',
    );
  }
  return markdown.slice(0, at).trimEnd();
}

/**
 * A Markdown `## ` heading line. Greedy capture, trimmed by the caller: a lazy `(.+?)[ \t]*$`
 * here was quadratic in the line length (LLM-supplied input, no size cap upstream).
 */
const HEADING_LINE = /^##[ \t]+(.*)$/m;

/**
 * Replace the per-node <sktd:text> bodies of a <sktd:docu> envelope with
 * base64(markdown), preserving all other attributes and elements (responsible,
 * packageRef, refObject, and every node the body does not address).
 *
 * ADDRESSING: a KTD holds one <sktd:element> per documented node — the object
 * root plus one per documentable element (BDEF actions, savers, entities, …).
 * `decodeKtdText` renders those as `## <node id>` sections, and this function is
 * its inverse: each section is written back to the element its heading resolves to
 * (exact id, case-insensitive id, or the node's qualified name — see `resolveKtdNodeIn`).
 *
 * The returned XML is suitable for a PUT to the KTD object URL with
 * content-type `application/vnd.sap.adt.sktdv2+xml`.
 *
 * Body-only step of `rewriteKtdDocument`, which is the entry point the handlers use: calling
 * this directly bypasses `shortTexts` and the "nothing to write" refusal (the trailer strip
 * runs here, so the caller may pass the body raw).
 */
export function rewriteKtdText(envelopeXml: string, rawMarkdown: string): string {
  const markdown = stripKtdMetaTrailer(rawMarkdown);
  if (!markdown.trim()) {
    throw new Error(
      'KTD documentation update has an empty body. ARC-1 will not erase documentation from a bodyless ' +
        'update; to clear one node, address it with "## <node id>" followed by an empty section.',
    );
  }
  const elements = findKtdElements(envelopeXml);
  const perElement = splitKtdMarkdownByElementId(envelopeXml, markdown, elements);
  if (perElement) {
    return spliceKtdElements(envelopeXml, elements, (element) => {
      const body = perElement.get(element.id);
      return body === undefined ? undefined : setKtdElementText(element, body);
    });
  }

  // An unaddressed body still has one unambiguous destination whenever at most one
  // node currently holds text — that is exactly what `decodeKtdText` rendered, and
  // it is the shape a freshly created KTD comes back in. More than one documented
  // node, though, and the body would overwrite one and silently drop the others.
  const documented = elements.filter((element) => elementBase64(element.xml));
  if (documented.length > 1) {
    const addressable = documented.map((element) => element.id).filter(Boolean);
    throw new Error(
      `KTD documentation update addresses no node. "${envelopeKtdName(envelopeXml)}" documents ` +
        `${documented.length} nodes, so the body must address them with "## <node id>" headings. ` +
        `Documented node ids in the version this write would modify:\n${addressable.map((id) => `  ${id}`).join('\n')}`,
    );
  }
  const target = documented[0] ?? rootKtdElement(envelopeXml, elements);
  if (target) return spliceKtdElements(envelopeXml, [target], (element) => setKtdElementText(element, markdown));

  // No <sktd:element> at all — rewrite the lone <sktd:text> wherever it sits.
  const spliced = spliceKtdTextBody(envelopeXml, markdown);
  if (spliced !== undefined) return spliced;
  throw new Error('KTD envelope missing <sktd:text> element — cannot update documentation body.');
}

/**
 * Apply a Markdown body (optional) and per-node short texts (optional) to a KTD envelope in
 * one pass — the single entry point for SAPWrite. Every assignment is validated before any
 * byte changes, so a refusal never leaves a half-applied document.
 */
export function rewriteKtdDocument(
  envelopeXml: string,
  markdown: string | undefined,
  shortTexts: KtdShortText[] | undefined,
): string {
  const assignments = shortTexts ?? [];
  if (markdown === undefined && assignments.length === 0) {
    throw new Error(
      'KTD documentation update has nothing to write: pass "source" (node bodies), "shortTexts", or both.',
    );
  }
  // `rewriteKtdText` strips the trailer and refuses an empty body itself.
  let rewritten = markdown === undefined ? envelopeXml : rewriteKtdText(envelopeXml, markdown);
  if (assignments.length > 0) rewritten = applyKtdShortTexts(rewritten, assignments);
  return rewritten;
}

/** Validate every assignment against the envelope, then splice them back to front. */
function applyKtdShortTexts(envelopeXml: string, assignments: KtdShortText[]): string {
  const elements = findKtdElements(envelopeXml);
  const resolved = new Map<string, { element: KtdElement; text: string }>();
  for (const { node, text } of assignments) {
    const element = resolveKtdNodeIn(envelopeXml, elements, node, ALL_SPELLINGS);
    if (!element) throw unknownKtdNodeError([node], envelopeXml, elements);
    if (resolved.has(element.id)) {
      throw new Error(`KTD node "${element.id}" appears twice in shortTexts — keep one entry per node.`);
    }
    // A short text is single-line by nature — collapse internal whitespace the same way the
    // reader (`formatKtdShortTexts`) displays it, so stored and displayed values agree.
    const trimmed = text.replace(/\s+/g, ' ').trim();
    // UTF-16 code units, which is how an ABAP CHAR60 field counts.
    if (trimmed.length > KTD_SHORT_TEXT_MAX_LENGTH) {
      throw new Error(
        `Short text for KTD node "${element.id}" is ${trimmed.length} characters (UTF-16 units, as ABAP counts ` +
          `them); SAP allows ${KTD_SHORT_TEXT_MAX_LENGTH}.`,
      );
    }
    if (!SHORT_TEXT_ATTR.test(element.xml)) {
      throw new Error(
        `KTD node "${element.id}" has no <sktd:shortText> element to write into; ARC-1 does not synthesize one.`,
      );
    }
    if (elementShortTextObligation(element.xml) === 'forbidden') {
      throw new Error(
        `KTD node "${element.id}" does not take a short text (sktd:obligation="forbidden" — the object root and entity nodes describe themselves).`,
      );
    }
    resolved.set(element.id, { element, text: trimmed });
  }
  return spliceKtdElements(envelopeXml, elements, (element) => {
    const hit = resolved.get(element.id);
    return hit && setKtdElementShortText(element.xml, hit.text);
  });
}

/**
 * Replace whole `<sktd:element>` blocks, back to front so the offsets of the elements still
 * ahead stay valid — the one splice every KTD write goes through. `replacement` returns the
 * new block, or undefined to leave that element byte-identical.
 */
function spliceKtdElements(
  envelopeXml: string,
  elements: KtdElement[],
  replacement: (element: KtdElement) => string | undefined,
): string {
  let rewritten = envelopeXml;
  for (const element of [...elements].reverse()) {
    const xml = replacement(element);
    if (xml === undefined) continue;
    rewritten = rewritten.slice(0, element.start) + xml + rewritten.slice(element.end);
  }
  return rewritten;
}

/** Replace `sktd:shortText/@sktd:text` inside one element block with base64(text). */
function setKtdElementShortText(elementXml: string, text: string): string {
  const base64 = text ? Buffer.from(text, 'utf-8').toString('base64') : '';
  return elementXml.replace(SHORT_TEXT_ATTR, (match) => match.replace(/sktd:text="[^"]*"/, `sktd:text="${base64}"`));
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

/** `sktd:text` attribute of the element's `<sktd:shortText>`: Base64 of the short text, '' when none. */
const SHORT_TEXT_ATTR = /<sktd:shortText\b[^>]*?\bsktd:text="([^"]*)"/;

/** Decoded short text of an element, '' when empty or absent. */
function elementShortText(elementXml: string): string {
  const base64 = elementXml.match(SHORT_TEXT_ATTR)?.[1] ?? '';
  return base64 ? Buffer.from(base64, 'base64').toString('utf-8') : '';
}

/** `sktd:obligation` attribute of the element's `<sktd:shortText>`. */
const SHORT_TEXT_OBLIGATION_ATTR = /<sktd:shortText\b[^>]*?\bsktd:obligation="([^"]*)"/;

/** `sktd:obligation` of the element's short text: 'optional' | 'forbidden' | 'mandatory' | ''. */
function elementShortTextObligation(elementXml: string): string {
  return elementXml.match(SHORT_TEXT_OBLIGATION_ATTR)?.[1] ?? '';
}

/** One short-text assignment: `node` is any reference `resolveKtdNode` accepts. */
export interface KtdShortText {
  node: string;
  text: string;
}

/** Stated by the document's own `<sktd:instruction sktd:instructionId="shorttext">`. */
export const KTD_SHORT_TEXT_MAX_LENGTH = 60;

/**
 * Trailer label for a node: the name `addressableKtdName` guarantees to resolve back to it —
 * so it can be copied verbatim into `shortTexts[].node` or a `## ` heading — then a bracketed
 * tag: `[<TYPE>]` for a typed fragment id, `[root]` for the document root (its id equals
 * `rootName`, the envelope's `adtcore:name`), and `[node]` for any other bare id.
 */
function ktdNodeLabel(envelopeXml: string, elements: KtdElement[], element: KtdElement, rootName: string): string {
  const type = ktdNodeType(element.id);
  if (type) return `${addressableKtdName(envelopeXml, elements, element)} [${type}]`;
  return `${element.id} [${element.id.toUpperCase() === rootName.toUpperCase() ? 'root' : 'node'}]`;
}

/**
 * Trailer block listing every node that carries a short text. Empty string when none does.
 * Read-only: short texts are written through SAPWrite's `shortTexts` parameter, never
 * through the Markdown body.
 */
export function formatKtdShortTexts(envelopeXml: string): string {
  const rootName = envelopeKtdObjectName(envelopeXml);
  const elements = findKtdElements(envelopeXml);
  const lines = elements
    .filter((element) => element.id)
    .map((element) => ({
      label: ktdNodeLabel(envelopeXml, elements, element, rootName),
      text: elementShortText(element.xml),
    }))
    .filter((entry) => entry.text)
    .map((entry) => `  ${entry.label}: ${entry.text.replace(/\s+/g, ' ').trim()}`);
  if (lines.length === 0) return '';
  return ['Short texts (SAPWrite shortTexts=[{node,text}]; node = the name before " ["):', ...lines].join('\n');
}

/**
 * The element documenting the object itself, for an envelope where nothing is
 * documented yet. Live reads show the root node's `<sktd:id>` repeating the
 * object name from `<sktd:docu adtcore:name>`; when nothing matches, fall back to
 * document order, which is where an unaddressed body has always gone.
 */
function rootKtdElement(envelopeXml: string, elements: KtdElement[]): KtdElement | undefined {
  const name = envelopeKtdName(envelopeXml).toUpperCase();
  return elements.find((element) => element.id.toUpperCase() === name) ?? elements[0];
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

/** `adtcore:name` of the `<sktd:docu>` envelope, or '' when the envelope carries none. */
function envelopeKtdObjectName(envelopeXml: string): string {
  return envelopeXml.match(/<sktd:docu\b[^>]*\badtcore:name="([^"]*)"/)?.[1] ?? '';
}

function envelopeKtdName(envelopeXml: string): string {
  return envelopeKtdObjectName(envelopeXml) || 'this KTD';
}

function unknownKtdNodeError(refs: string[], envelopeXml: string, elements: KtdElement[]): Error {
  const subject =
    refs.length === 1
      ? `KTD node "${refs[0]}" does not`
      : `KTD nodes ${refs.map((ref) => `"${ref}"`).join(', ')} do not`;
  const known = elements
    .filter((element) => element.id)
    .map((element) => ({ id: element.id, name: addressableKtdName(envelopeXml, elements, element) }));
  return new Error(
    `${subject} exist in this document. SAP creates one <sktd:element> per documentable element of ` +
      `the referenced object; ARC-1 will not invent one. Known nodes (address one by the name listed, ` +
      `or by its full id):\n${formatKtdNodeNames(known).join('\n')}`,
  );
}

function ambiguousKtdNodeError(envelopeXml: string, ref: string, candidates: KtdElement[]): Error {
  return new Error(
    `KTD node "${ref}" is ambiguous in "${envelopeKtdName(envelopeXml)}" — ${candidates.length} nodes carry that ` +
      `name. Use the full id:\n${candidates.map((element) => `  ${element.id}`).join('\n')}`,
  );
}

/** The raw `name=` part of a fragment id exactly as SAP encodes it on the wire, or the whole id for the root node. */
function ktdNodeRawName(id: string): string {
  const at = id.indexOf(';name=');
  return at < 0 ? id : id.slice(at + ';name='.length);
}

/** `BDEF/BSO` for a fragment id, '' for the root node. */
function ktdNodeType(id: string): string {
  const typeAt = id.indexOf('#type=');
  const nameAt = typeAt < 0 ? -1 : id.indexOf(';name=', typeAt);
  return typeAt < 0 || nameAt < 0 ? '' : id.slice(typeAt + '#type='.length, nameAt);
}

/** Everything before `#type=` in a fragment id, '' for the root node. */
function ktdNodeBase(id: string): string {
  const at = id.indexOf('#type=');
  return at < 0 ? '' : id.slice(0, at);
}

/** Last dot-segment of a (qualified) node name: `ZI_TravelTP.GetPhoto` → `GetPhoto`. */
function lastNameSegment(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}

/**
 * The node name percent-decoded but still owner-qualified (`ZI_TravelTP.%_OWN`; `%25_OWN` on
 * the wire is the node `%_OWN`). Falls back to the raw text when the encoding is malformed.
 */
function ktdNodeQualifiedName(id: string): string {
  const raw = ktdNodeRawName(id);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Which spellings of a node name a reference may use, on top of the exact and
 * case-insensitive id. `shortTexts[].node` accepts all four — qualified (`ZI_TravelTP.GetPhoto`)
 * or bare (`GetPhoto`), percent-decoded or as encoded on the wire (`%25_OWN`) — because a
 * structured parameter cannot be mistaken for prose. A `## ` heading accepts only the
 * qualified spellings: every BDEF KTD carries `<Entity>.create/update/delete` nodes, so bare
 * names would turn the most ordinary prose headings (`## Update`) into node boundaries.
 */
type KtdNameSpellings = 'qualified' | 'all';
const HEADING_SPELLINGS: KtdNameSpellings = 'qualified';
const ALL_SPELLINGS: KtdNameSpellings = 'all';

/**
 * Resolve a node reference against the envelope: exact id, then case-insensitive id,
 * then a node name that exactly one node carries (see `KtdNameSpellings`; this convenience
 * accepts all spellings, like `shortTexts[].node`). Returns undefined when nothing matches;
 * throws when a name is ambiguous — it never picks one of several.
 */
export function resolveKtdNode(envelopeXml: string, ref: string): KtdElement | undefined {
  return resolveKtdNodeIn(envelopeXml, findKtdElements(envelopeXml), ref, ALL_SPELLINGS);
}

function resolveKtdNodeIn(
  envelopeXml: string,
  elements: KtdElement[],
  ref: string,
  spellings: KtdNameSpellings,
): KtdElement | undefined {
  const wanted = ref.trim();
  if (!wanted) return undefined;
  const exact = elements.find((element) => element.id === wanted);
  if (exact) return exact;
  const upper = wanted.toUpperCase();
  // First spelling wins: ABAP names are case-insensitive, so a case-only collision is the same node.
  const byCase = elements.find((element) => element.id.toUpperCase() === upper);
  if (byCase) return byCase;
  const byName = elements.filter((element) => {
    if (!element.id) return false;
    const raw = ktdNodeRawName(element.id);
    const decoded = ktdNodeQualifiedName(element.id);
    const candidates =
      spellings === 'all' ? [decoded, lastNameSegment(decoded), raw, lastNameSegment(raw)] : [decoded, raw];
    return candidates.some((candidate) => candidate.toUpperCase() === upper);
  });
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw ambiguousKtdNodeError(envelopeXml, wanted, byName);
  return undefined;
}

/**
 * Split a Markdown body into per-node bodies — the inverse of `decodeKtdText`.
 *
 * A line is a node boundary when "## " is followed by something `resolveKtdNodeIn` matches
 * with `HEADING_SPELLINGS` — an exact id, a case variant, or a qualified node name unique in
 * this envelope. Other headings are prose inside the current node's text, except a heading
 * that is unmistakably a node reference (an ADT URI, a `#type=` fragment, or
 * `<KnownQualifier>.<anything>`) yet matches no element: that is a typo or a node that does
 * not exist yet, and it is refused rather than folded into a neighbouring node's text.
 *
 * Returns undefined when the body addresses no node (single-node KTD, or a freshly
 * created one); the caller then treats the whole body as that one node's text.
 */
function splitKtdMarkdownByElementId(
  envelopeXml: string,
  markdown: string,
  elements: KtdElement[],
): Map<string, string> | undefined {
  const known = elements.filter((element) => element.id);
  const qualifiers = new Set(
    known
      .map((element) => ktdNodeQualifiedName(element.id))
      .filter((name) => name.includes('.'))
      .map((name) => name.slice(0, name.lastIndexOf('.')).toUpperCase()),
  );
  const looksLikeNodeRef = (id: string): boolean =>
    id.startsWith('/sap/bc/adt/') ||
    id.includes('#type=') ||
    (id.includes('.') && qualifiers.has(id.slice(0, id.lastIndexOf('.')).toUpperCase()));

  const lines = markdown.split(/\r?\n/);
  const headings: Array<{ line: number; id: string }> = [];
  const unknown: string[] = [];

  lines.forEach((line, index) => {
    const id = line.match(HEADING_LINE)?.[1].trim();
    if (!id || known.length === 0) return;
    // An ambiguous qualified name throws here with the candidates.
    const resolved = resolveKtdNodeIn(envelopeXml, elements, id, HEADING_SPELLINGS);
    if (resolved) headings.push({ line: index, id: resolved.id });
    else if (looksLikeNodeRef(id)) unknown.push(id);
  });

  if (unknown.length > 0) throw unknownKtdNodeError(unknown, envelopeXml, elements);
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
    bodies.set(
      heading.id,
      lines
        .slice(heading.line + 1, until)
        .join('\n')
        .trim(),
    );
  });
  return bodies;
}

function setKtdElementText(element: KtdElement, markdown: string): string {
  const spliced = spliceKtdTextBody(element.xml, markdown);
  if (spliced !== undefined) return spliced;
  throw new Error(
    `KTD node "${element.id}" has no <sktd:text> element to write into. SAP gives every documentable ` +
      `node an (initially empty) <sktd:text/>, so an element without one is not a documentation target; ` +
      `ARC-1 does not synthesize one.`,
  );
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
