# Automatic live relations: per-type qualification

Status: implemented, with final verification recorded below, 2026-09-10. PR #769 remains unmerged.
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
| BSP | Search type rejected with HTTP 400 | ARC-1's BSP read is a UI5 filestore abstraction, not a qualified native root; this invalid search code does not prove all SAP BSP objects lack relationships |
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
   Extend this independent check to the other qualified VIT families (TRAN, SOBJ, SHLP), not to
   arbitrary returned URLs. The later absent-root matrix covered all 26 root types.
8. **Root type is not a references filter.** Gemma repeatedly supplied `objectType` instead of
   `type`, then removed the filter without adding the required root type. Add a targeted missing-type
   validation message explaining the distinction. Do not infer the root type or accept the filter
   as an alias. Other tools' schemas and authorization are unaffected.
9. **Metadata availability can predate generic source support.** EVTB/DSFD native metadata was
   present on 758. Do not derive graph support from the release gate for ARC-1's newer AFF
   source read/write engine; this adapter never invokes that engine or adds write capability.

## Validation checkpoints

Initial implementation checkpoint: 6,282 unit tests in 208 files, typecheck, build, lint,
126-entry policy validation and file/schema budgets passed. These are not the final run counts.
Automatic unknown/supported discovery uses the previously reviewed enabled-surface ceilings;
the 72,000-byte / 18,000-token ceiling has not been increased. Denied and unsupported modes are
still tested. Tool snapshots intentionally change only SAPNavigate.

The final functional suite is recorded after the model section. There are no dependency additions,
no new service/configuration, and no SAP mutations in the live qualification. Compared with
`18f42c30`, the full standard tools/list grows by 1,092 bytes (about 273 estimated tokens). Only
SAPNavigate changes among the 12 tool definitions. One initialize-instruction line distinguishes
native maps from source-derived SAPContext; the established context-first guidance is retained.

## Actual model qualification

Use task facts, tool selection, arguments, provenance and ordinary-workflow controls separately,
following the official evaluation guidance.[^openai-evals] Completion is not correctness.
Models used the real read-only HTTP MCP server against A4H; ordinary controls used deterministic
SAP fixtures with the actual shipped schemas/instructions. No mocked model answers or external
model API keys were introduced. Ollama used temperature 0, seed 42, 32,768 context tokens and a
1,800-token response allowance. Prompts requested at most six calls and 220 words; the harness
hard-stopped at eight calls. A run using seven/eight calls fails the prompt allowance even if it
produced an answer. GPT used `gpt-5.6-sol`, medium effort, through the existing authenticated CLI.

### Per-type coverage and findings

- GPT at `91581e19`: all 17 original root tasks reached the correct native adapter. All 21 tasks
  (including four controls) completed. This is not a claim that every word was correct: an early
  enhancement answer shortened a subtype incorrectly, and selected follow-up reads occasionally
  supplied more than strictly metadata-only evidence.
- GPT at `5e54ae20`: ten selected repeats covered classes, DCLS, structures, table types, namespaced
  functions, VIEW existence validation, messages, empty RAP, byte limits and inactive roots.
  All completed. The structure answer independently checked DDIC metadata and explicitly separated
  a fourth-hop data-element/domain fact from the requested three-step graph. Inactive-root handling
  improved from four calls to one after the error explained the returned state.
- GPT at `5821a279`: all nine added-family tasks reached the correct native adapter (TRAN, SOBJ,
  SHLP, SKTD, ENHS, ENQU, TYPE, EVTB, DSFD). Answers distinguished same-name types, documentation
  links from document contents, event metadata from publication, and lock metadata from held locks.
  TYPE's self-edge was reported without inventing its cause. SOBJ attempted an additional SQL-gated
  metadata read, correctly blocked; DSFD's additional SAPRead exposed definition text, a strict
  metadata-only instruction miss. These extra reads are model decisions, not relation-handler reads.
- Qwen `qwen3.6:35b-mlx`, natural prompts at `5821a279`: 30/30 produced answers, but only **21/26**
  root tasks obtained a successful native graph. CLAS, DCLS, TABL and DTEL instead used source/context
  routes; SRVD used the wrong DDLS root and stopped. TYPE first tried DEVC, then recovered. The
  structure task used eight calls, exceeding the requested six. Thus this is not a 30/30 quality pass.
