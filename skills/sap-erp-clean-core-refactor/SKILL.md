---
name: sap-erp-clean-core-refactor
description: Plans and executes a Clean Core refactor of SAP ABAP custom code (Z*/Y*). Inventories objects via ARC-1, classifies them as Level A/B/C/D (via `sap-clean-core-atc`), and decides per object whether to rewrite-in-place, extract to a side-by-side BTP extension, keep at Level B, or remove. Documentation lookups are just-in-time (no pre-built KB). Use when asked to "refactor custom code to Clean Core", "plan side-by-side extensions", "Clean Core return on ERP", or to produce a documented migration plan.
---

# SAP ERP — Clean Core Refactor

Plans and executes the refactor of ABAP custom code to Clean Core. Three modes:

| Mode | What it does | Writes? |
|---|---|---|
| `discover` | Inventory the Z*/Y* package | No |
| `plan` (default) | Inventory + classify + decide per object → emit `docs/refactor/<date>-clean-core-plan.md` | No |
| `execute` | Apply the plan: rewrite ABAP, scaffold BTP extensions, document Level B keepers, remove unused | Yes (with per-object confirmation) |

## Input

```
<package-or-object> [mode] [flags]
```

Examples:
- `ZFI plan` — typical first call (default target = `btp-cf`)
- `ZCL_INVOICE_HANDLER plan` — single-object focus
- `ZFI execute` — apply plan with per-object confirmation
- `ZFI plan --target=btp-kyma --aggressive` — Kyma side-by-side target + push Level B → A

**Flags**:

| Flag | Effect |
|---|---|
| `--target=btp-cf` (default) `· btp-kyma · onprem-kyma` | Side-by-side runtime when extracting to BTP |
| `--target-level=A` (synonym of `--aggressive`) | Prefer Level A everywhere; explore B→A escalation |
| `--target-level=B` | Settle for B; cheaper paths preferred |
| `--push-to-a=A,B,C` | Selective B→A for listed objects only |
| `--force-refresh` | Bypass the 30-day cache; re-query sources |
| `--budget=N` | Per-finding Apify lookup budget (default 5) |

After plan emission, edit `docs/refactor/<date>-clean-core-plan.md` to override any decision before `execute`.

## Decision tree (per object)

| Start Level | Default Target | Path |
|---|---|---|
| A | A | no_action |
| Unused | — | remove_unused (with sign-off) |
| C | **A** | `rewrite_in_place` via released API (or `extract_to_side_by_side` if no equivalent; `keep_at_level_b` if only data-access) |
| D | **B** | `rewrite_in_place` via BAdI / enhancement-point (or `extract_to_side_by_side` if BAdI not feasible or `--target-level=A`) |
| B | **B** | `keep_at_level_b` (default). Escalates to A only with `--aggressive` / `--push-to-a` / `--target-level=A` |

**Side-by-side outcome** = Level A on the ERP side (the Z object disappears; logic lives on BTP under separate Clean Core gate).

## Workflow

### Step 1 — Pre-flight

- Verify ARC-1 MCP is connected (`SAPSearch` probe).
- Verify Apify MCP is available — if not, the skill degrades to **manual mode** (emits "consult URL X" pointers; user pastes back snippets).
- Resolve `$TARGET` (`--target=…` or ask once).
- One-time per system: run [`../bootstrap-system-context/SKILL.md`](../bootstrap-system-context/SKILL.md) to capture release / ATC preset / formatter into `system-info.md`.
- Init `.cache/sap-clean-core/` (gitignored).

### Step 2 — Inventory + impact analysis

- Enumerate Z*/Y* objects: `SAPSearch(package_tree)` + `SAPSearch(tadir_lookup)`.
- Dead-code: delegate to [`../sap-unused-code/SKILL.md`](../sap-unused-code/SKILL.md) (requires `SAP_ALLOW_FREE_SQL=true`).
- **Impact analysis** for every non-A candidate: `SAPContext(action="impact")` → fan-in count drives effort × risk:

| Fan-in | Risk × | Strategy |
|---|---|---|
| 0 | 0× | `remove_unused` candidate |
| 1-3 internal | 1× | low-risk `rewrite_in_place` |
| 4-10 | 2× | medium-risk; keep a thin adapter when rewriting |
| 11-50 | 4× | prefer `extract_to_side_by_side` if BTP available |
| 50+ | 8× | mandatory `research_required` (architectural review) |

### Step 3 — Classification

Delegate to [`../sap-clean-core-atc/SKILL.md`](../sap-clean-core-atc/SKILL.md). Receive back per-object Level A/B/C/D + ATC finding categories.

### Step 4 — JIT lookup + decide

For each non-A finding, consult sources in this order until evidence is sufficient (bounded by `--budget`):

1. **Cache hit**: `.cache/sap-clean-core/<sha256-of-topic>/<source>-<date>.md` (30-day TTL stable / 7-day community).
2. **Tier-1 git** (free): grep `abap-atc-cr-cv-s4hc`, curated `SAP-samples`, `cloud-sdk` (all installed as local clones).
3. **Tier-4 MCP** (free when installed): `mcp-sap-docs`, `context7`.
4. **Tier-2 Apify** (paid, ~€0.005-0.02/page): `api.sap.com`, `help.sap.com`, `developers.sap.com`, community, blogs.
5. **Pattern mining** (free, optional): `SAPRead(VERSIONS, VERSION_SOURCE)` for the customer's own history — find how similar Z objects have already been migrated. Cuts rewrite effort 30-50%.

