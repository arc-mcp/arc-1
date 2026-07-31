/** Long SAPWrite descriptions kept separate from the schema builder's line-budgeted implementation. */

/**
 * Opening line for SAPWrite. The description used to begin with MINIMAL PAYLOAD — ~1,100 characters
 * of argument hygiene — so a model choosing a tool read a lecture about null values before learning
 * what the tool is for. Leading with purpose is the documentation fix; no routing-accuracy claim is
 * attached to it.
 *
 * Composed into the exported descriptions below rather than in tools.ts, which is line-budgeted.
 */
const SAPWRITE_LEAD =
  'Change ABAP objects in the SAP system: create, update, delete, and targeted source edits. Use it ' +
  'when the request is to PERSIST a change — write, add, implement, refactor, or remove ABAP code ' +
  'or DDIC metadata. Reading is SAPRead; searching is SAPSearch; dependency analysis is SAPContext; ' +
  'checking or formatting source without saving it is SAPLint or SAPDiagnose. ';

const SAPWRITE_BODY_ONPREM =
  'Create or update ABAP source code and DDIC metadata. Handles lock/modify/unlock automatically. Supports PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL, TABL/DT, TABL/DS, TTYP (rowType + optional rowTypeKind), DOMA, DTEL, MSAG. ' +
  'Type codes are auto-normalized and case-insensitive (e.g., "CLAS/OC" → "CLAS"). For delete, only type and name are required (plus optional transport). ' +
  'Source objects (PROG/CLAS/INTF/DDLS/DCLS/DDLX/BDEF/SRVD/TABL/INCL) write via /source/main. CLAS update: pass include=definitions|implementations|macros|testclasses to write a local include; omit for source/main. ' +
  'TABL create: "TABL"/"TABL/DT" → transparent table (16-char name); "TABL/DS" → structure (30-char, namespaces OK); update/delete/activate auto-discover the subtype. ' +
  'Metadata-XML writes (not /source/main): DOMA/DTEL (dataType, length, fixedValues, typeKind, labels, searchHelp); MSAG (messages array of {number, shortText}); SRVB (serviceDefinition, odataVersion V2/V4, optional category 0=UI/1=Web API; bindingType like "ODataV4-UI" auto-normalized). ' +
  'SKTD/KTD (Markdown docs on a KTD-capable object; KTD aliases SKTD): create needs refObjectType (parent type+subtype, e.g. "DDLS/DF"); "name" MUST equal the parent name; update takes Markdown in source; then SAPActivate(type="SKTD"). ' +
  // "group"/FUGR-must-exist and processingType live on their own property descriptions — not repeated here.
  'FUNC: needs "group"; pass structured `parameters` for the signature (read back via SAPRead includeSignature=true). ' +
  "INCL with group=: create/delete FUGR structural includes (name must start with L<GROUP>, e.g. LZFOOF01); SAP maintains the main program's INCLUDE line. " +
  'edit_method: replace one CLAS method body via source (95% fewer tokens than full-class). Local-class methods use the qualified specifier (e.g. "lhc_project~approve_project"); auto-routing: lhc_*/lcl_* → implementations, ltc_* → testclasses (override with include=); zif_*~* stays on /source/main. ' +
  'edit_unit: replace one FORM/MODULE block in PROG/INCL using unit+source; group= supports FUGR includes. ' +
  'batch_create: create+activate multiple objects in dependency order via the "objects" array (RAP stacks TABL→DDLS→DCLS→BDEF→SRVD). scaffold_rap_handlers / generate_behavior_implementation: derive RAP behavior-pool handlers from the BDEF (the latter auto-discovers the BDEF via rootEntityRef and activates by default). ' +
  'Server-driven objects (discovery-gated): DESD/CSNM/EVTB/EVTO/COTA/UIAD take AFF JSON in "source"; DTSC/DSFD/DTDC take DDL text — create/update/delete, then SAPActivate. ' +
  'edit_text_symbols (type=CLAS): write a global class\'s text symbols. Pass the body in "source" as per-symbol "@MaxLength:NN\\n{NNN}={text}\\n" (blank-line separated); immediately active, no SAPActivate. Read it back via SAPRead(type=CLAS, include=text_symbols). Requires the ADT textelements service (absent on NW 7.50). ' +
  'Full per-type field reference: docs_page SAPWrite. ';

