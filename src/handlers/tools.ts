/**
 * Tool definitions for ARC-1's 12 intent-based MCP tools.
 *
 * Each tool has:
 * - name: The MCP tool name (SAPRead, SAPWrite, etc.)
 * - description: Rich LLM-friendly description
 * - inputSchema: JSON Schema for tool arguments
 *
 * The 12 intent-based design is ARC-1's key differentiator:
 * instead of 200+ individual tools (one per object type per operation),
 * we group by *intent* with a `type` parameter for routing.
 * This keeps the LLM's tool selection simple and the context window small.
 *
 * Tool definitions adapt based on system type (BTP vs on-premise):
 * - BTP ABAP Environment: removes unavailable types (PROG, INCL, VIEW,
 *   TEXT_ELEMENTS, VARIANTS), adjusts descriptions for restricted features
 * - On-premise: full tool set with all types and descriptions
 */

import type { ResolvedFeatures } from '../adt/types.js';
import type { ServerConfig } from '../server/types.js';
import { getHyperfocusedToolDefinition } from './hyperfocused.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Check if tools should use BTP-adapted definitions */
function isBtpMode(config: ServerConfig): boolean {
  return config.systemType === 'btp';
}

// ─── SAPRead Types ──────────────────────────────────────────────────

/** All SAPRead types available on on-premise */
const SAPREAD_TYPES_ONPREM = [
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
  'SRVB',
  'SKTD',
  'TABL',
  'VIEW',
  'DOMA',
  'DTEL',
  'TRAN',
  'TABLE_CONTENTS',
  'DEVC',
  'SOBJ',
  'SYSTEM',
  'COMPONENTS',
  'MESSAGES',
  'TEXT_ELEMENTS',
  'VARIANTS',
  'BSP',
  'BSP_DEPLOY',
  'API_STATE',
  'INACTIVE_OBJECTS',
  'AUTH',
  'FTG2',
  'ENHO',
  'VERSIONS',
  'VERSION_SOURCE',
];

/** SAPRead types available on BTP ABAP Environment (no PROG, INCL, VIEW, TEXT_ELEMENTS, VARIANTS) */
const SAPREAD_TYPES_BTP = [
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'DOMA',
  'DTEL',
  'TABLE_CONTENTS',
  'DEVC',
  'SYSTEM',
  'COMPONENTS',
  'MESSAGES',
  'BSP',
  'BSP_DEPLOY',
  'API_STATE',
  'INACTIVE_OBJECTS',
];

const SAPREAD_DESC_ONPREM =
  'Read SAP ABAP objects. Types: PROG, CLAS, INTF, FUNC, FUGR (use expand_includes=true to get all include sources), INCL, DDLS, DDLX (CDS metadata extensions — UI annotations), BDEF, SRVD, SRVB (service bindings — returns structured binding info: OData version, publish status, service definition ref), SKTD (Knowledge Transfer Documents — Markdown documentation attached to ABAP objects like CDS views, BDEFs, classes), TABL (DDIC TABL — covers transparent tables like T000 AND DDIC structures like BAPIRET2; returns CDS-like source. ARC-1 auto-resolves the URL: tries /sap/bc/adt/ddic/tables/ first, falls back to /sap/bc/adt/ddic/structures/. Note: there is no separate STRU type — TABL is the canonical short type for both, mirroring TADIR R3TR TABL and abapGit conventions), VIEW, DOMA (DDIC domains — returns type info, value table, fixed values), DTEL (data elements — returns domain, labels, search help), TRAN (transaction codes — returns description, program, package), TABLE_CONTENTS, DEVC, SOBJ (BOR business objects — returns method catalog or full implementation), SYSTEM, COMPONENTS, MESSAGES, TEXT_ELEMENTS, VARIANTS. For CLAS: omit include to get the full class source (definition + implementation combined). The include param is optional — use it only to read class-local sections: definitions (local types), implementations (local helper classes), macros, testclasses (ABAP Unit). For CLAS with method param: use method="*" to list all methods with signatures and visibility, or method="method_name" to read a single method implementation (95% fewer tokens than full source). For SOBJ: returns BOR method catalog; use method param to read a specific method implementation. BSP (deployed UI5/Fiori apps — list apps, browse files, read content; use name to browse app structure, include for subfolder or file), BSP_DEPLOY (query deployed UI5 apps via ABAP Repository OData Service — returns name, package, description). API_STATE (API release state — checks if an object is released for ABAP Cloud / S/4HANA Clean Core; returns contract states C0-C4, successor info; use objectType param for non-class objects). INACTIVE_OBJECTS (list all objects pending activation — no name param needed; use before SAPActivate batch_activate to see what needs activating). AUTH (Authorization Fields — returns check table, domain, conversion exit, org-level flags; on-prem only). FTG2 (Feature Toggles — returns current toggle state per system from SAP switch framework; on-prem only). ENHO (Enhancement Implementations / BAdI — returns technology type, referenced enhancement object, and BAdI implementations with implementing classes; on-prem only). VERSIONS (list revision history of an object — returns JSON with object metadata and revisions [{id, author, timestamp, versionTitle?, transport?, uri}]; pass optional include for CLAS or group for FUNC; on-prem only and may return 404 for some DDIC types on non-S/4 backends). VERSION_SOURCE (fetch source at a specific revision URI from VERSIONS response; returns raw source text; on-prem only). ' +
  'Optional version parameter (default "active"): set to "inactive" to read the user\'s unactivated draft, or "auto" for the developer view. Active reads include a note when an inactive draft exists.';

const SAPREAD_DESC_BTP =
  'Read SAP ABAP objects (BTP ABAP Environment). Types: CLAS, INTF, FUNC (released/custom only), FUGR (released/custom only), DDLS (CDS views — primary data model on BTP), DDLX (CDS metadata extensions — UI annotations for Fiori Elements), BDEF (RAP behavior definitions), SRVD (service definitions), SRVB (service bindings — returns structured binding info: OData version, publish status, service definition ref), SKTD (Knowledge Transfer Documents — Markdown documentation attached to ABAP objects like CDS views, BDEFs, classes), TABL (DDIC TABL — covers both custom transparent tables AND DDIC structures; returns CDS-like source. ARC-1 auto-resolves /tables/ vs /structures/ via fallback. Note: there is no separate STRU type — TABL is the canonical short type for both), DOMA (DDIC domains — type info, value table, fixed values), DTEL (data elements — domain, labels, search help), TABLE_CONTENTS (custom tables and released CDS only — SAP standard tables are blocked), DEVC, SYSTEM, COMPONENTS, MESSAGES (custom message classes only). For CLAS: omit include to get the full class source. The include param reads class-local sections: definitions, implementations, macros, testclasses. For CLAS with method param: use method="*" to list all methods with signatures and visibility, or method="method_name" to read a single method (95% fewer tokens). Note: PROG, INCL, VIEW, TRAN, TEXT_ELEMENTS, VARIANTS are not available on BTP — use CLAS with IF_OO_ADT_CLASSRUN for console applications, and DDLS for data models instead of classic views. VERSIONS and VERSION_SOURCE are currently on-prem only in ARC-1 and are intentionally not exposed on BTP yet. BSP (deployed UI5/Fiori apps — list apps, browse files, read content; use name to browse app structure, include for subfolder or file), BSP_DEPLOY (query deployed UI5 apps via ABAP Repository OData Service — returns name, package, description). API_STATE (API release state — checks if an object is released for ABAP Cloud / Clean Core; returns contract states C0-C4, successor info; essential for cloud development; use objectType param for non-class objects). INACTIVE_OBJECTS (list all objects pending activation — no name param needed; use before SAPActivate batch_activate to see what needs activating). ' +
  'Optional version parameter (default "active"): set to "inactive" to read the user\'s unactivated draft, or "auto" for the developer view. Active reads include a note when an inactive draft exists.';

// ─── SAPWrite Types ─────────────────────────────────────────────────

const SAPWRITE_TYPES_ONPREM = [
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'TABL',
  'DOMA',
  'DTEL',
  'MSAG',
];
const SAPWRITE_TYPES_BTP = [
  'CLAS',
  'INTF',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'DOMA',
  'DTEL',
  'MSAG',
];

