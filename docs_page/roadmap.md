# ARC-1 Roadmap

**Last Updated:** 2026-05-08 (added ARCH-01 + PR-ε architecture entries)
**Project:** ARC-1 (ABAP Relay Connector) — MCP Server for SAP ABAP Systems
**Repository:** https://github.com/marianfoo/arc-1

---

## Vision

Every other SAP MCP server today runs on the developer's local machine — unmanaged, unaudited, with whatever permissions the developer happens to have. There is no admin oversight, no token budget control, no audit trail, and no way to restrict what an LLM can do to an SAP system.

**ARC-1 is different.** It is a **centralized, admin-controlled MCP gateway** deployed on BTP Cloud Foundry or a company server (Docker). One instance per SAP system, serving multiple users. The admin controls which tools are exposed, which packages can be touched, and whether writes are allowed — before any LLM request reaches SAP.

---

## Priority & Effort Legends

### Priority Legend

| Priority | Meaning |
|----------|---------|
| P0 | Critical — blocks enterprise adoption |
| P1 | High — significant value, should do next |
| P2 | Medium — nice to have, plan for later |
| P3 | Low — future consideration |

### Effort Legend

| Effort | Meaning |
|--------|---------|
| XS | < 1 day |
| S | 1-2 days |
| M | 3-5 days |
| L | 1-2 weeks |
| XL | 2-4 weeks |

---

## Overview: Not Yet Implemented (sorted by priority)

<!--
SORT RULES for this table — DO NOT BREAK when adding rows:
1. Open items first, strictly sorted by priority (P0 → P1 → P2 → P3).
2. Completed (strikethrough) rows go at the BOTTOM, also sorted by priority (P0 → P3).
3. Each ID cell links to its detail anchor below, e.g. `[FEAT-18](#feat-18)`.
4. When you complete an item: strike it, move to the completed block at the bottom of
   this table, AND add a dated row to the "Overview: Completed" table further down.
-->

