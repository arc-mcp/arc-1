# ARC-1 Skills

Best-practice agent skills for common SAP development workflows with ARC-1.

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter — the format used by [Anthropic Agent Skills](https://code.claude.com/docs/en/skills) and consumed by the [`vercel-labs/skills`](https://github.com/vercel-labs/skills) CLI. Agents discover them by `description` and load them on demand.

> **CAP-side audit toolkit lives in a separate repo.** For audit / hardening / CI gates of CAP + Fiori Elements V4 + BTP applications consuming S/4HANA Tier-2 services, see [`Raistlin82/sap-cap-toolkit`](https://github.com/Raistlin82/sap-cap-toolkit) (8 skills: `sap-cap-clean-core-enforce`, `sap-cap-customizing-honor`, `sap-cap-security-rbac-matrix`, `sap-fiori-app-audit`, `sap-cap-text-polish`, `sap-cap-stack-audit-full`, `sap-cap-ci-gates-pattern`, `sap-cap-fiori-battle-tested-patterns`). The skills in `arc-1` focus on ABAP-side custom-code refactoring (`sap-erp-clean-core-refactor` + `modernize-abap-*` chain); they generate CAP code that the audit toolkit in the companion repo verifies.

## Install via the `skills` CLI (recommended)

The fastest way is `npx skills` — it auto-detects the agents installed in your project (Claude Code, Cursor, GitHub Copilot, OpenCode, Gemini CLI, Codex, …) and installs into the right paths.

```bash
# Install all ARC-1 skills into the current project
npx skills add marianfoo/arc-1

# Install globally (available in every project)
npx skills add marianfoo/arc-1 -g

# Install just one skill
npx skills add marianfoo/arc-1 -s generate-rap-service

# Pin to a release tag
npx skills add marianfoo/arc-1#v1.0.0
```

See the [`skills` CLI docs](https://github.com/vercel-labs/skills#readme) for `update`, `remove`, project-pinned lockfiles, and the full agent compatibility matrix.

## Manual install (without the CLI)

Copy the whole `skills/<skill-name>/` directory into your tool's skills directory. The agent reads `SKILL.md` and discovers the skill via its frontmatter `description`.

| Tool | Project install | Global install |
|---|---|---|
| Claude Code | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` |
| Cursor | `.agents/skills/<name>/` | `~/.cursor/skills/<name>/` |
| GitHub Copilot (VS Code) | `.agents/skills/<name>/` | `~/.copilot/skills/<name>/` |
| OpenAI Codex (CLI) | `.agents/skills/<name>/` | `~/.codex/skills/<name>/` |
| Gemini CLI | `.agents/skills/<name>/` | `~/.gemini/skills/<name>/` |
| OpenCode | `.agents/skills/<name>/` | `~/.config/opencode/skills/<name>/` |

Example for Claude Code (project scope):

```bash
git clone https://github.com/marianfoo/arc-1.git /tmp/arc-1
mkdir -p .claude/skills
cp -r /tmp/arc-1/skills/generate-rap-service .claude/skills/
```

For tools not listed above, copy the body of `SKILL.md` into your tool's system prompt, custom instructions, or project context file. The skills are self-contained — they work anywhere you can provide custom instructions.

## Prerequisites

These skills assume you have:
1. **ARC-1 MCP server** connected and configured (SAP system access). Required for every skill that touches ABAP.
2. **mcp-sap-docs MCP server** connected (optional but recommended — provides SAP documentation context). Used by most skills; required for the UI5 modernization skills to look up V4 binding patterns and FCL behaviour.
3. **SAPUI5 MCP server** (`@ui5/mcp-server`). Required for `modernize-ui5-app` and `convert-ui5-to-fiori-elements` — provides the authoritative TypeScript conversion guidelines, project scaffolding, ui5-linter, and manifest validation.
4. **Fiori MCP server** (`@sap-ux/fiori-mcp-server`). Required for `convert-ui5-to-fiori-elements` only — provides the LROP scaffold + annotation-aware page-template configuration.
5. **A browser MCP** — `Claude_in_Chrome` or `Claude_Preview`. Used by `modernize-ui5-app` for the final render verification step (HTTP 200 alone is not a sufficient acceptance gate — see the "blank page" traps in the skill).

## Available Skills

### Creating & Generating

| Skill | What it does | When to use |
|---|---|---|
| [generate-rap-service](generate-rap-service/SKILL.md) | Creates a complete RAP OData service stack (table, CDS views, BDEF, SRVD, SRVB, class) from a natural language description, with provider-contract-aware service generation | Quick prototyping, simple CRUD, standard UI service generation |
| [generate-rap-service-researched](generate-rap-service-researched/SKILL.md) | Same output as above, but researches the target system first (existing naming conventions, architecture patterns, revisions, docs, formatter settings, impact) and builds an approved plan before creating anything | Production-quality services in transportable packages, complex domains, "measure twice, cut once" mode |
| [generate-rap-logic](generate-rap-logic/SKILL.md) | Implements determination and validation methods in an existing RAP behavior pool using structured class reads, version-aware edits, and quickfix-aware validation | After creating a RAP service — fills in the empty method stubs with ABAP Cloud logic |
| [generate-cds-unit-test](generate-cds-unit-test/SKILL.md) | Generates ABAP Unit tests for CDS entities using the CDS Test Double Framework | When a CDS view has calculations, CASE expressions, WHERE filters, JOINs, or aggregations worth testing |
| [generate-abap-unit-test](generate-abap-unit-test/SKILL.md) | Generates ABAP Unit tests for classes with dependency analysis and test doubles | When a class has non-trivial business logic and uses dependency injection |
| [generate-analytics-star-schema](generate-analytics-star-schema/SKILL.md) | Generates a CDS analytical model — cube + dimension + text views — on top of a RAP business object or DDIC table, written in one `batch_create` + `activateAtEnd` pass | Building embedded-analytics foundations; making a transactional model analytical (SAP Joule "CDS Analytical Model Generation" parity) |
| [generate-cds-analytical-query](generate-cds-analytical-query/SKILL.md) | Generates an analytical query (transient `provider contract analytical_query` projection view) on top of an existing analytical cube | Exposing a cube as a consumable KPI query for SAP Analytics Cloud / Analysis for Office / embedded analytics (SAP Joule "CDS Analytical Query Generation" parity) |

#### generate-analytics-star-schema → generate-cds-analytical-query

These two chain. The star-schema skill builds the **model** (cube + dimensions + texts); the analytical-query skill projects the consumable **query** on top of the cube. Run star-schema first when no cube exists yet, then the query skill. The model layer requires the analytics annotations (7.5x); the query layer requires `provider contract analytical_query` (SAP_BASIS 7.57+).

#### generate-rap-service vs generate-rap-service-researched

Both skills produce the same RAP artifact stack. The difference is how they get there:

| | generate-rap-service | generate-rap-service-researched |
|---|---|---|
| **Approach** | "Vibe code" — starts creating immediately | "Measure twice, cut once" — researches first |
| **Research** | None — uses SAP standard defaults | Deep — reads existing RAP projects, naming conventions, ATC config |
| **Questions** | Minimal — just the business object description | Targeted — asks only what research couldn't answer |
| **Plan approval** | Shows artifact table, asks to proceed | Full implementation plan with architecture decisions, requires explicit approval |
| **Best for** | Quick prototyping, proof of concept, simple CRUD | Production services, complex domains, teams with established conventions |
| **Guardrails** | Managed only, UUID, single entity, standard CRUD | Any scenario — managed/unmanaged, compositions, custom keys |

### Recent ARC-1 Features These Skills Use

- `SAPContext(action="impact")` for RAP/CDS reuse and "what breaks if I change this?" analysis
- `SAPDiagnose(action="cds_testcases")` for SAP-native CDS test-case discovery (CDS Test Double Framework) — powers `generate-cds-unit-test` Step 2 on SAP_BASIS 8.16+ (ABAP Platform 2025), returning per-semantic `testMethod`/`semanticType`/`calculatedField` suggestions; falls back to manual DDL semantic analysis on older releases (ARC-1 PR #351)
- `SAPRead(type="VERSIONS")` and `SAPRead(type="VERSION_SOURCE")` for pattern mining and safer edits of existing RAP stacks
- `SAPSearch(searchType="tadir_lookup", source="both")` for one-shot existence checks against both released and inactive variants, with a `splitBrain` warning when an object exists only in one source — used by `migrate-segw-to-rap` Phase 6a (ARC-1 v0.9.5+ / PR #270)
- `SAPWrite(action="batch_create", activateAtEnd: true)` for atomic CDS-composition activation — replaces per-file + manual terminal activation in `migrate-segw-to-rap` Step 2 (ARC-1 v0.9.5+ / PR #270)
- `SAPTransport(action="history")` for object-to-transport traceability during later iterations
- `SAPLint(action="format" | "get_formatter_settings")` for SAP-native keyword case and indentation
- `SAPRead` / `SAPWrite` for `SKTD` so generated RAP services can carry attached Markdown documentation
- `SAPGit` when a package is already part of an abapGit or gCTS-backed delivery flow

### Analyzing & Understanding

| Skill | What it does | When to use |
|---|---|---|
| [explain-abap-code](explain-abap-code/SKILL.md) | Reads an ABAP object, fetches all dependencies via SAPContext, and produces a structured explanation — including behavior definitions (BDEF: parses `implementation in class`, reads the behavior pool CCIMP handlers, runs SAPContext impact on the bound CDS root) | Onboarding to unfamiliar code, investigating bugs, documenting undocumented objects, understanding a RAP behavior (SAP Joule "AI Explain for Behavior Definitions" parity) |
| [migrate-custom-code](migrate-custom-code/SKILL.md) | Runs ATC readiness checks, groups findings by priority, and generates replacement code | Preparing custom code for S/4HANA migration or ABAP Cloud readiness |
| [sap-object-documenter](sap-object-documenter/SKILL.md) | Batch-documents many custom objects at once — purpose, style (Classic/Modern/Mixed), dependencies — as Markdown | Onboarding packages, handoffs, seeding a repo wiki (vs. explain-abap-code which is single-object interactive) |

### SAP ERP — Clean Core Return + Side-by-Side Refactor (Preview)

Plans and executes the refactor of custom ABAP / ERP / S/4HANA code back to Clean Core compliance — discovery via ARC-1, classification via `sap-clean-core-atc`, **just-in-time documentation lookup** against authoritative SAP sources (no pre-crawled KB), and hand-off to `modernize-abap-to-btp-cap` for side-by-side extension scaffolds.

| Skill | What it does | When to use |
|---|---|---|
| [sap-erp-clean-core-refactor](sap-erp-clean-core-refactor/SKILL.md) | Inventories Z/Y custom code via ARC-1, classifies Clean Core Level A/B/C/D, consults authoritative SAP sources just-in-time (git-clone of `abap-atc-cr-cv-s4hc` + curated `SAP-samples` + `cloud-sdk`; Apify on-demand for `api.sap.com` / `help.sap.com` / `developers.sap.com` / `cap.cloud.sap` / community / blogs), and emits a per-object refactor plan with rewrite-in-place / extract-to-side-by-side / keep-at-B decisions. Apify lookups bounded per finding (~5 pages); user pays for own Apify account; results cached locally for 30 days | Planning a Clean Core compliance program; pre / post-S/4HANA migration cleanup; quarterly governance review |

The skill ships **four files** so it is fully self-contained: [`SKILL.md`](sap-erp-clean-core-refactor/SKILL.md) (the protocol), [`SOURCES.md`](sap-erp-clean-core-refactor/SOURCES.md) (curated catalog of 23 authoritative SAP sources organized in 4 tiers), [`PATTERNS.md`](sap-erp-clean-core-refactor/PATTERNS.md) (~70 battle-tested production patterns in 8 categories — consulted during target resolution and side-by-side scaffold), and [`INTEGRATIONS.md`](sap-erp-clean-core-refactor/INTEGRATIONS.md) (step-by-step mapping of refactor phase × ARC-1 MCP tool × arc-1 skill × [secondsky/sap-skills](https://github.com/secondsky/sap-skills) plugin × external sources). **No centralized KB is shipped**; documentation lookups happen on-demand within a bounded per-finding budget, charged to the user's own Apify account at ~€0.005-0.02 per lookup (typical refactor: €0.50-€5 total).

**Required companion plugins** (the skill is materially less useful without them — all four enforced as MUST in [`INTEGRATIONS.md`](sap-erp-clean-core-refactor/INTEGRATIONS.md)):
- **`sap-abap`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-abap)) — ABAP language patterns reference, required during Step 6a `rewrite_in_place` so generated ABAP is Cloud-compatible.
- **`sap-abap-cds`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-abap-cds)) — CDS view design reference, required when rewrite introduces new CDS views.
- **`sap-cap-capire`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-cap-capire)) — CAP framework, ships 4 dispatchable agents (`cap-cds-modeler`, `cap-service-developer`, `cap-performance-debugger`, `cap-project-architect`) invoked during Step 6b side-by-side scaffold.
- **`sap-btp-developer-guide`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-btp-developer-guide)) — comprehensive BTP reference, required during target resolution and scaffold generation.

The skill engages **all 12 ARC-1 MCP tools** (`SAPRead` source + VERSIONS, `SAPWrite` in-place rewrite, `SAPContext` impact analysis — the most important call, `SAPLint` ATC + formatting, `SAPDiagnose` unit tests, `SAPTransport`, …) and **9 arc-1 native skills** as a delegation chain (`bootstrap-system-context`, `setup-abap-mirror`, `sap-clean-core-atc`, `sap-unused-code`, `explain-abap-code`, `sap-object-documenter`, `generate-abap-unit-test`, `generate-cds-unit-test`, `generate-rap-logic`, `modernize-abap-to-btp-cap` chain, `convert-ui5-to-fiori-elements`, `analyze-chat-session`). See [`INTEGRATIONS.md`](sap-erp-clean-core-refactor/INTEGRATIONS.md) for the full coverage table.

### Clean Core & Custom Code Retirement

| Skill | What it does | When to use |
|---|---|---|
| [sap-clean-core-atc](sap-clean-core-atc/SKILL.md) | Audits a package of custom code and buckets every Z/Y object into Clean Core Levels A–D using mcp-sap-docs + ATC | Planning an ECC→S/4HANA Cloud or BTP move; quarterly custom-code health check |
| [sap-unused-code](sap-unused-code/SKILL.md) | Finds Z/Y objects never called at runtime using SCMON or SUSG, then cross-references static where-used | Scoping a custom-code retirement project; pre-migration dead-code cleanup (requires `SAP_ALLOW_FREE_SQL=true` + `S_TABU_NAM` on `SCMON_*`/`SUSG_*`) |

### Legacy Migration (Backend + UI)

End-to-end conversion of legacy SAP stacks. `migrate-segw-to-rap` handles the OData V2 → RAP V4 backend; then **one of** the two UI skills runs in parallel against the new V4 service. Pick the UI path based on whether the target architecture is annotation-driven (Fiori Elements) or custom-controls freestyle (UI5 TypeScript).

| Skill | What it does | When to use |
|---|---|---|
| [migrate-segw-to-rap](migrate-segw-to-rap/SKILL.md) | Reverse-engineers a SEGW-built OData V2 service (MPC/DPC/MPC_EXT/DPC_EXT) into a modern RAP V4 service: tables, CDS views (interface + projection), behavior definitions, draft entities, service definition + binding | S/4HANA modernization; ABAP Cloud readiness; replacing CASE_MANAGEMENT_API / SEGW services that need to land on a Fiori Elements or modern UI5 app |
| [convert-ui5-to-fiori-elements](convert-ui5-to-fiori-elements/SKILL.md) | Generates a Fiori Elements V4 LROP app (list report + object page) driven by `@UI.*` annotations on the V4 service, using the Fiori MCP server's 3-step (`list_functionalities` → `get_functionality_details` → `execute_functionality`) workflow | The legacy UI maps cleanly to a standard LROP pattern; you want minimum custom code and maximum SAP-managed consistency |
| [modernize-ui5-app](modernize-ui5-app/SKILL.md) | Converts a legacy UI5 freestyle JavaScript app (sync bootstrap, jQuery.sap.*, ES5, sap_belize) into a modern UI5 TypeScript app on UI5 1.147 with `sap.f.FlexibleColumnLayout`, typed event handlers, ES modules, `BaseController`, sap_horizon — with 5 documented "Critical Traps" up front to skip past common debugging detours | The legacy UI has custom controls / non-standard UX that don't fit a Fiori Elements template, or you want a TypeScript freestyle baseline for further customization |

#### convert-ui5-to-fiori-elements vs modernize-ui5-app

Both run against the same V4 RAP service produced by `migrate-segw-to-rap`. The difference is the target UI architecture:

| | convert-ui5-to-fiori-elements | modernize-ui5-app |
|---|---|---|
| **UI framework** | Fiori Elements V4 (`sap.fe.templates.*`) | UI5 1.147 freestyle (`sap.m.*` / `sap.f.*`) + TypeScript |
| **Layout pattern** | List Report → Object Page (FCL-ready via `allowDeepLinking`) | FlexibleColumnLayout with hand-authored views |
| **Customization mechanism** | OData annotations (`@UI.LineItem`, `@UI.HeaderInfo`, `@UI.DataPoint`, ...) on CDS projection / annotation views | Hand-authored XML views + TypeScript controllers |
| **Custom code** | Minimal — annotations only; controller extensions only when unavoidable | Full — every view, controller, formatter is hand-written TS |
| **Best for** | Standard CRUD, search/filter, sort, drilldown, value help, Approve/Submit action buttons | Non-standard UX, custom controls, dashboards, freeform layouts, anything `sap.fe.*` doesn't template |
| **Skill depends on** | ARC-1 + sap-docs + ui5-mcp-server + fiori-mcp | ARC-1 (optional) + sap-docs + ui5-mcp-server + browser MCP |
| **Maturity** | Driven by `@sap-ux/fiori-mcp-server` 3-step API + annotation-discovery via `mcp__sap-docs__search` | 5 documented Critical Traps from accumulated run learnings; teaches LLM to investigate via Self-help patterns |

### BTP CAP Modernization (Preview)

End-to-end greenfield migration from classic ABAP custom code (Z* packages) to BTP-native CAP applications. Side-by-side approach — leaves the source ABAP system untouched and produces a complete target CAP project (CDS schema, services, Fiori Elements V4 app, CF deployment artifacts) for review and manual activation.

| Skill | What it does | When to use |
|---|---|---|
| [modernize-abap-to-btp-cap](modernize-abap-to-btp-cap/SKILL.md) | End-to-end migration orchestrator: Z package → BTP CAP scaffold (CDS + service + Fiori + xs-security + mta.yaml + ADRs) | Planning ECC / on-prem S/4 → BTP CAP greenfield migration |
| [modernize-abap-cap-schema](modernize-abap-cap-schema/SKILL.md) | Z-tables (SE11) → CAP CDS entities with DDIC→CDS type mapping, FK→association inference, `cuid`/`managed` aspect auto-application | Data-model migration step; standalone for reverse-engineering Z tables to CDS |
| [modernize-abap-cap-service](modernize-abap-cap-service/SKILL.md) | Z function modules / reports / classes → CAP service definitions + TypeScript handler stubs with TODO markers + ABAP source excerpts | Service-layer migration step; produces compile-clean scaffold ready for business-logic translation |

#### Modernization vs Cloud-Readiness skills

- [sap-clean-core-atc](sap-clean-core-atc.md) classifies whether code **can stay in ABAP and move to S/4HANA Cloud / ABAP Cloud**. Source system stays SAP.
- [migrate-custom-code](migrate-custom-code.md) **fixes ATC findings in place** to make ABAP cloud-ready. Source system stays SAP.
- [modernize-abap-to-btp-cap](modernize-abap-to-btp-cap/SKILL.md) **rebuilds the application as BTP CAP** — leaves source ABAP untouched, produces a parallel BTP-native stack. Use when the target architecture is a CAP application, not just cloud-ready ABAP.

#### Typical BTP modernization workflow

```
1. bootstrap-system-context           →  Capture source SID, release, features
2. sap-unused-code                    →  Scope: skip dead code from migration
3. sap-clean-core-atc                 →  Risk assessment per Z object
4. modernize-abap-to-btp-cap          →  Generate target CAP scaffold (orchestrator)
   ├── modernize-abap-clean-core-gap  →  (sub-skill, planned) per-edition availability
   ├── modernize-abap-cap-schema      →  db/schema.cds
   ├── modernize-abap-cap-service     →  srv/*.cds + handlers stubs
   ├── modernize-abap-fiori-elements  →  (sub-skill, planned) app/<name>/
   ├── modernize-abap-auth-mapping    →  (sub-skill, planned) xs-security.json
   └── modernize-abap-btp-mta         →  (sub-skill, planned) mta.yaml + Dockerfile
5. Manual: implement handler TODOs    →  Translate ABAP business logic
6. generate-cds-unit-test             →  Test the new CAP entities
7. mbt build + cf deploy              →  Ship to BTP CF
```

> **Status**: Preview / Work-in-Progress. Orchestrator + schema + service skills available now. Remaining sub-skills (`clean-core-gap`, `fiori-elements`, `auth-mapping`, `btp-mta`) tracked in [#TBD upstream issue]. Feedback welcome on the [PR thread].

### System Context & Local Workflow

| Skill | What it does | When to use |
|---|---|---|
| [bootstrap-system-context](bootstrap-system-context/SKILL.md) | Probes SID, release, installed components, feature flags, and lint preset; writes a local `system-info.md` | First step of a session against an unfamiliar system — grounds the assistant in real constraints before any code work |
| [setup-abap-mirror](setup-abap-mirror/SKILL.md) | Creates a local abapGit-style mirror of a package or object list for IDE context and `git diff` | Onboarding a codebase, pre-migration snapshotting, feeding local context to tools that can't call MCP per-read |

### Meta / Quality

| Skill | What it does | When to use |
|---|---|---|
| [analyze-chat-session](analyze-chat-session/SKILL.md) | Analyzes the current conversation's tool calls and produces a feedback report | After a complex session — identifies inefficiencies, anti-patterns, and improvement suggestions |
| [arc1-cursor-regression](../.claude/skills/arc1-cursor-regression/SKILL.md) | Generates a tailored Cursor MCP config and regression prompt set for ARC-1, derived from PR diff or chat findings | Verifying a specific ARC-1 PR/fix/feature against the live MCP surface |

### Typical Workflow

Skills are designed to chain together. A typical RAP development flow:

```
1. bootstrap-system-context         →  Capture SID, release, features, lint preset
2. generate-rap-service-researched  →  Create the service stack (uses system-info.md)
3. generate-rap-logic               →  Add business logic (validations, determinations)
4. generate-abap-unit-test          →  Generate tests for the behavior pool
5. generate-cds-unit-test           →  Generate tests for the CDS views
6. optional: attach SKTD docs / inspect revisions / inspect transport history
7. analyze-chat-session             →  Review what worked, file improvements
```

For embedded-analytics modeling (cube → query):

```
1. bootstrap-system-context        →  Confirm SAP_BASIS 7.57+ (analytical_query support)
2. generate-analytics-star-schema  →  Build the cube + dimensions + texts (batch_create + activateAtEnd)
3. generate-cds-analytical-query   →  Project the consumable KPI query on the cube
4. explain-abap-code               →  (optional) Document the model for handoff
```

For codebase onboarding or pre-migration work:

```
1. bootstrap-system-context  →  Know the system
2. setup-abap-mirror         →  Pull the target package(s) into abapGit-style files
3. explain-abap-code         →  Understand key objects with dependency context
4. migrate-custom-code       →  Run ATC readiness checks and group findings
```

For clean-core / custom-code retirement planning:

```
1. bootstrap-system-context  →  Know the system
2. sap-unused-code           →  Scope the retirement (what even runs?)
3. sap-clean-core-atc        →  Classify the USED code into Levels A–D
4. sap-object-documenter     →  Document the keepers before rewriting
5. migrate-custom-code       →  Fix the Level B/C/D findings one at a time
```

For end-to-end legacy SEGW + UI5 modernization (backend + UI):

```
1. bootstrap-system-context             →  Know the system
2. migrate-segw-to-rap                  →  Reverse-engineer SEGW V2 service to RAP V4
                                            (tables, CDS, BDEF, SRVD, SRVB, draft entities)
3. ONE of (parallel paths against the new V4 service):
   - convert-ui5-to-fiori-elements      →  Annotation-driven Fiori Elements V4 LROP
   - modernize-ui5-app                  →  Freestyle UI5 1.147 + TypeScript
4. analyze-chat-session                 →  Capture learnings; propose new skill traps
```

The three migration skills are explicitly designed as parallel paths after the backend lands. You don't run both UI skills — you pick the one whose architecture matches your legacy app's complexity and your team's preference.

For SAP CAP enterprise audit (pre-release readiness for a CAP + Fiori Elements + S/4 Tier-2 stack on BTP):

```
1. sap-cap-stack-audit-full     →  Run the full audit stack in parallel; consolidated report
                                    (orchestrates all the skills below)

   Composed of:
   - sap-cap-clean-core-enforce →  Audit Tier-2 S/4 service availability vs released-state repo
   - sap-cap-customizing-honor  →  Bidirectional CSV↔code parameter consistency
   - sap-cap-security-rbac-matrix →  OWASP/ASVS/NIST + role coherence across 4 layers
   - sap-fiori-app-audit (xN)   →  Per-app UI/UX + frontend/backend contract chain
   - sap-cap-text-polish        →  User-visible text + PII safety + i18n bundle gaps

2. sap-cap-ci-gates-pattern     →  Lock the audit findings into CI gates that prevent regression
                                    (bidirectional, raise-coverage, availability-drift,
                                     convention-drift, csv-lint)
```

The seven CAP audit skills are designed as a single toolkit. Run `sap-cap-stack-audit-full` to dispatch everything at once, or invoke individual skills for a focused investigation. Findings flow into `sap-cap-ci-gates-pattern` so the audit converts to enforced CI gates, not one-off checks.
