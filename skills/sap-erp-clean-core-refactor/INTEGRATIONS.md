# Integrations Map — Level A Refactor

Detailed mapping of every refactor step against:
- **ARC-1 MCP tools** that perform the operation on the SAP system
- **arc-1 native skills** that the orchestrator delegates to
- **secondsky/sap-skills plugins** that provide the language / framework knowledge for the operation
- **Other external sources** (Apify, MCP servers, manual)

Use this document to:
- Verify the skill's coverage of available tooling.
- Diagnose what's missing in an environment ("ARC-1 not configured" / "secondsky plugin X not installed" / …).
- Understand the cost/value contribution of each integration point.

## Architectural roles

| Layer | Role | Examples |
|---|---|---|
| **ARC-1 MCP** | the *hands* — reads/writes ABAP objects on the SAP system via ADT REST API | `SAPRead`, `SAPWrite`, `SAPActivate`, `SAPLint`, `SAPContext`, `SAPDiagnose`, `SAPTransport`, `SAPGit`, `SAPManage`, `SAPNavigate`, `SAPSearch`, `SAPQuery` |
| **arc-1 native skills** | the *playbook* — sequences of MCP operations encoded as reusable agents | `bootstrap-system-context`, `sap-clean-core-atc`, `generate-rap-logic`, `modernize-abap-to-btp-cap`, … |
| **secondsky/sap-skills plugins** | the *library of patterns* — how to write what the hands will write | `sap-abap`, `sap-abap-cds`, `sap-cap-capire` (with 4 agents), `sap-btp-developer-guide`, `sapui5`, `sap-fiori-tools`, … |
| **This skill** (`sap-erp-clean-core-refactor`) | the *orchestrator* — decides which patterns to apply using which hands following which playbook | (you are here) |
| **External knowledge** | JIT documentation lookup when local cache misses | Apify (per-page paid), MCP-sap-docs (free when installed), WebFetch (free for simple HTML) |

## Step-by-step integration map

### Step 1 — Pre-flight

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 1a — ARC-1 connectivity probe | `SAPSearch(package_lookup, "<pkg>")` | — | — | — | Cheap call to verify the server responds + auth works |
| 1b — Apify MCP availability | — | — | — | `mcp__apify__*` | Degrades to manual mode if absent |
| 1c — Resolve `$TARGET` | — | — | `sap-btp-developer-guide` (target landscape reference) | — | Default `btp-cf` |
| 1d — Init local cache | (bash) | — | — | — | `.cache/sap-clean-core/` gitignored |
| 1e — Bootstrap system context | `SAPManage(probe_features)` + `SAPRead(SKTD)` | **`bootstrap-system-context`** | — | — | One-time per system; produces `system-info.md` |

### Step 2 — Inventory

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 2a — Package enumeration | `SAPSearch(package_tree, root=<pkg>)` | — | — | — | Recursive sub-package walk |
| 2b — Object enumeration | `SAPSearch(tadir_lookup, devclass=<pkg>)` | — | — | — | All object types per package |
| 2c — Namespace filter | (post-processing) | — | — | — | Keep only `Z*`, `Y*`, customer namespace |
| 2d — Unused detection | `SAPQuery(SCMON / SUSG)` (requires `SAP_ALLOW_FREE_SQL=true`) | **`sap-unused-code`** | — | — | Last 6 months runtime hits |
| 2e — Impact analysis | **`SAPContext(action="impact")`** | — | — | — | ⚠️ **MOST IMPORTANT MCP CALL**. Fan-in count drives effort × risk multipliers |

### Step 3 — Classification

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 3a — ATC run | `SAPLint(action="run_atc", target_level="A")` | **`sap-clean-core-atc`** | — | — | Per-object Level A/B/C/D |
| 3b — Augment with finding categories | (post-processing) | — | — | — | non-released-api / direct-db-access / modification / enhancement-point |

### Step 4 — JIT documentation lookup + decision

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 4a — Cache-first lookup | (filesystem read) | — | — | — | 30d TTL stable, 7d community/blogs |
| 4b — Tier 1 git lookup | (filesystem grep) | — | — | git clones: `abap-atc-cr-cv-s4hc`, `SAP-samples`, `cloud-sdk` | Free, fast, authoritative for object classification |
| 4b — Tier 2 JIT Apify | — | — | — | `apify/website-content-crawler`, `apify/puppeteer-scraper` | Per-page cost ~€0.005-0.02; user pays |
| 4b — Tier 4 MCP-server lookup | — | — | — | `mcp-sap-docs`, `context7` | Preferred when installed (free) |
| 4c — Cite + cache | (filesystem write) | — | — | — | `.cache/sap-clean-core/<topic-hash>/<source>-<date>.md` |
| 4d — Budget exhaustion fallback | — | **`explain-abap-code`** (single-object deep dive) | — | — | Reduces human research effort ~50% |
| 4d-quater — Pattern mining | **`SAPRead(VERSIONS)`**, **`SAPRead(VERSION_SOURCE)`** | — | — | — | Mine customer's own history for refactor patterns. ⚠️ Reduces rewrite effort 30-50% on customers with established conventions |
| 4d-bis — Decision tree | (agent reasoning) | — | — | — | Per-object Start Level + flags → Target Level + Decision |
| 4e-4g — Level B escalation | — | — | — | — | `--aggressive` / `--push-to-a` / `--target-level=A` flags |