const SAPWRITE_DESC_ONPREM =
  'Create or update ABAP source code and DDIC metadata. Handles lock/modify/unlock automatically. Supports PROG, CLAS, INTF, FUNC, INCL, DDLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, DOMA, DTEL, MSAG. ' +
  'Type codes are auto-normalized and case-insensitive (e.g., "CLAS/OC" → "CLAS"). ' +
  'TABL uses source-based writes via /source/main (define table syntax), similar to DDLS/BDEF/SRVD. ' +
  'DOMA/DTEL use metadata XML writes (not /source/main): provide DDIC fields like dataType, length, fixedValues, typeKind, labels, searchHelp. ' +
  'MSAG (message classes) use metadata XML writes: provide "messages" array with {number, shortText} entries. Create empty then update, or provide messages at creation. ' +
  'SRVB (service bindings) use metadata XML writes: provide serviceDefinition (SRVD name), odataVersion ("V2"/"V4"), optional category (0=UI, 1=Web API). ' +
  'bindingType accepts human-readable values like "ODataV4-UI" which are auto-normalized. ' +
  'SKTD (Knowledge Transfer Documents, Markdown docs attached to an ABAP object): create requires refObjectType (parent ADT type+subtype, e.g., "DDLS/DF"). A KTD inherits the name of the object it documents — so "name" MUST equal the parent object name (one KTD per object; refObjectName defaults to name and cannot differ). Update takes Markdown in "source"; delete uses the ADT deletion framework (two-step check/delete). Follow creates/updates with SAPActivate(type="SKTD", name="..."). ' +
  'For edit_method: surgically replace a single method body in a CLAS without sending the full class source. ' +
  'Provide just the new method implementation code in "source" — 95% fewer tokens than full-class updates. ' +
  'For batch_create: create and activate multiple objects in a single call — ideal for RAP stacks (TABL → DDLS → DCLS → BDEF → SRVD). Pass "objects" array with dependency order. ' +
  'For scaffold_rap_handlers: derive missing RAP behavior handler signatures from an interface BDEF and optionally inject declarations plus empty implementation stubs into an existing behavior pool class.';

const SAPWRITE_DESC_BTP =
  'Create or update ABAP source code and DDIC metadata (BTP ABAP Environment). Handles lock/modify/unlock automatically. Supports CLAS, INTF, DDLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, DOMA, DTEL, MSAG. ' +
  'Type codes are auto-normalized and case-insensitive (e.g., "CLAS/OC" → "CLAS"). ' +
  'TABL supports custom table source writes via /source/main (define table syntax). ' +
  'DOMA/DTEL use metadata XML writes (not /source/main): provide DDIC fields like dataType, length, fixedValues, typeKind, labels, searchHelp. ' +
  'MSAG (message classes) use metadata XML writes: provide "messages" array with {number, shortText} entries. ' +
  'SRVB (service bindings) use metadata XML writes: provide serviceDefinition (SRVD name), odataVersion ("V2"/"V4"), optional category (0=UI, 1=Web API). ' +
  'bindingType accepts human-readable values like "ODataV4-UI" which are auto-normalized. ' +
  'SKTD (Knowledge Transfer Documents, Markdown docs attached to an ABAP object): create requires refObjectType (parent ADT type+subtype, e.g., "DDLS/DF"). A KTD inherits the name of the object it documents — so "name" MUST equal the parent object name (one KTD per object; refObjectName defaults to name and cannot differ). Update takes Markdown in "source"; delete uses the ADT deletion framework (two-step check/delete). Follow creates/updates with SAPActivate(type="SKTD", name="..."). ' +
  'Must use ABAP Cloud language version (no classic statements). Only Z*/Y* namespace allowed on BTP. ' +
  'For edit_method: surgically replace a single method body in a CLAS without sending the full class source. ' +
  'For batch_create: create and activate multiple objects in a single call — ideal for RAP stacks (TABL → DDLS → DCLS → BDEF → SRVD). ' +
  'For scaffold_rap_handlers: derive missing RAP behavior handler signatures from an interface BDEF and optionally inject declarations plus empty implementation stubs into an existing behavior pool class.';

// ─── SAPContext Types ───────────────────────────────────────────────

const SAPCONTEXT_TYPES_ONPREM = ['CLAS', 'INTF', 'PROG', 'FUNC', 'DDLS'];
const SAPCONTEXT_TYPES_BTP = ['CLAS', 'INTF', 'DDLS'];

const SAPCONTEXT_DESC_ONPREM =
  'Get compressed dependency context or CDS blast-radius impact for an ABAP / CDS object.\n\n' +
  "Decision rule — pick the action based on the user's question:\n" +
  '- "What breaks if I change <CDS view>?" / "Who consumes <I_*>?" / "Impact analysis on <DDLS>" / "Blast radius" → action="impact"\n' +
  '- "Understand dependencies before editing <object>" / "What does X depend on?" → action="deps" (default)\n' +
  '- "Find all callers of <object>" (cache-warmup required) → action="usages"\n\n' +
  'action="impact" (CDS blast-radius, DDLS only): ALWAYS use this for CDS change-impact questions. Returns upstream AST dependencies plus downstream where-used results classified into RAP-aware buckets: projectionViews, bdefs, serviceDefinitions, serviceBindings, accessControls (DCLS), metadataExtensions (DDLX), abapConsumers, documentation (SKTD), tables, other. Also emits additive sibling-consistency diagnostics (consistencyHints + siblingExtensionAnalysis) when sibling DDLS variants in the same package show asymmetric metadata-extension coverage. DO NOT replicate this with SAPQuery against DDDDLSRC/ACMDCLSRC/DDLXSRC_SRC/SRVDSRC_SRC — those text scans produce noise (non-dependency matches, package group nodes) that this classifier already filters out. Optional includeIndirect=true widens to transitive consumers. Optional siblingCheck=false disables sibling analysis; siblingMaxCandidates controls fan-out (default 4, hard cap 10).\n\n' +
  'action="deps" (default): Returns only the public API contracts (method signatures, interface definitions, type declarations) of all objects that the target depends on — NOT the full source code. The most token-efficient way to understand dependencies. Instead of N separate SAPRead calls returning full source (~200 lines each), returns ONE response with compressed contracts (~15-30 lines each). Typical compression: 7-30x fewer tokens.\n\n' +
  'What deps extracts per dependency:\n' +
  '- Classes: CLASS DEFINITION with PUBLIC SECTION only (methods, types, constants). PROTECTED, PRIVATE and IMPLEMENTATION stripped.\n' +
  '- Interfaces: Full interface definition (interfaces are already public contracts).\n' +
  '- Function modules: FUNCTION signature block only (IMPORTING/EXPORTING parameters).\n' +
  '- CDS views (DDLS): All data sources (tables, other CDS views), association targets, and compositions. ' +
  "Each dependency's full source is included (table definitions, CDS DDL). Essential for CDS unit test generation — " +
  'provides the dependency graph and field catalogs needed for cl_cds_test_environment doubles.\n\n' +
  'Filtering (deps): SAP standard objects (CL_ABAP_*, IF_ABAP_*, CX_SY_*) are excluded. Custom objects (Z*, Y*) are prioritized.\n\n' +
  'Use SAPContext BEFORE writing code that modifies or extends existing objects. ' +
  'Use SAPRead to get the full source of the target object, then SAPContext to understand its dependencies.\n\n' +
  'For non-CDS reverse-lookup, use SAPNavigate(action="references"). For CDS reverse-lookup, ALWAYS prefer action="impact" over SAPNavigate — it returns the same where-used data pre-classified into RAP buckets.';

const SAPCONTEXT_DESC_BTP =
  'Get compressed dependency context or CDS blast-radius impact for an ABAP / CDS object (BTP ABAP Environment).\n\n' +
  "Decision rule — pick the action based on the user's question:\n" +
  '- "What breaks if I change <CDS view>?" / "Who consumes <I_*>?" / "Impact analysis on <DDLS>" / "Blast radius" → action="impact"\n' +
  '- "Understand dependencies before editing <object>" / "What does X depend on?" → action="deps" (default)\n\n' +
  'action="impact" (CDS blast-radius, DDLS only): ALWAYS use this for CDS change-impact questions. Returns upstream AST dependencies plus downstream where-used results classified into RAP-aware buckets: projectionViews, bdefs, serviceDefinitions, serviceBindings, accessControls (DCLS), metadataExtensions (DDLX), abapConsumers, documentation (SKTD), tables, other. Also emits additive sibling-consistency diagnostics (consistencyHints + siblingExtensionAnalysis) when sibling DDLS variants in the same package show asymmetric metadata-extension coverage. DO NOT replicate this with SAPQuery — the classifier already filters noise. Optional includeIndirect=true widens to transitive consumers. Optional siblingCheck=false disables sibling analysis; siblingMaxCandidates controls fan-out (default 4, hard cap 10).\n\n' +
  'action="deps" (default): Returns only the public API contracts (method signatures, interface definitions, type declarations) of all objects that the target depends on — NOT the full source code.\n\n' +
  'What deps extracts per dependency:\n' +
  '- Classes: CLASS DEFINITION with PUBLIC SECTION only (methods, types, constants).\n' +
  '- Interfaces: Full interface definition (interfaces are already public contracts).\n' +
  '- CDS views (DDLS): All data sources (tables, other CDS views), association targets, and compositions. ' +
  "Each dependency's full source is included. Essential for CDS unit test generation.\n\n" +
  'On BTP: released SAP objects (CL_ABAP_*, IF_ABAP_*) are included since they form the primary development API surface. ' +
  'Custom objects (Z*, Y*) are also included.\n\n' +
  'Use SAPContext BEFORE writing code that modifies or extends existing objects.';

// ─── SAPQuery ───────────────────────────────────────────────────────

