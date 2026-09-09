# Automatic live relations: per-type qualification

Status: implementation and qualification in progress, 2026-09-10. PR #769 remains unmerged.
Baseline: `18f42c30`; main: `c55adcb8`. This is a research record, not a cross-release support guarantee.
Operational setup and current limits: [Live relations](../../docs_page/live-relations.md).

## Decision and scope

Remove the feature-specific environment/CLI option. Use existing capability discovery and
`SAP_DENY_ACTIONS` for exposure/control. Unknown discovery remains visible to clients that list
tools once; known absence hides the action; invocation always verifies exact endpoint/MIME support.
Listing tools adds no SAP requests. Read scope, SAP authorization, single-target standard mode,
experimental labeling, fixed budgets and request-local results remain unchanged.

No database, collector, plugin framework, source index, SQL, background warmup, BTP provisioning
or AI Core is introduced. Normal source caching is independent. Compared with the baseline,
only SAPNavigate's descriptions/shape change; broader general-tool guidance is not rewritten here.

## Evidence method

SAP's official Relation Explorer documentation describes Used/Using Objects broadly, but gives
CDS, business-object and enhancement contexts separate semantics.[^sap-relation] This is an IDE
feature description, not proof that one public REST shape works for all objects/releases.
Later release notes explicitly extend service-definition used-object navigation; that capability
must not be back-projected onto the 2023 test system.[^sap-356]

Read-only testing used the existing A4H/001 S/4HANA 2023 trial (SAP_BASIS 758), HTTPS with verified
TLS and its existing SAP identity. Search results selected actual objects; metadata GETs verified
name, exact ADT subtype and active version. Both ENV and WUL were explicitly requested. Negative
results were retained. Raw XML and model transcripts remain in the private local comparison lab;
only sanitized observations and synthetic regression fixtures belong in this repository.

First pass: 21 type/subtype groups, normally two roots each, two directions. Second pass: real
ARC-1 dispatch with depth 2 / 25 nodes, 62 calls. Unlike the exploratory 4-MiB wire probe, these
calls use the shipping 12 attempts / 1 MiB / 15 seconds / 8 expansions / 2 analyses limits.
Per-type metadata and protocol tests include namespace encoding, wrong type/name/envelope,
inactive/new/absent/denied roots, resolution ambiguity and function identity variants.

## Per-type results and disposition

Counts are first-pass native edges, not unique runtime callers or complete dependency counts.
Zero edges are observations, never proof of absence or non-use.