const SAPWRITE_BODY_BTP =
  'Create or update ABAP source code and DDIC metadata (BTP ABAP Environment). Handles lock/modify/unlock automatically. Supports CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD/KTD, TABL, TABL/DT, TABL/DS, DOMA, DTEL, MSAG. ' +
  'Must use ABAP Cloud language version (no classic statements); only Z*/Y* namespace. Type codes are auto-normalized (e.g. "CLAS/OC" → "CLAS"). For delete, only type and name are required (plus optional transport). ' +
  'Source objects (CLAS/INTF/DDLS/DCLS/DDLX/BDEF/SRVD/TABL) write via /source/main. CLAS update: pass include=definitions|implementations|macros|testclasses for a local include; omit for source/main. ' +
  'Metadata-XML writes (not /source/main): DOMA/DTEL (dataType, length, fixedValues, typeKind, labels, searchHelp); MSAG (messages array of {number, shortText}); SRVB (serviceDefinition, odataVersion V2/V4, optional category 0=UI/1=Web API). ' +
  'SKTD/KTD (Markdown docs on a KTD-capable object; KTD aliases SKTD): create needs refObjectType (e.g. "DDLS/DF"); "name" MUST equal the parent name; update takes Markdown in source; then SAPActivate(type="SKTD"). ' +
  'edit_method: replace one CLAS method body via source. Local-class methods use the qualified specifier (e.g. "lhc_project~approve_project"); auto-routing lhc_*/lcl_* → implementations, ltc_* → testclasses (override with include=). ' +
  'batch_create: create+activate multiple objects in dependency order (RAP stacks TABL→DDLS→DCLS→BDEF→SRVD). scaffold_rap_handlers / generate_behavior_implementation: derive RAP behavior-pool handlers from the BDEF (the latter auto-discovers via rootEntityRef and activates by default). ' +
  'Server-driven objects (discovery-gated): DESD/CSNM/EVTB/EVTO/COTA/UIAD take AFF JSON in "source"; DTSC/DSFD/DTDC take DDL text — create/update/delete, then SAPActivate. ' +
  'Full per-type field reference: docs_page SAPWrite. ';

// Appended to both SAPWrite descriptions (see the composition at the bottom). The schema lists every
// optional field for every object type/action, but each call uses only a small subset — GPT/OpenAI
// callers tend to fill the rest with empty/null/placeholder values. Runtime normalization is the
// backstop.
const SAPWRITE_MINIMAL_PAYLOAD_GUIDE =
  'MINIMAL PAYLOAD — send ONLY the fields your action+type needs; do NOT add unrelated optional fields. ' +
  'Sending empty strings, null, or placeholder values for fields that do not apply to your object type ' +
  '(e.g. typeKind/odataVersion/length/signExists on a CDS or class write) just adds noise — omit them entirely. ' +
  'Typical field sets: a source object (CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, TABL — plus PROG, INCL, FUNC on-prem) needs only {action, type, name, source}; ' +
  "delete needs only {action, type, name}; DOMA/DTEL/MSAG/SRVB need {action, type, name} plus that type's own DDIC fields; FUNC also needs group. " +
  'Do NOT send `include` unless type=CLAS, and do NOT send DDIC/metadata fields (dataType, length, decimals, signExists, lowercase, typeKind, domainName, odataVersion, category, version, labels, …) on a source-object or delete call. ';

// Purpose first, per-type reference, then payload hygiene last: the guide is call-time guidance and
// does not belong where a model is deciding which tool to pick.
export const SAPWRITE_DESC_ONPREM = SAPWRITE_LEAD + SAPWRITE_BODY_ONPREM + SAPWRITE_MINIMAL_PAYLOAD_GUIDE;
export const SAPWRITE_DESC_BTP = SAPWRITE_LEAD + SAPWRITE_BODY_BTP + SAPWRITE_MINIMAL_PAYLOAD_GUIDE;
