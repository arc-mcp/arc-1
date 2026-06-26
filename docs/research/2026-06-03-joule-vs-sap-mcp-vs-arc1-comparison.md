# SAP Joule + ABAP MCP Server vs ARC-1 + Skills — Feature Comparison

> **Question:** SAP is rolling out Joule for Developers ABAP AI capabilities and the official ABAP MCP Server (GA Q2 2026). For each announced capability, does an existing ARC-1 + skills deployment already cover it? Where doesn't it?
> **Answer in one line:** **All eight announced Joule developer-AI roadmap features are reachable today with ARC-1 + a thin skills layer.** Six are skill-only; two require small hand-rolled code; one (RAP→Joule runtime) is genuinely Joule's domain. SAP's IDE-local MCP server overlaps ARC-1 on object search but lacks central hosting, principal propagation, and on-prem / classic-type reach.
> **Date:** 2026-06-03. Companion to [`joule-2026-roadmap-feature-assessment.md`](2026-06-03-joule-2026-roadmap-feature-assessment.md) (the engineering plan per feature) and [`docs/compare/J4D/01-joule-for-developers.md`](../compare/J4D/01-joule-for-developers.md) (the J4D capability map).

---

## TL;DR positioning

| Stack | What it is | Hosting | Auth | Type reach | AI runtime | Status |
|-------|-----------|---------|------|-----------|------------|--------|
| **SAP Joule for Developers** (J4D) | AI copilot embedded in Eclipse ADT | Eclipse plugin → BTP AI Core via `AIC_ADT_HTTP_PROXY` destination | ABAP role `SAP_A4C_BC_DEV_AIQ_PC` + auth object `S_AIQADTLO` + BTP license | RISE / Public Cloud / BTP only — no on-prem | SAP-ABAP-1 foundation model on BTP AI Core | GA, expanding |
| **SAP ABAP MCP Server** | MCP endpoint inside the IDE | Local stdio inside Eclipse ADT + VS Code extension; Streamable HTTP on `localhost` only | Bearer token (auto-generated `SecureRandom` 16-byte Base64url), inherits IDE/ADT session for upstream | Modern ABAP-Cloud only (CLAS, INTF, DDLS, BDEF, SRVB, SRVD, DCLS, DDLX, DRAS) | Optional — the MCP server exposes capabilities "with and without embedded AI" | GA Q2 2026; "object search" tool BTP 2611 / S/4 Cloud Public 2702 / Private 2027 |
| **ARC-1 + skills** | Multi-tenant MCP server hand-rolling ADT HTTP + a library of Claude skills | BTP CF / Docker / npm / stdio — anywhere | XSUAA OAuth + OIDC + API key; per-user principal propagation via BTP Destination Service | **Classic + modern** — any object type ADT exposes, including FUGR/FUNC/PROG/TABL/DOMA/DTEL/MSAG/ENHO/XSLT | Any LLM the user wires (Claude, GPT-4, Gemini, Mistral) | Production, write-capable, multi-user |
| **arc-1-lsp** (sibling edition) | ARC-1 shell delegating to adt-ls headless | Local stdio or Docker (single-tenant) | adt-ls reentrance ticket / API key | Modern ABAP-Cloud only (adt-ls boundary) | Any LLM | Working; 39 tools live-verified |

The strategic pattern: **SAP's MCP runs in your IDE for personal productivity; ARC-1 runs on BTP for shared multi-tenant agentic workflows** (Copilot Studio agents, Joule Studio agents, team setups, multi-system aggregation, on-prem reach).

---

## Joule for Developers — capability map at a glance

J4D's full capability surface (per [SAP Help Portal — ADT AI Tools](https://help.sap.com/docs/ABAP_Cloud/bbcee501b99848bdadecd4e290db3ae4) and the [2026 roadmap blog](https://community.sap.com/t5/technology-blog-posts-by-sap/our-2026-roadmap-for-joule-for-developers-abap-ai-capabilities/ba-p/14360358)):