const SAPQUERY_DESC_ONPREM =
  'Execute ABAP SQL queries against SAP tables. Returns structured data with column names and rows. ' +
  'Powerful for reverse-engineering: query metadata tables like DD02L (table catalog), DD03L (field catalog), ' +
  'SWOTLV (BOR method implementations), TADIR (object directory), TFDIR (function modules). ' +
  'If a table is not found, similar table names will be suggested automatically. ' +
  'Note: Uses the ADT freestyle SQL endpoint (same family as ADT SQL Console in Eclipse). ABAP SQL language supports JOINs and subqueries, but this endpoint parser can reject valid-looking statements on some backend versions (for example grammar errors, single-SELECT enforcement). If parsing fails, simplify to one SELECT and split multi-table logic into staged single-table queries (SAP Note 3605050).\n\n' +
  'CDS impact analysis: DO NOT query DDDDLSRC, ACMDCLSRC, DDLXSRC_SRC, or SRVDSRC_SRC to find CDS consumers — those text scans produce noise (substring matches, package group nodes, generated patterns). Use SAPContext(action="impact", type="DDLS", name="...") instead — it uses SAP\'s where-used index and returns bucketed, filtered results (projection views, BDEFs, SRVDs, access controls, documentation, ABAP consumers).';

const SAPQUERY_DESC_BTP =
  'Execute ABAP SQL queries (BTP ABAP Environment). Returns structured data with column names and rows. ' +
  'IMPORTANT: On BTP, only custom Z/Y tables and released CDS entities can be queried. ' +
  'SAP standard tables (MARA, VBAK, DD02L, DD03L, TADIR, etc.) are blocked. ' +
  'Use released CDS views instead: I_LANGUAGE, I_COUNTRY, I_CURRENCY, I_UnitOfMeasure, etc. ' +
  'If a table is not found, similar table names will be suggested automatically.';

// ─── SAPSearch ──────────────────────────────────────────────────────

const SAPSEARCH_DESC_ONPREM =
  'Search for ABAP objects or search within source code. Two modes:\n' +
  '1. Object search (default): Search by name pattern with wildcards (* for any characters). Returns object type, name, package, description, and ADT URI. Use this to find classes, programs, function modules, tables, etc.\n' +
  '2. Source code search (searchType="source_code"): Full-text search within ABAP source code across the system. Use this to find all objects containing a specific string (e.g., a method call, variable name, or class reference). Requires SAP_BASIS >= 7.51.\n\n' +
  "Tips: BOR business objects appear as SOBJ type in results. The uri field from results can be used directly with SAPNavigate for references. The objectType field from results can be passed directly to SAPRead/SAPWrite/SAPActivate (ARC-1 auto-normalizes slash suffixes like DDLS/DF, CLAS/OC, PROG/P).\n\nNote: Searches object names only (classes, tables, CDS views, etc.) — field/column names are not searchable here. To find fields by name, use SAPRead(type='DDLS', include='elements') for CDS views or SAPQuery against DD03L.";

const SAPSEARCH_DESC_BTP =
  'Search for ABAP objects or search within source code (BTP ABAP Environment). Two modes:\n' +
  '1. Object search (default): Search by name pattern with wildcards. Returns released SAP objects and custom Z/Y objects. Classic programs, includes, and DDIC views are not searchable on BTP.\n' +
  '2. Source code search (searchType="source_code"): Full-text search within ABAP source code.\n\n' +
  "Tips: On BTP, focus on classes (CL_*), interfaces (IF_*), CDS views (I_*), and custom Z/Y objects.\n\nNote: Searches object names only (classes, CDS views, etc.) — field/column names are not searchable here. To find fields by name, use SAPRead(type='DDLS', include='elements') for CDS views.";

// ─── SAPTransport ───────────────────────────────────────────────────

const SAPTRANSPORT_DESC_ONPREM =
  'Manage CTS transport requests (SE09/SE10 equivalent). ' +
  'Actions: list (defaults to current user, modifiable transports — both Workbench and Customizing), ' +
  'get (details with tasks and objects), create (K=Workbench, W=Customizing, T=Transport of Copies), ' +
  'release, delete, reassign (change owner), release_recursive (release tasks first, then parent), ' +
  'check (check if a package requires a transport — provide type, name, package), ' +
  'history (find transports referencing an object — provide type, name; read-only, works without SAP_ALLOW_TRANSPORT_WRITES). ' +
  'Transport IDs look like A4HK900123. Status: D=modifiable, R=released.';

const SAPTRANSPORT_DESC_BTP =
  'Manage transport requests (BTP ABAP Environment, SE09/SE10 equivalent). ' +
  'Actions: list (defaults to current user, modifiable transports — both Workbench and Customizing), ' +
  'get (details with tasks and objects), create (K=Workbench, W=Customizing, T=Transport of Copies), ' +
  'release, delete, reassign (change owner), release_recursive (release tasks first, then parent), ' +
  'check (check if a package requires a transport — provide type, name, package), ' +
  'history (find transports referencing an object — provide type, name; read-only, works without SAP_ALLOW_TRANSPORT_WRITES). ' +
  'On BTP, transport release triggers a gCTS push to the software component Git repository. ' +
  'Import into target systems is done via the Manage Software Components app or Cloud Transport Management Service (cTMS), not via this tool.';

// ─── SAPManage ──────────────────────────────────────────────────────

const SAPMANAGE_DESC_ONPREM =
  'Probe and report SAP system capabilities. Use this BEFORE attempting operations that depend on optional ' +
  'features (abapGit, RAP/CDS, AMDP, HANA, UI5/Fiori, CTS transports, FLP customization). Also handles package (DEVC) lifecycle operations.\n\n' +
  'Actions:\n' +
  '- "features": Get cached feature status from last probe (fast, no SAP round-trip). ' +
  'Returns which features are available, their mode (auto/on/off), and when they were last probed.\n' +
  '- "probe": Re-probe the SAP system now (runs feature probes, auth checks, and ADT discovery refresh). ' +
  'Use this on first use or if you suspect feature availability has changed.\n' +
  '- "cache_stats": Show object cache health and warmup state.\n' +
  '- "flp_list_catalogs": List FLP business catalogs.\n' +
  '- "flp_list_groups": List FLP groups.\n' +
  '- "flp_list_tiles": List tiles in a catalog (requires "catalogId").\n' +
  '- "create_package": Create a package (DEVC) via ADT packages API.\n' +
  '- "delete_package": Delete an existing package.\n' +
  '- "flp_create_catalog": Create a business catalog (requires "domainId", "title").\n' +
  '- "flp_create_group": Create a group (requires "groupId", "title").\n' +
  '- "flp_create_tile": Create a tile in a catalog (requires "catalogId", "tile").\n' +
  '- "flp_add_tile_to_group": Add a catalog tile to a group (requires "groupId", "catalogId", "tileInstanceId").\n' +
  '- "flp_delete_catalog": Delete a business catalog (requires "catalogId").\n\n' +
  'Returns JSON with features, each having: id, available (bool), mode, message, and probedAt timestamp. ' +
  'Also returns systemType ("btp" or "onprem") for understanding available capabilities. ' +
  '"available: false" means do NOT attempt operations that depend on it.';

const SAPMANAGE_DESC_BTP =
  'Probe and report SAP system capabilities (BTP ABAP Environment). ' +
  'Returns feature status and system type. Also handles package (DEVC) lifecycle operations.\n\n' +
  'Actions:\n' +
  '- "features": Get cached feature status from last probe.\n' +
  '- "probe": Re-probe the SAP system now (feature probes + discovery refresh).\n' +
  '- "cache_stats": Show object cache health and warmup state.\n' +
  '- "create_package": Create a package (DEVC) via ADT packages API.\n' +
  '- "delete_package": Delete an existing package.\n' +
  '- FLP actions: flp_list_catalogs, flp_list_groups, flp_list_tiles, flp_create_catalog, flp_create_group, flp_create_tile, flp_add_tile_to_group, flp_delete_catalog.\n\n' +
  'Returns JSON with features and systemType="btp". On BTP, RAP/CDS and transports are always available. ' +
  'abapGit, AMDP, UI5/BSP, and FLP customization may not be available depending on the BTP ABAP configuration.';

const SAPMANAGE_ACTIONS_READ = [
  'features',
  'probe',
  'cache_stats',
  'flp_list_catalogs',
  'flp_list_groups',
  'flp_list_tiles',
];
const SAPMANAGE_ACTIONS_WRITE = [
  'create_package',
  'delete_package',
  'change_package',
  'flp_create_catalog',
  'flp_create_group',
  'flp_create_tile',
  'flp_add_tile_to_group',
  'flp_delete_catalog',
];

const SAPTRANSPORT_ACTIONS_READ = ['list', 'get', 'check', 'history'];
const SAPTRANSPORT_ACTIONS_WRITE = ['create', 'release', 'delete', 'reassign', 'release_recursive'];