| Family | Example and observed ENV / WUL edges | Identity and decision |
|---|---|---|
| CLAS | `ZCL_SSI_FACTORY`: 5 / 5 | Existing `abapClass`, CLAS/OC; retain |
| INTF | `ZIF_SSI_IMPORTER`: 1 / 10 | Existing `abapInterface`, INTF/OI; retain |
| DDLS | `ZDEMO_C_SALESORDER_TP_D`: 2 / 0 | `ddlSource`, DDLS/DF; add; no inference from empty sibling graph |
| DCLS | `ZI_MCP_PLAYER_DCL`: 1 / 0 | `dclSource`, DCLS/DL; add; generated STOB location remains a boundary |
| BDEF | `ZR_FBCLUBTP`: 0 / 1 | `blueSource`, BDEF/BDO; add with explicit RAP coverage warning; class implementation observed incoming |
| SRVD | `ZTEST_MCP_SD_FLIGHT`: 0 / 1 | `srvdSource`, SRVD/SRV; add with coverage warning; binding observed incoming, exposed entities absent outgoing |
| TABL table | `ZABAPGIT`: 0 / 2 | `blueSource`, TABL/DT; add; bounded exact search resolves physical path |
| TABL structure | `/BOBF/S_FRW_ACTION`: 2 / 6 | `blueSource`, TABL/DS; add under TABL; table and structure paths are never guessed from name |
| TTYP | `/BOBF/T_FRW_CHANGE`: 1 / 32 | `tableType`, TTYP/DA; add; row-structure relationship |
| DTEL | `/BOBF/CONF_CHANGE_MODE`: 1 / 29 | `wbobj`, DTEL/DE (not a guessed dataElement root); add; domain and structure usages |
| DOMA | `ZPROD`: 1 / 1 | `domain`, DOMA/DD; add; value-table and data-element links |
| PROG | `ZABAPGIT`: 59 / 1 | `abapProgram`, PROG/P; add; huge standalone variant exceeds shipping byte cap |
| INCL | `ZABAPGIT_FORMS`: 48 / 0 | `abapInclude`, PROG/I; add; do not misroute as executable program |
| FUNC | `BAPI_USER_GETLIST`: 5 / 15 | `abapFunctionModule`, FUGR/FF; add; bounded group resolution and verified composite native names |
| FUGR | `SU_USER`: 237 / 0 | `abapFunctionGroup`, FUGR/F; add; limited retained graph, no execution or expanded source download |
| VIEW | `V_USR_NAME`: 2 / 1 | `mainObject`, VIEW/DV, uppercase VIT object name; add with independent exact-search existence check; distinct from CDS |
| ENHO | `ZABAPGIT_REPOS`: 2 / 0 | `objectData`, ENHO/XHB; add only this BAdI implementation subtype |
| SRVB | Two active bindings: 0 / 0 | Do not add from these empty ENV/WUL responses; existing binding metadata already exposes definition links |
| DDLX | Two active annotations: 0 / 0 | Do not advertise ENV/WUL usefulness; investigate CDS context separately |
| MSAG | `/BOBF/COM_GEN_MODEL`: 0 / 12; `/BOBF/COM_GEN_FRAME`: 0 / 10 | `messageClass`, MSAG/N; add after representative namespace samples; the initial Z objects were insufficient evidence |
| DEVC | `ZSSI_SAMPLES`: context empty, no root | Unsupported native root; package listing/search remains the correct entry point |
| TRAN | `ZABAPGIT`, `ZTOAD`: 1 / 0 each | TRAN/T, uppercase VIT mainObject; add with independent exact search; links to program, does not execute it |
| SOBJ | `/BA1/B121`, `/BA1/B122`: 1 / 0 each | SOBJ/MO, VIT mainObject; add with exact search; maintenance-object/program metadata, not table contents |
| SHLP | `ZSHLP01`: 2 / 0 | SHLP/DH, VIT mainObject; add with exact search; table and data-element dependencies |
| SKTD | `ZARC1SKTDMO1FSEY21IL3`: 1 / 0 | SKTD/TYP, docu; add; link to documented DDLS, not its business rule; inactive sibling correctly rejected |
| ENHS | `/AIF/ALERT`: 2 / 0 | ENHS/XSB, objectData; add this enhancement-spot subtype only; interface links; conflicting facets still fail |
| ENQU | `/AIF/EFGOBJ`: 1 / 0 | ENQU/DL, lockobject; add; table link, no lock acquisition |
| TYPE | `A4API`: 18 raw / 0 | TYPE/DG, abapTypeGroup; add; repeated native links deduplicate to three retained edges |
| EVTB | `BUSINESSUSER_CREATED`, `BUSINESSUSER_DELETED`: 3 / 1 each | EVTB/EVB, blueSource; add; BDEF/entity/object-type and incoming documentation links; no event traffic claim |
| DSFD | `CALENDAR_OPERATION`, `CALENDAR_SHIFT`: 0 / 2 each | DSFD/SCF, blueSource; add; implementation/documentation users, DSFI stays a boundary |
| AUTH | `/AIF/BG_P`, `/AIF/BG_SP`: 2 / 0 each | Useful links, but auth metadata has no active-version proof; defer rather than weaken the root contract |
| BSP | Search type rejected with HTTP 400 | No qualified ADT root; existing BSP/OData repository tools remain separate |
| DESD | Search type rejected with HTTP 400 | Not qualified on 758; no assumption from a newer release's AFF support |
| CSNM | Search type rejected with HTTP 400 | Not qualified on 758 |
| EVTO | Search type rejected with HTTP 400 | Not qualified on 758 |
| COTA | Search type rejected with HTTP 400 | Not qualified on 758 |
| DTSC | No matches for Z* or unfiltered search | No representative evidence; defer |
| DTDC | Two active definitions: 0 / 0 each | Identity possible but no useful links demonstrated; defer |
| UIAD | Two namespaced VIT descriptors: 0 / 0 each | Identity possible but no useful links demonstrated; defer |

Other unrelated repository types are not advertised. Discovery of a global endpoint does not
grant universal per-type support. Namespaced synthetic unit coverage is not live namespace
coverage for every family; actual `/BOBF/` DDIC objects are tested, with further samples recorded below.

