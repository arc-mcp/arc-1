/** Shared legacy/private KTD create contract; unknown parent types remain refused. */
import { normalizeAdtLanguage } from '../../adt/ddic-xml.js';
import { escapeXmlAttr } from '../../adt/xml-parser.js';
import { objectBasePath } from '../object-types.js';

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
  'SMBC/TYP',
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
  'SOD1',
  'SOD2',
]);

export const KTD_REF_OBJECT_TYPES_HINT = 'DDLS/DF, BDEF/BDO, SRVD/SRV, SRVB/SVB, DEVC/K, SMBC/TYP';
const KTD_SAP_DOCUMENTATION_SCOPE_HINT =
  'APIC/TYP, BDEF/*, CFDB/CFB, CFDG/CFG, CFDS/CFS, CHKO/TYP, DDLA/ADF, DDLS/DF, DEVC/K, ' +
  'DRTY/STY, DSFD/SCF, EEEC/EVC, EVTB/EVB, PARA/R, RONT/ROT, SMBC/TYP, SOD1, SOD2, ' +
  'SRVB/SVB, SRVD/SRV';

export function normalizeKtdRefObjectType(refObjectType: string): string {
  return refObjectType.trim().toUpperCase();
}

export function validateKtdRefObjectType(refObjectType: string): string | undefined {
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

export function buildKtdCreateXml(
  name: string,
  pkg: string,
  refType: string,
  refName: string,
  refDescription: string,
  language: string,
): string {
  const refUri = `${objectBasePath(refType.split('/')[0]!)}${encodeURIComponent(refName.toLowerCase())}`;
  const refDescriptionAttr = refDescription.trim() ? ` adtcore:description="${escapeXmlAttr(refDescription)}"` : '';
  const ktdLang = normalizeAdtLanguage(language);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:language="${ktdLang}" adtcore:name="${escapeXmlAttr(name)}" adtcore:type="SKTD/TYP" adtcore:masterLanguage="${ktdLang}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
  <sktd:refObject${refDescriptionAttr} adtcore:name="${escapeXmlAttr(refName)}" adtcore:type="${escapeXmlAttr(refType)}" adtcore:uri="${escapeXmlAttr(refUri)}"/>
</sktd:docu>`;
}