| # | J4D capability | Slash cmd / surface | ARC-1 + skills coverage | Status |
|---|----------------|---------------------|-------------------------|--------|
| 1 | Joule Chat (default) | *(default)* | ✅ Inherent — any MCP client + LLM | Covered |
| 2 | Explain Code | `/explain` | ✅ Skill `explain-abap-code` exists | Covered |
| 3 | ABAP Unit Test Generation | `/aunit` | ⚠️ Skill `generate-abap-unit-test` exists; J4D's sub-features (dep analysis, test doubles, splitting, refactor instructions) need polish | Partial |
| 4 | CDS Unit Test Generation | *(wizard)* | ✅ Skill `generate-cds-unit-test` exists | Covered |
| 5 | OData Client Consume | `/consume` | ⚠️ Building blocks exist; no dedicated skill yet | Partial |
| 6 | Documentation Chat | `/docs` | ✅ `mcp-sap-docs` MCP — broader than J4D's 4 guides | Covered |
| 7 | Predictive Code Completion | toolbar/inline | ❌ N/A — IDE-native real-time feature | Out of scope |
| 8 | OData UI Service from Scratch | wizard | ✅ Skill `generate-rap-service` exists | Covered |
| 9 | RAP Business Logic Prediction | Quick Fix Ctrl+1 | ✅ Skill `generate-rap-logic` exists | Covered |
| 10 | Custom Code Migration | `/docs` + CCM | ✅ Skills `migrate-custom-code` + `sap-clean-core-atc` exist | Covered |
| 11 | Star Schema Generator (analytical) | wizard | 📅 Skill `generate-analytics-star-schema` planned ([plan](../plans/2026-06-03-joule-cds-analytical-model-skill.md)) | Plan ready |
| 12 | Extensibility Assistant | context-menu / Key User UI | 📅 Skill + code planned ([plan](../plans/2026-06-03-joule-extensibility-assistant.md)) | Plan ready |
| 13 | ABAP AI SDK with ISLM | ABAP-side runtime | ❌ N/A — ABAP runtime SDK, different domain | Out of scope |

Summary: **9 of 13 covered today; 2 with plans ready; 2 genuinely out of scope** (IDE-native completion, ABAP runtime SDK).

---

## 2026 Joule roadmap — eight new features

The newest roadmap items (release windows 2608 / 2611 / 2702 / 2027) and their ARC-1 + skills coverage. Each links to a ralphex implementation plan.