### Step 5 — Plan emission

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 5a — Generate plan markdown | (filesystem write) | — | — | — | `docs/refactor/<date>-clean-core-plan.md` |
| 5b — Per-object decision rows | (templating) | — | — | — | Object / Start Level / Target Level / Decision / Replacement / Effort / Risk / KB evidence |

### Step 6 — Execute (opt-in)

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 6-pre — Generate regression tests (CLAS/FUGR) | — | **`generate-abap-unit-test`** | `sap-abap` (test patterns reference) | — | Capture current behaviour as baseline |
| 6-pre — Generate regression tests (DDLS) | — | **`generate-cds-unit-test`** | `sap-abap-cds` (CDS Test Double Framework patterns) | — | For CDS views |
| 6a — Rewrite in-place: read + write | `SAPRead(VERSIONS)`, `SAPWrite(action="update")`, `SAPActivate(scope="object")` | **`generate-rap-logic`** (when rewrite goes to RAP behavior pool), **`generate-rap-service-researched`** (full RAP stack, rare) | **`sap-abap`** (language patterns), **`sap-abap-cds`** (CDS views if introduced) | — | Pattern-mined via Step 4d-quater |
| 6a — Format | `SAPLint(action="format")` | — | — | — | Apply project formatter from `system-info.md` |
| 6a — ATC regression | `SAPLint(action="run_atc")` | — | — | — | Gate: blocks loop if regression |
| 6a — Unit test regression | `SAPDiagnose(action="run_unit_tests")` | — | — | — | Gate: blocks loop on test failure |
| 6a — Rollback if regression | `SAPGit(revert)` | — | — | — | Requires `SAP_ALLOW_GIT_WRITES=true` |
| 6b — Side-by-side scaffold | — | **`modernize-abap-to-btp-cap`** chain, **`convert-ui5-to-fiori-elements`** (UI) | **`sap-cap-capire`** (4 agents: cap-cds-modeler, cap-service-developer, cap-performance-debugger, cap-project-architect), **`sap-btp-developer-guide`**, **`sap-fiori-tools`** + `sapui5` (UI), **`sap-btp-cloud-platform`** (service binding) | — | Per-extension CAP project under `bs/<name>/` |
| 6c — Document Level B keeper | `SAPWrite(action="attach_sktd")` | **`sap-object-documenter`** | — | — | Markdown rationale + ATC exemption update |
| 6.5 — Transport requirement check | `SAPTransport(action="requirement_check")` | — | — | — | Ensure deps reachable |
| 6.5 — Transport create / reuse | `SAPTransport(action="create"|"reassign")` | — | — | — | One TR per phase or per cluster |
| 6.5 — gCTS / abapGit commit | `SAPGit(commit)` | — | — | — | Optional; with `SAP_ALLOW_GIT_WRITES=true` |

### Step 7 — Verification