const SAPGIT_ACTIONS_READ = [
  'list_repos',
  'whoami',
  'config',
  'branches',
  'external_info',
  'history',
  'objects',
  'check',
];
const SAPGIT_ACTIONS_WRITE = ['stage', 'clone', 'pull', 'push', 'commit', 'switch_branch', 'create_branch', 'unlink'];

// ─── SAPGit ─────────────────────────────────────────────────────────

const SAPGIT_DESC_ONPREM =
  'Git-based ABAP repository workflows with backend auto-selection: gCTS is preferred when available, otherwise abapGit bridge is used. ' +
  'Actions: list_repos (both), whoami/config/branches/history/objects (gCTS only), external_info/check/stage/push (abapGit only), clone/pull/commit/switch_branch/create_branch/unlink (backend-specific implementation). ' +
  'Use backend="gcts" or backend="abapgit" to force a backend. Write actions require SAP_ALLOW_WRITES=true, SAP_ALLOW_GIT_WRITES=true, git scope, and package allowlist compliance.';

const SAPGIT_DESC_BTP =
  'Git-based ABAP repository workflows for BTP ABAP and S/4 systems. Backend auto-selection prefers gCTS and falls back to abapGit bridge when gCTS is unavailable. ' +
  'Actions: list_repos (both), whoami/config/branches/history/objects (gCTS only), external_info/check/stage/push (abapGit only), clone/pull/commit/switch_branch/create_branch/unlink (backend-specific implementation). ' +
  'Use backend="gcts" or backend="abapgit" to force a backend. Write actions require SAP_ALLOW_WRITES=true, SAP_ALLOW_GIT_WRITES=true, git scope, and package allowlist compliance.';

// ─── SAPSearch Builder ─────────────────────────────────────────────