This covers the concrete repository families in ARC-1's current read registry plus closely related
DDIC/enhancement families. Pseudo-read types such as SYSTEM, COMPONENTS, TABLE_CONTENTS, TABLE_QUERY,
TEXT_ELEMENTS, VARIANTS, API_STATE, INACTIVE_OBJECTS and VERSIONS are queries or subresources, not
separate repository graph roots. KTD/MESSAGES are existing aliases; FEATURE_TOGGLE/FTG2 is not a
qualified TADIR identity. None warrants a fabricated graph type. No claim is made about every
possible SAP TADIR type outside this inventory.

## Findings that changed the implementation

Additional live CDS/BO context probes found why these contexts cannot silently replace ENV/WUL:
SAP often returned a *different* activeContext than requested. BDEF BO had edges between non-root
entities and duplicate containment links; DDLX CDS pointed from the annotated entity to the
extension, opposite a consumer-to-dependency interpretation. Those are useful UI relations but
not the same generic used/using contract. Keep the existing CDS/RAP/source tools; defer a separate
typed containment/annotation API rather than mislabeling those edges as generic uses.
Two live namespaced function-module roots also validated the parent/name path family.

1. **Function module names differ by context.** Native names may be the short module name,
   a 40-character group prefix plus name, or a 40-character function-pool prefix plus name.
   Normalize only when name, group and a reconstructed fixed function path agree. Metadata's
   container must independently identify the same function group. Never strip arbitrary prefixes.
2. **Generated CDS entities use source anchors.** Preserve the specific
   `/ddic/ddl/sources/<source>/source/main#name=<entity>` identity as STOB boundary evidence.
   Do not collapse it into DDLS, fetch the anchor as a URL, or infer that the two names match.
   Other fragments, traversal and unsafe URIs remain rejected.
3. **Some root envelopes omit packageRef.** BDEF can provide package only in the native response.
   Fill only the previously unknown root package before ranking/cycle checks, using that caller's
   validated native network. This is prioritization metadata, never an authorization grant.
4. **HTTP 200 is insufficient.** `ZARC1_CITESTDCL` metadata was inactive and
   `ZARBINEMRJBGOGXG` was new, although native lookup reported active references. Even an explicit
   metadata `?version=active` request still returned those states. Keep root rejection.
5. **Large roots cannot be rescued by maxResults.** `ZABAPGIT_STANDALONE` ENV was 1,087,482
   bytes before metadata overhead, over the 1-MiB shipping budget. Improve the error hint: reduce
   depth or select a smaller root; output node limits do not shrink SAP's native response.
6. **Ambiguous native identities remain errors.** Deeper incoming traversal from
   `BAPI_USER_GETLIST` reaches a response where one URI is both ENHS/XSB and ENHS/XB. Those may
   represent different enhancement facets. No unverified alias folding: fail rather than merge
   the nodes or quietly claim successful coverage. A narrower depth-1 query can avoid that expansion.
7. **Classic VIEW can invent an active root.** The VIT metadata endpoint and native network both
   echoed a nonexistent view name as active. Require an independent bounded exact-name/type/path
   search before accepting VIEW metadata. After this fix, all 17 deliberately nonexistent root
   types were rejected before any native network POST. Search shares the same analysis budgets.

## Validation checkpoints

Initial implementation checkpoint: 6,282 unit tests in 208 files, typecheck, build, lint,
126-entry policy validation and file/schema budgets passed. These are not the final run counts.
Automatic unknown/supported discovery uses the previously reviewed enabled-surface ceilings;
the 72,000-byte / 18,000-token ceiling has not been increased. Denied and unsupported modes are
still tested. Tool snapshots intentionally change only SAPNavigate.

Actual model qualification is pending at this checkpoint. Evaluate task facts, tool selection,
arguments, provenance, empty/truncated results and ordinary-workflow controls separately, following
the official evaluation guidance.[^openai-evals] Preserve incomplete/error runs and avoid treating
completion rate as answer correctness. Earlier general-guidance counterexamples remain open.

## Sources

[^sap-relation]: SAP, [Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer), accessed 2026-09-10. UI contexts and scope, not a REST stability guarantee.
[^sap-356]: SAP, [ADT version 3.56](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/version-3-56), accessed 2026-09-10. Later service-definition used-object navigation extension.
[^openai-evals]: OpenAI, [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices), accessed 2026-09-10. Task-specific correctness, tool selection/arguments, edge cases and repeated comparison.