- Qwen interpretation errors remain even after successful lookup: treating a ten-node cap including
  the root as ten users, calling a requested cap a system-wide limit, inferring causes for a self-edge,
  confusing depth boundaries with truncation, and recommending unsupported follow-ups/depth zero.
  The structured result's node types, `direct=null`, coverage and limits remain the authority.
- Gemma `gemma4:31b`: ten natural tasks at `5821a279` produced answers but only one obtained a native
  graph. With the clearer missing-type error at `13bd3fb5`, the repeat obtained **zero of ten**.
  The message remains useful factual validation, but it is not a demonstrated model-routing fix.
  Four explicit-JSON controls then obtained three graphs after correcting the first invalid call;
  the class control repeated the invalid call eight times and failed. Even these three successful
  recoveries violated the requested one-call allowance, and one answer called a type boundary
  truncation despite the result's separate fields. Do not recommend this configuration for
  unattended native relationship analysis or claim that more wording solved it.
- Final GPT repeats at `13bd3fb5` covered table-type expansion, namespaced function expansion with
  the newly qualified TYPE nodes, the oversized-program refusal and inactive-root diagnostics.
  All four completed in one tool call each. The qualified adapter remains independently testable
  without relying on model compliance.

The compact factual hints `TTYP=table type; MSAG=message class` fixed concrete root-type confusions
in isolated tests. A much broader native-first description rewrite was rejected: it improved some
choices but not others. Two alternate initialize phrasings were also compared; the shorter
relationship-map line was retained. These experiments do not justify rewriting the other eleven
tools or adding automatic argument inference.

### Comparison with main and ordinary tasks

Main `c55adcb8` cannot provide this native action. Seven completed matched GPT prompts showed why
the addition is useful: the candidate can return typed native DCLS/structure/function/message
relationships instead of chasing source-derived substitutes. Main's BDEF-empty-map prompt exhausted
the tool allowance; preserve that failed run rather than dropping it from the evidence. The large
program control was also run independently on main. This is not an across-the-board speed benchmark:
existing SAPRead/references remain preferable for an exact domain lookup or source location.

Ordinary controlled tasks compared `18f42c30` with `3cf3887d`: 12 Qwen pairs and six GPT pairs
completed. Five GPT pairs were repeated against `5821a279`; business purpose, unit-test planning,
inactive draft, held-out documentation and user-provided requirements retained the important facts.
Both sides still sometimes omit documentation during draft review. Qwen still mixes required and
current behavior, gives unsupported syntax reassurance and can invent test code. None of these
ordinary runs invoked relations, so their remaining errors cannot be described as bad graph data.
Small paired samples do not establish universal non-regression or erase the earlier PR concerns.

Recommendation: expose the capability automatically as requested, but retain experimental labeling,
strict validation and human review of consequential conclusions. For weaker clients, explicit
`SAPNavigate(action="relations", type=..., name=...)` prompts are a diagnostic control—not a
reliable workaround for every client. Do not lower validation or enable permissions to make a
model test appear successful.

## Live regression and operational cost

The combined 26-type matrix used 108 calls (two directions, multiple real roots). It retained six
expected inactive/new-root rejections, one oversized-program refusal and one conflicting-enhancement
identity refusal. One additional metadata GET failed with a generic network error during overlapping
live/model tests; it was not converted to an empty graph. The same program sequence subsequently
passed its incoming lookup while still rejecting the oversized outgoing lookup. This transient
remains recorded, not dismissed as a proven ARC-1 or SAP defect.

The final 108-call repeat returned **100 bounded graphs and exactly the eight expected refusals**;
no generic network error recurred. Successful-call timings were median 778 ms, p95 3,419 ms,
maximum 4,511 ms; successful metadata median 8,552 bytes, p95 92,621, maximum 162,086; median three
attempts and maximum ten. Both runs are retained; do not silently replace the earlier counterexample.