/** Strip source_code-specific lines from a SAPSearch description when textSearch is unavailable */
function stripSourceCodeLines(desc: string): string {
  return desc
    .split('\n')
    .filter(
      (line) =>
        !line.includes('source_code') &&
        !line.includes('Source code search') &&
        !line.startsWith('2. Source code search'),
    )
    .join('\n')
    .replace(/ or search within source code[^.]*\. Two modes:\n1\. Object search \(default\): /i, '. ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildSAPSearchTool(btp: boolean, textSearchAvailable?: boolean): ToolDefinition {
  // When textSearch is explicitly unavailable (probed and failed), hide source_code
  const hideSourceCode = textSearchAvailable === false;

  const baseDesc = btp ? SAPSEARCH_DESC_BTP : SAPSEARCH_DESC_ONPREM;
  // Strip source_code lines from base description when hiding
  const description = hideSourceCode ? stripSourceCodeLines(baseDesc) : baseDesc;

  const properties: Record<string, unknown> = {
    query: {
      type: 'string',
      description: hideSourceCode
        ? 'Search pattern: name pattern with wildcards (e.g., ZCL_ORDER*, Z*TEST*).'
        : 'Search pattern. For object search: name pattern with wildcards (e.g., ZCL_ORDER*, Z*TEST*). For source_code search: text string to find in source (e.g., cl_lsapi_manager, CALL FUNCTION).',
    },
    maxResults: {
      type: 'number',
      description: hideSourceCode
        ? 'Maximum results (default 100)'
        : 'Maximum results (default 100 for object, 50 for source_code)',
    },
  };

  if (!hideSourceCode) {
    properties.searchType = {
      type: 'string',
      enum: ['object', 'source_code'],
      description:
        'Search mode: "object" (default) searches by object name, "source_code" searches within ABAP source code.',
    };
    properties.objectType = {
      type: 'string',
      description: 'For source_code search: filter by object type (e.g., PROG, CLAS, FUNC)',
    };
    properties.packageName = { type: 'string', description: 'For source_code search: filter by package name' };
  }

  return {
    name: 'SAPSearch',
    description,
    inputSchema: {
      type: 'object',
      properties,
      required: ['query'],
    },
  };
}

// ─── Main Tool Definitions ──────────────────────────────────────────

export function getToolDefinitions(
  config: ServerConfig,
  textSearchAvailable?: boolean,
  resolvedFeatures?: ResolvedFeatures,
): ToolDefinition[] {
  // Hyperfocused mode: single universal SAP tool (~200 tokens)
  if (config.toolMode === 'hyperfocused') {
    return [getHyperfocusedToolDefinition(config, resolvedFeatures)];
  }

  const btp = isBtpMode(config);
  const tools: ToolDefinition[] = [
    {
      name: 'SAPRead',
      description: btp ? SAPREAD_DESC_BTP : SAPREAD_DESC_ONPREM,
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: btp ? SAPREAD_TYPES_BTP : SAPREAD_TYPES_ONPREM,
            description: btp
              ? 'Object type to read (BTP): CLAS, INTF, FUNC, FUGR, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL (transparent tables and DDIC structures), DOMA, DTEL, TABLE_CONTENTS, DEVC, SYSTEM, COMPONENTS, MESSAGES, BSP, BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS.'
              : 'Object type to read (on-prem): PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL (transparent tables and DDIC structures), VIEW, DOMA, DTEL, TRAN, TABLE_CONTENTS, DEVC, SOBJ, SYSTEM, COMPONENTS, MESSAGES, TEXT_ELEMENTS, VARIANTS, BSP, BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS, AUTH, FTG2, ENHO, VERSIONS, VERSION_SOURCE.',
          },
          name: { type: 'string', description: 'Object name (e.g., ZTEST_PROGRAM, ZCL_ORDER, MARA)' },
          include: {
            type: 'string',
            description:
              'For CLAS: DO NOT use this to read the main class — omit include entirely to get the full class source (CLASS DEFINITION + CLASS IMPLEMENTATION). This parameter reads class-LOCAL auxiliary files only: definitions (local type definitions, NOT the main class definition), implementations (local helper class implementations), macros, testclasses (ABAP Unit). Comma-separated. Not all classes have these sections — missing ones return a note instead of an error. ' +
              'For DDLS: use include="elements" to get a structured field list extracted from the CDS DDL source — shows key fields, aliases, associations, and expression types (calculated, case, cast). Useful for understanding CDS entity structure without parsing raw DDL. ' +
              'For VERSIONS (CLAS): include selects the class include history to query (main, definitions, implementations, macros, testclasses).',
          },
          group: {
            type: 'string',
            description:
              'For FUNC/VERSIONS type. The function group containing the function module. Optional for FUNC — auto-resolved via SAPSearch if omitted. Required for VERSIONS when querying a function module revision feed.',
          },
          method: {
            type: 'string',
            description:
              'For CLAS: method name to read a single method implementation (e.g., "get_name", "zif_order~process"). ' +
              'Use "*" to list all methods with signatures and visibility. ' +
              (btp ? '' : 'For SOBJ: BOR method name to read. If omitted, returns the full BOR method catalog. ') +
              'Not used with other types.',
          },
          ...(btp
            ? {}
            : {
                expand_includes: {
                  type: 'boolean',
                  description:
                    'For FUGR type only. When true, expands all INCLUDE statements and returns the full source of each include inline.',
                },
              }),
          format: {
            type: 'string',
            enum: ['text', 'structured'],
            description:
              'Output format. "text" (default): raw source code. "structured" (CLAS only): JSON with metadata (description, language, category) + decomposed source (main, testclasses, definitions, implementations, macros). Useful when you need to understand class structure or separate test code from production code.',
          },
          version: {
            type: 'string',
            enum: ['active', 'inactive', 'auto'],
            description:
              'Source version to read. "active" (default) returns the last activated version. "inactive" returns the user\'s unactivated draft or active if no draft exists. "auto" returns the draft if one exists, else active.',
          },
          force_refresh: {
            type: 'boolean',
            description:
              'For source reads: bypass cached source and inactive-list state before reading. Use when you know the object changed outside ARC-1.',
          },
          maxRows: { type: 'number', description: 'For TABLE_CONTENTS: max rows to return (default 100)' },
          sqlFilter: {
            type: 'string',
            description:
              'For TABLE_CONTENTS: condition expression only (no WHERE, no SELECT), e.g. "MANDT = \'100\'" or "MATNR LIKE \'Z%\'".',
          },
          objectType: {
            type: 'string',
            description:
              'For API_STATE and VERSIONS: SAP object type (CLAS, INTF, PROG, FUNC, INCL, DDLS, DCLS, BDEF, SRVD, etc.). For API_STATE: auto-detected from name if omitted. For VERSIONS: required to pick the correct revisions endpoint (e.g., "FUNC" + group for function modules); inferred from CL_/IF_/CX_ name prefixes when possible, defaults to PROG.',
          },
          versionUri: {
            type: 'string',
            description:
              'For VERSION_SOURCE: URI of a specific revision from SAPRead(type="VERSIONS") response (.revisions[].uri). Must start with /sap/bc/adt/.',
          },
        },
        required: ['type'],
      },
    },
    buildSAPSearchTool(btp, textSearchAvailable),
  ];

  // Write tools — only registered when writes are enabled
  if (config.allowWrites) {
    let sapWriteDesc = btp ? SAPWRITE_DESC_BTP : SAPWRITE_DESC_ONPREM;
    // Append package restriction info so the LLM knows its boundaries
    if (config.allowedPackages.length > 0) {
      const pkgList = config.allowedPackages.join(', ');
      sapWriteDesc += ` Write access is restricted to packages: ${pkgList}.`;
    }
    tools.push({
      name: 'SAPWrite',
      description: sapWriteDesc,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'delete', 'edit_method', 'batch_create', 'scaffold_rap_handlers'],
            description:
              'Write action. edit_method: surgically replace a single method body (requires type=CLAS, method, and source params). batch_create: create and activate multiple objects in sequence (requires objects array). scaffold_rap_handlers: derive missing behavior-pool handler signatures from interface BDEF declarations and optionally inject declarations plus empty implementation stubs.',
          },
          type: {
            type: 'string',
            enum: btp ? SAPWRITE_TYPES_BTP : SAPWRITE_TYPES_ONPREM,
            description: btp
              ? 'Object type (for create/update/delete/edit_method). Supported: CLAS, INTF, DDLS, DDLX, BDEF, SRVD, TABL, DOMA, DTEL.'
              : 'Object type (for create/update/delete/edit_method). Supported: PROG, CLAS, INTF, FUNC, INCL, DDLS, DDLX, BDEF, SRVD, TABL, DOMA, DTEL.',
          },
          name: { type: 'string', description: 'Object name (for create/update/delete/edit_method)' },
          source: { type: 'string', description: 'ABAP source code (for create/update/edit_method)' },
          method: {
            type: 'string',
            description: 'For edit_method action: method name to replace (e.g., "get_name", "zif_order~process")',
          },
          bdefName: {
            type: 'string',
            description:
              'For scaffold_rap_handlers action: interface BDEF name used to derive required handler signatures (e.g., ZI_TRAVELREQ). The BDEF is parsed to find every action/determination/validation/authorization that must exist in the behavior pool.',
          },
          autoApply: {
            type: 'boolean',
            description:
              'For scaffold_rap_handlers: when true, missing METHODS signatures are inserted into matching lhc_* class definitions, empty METHOD stubs are inserted into matching implementation blocks where possible, and the class source is written back under a single lock. When false (default), returns a JSON report of required vs. missing signatures without modifying the class — use this first to preview, then re-run with autoApply=true to commit.',
          },
          targetAlias: {
            type: 'string',
            description:
              'For scaffold_rap_handlers: optional RAP entity alias filter (e.g., Travel, Segment) to scaffold only one handler class. When omitted, all entities declared in the BDEF are scaffolded. Case-insensitive.',
          },
          description: {
            type: 'string',
            description:
              'Object description for create action (defaults to name if omitted). Max 60 chars for most types.',
          },
          package: {
            type: 'string',
            description: 'Package for new objects (default $TMP). Non-$TMP packages require a transport number.',
          },
          transport: {
            type: 'string',
            description:
              'Transport request number. Required for non-$TMP packages. Use SAPTransport(action="list") to find or SAPTransport(action="create") to create one.',
          },
          dataType: { type: 'string', description: 'DOMA/DTEL: ABAP data type (e.g., CHAR, NUMC, DEC)' },
          length: { type: 'number', description: 'DOMA/DTEL: data type length' },
          decimals: { type: 'number', description: 'DOMA/DTEL: decimal places' },
          outputLength: { type: 'number', description: 'DOMA: output length' },
          conversionExit: { type: 'string', description: 'DOMA: conversion exit (e.g., ALPHA)' },
          signExists: { type: 'boolean', description: 'DOMA: signed values allowed' },
          lowercase: { type: 'boolean', description: 'DOMA: lowercase characters allowed' },
          fixedValues: {
            type: 'array',
            description: 'DOMA: fixed value ranges',
            items: {
              type: 'object',
              properties: {
                low: { type: 'string', description: 'Low value (required)' },
                high: { type: 'string', description: 'High value for ranges (optional)' },
                description: { type: 'string', description: 'Value description (optional)' },
              },
              required: ['low'],
            },
          },
          valueTable: { type: 'string', description: 'DOMA: value table reference (e.g., T001)' },
          typeKind: {
            type: 'string',
            enum: ['domain', 'predefinedAbapType'],
            description: 'DTEL: type source (domain reference or predefined ABAP type)',
          },
          typeName: { type: 'string', description: 'DTEL: domain/type name reference (for typeKind=domain)' },
          domainName: { type: 'string', description: 'DTEL: alias for typeName when referencing a domain' },
          shortLabel: { type: 'string', description: 'DTEL: short field label' },
          mediumLabel: { type: 'string', description: 'DTEL: medium field label' },
          longLabel: { type: 'string', description: 'DTEL: long field label' },
          headingLabel: { type: 'string', description: 'DTEL: heading field label' },
          searchHelp: { type: 'string', description: 'DTEL: search help name' },
          searchHelpParameter: { type: 'string', description: 'DTEL: search help parameter' },
          setGetParameter: { type: 'string', description: 'DTEL: SET/GET parameter ID' },
          defaultComponentName: { type: 'string', description: 'DTEL: default component name' },
          changeDocument: { type: 'boolean', description: 'DTEL: enable change document flag' },
          serviceDefinition: { type: 'string', description: 'SRVB: service definition name (SRVD) to bind to' },
          bindingType: {
            type: 'string',
            description:
              'SRVB: binding type — accepts human-readable values like "ODataV4-UI", "OData V2 - Web API", "ODATA_V4" which are auto-normalized to SAP ADT values (type=ODATA, correct odataVersion + category)',
          },
          odataVersion: {
            type: 'string',
            enum: ['V2', 'V4'],
            description: 'SRVB: OData protocol version (default: V2). Overrides version inferred from bindingType.',
          },
          category: {
            type: 'string',
            enum: ['0', '1'],
            description:
              'SRVB: binding category (0=UI, 1=Web API; default: 0). Overrides category inferred from bindingType.',
          },
          version: { type: 'string', description: 'SRVB: service version number (default: 0001)' },
          lintBeforeWrite: {
            type: 'boolean',
            description:
              'Override server lint-before-write setting for this call. Set false to skip pre-write lint validation. Lint applies to ABAP types (PROG, CLAS, INTF, FUNC) and CDS views (DDLS). BDEF/SRVD/SRVB/DDLX/TABL are skipped by offline linter; RAP preflight may still catch deterministic issues for those types.',
          },
          preflightBeforeWrite: {
            type: 'boolean',
            description:
              'Enable/disable deterministic RAP preflight checks for this call (default: true). Useful for TABL/BDEF/DDLX static rules (e.g., curr/quan semantics, invalid BDEF enums, unsupported DDLX annotation scope on on-prem 7.5x).',
          },
          checkBeforeWrite: {
            type: 'boolean',
            description:
              'Override server check-before-write setting (default off). When true, SAPWrite sends the proposed source to /sap/bc/adt/checkruns with inline <chkrun:content> and appends any error/warning messages to the success response — the write is NOT blocked. Useful for single-file edits to see compile diagnostics without a separate SAPDiagnose call. Off by default because (a) it adds a round-trip per write and (b) intermediate writes during multi-file refactors will legitimately trip dependency errors that resolve once the whole sequence lands. Activation remains the definitive compile check.',
          },
          refObjectType: {
            type: 'string',
            description:
              'SKTD create: ADT type+subtype of the parent object the KTD documents (e.g., "DDLS/DF", "CLAS/OC", "INTF/OI", "PROG/P", "BDEF/BDO", "SRVD/SRV"). Required for SKTD create.',
          },
          refObjectName: {
            type: 'string',
            description: 'SKTD create: name of the parent object the KTD documents (defaults to "name").',
          },
          refObjectDescription: {
            type: 'string',
            description: 'SKTD create: description of the parent object (shown in Eclipse tooltips).',
          },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: btp ? SAPWRITE_TYPES_BTP : SAPWRITE_TYPES_ONPREM,
                  description: 'Object type (includes TABL for RAP stack bootstrapping)',
                },
                name: { type: 'string', description: 'Object name' },
                source: { type: 'string', description: 'ABAP source code (optional — some objects have no source)' },
                description: { type: 'string', description: 'Object description (defaults to name if omitted)' },
                dataType: { type: 'string', description: 'DOMA/DTEL: ABAP data type' },
                length: { type: 'number', description: 'DOMA/DTEL: data type length' },
                decimals: { type: 'number', description: 'DOMA/DTEL: decimal places' },
                outputLength: { type: 'number', description: 'DOMA: output length' },
                conversionExit: { type: 'string', description: 'DOMA: conversion exit' },
                signExists: { type: 'boolean', description: 'DOMA: signed values allowed' },
                lowercase: { type: 'boolean', description: 'DOMA: lowercase allowed' },
                fixedValues: {
                  type: 'array',
                  description: 'DOMA: fixed value ranges',
                  items: {
                    type: 'object',
                    properties: {
                      low: { type: 'string' },
                      high: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['low'],
                  },
                },
                valueTable: { type: 'string', description: 'DOMA: value table' },
                typeKind: { type: 'string', enum: ['domain', 'predefinedAbapType'], description: 'DTEL: type mode' },
                typeName: { type: 'string', description: 'DTEL: domain/type name reference' },
                domainName: { type: 'string', description: 'DTEL: alias for typeName' },
                shortLabel: { type: 'string', description: 'DTEL: short field label' },
                mediumLabel: { type: 'string', description: 'DTEL: medium field label' },
                longLabel: { type: 'string', description: 'DTEL: long field label' },
                headingLabel: { type: 'string', description: 'DTEL: heading field label' },
                searchHelp: { type: 'string', description: 'DTEL: search help' },
                searchHelpParameter: { type: 'string', description: 'DTEL: search help parameter' },
                setGetParameter: { type: 'string', description: 'DTEL: SET/GET parameter ID' },
                defaultComponentName: { type: 'string', description: 'DTEL: default component name' },
                changeDocument: { type: 'boolean', description: 'DTEL: change document flag' },
                serviceDefinition: { type: 'string', description: 'SRVB: service definition (SRVD)' },
                bindingType: {
                  type: 'string',
                  description: 'SRVB: binding type — accepts human-readable values like "ODataV4-UI" (auto-normalized)',
                },
                odataVersion: {
                  type: 'string',
                  enum: ['V2', 'V4'],
                  description: 'SRVB: OData protocol version (default: V2)',
                },
                category: {
                  type: 'string',
                  enum: ['0', '1'],
                  description: 'SRVB: binding category (0=UI, 1=Web API)',
                },
                version: { type: 'string', description: 'SRVB: service version number (default 0001)' },
              },
              required: ['type', 'name'],
            },
            description:
              'For batch_create: ordered list of objects to create and activate. Each object needs type, name, and source (if applicable). ' +
              'Objects are created and activated in array order — put dependencies first (e.g., TABL before DDLS, BDEF after DDLS). ' +
              'Example: [{type:"TABL",name:"ZTRAVEL",source:"..."},{type:"DDLS",name:"ZI_TRAVEL",source:"..."},{type:"BDEF",name:"ZI_TRAVEL",source:"..."},{type:"SRVD",name:"ZSD_TRAVEL",source:"..."}]',
          },
        },
        required: ['action'],
      },
    });

    tools.push({
      name: 'SAPActivate',
      description:
        'Activate (publish) ABAP objects. Supports single object or batch activation.\n' +
        'Type codes are auto-normalized and case-insensitive (e.g., "CLAS/OC" or "clas" map to CLAS).\n' +
        'ALWAYS prefer batch activation when activating 2+ objects — pass "objects" array with {type, name} entries. ' +
        'Batch activation is more efficient (one SAP round-trip) and works for ANY combination of objects, not just dependent ones. ' +
        'It is required for RAP stacks where DDLS, BDEF, SRVD depend on each other, but equally useful for unrelated objects like multiple DTELs or DOMAs.\n' +
        'For publish_srvb/unpublish_srvb: publish or unpublish an OData service binding (SRVB) — makes the OData service available for consumption.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['activate', 'publish_srvb', 'unpublish_srvb'],
            description:
              'Action to perform. "activate" (default): activate ABAP objects. ' +
              '"publish_srvb": publish a service binding to make OData service available. ' +
              '"unpublish_srvb": unpublish a service binding.',
          },
          name: { type: 'string', description: 'Object name (for single activation or publish/unpublish)' },
          type: { type: 'string', description: 'Object type (PROG, CLAS, DDLS, DDLX, BDEF, SRVD, SRVB, etc.)' },
          version: { type: 'string', description: 'Service version for publish/unpublish (default: "0001")' },
          service_type: {
            type: 'string',
            enum: ['odatav2', 'odatav4'],
            description:
              'OData service type for publish/unpublish endpoint routing. ' +
              'Auto-detected from SRVB metadata when omitted. Only needed if auto-detection fails.',
          },
          preaudit: {
            type: 'boolean',
            description:
              'Request pre-activation audit from SAP (default: true). ' +
              'When true, SAP checks for issues before activating and returns warnings/errors. ' +
              'Set to false to skip pre-audit for faster activation when confident the code is correct.',
          },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Object type' },
                name: { type: 'string', description: 'Object name' },
              },
              required: ['type', 'name'],
            },
            description:
              'Batch activation: array of objects to activate in one call. Use whenever activating 2+ objects. ' +
              'Works for any mix of types — e.g., [{type:"DOMA",name:"Z_DOM"},{type:"DTEL",name:"Z_DEL"}] or RAP stacks like [{type:"DDLS",name:"ZI_TRAVEL"},{type:"BDEF",name:"ZI_TRAVEL"},{type:"SRVD",name:"ZSD_TRAVEL"}].',
          },
        },
      },
    });
  }

  tools.push({
    name: 'SAPNavigate',
    description: btp
      ? 'Navigate code (BTP ABAP Environment): find definitions, references (where-used), code completion, and class hierarchy. Use for "go to definition", "where is this used?", "what does this class inherit?", and auto-complete. For references: uses the full scope-based Where-Used API returning detailed results with line numbers, snippets, and package info. Optional objectType filter narrows results to a specific ADT type in slash format (e.g., CLAS/OC, PROG/P). Type+name params are auto-normalized (e.g., type="clas" works). On BTP, navigation scope is limited to released SAP objects and custom Z/Y objects.\n\nFor CDS entities (DDLS), prefer SAPContext(action="impact") — it returns the same where-used data pre-classified into RAP buckets (projection views, BDEFs, SRVDs, access controls, etc.), which is more useful than the flat reference list returned here.'
      : 'Navigate code: find definitions, references (where-used), code completion, and class hierarchy. Use for "go to definition", "where is this used?", "what does this class inherit?", and auto-complete. For references: uses the full scope-based Where-Used API returning detailed results with line numbers, snippets, and package info. Optional objectType filter narrows results to a specific ADT type in slash format (e.g., CLAS/OC, PROG/P). Type+name params are auto-normalized (e.g., type="clas" works). For hierarchy: returns superclass, implemented interfaces, and direct subclasses via SEOMETAREL. You can use type+name instead of uri (e.g., type="CLAS", name="ZCL_ORDER") for a where-used list without needing the full ADT URI.\n\nFor CDS entities (DDLS), prefer SAPContext(action="impact") — it returns the same where-used data pre-classified into RAP buckets (projection views, BDEFs, SRVDs, access controls, metadata extensions, documentation, ABAP consumers), which answers "what breaks if I change this view" directly without manual bucketing.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['definition', 'references', 'completion', 'hierarchy'],
          description: 'Navigation action',
        },
        uri: {
          type: 'string',
          description: 'Source URI of the object. Optional for references if type+name are provided.',
        },
        type: {
          type: 'string',
          description: 'Object type (PROG, CLAS, INTF, FUNC, etc.) — alternative to uri for references.',
        },
        name: { type: 'string', description: 'Object name — alternative to uri for references.' },
        objectType: {
          type: 'string',
          description:
            'For references action: filter where-used results by ADT object type in slash format (e.g., PROG/P, CLAS/OC, FUNC/FM, INTF/OI). On systems supporting the scope endpoint, only returns references from objects of the specified type. On older systems, the filter is ignored and all references are returned with a note.',
        },
        line: { type: 'number', description: 'Line number (1-based)' },
        column: { type: 'number', description: 'Column number (1-based)' },
        source: { type: 'string', description: 'Current source code (for definition/completion)' },
      },
      required: ['action'],
    },
  });

  // SAPQuery — only registered when free SQL is allowed
  if (config.allowFreeSQL) {
    tools.push({
      name: 'SAPQuery',
      description: btp ? SAPQUERY_DESC_BTP : SAPQUERY_DESC_ONPREM,
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'ABAP SQL SELECT statement' },
          maxRows: { type: 'number', description: 'Maximum rows (default 100)' },
        },
        required: ['sql'],
      },
    });
  }

  tools.push(
    {
      name: 'SAPLint',
      description:
        'Run local abaplint rules on ABAP and CDS source code. System-aware: auto-selects cloud or on-prem rules based on detected system type.\n\n' +
        'Actions:\n' +
        '- "lint": Check source for issues. Returns errors and warnings. Works for ABAP (PROG, CLAS, INTF, FUNC) and CDS views (DDLS) — catches syntax errors, naming conventions, field order, legacy view patterns.\n' +
        '- "lint_and_fix": Lint + auto-fix all fixable issues (keyword case, obsolete statements, etc.). Returns fixed source.\n' +
        '- "list_rules": List all available rules with current config. No source needed.\n' +
        '- "format": Pretty-print ABAP source via SAP\'s ADT formatter (uses the SAP system\'s global formatter settings). Requires source. Returns the formatted source.\n' +
        '- "get_formatter_settings": Read the SAP system\'s global PrettyPrinter settings (indentation, keyword style). No params.\n' +
        '- "set_formatter_settings": Update the SAP system\'s global PrettyPrinter settings. Requires indentation (bool) and/or style (keywordUpper|keywordLower|keywordAuto|none). Blocked in read-only mode.\n\n' +
        'For server-side checks (ATC, syntax check, unit tests), use SAPDiagnose instead.\n' +
        'Note: lint/lint_and_fix/list_rules run locally; format/*_formatter_settings call the SAP system.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['lint', 'lint_and_fix', 'list_rules', 'format', 'get_formatter_settings', 'set_formatter_settings'],
            description: 'Check type',
          },
          source: {
            type: 'string',
            description: 'ABAP or CDS source code to lint/format (not needed for list_rules/get_formatter_settings)',
          },
          name: { type: 'string', description: 'Object name (used for filename detection)' },
          indentation: {
            type: 'boolean',
            description: 'PrettyPrinter: indent source (for set_formatter_settings)',
          },
          style: {
            type: 'string',
            enum: ['keywordUpper', 'keywordLower', 'keywordAuto', 'none'],
            description: 'PrettyPrinter: keyword casing (for set_formatter_settings)',
          },
          rules: {
            type: 'object',
            description:
              'Rule overrides: { "rule_name": false } to disable, { "rule_name": { "severity": "Warning" } } to configure. Overrides system defaults.',
          },
        },
        required: ['action'],
      },
    },
    {
      name: 'SAPDiagnose',
      description:
        'Run diagnostics on ABAP objects and analyze runtime errors.\n\n' +
        'Actions:\n' +
        '- "syntax": Syntax check an ABAP object. Requires name + type. Optional: version ("active" or "inactive", defaults to active). Optional: source — when supplied, SAP compiles the given content as if it lived at the object\'s URI (pre-write dry-run, nothing is written). Omit source to check what is stored.\n' +
        '- "unittest": Run ABAP unit tests. Requires name + type.\n' +
        '- "atc": Run ATC code quality checks. Requires name + type. Optional: variant.\n' +
        '- "quickfix": Get SAP quick fix proposals for a specific source position. Requires name + type + source + line. Optional: column.\n' +
        '- "apply_quickfix": Apply one quick fix proposal and return text deltas (does not write source). Requires name + type + source + line + proposalUri + proposalUserContent. Optional: column.\n' +
        '- "dumps": List or read ABAP short dumps (ST22). Without id: lists recent dumps (filter by user, maxResults). With id: returns focused chapter sections by default; set includeFullText=true to include the full formatted dump blob. Optional sections=[kap0,kap3,...] to request specific chapter IDs.\n' +
        '- "traces": List or analyze ABAP profiler traces. Without id: lists trace files. With id + analysis: returns trace analysis (hitlist = hot spots, statements = call tree, dbAccesses = database access statistics).\n\n' +
        '- "system_messages": List SM02 system messages via ADT feed (filter by user, maxResults, from, to).\n' +
        '- "gateway_errors": List SAP Gateway error log entries (/IWFND/ERROR_LOG, on-prem). For detail mode provide detailUrl (preferred) or id+errorType.\n\n' +
        'Quickfix workflow: run syntax/ATC first to identify issues and line positions, then call quickfix to retrieve SAP-verified proposals, then apply_quickfix to get exact text deltas, and finally write the updated source via SAPWrite.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'syntax',
              'unittest',
              'atc',
              'dumps',
              'traces',
              'system_messages',
              'gateway_errors',
              'quickfix',
              'apply_quickfix',
            ],
            description: 'Diagnostic action',
          },
          name: { type: 'string', description: 'Object name (for syntax/unittest/atc)' },
          type: { type: 'string', description: 'Object type (PROG, CLAS, etc.) (for syntax/unittest/atc)' },
          source: {
            type: 'string',
            description: 'Current source code (required for quickfix/apply_quickfix).',
          },
          line: {
            type: 'number',
            description: 'Source line number for quickfix evaluation (required for quickfix/apply_quickfix).',
          },
          column: {
            type: 'number',
            description: 'Source column number for quickfix evaluation (default 0 for quickfix actions).',
          },
          version: {
            type: 'string',
            enum: ['active', 'inactive'],
            description:
              'Source version for syntax check (default "active"). Use "inactive" to validate pending changes.',
          },
          proposalUri: {
            type: 'string',
            description: 'Quickfix proposal URI from quickfix action (required for apply_quickfix).',
          },
          proposalUserContent: {
            type: 'string',
            description: 'Opaque userContent from quickfix action (required for apply_quickfix).',
          },
          variant: { type: 'string', description: 'ATC check variant (for atc action)' },
          id: {
            type: 'string',
            description: 'Dump or trace ID (for dumps/traces actions). Omit to list, provide to get details.',
          },
          detailUrl: {
            type: 'string',
            description:
              'ADT detail URL for gateway_errors detail mode (preferred over id+errorType). Accepts absolute or /sap/bc/adt/... path.',
          },
          errorType: {
            type: 'string',
            description:
              'Gateway error type for gateway_errors detail by id (for example "Frontend Error"). Required when using id without detailUrl.',
          },
          user: { type: 'string', description: 'Filter dumps by SAP user (for dumps action)' },
          from: {
            type: 'string',
            description:
              'Optional lower time boundary for feed-based diagnostics actions (system_messages/gateway_errors).',
          },
          to: {
            type: 'string',
            description:
              'Optional upper time boundary for feed-based diagnostics actions (system_messages/gateway_errors).',
          },
          maxResults: {
            type: 'number',
            description:
              'Maximum results to return for dumps/system_messages/gateway_errors (default 50, bounded to a safe cap).',
          },
          sections: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Dump chapter IDs to include for dumps detail mode (for example ["kap0","kap3","kap8"]). Omit to use focused defaults.',
          },
          includeFullText: {
            type: 'boolean',
            description:
              'For dumps detail mode only: include full formattedText blob. Default false to reduce token usage.',
          },
          analysis: {
            type: 'string',
            enum: ['hitlist', 'statements', 'dbAccesses'],
            description:
              'Trace analysis type (for traces action with id). hitlist = execution hot spots, statements = call tree, dbAccesses = database access stats.',
          },
        },
        required: ['action'],
      },
    },
  );

  // SAPContext — always available (read-only tool)
  tools.push({
    name: 'SAPContext',
    description: btp ? SAPCONTEXT_DESC_BTP : SAPCONTEXT_DESC_ONPREM,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['impact', 'deps', 'usages'],
          description:
            'Action:\n' +
            '"impact" = CDS blast-radius analysis (DDLS only). USE THIS for any question like "what breaks if I change <view>", "who consumes <I_*>", "impact analysis on <CDS>", "downstream of <view>". Returns upstream AST dependencies + downstream where-used classified into RAP buckets (projectionViews, bdefs, serviceDefinitions, serviceBindings, accessControls, metadataExtensions, abapConsumers, documentation, tables, other), plus additive sibling-consistency diagnostics (consistencyHints + siblingExtensionAnalysis) when related DDLS siblings show asymmetric DDLX coverage. ALWAYS prefer over SAPQuery against DDDDLSRC/ACMDCLSRC/DDLXSRC_SRC/SRVDSRC_SRC (those text-scans produce noise this classifier filters out). Non-DDLS input returns a guardrail error.\n' +
            '"deps" (default, can be omitted) = forward dependency context — "what does <object> depend on?". Returns public API contracts of dependencies.\n' +
            '"usages" = reverse dependency lookup — "who calls <object>?". Requires cache warmup (--cache-warmup). Only "name" is needed. For CDS entities prefer action="impact" instead.',
        },
        type: {
          type: 'string',
          enum: btp ? SAPCONTEXT_TYPES_BTP : SAPCONTEXT_TYPES_ONPREM,
          description:
            'Object type. Required for action="deps" and action="usages". ' +
            'Optional for action="impact" — defaults to DDLS (the only supported type for impact).',
        },
        name: {
          type: 'string',
          description: 'Object name (e.g., ZCL_ORDER)',
        },
        source: {
          type: 'string',
          description:
            'Optional: provide source directly instead of fetching from SAP. ' +
            'Saves one round-trip if you already have the source from SAPRead.',
        },
        ...(btp
          ? {}
          : {
              group: {
                type: 'string',
                description: 'Required for FUNC type. The function group containing the function module.',
              },
            }),
        maxDeps: {
          type: 'number',
          description: 'Maximum dependencies to resolve (default 20). Lower = faster + fewer tokens.',
        },
        depth: {
          type: 'number',
          description:
            'Dependency depth: 1 = direct deps only (default), 2 = deps of deps, 3 = maximum. ' +
            'Higher depth = more context but more SAP calls.',
        },
        includeIndirect: {
          type: 'boolean',
          description:
            'Only for action="impact". Include indirect (transitive) downstream where-used entries. Default false.',
        },
        siblingCheck: {
          type: 'boolean',
          description:
            'Only for action="impact". Enable sibling metadata-extension consistency analysis. Default true.',
        },
        siblingMaxCandidates: {
          type: 'number',
          description: 'Only for action="impact". Maximum sibling DDLS candidates to compare. Default 4; hard cap 10.',
        },
      },
      required: ['name'],
    },
  });

  // SAPManage — always registered; mutating actions remain safety/scope-protected.
  const sapManageActions = config.allowWrites
    ? [...SAPMANAGE_ACTIONS_READ, ...SAPMANAGE_ACTIONS_WRITE]
    : SAPMANAGE_ACTIONS_READ;
  tools.push({
    name: 'SAPManage',
    description: btp ? SAPMANAGE_DESC_BTP : SAPMANAGE_DESC_ONPREM,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: sapManageActions,
          description:
            'Action to execute. Read actions: features, probe, cache_stats, flp_list_catalogs, flp_list_groups, flp_list_tiles. ' +
            'Mutating package/FLP actions require writable safety config and write scope in authenticated mode.',
        },
        name: {
          type: 'string',
          description: 'Package name (required for create_package and delete_package).',
        },
        description: {
          type: 'string',
          description: 'Package description (required for create_package).',
        },
        superPackage: {
          type: 'string',
          description: 'Parent package for create_package (defaults to empty root package).',
        },
        softwareComponent: {
          type: 'string',
          description: 'Software component for create_package (default: LOCAL).',
        },
        transportLayer: {
          type: 'string',
          description: 'Transport layer for create_package (optional; required by some transportable landscapes).',
        },
        packageType: {
          type: 'string',
          enum: ['development', 'structure', 'main'],
          description: 'Package type for create_package (default: development).',
        },
        transport: {
          type: 'string',
          description: 'Optional transport request (corrNr) for create_package, delete_package, or change_package.',
        },
        objectUri: {
          type: 'string',
          description:
            'ADT URI of the object to move (e.g., /sap/bc/adt/oo/classes/zcl_my_class). If not provided, resolved automatically from objectName + objectType via search.',
        },
        objectType: {
          type: 'string',
          description: 'ADT object type (e.g., CLAS/OC, DDLS/DF, PROG/P). Required for change_package.',
        },
        objectName: {
          type: 'string',
          description: 'Object name to move (e.g., ZCL_MY_CLASS). Required for change_package.',
        },
        oldPackage: {
          type: 'string',
          description: 'Current package of the object. Required for change_package.',
        },
        newPackage: {
          type: 'string',
          description: 'Target package to move the object to. Required for change_package.',
        },
        catalogId: {
          type: 'string',
          description:
            'FLP catalog identifier — accepts either full ID (X-SAP-UI2-CATALOGPAGE:MY_CAT) or domain ID (MY_CAT). Required for flp_list_tiles, flp_create_tile, flp_add_tile_to_group, flp_delete_catalog.',
        },
        groupId: {
          type: 'string',
          description: 'FLP group/page identifier (required for flp_create_group, flp_add_tile_to_group).',
        },
        title: {
          type: 'string',
          description: 'Title for FLP catalog/group creation.',
        },
        domainId: {
          type: 'string',
          description: 'Domain ID for FLP catalog creation (e.g., ZARC1_SALES).',
        },
        tileInstanceId: {
          type: 'string',
          description: 'Tile instance ID in the source catalog (required for flp_add_tile_to_group).',
        },
        tile: {
          type: 'object',
          description: 'Tile definition for flp_create_tile.',
          properties: {
            id: { type: 'string', description: 'Tile ID (client-side logical id).' },
            title: { type: 'string', description: 'Display title.' },
            icon: { type: 'string', description: 'Optional icon URI.' },
            semanticObject: { type: 'string', description: 'Semantic object for intent navigation.' },
            semanticAction: { type: 'string', description: 'Semantic action for intent navigation.' },
            url: { type: 'string', description: 'Optional target URL.' },
            subtitle: { type: 'string', description: 'Optional subtitle text.' },
            info: { type: 'string', description: 'Optional info text.' },
          },
          required: ['id', 'title', 'semanticObject', 'semanticAction'],
        },
      },
      required: ['action'],
    },
  });

  // Transport tools — always registered when the feature is available.
  // Read actions (list/get/check/history) work with read scope.
  // Write actions (create/release/delete/...) require 'transports' scope + allowTransportWrites=true.
  if (config.featureTransport !== 'off') {
    const sapTransportActions =
      config.allowWrites && config.allowTransportWrites
        ? [...SAPTRANSPORT_ACTIONS_READ, ...SAPTRANSPORT_ACTIONS_WRITE]
        : SAPTRANSPORT_ACTIONS_READ;
    tools.push({
      name: 'SAPTransport',
      description: btp ? SAPTRANSPORT_DESC_BTP : SAPTRANSPORT_DESC_ONPREM,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: sapTransportActions,
            description:
              'list: show transports (defaults to current user, modifiable only). ' +
              'get: fetch transport details including tasks and objects. ' +
              'create: create a new transport request. ' +
              'release: release a single transport or task. ' +
              'delete: delete a transport (use recursive=true to delete tasks first). ' +
              'reassign: change transport owner (use recursive=true for tasks too). ' +
              'release_recursive: release all unreleased tasks first, then the transport itself. ' +
              'check: check if a transport is needed for a package/object (requires type, name, package). ' +
              'history: list transports referencing an object (reverse lookup; requires type, name; works without SAP_ALLOW_TRANSPORT_WRITES).',
          },
          id: {
            type: 'string',
            description:
              'Transport request ID, e.g. A4HK900123 (required for get/release/delete/reassign/release_recursive)',
          },
          description: { type: 'string', description: 'Transport description text (required for create)' },
          name: { type: 'string', description: 'Object name (for check or history actions)' },
          package: { type: 'string', description: 'Package name (for check action)' },
          user: {
            type: 'string',
            description:
              'SAP username to filter by (for list). Defaults to the current SAP user. Use "*" to list all users.',
          },
          status: {
            type: 'string',
            description: 'Transport status filter (for list). D=modifiable (default), R=released, "*"=all statuses.',
          },
          type: {
            type: 'string',
            description:
              'For create: transport type K=Workbench (default), W=Customizing, T=Transport of Copies. For check/history: object type (PROG, CLAS, DDLS, etc.)',
          },
          owner: { type: 'string', description: 'New owner SAP username (required for reassign)' },
          recursive: {
            type: 'boolean',
            description: 'Apply recursively to child tasks (for delete/reassign). release_recursive always recurses.',
          },
        },
        required: ['action'],
      },
    });
  }

  // SAPGit — registered only when gCTS or abapGit backend is available
  if (resolvedFeatures?.gcts?.available || resolvedFeatures?.abapGit?.available) {
    const sapGitActions =
      config.allowWrites && config.allowGitWrites
        ? [...SAPGIT_ACTIONS_READ, ...SAPGIT_ACTIONS_WRITE]
        : SAPGIT_ACTIONS_READ;
    tools.push({
      name: 'SAPGit',
      description: btp ? SAPGIT_DESC_BTP : SAPGIT_DESC_ONPREM,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: sapGitActions,
            description:
              'Git action. Read: list_repos, whoami, config, branches, external_info, history, objects, check. ' +
              'Write (requires SAP_ALLOW_WRITES=true and SAP_ALLOW_GIT_WRITES=true): clone, pull, push, commit, stage, switch_branch, create_branch, unlink.',
          },
          backend: {
            type: 'string',
            enum: ['gcts', 'abapgit'],
            description: 'Optional backend override. Omit to auto-select (gCTS preferred over abapGit).',
          },
          repoId: {
            type: 'string',
            description: 'Repository ID/key for repo-specific actions.',
          },
          url: {
            type: 'string',
            description: 'Remote Git URL (required for clone and abapGit external_info).',
          },
          branch: {
            type: 'string',
            description: 'Branch name for switch_branch/create_branch.',
          },
          package: {
            type: 'string',
            description: 'ABAP package for clone/create operations (checked against allowedPackages).',
          },
          transport: {
            type: 'string',
            description: 'Optional transport request where supported by the backend.',
          },
          commit: {
            type: 'string',
            description: 'Commit SHA for history/pull-by-commit actions.',
          },
          message: {
            type: 'string',
            description: 'Commit message for gCTS commit.',
          },
          description: {
            type: 'string',
            description: 'Optional commit description for gCTS commit.',
          },
          objects: {
            type: 'array',
            description: 'Optional object list for commit/push payloads.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                name: { type: 'string' },
                package: { type: 'string' },
                path: { type: 'string' },
                state: { type: 'string' },
                operation: { type: 'string' },
              },
              required: ['type', 'name'],
            },
          },
          user: {
            type: 'string',
            description: 'Optional remote repository username.',
          },
          password: {
            type: 'string',
            description: 'Optional remote repository password/token secret.',
          },
          token: {
            type: 'string',
            description: 'Optional remote repository access token.',
          },
          limit: {
            type: 'number',
            description: 'Optional limit for history queries.',
          },
        },
        required: ['action'],
      },
    });
  }

  return tools;
}