| ID | Feature | Priority | Effort | Category |
|-----|---------|----------|--------|----------|
| [BUG-01](#bug-01) | SAPActivate phantom success + CLI/server alignment (NW 7.50) — PR [#179](https://github.com/marianfoo/arc-1/pull/179) open | P0 | S | Bugs |
| [ARCH-01](#arch-01) | Discovery-driven endpoint routing — replaces hard-coded per-type URLs with ordered candidate-list against `/sap/bc/adt/discovery` (TABL already does this via `resolveTablObjectUrl`; extend to DOMA, DDLX, BDEF, SRVD, SRVB, ENHO). Plan: [docs/plans/discovery-driven-endpoint-routing.md](../docs/plans/discovery-driven-endpoint-routing.md) | P1 | M | Architecture |
| [PR-ε](#pr-epsilon) | Remove static SAP_BASIS release gates and `isRelease750()` helper after ARCH-01 lands; consume `resolveSourceUrl` + `filterByDiscovery` at the call sites that are still hard-coded | P1 | S | Architecture |
| [FEAT-18](#feat-18) | Function Group Bulk Fetch | P1 | S | Features |
| [FEAT-24](#feat-24) | CompareSource (Diff) | P1 ↑ (from P2, 2026-04-23 — last piece of code-review workflow trio with FEAT-20 + FEAT-49) | S | Features |
| [DOC-01](#doc-01) | Copilot Studio Setup Guide | P1 | S | Docs |
| [DOC-02](#doc-02) | Basis Admin Security Guide | P1 | S | Docs |
| [FEAT-09](#feat-09) | SQL Trace Monitoring | P2 | S | Features |
| [FEAT-21](#feat-21) | ABAP Documentation (F1 Help) | P2 | XS | Features |
| [FEAT-23](#feat-23) | GetProgFullCode (Include Traversal) | P2 | S | Features |
| [FEAT-25](#feat-25) | CDS Unit Tests | P2 | S | Features |
| [FEAT-26](#feat-26) | MCP Client Config Snippets | P2 | S | Features |
| [FEAT-27](#feat-27) | Migration Analysis (ECC->S/4) | P2 | S | Features |
| [FEAT-28](#feat-28) | SAP Compatibility Hardening | P2 | S | Features |
| [FEAT-31](#feat-31) | Code Coverage from Unit Tests | P2 | S | Features |
| [FEAT-32](#feat-32) | Table Pagination / Offset | P2 | XS | Features |
| [FEAT-36](#feat-36) | Type Information (SAPNavigate) | P2 | S | Features |
| [FEAT-41](#feat-41) | ABAP Unit Test Coverage (statement-level) | P2 | S | Features |
| [FEAT-42](#feat-42) | ATC Output Formats (JUnit4, checkstyle, codeclimate) | P2 | XS | Features |
| [FEAT-06](#feat-06) | Cloud Readiness Assessment | P2 | M | Features |
| [FEAT-03](#feat-03) | Enhancement Framework (BAdI) | P2 | M | Features |
| [FEAT-30](#feat-30) | ABAP Cleaner Integration | P2 | M | Features |
| [FEAT-34](#feat-34) | i18n Translation Management | P2 | M | Features |
| [FEAT-60](#feat-60) | CLI/server alignment (shortcut parity with MCP tool schemas) | P2 | S | Features |
| [FEAT-62](#feat-62) | ADT Transaction (`TRAN/T`) source/write support | P2 | M | Features |
| [SEC-05](#sec-05) | Rate Limiting | P2 | S | Security |
| [OPS-02](#ops-02) | Health Check Enhancements | P2 | XS | Ops |
| [DOC-03](#doc-03) | SAP Community Blog Post | P2 | S | Docs |
| [COMPAT-04](#compat-04) | BTP transport omission in safeUpdateSource() — verify only | P2 | XS | Compatibility |
| [FEAT-05](#feat-05) | Code Refactoring (Rename, Extract) | P3 | L | Features |
| [FEAT-07](#feat-07) | TLS/HTTPS for HTTP Streamable | P3 | S | Features |
| [FEAT-29](#feat-29) | P3 Backlog (14 items) | P3 | various | Features |
| [FEAT-50](#feat-50) | ADT Probe Fixture Coverage (contributed fixtures) | P3 | XS-each | Diagnostics |
| [FEAT-59](#feat-59) | Embeddable multi-tenant server (per-instance `systemType`) | P3 | M | Features |
| [FEAT-61](#feat-61) | Tool Extension Points (custom tools on top of ARC-1) | P3 | M-L (phased) | Features |
| [OPS-03](#ops-03) | Multi-System Routing | P3 | L | Ops |
| ~~[COMPAT-01](#compat-01)~~ | ~~modificationSupport guard in lockObject()~~ | ~~P0~~ | ~~XS~~ | ~~Completed 2026-04-16~~ |
| ~~[COMPAT-02](#compat-02)~~ | ~~CSRF HEAD→GET fallback (S/4HANA Public Cloud)~~ | ~~P0~~ | ~~XS~~ | ~~Completed 2026-04-16~~ |
| ~~[COMPAT-03](#compat-03)~~ | ~~V4 SRVB publish endpoint bug~~ | ~~P0~~ | ~~XS~~ | ~~Completed 2026-04-15~~ |
| ~~[FEAT-10](#feat-10)~~ | ~~PrettyPrint (Code Formatting)~~ | ~~P1~~ | ~~XS~~ | ~~Completed 2026-04-17~~ |
| ~~[FEAT-20](#feat-20)~~ | ~~Source Version / Revision History~~ | ~~P1~~ | ~~S~~ | ~~Completed 2026-04-17~~ |
| ~~[FEAT-49](#feat-49)~~ | ~~Object Transport History (Reverse Lookup)~~ | ~~P1~~ | ~~S~~ | ~~Completed 2026-04-17~~ |
| ~~[DOC-04](#doc-04)~~ | ~~RAP & Common ABAP Workflow Skill Pack Refresh~~ | ~~P1~~ | ~~S~~ | ~~Completed 2026-04-18~~ |
| ~~[FEAT-22](#feat-22)~~ | ~~gCTS/abapGit Integration~~ | ~~P2~~ | ~~M~~ | ~~Completed 2026-04-18~~ |
| ~~[FEAT-33](#feat-33)~~ | ~~CDS Impact Analysis~~ | ~~P2~~ | ~~S~~ | ~~Completed 2026-04-16~~ |
| ~~[FEAT-43](#feat-43)~~ | ~~DDIC Auth & Misc Read (Authorization Fields, Feature Toggles, Enhancement Implementations)~~ | ~~P2~~ | ~~S~~ | ~~Completed 2026-04-17~~ |
| ~~[FEAT-55](#feat-55)~~ | ~~System Messages (SM02) + Gateway Error Log (IWFND) in SAPDiagnose~~ | ~~P2~~ | ~~S~~ | ~~Completed 2026-04-21~~ |
| ~~[FEAT-56](#feat-56)~~ | ~~ADT Type-Availability Probe (diagnostic)~~ | ~~P3~~ | ~~S~~ | ~~Completed 2026-04-20~~ |

---

## Overview: Completed (sorted by date, newest first)

<!--
SORT RULES for this table — DO NOT BREAK when adding rows:
1. This is the full historical log, sorted by completion date (newest first).
   Do NOT re-sort by priority here — that is what the completed block at the
   bottom of the "Not Yet Implemented" table is for.
2. Each ID with a detail section links to its anchor, e.g. `[FEAT-18](#feat-18)`.
   Rows with "—" as ID are historical items that never had a FEAT-/SEC-/etc. number.
3. When adding a completed item, also:
   - Move its strikethrough row to the completed block of the "Not Yet Implemented" table.
   - Mark the detail section's status as complete (and keep the `<a id="...">` anchor).
-->

| ID | Feature | Completed | Category |
|----|---------|-----------|----------|
| — | PR-β three-file sync (MSAG `messages` schema property exposure) + universal write guards (mixed-case object name rejection on create + batch_create). Splits PR [#196](https://github.com/marianfoo/arc-1/pull/196). Plan: `docs/plans/pr-beta-three-file-sync-and-universal-guards.md` (now in `docs/plans/completed/` after merge). PR [#201](https://github.com/marianfoo/arc-1/pull/201). | 2026-05-08 | Features |
| — | PR-α cookie hot-reload on stale 401 (`SAP_COOKIE_FILE` re-read on persistent 401, no restart needed; non-blocking startup auth-preflight in cookie-auth mode; cookie-aware LLM error hint). Splits PR [#196](https://github.com/marianfoo/arc-1/pull/196). PR [#200](https://github.com/marianfoo/arc-1/pull/200). | 2026-05-08 | Features |
| [SEC-11](#sec-11) | Dependency & Supply-Chain Security — Tier 1 Foundation (cleared 9 npm audit advisories; Dependabot for npm/actions/docker with grouping + ignore rules; `npm audit` PR gate; GitHub Dependency Review; Trivy container scanning gating on release + advisory on dev; third-party action SHA pinning; workflow-level `permissions: contents: read`; SECURITY.md policy) | 2026-05-08 | Security |
| — | Audit Plan B: read/write enum symmetry (`MSAG` added to `SAPREAD_TYPES_*`) + `FTG2 → FEATURE_TOGGLE` rename. Issue #218 follow-up; both old aliases (`MESSAGES`, `FTG2`) accepted for one minor with stderr deprecation warning. Verified live on a4h S/4HANA 2023 + npl NW 7.50 SP02. | 2026-05-08 | Features |
| — | Audit-driven purge of invented ADT slash aliases (issue #218 follow-up, Plan A — PR #223). Removes `FUNC/FM`, `CLAS/LI`, `VIEW/V`, `TRAN/O` from `SLASH_TYPE_MAP`; repoints `FUGR/FF → FUNC` (was `→ FUGR`); adds real `VIEW/DV → VIEW` and `TRAN/T → TRAN`; adds `objectBasePath('VIEW')` (DDIC view reads were silently broken via fallthrough to `/programs/programs/`); adds `KNOWN_BASE_TYPES` exhaustiveness guard + `SLASH_TYPE_EVIDENCE` citation guard so this bug class can't recur. Verified against a4h S/4HANA 2023 + npl NW 7.50. | 2026-05-08 | Compatibility |
| [SEC-10](#sec-10) | HTTP Security Headers (helmet) + Opt-In CORS for browser MCP clients | 2026-05-05 | Security |
| FEAT-51 | CDS CRUD Dependency Guidance (`SAPWrite` DDLS delete emits where-used blocker list + suggested delete order; ordered DDIC diagnostics → remediation) (PR #176) | 2026-04-23 | Features |
| [FEAT-57](#feat-57) | SAPContext Impact — Sibling DDLS/DDLX Consistency Check (PR #177) | 2026-04-22 | Features |
| [FEAT-55](#feat-55) | System Messages (SM02) + Gateway Error Log (IWFND) in SAPDiagnose (PR #174) | 2026-04-21 | Features |
| — | RAP authoring hardening (`SAPWrite` deterministic RAP preflight, `scaffold_rap_handlers`, per-object batch activation statuses) | 2026-04-21 | Features |
| [FEAT-56](#feat-56) | ADT Type-Availability Probe (diagnostic) (PR #163) | 2026-04-20 | Features |
| [FEAT-58](#feat-58) | DTEL v2→v1 Content-Type Fallback + SICF-aware Error Hints (PR #169) | 2026-04-20 | Features |
| — | SAPManage Scope Split + Data Preview Diagnostics (PR #171) | 2026-04-19 | Security |
| [DOC-05](#doc-05) | First-Party Skill Pack Expansion (clean-core ATC, dead code, object documenter) (PR #164) | 2026-04-19 | Docs |
| [DOC-04](#doc-04) | RAP & Common ABAP Workflow Skill Pack Refresh | 2026-04-18 | Docs |
| [FEAT-22](#feat-22) | gCTS/abapGit Integration (`SAPGit` tool + `--allow-git-writes` safety gate) | 2026-04-18 | Features |
| SEC-09 | Auth Safety & Configurability (cookie→PP leak fix, applyAuthHeader guard, fail-fast validation, auth summary log, SAML disable opt-in, HTML login detection) | 2026-04-17 | Security |
| [FEAT-20](#feat-20) | Source Version / Revision History | 2026-04-17 | Features |
| [FEAT-49](#feat-49) | Object Transport History (Reverse Lookup) | 2026-04-17 | Features |
| [FEAT-10](#feat-10) | PrettyPrint (Code Formatting) | 2026-04-17 | Features |
| [FEAT-43](#feat-43) | DDIC Auth & Misc Read (Authorization Fields, Feature Toggles, Enhancement Implementations) | 2026-04-17 | Features |
| [FEAT-33](#feat-33) | CDS Impact Analysis | 2026-04-16 | Features |
| [FEAT-38](#feat-38) | ADT Service Discovery (MIME Negotiation) | 2026-04-15 | Features |
| [FEAT-16](#feat-16) | Error Intelligence (Actionable Hints) | 2026-04-15 | Features |
| [FEAT-37](#feat-37) | DCL (Access Control) Read/Write | 2026-04-15 | Features |
| [FEAT-12](#feat-12) | Fix Proposals / Auto-Fix from ATC | 2026-04-14 | Features |
| [FEAT-47](#feat-47) | MSAG (Message Class) Read/Write | 2026-04-14 | Features |
| [FEAT-45](#feat-45) | DEVC (Package) Create | 2026-04-14 | Features |
| [FEAT-44](#feat-44) | TABL (Database Table) Create | 2026-04-14 | Features |
| — | RAP DDIC save diagnostics (structured errors + inactive syntax check) | 2026-04-14 | Features |
| — | Abaplint type-gating + per-call lintBeforeWrite | 2026-04-14 | Features |
| [FEAT-46](#feat-46) | SRVB (Service Binding) Create | 2026-04-14 | Features |
| [FEAT-39](#feat-39) | Transport Enhancements (K/W/T types; S/R deferred) | 2026-04-13 | Features |
| — | RAP Write Guard (feature-aware) | 2026-04-13 | Features |
| [FEAT-13](#feat-13) | DDIC Domain/Data Element Write | 2026-04-12 | Features |
| [FEAT-08](#feat-08) | Content-Type 415/406 Auto-Retry | 2026-04-12 | Features |
| [FEAT-14](#feat-14) | 401 Session Timeout Auto-Retry | 2026-04-12 | Features |
| [FEAT-15](#feat-15) | Namespace URL Encoding Audit | 2026-04-12 | Features |
| [FEAT-11](#feat-11) | Inactive Objects List | 2026-04-12 | Features |
| [FEAT-40](#feat-40) | FLP Launchpad Management (OData) | 2026-04-12 | Features |
| [SEC-08](#sec-08) | OAuth Security Hardening (RFC 9700) | 2026-04-08 | Security |
| — | AFF Structured Class Read | 2026-04-08 |  Features |
| — | AFF Batch Object Creation | 2026-04-08 | Features |
| — | AFF Schema Validation | 2026-04-08 | Features |
| — | Zod v4 Input Validation | 2026-04-08 | Features |
| — | Two-Dimensional Auth (scopes x roles x safety) | 2026-04-07 | Security |
| [FEAT-01](#feat-01) | Where-Used Analysis | 2026-04-04 | Features |
| — | Enhanced Abaplint (cloud/on-prem presets) | 2026-04-04 | Features |
| — | Object Caching (SQLite + memory) | 2026-04-04 | Features |
| — | HTTP Client Migration (axios -> undici) | 2026-04-04 | Features |
| [SEC-04](#sec-04) | Audit Logging (multi-sink) | 2026-04-01 | Security |
| [FEAT-04](#feat-04) | DDIC Completeness | 2026-04-01 | Features |
| — | Hyperfocused Mode (1 tool, ~200 tokens) | 2026-04-01 | Features |
| — | Method-Level Surgery | 2026-04-01 | Features |
| — | Runtime Diagnostics (SAPDiagnose) | 2026-04-01 | Features |
| — | RAP CRUD (DDLS/DDLX/BDEF/SRVD) | 2026-04-01 | Features |
| — | Context Compression (7-30x) | 2026-04-01 | Features |
| — | MCP Elicitation | 2026-04-01 | Features |
| — | BTP ABAP Environment (OAuth 2.0) | 2026-04-01 | Features |
| [SEC-01](#sec-01) | Principal Propagation (per-user SAP auth) | 2026-03-27 | Security |
| [SEC-02](#sec-02) | BTP Cloud Connector PP | 2026-03-27 | Security |
| [SEC-06](#sec-06) | Tool Restriction by User Role | 2026-03-27 | Security |
| [SEC-07](#sec-07) | XSUAA OAuth Proxy | 2026-03-27 | Security |
| — | Dynamic Client Registration (RFC 7591) | 2026-03-27 | Security |
| [STRAT-01](#strat-01) | TypeScript Migration (Go -> TS) | 2026-03-26 | Infrastructure |
| [FEAT-35](#feat-35) | Class Hierarchy (SAPNavigate) | 2026-04-09 | Features |
| — | API Key Auth | — | Security |
| — | OAuth/OIDC (Entra ID) | — | Security |
| — | BTP CF Deployment | — | Infrastructure |
| [OPS-01](#ops-01) | Structured JSON Logging | — | Ops |
| [OPS-04](#ops-04) | CI/CD Pipeline | — | Ops |
| [CLEAN-01](#clean-01) | Go Code Removal | — | Cleanup |
| [CLEAN-02](#clean-02) | CLI Surface | — | Cleanup |
| [SEC-03](#sec-03) | S_DEVELOP Awareness | — | Security |

---

## Prioritized Execution Order

> Priorities are assigned based on which [core design principle](#vision) a feature serves. Sourced from 4 competitor trackers ([fr0ster](../compare/fr0ster/overview.md), [VSP](../compare/vibing-steampunk/overview.md), [abap-adt-api](../compare/abap-adt-api/overview.md), [dassian-adt](../compare/07-dassian-adt.md)) and the [cross-project feature matrix](../compare/00-feature-matrix.md).
>
> **2026-04-14 priority re-evaluation:** dassian-adt's explosive growth (0→32 stars, 25→53 tools, OAuth/XSUAA, multi-system in 2 weeks) and SAP's confirmed Q2 2026 GA for official ABAP MCP Server increase urgency on fix proposals (FEAT-12↑P1), error intelligence (FEAT-16↑P1), and pretty print (FEAT-10↑P1, completed 2026-04-17). SAP Joule entering the space makes ARC-1's enterprise-grade safety/auth differentiation even more important.
>
> **2026-04-16 additions:** Cross-project competitor analysis (VSP, fr0ster, dassian-adt deep dive) identified COMPAT-01..03 plus verify item COMPAT-04. Follow-up confirmed COMPAT-03 had already been fixed in PR #130 (commit `9b0601c`, completed 2026-04-15). COMPAT-01 and COMPAT-02 were fixed in this follow-up (completed 2026-04-16). FR0ster reached v6.1.0 (35 stars). VSP confirmed modificationSupport guard as root cause of recurring 423 lock errors and surfaced S/4HANA Public Cloud CSRF HEAD incompatibility (#104). PR #134 (SKTD) merged 2026-04-16 — ARC-1-unique Knowledge Transfer Document support now live. Enhancement (BAdI) ADT endpoints confirmed from fr0ster analysis. GetProgFullCode confirmed on-prem only via nodestructure API. Added **FEAT-49** (Object Transport History) at P1 — reverse lookup ("which transports contain this object?") is the missing link for transport-scoped code review (fr0ster#30). Enriched **FEAT-20** (revisions) with concrete ADT endpoint details; upgraded **FEAT-24** (diff) rationale — the trio (FEAT-49→FEAT-20→FEAT-24) enables the full code review workflow no competitor has end-to-end. Overview table re-sorted by actual priority (P0→P1→P2→P3).
>
> **2026-04-23 additions:** Four merged items plus re-evaluation driven by open PR review and competitor scan:
> - **FEAT-55** — SM02 system messages + /IWFND/ERROR_LOG gateway errors wired into `SAPDiagnose` (PR #174). Matrix section 10 updated — ARC-1 no longer has any diagnostic feed that only fr0ster exposes.
> - **FEAT-56** — standalone ADT type-availability probe (`npm run probe`, multi-signal classifier, fixture-driven replay tests) merged (PR #163). FEAT-50 (fixture coverage contributions) remains open as the follow-up backlog item.
> - **FEAT-57** — `SAPContext(action="impact")` now catches asymmetric DDLS/DDLX metadata-extension coverage across sibling variants (PR #177) — the common RAP bug where one routing path has missing UI fields.
> - **FEAT-58** — DTEL v2→v1 Content-Type fallback + SICF-aware (`icf-handler-not-bound`) error classification (PR #169).
> - **SAPManage scope split** — read vs write sub-actions enforced via `SAPMANAGE_ACTION_SCOPES` in both standard and hyperfocused mode (PR #171). Read-only clients keep diagnostic manage actions.
> - **DOC-05** — three new skills merged (`sap-clean-core-atc`, `sap-unused-code`, `sap-object-documenter`) broadening the workflow layer beyond RAP (PR #164).
>
> Open PRs in flight (not merged at 2026-04-23):
> - **PR [#179](https://github.com/marianfoo/arc-1/pull/179)** (samibouge) — **BUG-01 / P0**: SAPActivate reported "Successfully activated" for an inactive class on NW 7.50. Five independent parser/handler bugs combined into a silent no-op. Fix adds `<ioc:inactiveObjects>` detection in `parseActivationResult`, `/activation/inactive` → `/activation/inactiveobjects` fallback for `getInactiveObjects`, flat-shape support in `parseInactiveObjects`, new `version: 'active' \| 'inactive'` parameter on `SAPDiagnose action=syntax`, and NW 7.50 `<chkrun:checkMessage>` shape in `parseSyntaxCheckResult`. Also surfaces a wider **FEAT-60** gap (see below): CLI shortcut coverage lags MCP tool schemas across at least 9 tools.
> - **PR [#176](https://github.com/marianfoo/arc-1/pull/176)** — CDS CRUD dependency guidance for DDLS update/activate/delete (handler-level workflow hints, not a new ADT capability). Uses FEAT-51 number; the 2026-04-23 completions in this roadmap use FEAT-55..58 to avoid renumbering collision with the in-flight PR.
> - **PR [#173](https://github.com/marianfoo/arc-1/pull/173)** — RAP on-prem authoring gap closure: deterministic RAP preflight for TABL/BDEF/DDLX/DDLS (`preflightBeforeWrite` toggle), new `SAPWrite action=scaffold_rap_handlers` with `dry-run`/`autoApply`, behavior-pool include scanning, per-object batch activation statuses. Will close the remaining RAP retry-failure class once merged.
> - **PR [#161](https://github.com/marianfoo/arc-1/pull/161)** — BTP CF deployment diagram (`docs/btp-deployment.drawio`). Doc artifact only.
> - **PR [#151](https://github.com/marianfoo/arc-1/pull/151)** — SAPLint PrettyPrint + revision eval scenarios (test-only).
>
> Newly added roadmap items:
> - **BUG-01** (P0) — SAPActivate phantom success + CLI/server alignment (tracked by PR #179)
> - **FEAT-59** (P3) — Embeddable multi-tenant server with per-instance `systemType`. Competitive-tracking item inspired by fr0ster v6.4.0. ARC-1 is "one gateway per SAP system" today; a multi-tenant embedding story would matter for customers running many SAP systems behind one MCP gateway.
> - **FEAT-60** (P2) — CLI/server alignment. PR #179's matrix shows 9 of 12 MCP tools have no CLI shortcut, and the 3 that do expose fewer knobs than their Zod schemas accept. Auto-generating shortcuts from schemas would close the gap and prevent future drift.
>
> **2026-04-28 addition:**
> - **FEAT-62** (P2) — ADT Transaction (`TRAN/T`) source/write support. Research was triggered by [`jfilak/sapcli` PR #156](https://github.com/jfilak/sapcli/pull/156), which added `/sap/bc/adt/aps/iam/tran` transaction lifecycle support with JSON source and server-driven creation content. ARC-1 currently has metadata-only `SAPRead(type="TRAN")` through VIT. Live read-only probes found VIT metadata works on the configured 7.58 systems, but `/aps/iam/tran` returns 404 and is absent from discovery; the NPL 7.50 profile was reachable but auth-blocked. Track as feature-detected, on-prem-only source/write support. Full notes: [docs/research/adt-transaction-source-write.md](../docs/research/adt-transaction-source-write.md).
>
> Priority re-eval (competitor-driven, 2026-04-23):
> - **FEAT-18** (Function Group Bulk Fetch) — still P1. The `npm run probe` (FEAT-56) and SQLite cache mitigate the round-trip cost; revisit if evals show LLMs hit 20+ FM groups repeatedly. Not downgrading yet — dassian's confirmed parallel fetch pattern means the gap is visible to users comparing tools.
> - **FEAT-24** (CompareSource/Diff) — **promote P2 → P1**. With FEAT-20 (VERSIONS) + FEAT-49 (object transport history) both shipped, diff is now the last missing piece of the code-review workflow no competitor has end-to-end. Target revision-to-revision client-side diff first; transport-scoped diff is the follow-up.
> - **FEAT-34** (i18n Translation Management) — **hold at P2 but de-emphasize**. VSP added 7 translation tools in early April but has been quiet since 2026-04-15. Not blocking adoption signals for ARC-1; revisit if a specific customer ask lands.
> - **FEAT-07** (TLS/HTTPS) — stays P3. BTP CF + reverse proxy patterns are still the answer.
>
> Already-implemented sanity check (2026-04-23):
> - `SAPContext(action="impact")` already handles DDLS/DDLX upstream+downstream (FEAT-33, 2026-04-16) plus sibling DDLS/DDLX consistency (FEAT-57, 2026-04-22).
> - `SAPRead(type="VERSIONS" | "VERSION_SOURCE")` (FEAT-20, 2026-04-17) is live on on-prem; BTP exposure intentionally deferred.
> - `SAPTransport(action="history")` (FEAT-49, 2026-04-17) is live with `transportchecks` fallback.
> - `SAPDiagnose` now covers dumps + traces + system_messages + gateway_errors + quickfix + apply_quickfix (FEAT-55, 2026-04-21). SQL trace (FEAT-09) is the only fr0ster-v5 diagnostic still missing.
> - `SAPGit` (FEAT-22, 2026-04-18) auto-selects gCTS→abapGit with a `--allow-git-writes` safety gate; VSP's gCTS lead is closed for the prioritized workflow set.
>
> Competitor scan (2026-04-23): only **fr0ster** has moved this week — v6.2.0 shipped per-object-type tool descriptions (13 types) and v6.4.0 added per-instance `systemType` on `EmbeddableMcpServer` (multi-tenant embedding capability ARC-1 lacks — tracked as FEAT-59). VSP, dassian-adt, mario, AWS Accelerator all quiet since before 2026-04-17.
>
> **2026-04-18 additions:** First-party workflow skills became an explicit productization layer. Research across SAP Help / ABAP docs, the `mcp-sap-docs` server, `sap-abap-base` steering docs, and `sap-skills` showed that common success patterns are workflow-level: system bootstrap, provider-contract selection, draft/auth defaults, impact-driven change analysis, revision/history inspection, formatter alignment, documentation capture, and Git/delivery context. ARC-1 now has enough primitives (`impact`, `VERSIONS`, `SAPTransport(action="history")`, `SAPLint` formatting/settings, `SKTD`, `SAPGit`) to encode those workflows directly in first-party RAP/common-use-case skills instead of just adding more raw endpoints.

### Phase A: Production Blockers (P0)
1. ~~**FEAT-02** API Release Status / Clean Core (S)~~ — **completed 2026-04-10**
2. ~~**FEAT-08** Content-Type 415/406 Auto-Retry (XS)~~ — **completed 2026-04-12** (already implemented in transport write compatibility work)
3. ~~**FEAT-14** 401 Session Timeout Auto-Retry (XS)~~ — **completed 2026-04-12** (session reset + re-auth retry in `src/adt/http.ts`)
4. ~~**FEAT-15** Namespace URL Encoding Audit (XS)~~ — **completed 2026-04-12** (audit confirmed `encodeURIComponent` consistency; XML attribute escaping hardened in `devtools.ts`)

### Phase A.5: Proactive Compatibility (P0)
6. ~~**FEAT-38** ADT Service Discovery / MIME Negotiation (S)~~ — **completed 2026-04-14** (startup probe fetches `/sap/bc/adt/discovery`, request-time MIME selection uses cached map, 406/415 retry remains fallback)

### Phase A.6: Compatibility Bug Fixes (P0) — identified 2026-04-16
These bugs affect real-world deployments and were confirmed by cross-project competitor analysis:

- <a id="compat-01"></a>~~**COMPAT-01: modificationSupport guard in lockObject()** (XS)~~ — **completed 2026-04-16.** `lockObject()` now checks both `MODIFICATION_SUPPORT` and namespaced `modificationSupport` for explicit `false` and returns a targeted `AdtApiError` (423) before write attempts. Source: VSP commit 22517d4. [Eval](../compare/vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md)

- <a id="compat-02"></a>~~**COMPAT-02: CSRF HEAD→GET fallback (S/4HANA Public Cloud)** (XS)~~ — **completed 2026-04-16.** `fetchCsrfToken()` now retries with GET when HEAD returns 403, preserving existing 401/403 auth error behavior for true authorization failures. Source: VSP issue #104. [Eval](../compare/vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md)

- <a id="compat-03"></a>~~**COMPAT-03: V4 SRVB publish endpoint bug** (XS)~~ — **already completed 2026-04-15** in PR #130 (commit `9b0601c`) before this compatibility plan was executed. `publishServiceBinding()`/`unpublishServiceBinding()` now propagate the resolved binding type (`odatav2` or `odatav4`) correctly. [Eval](../compare/fr0ster/evaluations/51781d3-srvd-srvb-activate-variant.md)

- **BUG-01: SAPActivate phantom success + CLI/server alignment (NW 7.50)** (S) — **In flight via PR [#179](https://github.com/marianfoo/arc-1/pull/179)** (samibouge, 2026-04-22). Five independent bugs produced a silent no-op that reported success for an inactive class. See the [BUG-01 detail block](#bug-01).

- <a id="compat-04"></a>~~**COMPAT-04: BTP transport omission in safeUpdateSource()**~~ — **Likely NOT applicable to ARC-1.** fr0ster's bug was per-handler transport wiring (`UpdateInterface` missing what `UpdateClass` had). ARC-1's centralized `safeUpdateSource()` handles ALL types with `effectiveTransport = transport ?? (lock.corrNr || undefined)` — the pattern already correctly omits `corrNr` when undefined. **Verify** with BTP Cloud INTF update integration test. Source: fr0ster commit c2b8006 + issue #61. [Eval](../compare/fr0ster/evaluations/c2b8006-dump-simplify-updateintf-fix.md)

### Phase B: Core Value Features (P1)
7. ~~**FEAT-37** DCL (Access Control) Read/Write (S)~~ — **completed 2026-04-15**
8. ~~**FEAT-40** FLP Launchpad Management (M)~~ — **completed 2026-04-12**
9. ~~**FEAT-17** Type Auto-Mappings for SAPWrite (XS)~~ — **completed 2026-04-14**
10. ~~**FEAT-12** Fix Proposals / Auto-Fix (S)~~ — **completed 2026-04-14** (`SAPDiagnose` actions: `quickfix`, `apply_quickfix`; ATC enriched with `hasQuickfix`).
11. ~~**FEAT-16** Error Intelligence (S)~~ — **completed 2026-04-15**. SAP-domain classification now enriches errors with actionable hints (locks/enqueue/auth/activation/object-exists/adjustment) and transaction references (SM12, SU53, SPAU).
12. ~~**FEAT-13** DDIC Domain/Data Element Write (S) — complete data modeling workflow~~ (**completed 2026-04-12**)
13. ~~**FEAT-44** TABL (Database Table) Create (S)~~ — **completed 2026-04-14** (source-based TABL create/update/delete + batch_create support in SAPWrite)
14. ~~**FEAT-45** DEVC (Package) Create (S)~~ — **completed 2026-04-14**. Endpoint: `/sap/bc/adt/packages`.
15. **FEAT-18** Function Group Bulk Fetch (S) — token/round-trip savings. dassian-adt has parallel fetch (objectstructure + Promise.all pattern confirmed).
16. ~~**FEAT-10** PrettyPrint (XS)~~ — **completed 2026-04-17** (`SAPLint` actions: `format`, `get_formatter_settings`, `set_formatter_settings`).
17. ~~**FEAT-20** Source Version / Revision History (S)~~ — **completed 2026-04-17.** Added on-prem `SAPRead(type="VERSIONS")` (Atom revision feed parsed to JSON) and `SAPRead(type="VERSION_SOURCE")` (revision source fetch by opaque `versionUri`). BTP exposure intentionally deferred pending endpoint verification.
18. ~~**FEAT-49** Object Transport History / Reverse Lookup (S)~~ — **completed 2026-04-17.** Implemented as `SAPTransport(action="history")` using per-object `GET {objectUrl}/transports` endpoint with `transportchecks` fallback for candidate transports.
19. **DOC-01** Copilot Studio Setup Guide (S) — critical for enterprise adoption
20. **DOC-02** Basis Admin Security Guide (S) — admin audience needs clear guidance
21. ~~**DOC-04** RAP & Common ABAP Workflow Skill Pack Refresh (S)~~ — **completed 2026-04-18.** Refreshed first-party RAP skills to use provider-contract guidance, `SAPContext(action="impact")`, revision/history reads, formatter settings, SKTD docs, and `SAPGit`; updated `skills/README.md` and `docs_page/skills.md` to document the new workflow layer.

### Phase C: ADT Feature Parity (P2) — Quick Wins
13. **FEAT-32** Table Pagination / Offset (XS) — VSP has this, practical improvement
14. ~~**FEAT-11** Inactive Objects List (XS)~~ — **completed** (via SAPRead type=INACTIVE_OBJECTS)
15. ~~**FEAT-19** Transport Contents (XS)~~ — **completed** (subsumed by FEAT-39)
16. **FEAT-21** ABAP Documentation / F1 Help (XS) — real docs instead of hallucination
17. **FEAT-28** SAP Compatibility Hardening (S) — 7 compat fixes bundled (expanded Apr 8)
18. **OPS-02** Health Check Enhancements (XS) — `/health/deep` with SAP connectivity check

### Phase D: ADT Feature Parity (P2) — Larger Items
20. ~~**FEAT-46** SRVB (Service Binding) Create (S)~~ — **completed 2026-04-14** (SAPWrite now supports SRVB create/update/delete + batch_create; create guidance points to activate + publish flow).
21. ~~**FEAT-47** MSAG (Message Class) Read/Write (S)~~ — **completed 2026-04-14** (SAPRead type=MSAG + SAPWrite/SAPManage MSAG create/update/delete)
22. ~~**FEAT-39** Transport Enhancements (S)~~ — **completed 2026-04-13** (K/W/T types; S/R deferred). sapcli has full CTS lifecycle.
21. **FEAT-41** ABAP Unit Test Coverage (S) — statement-level coverage via `/runtime/traces/coverage/measurements/{id}` with paginated follow-up. sapcli + AWS Accelerator have this.
22. **FEAT-42** ATC Output Formats (XS) — JUnit4, checkstyle, codeclimate formatters for CI/CD integration. sapcli has these.
23. ~~**FEAT-43** DDIC Auth & Misc Read (S)~~ — **completed 2026-04-17** (SAPRead types `AUTH`, `FEATURE_TOGGLE` (formerly `FTG2`, renamed in audit Plan B / PR #224), `ENHO`; Authorization Fields endpoint: `/sap/bc/adt/aps/iam/auth/{name}`, namespace `http://www.sap.com/iam/auth`)
24. ~~**FEAT-48** SKTD (Knowledge Transfer Documents) Read/Write (S)~~ — **✅ Completed 2026-04-16** (PR #134 merged). Unique to ARC-1. LLM-generated documentation for ABAP objects.
25. **FEAT-09** SQL Trace Monitoring (S) — completes diagnostics story (SM02 and /IWFND/ERROR_LOG already completed 2026-04-21 via FEAT-55 — SQL trace is the only fr0ster-v5 diagnostic still missing)
26. **SEC-05** Rate Limiting (S) — prevent runaway AI loops
26. ~~**FEAT-20** Source Version / Revision History (S) — promoted to P1/Phase B and completed 2026-04-17~~
27. **FEAT-31** Code Coverage from Unit Tests (S) — VSP has this (Apr 4). See also FEAT-41 for sapcli's approach.
28. ~~**FEAT-33** CDS Impact Analysis (S)~~ — **completed 2026-04-16** (`SAPContext(action="impact")` for DDLS upstream+downstream analysis)
25. **FEAT-24** CompareSource / Diff (S) — **↑ Upgraded:** with FEAT-20 (revisions) + FEAT-49 (object transport history), transport-scoped code review now viable (fr0ster#30). Client-side diff of two revision sources — ADT has no server-side diff endpoint.
26. **FEAT-26** MCP Client Config Snippets (S) — onboarding UX
27. **FEAT-25** CDS Unit Tests (S) — CDS test-driven development
28. **FEAT-23** GetProgFullCode / Include Traversal (S) — reduce round trips
29. **FEAT-27** Migration Analysis ECC->S/4 (S) — custom code migration
30. **FEAT-06** Cloud Readiness Assessment (M) — ATC cloud checks + abaplint
31. **FEAT-03** Enhancement Framework / BAdI (M) — customization scenarios
32. ~~**FEAT-22** gCTS/abapGit Integration (M)~~ — **completed 2026-04-18** (`SAPGit` with backend auto-selection and git safety gate)
33. **FEAT-34** i18n Translation Management (M) — VSP has 7 tools (Apr 5)
34. **OPS-03** Multi-System Routing (L) — one instance -> multiple SAP systems
35. **DOC-03** SAP Community Blog Post (S) — visibility and adoption
36. **FEAT-30** ABAP Cleaner Integration (M) — optional Java-based code cleanup (see below)

### Phase E: New Capabilities from Competitor Sprint (P2-P3)
33. **FEAT-31** Code Coverage from Unit Tests (S) — VSP added line-level coverage metrics
34. **FEAT-32** Table Pagination / Offset (XS) — VSP added offset + columns_only to table contents
35. ~~**FEAT-33** CDS Impact Analysis (S)~~ — **completed 2026-04-16** (RAP-aware downstream consumer classification)
36. **FEAT-34** i18n Translation Management (M) — VSP added 7 translation tools

### Phase F: Future / Niche (P3)
37. **FEAT-07** TLS/HTTPS for HTTP Streamable (S) — most deployments use reverse proxy (BTP gorouter, nginx, K8s Ingress) for TLS termination; in-app TLS is edge case
38. **FEAT-05** Code Refactoring (L) — rename, extract method *(change package completed 2026-04-15)*
39. **FEAT-29** P3 Backlog — see [FEAT-29 table](#feat-29) for SSE, debugger, execute ABAP, call graph, UI5/BSP, RFC, embeddable server, lock registry, language attributes
40. **FEAT-50** ADT Probe Fixture Coverage — contributor-driven; widen fixture coverage for [`classifyVerdict`](../src/probe/runner.ts) across SAP product lines (BTP ABAP, S/4 Cloud, plain NW, ECC EhP7, …)

### Strategic Context: SAP Official ABAP MCP Server (Q2 2026)

SAP confirmed GA of ABAP Cloud Extension for VS Code with built-in agentic AI powered by official ABAP MCP Server in Q2 2026. Initial scope: RAP UI service development. Key implications for ARC-1:

1. **SAP's MCP server will be ABAP Cloud only** — ARC-1's on-premise + BTP support remains a differentiator
2. **SAP will re-offer Joule capabilities as MCP tools** — creates a baseline expectation for MCP tooling quality
3. **SAP is making local MCP servers available for SAP Build** — enables Cursor, Claude Code, Cline, Windsurf to use SAP frameworks
4. **ARC-1's safety system, multi-client support, and enterprise auth are not in SAP's scope** — the managed gateway model remains unique
5. **Risk**: SAP's official server may reduce demand for community alternatives for ABAP Cloud customers
6. **Opportunity**: ARC-1 serves the vast on-premise + RISE customer base that SAP's cloud-only offering won't reach
7. **Product implication**: raw tool parity is no longer enough; first-party workflow skills for RAP and common ABAP tasks are now a core adoption layer
8. **Execution consequence**: recent features (`impact`, revisions, transport history, formatter settings, SKTD, `SAPGit`) should be packaged into repeatable playbooks faster than competitors can accumulate more endpoints

---

## Details: Not Yet Implemented

<a id="feat-02"></a>
### FEAT-02: API Release Status Tool (Clean Core)
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Very High — critical for S/4HANA Cloud and clean core compliance |
| **Status** | Completed |
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/7270ad7-api-release-state.md) |

**What:** Check whether an SAP object (class, function module, table, CDS view) is released, deprecated, or internal. Returns the API release state (C1 Released, C2 Deprecated, Not Released) and the recommended successor.

**Why:** Every S/4HANA Cloud / BTP ABAP customer needs to check if their code uses only released APIs. This is a "must have" for any AI copilot helping with ABAP Cloud development.

**Implementation (2026-04-10):** Added `API_STATE` type to `SAPRead`. Uses ADT endpoint `/sap/bc/adt/apireleases/{encoded-uri}` with `Accept: application/vnd.sap.adt.apirelease.v10+xml`. Returns structured JSON with contract-level states (C0-C4), successor info, and catalog metadata. Based on VSP's corrected implementation (commit 8a478aa).

---

<a id="feat-07"></a>
### FEAT-07: TLS/HTTPS for HTTP Streamable Transport
| Field | Value |
|-------|-------|
| **Priority** | P3 (downgraded from P0, 2026-04-11) |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Low — most deployments use reverse proxy for TLS termination |
| **Status** | Not started |
| **Source** | [fr0ster tracker: TLS evaluation](../compare/fr0ster/evaluations/tls-https-support.md) |

**What:** Add native TLS support to the HTTP Streamable transport. fr0ster added this in v4.6.0 with `--tls-cert`/`--tls-key` flags. Currently ARC-1 requires a reverse proxy (nginx, CF router) for HTTPS.

**Why:** Enterprise customers deploying outside BTP CF (e.g., on VMs, Kubernetes) need HTTPS without an external proxy. fr0ster's implementation shows the pattern: load cert/key files, create `https.Server` instead of `http.Server`.

**Why not:** Standard practice is reverse proxy (nginx, CF gorouter, K8s Ingress) for TLS termination — adding TLS inside the Node.js app duplicates certificate management. BTP CF already provides auto-renewed platform certs at the routing layer. In-app TLS adds complexity (hot-reload on cert renewal, potential for misconfigured cert chains) without improving security over a reverse proxy. For Docker-on-VM deployments the argument is stronger, but even there nginx+certbot is well-understood.

**Implementation:**
- Add `SAP_TLS_CERT` / `SAP_TLS_KEY` env vars (and `--tls-cert` / `--tls-key` CLI flags)
- In `src/server/http.ts`, conditionally create `https.createServer()` when cert/key are provided
- Auto-detect port 443 vs 8080 based on TLS mode

---

<a id="feat-08"></a>
### FEAT-08: Content-Type 415/406 Auto-Retry
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | High — robustness fix for SAP system variations |
| **Status** | **Completed** (2026-04-12) |

> **Implementation note:** Already fully implemented in `src/adt/http.ts:325-398` with guard-protected single retry, fallback header logic, and 13 unit tests. Was implemented as part of the transport write compatibility work.
| **Source** | [fr0ster tracker: 415 evaluation](../compare/fr0ster/evaluations/415-content-type-retry.md), [VSP tracker: issue #9](../compare/vibing-steampunk/evaluations/issue-9-transport-accept-header.md) |

**What:** SAP systems vary in Accept/Content-Type expectations across versions and endpoint types. When a request gets 415 (Unsupported Media Type) or 406 (Not Acceptable), automatically retry with alternative Content-Type headers.

**Why:** Both fr0ster (issue #22/#23) and VSP (issue #9) hit this on transport endpoints. It's a common SAP ADT compatibility issue across system versions. A transparent retry in `src/adt/http.ts` would handle it for all endpoints.

**Why not:** ARC-1's `src/adt/http.ts` already has guard-protected retry logic for 406/415 with fallback headers. A code audit may reveal the existing implementation already covers the necessary cases. 415/406 errors are rare in practice — no production issues have been reported against ARC-1 specifically. Adding more elaborate retry strategies increases code surface for marginal gain.

**Implementation:**
- In `src/adt/http.ts`, intercept 415/406 responses
- Retry with `Accept: application/xml` -> `Accept: */*` (or vice versa)
- Retry with `Content-Type: application/xml` -> `text/plain` for transport endpoints
- Max 1 retry, log the fallback
- **See also FEAT-38** (ADT Service Discovery) for proactive MIME negotiation instead of reactive retry

---

<a id="feat-14"></a>
### FEAT-14: 401 Session Timeout Auto-Retry
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | High — prevents mid-conversation failures |
| **Status** | **Completed** (2026-04-12) |

> **Implementation note:** Added `authRetryInProgress` guard and 401 retry block to `src/adt/http.ts`. On 401: reset session (cookies + CSRF), re-apply auth (Basic or Bearer token refresh), re-fetch CSRF for modifying methods, retry once. Follows the same guard pattern as DB connection retry. 7 unit tests cover Basic Auth, Bearer token, guard, cookie clearing, and per-request guard reset.
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/d73460a-401-auto-retry.md) |

**What:** After idle, SAP returns 401. ARC-1 handles CSRF 403 refresh but may not handle 401 session timeout. Add silent re-authentication and retry on 401 in `src/adt/http.ts`.

**Why:** Mid-conversation failures are disruptive to LLM workflows. VSP (#32) and `abap-adt-api` both handle this. A centralized gateway that stays idle between user requests will hit this frequently.

**Why not:** Silent re-auth on 401 conflicts with ARC-1's stateless request design. In BTP ABAP (OAuth), a 401 means the token was rejected (revoked, clock skew, user deactivated) — retry won't help. In on-premise (Basic Auth), credentials are cached so 401 is a real auth failure. Silently retrying obscures the real failure and could break lock/modify/unlock transactions that depend on a consistent session. If ARC-1 re-authenticates, it needs stored credentials (security risk). Surfacing the error to the LLM lets it prompt the user to re-authenticate, which is more transparent.

---

<a id="feat-15"></a>
### FEAT-15: Namespace URL Encoding Audit
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | High — prevents hard-to-debug failures |
| **Status** | **Completed** (2026-04-12) |

> **Implementation note:** Audit confirmed `encodeURIComponent()` is consistently applied across all 35+ call sites. Additionally hardened XML attribute escaping: extracted shared `escapeXmlAttr()` to `src/adt/xml-parser.ts`, applied it to all 6 interpolation sites in `devtools.ts`, and updated `codeintel.ts` and `transport.ts` to use the shared utility. 4 devtools escaping tests + 3 escapeXmlAttr unit tests added.
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/59b4b90-namespace-url-encoding.md), [VSP eval](../compare/vibing-steampunk/evaluations/6d1f00a-namespace-syntax-check.md) |

**What:** Namespaced objects (`/NAMESPACE/CLASS`) fail if `/` is not correctly encoded in ADT URLs. VSP hit this in issues #18, #52. Audit all `encodeURIComponent` usage in `src/adt/client.ts` and `src/adt/http.ts`.

**Why:** Namespaced SAP objects are common in enterprise systems. Silent URL encoding failures are hard to debug.

**Why not:** Code audit shows `encodeURIComponent` is consistently applied in all object name positions across `src/adt/client.ts`, `src/adt/crud.ts`, `src/adt/devtools.ts`, `src/adt/diagnostics.ts`, and `src/adt/codeintel.ts`. SAP object names are alphanumeric + underscore; the `/` in namespaced names (e.g., `/DMO/BS_BOOKING`) is already correctly encoded to `%2F` by `encodeURIComponent`. The "namespace" issue in VSP was XML namespace stripping, which ARC-1 handles differently via `fast-xml-parser` with `removeNSPrefix`. A formal audit is unlikely to find actionable bugs.

---

<a id="feat-12"></a>
### FEAT-12: Fix Proposals / Auto-Fix from ATC
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — safer than LLM-guessed fixes |
| **Status** | Complete (2026-04-14) |
| **Source** | [abap-adt-api eval](../compare/abap-adt-api/evaluations/issue-37-quickfix.md) |

**What:** When ATC or syntax check finds an issue, SAP's fix proposal API (`/sap/bc/adt/quickfixes`) suggests exact machine-applicable corrections. ARC-1 now exposes this via `SAPDiagnose` so the LLM can request proposals and apply deltas before writing.

**Why:** Safer than LLM-guessed fixes, preserves ARC-1 safety boundaries (proposal/apply-delta is read-only; write still goes through `SAPWrite` package/transport/read-only gates), and reduces trial-and-error token usage.

**Implementation (2026-04-14):**
- Added `getFixProposals()` and `applyFixProposal()` in `src/adt/devtools.ts` for `/sap/bc/adt/quickfixes/evaluation` and proposal-URI apply calls.
- Added new `SAPDiagnose` actions: `quickfix` and `apply_quickfix` (`src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/handlers/intent.ts`).
- Enriched ATC findings with quickfix metadata (`quickfixInfo`, `hasQuickfix`) in `parseAtcFindings()`.
- Added unit coverage in `tests/unit/adt/devtools.test.ts`, `tests/unit/handlers/intent.test.ts`, and schema/tool tests.
- Added E2E coverage block in `tests/e2e/diagnostics.e2e.test.ts` for quickfix flow and ATC metadata verification.

---

<a id="feat-13"></a>
### FEAT-13: DDIC Domain/Data Element Write
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — completes AI-assisted data modeling |
| **Status** | Complete (2026-04-12) |
| **Source** | [abap-adt-api eval](../compare/abap-adt-api/evaluations/646bb9b-dtel-doma-write.md) |

**What:** ARC-1 reads DOMA/DTEL but can't write properties or fixed values. The `abap-adt-api` library (v7.1.1) added `createDomainDefinition`, `createDataElement`, and `createStructure` with full property support. Add write support for these in SAPWrite.

**Why:** Blocks full AI-assisted data modeling workflows. A developer asking the LLM to "create a domain ZSTATUS with values A=Active, I=Inactive" currently can't be fulfilled end-to-end.

**Implementation (2026-04-12):**
- Added DDIC metadata XML builders in `src/adt/ddic-xml.ts` (`buildDomainXml`, `buildDataElementXml`) with fixed value support and strict DTEL field ordering.
- Added `updateObject` + `safeUpdateObject` in `src/adt/crud.ts` for lock/PUT/unlock metadata writes.
- Enabled `DOMA`/`DTEL` in SAPWrite schemas and tool definitions (`src/handlers/schemas.ts`, `src/handlers/tools.ts`), including DDIC-specific parameters.
- Wired SAPWrite create/update/batch_create in `src/handlers/intent.ts` to use DDIC v2 content types (`application/vnd.sap.adt.domains.v2+xml`, `application/vnd.sap.adt.dataelements.v2+xml`) and metadata write flow (no `/source/main`).
- Added unit tests, integration CRUD lifecycle tests, and E2E tests for DOMA/DTEL write paths.

---

<a id="feat-16"></a>
### FEAT-16: Error Intelligence (Actionable Hints)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — directly improves admin control and LLM UX |
| **Status** | Completed (2026-04-15) |
| **Source** | Dassian pattern, Roadmap SEC-03 |

**What:** When SAP returns common errors (409 locked, 423 enqueued, 403 auth, 415 content type), return actionable hints: "Object locked by user X — check SM12", "Authorization failed — check SU53/PFCG", "Transport required — check SE09". Subsumes SEC-03 (S_DEVELOP awareness).

**Implementation (2026-04-15):**
- Added SAP-domain classification in `src/adt/errors.ts` (`extractExceptionType`, `extractLockOwner`, `classifySapDomainError`) using ADT XML exception `type id` + message patterns.
- Extended `formatErrorForLLM()` in `src/handlers/intent.ts` to prioritize domain hints for lock conflicts (409), enqueue/invalid lock handle (423), authorization failures (403), object-exists conflicts, activation dependency chains, and adjustment mode.
- Added transaction guidance: `SM12` (locks/enqueue), `SU53` (authorization), `SPAU` (adjustment mode); retained existing fallback hints for not-found, transport, DDIC save, and 5xx errors.
- Extended audit classification (`errorClass`) to include domain categories like `AdtApiError:lock-conflict`.
- Added unit tests for extraction/classification and intent hint routing plus E2E smoke assertions for validation/not-found hint behavior.

**Why:** Supports **centralized admin control** — admins and LLMs get clear guidance instead of raw SAP error HTML. Dassian does this well with its error intelligence pattern.

**Why not:** Error hints become stale across SAP releases — a hint for "error 409 = object locked" in 7.50 may not be accurate in BTP ABAP. ARC-1 only sees the HTTP status code, not the user's roles (SU01), package ownership (DEVC), or enqueue status (SM12), so hints are educated guesses rather than true intelligence. A generic "Check SU53" hint is what experienced developers already do — the feature adds noise without truly solving the diagnosis problem. It also increases the support burden: users follow the hint, get lost, and blame ARC-1.

---

<a id="feat-17"></a>
### FEAT-17: Type Auto-Mappings for SAPWrite
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — reduces LLM confusion |
| **Status** | Completed (2026-04-14) |
| **Source** | Dassian pattern |

**What:** Auto-map friendly type codes to ADT internal codes: `CLAS` -> `CLAS/OC`, `INTF` -> `INTF/OI`, `PROG` -> `PROG/P`, etc. LLMs shouldn't need to know ADT's internal type code suffixes.

**Why:** Supports **token efficiency** — reduces failed create attempts where the LLM guesses the wrong type code.

**Why not:** The mapping is incomplete and fragile — SAP has multiple variants (`PROG/P` vs `PROG/I`, `CLAS/OC` vs class-include subtypes) and defaults may differ by release. (Note: `CLAS/LI` was previously listed here as an example but has been removed as invented per issue #218 audit / PR #223 — see `docs/plans/completed/audit-purge-invented-adt-types.md`.) Power users who know the correct suffix can't bypass the auto-mapping, creating a false abstraction. Better error messages (extracting ADT's 400 "expected CLAS/OC" response) solve the root cause more cleanly. The mapping also encourages sloppy LLM behavior — if ARC-1 always "fixes" type codes, the LLM stops learning the correct ones, creating problems when users switch to other tools.

---

<a id="feat-18"></a>
### FEAT-18: Function Group Bulk Fetch
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — significant token/round-trip savings |
| **Status** | Not started |
| **Source** | Dassian pattern |

**What:** Fetch ALL includes and function modules of a function group in one call, instead of N sequential requests. Returns combined source with clear delimiters.

**Why:** Supports **token efficiency** — a function group with 20 FMs currently requires 20+ round trips. One bulk call reduces latency and simplifies the LLM's context.

**Why not:** ADT has no bulk fetch endpoint for function groups — implementation would still make N sequential HTTP calls internally, just hiding them from the client. The bottleneck is network latency, not round-trips — HTTP/2 pipelining and ARC-1's existing SQLite cache already mitigate this. Bundling 20+ function sources into one response may hit context window limits or timeout. Parsing "combined source with delimiters" is error-prone (function names with special characters, include ordering). The feature also conflicts with the per-object caching strategy in `src/cache/caching-layer.ts`.

---

<a id="sec-05"></a>
### SEC-05: Rate Limiting
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — prevents runaway AI loops from overwhelming SAP; closes CodeQL alert `js/missing-rate-limiting` on `/authorize` |
| **Status** | Not started — CodeQL alert #12 dismissed in Security UI with rationale "tracked in SEC-05" (2026-05-08) |

**What:** Token-bucket rate limiter at two layers: (a) per MCP session for SAP-call throttling, configurable via env var; (b) per source IP / per `client_id` on the OAuth auth-relevant endpoints (`/authorize`, `/register`, `/token`) and on `/mcp` to mitigate brute-force / probing. Prevents an AI agent in a retry loop from generating thousands of SAP API calls per minute, AND prevents unauthenticated callers from hammering the OAuth surface.

**Why:** Prevents LLM retry loops from overloading SAP. Enterprise deployments need predictable load. Closes CodeQL HIGH alert `js/missing-rate-limiting` flagged on the `/authorize` route handler in [src/server/http.ts:279](https://github.com/marianfoo/arc-1/blob/main/src/server/http.ts) — auth endpoints with no brute-force gate are an unconditional finding for any OWASP / SAST scanner.

**Why not:** Rate limiting at the MCP session level doesn't prevent SAP overload — a single aggressive query can exhaust a bucket in milliseconds while a slow query stays under limits. SAP's own throttling (RFC connection pools, dialog process limits) and reverse proxies (API Gateway rate limits) are more effective at the right layer. For multi-instance deployments, session-keyed rate limiting requires distributed state (Redis), adding a significant dependency. The OAuth-surface limiter is a different shape — IP-keyed in-memory is fine for single-instance and "good enough" for BTP CF (the gorouter is the real perimeter).

**Configuration:**
```bash
ARC1_RATE_LIMIT=60            # MCP requests per minute per session (0 = unlimited)
ARC1_RATE_LIMIT_BURST=10      # MCP burst allowance
ARC1_AUTH_RATE_LIMIT=20       # OAuth /authorize|/register|/token requests per minute per IP (0 = unlimited)
ARC1_AUTH_RATE_LIMIT_BURST=5  # OAuth surface burst allowance
```

**Implementation:**
- Use `rate-limiter-flexible` npm package or simple in-memory token bucket. The `express-rate-limit` package (already in the dep tree as a transitive of helmet) is the simpler option for the OAuth-surface limiter.
- MCP-layer limiter: per-session (keyed by MCP session ID or OIDC user). Return MCP error with `retry-after` hint when rate limited.
- OAuth-surface limiter: per IP (or per `cf-connecting-ip` / `x-real-ip` when behind a proxy). Return HTTP 429 with `Retry-After` header. Audit-log each rejected request as `auth_rate_limited`.
- New audit event types: `mcp_rate_limited`, `auth_rate_limited`. Both go through `src/server/audit.ts` like the existing `cors_rejected`.

**CodeQL alert linkage:** Alert #12 (`js/missing-rate-limiting`) on `/authorize` is dismissed in the Security UI with rationale "tracked in SEC-05". When SEC-05 lands, re-enable the alert (or it will auto-close on the next scan since rate limiting will be present).

---

<a id="feat-03"></a>
### FEAT-03: Enhancement Framework (BAdI/Enhancement Spot)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | M (3-5 days) |
| **Risk** | Low |
| **Usefulness** | Medium — important for customization scenarios |
| **Status** | Not started |
| **Source** | fr0ster (confirmed ADT endpoints via deep analysis 2026-04-16) |

**What:** Read enhancement spots, BAdI definitions, and enhancement implementations. Confirmed ADT endpoints (from fr0ster deep analysis):

- **Enhancement source code** (on-prem only): `GET /sap/bc/adt/programs/programs/{name}/source/main/enhancements/elements` — returns base64-encoded enhancement source; auto-detects object type (class/program/include); supports `include_nested=true` to traverse all includes
- **Enhancement spot (BAdI spot) metadata**: `GET /sap/bc/adt/enhancements/enhsxsb/{spot_name}` — returns spot metadata including `badi_definitions` array (name, shorttext, interface)
- **Enhancement implementation**: retrieve specific BAdI implementation by name + spot

Note: The `/enhancements/elements` endpoint is **on-prem only** (SAP BTP ABAP Cloud does not expose this endpoint).

**Why:** BAdIs are the primary extensibility mechanism in SAP — LLMs helping with customization need to discover and understand them. fr0ster (v6.1.0, 35 stars) and sapcli both have this. Having confirmed ADT endpoints removes the implementation uncertainty.

**Why not:** BAdI discovery is primarily a human-driven IDE task (Eclipse ADT, SE80) — LLMs almost never implement BAdIs autonomously. Reading BAdI definitions overlaps with what `SAPRead CLAS` already provides (method signatures of the implementing class). Adding enhancement-specific tools violates the "12 intent-based" design philosophy. The on-prem-only restriction means BTP users can't use this feature.

---

<a id="feat-06"></a>
### FEAT-06: Cloud Readiness Assessment
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | M (3-5 days) |
| **Risk** | Low |
| **Usefulness** | High — unique differentiator for S/4HANA migration |
| **Status** | Not started |

**What:** Run ATC checks with ABAP Cloud check variant to assess whether code is cloud-ready. Combined with the enhanced abaplint integration (system-aware cloud/on-prem presets, pre-write validation, auto-fix), provide a comprehensive clean core compliance report.

**Why:** AWS ABAP Accelerator has this as a key feature. ARC-1 combines ATC cloud checks with `@abaplint/core` for offline linting.

**Why not:** `SAPLint` (abaplint with cloud preset) + `SAPDiagnose` (ATC checks) already cover cloud readiness individually — a combined report just concatenates outputs the LLM can already interpret. Enterprise cloud readiness assessments are formal compliance projects with custom rules; a generic tool won't satisfy their requirements. Combining two independently tested tools risks version mismatch errors (old ATC + new abaplint = false positives).

**Current state (partially implemented):**
- System-aware abaplint presets (BTP cloud vs on-prem) with auto-detection from SAP_BASIS release
- Pre-write lint validation blocks cloud_types/strict_sql/obsolete_statement violations on BTP
- Auto-fix via `lint_and_fix` action (keyword_case, obsolete_statement, etc.)
- Custom rule overrides via `--abaplint-config` or per-call `rules` parameter
- ATC Cloud check variant integration (server-side, complements offline abaplint)
- Combined cloud readiness report (ATC + abaplint findings merged)
- ✅ API release state check (FEAT-02, completed 2026-04-10)

---

<a id="feat-09"></a>
### FEAT-09: SQL Trace Monitoring
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — performance diagnostics |
| **Status** | Not started |
| **Source** | [Feature matrix #17](../compare/00-feature-matrix.md) |

**What:** Read SQL trace state, list SQL traces, analyze trace results. Uses ADT endpoints `/sap/bc/adt/runtime/traces/sql/*`. VSP has `GetSQLTraceState`, `ListSQLTraces`.

**Why:** Completes the diagnostics story alongside short dumps and profiler traces. Useful for AI-assisted performance analysis.

**Why not:** SQL tracing is a performance debugging tool, not a development task — LLMs don't optimize query performance, humans do. ADT's trace endpoints are read-only (can't start/stop traces from ADT — users must start them in SAP's ST05), making the tool half-featured. A single SQL trace can contain thousands of lines, bloating the LLM context window for marginal diagnostic value.

---

<a id="feat-10"></a>
### FEAT-10: PrettyPrint (Code Formatting)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — code formatting via ADT API |
| **Status** | Done |
| **Source** | [Feature matrix #14](../compare/00-feature-matrix.md) |

**What:** Format ABAP source code via ADT's PrettyPrint API. VSP and mcp-abap-abap-adt-api have this. Also includes get/set PrettyPrinter settings.

**Why:** Consistent code formatting is important for readability and team standards.

**Resolution:** Implemented as three `SAPLint` actions: `format` (server-side ADT PrettyPrint), `get_formatter_settings`, and `set_formatter_settings`. Formatter settings are read/written via `/sap/bc/adt/abapsource/prettyprinter/settings`, while source formatting uses `/sap/bc/adt/abapsource/prettyprinter`. See implementation plan and checklist in [docs/plans/completed/prettyprint-adt-formatter.md](./plans/completed/prettyprint-adt-formatter.md).

---

<a id="feat-11"></a>
### FEAT-11: Inactive Objects List
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — development workflow improvement |
| **Status** | Done (via SAPRead type=INACTIVE_OBJECTS) |
| **Source** | [Feature matrix #19](../compare/00-feature-matrix.md) |

**What:** List inactive objects system-wide. VSP and fr0ster both have this. Uses `/sap/bc/adt/activation/inactive`.

**Why:** Helps developers find objects they forgot to activate or that need attention.

**Why not:** System-wide queries can be slow on large systems (100K+ custom objects), blocking the MCP session. This is an administrative/housekeeping concern, not a development task — SAP's REPO_LIFECYCLE_MGR transaction is the canonical tool. LLMs don't decide "activate this old object" — humans do. The feature would sit mostly unused in typical LLM workflows.

---

<a id="feat-19"></a>
### FEAT-19: Transport Contents (E071 List)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — show objects inside a transport request |
| **Status** | ✅ Completed (subsumed by FEAT-39) |
| **Source** | Dassian pattern, abap-adt-api |

**What:** List the objects (E071 entries) contained in a transport request. Both dassian and abap-adt-api support this. Useful for reviewing what an LLM has changed before release.

**Resolution:** Subsumed by FEAT-39. Transport object parsing (`tm:abap_object` elements) is now included in `getTransport()` responses when the SAP system returns them. Objects are parsed best-effort from task nodes with fields: pgmid, type, name, wbtype, description, locked, position.

---

<a id="feat-20"></a>
### FEAT-20: Source Version / Revision History
| Field | Value |
|-------|-------|
| **Priority** | P1 ↑ |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — version comparison, rollback context, transport-scoped code review |
| **Status** | Completed (2026-04-17) |
| **Source** | [abap-adt-api eval](../compare/abap-adt-api/evaluations/d3c6940-source-versions.md), [VSP eval](../compare/vibing-steampunk/evaluations/dd06202-version-history.md), [fr0ster#30](https://github.com/fr0ster/mcp-abap-adt/issues/30) |
| **Related** | FEAT-49 (object transport history), FEAT-24 (diff) — together these three enable transport-scoped code review |

**What:** List revision history of ABAP objects and retrieve source at a specific revision. Combined with FEAT-49 (object→transport lookup) and FEAT-24 (diff), enables the full code review workflow requested in fr0ster#30: "check only the code modified in the last Transport Request."

**Completed notes (2026-04-17):**
- Added on-prem SAPRead types: `VERSIONS` (revision feed as JSON) and `VERSION_SOURCE` (raw source by opaque revision URI).
- `VERSION_SOURCE` now validates ADT-local paths (`/sap/bc/adt/...`) before request dispatch.
- BTP exposure intentionally deferred: `VERSIONS`/`VERSION_SOURCE` are currently on-prem only until endpoint parity is verified on BTP ABAP Environment.

**ADT endpoints (confirmed via abap-adt-api + VSP):**

1. **List revisions:** The version URL is discovered dynamically from the object's structure metadata — a link with `rel="http://www.sap.com/adt/relations/versions"`. The concrete URL patterns:

   | Object Type | Version History Endpoint |
   |---|---|
   | PROG | `GET /sap/bc/adt/programs/programs/{name}/source/main/versions` |
   | CLAS | `GET /sap/bc/adt/oo/classes/{name}/includes/{include}/versions` |
   | INTF | `GET /sap/bc/adt/oo/interfaces/{name}/source/main/versions` |
   | FUNC | `GET /sap/bc/adt/functions/groups/{parent}/fmodules/{name}/source/main/versions` |
   | INCL | `GET /sap/bc/adt/programs/includes/{name}/source/main/versions` |
   | DDLS | `GET /sap/bc/adt/ddic/ddl/sources/{name}/source/main/versions` |
   | BDEF | `GET /sap/bc/adt/bo/behaviordefinitions/{name}/source/main/versions` |
   | SRVD | `GET /sap/bc/adt/ddic/srvd/sources/{name}/source/main/versions` |

   - **Accept:** `application/atom+xml;type=feed`
   - **Response:** Atom XML feed where each `<entry>` contains: `uri` (version source URL), `version` (transport number from `atom:link`), `versionTitle`, `date`, `author`

2. **Retrieve source at version:** Two approaches:
   - `GET {version_uri}` — the `uri` field from the revision feed entry, with `Accept: text/plain`
   - `GET {sourceUrl}?version=active|inactive|{versionId}` — query parameter on the standard source URL

**Implementation (delivered):**
- `src/adt/client.ts`: added `getRevisions(type, name, opts)` + `getRevisionSource(versionUri)` with read safety checks.
- `src/adt/xml-parser.ts`: added Atom feed parser `parseRevisionFeed`.
- `src/handlers/intent.ts`: added `SAPRead` routing for `VERSIONS` and `VERSION_SOURCE` with friendly 404 handling.
- `src/handlers/schemas.ts`/`src/handlers/tools.ts`: on-prem schema/tool enums extended; BTP intentionally unchanged.
- Tests: new unit fixtures and parser/client/handler tests, integration coverage, and e2e coverage (`tests/e2e/revisions.e2e.test.ts`).

**Why:** Version history is essential for code review and understanding change context. Combined with FEAT-49 and FEAT-24, enables a complete transport-scoped code review workflow — the #1 request from fr0ster#30. Three competitors already have this (dassian-adt `abap_revisions`, VSP 3 version tools, abap-adt-api `sourceVersions`/`loadSourceVersion`).

**Why not:** ADT's version management endpoints may not exist in all SAP releases (notably older ECC systems). Modern ABAP shops use abapGit or gCTS for version control, making SAP's internal versioning redundant. LLMs rarely need historical source ("show me the version from 2 weeks ago") — they work with current source. However, the transport-scoped review use case (fr0ster#30) is compelling and well-defined.

**Competitive update (2026-04-08):** VSP added 3 version history tools (commit dd06202, Apr 2): list versions, compare versions, get specific version. Both VSP and abap-adt-api now have this. dassian-adt has `abap_revisions` (list only, no version-specific source retrieval).

---

<a id="feat-21"></a>
### FEAT-21: ABAP Documentation (F1 Help)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — LLM fetches real docs instead of hallucinating |
| **Status** | Not started |
| **Source** | [abap-adt-api eval](../compare/abap-adt-api/evaluations/7d5c653-abap-documentation.md), VSP |

**What:** Fetch official ABAP keyword documentation (F1 help) via ADT API. The `abap-adt-api` library (v7.1.0) added `abapDocumentation`. Lets the LLM look up correct syntax instead of guessing.

**Why:** LLMs sometimes hallucinate ABAP syntax. Real documentation prevents this.

**Why not:** LLMs already know ABAP keywords well from training data — fetching F1 docs adds latency for redundant information. ADT doesn't have a clean endpoint for keyword documentation; would need to parse SAP's help server or documentation XML (version-specific, fragile). SAP's F1 docs vary by release, so a "fetch keyword doc" tool returns inconsistent results across systems. Claude, GPT-4, and Gemini have cleaner ABAP knowledge than SAP's own F1 text.

---

<a id="feat-22"></a>
### FEAT-22: gCTS/abapGit Integration
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | M (3-5 days) |
| **Risk** | Low |
| **Usefulness** | Medium — Git-based ABAP workflows |
| **Status** | Complete (2026-04-18) |
| **Source** | Dassian, [VSP eval](../compare/vibing-steampunk/evaluations/81cce41-gcts-tools.md), abap-adt-api |

**What was delivered:**
- New `SAPGit` intent tool with backend auto-selection (prefers gCTS, falls back to abapGit).
- New backend clients: `src/adt/gcts.ts` (JSON `/sap/bc/cts_abapvcs/*`) and `src/adt/abapgit.ts` (XML/HATEOAS `/sap/bc/adt/abapgit/*`).
- New safety gate `--allow-git-writes` / `SAP_ALLOW_GIT_WRITES` (default `false`) for all git write operations.
- Feature probing extended with gCTS detection; tool registration is feature-gated.
- End-to-end coverage added (unit + integration + e2e for SAPGit read paths and safety behavior).

**Backend coverage:**
- **Both:** `list_repos`, `clone`, `pull`, `switch_branch`, `create_branch`, `unlink`
- **gCTS-only:** `whoami`, `config`, `branches`, `history`, `objects`, `commit`
- **abapGit-only:** `external_info`, `check`, `stage`, `push`

**Result:** FEAT-22 is closed; ARC-1 now has parity on gCTS/abapGit workflows with leading competitors while preserving ARC-1's safety model.

**Competitive update:** VSP's gCTS lead is closed for the prioritized workflow set via `SAPGit`.

---

<a id="feat-23"></a>
### FEAT-23: GetProgFullCode (Include Traversal)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — reduces round trips for programs with includes |
| **Status** | Not started |
| **Source** | fr0ster (confirmed ADT endpoints via deep analysis 2026-04-16) |
| **Restriction** | **On-prem only** — SAP BTP ABAP Cloud does not expose the `nodestructure` API needed for include discovery |

**What:** Fetch a program with all its includes resolved into a single response. Confirmed ADT endpoints (from fr0ster deep analysis):

1. **List includes via nodestructure API** (on-prem only): `GET /sap/bc/adt/repository/nodestructure?objecttype=PROG/P&objectname={name}&node_id=000000` — finds `PROG/I` nodes, fetches their children to discover all includes
2. **Read include source**: `GET /sap/bc/adt/programs/includes/{includeName}/source/main`
3. **Recursive traversal**: Parse `INCLUDE <name>.` and `INCLUDE: <name1>, <name2>.` statements recursively from each include

For FUGR (function groups), the same pattern applies with `objecttype=FUGR/P` and source via `/sap/bc/adt/programs/includes/{include}/source/main`.

**Why:** Simplifies reading programs with many includes — reduces N+1 round trips. fr0ster has `GetProgFullCode`. Useful for LLMs working with large legacy programs that heavily use includes (a very common pattern in ECC/on-prem codebases).

**Why not:** `SAPContext` with dependency extraction already resolves includes and returns combined context with AST-based compression (7-30x reduction). A dedicated "full code" tool just renames existing functionality without adding behavior — it violates the 12-tool design principle. The LLM can already request `SAPRead PROG` followed by individual includes if needed. **On-prem only** (SAP BTP doesn't expose nodestructure for includes), so BTP users get no benefit. The recursive traversal is fragile — malformed INCLUDE statements or circular dependencies cause infinite loops.

---

<a id="feat-24"></a>
### FEAT-24: CompareSource (Diff)
| Field | Value |
|-------|-------|
| **Priority** | P2 ↑ |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High (with FEAT-20 + FEAT-49) — transport-scoped code review |
| **Status** | Not started |
| **Source** | VSP, [fr0ster#30](https://github.com/fr0ster/mcp-abap-adt/issues/30) |
| **Depends on** | FEAT-20 (revision history — provides version URIs to diff against) |
| **Related** | FEAT-49 (object transport history — identifies *which* transport to diff) |

**What:** Diff two versions of ABAP source (active vs inactive, current vs transport revision, or between two transport revisions). VSP has `CompareVersions`. The full workflow from fr0ster#30:
1. `FEAT-49` — find transports for an object ("which transport last changed ZCL_MY_CLASS?")
2. `FEAT-20` — get revision list, find the version URI for that transport
3. `FEAT-24` — diff the transport version against current source

**ADT API finding:** ADT has **no server-side diff endpoint**. All competitors (VSP, abap-adt-api) compute diffs client-side by fetching both version sources and generating a unified diff. VSP's `CompareVersions()` fetches `GetRevisionSource(version1_uri)` and `GetRevisionSource(version2_uri)` (or current source), then generates unified diff text with added/removed line counts.

**Implementation plan:**
- Add `SAPDiagnose action=diff` or `SAPRead type=DIFF` — accepts `name`, `type`, `version1` (URI or "active"/"inactive"), `version2` (URI or "current")
- Fetch both sources (via FEAT-20's `getRevisionSource`), compute unified diff client-side
- No external diff library needed — a simple line-by-line diff algorithm suffices for LLM consumption (LLMs parse unified diff format natively)
- Safety: `checkOperation(Read)` — read-only operation

**Why:** With FEAT-20 (revision history) and FEAT-49 (object transport history) in place, diff becomes the final piece of the transport-scoped code review workflow. This is the #1 feature request across competitors (fr0ster#30). Unlike standalone diff, the trio (FEAT-49→FEAT-20→FEAT-24) enables a concrete, high-value use case: AI code review of transport changes.

**Why not:** LLMs are excellent at diffing code — the user can fetch two sources via `SAPRead` and ask the LLM to compare them. A diff utility is a client concern, not a server concern. However, having the MCP server compute the diff saves significant tokens (sending only changed lines vs. two full source files) and reduces round-trip complexity from 3 tool calls to 1.

**Competitive update (2026-04-16):** VSP has `CompareVersions` (client-side diff of revision sources). fr0ster#30 requests this as `GetDiff` but has not implemented it. No competitor has the full trio (object→transport lookup + revision + diff) as a cohesive workflow.

---

<a id="feat-25"></a>
### FEAT-25: CDS Unit Tests
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — CDS test-driven development |
| **Status** | Not started |
| **Source** | fr0ster |

**What:** Create, run, and check CDS unit tests. fr0ster is the only project with this capability. Enables AI-assisted CDS development with test coverage.

**Why:** CDS views are increasingly central to S/4HANA development. Test support enables test-driven CDS development.

**Why not:** CDS unit tests (via CDS Test Environment) require ABAP code generation for test doubles and fixture setup — ADT doesn't have a dedicated endpoint. The complexity is 3-4x higher than ABAP unit tests. LLMs can already generate CDS unit test code directly, create the test class via `SAPWrite batch_create`, and run it via `SAPDiagnose` — no intermediate tool needed. The feature is a convenience wrapper over existing capabilities, not new functionality.

---

<a id="feat-26"></a>
### FEAT-26: MCP Client Config Snippets
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — great onboarding UX |
| **Status** | Not started |
| **Source** | [fr0ster eval](../compare/fr0ster/evaluations/5f975fe-mcp-client-configurator.md) |

**What:** `arc-1 config --client claude` prints ready-to-paste MCP client configuration. fr0ster supports 11 clients. Lowers the barrier to first connection.

**Why:** Reduces friction for first-time setup.

**Why not:** Config snippets are static reference material that belongs in documentation, not in a CLI command. ARC-1 is an MCP server, not a configuration guide generator. Setup guides already cover client configuration. Maintaining config templates for 11+ MCP clients adds a maintenance burden that scales with the ecosystem — every new client version may change its config format.

---

<a id="feat-27"></a>
### FEAT-27: Migration Analysis (ECC->S/4)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — custom code migration check |
| **Status** | Not started |
| **Source** | AWS ABAP Accelerator |

**What:** Run custom code migration checks to identify ECC code that needs changes for S/4HANA. AWS ABAP Accelerator has this as a key feature. Complements FEAT-06 (Cloud Readiness Assessment).

**Why:** S/4HANA migration is a major SAP customer initiative.

**Why not:** S/4HANA readiness is a subset of cloud readiness checks — `SAPLint` with the cloud preset already handles most migration warnings (deprecated statements, classic ABAP, etc.). SAP's Code Inspector (SCI) and ATC have dedicated S/4HANA migration checks that enterprises use formally in their migration projects. Organizations doing ECC->S/4 migrations won't rely on an LLM-driven tool for compliance — they use SAP's official readiness check tools with formal sign-off processes.

---

<a id="feat-28"></a>
### FEAT-28: SAP Compatibility Hardening
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days total) |
| **Risk** | Low |
| **Usefulness** | Medium — prevents edge-case failures across SAP versions |
| **Status** | Not started |
| **Source** | Multiple competitor trackers |

**What:** A bundle of small compatibility fixes identified across all competitor trackers:
1. **ATC ciCheckFlavour workaround** — older SAP systems don't support the `ciCheckFlavour` parameter (dassian pattern)
2. **Stateful session header** — some ADT endpoints require `X-sap-adt-sessiontype: stateful` ([abap-adt-api eval](../compare/abap-adt-api/evaluations/issue-30-stateful-mode.md))
3. **Include lock parent resolution** — includes inherit parent's lock; verify FUGR/PROG includes lock correctly ([abap-adt-api eval](../compare/abap-adt-api/evaluations/issue-36-include-lock.md))
4. **Ignore syntax warnings on save** — syntax warnings should not block saves ([VSP eval](../compare/vibing-steampunk/evaluations/7fbfbba-ignore-warnings.md))
5. **Transport endpoint S/4 compat** — transport creation endpoint differs on S/4HANA 757+ ([VSP eval](../compare/vibing-steampunk/evaluations/ca02f47-transport-endpoint-compat.md))
6. **Auth headers on redirect** — SAP may redirect, and auth headers get stripped on cross-origin redirects. Verify undici/fetch behavior. ([VSP eval](../compare/vibing-steampunk/evaluations/27d4d7c-auth-redirect-stateful.md), added 2026-04-08)
7. **Lock handle 423 errors** — recurring issue in VSP (#91, #88, #78). Verify ARC-1 crud.ts handles 423 gracefully. ([VSP eval](../compare/vibing-steampunk/evaluations/issue-91-lock-handle-423.md), added 2026-04-08)

**Why:** Prevents real-world failures across SAP versions.

**Why not:** "7 compat fixes" is a bundle without clear scope — each item needs individual evaluation. Some items may already be handled (ARC-1 uses `withStatefulSession()` for lock sequences, undici handles cookies). Bundle approach suggests one-off patches rather than systematic compatibility handling. Version-specific workarounds add technical debt and conditional logic that's hard to test (requires access to each SAP version).

---

<a id="feat-30"></a>
### FEAT-30: ABAP Cleaner Integration (Future)

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | M (3-5 days) |
| **Risk** | Medium — adds Java 21 dependency, ~200MB Docker image increase |
| **Usefulness** | High for teams already using ABAP cleaner profiles |
| **Status** | Research complete, not started |

**What:** Optional integration with SAP's [ABAP cleaner](https://github.com/SAP/abap-cleaner) CLI (`abap-cleanerc`) for 100+ code cleanup rules with 469 configuration options. Runs as a pre-stage before abaplint in the lint/fix pipeline. Teams can mount their `.cfj` profile files to enforce company coding standards.

**Why:** Many SAP teams already maintain ABAP cleaner profiles (`.cfj` files) as their shared coding standard. Integrating this means LLM-generated code automatically conforms to the team's existing rules — no new rule configuration needed. ABAP cleaner handles transformations abaplint can't: READ TABLE -> table expressions, string concatenation -> string templates, FINAL declarations, advanced alignment (21 DDL/CDS-specific rules).

**Why not:** Adding a 200MB Java 21 runtime to a Node.js npm package increases distribution size dramatically. Docker image bloats from ~150MB to ~350MB. JVM boot time (1-2s) adds latency to every lint operation. `@abaplint/core` already covers most formatting and cleanup rules locally without external dependencies. Maintaining a polyglot pipeline (Java + Node.js) doubles the operational complexity. If ABAP Cleaner breaks on a Java update, ARC-1 is responsible for the debugging.

**Architecture:** Three-stage pipeline: ABAP cleaner (Java CLI, transforms) -> abaplint (TypeScript, lint+fix) -> pre-write gate (TypeScript, block/pass). ABAP cleaner is optional — if Java/JAR not found, skipped silently. CLI invoked via `child_process.execFile` with `--source` for inline processing (<128KB) or temp files for larger sources. Output captured from stdout.

**Key details from research:**
- CLI: `abap-cleaner --source "<ABAP>" --release "757" --profile "team.cfj"` -> cleaned source on stdout
- No stdin support — must use `--source` flag or `--sourcefile` with temp file
- No reliable exit codes (always 0) — error detection via stderr content
- Profile format: `.cfj` (JSON-like key-value with version header), `--profiledata` accepts inline content
- Release flag (`--release "757"`) maps to our existing `cachedFeatures.abapRelease`
- Docker: requires Java 21 + Eclipse RCP app (~200MB total). Suggest two image variants: `latest` (lean) and `with-cleaner` (full)
- Reference implementation: `vscode_abap_remote_fs/abapCleanerService.ts` wraps CLI with temp files + 30s timeout

**Config options (planned):**
- `SAP_ABAP_CLEANER_PATH` / `--abap-cleaner-path` — path to CLI binary
- `SAP_ABAP_CLEANER_PROFILE` / `--abap-cleaner-profile` — path to `.cfj` profile
- `SAP_ABAP_CLEANER_ENABLED` / `--abap-cleaner-enabled` — `auto` (default), `true`, `false`

---

<a id="feat-31"></a>
### FEAT-31: Code Coverage from Unit Tests
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — test quality assessment |
| **Status** | Not started |
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/333f462-code-coverage.md) |

**What:** Return line-level code coverage metrics from ABAP unit test runs. VSP added `GetCodeCoverage` (commit 333f462, Apr 4). ARC-1's SAPDiagnose runs unit tests but returns pass/fail only, not coverage data.

**Why:** Coverage metrics help assess test quality and identify untested code paths.

**Why not:** ADT's unit test endpoints return pass/fail results, not coverage metrics — coverage data lives in ABAP Unit runtime (RSTSTC) and is only accessible via ABAP, not ADT REST. Line-level coverage for a 500-line class generates 500+ lines of output, bloating the LLM context window. LLMs don't optimize based on coverage — humans do. Coverage analysis is better handled offline (run tests locally, generate report, share with team).

---

<a id="feat-32"></a>
### FEAT-32: Table Pagination / Offset
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — practical query improvement |
| **Status** | Not started |
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/9fb6c8a-table-pagination.md) |

**What:** Add `offset` parameter for cursor-style pagination and `columns_only` for schema-only queries to SAPQuery table preview. VSP added these (commit 9fb6c8a, Apr 4), closing their issue #34. ARC-1 has `maxRows` but no offset.

**Why:** Pagination enables browsing larger tables and exploring data.

**Why not:** MCP is stateless per call — paginated queries require maintaining cursor state or session affinity that ARC-1 doesn't provide. LLMs fetch data once with a reasonable `maxRows` limit; "fetch rows 101-150" is an interactive UI pattern, not an LLM workflow. `$top=50` is usually sufficient for the LLM to understand the data shape. Adding offset introduces complexity for a rare use case.

---

<a id="feat-33"></a>
### FEAT-33: CDS Impact Analysis
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — increasingly important as S/4 moves logic into CDS |
| **Status** | Done (2026-04-16) |
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/6c67140-cds-impact.md) |

**What:** CDS-specific impact analysis is now available via `SAPContext(action="impact", type="DDLS", name="...")`. It returns upstream CDS AST dependencies and downstream RAP-classified where-used consumers in one response.

**Why:** CDS views are the foundation of S/4HANA — understanding downstream impact is critical before making changes.

**Scope:** Scoped intentionally to the RAP stack immediately around a CDS view (projection chain, BDEF, SRVD, SRVB, DCLS, DDLX, direct ABAP consumers). Multi-level transitive tracing remains out of scope for a single call — follow-up analysis can be done via `SAPNavigate(action="references")` on individual consumers when needed.

---

<a id="feat-34"></a>
### FEAT-34: i18n Translation Management
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | M (3-5 days) |
| **Risk** | Low |
| **Usefulness** | Medium — multilingual ABAP development |
| **Status** | Not started |
| **Source** | [VSP eval](../compare/vibing-steampunk/evaluations/566f1f7-i18n-tools.md) |

**What:** Translation management tools: text elements, OTR texts, message class management, translation status, per-request language override. VSP added 7 translation tools (commit 566f1f7, Apr 5), closing their issue #40. ARC-1 has T100 message read and text elements read but not full management.

**Why:** Multilingual support is required for most enterprise SAP implementations.

**Why not:** i18n management is a niche domain requiring specialized SAP knowledge that LLMs don't have (translation workflows, OTR maintenance, text consistency checks). Text elements, OTR, and message classes are managed in different places with no unified ADT endpoint — building a tool requires hacking across fragmented APIs. Translation is usually managed by dedicated translators or compliance teams, not developers or LLMs. The feature adds tool complexity for a workflow that's better served by SAP's native SE63 transaction.

---

<a id="feat-36"></a>
### FEAT-36: Type Information (SAPNavigate)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Medium — endpoint availability varies by SAP version |
| **Usefulness** | Medium-High — variable type resolution for LLM |
| **Status** | Deferred — endpoint not available on test system |
| **Source** | [ADT API Audit](https://github.com/marianfoo/arc-1/blob/main/docs/research/complete/adt-api-audit-documentation-and-unused.md) |

**What:** `POST /sap/bc/adt/abapsource/typeinformation` returns the complete type of a variable/expression at a given source position. Tested on A4H 7.52 — returned 404. May be available on newer SAP NetWeaver/S/4HANA versions. Revisit when a newer test system is available.

**Why:** Type resolution helps LLMs understand variable usage without guessing.

**Why not:** LLMs can infer types from source context by tracing declarations, assignments, and method signatures — they don't need a SAP round-trip for this. The ADT endpoint returned 404 on the test system, suggesting limited availability. Even where available, the endpoint requires exact source position (line, column), which LLMs don't naturally produce. Type inference is what IDEs do with hover — LLMs are as good at this from reading source code.

---

<a id="ops-02"></a>
### OPS-02: Health Check Enhancements
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — better monitoring |
| **Status** | Basic `/health` exists |

**What:** Enhanced health endpoint that checks SAP connectivity, returns version info, uptime, feature availability. Separate `/health` (load balancer, always fast) from `/health/deep` (includes SAP connectivity check).

**Why:** Better monitoring for production deployments.

**Why not:** Deep health checks (attempt to read TADIR, run syntax check) can hang if SAP is under load or the network is slow, making the monitoring tool itself unreliable. Kubernetes/Docker already have liveness/readiness probes that ARC-1 should use. If a deep health check fails, the behavior is unclear (reject all requests? partially? alert operator?) — simple connectivity checks ("can we reach SAP?") are sufficient and reliable.

---

<a id="doc-01"></a>
### DOC-01: End-to-End Copilot Studio Setup Guide
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Very High — critical for adoption |
| **Status** | Partially done (oauth-jwt-setup.md updated with Copilot Studio section) |

**What:** Complete guide with screenshots covering:
1. Entra ID app registration (step-by-step)
2. BTP CF deployment (manifest, `cf push`, env vars)
3. Power Automate custom connector creation (Security tab configuration)
4. Copilot Studio agent creation with ARC-1 as MCP server
5. Common errors and fixes (troubleshooting table with all AADSTS errors)

**Why:** Critical for enterprise adoption. The primary use case (Copilot Studio) needs a clear guide.

**Why not:** Minimal. Documentation should always be done. The only risk is screenshots becoming outdated as Copilot Studio evolves, requiring periodic maintenance.

---

<a id="doc-02"></a>
### DOC-02: Basis Admin Security Guide
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Very High — SAP Basis admins need clear guidance |
| **Status** | Not started |

**What:** Dedicated guide for SAP Basis administrators covering:
- What ARC-1 does and doesn't do (it's a proxy, not an ABAP runtime)
- SAP-side authorization: S_DEVELOP, ICF service activation for ADT
- Safety controls: read-only mode, allowed packages, operation filters
- How to create a restricted technical user for ARC-1 (minimal S_DEVELOP authorization)
- How to set up STRUST/CERTRULE for principal propagation
- Monitoring: where to check SAP security audit log (SM20) for ARC-1 activity
- How ARC-1's safety layer complements SAP's native authorization

**Why:** SAP Basis admins are the gatekeepers for enterprise adoption. They need clear, familiar guidance.

**Why not:** Minimal. Documentation targets a critical audience. The only consideration is that the guide must be reviewed by an actual Basis admin to ensure accuracy.

---

<a id="doc-03"></a>
### DOC-03: SAP Community Blog Post
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — visibility and adoption |
| **Status** | Draft exists ([Report 023](../docs/reports/2025-12-05-023-arc1-for-abap-developers.md)) |

**What:** Publish on SAP Community: "ARC-1: Connecting SAP ABAP to Microsoft Copilot Studio via MCP" covering architecture, security model, and setup.

**Why:** SAP Community visibility drives adoption.

**Why not:** Marketing, not a feature. Better timing is after P1 + most P2 features are stable — ship the product first, then evangelize. One blog post in a sea of SAP Community content may not move the needle for adoption.

---

<a id="doc-04"></a>
### DOC-04: RAP & Common ABAP Workflow Skill Pack Refresh
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — converts raw RAP/tool capability into repeatable workflows |
| **Status** | Completed (2026-04-18) |

**What:** Refresh first-party skill markdown for RAP service generation, RAP logic implementation, and common ABAP bootstrap flow so the workflow explicitly uses the newest ARC-1 features and up-to-date SAP guidance. This includes:
- Provider-contract aware service exposure defaults (`odata_v4_ui` vs `odata_v4_webapi`)
- Draft/auth guidance aligned with current RAP docs (`#MANDATORY` + DCL, total ETag, draft constraints)
- `SAPContext(action="impact")` and revision/history reads before edits
- `SAPLint` formatter settings + optional formatting step before writeback
- `SKTD` read/write for attached knowledge-transfer docs
- `SAPGit` context for repo-managed packages
- Stronger `mcp-sap-docs` usage patterns for RAP research prompts

**Why:** SAP's own MCP direction starts with RAP UI service generation. ARC-1 already has the tool primitives; the missing layer was codified workflow guidance that turns those primitives into consistent outcomes for common use cases.

**Outcome (2026-04-18):** Updated `skills/generate-rap-service-researched.md`, `skills/generate-rap-service.md`, `skills/generate-rap-logic.md`, `skills/README.md`, and `docs_page/skills.md`. Research also incorporated ideas from `sap-abap-base` steering docs and `sap-skills`: treat workflow/steering quality as a first-class differentiator instead of chasing tool-count inflation.

---

<a id="doc-05"></a>
### DOC-05: First-Party Skill Pack Expansion
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — turns ARC-1 primitives into repeatable clean-core and documentation workflows |
| **Status** | Completed (2026-04-19, PR #164) |

**What:** Added first-party skills for clean-core ATC review, unused-code detection, and object documentation capture.

**Why:** These workflows use ARC-1's existing diagnostics, context, transport, linting, and documentation tools to solve repeatable ABAP maintenance tasks without adding more raw MCP endpoints.

---

<a id="feat-37"></a>
### FEAT-37: DCL (Access Control) Read/Write
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — completes RAP development workflow |
| **Status** | ✅ Completed (2026-04-15) |
| **Source** | [sapcli comparison](../compare/09-sapcli.md) |

**What:** Added full read/write support for CDS access control objects (`DCLS`) via ADT ACM endpoints.

**Implemented (2026-04-15):**
- Added `getDcl(name)` to `src/adt/client.ts` using `/sap/bc/adt/acm/dcl/sources/{name}/source/main`.
- Added `DCLS` routing in `src/handlers/intent.ts`:
  - `handleSAPRead()` read path
  - `objectBasePath()` to `/sap/bc/adt/acm/dcl/sources/`
  - `buildCreateXml()` with `dcl:dclSource` and `DCLS/DL`
  - Type alias mapping `DCLS/DL -> DCLS`
  - DDIC save-hint and post-save syntax-check sets
- Added `DCLS` to SAPRead/SAPWrite type enums for on-prem + BTP in `src/handlers/schemas.ts` and `src/handlers/tools.ts`.
- Added unit coverage (client + handler + XML/type mapping tests) and E2E RAP lifecycle coverage for DCLS create/activate/read/delete.

---

<a id="feat-38"></a>
### FEAT-38: ADT Service Discovery (MIME Negotiation)
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Very High — eliminates 415/406 content-type errors proactively |
| **Status** | Completed (2026-04-14) |
| **Source** | [sapcli comparison](../compare/09-sapcli.md), sapcli `sap/adt/discovery.py` |

**What:** Call `GET /sap/bc/adt/discovery` at startup to learn which MIME type versions each ADT endpoint supports. Cache the accepted Content-Type/Accept values per endpoint. Use correct headers from the start instead of guessing and retrying on 415/406.

**Why:** sapcli has done this since 2018 — it's the standard ADT pattern. ARC-1 currently uses reactive retry logic (FEAT-08) which adds latency and doesn't cover all edge cases. The discovery document tells you exactly what each endpoint accepts, eliminating guesswork.

**Why this is better than FEAT-08 alone:** FEAT-08 retries after failure (1 extra round-trip per mismatch). FEAT-38 probes once at startup and gets it right the first time for all subsequent requests. Combined approach: discovery at startup + FEAT-08 retry as fallback.

**Implementation (2026-04-14):**
- Added `src/adt/discovery.ts` with `fetchDiscoveryDocument()`, `resolveAcceptType()`, and `resolveContentType()`
- Added `parseDiscoveryDocument()` to `src/adt/xml-parser.ts` and discovery fixture/tests
- `probeFeatures()` now fetches `/sap/bc/adt/discovery` in parallel and stores `discoveryMap` on `ResolvedFeatures`
- `AdtHttpClient` now uses startup-cached discovery map for proactive `Accept`/`Content-Type` defaults
- 406/415 retry logic now caches successful negotiated headers per endpoint as a learning fallback
- Startup wiring injects cached discovery into all request clients (shared and per-user PP)

---

<a id="feat-39"></a>
### FEAT-39: Transport Enhancements
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — completes CTS lifecycle for LLM workflows |
| **Status** | ✅ Completed |
| **Source** | [sapcli comparison](../compare/09-sapcli.md) |

**What:** Extend SAPTransport with: delete transport/task, reassign owner, transport type selection (K/W/T), recursive release, and transport contents parsing. Subsumes FEAT-19.

**Implemented:**
- `deleteTransport()` with recursive flag (deletes unreleased tasks first)
- `reassignTransport()` with recursive flag (reassigns unreleased tasks first)
- `createTransport()` now accepts transport type parameter: K (Workbench), W (Customizing), T (Transport of Copies)
- `releaseTransportRecursive()` as new action (releases tasks before parent)
- Transport object parsing (`tm:abap_object`) in GET responses
- Fixed Accept header bugs in `getTransport()` and `releaseTransport()`
- All new operations gated by `checkTransport()` safety checks

**Deferred:** Transport types S (Development-Correction) and R (Repair) require specific CTS configuration that most systems lack.

---

<a id="feat-40"></a>
### FEAT-40: FLP Launchpad Management (OData)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | M (3-5 days) |
| **Risk** | Medium — OData API, different from ADT REST |
| **Usefulness** | Very High — enterprise Fiori rollout automation |
| **Status** | Completed (2026-04-12) |
| **Source** | [sapcli comparison](../compare/09-sapcli.md), sapcli `sap/cli/flp.py` + `sap/odata/` |

**What:** Manage Fiori Launchpad configuration: catalogs, groups, target mappings, and tile assignments. Uses OData service `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` (on-prem) or equivalent BTP API.

**Why:** Fiori Launchpad configuration is a major pain point in SAP projects. Automating catalog/group/tile setup via LLM saves hours of manual work per role. This is the kind of high-value enterprise automation that differentiates ARC-1 from developer-only tools.

**Implementation:**
- `src/adt/flp.ts` — OData client for PAGE_BUILDER_CUST with double-JSON tile config handling
- SAPManage actions: `flp_list_catalogs`, `flp_list_groups`, `flp_list_tiles`, `flp_create_catalog`, `flp_create_group`, `flp_create_tile`, `flp_add_tile_to_group`, `flp_delete_catalog`
- Feature-gated via `featureFlp` config (auto-probed at startup)
- Write ops use `OperationType.Workflow` — blocked unless `SAP_ALLOW_WRITES=true`
- Graceful ASSERTION_FAILED handling for problematic catalogs

---

<a id="feat-41"></a>
### FEAT-41: ABAP Unit Test Coverage (Statement-Level)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — enables test-driven ABAP development |
| **Status** | Not started |
| **Source** | [sapcli comparison](../compare/09-sapcli.md), sapcli `sap/adt/aunit.py` |

**What:** Fetch statement-level code coverage after running ABAP Unit tests. Uses `POST /sap/bc/adt/runtime/traces/coverage/measurements/{id}` with paginated `rel=next` follow-up for large result sets.

**Why:** Coverage data tells the LLM which lines are untested, enabling targeted test generation. sapcli and AWS Accelerator both have this. Currently ARC-1 runs tests but returns only pass/fail — no coverage metrics.

**Concern:** Coverage for a 500-line class generates 500+ lines of output. May need summarization (e.g., "85% covered, 12 uncovered lines: 45-48, 102-105, 200-204") rather than raw line-by-line data.

**Implementation:**
- Add `enableCoverage` parameter to `runUnitTests()` in `src/adt/devtools.ts`
- Post coverage measurement request, parse response with pagination
- Return summary + uncovered line ranges (not raw per-line data, to avoid context bloat)
- Integrate into SAPDiagnose or SAPRead `run_tests` action

---

<a id="feat-42"></a>
### FEAT-42: ATC Output Formats
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low |
| **Usefulness** | Medium — CI/CD integration |
| **Status** | Not started |
| **Source** | [sapcli comparison](../compare/09-sapcli.md) |

**What:** Format ATC check results as JUnit4 XML, checkstyle XML, or codeclimate JSON. Currently ARC-1 returns raw ATC results.

**Why:** Standard output formats enable integration with CI/CD pipelines (GitHub Actions, Jenkins, GitLab CI) and code quality dashboards.

**Implementation:**
- Add `format` parameter to ATC handler in `src/handlers/intent.ts` (`raw`, `junit4`, `checkstyle`, `codeclimate`)
- Formatter functions in new `src/adt/atc-formatters.ts`
- Default to current format for LLM consumption; optional structured formats for CI/CD

---

<a id="feat-43"></a>
### FEAT-43: DDIC Auth & Misc Read (Authorization Fields, Feature Toggles, Enhancement Implementations)
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — niche but useful for authorization analysis |
| **Status** | Completed (2026-04-17) |
| **Source** | [sapcli comparison](../compare/09-sapcli.md), sapcli commit `2ec4228` (Apr 2026) |

**What:** Add read support for Authorization Fields (`/sap/bc/adt/aps/iam/auth/{name}`, XML namespace `http://www.sap.com/iam/auth`), Feature Toggles (`/sap/bc/adt/sfw/featuretoggles/{name}/states`), and Enhancement Implementations (`/sap/bc/adt/enhancements/enhoxhb/{name}`). sapcli recently added Authorization Fields (Apr 2026) and has had Feature Toggles since 2023.

**Why:** Authorization analysis is important for security audits. Feature toggles are used in SAP's switch framework for conditional features.

**Implementation:**
- Add `getAuthorizationField(name)` to `src/adt/client.ts`
- Add `getFeatureToggle(name)` to `src/adt/client.ts`
- Add both types to SAPRead handler
- XML parsing in `src/adt/xml-parser.ts` for the `auth:auth` namespace

---

<a id="feat-44"></a>
### FEAT-44: TABL (Database Table) Create
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Very High — blocks RAP stack creation from scratch |
| **Status** | Completed (2026-04-14) |
| **Source** | [RAP project analysis](https://github.com/Xexer/abap_rap_blog), [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap), [feature matrix](../compare/00-feature-matrix.md) |

**What:** Add create/update/delete support for traditional DDIC database tables (TABL) via SAPWrite. Tables are a prerequisite for CDS-based RAP development — root views reference persistent tables, and draft tables are required for managed BOs with draft.

**Current gap:** Closed in 2026-04-14 implementation.

**Competitor support:**
- **sapcli:** Full TABL CRUD via `POST /sap/bc/adt/ddic/tables/` + batch activation. XML serialization with `OrderedClassMembers` preserves element order.
- **vibing-steampunk:** CreateTable tool in Focused mode with batch activation.
- **fr0ster:** `HandlerCreate` routes to tables URL; auto-activates post-create (v5.0.7+).
- **dassian-adt:** `abap_create` with 16 type auto-mappings including TABL.

**Implementation:**
- Add `'TABL'` to `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` in `src/handlers/tools.ts`
- Add `'TABL'` to SAPWrite schema enums in `src/handlers/schemas.ts` (single + batch object schemas)
- Add TABL case to `buildCreateXml()` in `src/handlers/intent.ts` using `blue:blueSource` and `adtcore:type="TABL/DT"` (same shell pattern as BDEF)
- Keep TABL source-based (not DDIC metadata type): create shell with POST, then write source via `/source/main` using existing `safeUpdateSource` flow
- Keep content-type as `application/*` for create (same behavior as DDLS/SRVD)
- TABL requires activation after create (already supported via `SAPActivate`)
- Add unit tests for TABL create/update/delete/batch_create routing and create-XML output
- Add E2E lifecycle test (`tests/e2e/rap-write.e2e.test.ts`) for TABL create/read/activate/update/delete

---

<a id="feat-45"></a>
### FEAT-45: DEVC (Package) Create
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — blocks greenfield development workflows |
| **Status** | Completed (2026-04-14) |
| **Source** | [RAP project analysis](https://github.com/Xexer/abap_rap_blog), [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap), [feature matrix](../compare/00-feature-matrix.md) |

**What:** Add package creation via SAPManage. Packages are the container for all ABAP development objects.

**Implemented (2026-04-14):** SAPManage actions `create_package` and `delete_package` with ADT endpoint `/sap/bc/adt/packages`.

**Competitor support:**
- **sapcli:** `POST /sap/bc/adt/packages` with full XML body (name, description, superPackage, softwareComponent, transportLayer). Accepts explicit `corrNr` for transport.
- **vibing-steampunk:** CreatePackage tool in Focused mode. Note: package safety bypass bug #101 (SAP_ALLOWED_PACKAGES not enforced on create) — ARC-1 should avoid this.
- **fr0ster:** Generic `HandlerCreate` routes to packages URL.
- **dassian-adt:** `abap_create` with auto-derived software component + transport layer.

**Implementation:**
- Added `buildPackageXml()` (`pak:package` root, `DEVC/K`) in `src/adt/ddic-xml.ts`
- Added SAPManage actions: `create_package`, `delete_package`
- Added transport pre-flight guidance for non-local parent packages
- Enforced package allowlist on the parent package (`superPackage`)
- Implemented delete via lock/delete/unlock flow
- Updated schemas/tool definitions, tests, and docs/feature matrix

---

<a id="feat-46"></a>
### FEAT-46: SRVB (Service Binding) Create
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — completes RAP stack lifecycle (ARC-1 already has publish/unpublish) |
| **Status** | Complete (2026-04-14) |
| **Source** | [RAP project analysis](https://github.com/Xexer/abap_rap_blog), [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap), [feature matrix](../compare/00-feature-matrix.md) |

**What:** Add SRVB object creation to SAPWrite. ARC-1 already reads SRVB and can publish/unpublish via SAPActivate.

**Implemented (2026-04-14):**
- Added `SRVB` to SAPWrite type enums and input schemas (on-prem + BTP).
- Added SRVB XML builder (`srvb:serviceBinding`) with `serviceDefinition`, `bindingType`, `category`, `version`.
- Added `buildCreateXml()` SRVB case and metadata-write routing (XML PUT update path, no `/source/main`).
- Added vendor content type for SRVB updates: `application/vnd.sap.adt.businessservices.servicebinding.v2+xml`.
- Added SAPWrite create response hint to run activation then `publish_srvb`.
- Added unit + E2E coverage for create/update/delete/batch_create and publish lifecycle.

**Competitor support (reference):**
- **sapcli:** Full SRVB CRUD via `POST /sap/bc/adt/businessservices/bindings/` with vendor-specific content type.
- **fr0ster:** `HandlerCreate` supports SRVB creation (v5.0.0+).
- **vibing-steampunk:** No create, only publish/unpublish.
- **dassian-adt:** No SRVB create.

**Note:** SRVB and DCL are now covered end-to-end. TABL (FEAT-44), DEVC (FEAT-45), MSAG (FEAT-47), and DCL (FEAT-37) are completed.

---

<a id="feat-47"></a>
### FEAT-47: MSAG (Message Class) Read/Write
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — used in RAP exception classes and validation messages |
| **Status** | Completed |
| **Source** | [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap), [feature matrix](../compare/00-feature-matrix.md) |

**What:** Add read and write support for ABAP message classes (MSAG / T100). ARC-1 can already read T100 messages via `SAPRead type=MSAG` (message class listing), but cannot create message classes or add/update individual messages.

**Current gap:** Message classes are used in RAP for structured error messages in exception classes (`zdmo_cx_rap_generator` → `zdmo_cm_rap_gen_msg`). Without MSAG write, LLMs must use hardcoded text in RAISEs instead of proper message classes.

**Competitor support:**
- **sapcli:** Full message class CRUD. Read via `/sap/bc/adt/messageclass/{name}`, individual messages via `/sap/bc/adt/messageclass/{name}/messages/{number}`.
- **vibing-steampunk:** Message class read (T100 listing).
- **fr0ster:** Message class read via `adt-clients` factory.
- **dassian-adt:** No message class support.

**Implementation:**
- Add `MSAG` to `objectBasePath()` → `/sap/bc/adt/messageclass/`
- Add `MSAG` to `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP`
- MSAG is a DDIC metadata type (XML-only, no source code)
- XML body includes message class name, description, and message entries (number, type, short text, long text)
- Add to `isDdicMetadataType()` for XML PUT updates
- Content-Type: likely `application/vnd.sap.adt.messageclass.v2+xml` (vendor-specific)

---

<a id="feat-48"></a>
### FEAT-48: SKTD (Knowledge Transfer Documents) Read/Write
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | Medium — Markdown documentation attached to ABAP objects |
| **Status** | **✅ Completed** — PR #134 by lemaiwo merged 2026-04-16 |
| **Source** | [PR #134](https://github.com/marianfoo/arc-1/pull/134) |

**What:** Read and write SAP Knowledge Transfer Documents (KTDs) — Markdown documentation that can be attached to ABAP objects like CDS views, BDEFs, classes, programs, etc. Editable in Eclipse ADT and stored on the SAP system as XML envelopes with base64-encoded Markdown content.

**ADT endpoints:**
- **Read**: `GET /sap/bc/adt/documentation/ktd/documents/{name}` with `Accept: application/vnd.sap.adt.sktdv2+xml`
- **Create**: `POST /sap/bc/adt/documentation/ktd/documents` (collection URL)
- **Update**: `PUT /sap/bc/adt/documentation/ktd/documents/{name}` with full XML envelope (fetch-modify-PUT pattern preserving server-side metadata)
- **Delete**: Standard ADT delete via lock/delete/unlock
- Name must equal parent object name (SAP rule: one KTD per object)
- Supports multiple `sktd:element` sections (e.g., one per CDS field)

**XML envelope structure:**
```xml
<sktd:docu xmlns:sktd="..." responsible="..." masterLanguage="EN">
  <sktd:refObject type="DDLS/DF" name="ZC_MYBOOKING"/>
  <sktd:element id="...">
    <sktd:text>{base64-encoded Markdown}</sktd:text>
  </sktd:element>
</sktd:docu>
```

**New tool parameters (PR #134):**
- `SAPRead type=SKTD` — returns decoded Markdown (not raw XML/base64)
- `SAPWrite action=create type=SKTD` — requires `refObjectType` (e.g., `DDLS/DF`, `CLAS/OC`, `BDEF/BDO`)
- `SAPWrite action=update type=SKTD` — `source` parameter contains new Markdown

**Why:** LLMs can read and write inline documentation for ABAP objects without leaving the ADT context. Enables AI-assisted documentation workflows: generate KTD for a CDS view, update existing documentation, read KTDs before suggesting changes. Unique to ARC-1 — no other MCP server supports KTDs.

**Why not:** Documentation is authored by humans; LLM-generated KTDs risk low-quality content being committed to SAP systems. KTDs are an Eclipse ADT-specific concept — not widely known or used in all SAP landscapes. Activation required after create/update adds complexity.

---

<a id="feat-49"></a>
### FEAT-49: Object Transport History (Reverse Lookup)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — enables transport-scoped code review, change tracking |
| **Status** | Completed (2026-04-17) |
| **Source** | [fr0ster#30](https://github.com/fr0ster/mcp-abap-adt/issues/30) |
| **Related** | FEAT-20 (revision history), FEAT-24 (diff) — together these three enable transport-scoped code review |

**What:** Given an ABAP object (type + name), find all transport requests that contain it. This is the "reverse lookup" — ARC-1 already supports `SAPTransport(action="get")` to see objects inside a transport, but not the other direction ("which transports touched `ZCL_MY_CLASS`?"). This is step 1 of the fr0ster#30 workflow: identify the relevant transport before fetching versioned source or computing diffs.

**ADT endpoints (verified 2026-04-17 on A4H):**

1. **Per-object transport endpoint (implemented, preferred):**
   - `GET {objectUrl}/transports`
   - Discovered from object structure links: `rel="http://www.sap.com/adt/relations/transport"`
   - Returns `dataname=com.sap.adt.lock.result2` payload (`LOCKS` + `TRANSPORTS`)
   - For `$TMP`/untracked objects, returns 200 with empty body (normal outcome)

2. **`transportReference` endpoint (not suitable for history payload):**
   - `GET /sap/bc/adt/cts/transportrequests/reference?pgmid=R3TR&obj_wbtype={type}&obj_name={name}`
   - Verified live to resolve object URI link only; does **not** return related transport list
   - Kept as research note, not used for FEAT-49 implementation

3. **`transportchecks` endpoint (implemented fallback):**
   - `POST /sap/bc/adt/cts/transportchecks`
   - Used when `/transports` returns no related transports
   - Surfaces candidate transports and lock context after package auto-resolution from object structure

4. **SQL-based E071 query (complete history, deferred):**
   - `SELECT TRKORR FROM E071 WHERE PGMID = 'R3TR' AND OBJECT = '{type}' AND OBJ_NAME = '{name}'`
   - Then resolve task→request hierarchy via E070, optionally map to CR via E070A
   - Source: VSP `handleCRHistory` in `handlers_transport_analysis.go`
   - **Only way to get full transport history** — ADT REST endpoints only return current assignments
   - Requires `SAP_ALLOW_FREE_SQL=true` or data preview access to E071/E070

**Implementation summary (completed):**
- Added `SAPTransport(action="history", type, name)` in `handleSAPTransport`.
- Added `getObjectTransports()` in `src/adt/transport.ts` using `GET {objectUrl}/transports`.
- Reused existing `parseTransportInfo()` for `lock.result2` payload parsing.
- Added fallback to `transportchecks` when primary response is empty (package auto-resolved from object metadata).
- Added unit, integration, and E2E coverage plus docs/tool-schema updates.
- Safety model: read-only operation (`OperationType.Read`), no transport write privilege required.

**Why:** This is the missing link that makes FEAT-20 and FEAT-24 actionable. Without knowing *which* transport changed an object, the user can't ask for versioned source or a diff. The fr0ster#30 use case ("code review of the last transport") requires all three features working together. No competitor has the full trio as a cohesive workflow — implementing this puts ARC-1 ahead.

**Why not (deferred scope):** Full historical transport lineage via E071/E070 is intentionally deferred because it depends on free SQL/data-preview access, can conflict with safe defaults, and bypasses some clean per-user ADT authorization boundaries.

---

<a id="feat-50"></a>
### FEAT-50: ADT Probe Fixture Coverage

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | XS per contributed fixture |
| **Risk** | None (diagnostic-only; fixtures are recorded bytes, not product behavior) |
| **Usefulness** | Medium — each fixture permanently hardens [`classifyVerdict`](../src/probe/runner.ts) against regressions on that product line |
| **Status** | Ongoing / contributor-driven |
| **Source** | Issue [#162](https://github.com/marianfoo/arc-1/issues/162), PR [#163](https://github.com/marianfoo/arc-1/pull/163), PR [#170](https://github.com/marianfoo/arc-1/pull/170) |
| **Related** | [`docs/probe-adt-types.md`](../docs/probe-adt-types.md) |

**What:** Grow the set of recorded fixtures that [`tests/unit/probe/replay.test.ts`](../tests/unit/probe/replay.test.ts) runs against, so the probe classifier is regression-tested against the full variety of real SAP landscapes rather than a handful of hand-picked systems. Each fixture is ~40 JSON files totaling <1 MB and requires no live SAP connection in CI.

**Currently covered:**
- `synthetic-752` — hand-crafted 7.52 fixture, covers every `classifyVerdict` decision branch (the #94 HTTP-400 regression guard lives here)
- `s4hana-2023-onprem-abap-trial` — SAP_BASIS 758 + S4FND 108 (ABAP developer trial, RAP-complete)
- `npl-750-sp02-dev-edition` — NPL 7.50 SP02 developer edition (classic ABAP, RAP absent)
- `ecc-ehp8-nw750-sp31-onprem-prod` — productive ECC 6.0 EhP8 on NW 7.50 SP31 (DDLS/DCLS via known-object despite collection 500s)

**Gaps worth filling (ordered by classifier value):**

| # | System | Why it matters for the classifier |
|---|--------|-----------------------------------|
| 1 | **BTP ABAP Environment (Steampunk)** | Cloud-only shape: `SAP_CLOUD` component, different discovery surface, RAP-first, some classic endpoints 404. Exercises the `hasCloud → btp` systemType branch and cloud-specific endpoint patterns no current fixture hits. |
| 2 | **S/4HANA Public Cloud, Embedded Steampunk** | Released/restricted ABAP Cloud. Many legacy types should come back `unavailable-high` from 404, but RAP types should be `available-high`. Validates the "modern Cloud rejects classic, accepts RAP" polarity. |
| 3 | **S/4HANA Cloud Private Edition** | Between on-prem S/4 and Public Cloud; same BASIS line as on-prem but with cloud-only traits. Tells us whether classifier behaves consistently across the S/4 family. |
| 4 | **Plain NetWeaver productive (non-ERP)** — SolMan 7.2, GRC, PI/PO, CRM 7, SRM | Real productive NW without `SAP_APPL`. Exercises the "no ECC/S/4 product markers" discrimination path and confirms the classifier isn't quietly relying on ECC-shaped responses. |
| 5 | **ECC 6.0 EhP7 (NW 7.40)** | Lower release floor for DDLS (7.40); many real ECC systems still run there. Pins the "release == floor, not above" edge case. |
| 6 | **NetWeaver 7.52 productive** | Would let us shrink the hand-crafted `synthetic-752` to just the branches a real 7.52 doesn't emit, instead of carrying the whole synthetic. |
| 7 | **NetWeaver 7.56 / 7.57** | Fill the gap between `synthetic-752` and `s4hana-2023` (BASIS 758). Catches regressions that only surface at intermediate releases. |
| 8 | **S/4HANA on-prem 2020 / 2021 / 2022** | RAP features evolved across releases; our S/4 coverage currently jumps straight to 2023. Intermediate captures pin the release-floor ordering. |
| 9 | **System with restrictive authorization** (probe user lacks `S_DEVELOP` / `S_ADT_RES`) | Exercises the `auth-blocked` verdict with real 401/403 patterns, not the hand-crafted pair in `synthetic-752`. |
| 10 | **System fronted by SSO / SAML / MFA** (captured via cookie auth from PR [#170](https://github.com/marianfoo/arc-1/pull/170)) | Validates the cookie-auth contribution path end-to-end — meta.json shouldn't leak the session cookie, responses should still be probeable. |

**How to contribute:** See the "How to contribute a fixture set from your own system" section in [docs/probe-adt-types.md](../docs/probe-adt-types.md). Each contributed fixture needs a short replay-test block in [`tests/unit/probe/replay.test.ts`](../tests/unit/probe/replay.test.ts) asserting the verdicts the contributor observes on their system — that's what turns the fixture into a permanent regression guard.

**Why P3:** The probe is diagnostic-only; it does not change product behavior. Missing fixtures reduce confidence in classifier stability across SAP landscapes but do not cause user-visible defects. Priority rises if a regression in `classifyVerdict` ships undetected, or if issue [#162](https://github.com/marianfoo/arc-1/issues/162)-style "what types does my system actually support?" questions become a recurring support channel.

---

<a id="feat-55"></a>
### FEAT-55: System Messages (SM02) + Gateway Error Log (/IWFND/ERROR_LOG)

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low |
| **Usefulness** | High — situational awareness (SM02) and OData/Gateway debugging (IWFND) for AI agents |
| **Status** | **Completed** (2026-04-21, PR #174) |
| **Source** | fr0ster v5.0.0 ADT feed reader, issue-level guidance in VSP/dassian trackers |

**What:** Extended `SAPDiagnose` with two new actions that surface standard SAP runtime feeds via ADT:
- `action="system_messages"` — SM02 system messages (list mode; filters: user, from, to, maxResults)
- `action="gateway_errors"` — /IWFND/ERROR_LOG entries (list mode + detail mode via `detailUrl` preferred or `id+errorType`). On-prem only.

**Why:** Closes the last fr0ster-v5-unique diagnostics gap. Before PR #174 ARC-1 had dumps + profiler traces via `SAPDiagnose`; now it has the full set (dumps, traces, system_messages, gateway_errors, quickfix, apply_quickfix). Gateway errors are the primary debugging signal for OData service failures — making them reachable from the LLM closes the loop between "user reports Fiori app error" and "agent finds the call stack in /IWFND/ERROR_LOG".

**Implementation:**
- `src/adt/diagnostics.ts` extended with feed-reader helpers for SM02 and /IWFND/ERROR_LOG.
- New `SAPDiagnose` schema fields: `detailUrl`, `errorType`, `from`, `to`, `sections`, `includeFullText`.
- Dumps action rewritten to return focused chapter sections (`kap0`/`kap3`/…) by default; `includeFullText=true` opt-in returns the full formatted blob (token-saving default).
- Structured JSON response shapes in `src/adt/types.ts`.
- Unit + integration + E2E coverage (`tests/unit/adt/diagnostics.test.ts`, `tests/integration/adt.integration.test.ts`, `tests/e2e/diagnostics.e2e.test.ts`).

---

<a id="feat-56"></a>
### FEAT-56: ADT Type-Availability Probe (Diagnostic)

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | S (1-2 days) |
| **Risk** | None (diagnostic-only, no runtime gating) |
| **Usefulness** | High for support; fuels FEAT-50 contributed fixture coverage |
| **Status** | **Completed** (2026-04-20, PR #163) |
| **Source** | Issue #162, PR #93/#96 regression lessons |

**What:** Standalone `npm run probe` CLI that reports per-type ADT availability on any connected SAP system, plus quality metrics showing how much the probe's answers can be trusted.

**Multi-signal classifier:** discovery + collection GET + known-object GET + release floor. The PR #94/#95 regression lesson baked in: only HTTP 404 counts as a hard "not available"; 400/403/405/500 mean "endpoint is there". Fixtures captured via `--save-fixtures` drive replay-based unit tests so classifier decisions are regression-proof.

**Shipped fixtures:** synthetic 7.52 corpus + real NW 7.58 capture. Users can contribute fixture sets from their own systems — see FEAT-50.

**Why diagnostic-only:** Explicit design choice after the RAP probe #93 → #96 regression. The probe reports but never gates runtime behavior.

**Implementation:** `scripts/probe-adt-types.ts`, `src/probe/catalog.ts`, `src/probe/runner.ts`, `src/probe/fixtures.ts`, `tests/unit/probe/replay.test.ts`. See [docs/probe-adt-types.md](../docs/probe-adt-types.md).

---

<a id="feat-57"></a>
### FEAT-57: SAPContext Impact — Sibling DDLS/DDLX Consistency Check

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low (additive, bounded, best-effort) |
| **Usefulness** | High — catches a specific high-damage RAP bug class |
| **Status** | **Completed** (2026-04-22, PR #177) |

**What:** Additive sibling-consistency pass in `SAPContext(action="impact")` that surfaces the common RAP bug where one DDLS variant has DDLX metadata extensions but a sibling variant in the same package does not — leaving one routing path with missing UI fields.

**Implementation:**
- New helpers in `src/adt/cds-impact.ts` (`deriveSiblingStem`, `isSiblingNameMatch`, `buildSiblingExtensionFinding`).
- New `siblingCheck` (default true) and `siblingMaxCandidates` (default 4, hard cap 10) inputs on `SAPContext`.
- Emits `consistencyHints` + `siblingExtensionAnalysis` when siblings show asymmetric DDLX coverage. Base response remains backward-compatible.
- Guard: stems shorter than 3 chars skip the analysis with a warning so e.g. "Z1" does not trigger a Z* scan of the entire namespace.
- Sibling failures degrade to warnings only; outer catch logs via `logger.debug` so best-effort failures stay diagnosable.

**Why:** Raw "upstream+downstream" dependency dumps don't flag this bug — you only notice it when a user reports "the UI works for customer X but not Y" and tracing the routing path. Detecting it automatically is exactly the kind of workflow-level differentiation the 2026-04-18 research note called out.

---

<a id="feat-58"></a>
### FEAT-58: DTEL v2→v1 Content-Type Fallback + SICF-aware Error Hints

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | XS (< 1 day) |
| **Risk** | Low (narrow static allowlist, 415-only retry) |
| **Usefulness** | High — fixes DTEL create on older releases + actionable hint on SICF misconfig |
| **Status** | **Completed** (2026-04-20, PR #169) |

**What:** Two compatibility improvements for DTEL create on older SAP releases:
1. **Content-Type fallback** — `src/adt/crud.ts` now has a narrow static `CONTENT_TYPE_FALLBACKS` map; on HTTP 415 the client retries once with the fallback Content-Type (specifically `vnd.sap.adt.dataelements.v2+xml` → `vnd.sap.adt.dataelements.v1+xml` for DTEL). Not a generic retry loop — each entry must be a specific, tested compatibility gap.
2. **`icf-handler-not-bound` error classification** — new SAP-domain category for DTEL create failures caused by a missing SICF node. The hint points operators to SICF activation rather than to SAP authorization.

**Implementation:** `src/adt/crud.ts` (fallback map + 415 retry in both `createObject` and `updateObject`), `src/adt/errors.ts` (new `icf-handler-not-bound` category in `classifySapDomainError`), `src/handlers/intent.ts` (`formatErrorForLLM` routing). Unit tests in `tests/unit/adt/crud.test.ts` and `tests/unit/adt/errors.test.ts`.

---

<a id="bug-01"></a>
### BUG-01: SAPActivate Phantom Success + CLI/Server Alignment (NW 7.50)

| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | S (1-2 days) |
| **Risk** | Medium — parser changes affect every activation path |
| **Usefulness** | Critical — false "Successfully activated" is worse than a failure |
| **Status** | **In flight** — PR [#179](https://github.com/marianfoo/arc-1/pull/179) (samibouge) open at 2026-04-23 |
| **Source** | Reported on NW 7.50 reproducer against `ZCL_XXX` |

**What:** `SAPActivate` reported "Successfully activated" for an ABAP class that was provably inactive (still failing to compile in Eclipse, visible as inactive in SAP GUI). Five independent parser/handler bugs combined into a silent no-op:

1. **`parseActivationResult` misreads `<ioc:inactiveObjects>` as success** — the response shape with zero `<msg>` elements but several `<ioc:inactiveObjects>` entries was read as "no errors → success". VSP's Go client correctly treats this shape as failure.
2. **`getInactiveObjects` hardcoded to the Cloud endpoint path** — Newer SAP uses `/sap/bc/adt/activation/inactive`; NW 7.50 uses `/sap/bc/adt/activation/inactiveobjects`. The client hardcoded the new path and returned 404 on older systems.
3. **`parseInactiveObjects` only understood the feed-wrapped shape** — NW 7.50 returns a flat `<adtcore:objectReferences>` list; parser returned `[]` for this shape.
4. **`SAPDiagnose syntax` had no `version` parameter** — The low-level `syntaxCheck()` already supported `{ version: 'active' | 'inactive' }` but the MCP tool schema never exposed it, so callers couldn't reach real compile errors on objects with pending changes.
5. **`parseSyntaxCheckResult` missed NW 7.50's `<chkrun:checkMessage>` shape** — Wrong element name and line/column encoded inside `uri="…/source/main#start=LINE,COL"` fragment.

**Why P0:** False-positive activation is the worst possible failure mode — it confidently misleads every downstream consumer (CI, eval suites, LLM agents chaining operations).

**PR #179 fix summary:** inactive-objects detection in parse result (including owning user from `ioc:transport[@_user]`), endpoint fallback, flat-shape parser support, new `version` parameter plumbed through, `<chkrun:checkMessage>` position extraction, and a new `inactiveSyntaxDiagnostic()` primitive invoked on activation failure to append compiler errors from the inactive version.

**Blast radius:** Every activation path (`SAPActivate`, RAP batch activation, E2E suites). Needs the missing E2E regression test the PR description calls out: create a class with a deliberate type error → attempt `SAPActivate` → assert failure → assert the returned message names the user and includes compiler text.

---

<a id="arch-01"></a>
### ARCH-01: Discovery-driven Endpoint Routing

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | M (3-5 days) |
| **Risk** | Medium — touches discovery, intent, tools layers |
| **Usefulness** | High — replaces brittle hard-coded URLs with self-correcting routing |
| **Status** | **Plan ready** — [docs/plans/discovery-driven-endpoint-routing.md](../docs/plans/discovery-driven-endpoint-routing.md); decision recorded in [docs/adr/0001-discovery-driven-endpoint-routing.md](../docs/adr/0001-discovery-driven-endpoint-routing.md) |
| **Blocks** | PR-ε (release-gate cleanup, if any release literals are reintroduced before ARCH-01 lands) |

**What:** Generalize the discovery-driven URL pattern (`resolveTablObjectUrl` already does this for TABL — falls back from `/ddic/tables` to `/ddic/structures` based on what the SAP system publishes in `/sap/bc/adt/discovery`). Extend the same approach to other types where the URL varies across releases or where systems differ in which collections they expose: DOMA, DDLX, BDEF, SRVD, SRVB, ENHO. Adds one helper (`discoveryHasCollection(uri)`) plus a `RESOLVE_RULES` table mapping each type to an ordered candidate-URL list. Eliminates per-version branching in the handler hot path.

**Why P1:** Foundation for replacing brittle release-version literals (`isRelease750()` and similar) anywhere they exist. Also makes the codebase self-correcting across SAP support packs — when SAP back-ports a collection, ARC-1 picks it up automatically. The pattern is already proven in `resolveTablObjectUrl`; this generalizes it.

**Live evidence (captured 2026-04-28 against A4H 758 SP02 + NPL 750 SP02):** A4H discovery publishes `/ddic/{tables, structures, domains, ddlx/sources}, /bo/behaviordefinitions, /businessservices/bindings, /enhancements/{enhoxh, enhoxhb}`. NPL 750 publishes only `/ddic/{structures, dataelements, ddl/sources}, /enhancements/enhoxh, /messageclass, /businesslogicextensions/badis`. Discovery is the precise, machine-readable answer to "is this collection available."

**Empirical input:** [docs/nw750-discovery-gap-analysis.md](../docs/nw750-discovery-gap-analysis.md) — endpoint-by-endpoint inventory contributed by PR [#196](https://github.com/marianfoo/arc-1/pull/196) author.

---

<a id="pr-epsilon"></a>
### PR-ε: Remove Static Release Gates (consumes ARCH-01)

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | S (1-2 days) |
| **Risk** | Low — purely deletion + swap-in if release literals are reintroduced |
| **Usefulness** | Maintenance — keeps the codebase free of `release < 751` literals once ARCH-01 lands |
| **Status** | **Blocked on ARCH-01.** Currently a placeholder — the static release maps proposed in PR [#196](https://github.com/marianfoo/arc-1/pull/196) were not merged, so there is currently nothing to remove. If any future PR reintroduces release-version branching for endpoint routing, PR-ε replaces it with `resolveSourceUrl` / `filterByDiscovery`. |

**Verification:** Each removal must be paired with a regression test against the NPL-7.50 probe fixture and a 758-class fixture, confirming the routing decision is identical to or better than what the literal would produce.

---

<a id="feat-59"></a>
### FEAT-59: Embeddable Multi-Tenant Server (per-instance `systemType`)

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | M (3-5 days) |
| **Risk** | Medium — touches configuration and per-call routing |
| **Usefulness** | Medium — enterprise customers running one MCP gateway for multiple SAP systems |
| **Status** | Not started |
| **Source** | fr0ster v6.4.0 (PR #69/#70, 2026-04-20) — per-instance `systemType` on `EmbeddableMcpServer` |

**What:** Let a single ARC-1 instance serve multiple SAP backends with per-instance configuration, including per-instance `systemType` (`auto` / `btp` / `onprem`). Today ARC-1 is "one gateway per SAP system" — scaling to many systems means deploying many instances.

**Why:** Customers with mixed landscapes (dev BTP + prod on-prem + sandbox ECC) want one MCP endpoint per environment, not one per SAP system. fr0ster's v6.4.0 EmbeddableMcpServer pattern is the reference implementation. Principal Propagation already handles per-user identity; per-instance would handle per-system routing.

**Why not:** ARC-1's safety config is global (`allowWrites`, `allowedPackages`, etc.) — multi-tenant requires per-tenant safety gates or a consistent profile per SAP system. Also overlaps with the existing Destination Service pattern on BTP. Likely best implemented as a thin router in front of existing per-system instances rather than rebuilding the core. Reconsider when a customer explicitly asks.

---

<a id="feat-60"></a>
### FEAT-60: CLI/Server Alignment (Shortcut Parity with MCP Tool Schemas)

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | S (1-2 days) |
| **Risk** | Low (CLI-only, behind existing `call` generic entry point) |
| **Usefulness** | Medium — reduces "why can't the CLI do X?" support load |
| **Status** | Not started |
| **Source** | PR [#179](https://github.com/marianfoo/arc-1/pull/179) matrix |

**What:** The CLI exposes generic `call` + `tools` entry points plus ergonomic shortcuts for some MCP tools, but the shortcuts have drifted from the Zod schemas. PR #179's matrix shows 9 of 12 MCP tools (SAPWrite, SAPNavigate, SAPTransport, SAPGit, SAPContext, SAPLint, SAPManage and the extended actions of SAPRead/SAPDiagnose/SAPActivate) have no shortcut or incomplete shortcut coverage.

**Why:** CLI drift forces users into `call SAPX --arg key=value` syntax for any non-basic operation. This hides capabilities from ad-hoc users and makes the CLI hard to recommend alongside the MCP server.

**Implementation options:**
1. Hand-write the missing shortcuts — faster, but will drift again next time a schema changes.
2. Auto-generate shortcut help (required/optional field hints) from the Zod schemas at build time — slower first cut, but prevents future drift.

**Why not:** CLI usage is minor compared to MCP-first usage (Claude Desktop, Cursor, etc.). Option 2 adds build-time complexity. Defer if CLI shortcut requests stay sporadic.

**Related follow-up from PR #179:** rename the local `lint` CLI command to `lint-local` or `offline-lint` to free `lint` for the `SAPLint` MCP tool; clean up XML entity residue (`&quot;`, `&gt;`) in `SyntaxMessage.text`.

---

<a id="feat-61"></a>
### FEAT-61: Tool Extension Points (Custom Tools on Top of ARC-1)

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | M-L (phased: Phase 0+1 ≈ M, Phase 2 ≈ S, Phase 3 ≈ M, Phase 4 if ever ≈ M) |
| **Risk** | Medium — touches the central tool registration / scope policy / audit path |
| **Usefulness** | Medium-High — unblocks customer-specific tools without forking; the prerequisite for any later marketplace |
| **Status** | Research only — see [docs/research/tool-extension-points.md](../docs/research/tool-extension-points.md) |
| **Source** | User-requested 2026-04-26 — reuse ARC-1 plumbing (ADT, HTTP, OData) for in-house tooling |

**What:** A documented, opinionated way for downstream users to add their own MCP tools to an ARC-1 instance and reuse the same building blocks the built-in tools rely on (`AdtClient`, `AdtHttpClient`, `SafetyConfig`, `CachingLayer`, `logger`, typed errors), without forking the repository.

**Why:** Today the only way to add a tool is to fork the repo and edit six files (`tools.ts`, `schemas.ts`, `intent.ts`, `policy.ts`, plus tests). Customers with private/internal tools cannot upstream them. A defined extension point keeps the in-tree tool surface focused on the universally useful tools while letting teams extend their own instance.

**Phased plan (recommended):**

1. **Phase 0** — define the public API boundary (`src/public/` or `package.json#exports`). No new feature; just declare what is stable. Prerequisite for everything else.
2. **Phase 1** — internal `ToolRegistry` behind a feature flag. Built-ins register through it. No external behaviour change but the codebase becomes extension-shaped. One built-in (e.g. `SAPManage(action="cache_stats")`) converted end-to-end as a self-test.
3. **Phase 2** — local trusted plugin loader: `ARC1_PLUGINS=/path/to/plugin.js`. Admin-explicit, file-permission-checked, fail-fast on registration errors. Same trust model as any binary the admin runs.
4. **Phase 3 (optional)** — manifest-only plugins (declarative JSON, no JS) for thin endpoint wrappers — safest tier, fits the "I just want to wrap one OData endpoint" case.
5. **Phase 4 (only if asked)** — npm peer-package plugins. Not recommended unless customers explicitly request it; an npm marketplace fights the centralized-gateway model.

**Why not (yet):** ARC-1's value comes from the opinionated central safety/scope/audit pipeline. A poorly-designed plugin API could let a third-party tool bypass `allowWrites`, `allowedPackages`, scope policy, or PP. The research doc lists eight invariants that any plugin API must enforce; getting them right takes time. Deferred to P3 until either (a) a concrete customer asks for it, or (b) the in-tree tool count starts to feel like a marketplace candidate.

**Motivating example (2026-04-26):** the [samibouge NW 7.50 fork](https://github.com/marianfoo/arc-1/compare/main...samibouge:arc-1:feat/nw750-version-fix) is the first concrete case for this feature. 17 of its 18 commits are vanilla upstream candidates (and several are already merged via #179). The 18th — [`8dedcb0`, NW 7.50 dump detail via custom ICF endpoint](https://github.com/marianfoo/arc-1/commit/8dedcb0) — requires installing `ZCL_ARC1_DUMP_HANDLER` on the SAP system, which contradicts ARC-1's "no SAP-side install" principle and would bind upstream to maintaining customer-side ABAP. This is exactly the shape the extension model is meant to absorb: customer keeps the ABAP class in their own repo, ships a small TS plugin that calls `/sap/rest/arc1/dumps` via `client.http.get(...)`, admins opt in via `ARC1_PLUGINS=...`. Full bucketing of the 18 commits and a worked plugin sketch are in [§14 of the research doc](../docs/research/tool-extension-points.md#14-worked-example-samibouge-nw-750-fork--what-fits-what-doesnt).

**Out of scope:** Embedding ARC-1 *into* another app (already deferred as [FEAT-29g](#feat-29) — contradicts the centralized-gateway model). This item is the *opposite* — adding tools *to* an ARC-1 instance.

**Related research:**
- [docs/research/tool-extension-points.md](../docs/research/tool-extension-points.md) — full design with public-surface map, seven extension-pattern survey, security model, anti-patterns, open questions, a sketch of `defineTool()` + `ToolContext`, and the §14 case study against the samibouge NW 7.50 fork.

---

<a id="feat-62"></a>
### FEAT-62: ADT Transaction (`TRAN/T`) Source/Write Support

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Effort** | M |
| **Risk** | Medium — transaction lifecycle needs a separate ADT endpoint, JSON source MIME handling, and type-specific create payloads |
| **Usefulness** | Medium — closes a real ADT parity gap for transaction-code authoring, but endpoint availability is backend-dependent |
| **Status** | Research complete; not started. See [docs/research/adt-transaction-source-write.md](../docs/research/adt-transaction-source-write.md) |
| **Source** | [`jfilak/sapcli` PR #156](https://github.com/jfilak/sapcli/pull/156), merged 2026-04-28 |

**What:** Add on-prem transaction source/lifecycle support for `TRAN/T` through `/sap/bc/adt/aps/iam/tran`, while preserving existing metadata-only `SAPRead(type="TRAN")` through `/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`.

**Why:** ARC-1 currently returns transaction description/package and optionally `TSTC` program metadata, but cannot read/write the JSON transaction source or create/update/delete transaction objects. sapcli now has a concrete implementation: `TRAN/T`, `blue:blueSource`, JSON `source/main`, and base64-encoded server-driven creation JSON in `blue:additionalCreationProperties`.

**Implementation notes:**
1. Keep current VIT metadata read as the default `SAPRead(type="TRAN")` behavior.
2. Add explicit source read/write support for systems that expose `/sap/bc/adt/aps/iam/tran`.
3. Add `TRAN/T` type normalization and make lifecycle object URLs use the real transaction endpoint, not the VIT endpoint.
4. Make source writes MIME-aware so `TRAN` uses `application/json` while ABAP source objects keep `text/plain`.
5. Add a transaction create definition for report, parameter, dialog, OO, and variant transaction kinds, then embed compact JSON as base64 `application/vnd.sap.adt.serverdriven.content.v1+json`.
6. Skip ABAP lint/checkruns for transaction JSON; validate JSON locally and let SAP validate semantic references.
7. Feature-detect endpoint support through discovery/probe and return an explicit backend-unsupported message when VIT metadata exists but `/aps/iam/tran` does not.

**Research result:** Live read-only probes against the configured 7.58 systems returned 200 for VIT metadata (`adtcore:type="TRAN/T"`) but 404 for `/sap/bc/adt/aps/iam/tran`, `/SE38`, and `/SE38/source/main`; discovery did not list the endpoint. The NPL 7.50 profile was reachable but returned 401 for both VIT and `/aps/iam/tran`; the existing real NPL 7.50 SP02 fixture also does not list `/aps/iam/tran` in discovery. This means the implementation must be feature-detected and fixture-heavy until a backend exposing the endpoint is available.

**Why not immediately universal:** `TRAN/T` is not available on BTP in ARC-1 today and should remain excluded there. Even on on-prem, tested systems may expose only the VIT metadata endpoint. A naive replacement of `objectBasePath('TRAN')` would break existing metadata reads and produce confusing 404s.

---

<a id="feat-05"></a>
### FEAT-05: Code Refactoring (Rename, Extract Method)
| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | L (1-2 weeks) |
| **Risk** | Medium — complex ADT API interactions |
| **Usefulness** | Medium — valuable but complex |
| **Status** | Partially complete — change package implemented (2026-04-15); rename/extract remain future |

**What:** ADT supports code refactoring operations (rename symbol, extract method, change package). The marcellourbani/abap-adt-api TypeScript library implements these.

**Progress:** Change package assignment is implemented as `SAPManage(action="change_package")` — moves objects between packages via `/sap/bc/adt/refactorings` preview+execute flow. Supports transport auto-detection, package allowlists on both source and target.

**Why not (rename/extract):** Massive implementation burden for marginal value — rename requires cross-system impact analysis (all callers, dynamic references); extract method requires parsing dependencies, detecting side effects, validating signatures. Both need multi-step ADT lock/unlock cycles with rollback semantics. LLMs are better at writing new methods than surgically extracting from existing ones — `SAPWrite edit_method` already lets the LLM replace a method body. Eclipse ADT and VS Code already have mature refactoring tools that humans prefer for this workflow.

**Competitive update (2026-04-08):** VSP added rename preview analysis (commit dcaa358, Apr 6). Shows what would change without performing the rename. abap-adt-api has full rename (3 methods).

---

<a id="feat-29"></a>
### FEAT-29: P3 Backlog (Future / Niche)

The following features are tracked but not planned for near-term implementation. They are niche, complex, or not aligned with core principles.

| ID | Feature | Why deferred | Why not | Source | Effort |
|----|---------|-------------|---------|--------|--------|
| 29a | SSE transport | Most MCP clients use stdio or HTTP Streamable | Deprecated protocol; HTTP Streamable is the MCP standard | fr0ster | M |
| 29b | ABAP debugger (8+ tools) | Requires WebSocket + ZADT_VSP deployment | Massive scope, requires ABAP-side deployment (violates "no ABAP installation required" principle), niche use case for LLMs | VSP | L |
| 29c | Execute ABAP (IF_OO_ADT_CLASSRUN) | Security risk — needs careful safety gating | Fundamentally contradicts "safe defaults" principle — executing arbitrary ABAP from an LLM is the highest-risk operation possible | VSP, dassian | S |
| 29d | Call graph analysis (5 tools) | Useful but niche, complex | ADT doesn't expose call graphs directly; would need recursive where-used traversal (expensive, slow). SAPNavigate where-used covers the 80% case | VSP | M |
| 29e | UI5/Fiori BSP CRUD (7 tools) | Only relevant if UI5 detected | Out of scope — ARC-1 is ABAP ADT, not a UI5 deployment tool. BSP repository operations are fragile and version-specific | VSP | M |
| 29f | RFC connectivity (sap-rfc-lite) | Alternative to ADT HTTP, niche | Adds native binary dependency (N-API), breaks pure TypeScript promise, complex cross-platform compilation | fr0ster | M |
| 29g | Embeddable server mode | Library mode for CAP/Express embedding | Contradicts centralized gateway model — embedding in other apps creates unmanaged, unaudited instances | fr0ster | S |
| 29h | Lock registry with recovery | Persist lock state to disk for crash recovery | Over-engineering — SAP's own lock management (SM12) handles orphaned locks. ARC-1 uses `try/finally` for unlock, which is sufficient | fr0ster | M |
| 29i | Language attributes on creation | Multi-language object creation | Extremely niche — most ABAP objects are created in the system's default language | [abap-adt-api eval](../compare/abap-adt-api/evaluations/ffa43d7-language-attributes.md) | XS |
| 29j | Lua scripting / WASM compiler | VSP-unique experimental, not core MCP value | Experimental, not aligned with MCP standard, no enterprise demand | VSP | N/A |
| 29k | Dead code analysis | Method-level dead code via where-used | SAPNavigate where-used already provides the data; dead code determination is a heuristic that needs human judgment | [VSP eval](../compare/vibing-steampunk/evaluations/1ecafe7-dead-code-analysis.md) | S |
| 29l | Package health analysis | Aggregated test coverage + staleness + complexity | Composite metric without clear definition; each component (tests, where-used, complexity) is already available individually | [VSP eval](../compare/vibing-steampunk/evaluations/74efe5e-health-analysis.md) | M |
| 29m | Side effect / LUW classification | Classify methods by mutation profile | Requires runtime analysis or deep static analysis that ADT doesn't support; LLMs can infer side effects from reading the code | [VSP eval](../compare/vibing-steampunk/evaluations/11c2253-side-effects-luw.md) | M |
| 29n | Package boundary crossing | Architecture governance: cross-package call analysis | SAPNavigate where-used + package filter already covers this; dedicated tool adds marginal value over combining existing tools | [VSP eval](../compare/vibing-steampunk/evaluations/53fb790-boundary-crossing.md) | M |

---

<a id="ops-03"></a>
### OPS-03: Multi-System Routing
| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Effort** | L (1-2 weeks) |
| **Risk** | Medium — significant architecture change |
| **Usefulness** | Medium — needed for enterprises with multiple SAP systems |
| **Status** | Not started |

**What:** Support multiple SAP systems from a single ARC-1 instance. Each MCP request includes a `sap_system_id` parameter. ARC-1 routes to the appropriate system based on configuration.

**Why:** Enterprises have multiple SAP systems (DEV, QAS, PRD, sandboxes).

**Why not:** Fundamentally changes the architecture — ARC-1 is a single-system gateway by design. Multi-system routing adds routing logic, session management per system, namespace separation, and tenant isolation complexity. If routing breaks, users from system A could theoretically access system B's data. Better handled at infrastructure level: run one ARC-1 per SAP system and use a load balancer or Kubernetes service mesh to route clients. This follows the 12-factor app pattern and keeps each instance simple and secure.

---

## Details: Completed

<a id="sec-01"></a>
### SEC-01: Principal Propagation — Per-User SAP Authentication
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Effort** | L (1-2 weeks: code wiring + SAP admin setup + testing) |
| **Risk** | Medium — requires SAP Basis admin (STRUST, CERTRULE, ICM profile) |
| **Usefulness** | Critical — enables per-user SAP authorization and audit trail |
| **Status** | Code complete (2026-03-27) — needs SAP-side setup (STRUST, CERTRULE, ICM) for end-to-end testing |

**Implemented (2026-03-27) — BTP Cloud Connector approach (SEC-02 merged into SEC-01):**
- `lookupDestinationWithUserToken()` in `src/adt/btp.ts` — calls Destination Service "Find Destination" API with `X-User-Token` header
- Per-request ADT client creation in `src/server/server.ts` — `createPerUserClient()` creates a fresh ADT client for each authenticated user
- `SAP-Connectivity-Authentication` header injection in `src/adt/http.ts` — carries SAML assertion to Cloud Connector
- `SAP_PP_ENABLED=true` config flag — opt-in for principal propagation
- Graceful fallback — if per-user lookup fails, falls back to shared service account
- No basic auth when PP active — username/password cleared, user identity from SAML assertion only
- 7 unit tests (5 BTP PP destination + 2 HTTP header injection)

**Architecture flow:**
1. User authenticates via XSUAA/OIDC -> JWT token
2. MCP SDK passes `authInfo.token` to tool handler
3. ARC-1 calls Destination Service with `X-User-Token: <jwt>` header
4. Destination Service generates per-user auth tokens (SAML assertion)
5. ADT client sends `SAP-Connectivity-Authentication` header via connectivity proxy
6. Cloud Connector generates X.509 cert -> CERTRULE -> SAP user
7. SAP enforces `S_DEVELOP` authorization per user

**SAP-side setup required (not yet done):**
1. BTP Destination: Change authentication from `BasicAuthentication` to `PrincipalPropagation`
2. Cloud Connector: Synchronize trust with BTP subaccount, set principal type to X.509
3. SAP backend: STRUST (import Cloud Connector CA), CERTRULE, ICM params
4. Subject pattern: Map `${email}` or `${user_name}` to SAP user ID

**References:**
- [SAP Help: Configuring Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configuring-principal-propagation)
- [SAP Cloud SDK: On-Premise Connectivity](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/on-premise)
- [lemaiwo/btp-sap-odata-to-mcp-server](https://github.com/lemaiwo/btp-sap-odata-to-mcp-server) — reference implementation

---

<a id="sec-02"></a>
### SEC-02: BTP Cloud Connector Principal Propagation
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Merged into SEC-01 (2026-03-27) — code complete, SAP-side setup pending |

**Merged:** SEC-02 was implemented as part of SEC-01. The BTP Cloud Connector approach was chosen over direct X.509 cert generation because it leverages existing BTP infrastructure and requires less code in ARC-1. See SEC-01 for implementation details.

---

<a id="sec-03"></a>
### SEC-03: SAP Authorization Object Awareness (S_DEVELOP)
| Field | Value |
|-------|-------|
| **Status** | Completed via FEAT-16 (2026-04-15) |

**Merged:** SEC-03's scope (parsing 403 authorization errors, mapping to S_DEVELOP/S_ADT_RES objects, suggesting SU53/PFCG) is fully implemented as part of FEAT-16 Error Intelligence. FEAT-16 now adds SAP-domain error classification and transaction-aware hints across 403/409/423 + activation/dependency scenarios.

---

<a id="sec-04"></a>
### SEC-04: Audit Logging
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Effort** | M (3-5 days) |
| **Status** | Complete (2026-04-01) — multi-sink audit system with BTP Audit Log Service |

**Implemented:**
- `src/server/audit.ts` — central audit logger with pluggable sinks
- `src/server/sinks/stderr.ts` — stderr sink (default)
- `src/server/sinks/file.ts` — file sink for persistent audit trail
- `src/server/sinks/btp-auditlog.ts` — BTP Audit Log Service sink (enterprise compliance)
- User identity (userName, email, clientId) logged with every tool call
- Elicitation events (confirmations, user choices) logged
- Structured logger with text/JSON output and sensitive field redaction

**References:**
- [OWASP: MCP Server Security - Logging](https://genai.owasp.org/resource/a-practical-guide-for-secure-mcp-server-development/)
- [Datadog: MCP Detection Rules](https://www.datadoghq.com/blog/mcp-detection-rules/)

---

<a id="sec-06"></a>
### SEC-06: MCP Client Tool Restriction by User Role
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Complete via scope enforcement (2026-03-27) |

**Implemented (2026-03-27):**
- `ACTION_POLICY` map in `src/authz/policy.ts` — each tool/action requires a scope
- Scope enforcement in `handleToolCall()` — checks `authInfo.scopes` before executing any tool
- `ListTools` filtering in `src/server/server.ts` — users only see tools they have scopes for
- XSUAA role collections (ARC-1 Viewer/Editor/Admin) map to scopes via `xs-security.json`
- Additive to safety system — both scope check AND safety check must pass
- Backward compatible — no authInfo (stdio, simple API key) = no scope enforcement
- 12 unit tests covering all scope enforcement scenarios

**How it works:**
- `read` scope -> SAPRead, SAPSearch, SAPQuery, SAPNavigate, SAPContext, SAPLint, SAPDiagnose (7 tools)
- `write` scope -> adds SAPWrite, SAPActivate, SAPManage (10 tools)
- `admin` scope -> adds SAPTransport (+ SAPGit when backend is available; up to 12 tools total)
- XSUAA role collections assign scopes to users via BTP cockpit

**Why this matters for basis admins:**
- An SAP developer user (with full S_DEVELOP in Eclipse) can be restricted to read-only via AI
- The admin controls AI capabilities separately from SAP authorization
- **This is unique to ARC-1** — no other MCP server offers scope-based tool filtering

---

<a id="sec-07"></a>
### SEC-07: XSUAA OAuth Proxy for MCP-Native Clients (Claude, Cursor, MCP Inspector)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Complete (2026-03-27) |

**Implemented:**
- MCP SDK's `ProxyOAuthServerProvider` proxies OAuth flow to XSUAA
- `@sap/xssec` v4.13+ for SAP-specific JWT validation (offline, JWKS cached)
- HTTP server refactored from `node:http` to Express 5 (required by MCP SDK auth)
- RFC 8414 discovery at `/.well-known/oauth-authorization-server`
- In-memory client store for dynamic client registration (RFC 7591)
- Chained token verifier: XSUAA -> Entra ID OIDC -> API key (all coexist)
- `xs-security.json` with read/write/admin scopes and 3 role collections
- XSUAA service instance created and bound on BTP CF
- Configuration: `SAP_XSUAA_AUTH=true` enables the proxy

**Files:**
- `src/server/xsuaa.ts` — OAuth provider, client store, chained verifier
- `src/server/http.ts` — Express-based HTTP server with auth routing
- `xs-security.json` — XSUAA service instance config
- `docs/xsuaa-setup.md` — Setup guide

**Reference:** Inspired by [lemaiwo/btp-sap-odata-to-mcp-server](https://github.com/lemaiwo/btp-sap-odata-to-mcp-server).

---

<a id="sec-08"></a>
### SEC-08: OAuth Security Hardening (RFC 9700 Compliance)
| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Status** | Complete (2026-04-08) |

**Implemented (2026-04-08):**

Based on independent security review against RFC 9700 (reports/2026-04-08-001-oauth-security-review-verification.md):

- **F-01 (High):** Added `state` + PKCE (S256) to BTP browser OAuth flow — prevents authorization code injection and login CSRF
- **F-02 (High):** Bound OAuth callback server to `127.0.0.1` — prevents network-adjacent callback interception
- **F-04 (High):** Made `SAP_OIDC_AUDIENCE` mandatory when `SAP_OIDC_ISSUER` is set — prevents cross-service token confusion
- **F-10 (Medium):** HTML-escaped `error_description` in callback + added `Content-Security-Policy: default-src 'none'` headers
- **F-07 (Medium):** Replaced `exec()` with `execFile()` in browser opener — eliminates shell injection surface
- **F-05 (Medium):** Added `revokeToken` override to `XsuaaProxyOAuthProvider` — uses correct XSUAA credentials
- **F-06 (Medium):** Added redirect URI policy, 100-client cap, and 24h TTL to DCR client store. Superseded by stateless DCR (see SEC-09 below) — the cap was removed (no shared memory state to exhaust) and the TTL default raised to 30 days with `--oauth-dcr-ttl-seconds` configuration.
- **F-08 (Low):** Added `requiredClaims: ['exp']` and configurable `SAP_OIDC_CLOCK_TOLERANCE` for JWT validation
- **Config validation:** `ppStrict=true` without `ppEnabled=true` now fails at startup

**Files:**
- `src/adt/oauth.ts` — state, PKCE, loopback binding, HTML escaping, execFile
- `src/server/http.ts` — requiredClaims, clockTolerance
- `src/server/xsuaa.ts` — revokeToken, DCR validation
- `src/server/config.ts` — startup validation (OIDC audience, PP strict)
- `docs/security-guide.md` — NEW consolidated security guide for operators

---

<a id="sec-09"></a>
### SEC-09: Stateless OAuth DCR (Restart-Resilient `client_id`s)
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Complete (2026-05-05, PR #212) |

**Problem:** OAuth Dynamic Client Registration state was held in an in-memory `Map`. Every container restart wiped the registry, and the next request from a cached `client_id` returned `400 invalid_client`. On BTP CF Diego this triggered routinely (`cf restart`, `cf push`, `cf restage`, cell evacuation, OOM auto-recovery, lazy 24h TTL eviction). Affected users had to manually clear their MCP client's local OAuth cache.

**Implemented:**

- Replaced `InMemoryClientStore` with `StatelessDcrClientStore`. Each issued `client_id` is an HMAC-signed token carrying its own registration payload — `getClient()` re-derives state from the signature with no backing store.
- HMAC key is derived (HKDF-style with a `arc1-dcr/v1` domain-separation label) from the existing XSUAA `clientsecret` so any process with the same service binding can validate any `client_id` ever issued. Multi-instance scale-out works for free.
- Default TTL raised from 24h → 30d (matches typical OAuth refresh-token lifetime; eliminates the daily "re-authenticate" UX pain for Copilot users). Configurable via `--oauth-dcr-ttl-seconds` / `ARC1_OAUTH_DCR_TTL_SECONDS`, clamped to `[60s, 90d]`.
- DCR lifecycle now flows through the audit pipeline: `oauth_client_registered`, `oauth_client_lookup_failed` (with `unknown_prefix` / `malformed` / `bad_signature` / `invalid_payload` / `expired` reasons), `oauth_redirect_uri_registered`. Forgery / probing is observable.

**Tradeoffs:**

- Per-client revocation is impossible (only TTL or full key rotation via `cf bind-service`).
- Loose-match for redirect_uri encoding variants (BAS/Cline `?` ↔ `%3F`) is gone — affected clients re-register on encoding mismatch.
- Service-binding rotation invalidates every outstanding DCR `client_id` at once, including in-flight refresh tokens.

**Files:**
- `src/server/stateless-client-store.ts` — NEW signed-token store
- `src/server/xsuaa.ts` — wire-up, removed `InMemoryClientStore`
- `src/server/audit.ts` — three new event types
- `src/server/config.ts`, `src/server/types.ts`, `src/server/http.ts` — `oauthDcrTtlSeconds` config
- `docs_page/xsuaa-setup.md` — Stateless DCR section, service-binding rotation procedure, audit-event reference
- `docs_page/configuration-reference.md` — A4 XSUAA section: `--oauth-dcr-ttl-seconds`

---

<a id="sec-10"></a>
### SEC-10: HTTP Security Headers + Opt-In CORS
| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Complete (2026-05-05) |

**Problem:** The `http-streamable` transport sent no browser security headers and rejected every browser-originated `fetch()` because there was no CORS handling. That left two gaps: (1) when a browser ever reached `/health`, `/mcp`, or an OAuth endpoint, none of the standard hardening (HSTS, CSP, X-Frame-Options, COOP, CORP, …) was in place, and (2) any internal browser UI that wanted to call `/mcp` directly was blocked at the protocol level with no opt-in.

The four shipped MCP clients — Claude Desktop, Cursor, VS Code Copilot, Copilot Studio — are all native HTTP and don't trigger CORS, so for the supported deployment shapes the gap was only theoretical. The change closes it for the future browser-UI case while making sure the native-client default path still works (specifically, OAuth popups depend on a `same-origin-allow-popups` COOP, which helmet's default `same-origin` would have broken).

**Implemented:**

- [helmet](https://helmetjs.github.io/) middleware on every HTTP response — HSTS, CSP, X-Frame-Options, COOP, CORP, X-Content-Type-Options, Referrer-Policy, and the legacy hardening set. Always-on, no flag to disable.
- COOP **disabled** unconditionally (`crossOriginOpenerPolicy: false`). The first attempt set it to `same-origin-allow-popups` thinking that helped OAuth popups, but Microsoft Copilot Studio's connector flow opens `/authorize` in a popup and uses `window.open()` / `postMessage` to receive the redirect — any non-default COOP on `/authorize` (including the lenient `same-origin-allow-popups`) puts the popup in a separate browsing context group, severs the parent's window reference, and surfaces as "consent pop-up window has been closed unexpectedly". Verified live with the BTP test deployment: claude.ai (redirect-flow OAuth) and Cursor (native client) both worked with COOP set; Copilot Studio failed reproducibly. Disabling COOP fixed Copilot Studio without regressing the others. ARC-1 renders no JS UI that would benefit from cross-origin isolation, so the security cost is zero.
- CSP override (when CORS is enabled) uses `useDefaults: true` and only widens `style-src`. Every other directive — `frame-ancestors 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`, … — is preserved.
- Opt-in CORS via `--allowed-origins` / `ARC1_ALLOWED_ORIGINS`. Empty (default) disables CORS entirely. With origins set, exact-match reflection + `credentials: true` + `methods: GET/POST/DELETE/OPTIONS` + `Vary: Origin`.
- New `cors_rejected` audit event fires when a browser request from an unallowed origin reaches the server. Browsers drop the response anyway; this gives a server-side signal for triage.
- `cors` package pinned to exact `2.8.6` (the 2.8.5 → 2.8.6 release closed a 7-year gap; pinned until it stabilizes).
- `applySecurityMiddleware()` extracted from `startHttpServer()` so the helmet/CORS contract is unit-testable via `supertest` without binding ports. New file `tests/unit/server/http-security-headers.test.ts` covers 14 cases (CSP defaults preserved with and without CORS, COOP unconditional, exact-origin reflection, credentials, exposed headers, multi-origin allowlist, audit emission for misses).

**Tradeoffs:**

- HSTS (default `max-age=15552000` + `includeSubDomains`) is durable. Once a browser sees it, the host plus its subdomains are HTTPS-locked for 180 days. Deliberate on BTP CF (apps are HTTPS-only at the gorouter); only a concern for hostnames that might need to serve HTTP later.
- CORS uses `credentials: true`, so wildcards aren't allowed by browser policy. Operators configure exact origins; misconfiguration produces silent browser drops + `cors_rejected` audit events. Documented prominently in the Security Guide.
- Helmet's CSP `script-src 'self'` blocks inline scripts. The MCP SDK's auth router emits only redirects + JSON, so this isn't an issue today; future server-rendered pages would need to either use external scripts or add a nonce.
- One new prod dep (`helmet`, zero deps) and one new pinned prod dep (`cors`, zero deps). Both from established Node maintainers (Evan Hahn, expressjs).

**Files:**
- `src/server/http.ts` — NEW `applySecurityMiddleware()` + middleware wiring
- `src/server/audit.ts` — NEW `cors_rejected` event type
- `src/server/config.ts`, `src/server/types.ts` — `allowedOrigins` config
- `package.json` — `helmet ^8.1.0`, `cors 2.8.6` (pinned), `@types/cors ^2.8.19`
- `tests/unit/server/http-security-headers.test.ts` — NEW 14-test supertest suite
- `docs_page/security-guide.md` — §11 extended with HTTP security headers + CORS subsections, `cors_rejected` added to §9 audit table
- `docs_page/configuration-reference.md` — `--allowed-origins` row in Transport & logging
- `docs_page/phase4-btp-deployment.md` — NEW "Security headers and CORS on BTP" section after Verify Deployment
- `docs_page/xsuaa-setup.md` — "Browser-based DCR clients" sub-section in Stateless DCR
- `README.md`, `CLAUDE.md`, `.env.example`, `manifest.yml`, `manifest-btp-abap.yml`, `mta.yaml` — admin-facing references

**Follow-ups (not in this PR):**

- Per-request rate limiting on `/mcp` (tracked separately in [docs/plans/global-rate-limiting.md](../docs/plans/global-rate-limiting.md)).

---

<a id="sec-11"></a>
### SEC-11: Dependency & Supply-Chain Security — Tier 1 Foundation
| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Complete (2026-05-08) |

**Problem:** Before this work, the repository had no Dependabot, no `npm audit` gate, no GitHub Dependency Review, no SAST in CI for the project itself, no container scanning, and no `SECURITY.md` policy. `npm audit` reported 9 open advisories (2 HIGH, 7 MODERATE) across `path-to-regexp`, `axios` (transitive), `hono`, `@hono/node-server`, `ip-address`, `express-rate-limit`, `fast-xml-parser`, `follow-redirects`, `postcss`. Customers running ARC-1 on regulated landscapes (banks, government, defense) run their own image scanners (Aqua, Prisma Cloud, Microsoft Defender) — vulnerable artifacts get rejected at procurement.

**Implemented (across PRs #227, #229, #234, #235, this PR):**

- **Dependency baseline cleared.** `npm audit fix` + `npm update` resolved all 9 advisories; lockfile rebuilt with 13 in-range packages bumped to latest. `npm audit --audit-level=high` exits 0 today. (PR [#227](https://github.com/marianfoo/arc-1/pull/227))
- **Dependabot config.** `.github/dependabot.yml` — three ecosystems (npm, github-actions, docker), weekly Mondays 06:00 Europe/Berlin, grouping rules (`dev-dependencies`, `types`, `sap-sdk`, `mcp-sdk`, `linting`), ignore rules for `@types/node` major (must match `engines.node`) and Docker `node` major (LTS-only cadence). (PRs [#229](https://github.com/marianfoo/arc-1/pull/229) + [#235](https://github.com/marianfoo/arc-1/pull/235))
- **`npm audit` PR gate.** New step in `.github/workflows/test.yml` runs `npm audit --audit-level=high --omit=optional` after `npm ci`, before `npm run lint`. Audits production AND dev deps — a compromised dev dep can poison the published artifact.
- **GitHub Dependency Review.** New `.github/workflows/dependency-review.yml` runs on every PR, fails on `high`-severity introductions or denied licenses (GPL/AGPL/LGPL deny-list to protect the MIT-licensed npm package).
- **CodeQL SAST.** GitHub Default Setup running JS/TS analysis on every push/PR; findings on the Security tab; `Check runs failure threshold: High or higher` blocks merges with HIGH security alerts.
- **Trivy container scanning.** `.github/workflows/docker.yml` (dev push) runs Trivy non-gating (`exit-code: 0`) and uploads SARIF to the Security tab. `.github/workflows/release.yml` runs Trivy **gating** (`exit-code: 1`) so customers pulling `:vX.Y.Z` get a CVE-clean image.
- **Workflow permissions.** Top-level `permissions: contents: read` on `test.yml`, plus per-job `security-events: write` for SARIF upload paths. Closed 5 of the 12 then-open CodeQL `actions/missing-workflow-permissions` MEDIUM alerts. (PR [#229](https://github.com/marianfoo/arc-1/pull/229))
- **Third-party action SHA pinning.** `googleapis/release-please-action`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`, `aquasecurity/trivy-action` — all pinned to commit SHAs with trailing `# vN` comments so Dependabot bumps SHA + tag together. Mitigates the [`tj-actions/changed-files` 2024 supply-chain compromise](https://blog.gitguardian.com/tj-actions-changed-files-action-was-compromised/) attack class. GitHub-owned `actions/*` and `github/*` are deliberately tag-pinned.
- **`SECURITY.md` policy.** Vulnerability reporting (GitHub Private Vulnerability Reporting + email fallback), severity-tiered response SLAs (3 days ack / 7 days triage / 14 days critical / 30 days high / 60 days moderate), CVE handling (GHSA + CVE via GitHub's CNA), out-of-scope (SAP system bugs route to SAP, upstream-only deps route upstream), Safe Harbor for good-faith research. (PR [#229](https://github.com/marianfoo/arc-1/pull/229))
- **Repo-level GitHub security toggles enabled.** Dependabot alerts + security updates + grouped security updates + version updates + malware alerts; secret scanning + push protection (already on by default for public repos); Private Vulnerability Reporting.

**Tradeoffs:**

- Audit threshold = `high` (not `moderate`). `moderate` produces too much noise from transitive deps for any team that's not monitoring full-time. Critical/HIGH gate; moderate/low surface as warnings on the Security tab.
- Trivy non-gating on dev pushes, gating on releases. Dev iteration shouldn't be blocked by a HIGH CVE in a Node base image that we can't fix until upstream rebuilds; releases need to be CVE-clean before customers pull them.
- Third-party SHA pinning only — `actions/*` and `github/*` stay tag-pinned. They publish from a trusted GitHub-owned org with signed releases; pinning them too generates churn without commensurate security gain.
- CodeQL stays on Default Setup, not Advanced. Default Setup auto-manages the workflow file and bumps queries; Advanced gives more control (`security-extended,security-and-quality` query suite, path-ignore for tests/dist) but has more upkeep. Re-evaluate if the false-positive rate on Default proves untenable.

**Files:**
- `.github/dependabot.yml` — three ecosystems + grouping + ignore rules (PRs [#229](https://github.com/marianfoo/arc-1/pull/229), [#235](https://github.com/marianfoo/arc-1/pull/235))
- `.github/workflows/test.yml` — `Security audit (npm audit)` step + top-level `permissions:`
- `.github/workflows/dependency-review.yml` — NEW PR-time dependency review
- `.github/workflows/docker.yml` — Trivy non-gating + SHA-pinned `docker/*` + `aquasecurity/trivy-action`
- `.github/workflows/release.yml` — Trivy gating + SHA-pinned `googleapis/release-please-action` + `docker/*` + `aquasecurity/trivy-action`
- `SECURITY.md` — NEW vulnerability reporting policy (PR [#229](https://github.com/marianfoo/arc-1/pull/229))
- `package-lock.json` — 9 advisories cleared + 13 in-range bumps (PR [#227](https://github.com/marianfoo/arc-1/pull/227))
- `biome.json` — `$schema` URL bumped to match `@biomejs/biome` 2.4.14 (PR [#227](https://github.com/marianfoo/arc-1/pull/227))
- `docs_page/security-guide.md` — NEW §13 "Dependency & Supply-Chain Security"
- `compare/00-feature-matrix.md` — NEW §4.1 "Supply-Chain Security" comparison
- `README.md` — CodeQL + Test + Dependency Review badges; supply-chain security bullet
- `CLAUDE.md` — Key Files rows for Dependabot config / audit & SAST gates / container scanning / action pinning / `SECURITY.md`

**Follow-ups (not in this PR):**

- Tier 2: CycloneDX SBOM (npm + image), Cosign keyless image signing, OpenSSF Scorecard. Plan in [docs/plans/dependency-security-tier2-attestation.md](../docs/plans/dependency-security-tier2-attestation.md).
- Tier 3: Socket.dev PR review, internal vulnerability triage runbook, formal non-adoption decisions for Renovate / Snyk / SLSA L3. Plan in [docs/plans/dependency-security-tier3-defense.md](../docs/plans/dependency-security-tier3-defense.md).
- 7 remaining HIGH CodeQL alerts (clear-text logging FPs in `src/cli.ts`, double-escaping in `src/adt/diagnostics.ts` + `src/adt/xml-parser.ts`, incomplete sanitization in `src/adt/diagnostics.ts`, missing rate-limiting on `/authorize` — the last maps to roadmap [SEC-05](#sec-05)). Triage in separate PRs.

---

<a id="feat-01"></a>
### FEAT-01: Where-Used Analysis (Usage References)
| Field | Value |
|-------|-------|
| **Status** | Complete (2026-04-04, PR #38) |

**Implemented:** Scope-based where-used analysis in SAPNavigate. Uses ADT endpoint `/sap/bc/adt/repository/informationsystem/usageReferences`. Supports filtering by scope (local, package, system-wide).

**References:**
- [Report 001: Feature Parity](../docs/reports/2026-03-24-001-feature-parity-implementation.md) — Item #1

---

<a id="feat-04"></a>
### FEAT-04: DDIC Object Support (Domains, Data Elements, DDLX)
| Field | Value |
|-------|-------|
| **Status** | Complete (2026-04-01) |

**Implemented:** Read support for domains (DOMA), data elements (DTEL), DDIC structures (TABL — covers transparent tables AND structures, mirroring TADIR R3TR TABL and abapGit conventions), CDS metadata extensions (DDLX), and transactions (TRAN) in SAPRead. Structured metadata output with type info, labels, value tables, search help. Write support for DDLS, DDLX, BDEF, SRVD via SAPWrite (plus DOMA/DTEL metadata writes completed under FEAT-13).

**STRU/TABL collapse (Model B, 2026-05-07):** The previously separate `STRU` short type was collapsed into `TABL` to match SAP file-format conventions. ARC-1 auto-resolves the URL via fallback (`/tables/{name}` → `/structures/{name}` on 404). See [docs/plans/completed/collapse-stru-into-tabl.md](https://github.com/marianfoo/arc-1/blob/main/docs/plans/completed/collapse-stru-into-tabl.md).

---

<a id="feat-35"></a>
### FEAT-35: Class Hierarchy (SAPNavigate)
| Field | Value |
|-------|-------|
| **Status** | Complete |
| **Source** | [ADT API Audit](https://github.com/marianfoo/arc-1/blob/main/docs/research/complete/adt-api-audit-documentation-and-unused.md) |

**What:** Added `hierarchy` action to SAPNavigate. Returns superclass, implemented interfaces, and subclasses for a given ABAP class. Implemented via SQL queries against SEOMETAREL table (the ADT `/hierarchy` endpoint returned 404 on the test system). Includes SQL injection prevention via regex whitelist on class names.

---

<a id="ops-01"></a>
### OPS-01: Structured JSON Logging
| Field | Value |
|-------|-------|
| **Status** | Complete — `src/server/logger.ts` + `src/server/audit.ts` with multi-sink output |

**Implemented:** Structured logger with text/JSON output, sensitive field redaction. Multi-sink audit system (stderr, file, BTP Audit Log Service). User identity from OIDC JWT in all log entries.

---

<a id="ops-04"></a>
### OPS-04: GitHub Actions CI/CD Pipeline
| Field | Value |
|-------|-------|
| **Status** | Complete |

**Implemented:**
- `.github/workflows/test.yml` — lint + typecheck + unit tests (Node 22/24) on every push/PR, integration + E2E on `main` and internal PRs, plus reliability-summary aggregation
- `.github/workflows/docker.yml` — multi-platform Docker build (amd64/arm64) to GHCR on tags + manual dispatch
- `.github/workflows/release.yml` — npm publish with provenance on version tags

---

<a id="clean-01"></a>
### CLEAN-01: Go Code Removal
| Field | Value |
|-------|-------|
| **Status** | Complete — all Go source removed (cmd/, internal/, pkg/, go.mod, go.sum, Makefile) |

---

<a id="clean-02"></a>
### CLEAN-02: CLI Surface
| Field | Value |
|-------|-------|
| **Status** | Complete — minimal CLI: `arc1 search`, `arc1 source`, `arc1 lint`, `arc1 serve` |

---

<a id="strat-01"></a>
### STRAT-01: TypeScript Migration
| Field | Value |
|-------|-------|
| **Status** | Complete (2026-03-26) |

**What was done:**
- Full Go -> TypeScript migration in a single session
- Custom ADT HTTP client (axios-based, CSRF lifecycle, cookie persistence, session isolation)
- 12 intent-based tools ported with identical behavior (including feature-gated `SAPGit`)
- Safety system ported (read-only, package filter, operation filter, transport guard)
- HTTP Streamable transport with per-request server isolation (Copilot Studio compatible)
- API key + OIDC/JWT authentication (jose library)
- BTP Destination Service integration (VCAP_SERVICES parsing, destination lookup, connectivity proxy)
- `@abaplint/core` integration (replaces custom Go ABAP lexer with full abaplint rules)
- `better-sqlite3` + in-memory cache (replaces Go CGO/SQLite)
- 320 unit tests + 28 integration tests (vitest)
- CI/CD: lint + typecheck + tests (Node 22/24), integration + E2E reliability telemetry, Docker multi-arch, npm publish
- Go source code removed (47K lines deleted)

**Migration report:** See `reports/2026-03-26-001-typescript-migration-plan.md`

---

## Current State (v0.5.0 — TypeScript)

| Area | Status |
|------|--------|
| TypeScript Migration | Complete — Go code removed, pure TypeScript |
| Core MCP Server | 12 intent-based tools + hyperfocused mode (1 tool), HTTP Streamable + stdio |
| Safety System | Positive opt-in gates (`allowWrites`, SQL/data/transport/Git), package filter (default: `$TMP`), deny-actions |
| Input Validation | Zod v4 runtime validation for all MCP tool inputs (v0.5.0) |
| Phase 1: API Key Auth | `ARC1_API_KEYS` Bearer tokens with profiles |
| Phase 2: OAuth/OIDC (Entra ID) | JWT validation via `jose` library, tested with Copilot Studio |
| Phase 4: BTP CF Deployment | Docker on CF with Destination Service + Cloud Connector |
| BTP Destination Service | Auto-resolves SAP credentials from BTP Destination at startup |
| BTP Connectivity Proxy | Routes through Cloud Connector with JWT Proxy-Authorization |
| BTP ABAP Environment | OAuth 2.0 browser login, direct connectivity |
| ABAP Linter | `@abaplint/core` with system-aware cloud/on-prem presets + pre-write validation |
| Docker Image | Multi-platform (amd64/arm64), GHCR `ghcr.io/marianfoo/arc-1` |
| CI/CD | GitHub Actions: lint + typecheck + unit tests (Node 22/24), integration + E2E on `main`/internal PRs, reliability summary job |
| XSUAA OAuth Proxy | MCP SDK ProxyOAuthServerProvider + @sap/xssec JWT validation |
| Authorization Model | Two-dimensional: scopes (read/write/admin) x roles (viewer/developer) x safety config |
| Audit Logging | User identity in tool call logs, BTP Audit Log sink, file sink |
| MCP Elicitation | Interactive parameter collection for destructive ops |
| Dynamic Client Registration | /register endpoint for MCP clients (RFC 7591) |
| Principal Propagation | Per-user ADT client via BTP Destination Service + Cloud Connector |
| OAuth Security | RFC 9700 compliance: state+PKCE, loopback binding, audience validation (v0.5.0) |
| Hyperfocused Mode | Single `SAP` tool (~200 tokens) — competitive parity with VSP |
| Method-Level Surgery | `edit_method` in SAPWrite, `list_methods`/`get_method` in SAPContext (95% token reduction) |
| Runtime Diagnostics | SAPDiagnose — short dumps (ST22), ABAP profiler traces |
| DDIC Completeness | Structures, domains, data elements, DDLX, transactions, BOR objects, T100 messages |
| RAP CRUD | DDLS, DDLX, BDEF, SRVD, SRVB write |
| Context Compression | SAPContext with AST-based dependency extraction (7-30x reduction) |
| Where-Used Analysis | Scope-based where-used in SAPNavigate (#38) |
| Class Hierarchy | SAPNavigate hierarchy action via SEOMETAREL SQL |
| Object Caching | SQLite + memory cache with on-demand + pre-warmer support (#31) |
| LLM Search UX | Auto-transliteration, field-name hints, cache indicators |
| HTTP Client | Native fetch + undici (replaced axios) (#35) |
| Test Coverage | 1,300+ unit + ~150 integration + ~60 E2E + 28 BTP integration + 5 BTP smoke tests (vitest); coverage telemetry is informational |
| Documentation | Architecture, auth guides, Docker guide, setup phases, security guide, RAP/common-use-case workflow skills |

---

## Previously Completed (Summary)

| Phase | Description | Status |
|-------|-------------|--------|
| Go v1.x-v2.32 | ADT client, 40+ tools, CRUD, debugging, WebSocket, Lua scripting | Complete (Go) |
| Enterprise Rename | vsp -> ARC-1, intent-based tool architecture (now 12 tools) | Complete |
| Auth Phase 1: API Key | `ARC1_API_KEYS` Bearer tokens with profiles | Complete |
| Auth Phase 2: OAuth/OIDC | Entra ID JWT validation via `jose` library | Complete |
| Auth Phase 4: BTP CF | Docker on CF with Destination Service + Cloud Connector | Complete |
| TypeScript Migration | Full Go -> TypeScript port, Go code removed | Complete (2026-03-26) |
| CI/CD Pipeline | GitHub Actions: lint, typecheck, tests (Node 22/24), integration + E2E on main/internal PRs, Docker, npm publish | Complete |
| Copilot Studio E2E | OAuth + MCP + BTP Destination + Cloud Connector -> SAP data | Complete |
| XSUAA OAuth Proxy | SEC-07: MCP SDK auth + @sap/xssec, Express 5, 3 auth modes coexist | Complete (2026-03-27) |
| Scope Enforcement | SEC-06: Per-tool scope checks, ListTools filtering, 12 tests | Complete (2026-03-27) |
| Audit Logging | SEC-04: Multi-sink audit (stderr, file, BTP Audit Log Service) | Complete (2026-04-01) |
| Dynamic Client Registration | RFC 7591 /register endpoint for MCP clients | Complete (2026-03-27) |
| Principal Propagation | SEC-01+SEC-02: Per-user ADT client via BTP Dest Service + Cloud Connector | Code complete (2026-03-27) |
| Hyperfocused Mode | Single `SAP` tool (~200 tokens) — competitive parity with VSP | Complete (2026-04-01) |
| Method-Level Surgery | `edit_method`, `list_methods`, `get_method` — 95% token reduction | Complete (2026-04-01) |
| Runtime Diagnostics | SAPDiagnose — short dumps (ST22), ABAP profiler traces | Complete (2026-04-01) |
| DDIC Completeness | FEAT-04: DOMA, DTEL, DDLX, TRAN, BOR, T100, variants (TABL covers transparent tables and DDIC structures since Model B) | Complete (2026-04-01) |
| DDIC Domain/Data Element Write | FEAT-13: DOMA/DTEL create, update, delete, batch_create in SAPWrite | Complete (2026-04-12) |
| RAP CRUD | DDLS/DDLX/BDEF/SRVD/SRVB write, batch activation | Complete (2026-04-14) |
| Context Compression | SAPContext with AST-based dependency extraction (7-30x reduction) | Complete (2026-04-01) |
| MCP Elicitation | Interactive confirmations for destructive operations | Complete (2026-04-01) |
| BTP ABAP Environment | OAuth 2.0 browser login, direct BTP connectivity | Complete (2026-04-01) |
| Where-Used Analysis | FEAT-01: Scope-based where-used in SAPNavigate | Complete (2026-04-04, PR #38) |
| Enhanced Abaplint | System-aware cloud/on-prem presets, pre-write validation, auto-fix | Complete (2026-04-04, PR #37) |
| Object Caching | SQLite + memory cache with on-demand + pre-warmer support | Complete (2026-04-04, PR #31) |
| HTTP Client Migration | Replaced axios with native fetch + undici | Complete (2026-04-04, PR #35) |
| Two-Dimensional Auth | Scopes x roles x safety config, SEC-06 expanded | Complete (2026-04-07, PR #48) |
| Zod v4 Validation | Runtime input validation for all MCP tool inputs | Complete (2026-04-08, PR #52) |
| OAuth Security (RFC 9700) | SEC-08: state+PKCE, loopback binding, audience validation | Complete (2026-04-08, PR #51) |
| AFF Structured Class Read | `SAPRead(format="structured")` — JSON with metadata + decomposed includes | Complete (2026-04-08) |
| AFF Batch Object Creation | `SAPWrite(action="batch_create")` — multi-object create+activate in one call | Complete (2026-04-08) |
| AFF Schema Validation | Bundled AFF JSON schemas, pre-create metadata validation | Complete (2026-04-08) |

---

## Competitive Landscape

> **Detailed tracking**: See [`compare/`](../compare/) for per-commit and per-issue evaluations of key competitors.

| Competitor | Language | Tools | Auth | Safety | Deployment | Key Advantage |
|-----------|---------|-------|------|--------|------------|---------------|
| **ARC-1** | TypeScript | 12 intent-based + hyperfocused | API Key, OIDC, XSUAA, PP | Read-only, pkg filter, deny actions, 3-layer auth (server ceiling + user scopes + SAP auth) | Docker, BTP CF, npm | Per-user PP, scope-based tools, 3 auth modes, safety, 1,500+ tests across unit/integration/E2E |
| **vibing-steampunk** | Go 1.24 | 1-99+ (3 modes) | Basic, Cookie | Op filter, pkg filter, transport guard | Go binary (9 platforms) | 279 stars, **Streamable HTTP (v2.38.0)**, native parser, massive feature sprint (i18n, gCTS, API release state, version history, code coverage) |
| **fr0ster/mcp-abap-adt** | TypeScript | ~320 (4 tiers) | 9 providers (incl. TLS, SAML, Device Flow) | Exposition tiers | npm `@mcp-abap-adt/core` | Most tools, most auth options, embeddable, RFC, multi-system |
| SAP ABAP Add-on MCP | ABAP | ~10 | SAP native | SAP authorization | Runs inside SAP | No proxy needed, SAP-native auth |
| lemaiwo/btp-sap-odata-to-mcp-server | TypeScript | ~10 | XSUAA OAuth proxy | XSUAA roles | BTP CF (MTA) | XSUAA OAuth proxy, principal propagation |
| dassian-adt / abap-mcpb | JavaScript | 25+ | Basic, Browser login | MCP elicitation | Node.js / MCPB | Error intelligence, batch activation, find_definition, edit_method (Apr sprint) |
| AWS ABAP Accelerator | Python | ~15 | OAuth, X.509 | Basic | AWS Lambda | Cloud readiness assessment, migration |

**ARC-1 differentiators (no other project has all of these):**
1. **Intent-based routing** — 12 tools vs 25-287, simplest LLM decision surface
2. **Principal propagation** — per-user SAP authentication via BTP Destination Service + Cloud Connector
3. **Two-dimensional authorization** — scopes (read/write/admin) x roles x safety config, with per-tool filtering
4. **Three auth modes coexist** — XSUAA OAuth + Entra ID OIDC + API key on the same endpoint
5. **Comprehensive safety system** — read-only, package filter, operation filter, transport guard, dry-run — additive to scopes
6. **Multi-sink audit logging** — stderr + file + BTP Audit Log Service
7. **Context compression + method-level surgery** — AST-based 7-30x + 95% method-level reduction
8. **MCP elicitation** — interactive confirmations for destructive operations
9. **1,500+ automated tests** with CI on Node 22/24, integration/E2E reliability telemetry, and BTP smoke lane
10. **First-party workflow skills** — researched RAP/common-use-case playbooks that exploit provider-contract guidance, impact/history/context tools, formatter alignment, SKTD docs, and Git context
11. **npm + Docker + release-please** — most professional distribution pipeline
12. **RFC 9700 OAuth security** — state + PKCE, loopback binding, audience validation

**Key competitive threats** (tracked in [`compare/`](../compare/)):
1. **vibing-steampunk** (279 stars) — community favorite. **Major threat escalation (Apr 2026)**: massive sprint added Streamable HTTP, API release state, i18n (7 tools), gCTS (10 tools), version history, code coverage, health analysis, rename preview, dead code analysis, CDS impact, and recovery primitives. ARC-1 has now closed the prioritized gCTS/abapGit gap via FEAT-22, but VSP remains strong on breadth and release velocity.
2. **fr0ster** (v6.1.0, 100+ releases, 35 stars) — closest enterprise competitor. 9 auth providers, TLS, RFC, embeddable, and broad operational breadth. Watch for convergence on enterprise features.
3. **dassian-adt / abap-mcpb** (33 stars, 53 tools) — fast April sprint added OAuth/XSUAA, multi-system support, more transport tooling, trace flows, and test/include helpers. No safety system is still a major gap, but the pace is notable.
4. **btp-odata-mcp** (120 stars) — different category (OData) but high adoption. Could expand into ADT territory.

---

## Key References

### Internal Reports
- [Enterprise Copilot Studio Plan](../docs/reports/2026-03-23-001-enterprise-copilot-studio-plan.md)
- [Feature Parity Analysis](../docs/reports/2026-03-24-001-feature-parity-implementation.md)
- [Enterprise Bridge Gap Analysis](../docs/reports/2026-03-24-002-enterprise-bridge-gap-analysis.md)
- [Enterprise Auth Research](../docs/reports/2026-03-25-001-enterprise-auth-research.md)
- [Centralized Auth Architecture](../docs/reports/2026-03-25-003-centralized-mcp-auth-architecture.md)
- [BTP Deployment Report](../docs/reports/2026-03-25-001-btp-copilot-studio-deployment.md)

### External References & Implementations
- [lemaiwo/btp-sap-odata-to-mcp-server](https://github.com/lemaiwo/btp-sap-odata-to-mcp-server) — TypeScript MCP server with XSUAA OAuth proxy, BTP Destination Service, principal propagation
- [MCP Specification — Authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [RFC 9728 — OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [OWASP Secure MCP Server Development Guide](https://genai.owasp.org/resource/a-practical-guide-for-secure-mcp-server-development/)
- [SAP Help: Principal Propagation](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configuring-principal-propagation)
- [SAP Help: S_DEVELOP Authorization Object](https://help.sap.com/docs/SAP_Solution_Manager/fd3c83ed48684640a18ac05c8ae4d016/4fa00d670cff44a5958237334a88af84.html)
- [Microsoft: Copilot Studio Custom Connectors](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors)

---

*This roadmap is a living document. Priorities may shift based on community feedback and enterprise requirements.*