If budget exhausts without an answer, flag `research_required` and optionally invoke [`../explain-abap-code/SKILL.md`](../explain-abap-code/SKILL.md) for a deep dive.

Full source catalog: [`./SOURCES.md`](./SOURCES.md). Battle-tested patterns referenced for decision-making: [`./PATTERNS.md`](./PATTERNS.md).

### Step 5 — Emit plan

Write `docs/refactor/<date>-clean-core-plan.md` with one row per object:

| Object | Start Level | Target Level | Decision | Replacement / Pattern | Effort | Risk | KB evidence |

Plus: inventory summary, side-by-side extension catalog (per `extract` outcome), suggested sequencing (quick wins → in-place phase 1 → in-place phase 2 → side-by-side parallel), research backlog, source citations.

**User reviews the plan and edits any decision** before `execute`.

### Step 6 — Execute (opt-in)

Per object, ask confirmation. Then dispatch:

| Decision | Action |
|---|---|
| `rewrite_in_place` | (1) Generate regression test via [`../generate-abap-unit-test/SKILL.md`](../generate-abap-unit-test/SKILL.md) or [`../generate-cds-unit-test/SKILL.md`](../generate-cds-unit-test/SKILL.md). (2) `SAPWrite(action="update")` + `SAPActivate` + `SAPLint(format+run_atc)` + `SAPDiagnose(run_unit_tests)`. (3) Rollback via `SAPGit` if regression. For RAP behavior pool delegate to [`../generate-rap-logic/SKILL.md`](../generate-rap-logic/SKILL.md) |
| `extract_to_side_by_side` | Delegate to [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md). ABAP source stays deprecated-tagged until QA confirms parity. UI side: [`../convert-ui5-to-fiori-elements/SKILL.md`](../convert-ui5-to-fiori-elements/SKILL.md) |
| `keep_at_level_b` | Delegate to [`../sap-object-documenter/SKILL.md`](../sap-object-documenter/SKILL.md) (SKTD rationale + ATC exemption) |
| `remove_unused` | Stakeholder sign-off → `SAPSearch(where_used)` → `SAPWrite(action="delete")` |

Transport: `SAPTransport(requirement_check → create → reassign)`. Optional `SAPGit` commit if `SAP_ALLOW_GIT_WRITES=true`.

### Step 7 — Verify

Cumulative `SAPLint(run_atc)` + `SAPDiagnose(run_unit_tests)` on the whole package. Net ATC regression aborts the loop. Optional `analyze-chat-session` at session end for learnings.

## Cost

| Item | Cost |
|---|---|
| ARC-1 MCP / arc-1 native skills / Tier-1 git clones / MCP-server lookups | €0 |
| Tier-2 Apify per page | €0.005-0.02 |
| Typical refactor (50-200 objects) | **€0.50-€5 total**, user pays own Apify account |
| Re-run within 30 days (cache hits) | €0 |
| `--aggressive` mode delta | +30-50% |

No centralized infra. No pre-built KB. Manual mode (no Apify) works at zero cost but slower.

## Companion files

| File | What |
|---|---|
| [`./SOURCES.md`](./SOURCES.md) | 23 authoritative SAP sources in 4 tiers (Tier-1 git / Tier-2 Apify / Tier-3 manual / Tier-4 MCP) |
| [`./PATTERNS.md`](./PATTERNS.md) | ~70 battle-tested patterns in 8 categories (UI5/FE V4, CAP/TS, BTP/Kyma deployment with 4-target matrix, security, customizing, lifecycle, events, ecosystem plugins). Consulted during Step 1 target resolution + Step 6 side-by-side scaffold |
| [`./INTEGRATIONS.md`](./INTEGRATIONS.md) | Step-by-step mapping: refactor phase × ARC-1 MCP tool × arc-1 native skill × secondsky/sap-skills plugin |

## Recommended companion plugins

**MUST** (from [secondsky/sap-skills](https://github.com/secondsky/sap-skills)):
- `sap-abap` — ABAP language patterns (Step 6 rewrite ABAP)
- `sap-abap-cds` — CDS view design (Step 6 when introducing CDS)
- `sap-cap-capire` — CAP framework + 4 dispatchable agents (Step 6 side-by-side)
- `sap-btp-developer-guide` — BTP reference (Step 1 target resolution)

**Optional**: Apify MCP (JIT lookup), `mcp-sap-docs` (preferred over Apify when installed), `context7` (non-SAP libs), plus situational SHOULD plugins listed in [`./INTEGRATIONS.md`](./INTEGRATIONS.md).

## When NOT to use

- Single small change to one Z object → use ARC-1 directly.
- Green-field BTP development → use [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md) directly.
- System upgrade plan → use SAP Activate methodology.
- Customer has no BTP plan AND no Customizing alternative → the toolkit can still help (no-BTP customers get `rewrite_in_place` + `keep_at_level_b` paths only, compliance score lower but progress is real).

## Companion repository

For audit / hardening / CI gates of the CAP applications this skill generates, see [`Raistlin82/sap-cap-toolkit`](https://github.com/Raistlin82/sap-cap-toolkit) (8 skills: clean-core-enforce, customizing-honor, security-rbac-matrix, fiori-app-audit, text-polish, stack-audit-full, ci-gates-pattern, fiori-battle-tested-patterns).
