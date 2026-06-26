# Joule for Developers 2026 Roadmap — Per-Feature ARC-1 Implementation Assessment

> **Scope:** SAP's 8 announced Joule for Developers / ABAP AI roadmap features (release windows 2608/2611/2702/2027) and the upcoming **MCP Tool for ABAP Object Search**.
> **Question:** For each, can ARC-1 deliver the same capability today? If not, what is the cheapest path — ARC-1 code change, a Claude skill, a sister MCP server, or "wait for SAP"?
> **Method:** Code audit of `src/handlers/intent.ts`, `src/adt/*`, and `src/aff/schemas/*`; web research across SAP Help + SAP Community + Sapphire 2026 sessions; GitHub code search for ADT REST endpoints (`marcellourbani/abap-adt-api`, `abapify/adt-cli`, `SAP/open-ux-tools`); cross-reference with prior research in [`docs/compare/J4D/01-joule-for-developers.md`](../compare/J4D/01-joule-for-developers.md) and [`docs/compare/J4D/02-sap-abap-mcp-server-vscode.md`](../compare/J4D/02-sap-abap-mcp-server-vscode.md).
> **Date:** 2026-05-13.

> **Code-location note (post-#402):** this assessment predates the `src/handlers/intent.ts` split.
> Its `src/handlers/intent.ts` paths and line numbers are stale — the handlers are now per-tool
> modules (`read.ts`, `write.ts`, `dispatch.ts`, …) and the XML builders (`buildCreateXml`) live in
> `write-helpers.ts`. Re-verify each touchpoint against [AGENTS.md](../../AGENTS.md) before
> implementing.

---

## TL;DR

| # | Roadmap feature | ARC-1 today | Cheapest path to parity | Effort |
|---|----------------|-------------|-------------------------|--------|
| 1 | CDS Analytical Query Generation | DDLS read/write works; no analytical scaffold | New skill `generate-cds-analytical-query` + AFF-validated DDLS templates | **S** (skill only) |
| 2 | Semi-automated Clean-Core ATC Fixes | `SAPDiagnose(quickfix/apply_quickfix)` already wraps `/sap/bc/adt/quickfixes/evaluation` (verified live a4h 2026-04-14); skills `sap-clean-core-atc` + `migrate-custom-code` exist | Polish existing skills; add ATC-finding → quickfix correlation helper | **XS** (already shipped) |
| 3 | CDS Analytical Model Generation (basic — cube + existing dims from RAP BO) | DDLS create works; no cube scaffold | New skill `generate-analytics-star-schema` (already proposed in J4D docs/compare matrix) | **S** (skill only) |
| 4 | CDS Analytical Model Generation (extended — cube + new dims from RAP BO **or** DDIC tables) | Same as #3; TABL read works | Same skill, broader templates | **S** (skill only) |
| 5 | Extensibility Assistant (custom field, BAdI, value help) | Append **read** works today (`SAPRead type=TABL`); append/BAdI **create** is an opaque protocol ([spike](2026-06-04-tabl-append-create-spike-a4h.md)) | Read half: 0 code. Create half: **blocked** — needs an Eclipse wire-trace, not the `appendStructureXml` plan in §5a | **Read: done · Create: blocked** |
| 6 | RAP Model-Driven Joule Integration | SRVB read works; OData V4 publish works | Cannot replicate — this is Joule runtime exposing RAP BOs to *Joule's agentic engine*. Different problem domain. | **N/A** (out of scope) |
| 7 | AI Explain for Function Groups | FUGR source read works; `expand_includes` already follows explicit `INCLUDE` statements; **no FUNC sub-module walk, no dynpro read, no GUI status read** | Extend existing `explain-abap-code` skill **+** small ARC-1 code: widen FUGR `expand_includes` to cover FUNC sub-modules, plus new dynpro and GUI status readers | **M** (skill + small code) |
| 8 | AI Explain for Behavior Definitions | BDEF source + bound CLAS read works | Extend existing `explain-abap-code` skill; no ARC-1 code needed | **XS** (skill only) |
| 9 | MCP Tool for ABAP Object Search | `SAPSearch(quick_search\|tadir_lookup)` + `SAPRead(WHERE_USED)` already cover the announced surface | None — already shipped (and arrived 6 months before SAP's 2611/2702 GA) | **0** (done) |

**Net:** 7 of 9 features are reachable via skill-only changes; 1 needs minor ARC-1 code (FUGR include traversal); 1 needs both (Extensibility Assistant); 1 is genuinely out of scope (RAP→Joule agentic runtime).

---

## Methodology & Assumptions

**What Joule actually does at the wire level.** SAP Joule for Developers does *not* expose a public `/sap/bc/adt/abapaiexplain/` or `/sap/bc/adt/joule/` REST endpoint. Aggressive GitHub-code search across `marcellourbani/abap-adt-api`, `abapify/adt-cli`, `SAP/open-ux-tools`, `kennyhml/abap-language-server`, and `The-Nefarious-Developer/zjoule` returned zero hits for `abapaiservices`, `abapaiexplain`, `joulechat`, or `com.sap.adt.aiservices`. The published [SAP Help: Joule for Developers, ABAP AI capabilities](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/joule-for-developers-abap-ai-capabilities) and the [BTP ABAP setup guide](https://community.sap.com/t5/technology-blog-posts-by-sap/joule-for-developers-with-sap-btp-abap-environment-setup-guide/ba-p/14207462) describe a different architecture: the Eclipse ADT plugin (`com.sap.adt.tools.abapcloud.joule.*`, closed source) gathers IDE context locally, then forwards the prompt + context to **SAP AI Core (GenAI Hub)** on BTP through a destination of type `AIC_ADT_HTTP_PROXY` registered via `APPLDESTCC`. Authorisation gate on the ABAP side: business role catalog `SAP_A4C_BC_DEV_AIQ_PC` + auth object `S_AIQADTLO` with `AIQ_TYPE ∈ {JADC_CODE, JADC_TEXT}` and `ACTVT=AF`.

**Implication.** The "AI" in Joule is BTP-side. The half that is reachable from ABAP is **context aggregation + write-back** — exactly the half ARC-1 already automates via `SAPRead`, `SAPContext`, `SAPWrite`, `SAPActivate`, `SAPDiagnose`. Replacing Joule's LLM with the user's LLM (Claude / GPT-4 / Gemini) over MCP requires zero new ABAP-side endpoints. The model behind J4D is **SAP-ABAP-1** ([AI Core docs](https://help.sap.com/docs/AI_CORE/b9f48eb4a993445b863a55dd4d38f64d/d1972706d69a46acb01873ebe0c54689.html)) — a closed model, but exposed via the GenAI Hub Orchestration service, so any MCP client backed by an LLM can match its outputs once given equivalent context.

**SAP's own MCP server is IDE-embedded, not customer-hosted.** Per the [Sapphire 2026 announcement](https://community.sap.com/t5/technology-blog-posts-by-sap/entering-the-new-era-of-agentic-ai-for-abap-development/ba-p/14394643) and session [BTP2573](https://www.sap.com/events/sapphire/orlando/flow/sap/so26/catalog/page/catalog/session/1774374412394001bVsg), the ABAP MCP Server **ships as part of the VS Code extension and Eclipse plugin**. There is no documented BTP-hosted MCP gateway. Auth = whatever the developer already configured for their ADT session (basic / BTP service-key OAuth / SSO). ARC-1's central XSUAA + per-user principal propagation + BTP audit log is the enterprise-hosted alternative SAP does **not** ship.

---

## 1. CDS Analytical Query Generation powered by AI

> *"With the AI-based generation tooling a developer is able to generate analytical CDS projection views on top of existing analytical models to optimize their running business processes."*
> **Releases:** BTP ABAP 2608 · S/4HANA Cloud Public 2608 · S/4HANA Cloud Private 2027

### What SAP is actually building

A wizard inside Eclipse ADT (sister to the existing [Star Schema Generator](https://help.sap.com/docs/ABAP_AI/c7f5ef43ab274d078baf22f995fd2161/b8b846ac2bd84ee4ba8c895b74270bd8.html)) that generates `DEFINE TRANSIENT VIEW ENTITY ... AS PROJECTION ON <analytical-cube> PROVIDER CONTRACT ANALYTICAL_QUERY` ([ABAP Keyword Docu](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_ANALYTICAL_QUERY_APV.html)). Requires SAP_BASIS 7.58+ per the [ABAP Feature Matrix](https://software-heroes.com/en/abap-feature-matrix). Embedded analytics consumption only — these are *transient* views, no DB view is created.

### ARC-1 today

| Primitive | Status | File:Line |
|-----------|--------|-----------|
| Read existing analytical CDS (cube) | ✅ | `src/handlers/intent.ts` SAPRead type=DDLS; `src/adt/client.ts` `getDdls()` |
| Search for analytical cubes | ✅ | `src/handlers/intent.ts` SAPSearch quick_search + tadir_lookup |
| Create new DDLS | ✅ | `src/handlers/intent.ts` SAPWrite create with DDLS; AFF schema `src/aff/schemas/ddls-v1.json` |
| Activate | ✅ | `SAPActivate` |
| Annotation-specific scaffold (`@Analytics.query: true`, `@Consumption.valueHelpDefault`, measure aggregation) | ❌ | Not present in any template |

### Gap and fix

The capability gap is purely in the *prompt and template library* an LLM needs to generate a valid analytical query view. ARC-1's primitives are sufficient.

**Recommended path:** new skill `generate-cds-analytical-query`. The skill should:
1. `SAPSearch` for analytical models in the user's project scope (filter on `@Analytics.dataCategory: #CUBE`).
2. `SAPRead` the chosen cube + its dimension associations.
3. Prompt the LLM with the cube source + the analytical-query template surface ([SAP Help: Analytical Query Views](https://help.sap.com/docs/ABAP_Cloud/...) — exact link to be added once skill is authored).
4. `SAPWrite(create)` the new DDLS, then `SAPActivate`.

No ARC-1 code change needed. Effort: **~1 day** for the skill.

---

## 2. Semi-Automated Fixes of Clean Core ATC Findings

> *"...generate code proposals to fix Clean Core related ATC findings via the ADT Joule Chat. One example is the migration of SQL statements on SAP database tables towards released SAP CDS views."*
> **Release:** S/4HANA Cloud Private 2027 (only)

### What SAP is actually building

The developer-facing edition of the broader [Mass S/4 Custom Code Conversion Agent](https://community.sap.com/t5/technology-blog-posts-by-sap/entering-the-new-era-of-agentic-ai-for-abap-development/ba-p/14394643) (Q2 2026, separate). Joule reads an ATC finding (typically a `CHECK_RULE_ID` from the [SAP_CP_CCM_TRANSITION_S4_2025_CLOUD ATC variant](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-test-cockpit-atc-recommendations-for-governance-of-clean-core-abap/ba-p/14186130)), proposes a code transformation, and applies it via the standard ADT quickfix machinery.

### ARC-1 today — already shipped

This feature is **already implemented end-to-end** in ARC-1, verified against a live SAP A4H system on 2026-04-14 ([`docs/plans/completed/2026-04-14-fix-proposals-auto-fix-from-atc.md`](../plans/completed/2026-04-14-fix-proposals-auto-fix-from-atc.md)):

| Primitive | Endpoint | ARC-1 wrapper |
|-----------|----------|---------------|
| Run ATC | `/sap/bc/adt/atc/runs` (POST) | `runAtcCheck()` in `src/adt/devtools.ts:551` |
| Per-finding fix proposals | `/sap/bc/adt/quickfixes/evaluation` (POST) — query `uri=<src_uri>#start=<line>,<col>` (URL-encoded); body raw source; response root `<qf:evaluationResults>` with `<adtcore:objectReference>` + `<userContent>` blocks | `getFixProposals()` in `src/adt/devtools.ts:593` |
| Apply proposal | POST proposal URI with `<quickfixes:proposalRequest>` body (source + opaque `<userContent>`); response = ranged delta replacements | `applyFixProposal()` in `src/adt/devtools.ts:621` |
| Batch auto-quickfix worklist | `/sap/bc/adt/atc/autoqf/worklist` (backed by `CL_SATC_ADT_RES_AUTOQUICKFIX`) | Not yet wired |
| Re-run ATC after fix | (same as Run ATC) | ✅ |

**Skills already exist:** [`skills/sap-clean-core-atc/SKILL.md`](../../skills/sap-clean-core-atc/SKILL.md), [`skills/migrate-custom-code/SKILL.md`](../../skills/migrate-custom-code/SKILL.md).

### Gap

Only one minor capability is missing: the **batch auto-quickfix worklist** endpoint (`/sap/bc/adt/atc/autoqf/worklist`) is not wrapped yet. Findings carry `<atcfinding:quickfixes manual="..." automatic="..." pseudo="..."/>` attributes that flag which are machine-applicable; ARC-1 could expose a one-shot "fix everything automatic on this package" operation. This is a **6-month lead** over SAP's 2027 GA on S/4HANA Cloud Private. Worth doing as an `SAPDiagnose action=batch_quickfix` follow-up — separate one-page plan, modest effort.

---

## 3 & 4. CDS Analytical Model Generation (Basic + Extended)

> *Basic:* generates **cube + identifies existing dimensions** from a RAP BO.
> *Extended:* also generates **new dimensions**, accepts **DDIC tables** as input (not just RAP BO).
> **Releases:** Basic — S/4HANA Cloud Private 2027 only. Extended — BTP ABAP 2608 / S/4HANA Cloud Public 2608 / S/4HANA Cloud Private 2027.

### What SAP is actually building

AI-enhanced wrapper around the existing [CDS Analytical Model generator / Star Schema Generator](https://help.sap.com/docs/ABAP_AI/c7f5ef43ab274d078baf22f995fd2161/b8b846ac2bd84ee4ba8c895b74270bd8.html). Outputs:
- One cube view (`@Analytics.dataCategory: #CUBE`) with measures
- N dimension views (`@Analytics.dataCategory: #DIMENSION`) and text views (`#TEXT`)
- Foreign-key associations between cube and dimensions
- For RAP-BO input, the field semantics (amount, currency, quantity, unit) are inferred from the BO; for DDIC input the LLM has to guess from data-element semantics.

### ARC-1 today

| Primitive | Status | Comment |
|-----------|--------|---------|
| Read RAP BO root entity | ✅ | `getRapRootEntityRef()` in `src/adt/rap-generate.ts:200` (parsed from `<class:rootEntityRef>` on behavior pool class metadata) |
| Read DDIC table | ✅ | SAPRead type=TABL (covers `/tables/` and `/structures/` with auto-fallback) |
| Batch create DDLS objects with terminal activation | ✅ | SAPWrite `batch_create` with `activateAtEnd:true` (PR 270 in CLAUDE.md) — pure model is *exactly* the multi-object cube+dimensions+text scenario |
| Field semantics inference (currency/quantity/unit detection) | ⚠️ | LLM job; ARC-1 just supplies the table/BO metadata |
| Cube/dimension/text DDLS templates | ❌ | Not authored |

### Gap and fix

**Recommended path:** new skill `generate-analytics-star-schema` (already on the J4D docs/compare matrix as "to create"). The skill:
1. Discover input: RAP BO via class metadata, or DDIC table via SAPRead.
2. Read all candidate dimensions (associated entities or texts views in scope).
3. Generate cube DDLS + dimension DDLS + text DDLS (LLM uses templates the skill ships).
4. `SAPWrite(batch_create, activateAtEnd: true)` — one terminal activate resolves all cross-references in a single pass.

The existing batch_create+activateAtEnd mechanism makes the orchestration almost trivial — that PR was effectively pre-emptive plumbing for exactly this kind of multi-object scaffold. Effort: **~2-3 days** for the skill (most of the work is template authoring + few-shot examples). No ARC-1 code change.

---

## 5. Extensibility Assistant

> *"...find the right extension option (e.g. custom field, BAdI) in the SAP applications and to create it."*
> **Release:** S/4HANA Cloud Private 2027 (already GA on S/4HANA Cloud Public Edition for *key users*, per [J4D What's New](https://help.sap.com/docs/ABAP_AI/7b88d647742f4cdb82dadebf3b8481ed/bfbab3f3e8a84fa29b2b6e798c8fd1e7.html))

### What SAP is actually building

A Joule chat surface *inside the S/4HANA Cloud UI* (Key User Extensibility apps), not inside ADT — this is the only one of the eight that targets functional/key users rather than ABAP developers in Eclipse. Capabilities (per [SAP YouTube demo](https://www.youtube.com/watch?v=RyAaBBKILUg)): creating custom fields, finding business contexts, finding value-help views, enabling business scenarios, finding the right BAdI.

### ARC-1 today

| Primitive | Status | Comment |
|-----------|--------|---------|
| Search BAdIs / enhancement spots | ✅ | SAPSearch tadir_lookup with R3TR filter; ENHO/ENHS searchable |
| Read enhancement implementation | ✅ | SAPRead type=ENHO; `parseEnhancementImplementation()` in `src/adt/xml-parser.ts:639` |
| Read TABL metadata | ✅ | SAPRead type=TABL |
| Create custom CDS view | ✅ | SAPWrite type=DDLS |
| Append-structure (TABL subtype) **read** | ✅ | `SAPRead type=TABL` returns `extend type … with …` source today (zero code) |
| Append-structure (TABL subtype) **create** | ⛔ opaque | Source-based `TABL/DS`; shell-then-PUT create collides (`ResourceAlreadyExists`), 1-step source create rejected (415/400). [Spike](2026-06-04-tabl-append-create-spike-a4h.md) |
| BAdI implementation class stub | ❌ | No `SAPWrite action=scaffold_badi_impl` |
| Business-context / Custom-Object UI discovery (Key User Extensibility framework REST endpoints) | ❌ | None of the Key User Extensibility OData services are wrapped |

### Gap and fix

This is the only roadmap feature where the user-facing surface is **outside ADT** (Key User Extensibility = S/4 Cloud UI). Most "key user" actions go through OData services like `/sap/opu/odata/sap/SCFD_REGISTRY` (custom fields), `/sap/opu/odata/SAP/CTX_BUSINESS_CONTEXT` (business contexts), and `/sap/opu/odata/sap/UI_FACETED_SEARCH` (value helps) — none of which are ADT REST endpoints.

**Recommended path — two-track:**

1. **Skill `extensibility-assistant`** for the developer flow (BAdI search/scaffold, append-structure scaffold via DDIC). Effort: ~2 days.
2. **ARC-1 code change** for the *append structure* TABL subtype: the AFF TABL schema needs an `appendOf` field; `src/adt/ddic-xml.ts` needs the corresponding XML emitter; `src/adt/crud.ts` needs the create path. Effort: ~1-2 days, mirroring the existing TABL/DTEL pattern.
3. **BAdI implementation scaffold** could be a new `SAPWrite action=scaffold_badi_impl` (parallels the existing `scaffold_rap_handlers` in `src/adt/rap-handlers.ts`). It would take a `BADI_DEF` name + implementation class name, read the BADI definition's interface, and emit a CLAS stub implementing that interface. Effort: ~3 days.
4. **Key User Extensibility OData** — out of scope unless the user owns S/4 Cloud Public. Defer.

---

## 6. RAP Model-Driven Joule Integration

> *"...expose the business capabilities built with the ABAP RESTful Application Programming Model (RAP) to the agentic runtime of Joule."*
> **Releases:** BTP ABAP 2608 / S/4HANA Cloud Public 2608 / S/4HANA Cloud Private 2027

### What SAP is actually building

A *runtime* feature, not an IDE feature. At request time, Joule's agentic engine (in the Joule app, Joule Studio, or SAP Build agents) calls RAP-exposed business operations directly — i.e., RAP BOs become first-class Joule "skills". Likely mechanism: a Joule-side adapter consumes RAP service-binding metadata (the same metadata that drives `/sap/opu/odata4/...` V4 services) and surfaces CRUD + actions as agent tools. Today's predecessors are [Custom Joule Skills via RFC](https://community.sap.com/t5/technology-blog-posts-by-sap/building-custom-joule-skills-via-rfc-guide-for-sap-s-4hana-and-ecc/ba-p/14363568) and the [Joule custom MCP architecture POC](https://community.sap.com/t5/technology-blog-posts-by-sap/connecting-custom-joule-agents-to-mcp-servers-a-poc-architecture-for/ba-p/14356644).

### ARC-1's role

**Out of scope as a direct competitor.** This is Joule consuming RAP runtime, not ARC-1 doing development work. ARC-1 *helps build* the RAP BOs that #6 then exposes. Two adjacent points worth noting:

1. **Joule Studio can already attach to remote MCP servers** ([Joule Studio docs](https://help.sap.com/docs/joule), [ARC-1 + Joule Studio blog](https://blog.zeis.de/posts/2026-05-08-arc-1-joule-studio-clean-core/)) — destination type Streamable HTTP, no interactive OAuth. ARC-1 *itself* can already plug into Joule Studio as a generic tool layer; this is a deployment-pattern win, not a feature competition.
2. **Joule will know how to call RAP BOs natively** — meaning fewer human-written "skills" need to wrap RAP operations. ARC-1's overlap is essentially zero here; we don't compete with Joule's runtime engine.

**Recommendation:** monitor the SAP/SAP-samples repos for the wire format Joule uses when consuming RAP service bindings as agentic tools; document any reusable metadata reading paths in `docs/compare/J4D/` once SAP publishes the format. No ARC-1 code change.

---

## 7. ABAP AI Explain for Function Groups

> *"...explanations of the flow logic, business purpose, and screen flow of function groups."*
> **Releases:** BTP ABAP 2608 / S/4HANA Cloud Public 2608 / S/4HANA Cloud Private 2027

### What SAP is actually building

Extension of the existing AI Explain (currently for reports/classes/dynpros) to FUGR. The high-value bit is "screen flow" — most legacy logic lives in FMs + SAPGUI dynpros, and explaining a function group requires walking the include tree: top FUGR include → all FUNC includes → all dynpros (SCRP) → flow logic (PBO/PAI modules) → GUI status (MENU + function codes).

### ARC-1 today

| Primitive | Status | File:Line |
|-----------|--------|-----------|
| FUGR source read (top include) | ✅ | SAPRead type=FUGR / FUNC; `getFunctionGroup()` in `src/adt/client.ts` |
| FUNC parameter-aware read | ✅ | `includeSignature=true` returns JSON `{source, signature: {importing, exporting, ...}}` (issue #252) |
| `expand_includes` for FUGR (partial) | ⚠️ | Implemented at `src/handlers/intent.ts:1505` — regex-matches explicit `INCLUDE` statements only; does not enumerate FUNC sub-modules, dynpros, or GUI statuses |
| Dynpro / SCRP read | ❌ | Not exposed as a SAPRead type |
| GUI status / menu read | ❌ | Not exposed |
| FUGR object graph traversal | ❌ | No helper "list all artifacts in this FUGR" |

### Gap and fix

Along with Feature 5 (Extensibility Assistant), this is one of two roadmap items that needs ARC-1 code changes — and the one with the most read-side surface (three new artifact types to support):

1. **Extend `expand_includes` for FUGR** to walk FUNC sub-modules (under `/sap/bc/adt/functions/groups/<name>/fmodules/`) in addition to the explicit `INCLUDE` statements it already follows. The current loop lives at `src/handlers/intent.ts:1505-1526`; extend in place. Effort: ~1 day.
2. **Add Dynpro/SCRP read** as a new SAPRead type — `/sap/bc/adt/programs/programs/<prog>/dynpros/<dynnr>`. Effort: ~1 day, follows existing read patterns.
3. **Add GUI status read** — `/sap/bc/adt/programs/programs/<prog>/cuastatus/<status>`. Effort: ~1 day.
4. **Skill `explain-abap-code` already exists** ([`skills/explain-abap-code/SKILL.md`](../../skills/explain-abap-code/SKILL.md)) — extend it to accept FUGR and pull the expanded artifact bundle.

Combined effort: **~3-4 days** of ARC-1 code + ~half-day of skill extension. The skill already exists, so the marginal cost is mostly the new readers.

**Wire-level reference for SCRP/CUA:** the Eclipse ADT REST surface for dynpros and CUA status is sparsely documented but covered in `marcellourbani/abap-adt-api`. Use those as the wire-format reference rather than reverse-engineering from Eclipse plugin bytecode.

---

## 8. ABAP AI Explain for Behavior Definitions

> *"...explanations of the business purpose, business logic, and dependencies associated with behavior definitions."*
> **Releases:** BTP ABAP 2611 / S/4HANA Cloud Public 2702 / S/4HANA Cloud Private 2027

### What SAP is actually building

The RAP-native equivalent of #7 — instead of digesting a function group's flow logic, the model summarises a BDEF's CRUD/action graph, determinations, validations, side effects, and authorization scopes. Behavior definitions are an ABAP RAP construct (SAP_BASIS 7.53+, per [ABAP Feature Matrix](https://software-heroes.com/en/abap-feature-matrix)).

### ARC-1 today — ready to go

| Primitive | Status | File:Line |
|-----------|--------|-----------|
| BDEF source read | ✅ | SAPRead type=BDEF |
| Bound CLAS discovery (BDEF → behavior pool class) | ✅ | Manual parse of `implementation in class` in BDEF source; OR via `<class:rootEntityRef>` on class metadata (`src/adt/rap-generate.ts:200`) |
| CLAS read (handler class with determinations/validations) | ✅ | SAPRead type=CLAS, method-level surgery available |
| RAP preflight (deterministic rules: TABL/BDEF/DDLX/DDLS) | ✅ | `src/adt/rap-preflight.ts` — gives the LLM structured "what is wrong / what is wired" signal |
| Where-used to find consumers | ✅ | SAPRead WHERE_USED + cds-impact classifier (`src/adt/cds-impact.ts`) |

### Gap and fix

No primitives missing. The `explain-abap-code` skill can be extended trivially. Effort: **~half a day** (just add BDEF-specific prompt templates that walk: BDEF source → root CDS → bound CLAS → key handler methods).

---

## 9. MCP Tool for ABAP Object Search

> *"You can now use an MCP tool to find ABAP development objects based on various search criteria, similar to the Ctrl + Shift + A search, as well as reference searches."*
> **Releases:** BTP ABAP 2611 / S/4HANA Cloud Public 2702 / S/4HANA Cloud Private 2027

### What SAP is actually shipping — critical

This is the public-facing slice of SAP's broader **ABAP MCP Server** (GA Q2 2026 per [Sonja Liénard's Sapphire blog](https://community.sap.com/t5/technology-blog-posts-by-sap/entering-the-new-era-of-agentic-ai-for-abap-development/ba-p/14394643) and [Introducing the Next Era of ABAP Development](https://community.sap.com/t5/technology-blog-posts-by-sap/introducing-the-next-era-of-abap-development/ba-p/14260522)). Hosting model — **IDE-embedded local stdio MCP**, not customer-hosted:
- SAP's MCP server ships inside Eclipse ADT and ADT for VS Code (`mcp.json` configuration, same pattern as [CAP/UI5/Fiori Elements MCP servers](https://community.sap.com/t5/technology-blog-posts-by-members/accelerating-sap-fiori-amp-cap-development-with-sap-mcp-server-github/ba-p/14391413)).
- Agents connect to a *local* MCP endpoint exposed by the IDE plugin.
- Auth = whatever the developer's ADT session uses (basic / BTP service-key OAuth / SSO ticket). **No XSUAA scope model published, no central audit log, no central deny-list.**
- Initial scope = Fiori service development. The "object search" tool extends this in Q4 2026 / Q1 2027.
- Multi-client by design: SAP names GitHub Copilot, Amazon Q, OpenAI, Anthropic, Google, IBM, Mistral as compatible.

The "object search" feature itself is **already shipped in ARC-1**:

| Required capability | Eclipse Ctrl+Shift+A surface | ARC-1 wrapper |
|---------------------|------------------------------|---------------|
| Free-text object search (name + short text) | `/sap/bc/adt/repository/informationsystem/search` | `SAPSearch action=quick_search` (`src/handlers/intent.ts`) |
| Type-filtered search (DDLS, CLAS, FUGR, ...) | same endpoint, `objectType=` param | `SAPSearch objectType=...` |
| TADIR lookup by name (canonical) | + `/sap/opu/odata/...` direct DB read | `SAPSearch tadir_lookup source=adt\|db\|both` (PR 270 — `db` and `both` escalate to SQL scope so viewer profiles can't piggyback) |
| Where-used / reference search | `/sap/bc/adt/repository/informationsystem/usageReferences` | `SAPRead WHERE_USED`; `findReferences()` in `src/adt/codeintel.ts:101` |

### Strategic posture

ARC-1 has a **6+ month lead** on SAP's 2611/2702 GA, and the *deployment model* is fundamentally different:

| | SAP ABAP MCP Server | ARC-1 |
|--|--------------------|-------|
| Hosting | IDE-local (per-developer) | Centrally hosted on BTP CF / Docker / npm |
| Auth | Inherited from IDE/ADT session | XSUAA + per-user principal propagation + API key |
| Audit | Implicit (IDE-side) | Central, BTP Audit Log Service sink + file/stderr sinks |
| Safety ceiling | Not published | Per-instance `allowWrites`, package allowlist, deny-actions, scope intersection |
| Multi-client | Yes (LLM-agnostic, IDE-embedded) | Yes (LLM-agnostic, transport-agnostic — Claude Desktop, Copilot Studio, Joule Studio, Cursor, VS Code Copilot, Gemini CLI) |
| Cross-system | One IDE instance per system | One ARC-1 deployment can serve many users against one (or many) SAP backends |
| On-premise reach | Same ADT REST surface ⇒ same reach for non-AI ops; AI features tied to BTP AI Core | Any system with ADT (incl. ECC 7.4+) — no AI-feature gating |

ARC-1's enduring differentiation is **shared multi-tenant agentic flows** (Copilot Studio agents, Joule Studio agents on BTP, multi-user team setups) — a category SAP's local-IDE-bound model does not address. No ARC-1 code change needed for #9.

---

## Eclipse ADT Internals — What Cannot Be Replicated by Wire Re-implementation

A cross-cutting finding from the wire-level research: **the "AI" half of every Joule feature is not at an ADT endpoint**. There is no `/sap/bc/adt/abapai*` collection. All AI work happens on the BTP-side AI Core (GenAI Hub) routed through the `AIC_ADT_HTTP_PROXY` destination set up in `APPLDESTCC`. The Eclipse plugin aggregates IDE context locally and posts the prompt + context to AI Core.

**Consequence for ARC-1.** We can't reach into SAP-ABAP-1 the same way Joule does (it is not exposed as a customer endpoint for the IDE feature; only via the separate GenAI Hub Orchestration API). What we *can* do — and what ARC-1 already does — is **be a richer context aggregator than Joule** via `SAPRead` + `SAPContext` + `SAPDiagnose` + `SAPLint` (pre-write hints) + `mcp-sap-docs` retrieval. The user's LLM-of-choice then replaces SAP-ABAP-1.

The empirical evidence is the open-source [zjoule plugin](https://github.com/The-Nefarious-Developer/zjoule) — an Eclipse plugin that bypasses Joule entirely and talks directly to AI Core / OpenAI / Ollama. Its source confirms that **the value-add of Joule is context aggregation + UX**, not a privileged backend endpoint. The MCP-server equivalent (ARC-1) just moves that aggregation to a tool surface a generic LLM client can call.

---

## SAP's Official Stack — GA State as of June 2026

SAP shipped both the ABAP Language Server (ADT-LS) and the ABAP MCP Server bundled inside one VS Code extension on **2026-05-29**, four days before Sapphire 2026. The picture is now concrete instead of speculative — and meaningfully *narrower* than the pre-GA roadmap suggested. Key verified facts (see [`docs/compare/J4D/02-sap-abap-mcp-server-vscode.md`](../compare/J4D/02-sap-abap-mcp-server-vscode.md) for the historical baseline that this updates):

### Distribution

- **One VSIX, two components.** `SAPSE.adt-vscode` v1.0.0 on the VS Code Marketplace (~7,125 installs by 2026-06-02, 2.47/5 average rating). Inside: TypeScript shell over a Java Language Server (`com.sap.adt.ls_1.0.0` + sibling JARs). The ABAP MCP Server lives in `com.sap.adt.mcp.core_3.58.1.jar` and runs inside the same JVM as the LS.
- **Same JAR also ships in Eclipse ADT** (`tools.hana.ondemand.com/latest`) — SAP confirmed in the [GA FAQ Q2](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-visual-studio-code-your-questions-answered/ba-p/14400848) that VS Code and Eclipse offer the same MCP tool set.
- **No standalone, no npm, no Docker, no separate VSIX.** The MCP server "only runs while Visual Studio Code is running" ([FAQ Q13](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-visual-studio-code-your-questions-answered/ba-p/14400848)). Standalone release is "under discussion" — no date.
- **Closed source.** SAP says it would "like to pursue [open-sourcing] in the future" but has not committed. SAP Developer License v3.2 explicitly forbids third-party redistribution of "APIs, Tools or Software" — embedding the LS in ARC-1 is **not** legally available without an OEM deal.

### Transport, auth, reach

- **HTTP on `localhost:2236`** with a per-start Bearer token (settings key `adt.mcpServer.token`). Off by default (`adt.mcpServer.enabled: false`, tagged `experimental`). No stdio, no SSE, no Streamable-HTTP. A `DNSRebindingProtectionFilter` is the only network hardening.
- **MCP-server → ABAP** uses the same `/sap/bc/adt/*` REST surface ARC-1 calls. No new backend endpoints introduced. Destination management lives in VS Code workspace config (`adt-vscode.openDestinationsJson`), **not** in `~/.adtls/destinations.json` (that file was pre-GA preview only).
- **System reach.** Backend works on NW 7.3 EHP1 SP04+ — but every MCP tool except `abap_list_destinations` requires the ABAP Cloud Generator, which is **only on BTP ABAP / S/4HANA Cloud Public / S/4HANA Cloud Private 2021+**. On NW 7.x and classic ECC the tool set is effectively dead.
- **Multi-client status.** Only **GitHub Copilot** reliably auto-discovers the server via VS Code 1.105+ `mcpServerDefinitionProviders` ("zero-config MCP"). Community testing reports Claude Code "did not recognize the virtual file system" and Codex "did not find any files/objects" against the SAP MCP — `http://localhost:2236/mcp` requires manual configuration plus token retrieval.

### Tool surface at GA (14 tools, extracted from the actual JAR constant pool)

| Family | Tools | What they do |
|--------|-------|--------------|
| Destinations | `abap_list_destinations` | List configured ABAP system destinations |
| Activation + test | `abap_activate_objects`, `abap_run_unit_tests` | Activate; run ABAP Unit |
| Create (4-step chain) | `abap_creation-get_all_creatable_objects`, `abap_creation-get_object_type_details`, `abap_creation-run_validation`, `abap_creation-create_object` | Blank-slate create of supported types — 4 round-trips per object |
| Business services | `abap_business_services-fetch_services`, `abap_business_services-fetch_service_information` | Read SRVB services + OData $metadata |
| RAP generators | `abap_generators-list_generators`, `abap_generators-get_schema`, `abap_generators-generate_objects` | Scaffold RAP via server-side `cl_abap_generator_*` |
| Transports | `abap_transport-get`, `abap_transport-create` | Find / create CTS request |

**What's missing at GA — confirmed by SAP's GA blog and the community ["Unboxing"](https://community.sap.com/t5/abap-blog-posts/unboxing-sap-abap-tools-for-vs-code-mcp-a-small-announcement/ba-p/14408635) review:** no source read, no source update, no object search, no syntax check, no ATC, no find-references / where-used, no SQL, no runtime diagnostics, no git/abapGit/gCTS, no FLP/UI5 repository tools. *"You can't read source code. You cannot search for objects. You cannot update objects… these are pretty significant gaps."* SAP roadmap teaser: ATC + transport unified diff in "the next release" — no firm date.

### Legal / API-Policy posture

- **API Policy v.4.2026a §1.2** explicitly authorises "custom-developed ABAP interfaces in private cloud and on-premise" — covers ARC-1's `/sap/bc/adt/*` use the same way it covers `marcellourbani/vscode_abap_remote_fs` and Eclipse ADT.
- **§2.2.2 introduces an "agentic AI" clause** prohibiting non-endorsed pathways for "(semi-)autonomous or generative AI systems that plan, select, or execute sequences of API calls." This is *new* and material — ARC-1 should document its position as a "customer-developed ABAP interface" with admin-controlled package/safety allowlists (which it already is), not as an unrestricted agentic gateway.
- **§3 anti-circumvention** is a risk vector for any MCP server in general; ARC-1's safety ceiling + audit log + explicit deny-action grammar is the right defensive posture.

### Implications for ARC-1 (read this as a delta to the earlier sections)

1. **Tool-name collisions.** When both servers load in one Copilot/Claude session, four pairs overlap directly: `abap_activate_objects` ↔ `SAPActivate.activate`; `abap_transport-get|create` ↔ `SAPTransport.find|create`; `abap_business_services-*` ↔ `SAPRead(type=SRVB)`; `abap_run_unit_tests` ↔ `SAPDiagnose action=run_unit_tests`. Add a one-page "MCP coexistence" doc and consider an optional `arc1__` tool-name prefix.
2. **The four genuinely new tools to consider adopting** (these are MCP capabilities SAP ships and ARC-1 does not): `abap_generators-list_generators`, `abap_generators-get_schema`, `abap_generators-generate_objects` (calls the server-side ABAP Cloud Generator — strictly Cloud-model object scaffolding), and `abap_business_services-fetch_service_information` (live OData $metadata read). Wrapping the generator endpoint `/sap/bc/adt/businessservices/generators` is already documented via `marcellourbani/abap-adt-api/src/api/rapgenerator.ts`. ~2-3 dev-days for all four.
3. **The Eclipse ADT Internals section above is now superseded for the MCP-specific claim.** "There is no `/sap/bc/adt/abapai*` endpoint" remains true (AI runs on BTP AI Core), but "SAP has no MCP server" is no longer accurate — SAP has 14 tools today, and 0 of them touch the AI hub. The earlier "richer context aggregator than Joule" framing is still correct for AI features; the new framing for source/search/diagnostics is "ARC-1 covers what SAP's MCP doesn't, on systems SAP's MCP can't reach."
4. **Don't pivot to a VS Code extension.** SAP confirmed Eclipse + VS Code are the only first-party hosts. Cursor / Theia / Neovim / CLI is where the long tail of MCP clients lives; ARC-1 is already positioned for that.
5. **Don't try to embed the ADT-LS.** License blocks bundling; no standalone delivery date; JVM dependency would break ARC-1's pure-Node deployment; same backend surface anyway. Replicate where it makes sense, ignore the rest.

### Big picture — per-feature, one statement each

| # | Feature | Big-picture change for ARC-1 |
|---|---------|------------------------------|
| 1 | CDS Analytical Query | **Skill-only.** Author `generate-cds-analytical-query`; SAP's MCP doesn't ship this today. ARC-1 lands the capability first. |
| 2 | Clean-Core ATC Fixes | **One tiny code add + skill polish.** Wrap `/sap/bc/adt/atc/autoqf/worklist` as `SAPDiagnose batch_quickfix`. SAP's MCP has **zero ATC tools** at GA — full ATC surface is a clean differentiation. |
| 3 + 4 | CDS Analytical Model (basic + extended) | **Skill-only.** `batch_create activateAtEnd` infrastructure already shipped (PR 270). SAP's `abap_generators-*` family doesn't include analytical models at GA. |
| 5 | Extensibility Assistant | **Most code-heavy ARC-1 work** (~850 LOC): add `TABL` AFF schema + APPEND-structure subtype + BAdI scaffold action. The on-prem / S/4 PCE customer segment SAP's solution cannot reach is exactly where this matters. |
| 6 | RAP → Joule Runtime | **Out of scope.** This is Joule's agentic engine consuming RAP, not development tooling. ARC-1 already plugs into Joule Studio via Streamable HTTP. Monitor SAP for the consumption wire format. |
| 7 | AI Explain for FUGR | **Three small read primitives** (~390 LOC): widen FUGR `expand_includes` to FUNC sub-modules, add Dynpro and CUA readers. SAP's MCP has no source-read tool at all — ARC-1 is the only practical FUGR-explain path even on the systems SAP supports. |
| 8 | AI Explain for BDEF | **Skill-only.** All primitives ready (BDEF read + bound CLAS read + RAP preflight). Extend `explain-abap-code`. |
| 9 | MCP Tool ABAP Object Search | **Already shipped + 6-month lead.** `SAPSearch` (quick_search + tadir_lookup) + `SAPRead WHERE_USED` cover the announced 2611/2702 surface. SAP's GA MCP doesn't have search at all — gap is wider than projected. |
| ★ | (New) ABAP Cloud Generator wrapper | **Optional code add** (~2-3 days). Wrap `/sap/bc/adt/businessservices/generators` so ARC-1 can call the same server-side RAP scaffolder SAP's MCP exposes — keeps tool-surface parity for clients that load both servers. |

---

## SAP's Official ABAP MCP Server + `adt-ls` — Wire-Level Anatomy

This section is grounded in a **decompile of `adt-ls` 1.0.0.202605281240** (the language server shipped inside `sapse.adt-vscode`) and our working sibling project [`arc-1-lsp`](https://github.com/marianfoo/arc-1-lsp), which already drives adt-ls headless. Authoritative references (live-verified against S/4HANA 2023 / kernel 7.58):

- [`arc-1-lsp/docs/adt-ls-reference.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/adt-ls-reference.md) — capability matrix, URI model, lifecycle, gotchas
- [`arc-1-lsp/docs/research/adt-ls-capability-map.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/research/adt-ls-capability-map.md) — decompiled-server inventory (23 `adtLs/*` segments, ~92 methods, all DTO shapes)
- [`arc-1-lsp/docs/arc-1-feature-parity.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/arc-1-feature-parity.md) — ARC-1 vs arc-1-lsp per-tool comparison

### Three surfaces inside adt-ls

| Surface | What | Count |
|---------|------|-------|
| **Standard LSP** `textDocument/*` | go-to, references, hover, completion, symbols, type-hierarchy, diagnostics — the IDE-style code intel | 11 providers advertised |
| **Custom `adtLs/*` JSON-RPC** | The real ADT surface: transport, activation, ATC, coverage, creation, srvb, run, debugger | **23 segments / ~92 methods** |
| **Embedded MCP server** (`/mcp`) | Streamable-HTTP MCP endpoint adt-ls hosts on localhost — this IS "SAP's ABAP MCP Server" | **7 static + N dynamic tools** |

### The embedded MCP server in detail

Source: `com.sap.adt.mcp.core_3.58.1.jar` (34 classes). Architecture:

- **Transport:** official `io.modelcontextprotocol` Java SDK; `HttpServletStreamableServerTransportProvider`; Streamable HTTP at `/mcp`; serverInfo `("ADT MCP Server", "1.0.0")`; Jetty bound to **localhost only**; 30-second request timeout.
- **Auth:** `TokenAuthenticationFilter` requires `Authorization: Bearer <token>`. Token is auto-generated (`SecureRandom` 16 bytes Base64url) unless the LSP client supplies one, and returned over LSP in `AdtMcpServerInitializationInfo{port, token}`. `DNSRebindingProtectionFilter` allows only `Host: localhost|127.0.0.1`.
- **Tool collection (`AdtMCPToolsRegistry.collectAllTools`):**
  1. **7 static tools** registered via Eclipse extension point `com.sap.adt.mcp.core.adtMcpTools`:
     `abap_activate_objects`, `abap_run_unit_tests`, `abap_creation-get_all_creatable_objects`, `abap_creation-get_object_type_details`, `abap_creation-run_validation`, `abap_creation-create_object`, plus the destinations-list tool.
  2. **N dynamic tools** harvested via `AdtMCPToolsIdeActionCollector`: fetches the connected ABAP backend's IDE-Actions (AIA), filters those whose title starts with `MCP`, renames `mcp_` → `abap_`, and exposes each with backend-authored schema. **This means the MCP tool list is system-dependent and re-enumerated on every `setDestination`.** Example: `abap_transport-get` and `abap_transport-create` are NOT in `plugin.xml` — they are `MCP_TRANSPORT-*` AIA actions on the backend.

### Critical implication: the AI half is NOT in adt-ls or its MCP

`adtLs/joule/getJouleDestination` exists, but it merely returns *"the side-by-side Joule AI destination for the project"* — i.e., a routing pointer to BTP AI Core. **No `adtLs/aiExplain`, no `adtLs/chat`, no Joule-AI MCP tool.** The "AI Explain", "Generate analytical query", "Clean-core ATC fix" features all execute in the IDE plugin's **AI orchestration layer** *above* adt-ls; they post the IDE context (which adt-ls supplies via `readFile`/`hover`/`semanticTokens`/`atc/runCheck`) plus a prompt to SAP AI Core through the `AIC_ADT_HTTP_PROXY` destination. There is **no headless API to drive Joule's AI itself**.

What this means: **the same context + a Claude/GPT-4 prompt = the same outcome.** The hard part is the context aggregation — and that's what ARC-1 (hand-rolled HTTP) and arc-1-lsp (via adt-ls) both already do.

### The big boundary: object type coverage

adt-ls's `objectCreation/getCreatableObjectTypes` enumerates **14 creatable types** (CLAS, INTF, DCLS, DRAS, BDEF, DRTY, CHDO, DDLS, DDLX, NROB, NONT, RONT, SRVB, SRVD). `readFile` only returns source for **modern ABAP-Cloud / RAP** types. **Classic types** (PROG, TABL, FUGR, FUNC, DOMA, DTEL, MSAG, TTYP, XSLT, SHLP, ENHO, …) return a `.jsonc` placeholder: *"not supported in ADT in VS Code. Please use ADT in Eclipse."*

The decompile of the other ~80 `com.sap.adt.*_3.58.x` backend plugins confirms the classic-type support **exists at the backend** (`ddic.{domain,dataelement,table,structure,…}`, `programs`, `functions`, `messageclass`, `enho.model`, …) but is **deliberately not wired in the LS front-end**. SAP could expose it later (a watch-item); today it is **permanently ARC-1's domain**.

### What's reachable for each Joule feature via adt-ls

| Joule feature | adt-ls primitive | arc-1-lsp wiring status | Verdict |
|---------------|------------------|-------------------------|---------|
| 1. Analytical Query (DDLS) | `objectGenerator/generateObjects` could host an analytical-query generator if SAP ships one in `MCP_*` AIA; otherwise `objectCreation/create` + `writeFile` for raw DDLS | `generate_objects` ✅; raw create/write ✅ | adt-ls path is plausible *once SAP ships the generator*; raw DDLS write works today |
| 2. ATC Clean-Core fixes | `atc/runCheck` returns findings, but `AtcRunFinding` has **NO quickfix/exemption data** — report-only. The quickfix endpoint `/sap/bc/adt/quickfixes/evaluation` is **NOT exposed via adt-ls**. | `run_atc` ✅; quickfix ❌ | **adt-ls cannot drive quickfixes — ARC-1's hand-rolled `getFixProposals`/`applyFixProposal` is the only path.** |
| 3-4. Analytical Model | `objectGenerator/{fetchAllGenerators,getSchemaForObjectGeneration,getListOfObjectsToBeGenerated,generateObjects}` — a 4-step wizard backend-driven by the connected SAP system | `generate_objects` ✅ (1-shot); 4-step pipeline not wired | adt-ls **is** the cleanest path if S/4HANA backend exposes an analytical-model generator; ARC-1's `batch_create + activateAtEnd` is the hand-rolled equivalent |
| 5. Extensibility Assistant | TABL APPEND structures and BAdI definitions are **classic types** — not in adt-ls's creatable set | ❌ (out of scope) | **adt-ls cannot do this. Only ARC-1 hand-rolled can.** |
| 6. RAP→Joule runtime | `joule/getJouleDestination` (pointer) + `businessservice/srvb/publishandUnpublishAction` (makes the OData service Joule will consume go live) | `publish_service_binding` ✅ | Out of scope as a feature; both ARC-1 and arc-1-lsp already cover the build-side. The runtime side is Joule's. |
| 7. AI Explain for FUGR | FUGR is **classic** — not in adt-ls's served types. `readFile` returns a `.jsonc` placeholder. | ❌ | **adt-ls cannot do this. Only ARC-1 hand-rolled can.** |
| 8. AI Explain for BDEF | `readFile` ✅ + `hover` on BDEF (DDLS-style inline parse) + `textDocument/{definition,references,typeHierarchy}` for traversal | All wired ✅ | arc-1-lsp **is the cleaner path** today; ARC-1 has equivalent reads but no `hover` |
| 9. MCP Object Search | `repository/quickSearch` ✅; `textDocument/references` for where-used ✅ | `search_objects` + `find_references` ✅ | Both ARC-1 (`SAPSearch`) and arc-1-lsp already implement this. SAP's Q4 2026 / Q1 2027 GA matches the existing surface. |

### One refactoring gap worth flagging

The decompile shows the backend has four refactorings (`BackendRenameRefactoringHandler`, `BackendExtractMethodRefactoringHandler`, `ExtractClif*`, `ChangePackageRefactoringHandler`) — but **none is reachable headless** because there is no `adtLs/refactoring` JSON-RPC segment and LSP `rename`/`codeAction` providers are unadvertised. Both ARC-1 and arc-1-lsp lose this capability until SAP exposes it. Out of scope for the eight Joule roadmap items, but a high-value future ask logged in `arc-1-lsp/docs/research/adt-ls-capability-map.md §9`.

---

## Big-Picture ARC-1 Code Change Per Feature

One-line statement per roadmap feature. *Modern* = a feature for which adt-ls covers the target object types (CLAS / INTF / DDLS / BDEF / SRVB / SRVD / DDLX / DCLS / DRAS); *classic* = the feature touches PROG / FUGR / TABL / DOMA / DTEL / MSAG / ENHO etc., where adt-ls is silent.

| # | Feature | Object class | One-line statement on what ARC-1 needs |
|---|---------|-------------|---------------------------------------|
| 1 | CDS Analytical Query Generation | modern | **No ARC-1 code change.** Author skill `generate-cds-analytical-query`; existing `SAPRead`/`SAPWrite`/`SAPActivate` cover all primitives. Optionally add a pre-write hint for `@Analytics.query` annotations. |
| 2 | Clean-Core ATC Fixes | modern + classic | **One small code change.** Wrap `/sap/bc/adt/atc/autoqf/worklist` as new `SAPDiagnose action='batch_quickfix'` (~150 LOC); per-finding quickfix is already shipped. `adt-ls` cannot help — it has no quickfix endpoint. |
| 3 | Analytical Model — basic | modern | **No ARC-1 code change.** Author skill `generate-analytics-star-schema`; `SAPWrite(batch_create, activateAtEnd:true)` (PR 270) is the orchestration primitive. |
| 4 | Analytical Model — extended | modern | Same as #3. Same skill. |
| 5 | Extensibility Assistant | **classic** (TABL APPEND, BAdI) | **Two code changes**: (a) new TABL APPEND subtype in `buildCreateXml` (`intent.ts:2709`) + new `tabl-v1.json` AFF schema (~250 LOC); (b) new `SAPWrite action='scaffold_badi_impl'` + `src/adt/badi-scaffold.ts` (~600 LOC). adt-ls doesn't serve these types — only ARC-1 hand-rolled covers them. |
| 6 | RAP Model-Driven Joule | runtime | **No ARC-1 code change.** Runtime feature — Joule consumes RAP at request time. ARC-1 already builds the bindings (`SAPWrite(create, type=SRVB)` + `SAPActivate`). |
| 7 | AI Explain for FUGR | **classic** | **Three small code changes**: (a) extend `expand_includes` for FUGR at `intent.ts:1505` to also enumerate FUNC sub-modules (~120 LOC); (b) new Dynpro/SCRP read (~150 LOC); (c) new GUI status read (~120 LOC). FUGR is classic — adt-ls returns a placeholder, so ARC-1 is the only path. |
| 8 | AI Explain for BDEF | modern | **No ARC-1 code change.** Extend existing `explain-abap-code` skill; BDEF read + bound CLAS read already work. |
| 9 | MCP Tool for Object Search | both | **Already shipped.** `SAPSearch quick_search/tadir_lookup` + `SAPRead WHERE_USED` cover the announced surface. SAP's Q4 2026 / Q1 2027 GA adds nothing not already there. |

### Cross-cutting recommendation: dual-path strategy

ARC-1 should **continue covering classic + modern types** (its enduring moat — adt-ls won't serve these). arc-1-lsp should remain the **modern-only, SAP-tracking edition** that benefits automatically when adt-ls / the embedded MCP server gains new features.

The Joule features split cleanly:

- **Features 1, 3, 4, 6, 8** (modern, skill-only) — implementing in ARC-1 also works in arc-1-lsp with minimal porting (most are skill-level).
- **Features 5, 7** (classic, requires hand-rolled code) — **ARC-1 only**, permanently.
- **Feature 2** (ATC quickfixes) — **ARC-1 only**, because adt-ls's ATC surface is report-only.
- **Feature 9** (object search) — already shipped in both.

Net new ARC-1 code across the roadmap stays at **~1,390 LOC across six sub-items** — the adt-ls/MCP-server research does not reduce that number (in fact it confirms it, since features 5 and 7 are permanently ARC-1's territory) but it clarifies *why* every line of that code matters: **classic-type and quickfix coverage is structurally absent from SAP's own MCP server.**

---

## Detailed ARC-1 Implementation Plan

This section is the engineering counterpart to the per-feature analysis above. For every roadmap item that requires ARC-1 *code* changes (not skill-only), it enumerates: exact files to touch, the pattern in the existing codebase to mirror, schema-sync obligations, tests to add, and expected diff size. Skill-only items are listed for completeness but kept short — they don't touch the TypeScript codebase.

The implementation plan follows three architectural invariants from [`CLAUDE.md`](../../CLAUDE.md):

- **Tool schema three-file sync.** Every property must exist in `src/handlers/tools.ts` (JSON Schema for LLMs), `src/handlers/schemas.ts` (Zod), and `src/handlers/intent.ts` (handler). Batch schemas live separately from top-level schemas — update both when relevant.
- **Safety guard at every ADT endpoint.** Every `http.{get,post,put,delete}` call must be preceded by `checkOperation(this.safety, OperationType.X, 'Y')`. No unguarded HTTP.
- **Audit + scope.** New SAPDiagnose / SAPWrite / SAPSearch actions must be added to `src/authz/policy.ts` `ACTION_POLICY` with the correct required scope. Without this, the runtime check + tool-list pruning go out of sync.

---

### Feature 1 — CDS Analytical Query Generation: skill only, zero ARC-1 changes

No code changes. Authoring effort lives entirely in `skills/generate-cds-analytical-query/SKILL.md`. The skill drives the standard read/write loop already exposed: `SAPSearch` → `SAPRead(type=DDLS)` → LLM completes the analytical-query DDLS → `SAPWrite(create, type=DDLS)` → `SAPActivate`. The AFF DDLS schema in [`src/aff/schemas/ddls-v1.json`](../../src/aff/schemas/ddls-v1.json) already validates the source-body envelope. Activation surfaces any annotation errors via the standard `formatErrorForLLM` path.

**Optional polish (not required for parity):** add an ARC-1-native pre-write hint for analytical-query DDLS — verify `@Analytics.query: true` is present and the projection is `ON` an entity with `@Analytics.dataCategory: #CUBE`. Mirrors the existing TABL `%admin draft include` hint in [`src/lint/pre-write-hints.ts`](../../src/lint/pre-write-hints.ts) and is wired through `validateBeforeWrite()` in [`src/lint/lint.ts`](../../src/lint/lint.ts). ~1 day if pursued.

---

### Feature 2 — Clean Core ATC Fixes: one new SAPDiagnose action (`batch_quickfix`)

Single-finding flow is shipped. The remaining gap is the **batch auto-quickfix worklist** endpoint `/sap/bc/adt/atc/autoqf/worklist` (backed by ABAP class `CL_SATC_ADT_RES_AUTOQUICKFIX`). It enumerates findings tagged `<atcfinding:quickfixes automatic="true"/>` and applies them in one server-side pass.

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| [`src/adt/devtools.ts`](../../src/adt/devtools.ts) | Add `runAutoQuickfixWorklist(http, safety, opts)` ~ near `getFixProposals()` at line 593. POST to `/sap/bc/adt/atc/autoqf/worklist` with the ATC run UUID. Guard with `checkOperation(safety, OperationType.Update, 'BatchQuickfix')`. | The existing `getFixProposals` / `applyFixProposal` pair (lines 593/621). |
| [`src/adt/types.ts`](../../src/adt/types.ts) | Add `AutoQuickfixWorklistResult { applied: number; skipped: AutoQuickfixSkip[]; remaining: number }`. | `AtcFinding[]` shape. |
| [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) | Parse the `<autoqf:worklistResult>` response (root element TBD against a4h — capture from first real call). | Existing `parseAtcWorklist`. |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | Add `case 'batch_quickfix'` in `handleSAPDiagnose`. Args: `{ atcRunId: string, packageScope?: string, maxFindings?: number }`. | Existing `case 'quickfix'` / `case 'apply_quickfix'` dispatch in `handleSAPDiagnose`. |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | Add `batch_quickfix` to `SAPDiagnoseSchema` action union at line 672. | Sibling `quickfix` / `apply_quickfix` entries. |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | Add `batch_quickfix` to the SAPDiagnose JSON Schema action enum + per-action property descriptors. | Sibling actions. |
| [`src/authz/policy.ts`](../../src/authz/policy.ts) | Add `'SAPDiagnose.batch_quickfix': 'write'` (or `'admin'` if you want it gated harder). | `SAPDiagnose.apply_quickfix` row. |
| [`tests/unit/adt/devtools.test.ts`](../../tests/unit/adt/devtools.test.ts) | Mock-fetch test for the new endpoint (happy path + 4xx + partial-failure). | Existing `runAtcCheck` tests. |
| [`tests/integration/adt.integration.test.ts`](../../tests/integration/adt.integration.test.ts) | Optional integration test, gated on `TEST_SAP_URL` + a published Clean Core ATC variant. | Existing `runAtcCheck` integration. |

**Estimated diff:** ~150 lines TS + ~80 lines tests. Effort: **~2 dev-days** including live verification on a4h.

**Skill side:** extend the existing [`skills/sap-clean-core-atc/SKILL.md`](../../skills/sap-clean-core-atc/SKILL.md) to call `batch_quickfix` when `automatic="true"` finding count exceeds a threshold; fall back to one-by-one `apply_quickfix` otherwise.

---

### Features 3 & 4 — CDS Analytical Model Generation (basic + extended): skill only

No code changes. The prerequisite plumbing — `SAPWrite(batch_create, activateAtEnd: true)` — already shipped in PR 270 (see CLAUDE.md row "Add SAPWrite batch_create `activateAtEnd`"). That feature was effectively pre-emptive infrastructure for the multi-object cube + dimensions + texts scaffold this feature needs.

The skill `skills/generate-analytics-star-schema/SKILL.md` orchestrates:

1. Discover input — `SAPRead(type=CLAS, includeMethods=false)` for a RAP behavior pool to pull `<class:rootEntityRef>` (already extracted via `parseClassMetadata` in [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) and consumed in [`src/adt/rap-generate.ts:200`](../../src/adt/rap-generate.ts)). Alternative input: `SAPRead(type=TABL)`.
2. Read candidate dimensions — `SAPSearch(tadir_lookup, source='adt')` with `objectType=DDLS` filtered to the BO's package + parent packages.
3. LLM composes cube DDLS + N dimension DDLS + N text DDLS using templates the skill ships.
4. `SAPWrite(batch_create, activateAtEnd: true)` with the array of objects. SAP's activator resolves the cube → dimension → text foreign-key associations in a single pass.

**Optional polish:** add an AFF schema variant `ddls-analytical-v1.json` enforcing the analytical-specific annotations (`@Analytics.dataCategory`, `@Semantics.amount.currencyCode`, `@ObjectModel.dataCategory`). Wire via [`src/aff/validator.ts`](../../src/aff/validator.ts) `TYPE_MAP` (line 10) — `getAffSchema()` (line 28) resolves from there. ~1 day. Worth doing if the skill produces too many round-trips on annotation errors.

---

### Feature 5 — Extensibility Assistant: TABL APPEND subtype + BAdI implementation scaffold

The largest in-scope code change set. Two independent additions, then a skill that uses both.

#### 5a. TABL APPEND structure subtype

> **⛔ SUPERSEDED by live spike (2026-06-04) — see [tabl-append-create-spike-a4h.md](2026-06-04-tabl-append-create-spike-a4h.md).**
> The plan below assumes appends are classic `R3TR APPS` objects created by mirroring `dtelXml`/`domaXml` (~2 dev-days). **That model is wrong on S/4HANA 2023 (SAP_BASIS 758):** an append is a *source-based* `TABL/DS` object (`extend type <base> with <append> { … }`, `<blue:blueSource>`), and its **create is an opaque protocol**. ARC-1's shell-then-PUT create fails (`ExceptionResourceAlreadyExists` / HTTP 400 — the shell pre-creates a *regular* structure whose name collides with the append), and 1-step source-body creates are rejected (HTTP 415/400 across content-types). **Append _read_ already works today with zero code** (`SAPRead type=TABL`) — that is the achievable half of Feature 5. Do **not** build the create plan below without first capturing an Eclipse "Create Append Structure" wire trace. The original plan is retained below for historical context only.

Today's `SAPWrite(type=TABL)` handles base transparent tables and structures via `src/adt/ddic-xml.ts`. APPEND structures (TYPE `R3TR APPS`) need their own subtype because:
- They reference a *parent* table via `<r3tr:appendOf>` in the XML envelope
- Their activation reorders the parent table's field list
- They have stricter naming rules (`Z*`, `Y*`, must end in special chars on standard tables)

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| [`src/adt/ddic-xml.ts`](../../src/adt/ddic-xml.ts) | Add `appendStructureXml(args)` ~ 80 lines. Mirrors `dtelXml` / `domaXml` (file is 418 lines total today). | `dtelXml` / `domaXml` functions. |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | Extend `buildCreateXml()` at line 2709 (NOTE: lives in `intent.ts`, not `crud.ts`) — its `case 'TABL'` branch must accept `args.appendOf` and call `appendStructureXml` when set. Keep `CONTENT_TYPE_FALLBACKS` in `crud.ts` narrow — no changes needed there. | Existing TABL branch inside `buildCreateXml`. |
| [`src/aff/schemas/tabl-v1.json`](../../src/aff/schemas/) | **Doesn't exist yet** — file lists only `bdef-v1.json`, `clas-v1.json`, `ddls-v1.json`, `intf-v1.json`, `prog-v1.json`, `srvb-v1.json`, `srvd-v1.json`. Adding TABL AFF support is a prerequisite. New file ~80 lines, modeled on `ddls-v1.json`. | Existing `ddls-v1.json` envelope. |
| [`src/aff/validator.ts`](../../src/aff/validator.ts) | Add `TABL` → schema filename mapping to `TYPE_MAP` (line 10). `getAffSchema()` (line 28) resolves it automatically via the map — no separate registration call. | Existing DDLS/BDEF rows in `TYPE_MAP`. |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | Add `appendOf?: string` to the TABL slice of `SAPWriteSchema`. Add validation: `appendOf` only valid when `type=TABL`. | Existing `include` field on CLAS writes. |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | Add `appendOf` to the SAPWrite JSON Schema TABL section. | The CLAS `include` property in the same file. |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | Wire `appendOf` through `handleSAPWrite create` to the XML builder. | The existing TABL create path. |
| [`src/adt/safety.ts`](../../src/adt/safety.ts) | No change — `allowedPackages` already gates by parent-object package. APPEND structures inherit the parent table's package gate naturally. | n/a |
| [`tests/unit/adt/ddic-xml.test.ts`](../../tests/unit/adt/ddic-xml.test.ts) | Add `appendStructureXml` unit tests (happy + invalid `appendOf` reference). | DTEL / DOMA tests. |
| [`tests/integration/adt.integration.test.ts`](../../tests/integration/adt.integration.test.ts) | CRUD lifecycle on a Z-prefixed append against a standard table (use `MARA` or a Z-test table; skip if not available). | Existing TABL CRUD test. |

**Estimated diff:** ~250 lines TS (schema + builder + handler wiring) + ~150 lines tests. Effort: **~2 dev-days**.

> **⚠️ Estimate invalidated by the 2026-06-04 spike.** The above assumes a `dtelXml`-style XML builder. The real append create is opaque (see callout at the top of 5a) — effort is **blocked** pending an Eclipse wire-trace capture, not ~2 dev-days. The *read* side is **0 days** (already works).

#### 5b. BAdI implementation scaffold

A new `SAPWrite action='scaffold_badi_impl'` that mirrors the existing `scaffold_rap_handlers` in [`src/adt/rap-handlers.ts`](../../src/adt/rap-handlers.ts) (1233 lines — read the file's header comment for the design pattern). Input: BAdI definition name + implementation class name. Output: a CLAS stub implementing the BAdI's filter-defined interface, plus a registration entry in an enhancement implementation.

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| New `src/adt/badi-scaffold.ts` | Pure module: `extractBadiRequirements(badiSource)` → list of methods to implement; `applyBadiImplementationStubs(requirements, classSource)` → updated CLAS source with method declarations + empty implementations. | `src/adt/rap-handlers.ts` `extractRapHandlerRequirements` + `applyRapHandlerImplementationStubs` (lines 1037+ for `ensureRapHandlerSkeletons`). |
| [`src/adt/client.ts`](../../src/adt/client.ts) | `getEnhancementImplementation(name)` already exists at line 595 (returns `EnhancementImplementationInfo` with `badiImplementations` array). Add `getBadiDefinition(name)` that reads `/sap/bc/adt/enhancements/badi_definitions/<name>`. Returns the BAdI interface name + filter signature. | `getEnhancementImplementation` at line 595. |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | New `case 'scaffold_badi_impl'` in `handleSAPWrite`. Args: `{ badiDefinition: string, implementationClass: string, implementationName: string, enhancementSpot?: string }`. Reads the BAdI definition + interface, scaffolds the class via `badi-scaffold.ts`, writes the new CLAS, registers the implementation via the enhancement implementation update path. | `case 'scaffold_rap_handlers'` dispatch in `handleSAPWrite`. |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | Add to `SAPWriteSchema` action union + per-action validation. | `scaffold_rap_handlers` entries. |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | Add to JSON Schema action enum + per-action fields. | `scaffold_rap_handlers` JSON Schema block. |
| [`src/authz/policy.ts`](../../src/authz/policy.ts) | `'SAPWrite.scaffold_badi_impl': 'write'`. | `SAPWrite.scaffold_rap_handlers` row. |
| `tests/unit/adt/badi-scaffold.test.ts` | New file. Pure-function tests on extract + apply. | `tests/unit/adt/rap-handlers.test.ts`. |
| [`tests/integration/adt.integration.test.ts`](../../tests/integration/adt.integration.test.ts) | Integration test against a published BAdI (skip if not available). | RAP-handler integration tests. |

**Estimated diff:** ~600 lines TS (pure module + handler) + ~300 lines tests. Effort: **~3 dev-days**.

#### 5c. Skill `extensibility-assistant`

After 5a and 5b land. Drives BAdI search (`SAPSearch tadir_lookup` with `objectType=BDEF` — confusingly the same canonical short type as RAP behavior definitions; use the slash alias `BADI_DEF` or filter via R3TR class), reads the chosen BAdI definition, prompts the user for the implementation behavior, scaffolds + writes. Effort: **~2 dev-days**.

---

### Feature 6 — RAP Model-Driven Joule Integration: no ARC-1 changes

Joule consumes RAP at runtime. ARC-1 is a development-time tool. The closest adjacent work is **none**. Monitor SAP for the wire format Joule uses when consuming RAP service bindings as agentic tools, and document under `docs/compare/J4D/04-rap-joule-runtime.md` (new file) once SAP publishes it. ~half a day of investigation work, no code.

---

### Feature 7 — AI Explain for Function Groups: three new readers + one skill extension

This is the only feature requiring more than one ARC-1 read primitive. The FUGR explain quality depends on having all four artifacts in the LLM context: top FUGR source, all FUNC sources, all dynpros (flow logic + screen), and the GUI status.

#### 7a. `expand_includes` for FUGR — extend, don't add

`expand_includes` for FUGR is **already partially implemented** in [`src/handlers/intent.ts:1505-1526`](../../src/handlers/intent.ts) (schema property declared at `src/handlers/schemas.ts:7141`, tool description at `tools.ts:519`). Current behaviour: pull FUGR top source, regex-match `INCLUDE <name>.` statements, fetch each via `client.getInclude()`, concatenate.

The gap: it follows only **explicit `INCLUDE` statements**, not the function group's **FUNC sub-modules** (which appear as separate top-level objects under `/sap/bc/adt/functions/groups/<name>/fmodules/`), and has no awareness of dynpros or GUI status. For a Joule-quality FUGR explanation, all four artifact classes must be in scope.

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| [`src/adt/client.ts`](../../src/adt/client.ts) | Extend `getFunctionGroup(name)` (line 345) — today it already returns `{ name, functions: string[] }`. Add a sibling `getFunctionGroupExpanded(name, opts)` returning `{ groupSource, includes: Array<{name, source}>, functions: Array<{name, source}>, dynpros: Array<{number, source}>, statuses: Array<{name, source}> }`. Reuse `getFunctionGroupSource` (line 352) and `getInclude` (line 358). | Existing `getFunctionGroup` + `getFunctionGroupSource` (lines 345, 352, 358). |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | Replace the in-place INCLUDE-regex loop in `case 'FUGR'` (line 1505) with a call to `getFunctionGroupExpanded`. Serialise to the same `=== <name> ===\n<source>` markdown blocks the loop currently emits so existing skill prompts keep working. | The block at lines 1505–1526 itself — extend, don't fork. |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | No change — `expand_includes` already accepted (line 7141). | n/a |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | Update the description at line 519 to mention FUNC sub-modules, dynpros, and GUI status are included when expand=true. | The existing description string. |
| [`tests/unit/adt/client.test.ts`](../../tests/unit/adt/client.test.ts) | Mock-fetch tests for `getFunctionGroupExpanded` (happy + empty + per-artifact failure modes). | Existing FUGR / FUNC tests. |

**Estimated diff:** ~120 lines TS + ~80 lines tests. Effort: **~1 dev-day**.

#### 7b. Dynpro (SCRP) read

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| [`src/adt/client.ts`](../../src/adt/client.ts) | New `getDynpro(programName, dynproNumber)`. Endpoint: `/sap/bc/adt/programs/programs/<prog>/dynpros/<dynnr>` (returns XML with `<dynpro:source>` + `<dynpro:flowLogic>` + `<dynpro:elements>`). | The existing PROG / FUNC reads. |
| [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) | New `parseDynpro(xml)` returning `DynproInfo { number, attributes, elements, flowLogic }`. | `parseEnhancementImplementation` (line 643). |
| [`src/adt/types.ts`](../../src/adt/types.ts) | Add `DynproInfo` + `DynproElement` types. | n/a |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | New `case 'DYNPRO'` (or fold into FUGR expand_includes — preferred, to avoid surface-area bloat). For standalone reads expose via slash type `DYNPRO` mapped in `SLASH_TYPE_MAP`. | `case 'PROG'` source-read branch. |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | Add `DYNPRO` to SAPRead `type` enum (or document that dynpros are accessed via FUGR expand). | Existing SAPRead type list. |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | Mirror schema. | Existing types. |
| [Citation guard](../../docs/research/abap-types/types/) | If exposing standalone DYNPRO type, add `docs/research/abap-types/types/dynpro.md` evidence file per CLAUDE.md "Add new ADT slash alias" row. | Existing evidence files. |
| [`tests/unit/adt/client.test.ts`](../../tests/unit/adt/client.test.ts) + [`tests/fixtures/xml/`](../../tests/fixtures/xml/) | Mock fixture + parser test. | Existing CLAS/PROG fixtures. |

**Estimated diff:** ~150 lines TS + ~100 lines tests + 1 XML fixture. Effort: **~1 dev-day**.

#### 7c. GUI status / CUA status read

**Files to touch:**

| File | Change | Pattern to mirror |
|------|--------|-------------------|
| [`src/adt/client.ts`](../../src/adt/client.ts) | New `getCuaStatus(programName, statusName)`. Endpoint: `/sap/bc/adt/programs/programs/<prog>/cuastatus/<status>`. | Same as dynpro. |
| [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) | New `parseCuaStatus(xml)` returning `{ name, menu: MenuEntry[], functionCodes: FCode[] }`. | n/a |
| Other files | Mirror 7b. | n/a |

**Estimated diff:** ~120 lines TS + ~80 lines tests. Effort: **~1 dev-day**.

#### 7d. Skill extension

Extend [`skills/explain-abap-code/SKILL.md`](../../skills/explain-abap-code/SKILL.md) to accept FUGR + dispatch to `SAPRead(type=FUGR, expand_includes=true)`. ~half a day.

---

### Feature 8 — AI Explain for Behavior Definitions: skill-only

No code changes. Extend [`skills/explain-abap-code/SKILL.md`](../../skills/explain-abap-code/SKILL.md) to:

1. `SAPRead(type=BDEF)` for the source.
2. Parse `implementation in class <ZBP_...>` to discover the behavior pool.
3. `SAPRead(type=CLAS)` for the pool, with `expand_includes=true` so CCDEF/CCIMP/test classes come too.
4. Optionally `SAPDiagnose(action='rap_preflight')` for structured "what is wired / what is broken" signal — already implemented in [`src/adt/rap-preflight.ts`](../../src/adt/rap-preflight.ts).
5. Optionally `SAPRead(WHERE_USED)` on the BDEF to surface consumers.
6. LLM composes the explanation.

Effort: **~half a day** of skill authoring.

---

### Feature 9 — MCP Tool for ABAP Object Search: no ARC-1 changes

Shipped. The announced surface maps cleanly onto:
- `SAPSearch action='quick_search'` (file: `src/handlers/intent.ts` `handleSAPSearch`)
- `SAPSearch action='tadir_lookup' source='adt'|'db'|'both'` (PR 270, three sources)
- `SAPRead action='WHERE_USED'` / `findReferences()` in [`src/adt/codeintel.ts:101`](../../src/adt/codeintel.ts)

The two non-functional differences worth promoting in ARC-1 marketing copy (not code changes):

1. **Multi-tenant hosting.** Document the BTP CF deployment pattern (XSUAA + Cloud Connector + per-user PP) prominently in the README — SAP's MCP server has nothing equivalent.
2. **Cross-system aggregation.** ARC-1 can address multiple SAP systems from one instance via destination switching. SAP's IDE-local model is bound to one ADT session.

---

### Cross-cutting code touchpoints

A consolidated view of the files most affected, useful for predicting merge-conflict surface and reviewer assignment:

| File | Feature(s) requiring change | Net new LOC estimate |
|------|----------------------------|----------------------|
| [`src/adt/client.ts`](../../src/adt/client.ts) | 7a, 7b, 7c, 5b | ~300 |
| [`src/adt/devtools.ts`](../../src/adt/devtools.ts) | 2 | ~80 |
| [`src/adt/ddic-xml.ts`](../../src/adt/ddic-xml.ts) | 5a | ~80 |
| [`src/adt/xml-parser.ts`](../../src/adt/xml-parser.ts) | 7b, 7c, 2 | ~150 |
| [`src/adt/types.ts`](../../src/adt/types.ts) | all coded features | ~80 |
| New `src/adt/badi-scaffold.ts` | 5b | ~400 |
| [`src/handlers/intent.ts`](../../src/handlers/intent.ts) | 2, 5a, 5b, 7a, 7b, 7c | ~250 |
| [`src/handlers/schemas.ts`](../../src/handlers/schemas.ts) | 2, 5a, 5b, 7a, 7b, 7c | ~120 |
| [`src/handlers/tools.ts`](../../src/handlers/tools.ts) | 2, 5a, 5b, 7a, 7b, 7c | ~150 |
| [`src/authz/policy.ts`](../../src/authz/policy.ts) | 2, 5b | ~10 |
| New `src/aff/schemas/tabl-v1.json` | 5a | ~80 |
| [`src/aff/validator.ts`](../../src/aff/validator.ts) | 5a | ~10 |
| **Total** | | **~1700 lines** |

Plus ~1000 lines of tests (unit + integration). **Total ARC-1 work: ~2700 lines, ~15-17 dev-days.** The remainder of the parity budget is skill authoring (~5-6 dev-days), arriving at the ~17-19 dev-day total cited in the executive summary.

---

### Required CLAUDE.md updates (after the work lands)

Each new operation requires a row in CLAUDE.md "Key Files for Common Tasks" so future contributors can find the touchpoints. Specifically:

- **Add SAPDiagnose batch_quickfix** — Feature 2.
- **Add TABL APPEND structure subtype** — Feature 5a.
- **Add BAdI implementation scaffold (`scaffold_badi_impl`)** — Feature 5b.
- **Extend FUGR `expand_includes` to enumerate FUNC sub-modules** (current implementation at `intent.ts:1505` only follows `INCLUDE` statements) — Feature 7a.
- **Add Dynpro (SCRP) read** — Feature 7b.
- **Add CUA / GUI status read** — Feature 7c.
- **Add TABL AFF schema** — Feature 5a (prerequisite).

The rows should follow the existing format: action verb + brief description + comma-separated file:line citations, mirroring rows like "Add new read operation" or "Add release-gated content-type fallback".

---

## Cross-Cutting Recommendations

1. **Author the three missing skills.** `generate-cds-analytical-query`, `generate-analytics-star-schema`, `extensibility-assistant`. The primitives all exist; this is template + few-shot authoring work. Skip `explain-abap-code` extensions for FUGR/BDEF — extend the existing skill instead.
2. **Add three small read operations** for FUGR explain parity: `expand_includes` for FUGR, dynpro/SCRP read, GUI status read. Each is ~1 day, follows existing read patterns in `src/adt/client.ts`. Document the entry points in CLAUDE.md "Add new read operation" with file:line.
3. **Add an append-structure TABL subtype + BAdI implementation scaffold** for the Extensibility Assistant skill. Append structure mirrors the existing DTEL/DOMA flow in `src/adt/ddic-xml.ts`; BAdI scaffold mirrors `src/adt/rap-handlers.ts`. ~5 days combined.
4. **Wrap `/sap/bc/adt/atc/autoqf/worklist`** as `SAPDiagnose action=batch_quickfix`. The existing single-finding flow is solid; batch is the remaining gap. ~2 days.
5. **Don't try to compete with #6** (RAP Model-Driven Joule). It's a Joule-runtime feature, not a development-tools feature. Monitor SAP for the wire format Joule uses to consume RAP service bindings as agentic tools; if it stabilises as a standard (akin to MCP), document it in `docs/compare/J4D/`.
6. **Position publicly on #9** (MCP Tool for ABAP Object Search). ARC-1 ships the announced functionality today, with an enterprise-grade deployment model SAP does not match. The right framing in marketing copy is: *"SAP's MCP server runs in your IDE for personal productivity. ARC-1 runs on BTP for shared multi-tenant agentic workflows — Copilot Studio, Joule Studio agents, team setups, multi-system aggregation."*

### Effort summary

| Bucket | Items | Total effort |
|--------|-------|--------------|
| New skills (no code change) | `generate-cds-analytical-query`, `generate-analytics-star-schema`, FUGR/BDEF extensions to `explain-abap-code` | ~5-6 days |
| ARC-1 read primitives (FUGR include traversal, SCRP, GUI status) | 3 readers | ~3-4 days |
| ARC-1 write primitives (TABL append subtype, BAdI scaffold action) | 2 features | ~5 days |
| ARC-1 ATC batch quickfix wrapper | 1 endpoint | ~2 days |
| Skill `extensibility-assistant` | depends on append/BAdI primitives | ~2 days |
| **Total** | | **~17-19 dev-days** to reach functional parity with 7 of 9 announced features |

Compare with SAP's 2608-2702 GA windows: features 1, 3-4, 6, 7 land Q2-Q3 2026 on BTP/Public Cloud; features 2, 8, 9 land Q4 2026 / Q1 2027; everything Private-Edition is 2027. ARC-1 can realistically be feature-complete on its 7 in-scope items within a single development sprint — and is the only path for customers on **on-premise S/4HANA, ECC 7.4+, and S/4HANA Cloud Private Edition pre-2027**.

---

## Sources

### SAP-published

- [SAP Help: AI / SAP Joule for Developers, ABAP AI Capabilities (canonical feature list)](https://help.sap.com/docs/ABAP_PLATFORM_CROSS/f2afdaf444844c38909aefc7bc792cdb/7f716223a88c40e0992777c8d9febccf.html)
- [SAP Help: J4D What's New (per-feature lifecycle + release dates)](https://help.sap.com/docs/ABAP_AI/7b88d647742f4cdb82dadebf3b8481ed/bfbab3f3e8a84fa29b2b6e798c8fd1e7.html)
- [SAP Help: J4D Availability (per-landscape capability matrix)](https://help.sap.com/docs/ABAP_AI/c7f5ef43ab274d078baf22f995fd2161/40d35806b38e4bcfa6989531a45ecf1d.html)
- [SAP Help: Embedded Analytics Star Schema Generator Powered by AI](https://help.sap.com/docs/ABAP_AI/c7f5ef43ab274d078baf22f995fd2161/b8b846ac2bd84ee4ba8c895b74270bd8.html)
- [SAP Help: SAP-ABAP-1 foundation model (AI Core)](https://help.sap.com/docs/AI_CORE/b9f48eb4a993445b863a55dd4d38f64d/d1972706d69a46acb01873ebe0c54689.html)
- [SAP Help: Joule for Developers, ABAP AI capabilities (auth catalog + setup)](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/joule-for-developers-abap-ai-capabilities)
- [SAP Roadmap Explorer (J4D / ABAP AI board)](https://roadmaps.sap.com/board?PRODUCT=73554900100800001562&PRODUCT=73555000100800001164&range=CURRENT-LAST)
- [ABAP Keyword Documentation: ABENCDS_ANALYTICAL_QUERY_APV](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_ANALYTICAL_QUERY_APV.html)
- [Integrating Joule with SAP Solutions (PDF)](https://help.sap.com/doc/de3af3c0f81642dbaa4d36172ed57a72/CLOUD/en-US/79bfc83ab386450c8cd9c7937ce26a3a.pdf)

### SAP Community (blog posts / roadmap announcements)

- [Entering the New Era of Agentic AI for ABAP Development (Sonja Liénard, Sapphire 2026)](https://community.sap.com/t5/technology-blog-posts-by-sap/entering-the-new-era-of-agentic-ai-for-abap-development/ba-p/14394643)
- [Introducing the Next Era of ABAP Development (TechEd 2025)](https://community.sap.com/t5/technology-blog-posts-by-sap/introducing-the-next-era-of-abap-development/ba-p/14260522)
- [Our 2026 Roadmap for Joule for Developers ABAP AI capabilities (Karl Kessler)](https://community.sap.com/t5/technology-blog-posts-by-sap/our-2026-roadmap-for-joule-for-developers-abap-ai-capabilities/ba-p/14360358)
- [Joule for Developers with SAP BTP ABAP Environment — Setup Guide](https://community.sap.com/t5/technology-blog-posts-by-sap/joule-for-developers-with-sap-btp-abap-environment-setup-guide/ba-p/14207462)
- [ATC Recommendations for Governance of Clean Core ABAP](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-test-cockpit-atc-recommendations-for-governance-of-clean-core-abap/ba-p/14186130)
- [Building Custom Joule Skills via RFC](https://community.sap.com/t5/technology-blog-posts-by-sap/building-custom-joule-skills-via-rfc-guide-for-sap-s-4hana-and-ecc/ba-p/14363568)
- [Connecting Custom Joule Agents to MCP Servers — POC architecture](https://community.sap.com/t5/technology-blog-posts-by-sap/connecting-custom-joule-agents-to-mcp-servers-a-poc-architecture-for/ba-p/14356644)
- [Accelerating SAP Fiori & CAP Development With SAP MCP Server + GitHub Copilot in VS Code (`mcp.json` pattern + API Policy Q37)](https://community.sap.com/t5/technology-blog-posts-by-members/accelerating-sap-fiori-amp-cap-development-with-sap-mcp-server-github/ba-p/14391413)
- [Joys and sorrows of the ABAP Developer Tools API](https://community.sap.com/t5/application-development-and-automation-blog-posts/joys-and-sorrows-of-the-abap-developer-tools-api/ba-p/13409390)

### Open-source ADT REST surface references

- [`marcellourbani/abap-adt-api`](https://github.com/marcellourbani/abap-adt-api) — most complete TS wrapper around ADT REST, notably `src/api/refactor.ts` (quickfix evaluation), `src/api/rapgenerator.ts` (`/sap/bc/adt/businessservices/generators`), `src/api/cds.ts` (CDS / DDLS endpoints), `src/api/atc.ts` (ATC worklist/exemption)
- [`abapify/adt-cli`](https://github.com/abapify/adt-cli) — 530-endpoint discovery inventory; reveals `/sap/bc/adt/ana/aqd` (Analytical custom query) and `/sap/bc/adt/atc/autoqf/worklist`
- [`SAP/open-ux-tools`](https://github.com/SAP/open-ux-tools) — `packages/axios-extension/test/abap/mockResponses/discovery-*.xml` — SAP's own mock discovery (notably no `/abapai*` or `/joule*` collections)
- [`kennyhml/abap-language-server`](https://github.com/kennyhml/abap-language-server) — Java LSP server with `discovery.xml` referencing `autoqf/worklist`
- [`The-Nefarious-Developer/zjoule`](https://github.com/The-Nefarious-Developer/zjoule) — open-source Eclipse plugin that bypasses Joule and talks directly to AI Core / OpenAI / Ollama (empirical evidence that the IDE plugin is the orchestrator, not a privileged backend)
- [`SAP/abap-file-formats`](https://github.com/SAP/abap-file-formats) — file-format spec referenced by SAP's VS Code extension

### Prior ARC-1 research (this repo)

- [`docs/compare/J4D/01-joule-for-developers.md`](../compare/J4D/01-joule-for-developers.md) — full J4D feature-to-skill mapping (12 capabilities)
- [`docs/compare/J4D/02-sap-abap-mcp-server-vscode.md`](../compare/J4D/02-sap-abap-mcp-server-vscode.md) — strategic analysis of SAP's Q2 2026 ABAP MCP Server
- [`docs/compare/abap-adt-api/evaluations/issue-37-quickfix.md`](../compare/abap-adt-api/evaluations/issue-37-quickfix.md) — confirms `/sap/bc/adt/quickfixes/evaluation` + `/application`
- [`docs/plans/completed/2026-04-14-fix-proposals-auto-fix-from-atc.md`](../plans/completed/2026-04-14-fix-proposals-auto-fix-from-atc.md) — live a4h verification of the quickfix wire format
- [`docs/research/2026-04-09-sapphire-2026-abap-ai-impact.md`](2026-04-09-sapphire-2026-abap-ai-impact.md) — SAP AI strategic landscape

### Sapphire 2026 sessions (timing references)

- [BTP2573 — Build smarter: Agentic ABAP development tools for VS Code](https://www.sap.com/events/sapphire/orlando/flow/sap/so26/catalog/page/catalog/session/1774374412394001bVsg)
- [JOU1428 — Agentic ABAP with SAP Joule for Developers](https://www.sap.com/events/sapphire/orlando/flow/sap/so26/catalog/page/catalog/session/1770220933562001wFEi)

### Third-party reference

- [ABAP Feature Matrix (Software Heroes)](https://software-heroes.com/en/abap-feature-matrix)
- [ARC-1 + Joule Studio Clean Core integration blog (Marian Zeis, May 2026)](https://blog.zeis.de/posts/2026-05-08-arc-1-joule-studio-clean-core/)
- [SAP YouTube: Using the Extensibility AI Assistant](https://www.youtube.com/watch?v=RyAaBBKILUg)

### Post-GA sources (June 2026 — for the SAP MCP Server + ADT-LS section)

- [VS Code Marketplace listing: SAPSE.adt-vscode v1.0.0](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode) (published 2026-05-29)
- [SAP Community: ABAP development tools for VS Code is now available on the marketplace (2026-06-01)](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-visual-studio-code-is-now-available-on-the-vs/ba-p/14402120)
- [SAP Community: ABAP development tools for VS Code — Your Questions Answered (2026-06-01)](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-development-tools-for-visual-studio-code-your-questions-answered/ba-p/14400848) — definitive FAQ on architecture (Q3 Java LS), parity (Q2 same JAR), standalone status (Q13)
- [SAP Community: The Future of ABAP is Here — VS Code ADT, Zero-Config MCP, and AI Co-pilots (community walkthrough, 2026-06-01)](https://community.sap.com/t5/technology-blog-posts-by-members/the-future-of-abap-is-here-vs-code-adt-zero-config-mcp-and-ai-co-pilots/ba-p/14408186)
- [SAP Community: Unboxing SAP ABAP Tools for VS Code + MCP (community first-look, 2026-06-01)](https://community.sap.com/t5/abap-blog-posts/unboxing-sap-abap-tools-for-vs-code-mcp-a-small-announcement/ba-p/14408635) — confirms missing source-read/write/search/ATC
- [SAP Community: Sapphire 2026 recap — Joule for Developers Agentic ABAP AI (2026-05-28)](https://community.sap.com/t5/technology-blog-posts-by-sap/sapphire-2026-recap-joule-for-developers-agentic-abap-ai/ba-p/14405739)
- [`SAP-samples/abap-platform-rap130`](https://github.com/SAP-samples/abap-platform-rap130) — RAP130 tutorial documenting 9 of the 14 GA tools
- [SAP Developer License v3.2](https://tools.hana.ondemand.com/developer-license-3_2.txt) — redistribution clause (relevant for "can ARC-1 embed the LS?")
- [SAP API Policy v.4.2026a](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) — §1.2 customer-developed interface carve-out; §2.2.2 agentic-AI clause; §3 anti-circumvention
- [`marcellourbani/vscode_abap_remote_fs`](https://github.com/marcellourbani/vscode_abap_remote_fs) — closest community LSP that talks to ADT REST; useful reference for the §1.2 precedent
- [`abaplint/vscode-abaplint`](https://github.com/abaplint/vscode-abaplint) — standalone ABAP LSP (no SAP backend); reference for the LSP capability surface ARC-1 could optionally expose
- [`SAP/abap-cleaner`](https://github.com/SAP/abap-cleaner) — Apache-2.0 ABAP source cleaner (Java); SAP plans to wire into ADT-LS for `textDocument/formatting`