| # | Roadmap feature | SAP GA window | Object class | ARC-1 + skills path | Plan |
|---|----------------|---------------|--------------|---------------------|------|
| 1 | CDS Analytical Query Generation | BTP 2608 / S/4 Cloud Public 2608 / Private 2027 | modern (DDLS) | Skill only | [`joule-cds-analytical-query-skill.md`](../plans/2026-06-03-joule-cds-analytical-query-skill.md) |
| 2 | Clean-Core ATC Fixes | S/4 Cloud Private 2027 only | both | Per-finding ALREADY SHIPPED; small code change for batch (`SAPDiagnose batch_quickfix`) | [`joule-atc-batch-quickfix.md`](../plans/2026-06-03-joule-atc-batch-quickfix.md) |
| 3 | Analytical Model — basic (cube + existing dims from RAP BO) | S/4 Cloud Private 2027 only | modern | Skill only | [`joule-cds-analytical-model-skill.md`](../plans/2026-06-03-joule-cds-analytical-model-skill.md) |
| 4 | Analytical Model — extended (cube + new dims from RAP BO **or** DDIC) | BTP 2608 / S/4 Cloud Public 2608 / Private 2027 | modern + classic input | Skill only (same skill as #3) | [`joule-cds-analytical-model-skill.md`](../plans/2026-06-03-joule-cds-analytical-model-skill.md) |
| 5 | Extensibility Assistant (custom field, BAdI) | S/4 Cloud Private 2027 (already GA on Public Cloud for key users) | **classic** | Code + skill: TABL APPEND subtype + BAdI implementation scaffold + orchestration skill | [`joule-extensibility-assistant.md`](../plans/2026-06-03-joule-extensibility-assistant.md) |
| 6 | RAP Model-Driven Joule Integration | BTP 2608 / S/4 Cloud Public 2608 / Private 2027 | runtime | Out of scope — runtime feature, not development | — |
| 7 | AI Explain for Function Groups | BTP 2608 / S/4 Cloud Public 2608 / Private 2027 | **classic** | Code + skill ext: FUNC sub-module walk + dynpro read + CUA read + skill branch | [`joule-fugr-explain.md`](../plans/2026-06-03-joule-fugr-explain.md) |
| 8 | AI Explain for Behavior Definitions | BTP 2611 / S/4 Cloud Public 2702 / Private 2027 | modern | Skill only (extend `explain-abap-code`) | [`joule-bdef-explain-skill.md`](../plans/2026-06-03-joule-bdef-explain-skill.md) |
| 9 | MCP Tool for ABAP Object Search | BTP 2611 / S/4 Cloud Public 2702 / Private 2027 | both | **Already shipped** — `SAPSearch quick_search/tadir_lookup` + `SAPRead WHERE_USED` | — |

**Net:** 7 of 9 deliverable via ARC-1 + skills; 1 out of scope (RAP runtime); 1 already shipped.

### Code-change budget summary

Six independent code-change buckets across three roadmap features:

| Feature | Sub-item | LOC | Effort |
|---------|----------|-----|--------|
| 2 | `batch_quickfix` SAPDiagnose action | ~150 | 2 d |
| 5a | TABL APPEND subtype + `tabl-v1.json` AFF schema | ~250 | 2 d |
| 5b | BAdI implementation scaffold module + action | ~600 | 3 d |
| 7a | Extend FUGR `expand_includes` for FUNC sub-modules | ~120 | 1 d |
| 7b | Dynpro (SCRP) read | ~150 | 1 d |
| 7c | CUA/GUI status read | ~120 | 1 d |
| **Total** | | **~1,390 LOC** | **~10 dev-days** |

Plus ~5–6 dev-days of skill authoring (features 1, 3+4, 7d, 8) = **~17–19 dev-days total** to ship every roadmap item that can be shipped. SAP's GA windows run Q2 2026 through 2027.

---

## SAP ABAP MCP Server — wire-level facts

Source: decompiled `com.sap.adt.mcp.core_3.58.1.jar` (34 classes), verified against [`arc-1-lsp`](https://github.com/marianfoo/arc-1-lsp) which federates to it headless.

### Transport + auth

- Streamable HTTP at `/mcp` on `localhost:<auto-port>`
- Bearer token: auto-generated `SecureRandom` 16-byte Base64url; returned to LSP client in `AdtMcpServerInitializationInfo{port, token}`
- DNS-rebinding filter restricts `Host:` to `localhost` / `127.0.0.1`
- Server info: `("ADT MCP Server", "1.0.0")`
- 30-second request timeout

### Static tool surface (7 tools)

Registered via Eclipse extension point `com.sap.adt.mcp.core.adtMcpTools`:

| Tool | Purpose |
|------|---------|
| `abap_activate_objects` | Activate one or more URIs; returns syntax diagnostics on failure |
| `abap_run_unit_tests` | Run ABAP Unit on given URIs |
| `abap_creation-get_all_creatable_objects` | Enumerate the 14 creatable object types on the bound destination |
| `abap_creation-get_object_type_details` | Fetch the per-type form schema |
| `abap_creation-run_validation` | Pre-create validation (package exists, name legal, type-specific) |
| `abap_creation-create_object` | Create an object; returns the AFF filePath |
| Destinations list tool | List configured destinations |

### Dynamic tool surface (N tools per destination)

`AdtMCPToolsIdeActionCollector` harvests the connected ABAP backend's **IDE-Actions (AIA)**, keeps those whose title starts with `MCP`, and exposes each as an MCP tool with backend-authored schema. Naming transform: lowercase, `mcp_`→`abap_`, `mcp-`→`abap_`. The registry **swaps** the dynamic set on every `setDestination`. Example dynamic tools: `abap_transport-get`, `abap_transport-create`.

**Critical:** the dynamic tool list is **system-dependent**. A given S/4HANA release ships a specific set of `MCP_*` AIA actions, and that set evolves. arc-1-lsp federates to this MCP and re-enumerates tools on every `setDestination`.

### What is NOT in the MCP

- No `aiExplain`, no Joule chat endpoint — AI orchestration lives **above** adt-ls in the IDE plugin
- No quickfix evaluation/apply — `atc/runCheck` returns findings (`AtcRunFinding`) but no quickfix data
- No classic ABAP types (PROG, FUGR, TABL, DOMA, …) — adt-ls's `readFile` returns a `.jsonc` placeholder for them
- No free SQL, no git, no transport release/delete
- No refactoring — the backend has Rename/Extract Method/Extract CLIF/Change Package but they're not reachable headless

---

## adt-ls headless capability summary

23 `adtLs/*` JSON-RPC segments, ~92 methods. Lives inside `com.sap.adt.ls_1.0.0.202605281240.jar` (736 classes). The full inventory is in [`arc-1-lsp/docs/research/adt-ls-capability-map.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/research/adt-ls-capability-map.md). Highlights:

| Segment | Methods | What for |
|---------|---------|----------|
| `adtLs/repository` | `quickSearch`, `getLsUri`, `getUsers` | Full RIS object search + name→URI resolver |
| `adtLs/objectCreation` | `getCreatableObjectTypes`, `getCreationUiModelAndContent`, `sideEffects`, `validate`, `create` | The 4-step creation pipeline (richer than `writeFile`) |
| `serverExtension/objectGenerator` | `fetchAllGenerators`, `getSchemaForObjectGeneration`, `getListOfObjectsToBeGenerated`, `generateObjects` | RAP scaffolding wizard — **this is where SAP would surface analytical-model generators** |
| `adtLs/atc` | `runCheck`, `getCheckVariants` | ATC (report-only — no quickfix) |
| `adtLs/abapUnit` | `runTests`, `capabilities`, `validateRunParams` | Unit-test run with structured results |
| `adtLs/coverage` | `getCoverage`, `loadStatementResults` | Coverage measurement |
| `adtLs/cts/transport` | `checkTransportForObjectLock`, `createTransportForObjectLock`, `assignTransportToObject`, `searchTransports` | Native transport (typed; preferred over dynamic MCP `abap_transport-*`) |
| `adtLs/activation` | `activate`, `getInactiveObjects` | Batch activate, force-activation; the real activation primitive |
| `adtLs/businessservice/srvb` | `publishandUnpublishAction`, `getServiceBindingDetails`, `getServiceEntitySet`, `getPreviewURL` | RAP service binding control |
| `adtLs/run` | `runApplication` | Run `if_oo_adt_classrun` class → console output |
| `adtLs/codePrediction` | `getCodePredictions`, `reportCodePredictionInsertion` | **AI ghost-text** — gated by `adt.joule.editor.predictiveCodeCompletion` config + AIA backend |
| `adtLs/joule` | `getJouleDestination` | Returns BTP-side Joule destination pointer (no AI here directly) |
| Standard LSP | `documentSymbol`, `definition`, `references`, `typeHierarchy`, `hover`, `completion`, `diagnostic`, … | IDE code-intel |

**Boundary:** `readFile` and `create` serve **only the 14 modern creatable types** (CLAS / INTF / DCLS / DRAS / BDEF / DRTY / CHDO / DDLS / DDLX / NROB / NONT / RONT / SRVB / SRVD). Classic types return placeholders. The backend ships full classic support (~75 `com.sap.adt.*_3.58.x` feature plugins) but the LS front-end deliberately doesn't wire them — a watch-item, not a defect.

---

## Side-by-side: agentic capability access

| Capability | SAP Joule (in ADT) | SAP ABAP MCP Server (IDE-local) | ARC-1 + skills (BTP-hosted) | arc-1-lsp (delegated to adt-ls) |
|------------|--------------------|---------------------------------|----------------------------|----------------------------------|
| AI code generation | ✅ via SAP-ABAP-1 on BTP AI Core | ✅ via the IDE plugin's AI layer (not the MCP itself) | ✅ via the user's LLM (Claude / GPT-4 / etc.) | ✅ same |
| Object search (modern) | ✅ Ctrl+Shift+A | ✅ — Q4 2026 / Q1 2027 GA | ✅ already shipped | ✅ already shipped |
| Object search (classic) | ✅ (Eclipse only) | ❌ classic types not served | ✅ already shipped | ❌ adt-ls boundary |
| Where-used / references | ✅ | ✅ — `textDocument/references` (timeout-guarded) | ✅ `SAPRead WHERE_USED` | ✅ |
| Code create/update — modern types | ✅ | ✅ | ✅ | ✅ |
| Code create/update — **classic types** (PROG/FUGR/TABL/DOMA/…) | ✅ Eclipse only | ❌ | ✅ | ❌ adt-ls boundary |
| AI Explain — classes/programs | ✅ `/explain` | n/a (Joule layer above) | ✅ skill `explain-abap-code` | ✅ + adt-ls `hover` bonus |
| AI Explain — **function groups** (FUGR) | 📅 BTP 2608 | ❌ adt-ls boundary | 📅 [plan ready](../plans/2026-06-03-joule-fugr-explain.md) | ❌ adt-ls boundary |
| AI Explain — **behavior definitions** (BDEF) | 📅 BTP 2611 | n/a | 📅 [plan ready](../plans/2026-06-03-joule-bdef-explain-skill.md) | ✅ via adt-ls hover |
| Analytical model / query generation | 📅 BTP 2608 | n/a (Joule layer) | 📅 [plans ready](../plans/2026-06-03-joule-cds-analytical-query-skill.md) | ✅ via adt-ls `objectGenerator` when SAP ships it |
| Extensibility — append structure | n/a | ❌ classic | 📅 [plan ready](../plans/2026-06-03-joule-extensibility-assistant.md) | ❌ adt-ls boundary |
| Extensibility — BAdI scaffold | 📅 S/4 Private 2027 | ❌ classic | 📅 [plan ready](../plans/2026-06-03-joule-extensibility-assistant.md) | ❌ adt-ls boundary |
| Clean-core ATC fixes | 📅 S/4 Private 2027 | ❌ ATC is report-only | ✅ per-finding shipped; 📅 [batch plan](../plans/2026-06-03-joule-atc-batch-quickfix.md) | ❌ adt-ls ATC is report-only |
| RAP→Joule runtime | 📅 BTP 2608 | n/a — runtime feature | n/a — runtime feature | n/a — runtime feature |
| Free SQL | ❌ | ❌ | ✅ `SAPQuery` (gated) | ❌ |
| Git (gCTS / abapGit) | ❌ | ❌ | ✅ `SAPGit` | ❌ |
| Transport — release/delete | ❌ | ❌ | ✅ `SAPTransport` (gated) | ❌ |
| Runtime diagnostics (ST22 dumps) | ❌ | ❌ | ✅ `SAPDiagnose` (dumps, profiler traces, system messages) | ❌ |
| Per-user principal propagation | n/a | ❌ inherits IDE session | ✅ XSUAA + BTP Destination Service | 📅 plan 05 |
| Central audit log | n/a | ❌ implicit IDE-side | ✅ BTP Audit Log Service sink | 📅 |
| Multi-tenant hosting | ❌ (per-developer) | ❌ (per-developer) | ✅ BTP CF | ❌ (single-tenant) |
| Compatible LLMs | SAP-managed | SAP-managed | Claude · GPT-4 · Gemini · Mistral · IBM · Anthropic · OpenAI · Google · Amazon | same |
| Compatible MCP clients | Eclipse only | Eclipse + VS Code | Claude Desktop · Copilot Studio · Joule Studio · Cursor · VS Code Copilot · Gemini CLI · JetBrains | Same as ARC-1 |
| Type-system reach | RISE / Public Cloud / BTP only (no on-prem) | Same | **Any** SAP system with ADT (incl. ECC 7.4+, on-prem S/4HANA, on-prem NetWeaver) | Modern-type only on any ADT system |
| Licensed | ✅ Separate license (SAP Note 3571857) | Bundled with the IDE extension | ✅ Open source (MIT) | ✅ Open source (MIT) |

---

## The roadmap is already shippable — pre-emptive infrastructure that paid off

The most striking thing about reading SAP's 2026 roadmap against ARC-1's recent commit history: **multiple ARC-1 features that shipped months ago turn out to be exactly the primitives the Joule roadmap needs.** Examples:

| Joule roadmap item | ARC-1 pre-emptive primitive | When ARC-1 shipped it |
|-------------------|------------------------------|----------------------|
| Analytical Model Gen (cube + N dimensions + texts in one go) | `SAPWrite batch_create activateAtEnd: true` — terminal activation that resolves cross-references in one pass | PR 270, 2026-05-10 |
| Clean-Core ATC Fix Proposals | `SAPDiagnose quickfix` / `apply_quickfix` wrapping `/sap/bc/adt/quickfixes/evaluation` + `/sap/bc/adt/quickfixes/application` | 2026-04-14 (live-verified on a4h) |
| AI Explain for BDEF | `SAPRead BDEF` + `parseClassMetadata` `<class:rootEntityRef>` extraction + `expand_includes` for CLAS CCDEF/CCIMP + `SAPDiagnose rap_preflight` | PRs 257/260/261, 2026-05-10 |
| MCP Tool for ABAP Object Search | `SAPSearch quick_search` / `tadir_lookup` (source=adt/db/both, PR 270) + `SAPRead WHERE_USED` + `findReferences` in codeintel | Multiple, 2025–2026 |
| Generate Behavior Implementation | `SAPWrite scaffold_rap_handlers` + `SAPWrite generate_behavior_implementation` — one-shot RAP behavior pool orchestrator | PRs 260/261, 2026-05-10 |

The ARC-1 + skills layer didn't anticipate the *exact* Joule features but it implemented the *primitives* those features require, plus the writer-side safety / authz / package allowlist infrastructure SAP's IDE-local MCP doesn't carry. **The roadmap's GA window of 2026–2027 is therefore catch-up; the capability is shippable today**, where each Joule announcement maps either to an existing skill, an existing tool, or a small (~1–3 dev-day) ARC-1 plan.

---

## Strategic positioning — who picks which stack?

| Situation | Pick |
|-----------|------|
| Personal productivity in Eclipse ADT, RISE/Cloud system, willing to pay for the J4D license | **Joule for Developers** — the integrated UX is unbeatable for a single developer |
| Personal productivity in VS Code, modern types only | **SAP's ABAP MCP Server** when GA Q2 2026; **arc-1-lsp** today |
| Team / multi-user setup, shared BTP deployment, central XSUAA + audit + safety policy | **ARC-1** — the only stack with multi-tenant hosting + per-user principal propagation |
| On-prem S/4HANA, ECC 7.4+, or NetWeaver 7.5x | **ARC-1** — SAP's stacks all require RISE/Cloud/BTP for AI; ARC-1 works anywhere ADT does |
| Classic ABAP heavy (FUGR, PROG, TABL, MSAG, DOMA/DTEL, enhancements) | **ARC-1** — adt-ls doesn't serve these and won't unless SAP changes the LS front-end |
| Agentic flows on Copilot Studio / Joule Studio / agentic CI | **ARC-1** — HTTP Streamable + JWT auth + remote MCP is the only deployment model these platforms accept |
| Migration / Clean-Core remediation at scale | **ARC-1** — quickfix `batch_quickfix` + transport mgmt + SQL + git + runtime diagnostics combine for migration workflows SAP's MCP doesn't reach |
| Free / open-source / vendor-neutral | **ARC-1 + arc-1-lsp** (both MIT) |

---

## What ARC-1 + skills does NOT compete with

1. **IDE-native UX** — predictive code completion ghost text, in-line Quick Fix UI, integrated debugger. MCP is RPC; you can't beat an IDE's UI primitives with tool calls.
2. **SAP-ABAP-1 model itself** — Joule's foundation model is fine-tuned on the S/4HANA codebase and may produce better ABAP than Claude/GPT-4 on specific edge cases. ARC-1's bet is *good enough + much wider deployment*.
3. **RAP→Joule runtime adapter** — exposing RAP BOs as first-class Joule skills is a runtime feature; ARC-1 helps build the RAP BOs but doesn't consume them at request time.

---

## Sources

- [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md`](2026-06-03-joule-2026-roadmap-feature-assessment.md) — engineering plan per feature
- [`docs/compare/J4D/01-joule-for-developers.md`](../compare/J4D/01-joule-for-developers.md) — full J4D capability map
- [`docs/compare/J4D/02-sap-abap-mcp-server-vscode.md`](../compare/J4D/02-sap-abap-mcp-server-vscode.md) — SAP ABAP MCP Server strategic analysis
- [`arc-1-lsp/docs/adt-ls-reference.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/adt-ls-reference.md) — adt-ls live-verified capability matrix
- [`arc-1-lsp/docs/research/adt-ls-capability-map.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/research/adt-ls-capability-map.md) — decompiled-server inventory
- [`arc-1-lsp/docs/arc-1-feature-parity.md`](https://github.com/marianfoo/arc-1-lsp/blob/main/docs/arc-1-feature-parity.md) — ARC-1 vs arc-1-lsp per-tool
- [SAP Help: ADT AI Tools](https://help.sap.com/docs/ABAP_Cloud/bbcee501b99848bdadecd4e290db3ae4)
- [SAP Help: AI / SAP Joule for Developers, ABAP AI Capabilities (canonical feature list)](https://help.sap.com/docs/ABAP_PLATFORM_CROSS/f2afdaf444844c38909aefc7bc792cdb/7f716223a88c40e0992777c8d9febccf.html)
- [Our 2026 Roadmap for Joule for Developers ABAP AI capabilities (Karl Kessler, SAP)](https://community.sap.com/t5/technology-blog-posts-by-sap/our-2026-roadmap-for-joule-for-developers-abap-ai-capabilities/ba-p/14360358)
- [Entering the New Era of Agentic AI for ABAP Development (Sonja Liénard, Sapphire 2026)](https://community.sap.com/t5/technology-blog-posts-by-sap/entering-the-new-era-of-agentic-ai-for-abap-development/ba-p/14394643)
- Plans referenced above all live in [`docs/plans/`](../plans/)