Among the 99 successful calls in that overlapping run: median 715 ms, p95 3,694 ms, maximum 8,559 ms;
successful metadata bytes median 8,552, p95 110,489, maximum 162,086; median three HTTP attempts,
maximum ten. These are observed per-analysis timings, not isolated capacity/peak-memory measurements.
Discovery was already known in that matrix. A separate cold stdio smoke consumed 303,629 successful
metadata bytes / five attempts for the first TRAN lookup; later depth-one examples took two or three
attempts and about 0.5–0.7 seconds. Cold discovery cost must not be hidden in sizing claims.

All 26 absent roots were rejected before a native network POST. The shipped stdio smoke additionally
verified eight newer families, denied action hiding, guessed-call denial, missing roots and continued
listing after discovery. Models exercised the HTTP transport; local unit tests cover both direct
and Connectivity-proxy transport mechanics. Real deployed Cloud Connector/principal propagation and
other SAP releases remain unverified in this change.

No persistent graph storage is required. Normal source cache storage is independent. Successful
response bodies share a 1-MiB analysis allowance; error bodies retain their existing individual caps.
This is not a total-wire-byte or heap ceiling. No HANA/PostgreSQL/free-tier resource was provisioned.

## Reproduction and acceptance checks

1. Build ARC-1 and use an existing read-only SAP connection; no fixture creation is required.
2. Start with a known root from the per-type table. Use `action=relations`, the exact `type`/`name`,
   depth 1 and maxResults 10. Repeat incoming/outgoing; then try depth 2/3 on small roots.
3. Check consumer-to-dependency orientation, exact native types, namespace paths, root versus
   observed-reference existence, boundaries, truncation, metrics and unknown coverage. Compare a
   few selected edges with independent source/metadata when permitted; never infer runtime usage.
4. Test an absent root of each type. Reject before native POST. Test an inactive/new root, a large
   program, exact-search ambiguity and wrong native type/path. Do not relax limits or auth to pass.
5. Run models with prompts such as “Map incoming native relationships of DSFD CALENDAR_OPERATION,
   depth one, at most ten nodes. Distinguish implementation from documentation; metadata only.”
   Substitute each table root and direction. Add explicit empty/oversized/inactive controls and
   ordinary specification/draft-review prompts. Save prompts, actual schemas, arguments and results.
6. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run validate:policy`, `npm run build`,
   `npm run check:sizes`, `npm run docs:build`. The read-only smoke is
   `npx tsx scripts/smoke-live-relations.ts`, with TEST_SAP_URL/USER/PASSWORD/CLIENT and
   TEST_RELATION_CASES (one to eight relation input objects); pass credentials securely, not in a
   committed file or shell command history. Only SAPNavigate snapshots should change relative to
   the pre-flag-removal baseline; deny-action and multi-target/hyperfocused boundaries must remain.

## Final review result

At code revision `13bd3fb5`: **6,396 unit tests in 208 files passed**, including 241 per-type adapter
tests, plus typecheck, lint, 126-entry/14-schema policy validation, build, strict docs and file/schema
budgets. Full standard wire surface: **71,991 bytes / 17,998 estimated tokens**, under the unchanged
72,000-byte wall. Known-credential/diff-whitespace checks passed; seven standard snapshot changes
were verified to affect SAPNavigate only. Current main `c55adcb8` is an ancestor, so there is no
separate untested merge tree at this checkpoint. Documentation-only completion follows this revision.

Review found no need for a new service, framework, per-type handler hierarchy, cache, role or config
switch. Fixed paths, one metadata registry and the existing strict traversal suffice. Preserve the
experimental label, known per-type/release limits and model-quality concerns. Local functional
clearance is **not** a universal model-quality or production-deployment clearance. Push to the
existing PR for review; do not merge automatically.

## Sources

[^sap-relation]: SAP, [Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer), accessed 2026-09-10. UI contexts and scope, not a REST stability guarantee.
[^sap-356]: SAP, [ADT version 3.56](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/version-3-56), accessed 2026-09-10. Later service-definition used-object navigation extension.
[^openai-evals]: OpenAI, [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices), accessed 2026-09-10. Task-specific correctness, tool selection/arguments, edge cases and repeated comparison.