| Sub-step | ARC-1 MCP | arc-1 skills | secondsky plugin | External | Notes |
|---|---|---|---|---|---|
| 7a — ATC final check | `SAPLint(action="run_atc")` (whole package) | — | — | — | Cumulative regression |
| 7b — Unit test full run | `SAPDiagnose(action="run_unit_tests")` (whole package) | — | — | — | All tests including pre-existing |
| 7c — Cross-check against CAP audit | — | [`sap-cap-clean-core-enforce`](https://github.com/Raistlin82/sap-cap-toolkit/blob/main/skills/sap-cap-clean-core-enforce/SKILL.md) (other branch) | — | — | Verify BTP-side compliance |
| 7d — Session learnings | — | **`analyze-chat-session`** | — | — | Propose new skill traps for future runs |

## Coverage assessment

The table below shows **what fraction of ARC-1 MCP capabilities the skill currently engages**.

| ARC-1 MCP tool | Engagement in this skill |
|---|---|
| `SAPRead` (source + VERSIONS + VERSION_SOURCE + SKTD) | 🟢 Step 2 (inventory), Step 4d-quater (mining), Step 6a (pre-write VERSIONS check), Step 6c (read SKTD) |
| `SAPSearch` (tadir_lookup + package_tree + where_used + full-text) | 🟢 Step 2 (enumerate), Step 6 (where_used for unused removal) |
| `SAPWrite` (update + delete + attach_sktd + batch_create) | 🟢 Step 6a (update), Step 6c (attach_sktd), Step 6 unused (delete) |
| `SAPActivate` | 🟢 Step 6a (post-write activation) |
| `SAPNavigate` (go-to-definition, find references) | 🟡 Implicit in `SAPContext`; not directly called |
| `SAPQuery` (free SQL, off by default) | 🟡 Used by `sap-unused-code` (delegate) — requires `SAP_ALLOW_FREE_SQL=true` |
| `SAPTransport` | 🟢 Step 6.5 (requirement_check + create + reassign) |
| `SAPGit` | 🟡 Step 6a rollback + Step 6.5 commit (both opt-in via `SAP_ALLOW_GIT_WRITES=true`) |
| `SAPContext` (impact + reverse-deps + CDS impact) | 🟢 Step 2e (MOST IMPORTANT call — drives risk multipliers) |
| `SAPLint` (run_atc + format + get_formatter_settings) | 🟢 Step 3 (classification), Step 6a (pre+post regression + format) |
| `SAPDiagnose` (syntax + unit tests + ATC + quickfix + dumps + profiler) | 🟢 Step 6a (run_unit_tests), Step 7 (full run) |
| `SAPManage` (capability detection) | 🟢 Step 1e (via `bootstrap-system-context`) |

**Overall**: the skill engages all 12 ARC-1 tools at least once. `SAPNavigate` is the only one used implicitly (via `SAPContext`); explicit calls are not needed for the refactor workflow.

## Coverage assessment — secondsky/sap-skills

The table below shows **which secondsky plugins this skill enforces as MUST / SHOULD / OPTIONAL**.

| Plugin | Severity | Step where invoked |
|---|---|---|
| `sap-abap` | **MUST** | Step 6a rewrite_in_place (every ABAP rewrite consults its language patterns) |
| `sap-abap-cds` | **MUST** | Step 6a when rewrite introduces CDS views |
| `sap-cap-capire` (with 4 agents) | **MUST** | Step 6b side-by-side scaffold |
| `sap-btp-developer-guide` | **MUST** | Step 1c target resolution, Step 6b scaffold |
| `sapui5` (with 4 agents) | SHOULD | Step 6b when extension has UI |
| `sap-fiori-tools` | SHOULD | Step 6b Fiori Elements UI generation |
| `sapui5-linter` | SHOULD | Step 6b post-scaffold UI quality gate |
| `sap-btp-cloud-platform` | SHOULD | Step 6b service binding |
| `sap-btp-connectivity` | SHOULD | Step 6b when extension uses destinations |
| `sap-cloud-sdk` | SHOULD | Step 6b when extension uses Cloud SDK |
| `sap-cloud-sdk-ai` | OPTIONAL | Step 6b when extension is AI-heavy |
| `sap-btp-cloud-logging` | OPTIONAL | Step 6b production observability |
| `sap-btp-job-scheduling` | OPTIONAL | Step 6b when extension has scheduled jobs |
| `sap-btp-cloud-transport-management` | OPTIONAL | Step 6.5 when customer uses cTMS |
| `sap-btp-master-data-integration` | OPTIONAL | Step 6b when extension subscribes to MDI events |
| `sap-btp-cias` | OPTIONAL | Step 6b when customer uses IAS instead of XSUAA |
| `sap-btp-business-application-studio` | OPTIONAL | Hand-off documentation |
| `sap-btp-integration-suite` | OPTIONAL | Step 6b when side-by-side uses iFlows |
| `sap-btp-build-work-zone-advanced` | OPTIONAL | Step 6b when UI surfaces in Work Zone |
| `sap-btp-intelligent-situation-automation` | OPTIONAL | Step 6b when extension includes workflow logic |

Plugins **NOT** used by this skill (out of scope):
- `sap-sqlscript`, `sap-hana-ml`, `sap-hana-cloud-data-intelligence`, `sap-hana-cli` — HANA-native dev
- `sap-datasphere`, `sap-sac-*` — analytics
- `sap-ai-core` — AI infrastructure
- `sap-api-style` — API design guidelines

## Cost model — by integration layer

| Layer | Cost per refactor (50-200 objects) | Who pays |
|---|---|---|
| ARC-1 MCP | €0 (server runs on user's infra) | User (server hosting) |
| arc-1 native skills | €0 (skill execution is agent-time, not API-billed) | (agent inference cost is platform-billed) |
| secondsky/sap-skills | €0 (knowledge base; no per-call cost) | (one-time install) |
| Tier 1 git clones | €0 (~100 MB on first install) | User (bandwidth) |
| Tier 2 Apify JIT | €0.50-€5 typical | User (own Apify token) |
| Tier 4 MCP-server-backed | €0 | User (server hosting) |

**Total**: €0.50-€5 per typical customer refactor, all charged to the user's own infrastructure / accounts. No centralized cost.

## See also

- [`./SKILL.md`](./SKILL.md) — main protocol; this document is the integration deep-dive.
- [`./SOURCES.md`](./SOURCES.md) — authoritative SAP source catalog (Tier 1-4).
- [`sap-cap-fiori-battle-tested-patterns`](./PATTERNS.md) — broader companion plugin map (Category 8) for the CAP-side toolkit.
- [ARC-1 README](https://github.com/marianfoo/arc-1) — full MCP capability reference.
- [secondsky/sap-skills](https://github.com/secondsky/sap-skills) — 32-plugin SAP skill catalog.
