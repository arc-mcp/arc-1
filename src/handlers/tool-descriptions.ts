/** Long SAPWrite descriptions kept separate from the schema builder's line-budgeted implementation. */

export const SAPWRITE_DESC_ONPREM =
  'Create or update ABAP source code and DDIC metadata. Handles lock/modify/unlock automatically. Supports PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL, TABL/DT, TABL/DS, DOMA, DTEL, MSAG. ' +
  'Type codes are auto-normalized and case-insensitive (e.g., "CLAS/OC" → "CLAS"). For delete, only type and name are required (plus optional transport). ' +
  'Source objects (PROG/CLAS/INTF/DDLS/DCLS/DDLX/BDEF/SRVD/TABL/INCL) write via /source/main. CLAS update: pass include=definitions|implementations|macros|testclasses to write a local include; omit for source/main. ' +
  'TABL create: "TABL"/"TABL/DT" → transparent table (16-char name); "TABL/DS" → structure (30-char, namespaces OK); update/delete/activate auto-discover the subtype. ' +
  'Metadata-XML writes (not /source/main): DOMA/DTEL (dataType, length, fixedValues, typeKind, labels, searchHelp); MSAG (messages array of {number, shortText}); SRVB (serviceDefinition, odataVersion V2/V4, optional category 0=UI/1=Web API; bindingType like "ODataV4-UI" auto-normalized). ' +
  'SKTD/KTD (Markdown docs on a KTD-capable object; KTD aliases SKTD): create needs refObjectType (parent type+subtype, e.g. "DDLS/DF"); "name" MUST equal the parent name; update takes Markdown in source; then SAPActivate(type="SKTD"). ' +
  'FUNC: require "group" (parent FUGR must exist — create it first); pass structured `parameters` for the signature (read back via SAPRead includeSignature=true). ' +
  'edit_method: replace one CLAS method body via source (95% fewer tokens than full-class). Local-class methods use the qualified specifier (e.g. "lhc_project~approve_project"); auto-routing: lhc_*/lcl_* → implementations, ltc_* → testclasses (override with include=); zif_*~* stays on /source/main. ' +
  'edit_unit: replace one FORM/MODULE block in PROG/INCL using unit+source; group= supports FUGR includes. ' +
  'batch_create: create+activate multiple objects in dependency order via the "objects" array (RAP stacks TABL→DDLS→DCLS→BDEF→SRVD). scaffold_rap_handlers / generate_behavior_implementation: derive RAP behavior-pool handlers from the BDEF (the latter auto-discovers the BDEF via rootEntityRef and activates by default). ' +
  'Server-driven objects (SAP_BASIS 8.16+, discovery-gated): DESD, DTSC, CSNM, EVTB, EVTO, COTA — create/update/delete with AFF JSON in "source", then SAPActivate; pre-8.16 returns a clean "requires 8.16+" error. ' +
  'edit_text_symbols (type=CLAS): write a global class\'s text symbols. Pass the body in "source" as per-symbol "@MaxLength:NN\\n{NNN}={text}\\n" (blank-line separated); immediately active, no SAPActivate. Read it back via SAPRead(type=CLAS, include=text_symbols). Requires the ADT textelements service (absent on NW 7.50). ' +
  'Full per-type field reference: docs_page SAPWrite. ';

export const SAPWRITE_DESC_BTP =
  'Create or update ABAP source code and DDIC metadata (BTP ABAP Environment). Handles lock/modify/unlock automatically. Supports CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL, TABL/DT, TABL/DS, DOMA, DTEL, MSAG. ' +
  'Must use ABAP Cloud language version (no classic statements); only Z*/Y* namespace. Type codes are auto-normalized (e.g. "CLAS/OC" → "CLAS"). For delete, only type and name are required (plus optional transport). ' +
  'Source objects (CLAS/INTF/DDLS/DCLS/DDLX/BDEF/SRVD/TABL) write via /source/main. CLAS update: pass include=definitions|implementations|macros|testclasses for a local include; omit for source/main. ' +
  'Metadata-XML writes (not /source/main): DOMA/DTEL (dataType, length, fixedValues, typeKind, labels, searchHelp); MSAG (messages array of {number, shortText}); SRVB (serviceDefinition, odataVersion V2/V4, optional category 0=UI/1=Web API). ' +
  'SKTD/KTD (Markdown docs on a KTD-capable object; KTD aliases SKTD): create needs refObjectType (e.g. "DDLS/DF"); "name" MUST equal the parent name; update takes Markdown in source; then SAPActivate(type="SKTD"). ' +
  'edit_method: replace one CLAS method body via source. Local-class methods use the qualified specifier (e.g. "lhc_project~approve_project"); auto-routing lhc_*/lcl_* → implementations, ltc_* → testclasses (override with include=). ' +
  'batch_create: create+activate multiple objects in dependency order (RAP stacks TABL→DDLS→DCLS→BDEF→SRVD). scaffold_rap_handlers / generate_behavior_implementation: derive RAP behavior-pool handlers from the BDEF (the latter auto-discovers via rootEntityRef and activates by default). ' +
  'Server-driven objects (8.16+, discovery-gated): DESD, DTSC, CSNM, EVTB, EVTO, COTA — create/update/delete with AFF JSON in "source", then SAPActivate; pre-8.16 returns a clean "requires 8.16+" error. ' +
  'Full per-type field reference: docs_page SAPWrite. ';

// Prepended to both SAPWrite descriptions. The schema lists every optional field for every
// object type/action, but each call uses only a small subset — GPT/OpenAI callers tend to
// fill the rest with empty/null/placeholder values. Runtime normalization is the backstop.
export const SAPWRITE_MINIMAL_PAYLOAD_GUIDE =
  'MINIMAL PAYLOAD — send ONLY the fields your action+type needs; do NOT add unrelated optional fields. ' +
  'Sending empty strings, null, or placeholder values for fields that do not apply to your object type ' +
  '(e.g. typeKind/odataVersion/length/signExists on a CDS or class write) just adds noise — omit them entirely. ' +
  'Typical field sets: a source object (CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, TABL — plus PROG, INCL, FUNC on-prem) needs only {action, type, name, source}; ' +
  "delete needs only {action, type, name}; DOMA/DTEL/MSAG/SRVB need {action, type, name} plus that type's own DDIC fields; FUNC also needs group. " +
  'Do NOT send `include` unless type=CLAS, and do NOT send DDIC/metadata fields (dataType, length, decimals, signExists, lowercase, typeKind, domainName, odataVersion, category, version, labels, …) on a source-object or delete call. ';
