---
name: sap-erp-clean-core-refactor
description: Plans and executes a custom-code refactor of an SAP ABAP / ERP / S/4HANA system to return to Clean Core compliance — inventories every Z/Y object via the ARC-1 MCP server, classifies each one against Clean Core Levels A/B/C/D (delegating to `sap-clean-core-atc`), then performs **just-in-time** documentation lookups on a curated list of authoritative SAP sources (Apify on-demand for HTTP/SPA pages, git-clone for static repositories, MCP servers when available) to decide, per object, between an **in-place rewrite to released APIs** or an **extraction to a side-by-side BTP extension** (handing off the scaffold to `modernize-abap-to-btp-cap`). No pre-crawled knowledge base — content is queried only when a specific finding needs it, results cached per-finding under `.cache/`. Use when asked to "refactor custom code to Clean Core", "plan side-by-side extensions", "Clean Core return on ERP", "remove non-released API consumption", "extract Z code to BTP", or to produce a documented migration plan with effort estimates and dependency ordering.
---

# SAP ERP — Clean Core Return + Side-by-Side Refactor

Three convictions drive this skill:

1. **"Clean Core" is not "ABAP migration"**. The goal is to reclassify custom code where it lives — rewrite to released APIs where possible, extract to BTP where it doesn't fit — without conflating it with a system upgrade.
2. **Documentation is queried just-in-time, not pre-crawled**. A pre-built knowledge base is expensive (Apify costs €400-780/year for weekly full crawl of 18 sources), stale by day 7, and produces gigabytes of content most of which is never read. Instead: maintain a **list** of authoritative SAP sources; query each one **only when a specific finding needs it**; cache the response locally for 30 days.
3. **The user pays for their own lookups**. Apify costs are per-invocation (~€0.005-0.02 per page). For a typical customer refactor (50-200 lookups), total cost is **€0.50-€5** charged to the user's own Apify account — not to a centralized infrastructure that no one wants to maintain.

This skill does NOT ship a pre-built KB. It ships:
- A **curated source catalog** ([`./SOURCES.md`](./SOURCES.md)) listing the 18 authoritative SAP documentation sources.
- A **JIT lookup protocol** (Step 4 below) describing how to consult each source via Apify / git / MCP / WebFetch.
- A **per-finding cache** under `.cache/sap-clean-core/<hash>/` so repeat lookups within 30 days return instantly.

## v1 Guardrails

- **Three modes, in increasing risk order**: `discover` (read-only inventory), `plan` (inventory + JIT-driven refactor plan), `execute` (apply in-place rewrites + scaffold BTP extensions).
- **Never modify the ERP system without `execute` mode** and explicit user authorization. ABAP-side changes route through ARC-1 with version-aware writes.
- **Never invent released-API claims**. Every "rewrite to API X" suggestion must cite the source consulted (URL + retrieval timestamp + cached snapshot path).
- **Side-by-side scaffolds delegated**, not generated inline. The skill produces the **plan**; [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md) does the actual CAP generation.
- **Lookups are bounded**. Per-finding budget: max 5 Apify pages + 1 git lookup + 1 MCP query. If the per-finding budget is exhausted without an answer, surface a "research-required" item to the user, do not proceed with a guess.

## Smart Defaults (apply silently, do NOT ask)

| Aspect | Default | Why |
| --- | --- | --- |
| Mode | `plan` | Most users invoke this skill expecting a plan, not execution |
| Package scope | Top-level Z* package + recursive sub-packages | Customer-owned namespaces; SAP-standard untouched |
| Source system | The system bound to the ARC-1 MCP server | Single source of truth for discovery |
| Per-finding lookup budget | 5 Apify pages + 1 git lookup + 1 MCP query | Bounded cost; surface unresolved findings instead of unbounded research |
| Cache TTL | 30 days (stable docs), 7 days (community / blogs) | Balance freshness vs cost; user can `--force-refresh` to invalidate |
| Cache location | `.cache/sap-clean-core/<topic-hash>/` (gitignored) | Per-project local; not committed |
| Output destination | `docs/refactor/<yyyy-mm-dd>-clean-core-plan.md` | Committed; serves as the decision record |
| Target Clean Core level | `A` | Most restrictive; works for all cloud targets |
| Side-by-side target | Asked once at session start | Reuses Step 0 of [`../sap-cap-stack-audit-full/SKILL.md`](../sap-cap-stack-audit-full/SKILL.md) deployment-target decision tree |
| Level B handling | `keep_at_level_b` by default (compliant; documented) | B is already Clean-Core compliant. Pushing to A is opt-in via `--aggressive` / `--push-to-a` / `--target-level=A` because escalation adds cost and may be wrong choice (most B objects use SAP-recommended patterns) |
| Level C target | A (via released-API rewrite) when equivalent exists, else B (via BAdI substitution), else side-by-side (ERP becomes A) | Cost-minimizing default. Override with `--target-level=B` to settle for B even when A is cheaper |
| Level D target | B (via BAdI / enhancement-point rewrite) when feasible, else side-by-side (ERP becomes A) | Cost-minimizing default. D objects usually have business logic that genuinely needs an extension surface; BAdI-rewrite is the SAP-recommended path. Override with `--target-level=A` to prefer side-by-side over BAdI |
| Mixed-findings objects | Object level = MAX of finding levels (e.g. one D finding + one B finding → object treated as D) | The refactor decision is per-object, not per-finding, but the plan reports residual findings post-refactor |

## Input

Single argument with format `<package-or-object> [mode] [flags]`:

| Argument | Meaning |
|---|---|
| `<package>` | Top-level customer package (e.g. `ZFI`, `ZHR`, `Y_CUSTOM`) — recursively scoped |
| `<object>` | Single object focus mode (e.g. `ZCL_INVOICE_HANDLER`, `ZFM_GET_BP_DATA`) |
| `mode` | `discover` · `plan` (default) · `execute` |
| `--target=` | `btp-cf` *(default)* · `btp-kyma` · `onprem-kyma` (drives side-by-side target choice). Default is BTP Cloud Foundry — most widely-adopted SAP-managed runtime, broadest service ecosystem (Free + paid tiers), mature `mta.yaml` tooling, lowest operational ceremony |
| `--force-refresh` | Bypass the local cache; re-query the source even if cached < 30 days |
| `--budget=N` | Override the default per-finding Apify lookup budget (default 5 pages) |
| `--aggressive` | Synonym for `--target-level=A`. For every Level B finding, also research Level A escalation paths (rewrite via Customizing OR side-by-side extraction). Emits **multi-option proposals** instead of default `keep_at_level_b`. Adds ~30-50% to plan generation cost |
| `--push-to-a=A,B,C` | Selective B→A escalation: only the listed object names get the expanded analysis. Cheaper than `--aggressive`, requires you know which objects upfront |
| `--target-level=A` | **Ambitious mode** — always prefer Level A outcomes. Forces side-by-side extraction over BAdI-rewrite for Level D when both feasible; forces released-API replacement over BAdI-substitution for Level C even when BAdI is cheaper. Activates Level B escalation analysis (same as `--aggressive`) |
| `--target-level=B` | **Minimal-compliance mode** — settle for B everywhere. For Level C, pick the cheapest path that reaches B (instead of A via released API) when that saves effort. For Level D, BAdI-rewrite only (never side-by-side just for "purity"). Useful when customer's appetite is "good enough compliance with minimum disruption" |

Examples:
- `ZFI plan` — typical first call (defaults: target=`btp-cf`, mode=`plan`, Level B kept as B)
- `ZCL_INVOICE_HANDLER plan` — single-object focus
- `ZFI plan --target=btp-kyma` — override target to Kyma when the customer wants the Kubernetes operational model
- `ZFI execute` — apply the plan (requires confirmation per object)
- `ZFI plan --force-refresh` — re-query every source even if cached
- `ZFI plan --aggressive` — explore Level A escalation for every Level B (target stays at default `btp-cf`)
- `ZFI plan --target=btp-kyma --push-to-a=ZTABLE_TAX_RATES_LOCAL,ZCL_VENDOR_LOOKUP_EXT` — Kyma target + selective B→A for two specific objects

## Step 1: Pre-flight

### 1a — Verify ARC-1 MCP server connectivity

The skill cannot proceed without an authenticated ARC-1 connection to the source SAP system. Probe via a known-cheap call:

```
SAPSearch(searchType="package_lookup", source="active", query="<package>")
```

If the call fails, stop with a clear error and direct the user to the ARC-1 setup docs.

### 1b — Verify Apify MCP availability (or offer manual mode)

JIT lookups against HTTP/SPA sources need Apify. Probe for the Apify MCP server:

```
mcp__apify__search-apify-docs(query="website content crawler")
```

If unavailable, the skill degrades to **manual mode**: it produces a plan with explicit "consult this URL manually" pointers, requires the user to paste back the relevant doc snippets. Slower but no Apify dependency.

### 1c — Resolve the side-by-side deployment target

The plan's "extract to BTP" suggestions differ per target (BTP CF vs Kyma vs on-prem). If `--target` wasn't passed, ask the user once (same dialog as [`../sap-cap-stack-audit-full/SKILL.md`](../sap-cap-stack-audit-full/SKILL.md) Step 0).

Record the target as `$TARGET`. The plan's side-by-side suggestions consult the matching section of [`../sap-cap-fiori-battle-tested-patterns/SKILL.md#category-3--btp--kyma--on-premise-deployment-lessons`](../sap-cap-fiori-battle-tested-patterns/SKILL.md).

### 1d — Initialize the local cache

```bash
mkdir -p .cache/sap-clean-core
grep -q "^\.cache/$" .gitignore 2>/dev/null || echo ".cache/" >> .gitignore
```

Cache entries are gitignored. Each entry is `.cache/sap-clean-core/<sha256-of-topic>/<source-id>-<yyyy-mm-dd>.md` so the same topic queried twice in the same week reads from disk.

### 1e — Bootstrap system context (one-time per system)

Before the first invocation against a given SAP system, run [`../bootstrap-system-context/SKILL.md`](../bootstrap-system-context/SKILL.md) to capture: SID, release, installed components, feature toggles, ATC preset, formatter settings. The output `system-info.md` grounds all subsequent decisions (which BAdIs are available on this release; which formatter to apply post-rewrite; which transport backend is configured).

The refactor skill checks for `system-info.md` in the working directory; if missing, prompts the user to run bootstrap first. Idempotent and cheap (~30s, read-only). Without it, the plan is system-generic; with it, the plan is system-grounded.

## Step 2: Inventory via ARC-1 MCP

Discover every customer-owned object in scope.

### 2a — Enumerate packages

```
SAPSearch(searchType="package_tree", source="active", root="<package>")
```

### 2b — Enumerate objects per package

```
SAPSearch(searchType="tadir_lookup", source="active", filter={pgmid: 'R3TR', devclass: '<pkg>'})
```

Collect object_type, object_name, package, last_changed_at, size_loc into an inventory TSV.

### 2c — Filter by namespace ownership

Keep only `Z*`, `Y*`, and `/<customer-namespace>/*` prefixes.

### 2d — Detect inactive / orphaned objects

Cross-check with [`../sap-unused-code/SKILL.md`](../sap-unused-code/SKILL.md) when available. Mark each row with `usage_status`: `ACTIVE` / `UNUSED` / `Z_ONLY`.

### 2e — Impact / dependency analysis (`SAPContext`)

For every non-A object that may end up rewritten or extracted, ARC-1's `SAPContext(action="impact")` is the **most important MCP call** the skill makes. It returns:

- **Upstream dependencies**: what the object reads / consumes.
- **Reverse dependencies (fan-in)**: who calls the object — count + identity of caller objects.
- **CDS upstream / downstream**: for CDS views, the view dependency graph.

The fan-in count drives effort and risk estimation:

| Fan-in | Risk multiplier | Strategy hint |
|---|---|---|
| 0 (orphan) | 0× | candidate for `remove_unused` even if SCMON shows recent hits (might be one-off) |
| 1-3 callers, all internal Z | 1× | low-risk rewrite_in_place |
| 4-10 callers | 2× | medium-risk; consider keeping a thin adapter layer when rewriting |
| 11-50 callers | 4× | high-risk rewrite; **prefer extract_to_side_by_side** if BTP available (move new logic to BTP, leave a thin proxy in ERP that's auto-deprecation-tagged) |
| 50+ callers | 8× + manual review | **mandatory architectural review** before any decision — surface as `research_required` regardless of other signals |

Persist the impact table alongside the inventory TSV. It feeds Step 4 decision logic.

## Step 3: Classification via `sap-clean-core-atc`

Delegate to the existing [`../sap-clean-core-atc/SKILL.md`](../sap-clean-core-atc/SKILL.md). Receive back per-object Clean Core Level + ATC findings + top-finding categories.

Augment the inventory with `clean_core_level`, `atc_findings_count`, `top_findings_category`.

## Step 4: JIT documentation lookup per non-A finding

For each object not classified `A` (or `UNUSED`), perform a bounded just-in-time research pass. The goal: enough evidence to decide between **rewrite-in-place** / **side-by-side** / **keep-at-B**.

### 4a — Cache-first lookup

Compute the **topic hash**: `sha256("<finding-category>:<key-object>:<key-context>")`. Examples:
- `sha256("non-released-api:BAPI_INCOMINGINVOICE_CREATE1:supplier-invoice")`
- `sha256("direct-db-access:VBAK:sales-order-header")`

Look in `.cache/sap-clean-core/<topic-hash>/` for entries dated within the TTL window (30d / 7d). Use them if present.

### 4b — JIT lookup protocol (cache-miss path)

Consult sources in this order, stopping as soon as evidence is sufficient (bounded by `--budget`):

**1. Git-cloned authoritative sources** (free, fast):

| Source | Query method | When to use |
|---|---|---|
| `SAP/abap-atc-cr-cv-s4hc` | local grep against JSON files | Always for any ABAP object: classify Level + edition availability |
| `SAP-samples/*` (curated) | local grep against `*.md` / `*.cds` / `*.ts` | When looking for side-by-side patterns in a known domain |
| `SAP/cloud-sdk` (docs only) | local grep against `docs-md/` | When the plan involves Cloud SDK consumption from BTP |

These are git-clone-able weekly without cost; the project's installer ships a script that clones them under `.cache/git/` on first use and `git pull --ff-only` on subsequent runs.

**2. MCP-server-backed lookup** (free, fast, may not be installed):

| MCP server | When to use |
|---|---|
| `mcp-sap-docs` | Help portal search, SAP Notes, Communication Scenario lookup |
| `context7` | Non-SAP library docs (rare in this skill) |

**3. JIT Apify lookup** (per-page cost, user pays):

| Source | Apify actor | Per-page cost (est.) | When to use |
|---|---|---|---|
| `api.sap.com` (specific service page) | `apify/puppeteer-scraper` | ~€0.01 | OData service lifecycle — released? deprecated? CS membership? |
| `help.sap.com` (specific topic page) | `apify/website-content-crawler` | ~€0.005 | Clean Core principles, extensibility guidance |
| `developers.sap.com/tutorials/<X>` | `apify/website-content-crawler` | ~€0.005 | A concrete how-to for a specific extension pattern |
| `cap.cloud.sap/docs/<X>` | `apify/website-content-crawler` | ~€0.005 | CAP scaffold patterns for the side-by-side option |
| `community.sap.com` (Q&A search) | `apify/website-content-crawler` | ~€0.01 | When stuck on a specific symptom; query the recent-90d archive |
| `blogs.sap.com` (tag-filtered) | `apify/website-content-crawler` | ~€0.01 | Architecture essays on a specific side-by-side pattern |

**4. WebFetch fallback** (free for simple HTML; not for SPAs):

If neither MCP nor Apify is available, use the agent's WebFetch primitive against simple-HTML SAP pages. Fails on api.sap.com (React SPA); works on help.sap.com.

### 4c — Cite + cache

For every consulted source, record:
- URL
- retrieval timestamp
- snippet relevant to the finding
- the **decision the snippet supports**: rewrite_in_place / extract_to_side_by_side / keep_at_level_b

Persist as `.cache/sap-clean-core/<topic-hash>/<source-id>-<yyyy-mm-dd>.md`. The plan in Step 5 cites these paths.

### 4d — Budget exhaustion handling

If the per-finding lookup budget runs out without a definitive answer, mark the finding as **research-required** in the plan. Do **not** guess. The plan's "Research backlog" section flags these for human investigation.

For `research_required` findings, the skill optionally invokes [`../explain-abap-code/SKILL.md`](../explain-abap-code/SKILL.md) on the specific object to produce a structured deep-dive (object purpose, dependencies, style classification, suggested investigation paths). This narrows the human research scope from "open the code" to "verify or refute this hypothesis", reducing per-finding manual effort by ~50%.

### 4d-quater — Pattern mining (`SAPRead(VERSIONS)`)

Before generating rewrite suggestions for a non-trivial finding, the skill mines the project's own history via ARC-1:

```
SAPRead(type="VERSIONS", object_type="CLAS", object_name="<similar-Z-class>")
SAPRead(type="VERSION_SOURCE", object_type="CLAS", object_name="<class>", revision="<rev-with-relevant-change>")
```

The signal: how have **similar** Z objects in this package or neighbouring packages been migrated **already** by the customer's own team? Pattern matches on naming (`ZCL_*_OLD`, `ZCL_*_V2`, `ZCL_NEW_*`), version history of the target class, or `SAPTransport(action="history")` on the package.

When a pattern emerges (e.g. "every BAPI replacement in this customer's code follows pattern X with helper Z"), the rewrite suggestion adopts the same pattern instead of a generic SAP-recommended one. **Reduces rewrite effort by 30-50% on customers with established conventions**. The mined pattern is cited in the plan alongside the SAP-released-API citation.

### 4d-bis — Decision tree (per-object)

For each Z/Y object with a starting Clean Core Level (A / B / C / D / Unused), apply this decision tree to determine the **decision** and the **target level**. The default behaviour is cost-minimizing per object; `--target-level` and `--aggressive` / `--push-to-a` flags shift the preference.

```
Object starting level = A?
  YES → decision = no_action (target = A)
        STOP

Object starting level = Unused?
  YES → decision = remove_unused (target = N/A)
        STOP

Object starting level = D (Modification)?
  YES → Released-API equivalent fully replaces the modification?
          YES → decision = rewrite_in_place via released API (target = A)
          NO  → BAdI / enhancement-point eligible substitute exists?
                  YES (default behaviour)        → decision = rewrite_in_place via BAdI (target = B)
                  YES + --target-level=A flag    → continue to side-by-side check
                  NO                             → continue to side-by-side check
                Side-by-side extraction feasible (CAP + BTP target available)?
                  YES → decision = extract_to_side_by_side (target = A, ERP-side; logic lives on BTP)
                  NO  → decision = accept_as_d_documented (requires explicit sign-off + ATC exemption)
        STOP

Object starting level = C (Warning — non-released-api or direct-db-access)?
  YES → Released-API / released-CDS equivalent exists?
          YES (default behaviour)        → decision = rewrite_in_place via released API (target = A)
          YES + --target-level=B flag    → BAdI substitution path cheaper? if yes, decision = rewrite_in_place via BAdI (target = B)
          NO                             → continue
        Is the residual logic data-access-only (no business logic)?
          YES → decision = keep_at_level_b with documentation (target = B)
          NO  → Side-by-side extraction feasible?
                  YES → decision = extract_to_side_by_side (target = A, ERP-side)
                  NO  → decision = keep_at_level_b with documentation (target = B)
        STOP

Object starting level = B (Eligible)?
  YES → --aggressive or --push-to-a covers this object or --target-level=A?
          YES → emit multi-option proposal (Step 4e/4f)
                  default_decision: keep_at_level_b (target = B)
                  option 1: rewrite_in_place via Customizing (target = A)
                  option 2: extract_to_side_by_side (target = A, ERP-side)
          NO  → decision = keep_at_level_b with documentation (target = B)
        STOP
```

**Key invariants**:
- A → only stays A (no_action).
- B → stays B (default) OR goes to A (only via opt-in escalation).
- C → goes to A (default) OR to B (only via `--target-level=B`) OR side-by-side (A, ERP-side) when no equivalent.
- D → goes to B (default via BAdI) OR to A via side-by-side (when BAdI not feasible OR `--target-level=A` is on) OR accept_as_d (last resort with explicit sign-off).
- Unused → removed (no level applies).

**Side-by-side outcome — clarification**: when an object is extracted to BTP, the **ERP-side artefact disappears**. The ERP no longer contains the custom code, so by absence the ERP is at Level A for that domain. The logic continues to live on BTP as a CAP extension (not classified by ABAP Clean Core levels — BTP-side compliance is governed by the deployment-target gate, see [`../sap-cap-clean-core-enforce/SKILL.md`](../sap-cap-clean-core-enforce/SKILL.md)).

### 4e — Level B → Level A escalation (aggressive mode)

By default, an object classified Level B by `sap-clean-core-atc` is decided `keep_at_level_b` — it is already Clean-Core compliant; pushing to A is effort with diminishing returns, and the chosen pattern (BAdI, Key User Extensibility, custom CDS on released base, …) is usually the SAP-recommended one for the use case.

When the user opts into escalation (`--aggressive` for all Level B, OR `--push-to-a=A,B,C` for selected objects), the skill performs an **extended analysis** per Level B finding: it researches Level A escalation paths in addition to the default decision, and emits a **multi-option proposal** instead of a single decision.

**Why this is not the default**:

- Level B is already compliant (Clean Core green).
- Most B objects exist because the SAP-recommended pattern IS a B-eligible extension (BAdI, key-user, custom CDS on released base). Pushing to A means *removing the extension*, which often defeats the purpose.
- Each `--aggressive` pass adds ~30-50% to per-finding cost (extra Apify lookups for Customizing alternatives + side-by-side patterns + extension samples cross-check).

**When the user DOES want escalation**:

| Scenario | Reason |
|---|---|
| Governance mandate: "zero custom logic in ERP" | Organizational policy supersedes SAP defaults |
| Target deployment: S/4HANA Public Cloud strict mode | Public Cloud rejects most B patterns; must go A or side-by-side |
| Strong BTP team available | Side-by-side extraction is cleaner long-term |
| Object's B pattern was an accident ("did it custom 4 years ago for laziness") | Customizing alternative exists and is simpler |
| Object's B pattern uses a deprecated BAdI / enhancement-point | Forced migration anyway — escalate to choose target |

**When the user should NOT escalate**:

| Scenario | Reason |
|---|---|
| Object uses an SAP-blessed BAdI / Key User app | You're already at the SAP-recommended pattern; A would mean abandoning it |
| Object is a stable lookup table (e.g. country-specific tax rates) | B with documentation is correct; A would mean "no logic", which loses business meaning |
| Customer has no BTP plan and no Customizing alternative | Side-by-side and config rewrite both blocked; B is the only option |
| Effort budget is tight | A escalation costs 2-5× the effort of B-keep |

### 4f — Extended decision logic for escalated findings

When an object is in the escalation set (matched by `--aggressive` or `--push-to-a`):

1. **First**, perform the standard Level B classification check (Step 4b) — record what pattern made it eligible.
2. **Then**, run the escalation lookup:
   - Search the KB for "Customizing alternative to <pattern>" → if found, propose `rewrite_in_place` via standard Customizing.
   - Search the KB for "side-by-side pattern for <domain>" → if found, propose `extract_to_side_by_side`.
   - If neither escalation path is found, fall back to `keep_at_level_b` (as default).
3. **Emit a multi-option proposal** in the plan instead of a single decision:

```yaml
ZTABLE_TAX_RATES_LOCAL  # currently Level B via BAdI BADI_TAX_RATE_DETERMINATION
  default_decision: keep_at_level_b
  default_effort: S (2-4 h)
  default_risk: low
  escalation_options:
    - decision: rewrite_in_place
      replacement: Tax Customizing (T007A entries via SM30 / Key User app)
      effort: M (8-12 h)
      risk: medium (may not cover all custom rules — needs validation per country)
      kb_evidence: kb-cache/<hash>/help-sap-tax-customizing-2026-05-13.md
    - decision: extract_to_side_by_side
      pattern: BTP CAP tax service consumed via Cloud SDK
      effort: L (16-24 h)
      risk: medium (introduces BTP runtime dependency)
      kb_evidence: kb-cache/<hash>/cap-tax-service-pattern-2026-05-13.md
  recommended: extract_to_side_by_side (consistent with vendor risk score extension already planned)
```

The recommendation is informed by **consistency with other decisions in the same plan**: if the plan already has 5 side-by-side extensions and this Level B is in the same domain, recommend side-by-side too. If the plan is otherwise all in-place rewrites, recommend Customizing.

### 4g — Per-object override mechanism (post-plan editing)

After the plan is emitted, the user can ALWAYS override any decision by editing `docs/refactor/<date>-clean-core-plan.md` between Step 5 and Step 6. The plan file is the contract: `execute` mode reads it back and respects the latest decision. Useful for:

- Overriding `keep_at_level_b` to `rewrite_in_place` for one specific object after manual inspection.
- Downgrading an `extract_to_side_by_side` to `keep_at_level_b` after cost concerns surface.
- Adding research notes to `research_required` findings before re-running.

This is the **finest-grained control mechanism**, complementary to `--aggressive` / `--push-to-a`. No re-run needed; just edit and execute.

## Step 5: Refactor plan emission

Output to `docs/refactor/<yyyy-mm-dd>-clean-core-plan.md`:

```markdown
# Clean Core Return + Side-by-Side Refactor Plan — <yyyy-mm-dd>

## Target deployment
- Side-by-side framework: SAP CAP (Node.js + TypeScript)
- Side-by-side runtime: <btp-cf | btp-kyma | onprem-kyma>
- Lookup budget: 5 Apify pages + 1 git lookup + 1 MCP query per finding (default)
- Apify lookups consumed: <N> (estimated cost: €<X>)
- Cache hits: <N> (no cost; reused from prior runs)

## Inventory summary
- Total Z/Y objects in scope: <N>
- Active: <N> | Unused: <N>
- Level A: <N> | Level B: <N> | Level C: <N> | Level D: <N>

## Refactor plan per object

Per-object table with explicit starting-level → target-level transitions:

| Object | Start Level | Target Level | Decision | Replacement / Pattern | Effort | Risk | KB evidence |
|---|---|---|---|---|---|---|---|
| ZCL_INVOICE_HANDLER | D | A | rewrite_in_place | API_SUPPLIERINVOICE_PROCESS_SRV (released) | M (6h) | low | .cache/.../api-supplierinvoice-2026-05-13.md |
| ZCL_VENDOR_RISK_SCORE | C | A (ERP-side) | extract_to_side_by_side | CAP service on BTP Kyma + Event Mesh subscribe to BusinessPartnerChanged | L (24h) | medium | .cache/.../cap-event-mesh-2026-05-13.md |
| ZTABLE_TAX_RATES_LOCAL | D | B | rewrite_in_place via BAdI | BADI_TAX_RATE_DETERMINATION (eligible) | M (8h) | medium | .cache/.../tax-badi-2026-05-13.md |
| ZRFI_REPORT_OLD | (Unused) | — | remove_unused | (none) | S (1h) | low | sap-unused-code report |
| ZDDLS_VENDOR_VIEW | B | B | keep_at_level_b | (annotation hygiene fix only) | S (2h) | low | (no escalation requested) |
| (… rest of objects …) | | | | | | | |

**Column meanings**:
- **Start Level**: classification by `sap-clean-core-atc` before refactor (A/B/C/D/Unused).
- **Target Level**: classification expected after refactor lands. For `extract_to_side_by_side`, the target is "A (ERP-side)" because the ERP no longer contains the artefact; the logic lives on BTP under separate compliance rules.
- **Decision**: one of `no_action` / `rewrite_in_place` / `rewrite_in_place via BAdI` / `extract_to_side_by_side` / `keep_at_level_b` / `remove_unused` / `accept_as_d_documented` / `research_required`.
- **Replacement / Pattern**: the concrete substitute (released API, BAdI name, BTP CAP pattern, …).

## Level B escalation proposals (only if --aggressive or --push-to-a was used)
[For each Level B object in the escalation set, multi-option proposal showing:
 - default_decision (keep_at_level_b)
 - escalation_options (rewrite_in_place via Customizing, extract_to_side_by_side via BTP)
 - recommended option with reasoning
 - per-option effort + risk + KB evidence]

The user reviews and chooses per object by editing the plan file before invoking execute.
Default behaviour (no flag): every Level B is kept; no escalation proposals are generated.

## Side-by-side extension catalog
[For every "extract" outcome, the proposed CAP extension scaffold spec]

## Sequencing
1. Remove unused (parallel): <N> objects
2. Document Level B keep-as-is (parallel): <N> objects
3. Rewrite in-place — phase 1 (low-risk): <N> objects
4. Rewrite in-place — phase 2 (medium-risk): <N> objects
5. Side-by-side extraction — per-extension PR cadence: <N> extensions
6. Level B escalations chosen by user (if any): mixed cadence per chosen path

## Effort estimate
- Total: <hours> across <count> objects (default plan)
- Critical path: <hours>
- Quick wins (unused + documentation): <hours>
- Escalation deltas (if aggressive/push-to-a used):
  * Keep at B (default): <hours>
  * Rewrite via Customizing (option 1): <hours>
  * Side-by-side extraction (option 2): <hours>
  User chooses per object; effort can vary 2-5× depending on choices.

## Research backlog (budget-exhausted findings)
[Items where the lookup budget was insufficient; flag for human research]

## Source citations
[Path → URL → retrieval timestamp for every cache entry that fed a decision]
```

## Step 6: Execute mode (opt-in)

`mode = execute` enables real changes. The skill processes objects one at a time, asks confirmation per object, and routes each to:

### 6-pre — Generate regression tests BEFORE the rewrite

For every object whose decision is `rewrite_in_place` and that has no existing unit test, the skill invokes [`../generate-abap-unit-test/SKILL.md`](../generate-abap-unit-test/SKILL.md) (for `CLAS` / `FUGR`) or [`../generate-cds-unit-test/SKILL.md`](../generate-cds-unit-test/SKILL.md) (for `DDLS`) **before** the rewrite is applied.

The pre-rewrite tests capture the **current behaviour** as a baseline. After the rewrite they become the regression gate: if any pre-rewrite test fails post-rewrite, the rewrite is rolled back via `SAPGit`. Without this gate, "ATC pass" alone is not a sufficient verification — ATC checks syntax/policy compliance, not semantic equivalence.

For objects where test generation is infeasible (too complex, too many DB dependencies), the skill flags the rewrite as **`rewrite_in_place_no_tests`** in the plan: the user can still proceed but acknowledges the higher risk.

### 6a — Rewrite in-place (Outcome 1)

Delegate to ARC-1 MCP:
```
SAPRead(type="VERSIONS", ...) → confirm no concurrent writer
SAPWrite(action="update", object_type="CLAS", object_name="ZCL_X", source="<rewritten-source>")
SAPActivate(scope="object", object_type="CLAS", object_name="ZCL_X")
SAPLint(action="format", object_name="ZCL_X")        ← honor project formatter from system-info.md
SAPLint(action="run_atc", scope="object", object_name="ZCL_X", target_level="A")
SAPDiagnose(action="run_unit_tests", scope="object", object_name="ZCL_X")  ← run regression tests
```

For rewrites that introduce RAP behavior pool logic, delegate to [`../generate-rap-logic/SKILL.md`](../generate-rap-logic/SKILL.md). For rewrites that introduce a full RAP service stack (rare in refactor but possible), delegate to [`../generate-rap-service-researched/SKILL.md`](../generate-rap-service-researched/SKILL.md).

Roll back via `SAPGit` if ATC regresses OR regression tests fail.

### 6b — Side-by-side scaffold (Outcome 2)

Delegate to [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md). The source ABAP object is **not yet removed** — both coexist until QA confirms parity. Optionally annotate the ABAP source as deprecated.

When the side-by-side target has a Fiori Elements UI, [`../convert-ui5-to-fiori-elements/SKILL.md`](../convert-ui5-to-fiori-elements/SKILL.md) generates the UI on top of the new CAP service.

### 6c — Document Level B keep-as-is (Outcome 3)

Delegate to [`../sap-object-documenter/SKILL.md`](../sap-object-documenter/SKILL.md) which produces structured SKTD documentation explaining the eligible-Level-B rationale (which BAdI / enhancement-point pattern the object uses, what business rule it implements, why no released alternative). Update ATC exemption configuration if the project uses one (`SAPLint` exemption file).

### 6.5 — Transport management

For every object touched in this execute pass, route the change through a coordinated transport:

```
SAPTransport(action="requirement_check", object="<obj>", target="<TR>")  ← ensure deps reachable
SAPTransport(action="create", description="Clean Core Phase <N> — <package>") OR reuse open TR
SAPTransport(action="reassign", object="<obj>", from="<auto>", to="<chosen-TR>")
```

For projects with abapGit / gCTS, [`SAPGit`](https://github.com/marianfoo/arc-1) (with `SAP_ALLOW_GIT_WRITES=true`) auto-commits the change with a structured message: `chore(clean-core): rewrite ZCL_X to released API X (Phase N)`.

## Step 7: Verification

After any execute action:
- **ATC regression check** (`SAPLint(run_atc)`): the gate that blocks the execute loop if findings count regresses.
- **Unit test regression** (`SAPDiagnose(run_unit_tests)`): runs the tests generated in Step 6-pre PLUS pre-existing tests. Any failure aborts the loop.
- **Cross-check against the audit catalog** used by [`../sap-cap-clean-core-enforce/SKILL.md`](../sap-cap-clean-core-enforce/SKILL.md) if the CAP side has been deployed.
- **Compare ATC counts before/after**; any net regression aborts the execute loop and surfaces a finding.
- **Optional**: invoke [`../analyze-chat-session/SKILL.md`](../analyze-chat-session/SKILL.md) at session end to capture learnings (which rewrite patterns worked, which findings recurred) and propose new skill traps for the team.

## BTP vs On-Premise Differences

The decision tree is the same; what differs is the **side-by-side target framework choice**:

| Target | Side-by-side framework | Storage | Eventing |
|---|---|---|---|
| BTP CF *(default)* | CAP Node.js / TypeScript | HANA HDI | BTP Event Mesh |
| BTP Kyma | CAP Node.js / TypeScript | PostgreSQL in-cluster or HANA Cloud | BTP Event Mesh or Kyma-native NATS |
| On-Premise Kyma | CAP Node.js / TypeScript | HANA on-prem or PostgreSQL on-prem | Kyma-native NATS |

See [`../sap-cap-fiori-battle-tested-patterns/SKILL.md#category-3--btp--kyma--on-premise-deployment-lessons`](../sap-cap-fiori-battle-tested-patterns/SKILL.md) Category 3 for per-target deployment patterns.

## Cost model

The skill is designed so total Apify cost for a typical refactor is **€0.50-€5** charged to the **user's own Apify account**, not to a centralized infrastructure.

| Item | Estimated cost |
|---|---|
| Discovery (ARC-1 only) | €0 |
| Classification (ATC + git-clone) | €0 |
| Per-finding JIT Apify (5 pages × ~€0.01) | €0.05 |
| Refactor plan of 50 findings (default mode) | ~€2.50 |
| Refactor plan of 200 findings (default mode) | ~€10 |
| Re-running the plan within 30 days (cache hit) | €0 |
| `--aggressive` mode delta (extra escalation lookups per Level B) | +30-50% on plan cost |
| `--push-to-a=<list>` selective (3-5 extra lookups per listed object) | +€0.05-€0.10 per object |

Example: a 200-finding refactor with **default** = ~€10. The same with `--aggressive` = ~€13-15. The same with `--push-to-a` on 8 specific objects = ~€11.

For projects with no Apify budget, the skill operates in **manual mode**: it emits the plan with `consult URL X manually` pointers; the user pastes back doc snippets; the skill incorporates them. Slower, but zero cost. Escalation modes (`--aggressive` / `--push-to-a`) still work in manual mode — they just produce more "consult manually" pointers per object.

## Error Handling

| Symptom | Likely cause | Action |
| --- | --- | --- |
| ARC-1 MCP not reachable | MCP server not started / not authenticated | Stop; print setup instructions |
| Apify MCP not available | User hasn't installed it | Degrade to manual mode; emit URL pointers, prompt for paste-back |
| Apify rate-limited | User's account hit per-second limit | Backoff with jitter; warn on persistent throttling |
| ATC regression after execute | Rewrite introduced new findings | Roll back via SAPGit; surface diff |
| Side-by-side scaffold generation fails | `modernize-abap-to-btp-cap` errored | Capture error; plan unchanged; flag for retry |
| Budget exhausted on a finding | Source landscape doesn't cover this case | Mark research-required; do NOT guess |
| Cache poisoned (stale snapshot) | Source page changed without TTL expiry | User invokes `--force-refresh` |

## What This Skill Does NOT Do

- Does **not** plan a system upgrade. Use SAP Activate methodology for that.
- Does **not** decide whether the customer should adopt BTP — strategic decision.
- Does **not** invent SAP knowledge — every claim is source-cited.
- Does **not** modify SAP-standard code (only `Z*` / `Y*` / customer namespace).
- Does **not** generate the side-by-side CAP scaffold inline — delegates to `modernize-abap-to-btp-cap`.
- Does **not** perform data migration from Z-tables to BTP storage — separate ETL exercise.
- Does **not** pre-build or maintain a centralized SAP documentation cache. JIT only.

## When to Use This Skill

- Customer is planning a Clean Core compliance program.
- Customer needs a refactor plan with effort estimates to scope the program.
- Pre-S/4HANA migration: classify and reduce custom code before the system move.
- Post-S/4HANA: re-validate Clean Core compliance and extract residual custom logic to BTP.
- Annual / quarterly governance review.

## When NOT to Use

- For a single small change to a Z object (use ARC-1 directly).
- For green-field BTP development (use `modernize-abap-to-btp-cap` directly).
- For a system upgrade plan (use SAP Activate).
- When the customer hasn't decided to adopt BTP — propose a discovery / readiness assessment first.

## Battle-Tested Patterns Referenced

This skill builds on [`../sap-cap-fiori-battle-tested-patterns/SKILL.md`](../sap-cap-fiori-battle-tested-patterns/SKILL.md):

- **3.0 Deployment target decision matrix** — selecting the right BTP target for the extension.
- **3.A.* / 3.B.* / 3.C.* / 3.D.*** — target-specific deployment patterns.
- **3.11 Clean Core Level A as deployment gate** — the gate the CAP extension must pass.

For the ABAP side:
- [`../sap-clean-core-atc/SKILL.md`](../sap-clean-core-atc/SKILL.md) — Level A/B/C/D classification.
- [`../sap-unused-code/SKILL.md`](../sap-unused-code/SKILL.md) — dead-code identification.
- [`../migrate-custom-code/SKILL.md`](../migrate-custom-code/SKILL.md) — ATC fix patterns when rewriting.

For the side-by-side:
- [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md) — top-level orchestrator.
- [`../modernize-abap-cap-schema/SKILL.md`](../modernize-abap-cap-schema/SKILL.md) — Z-table → CDS entity.
- [`../modernize-abap-cap-service/SKILL.md`](../modernize-abap-cap-service/SKILL.md) — FM / program → CAP service.

## Recommended Companion Plugins

The plugins below split into **MUST** (the skill is materially less useful without them) and **SHOULD/OPTIONAL** (situationally valuable depending on the refactor's target).

### MUST — required for the skill to function correctly

| Plugin / Skill / MCP | Used for |
|---|---|
| **ARC-1 MCP server** | All 12 ABAP-side operations: discovery (`SAPSearch`), impact (`SAPContext`), classification (`SAPLint`), pattern mining (`SAPRead`), rewrite (`SAPWrite` + `SAPActivate`), verification (`SAPDiagnose`), transport (`SAPTransport`). The skill is non-functional without it |
| **`sap-abap`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-abap)) | Authoritative reference for ABAP language patterns (Cloud-compatible syntax, OO, EML, RTTI/RTTC, exception handling, ABAP SQL, dynamic programming). Required during Step 6a `rewrite_in_place` so the generated ABAP is Cloud-compatible by construction |
| **`sap-abap-cds`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-abap-cds)) | CDS view design reference (associations, annotations, DCL access control, CURR/QUAN handling, CASE expressions, built-in functions). Required when the rewrite introduces new CDS views (e.g. replacing direct-DB-access with a view projection) |
| **`sap-cap-capire`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-cap-capire)) | CAP framework knowledge: CDS modeling, service handlers, deployment, multitenancy. Ships **4 dispatchable agents** the skill invokes during Step 6b side-by-side scaffold: `cap-cds-modeler`, `cap-service-developer`, `cap-performance-debugger`, `cap-project-architect` |
| **`sap-btp-developer-guide`** ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sap-btp-developer-guide)) | Comprehensive BTP reference; broad enough to cover all four target deployments. Required during Step 1c side-by-side target resolution and Step 6b scaffold generation |

### SHOULD — strongly recommended depending on refactor scope

| Plugin / Skill | When |
|---|---|
| `sap-btp-cloud-platform` | When the side-by-side scaffold binds BTP-managed services |
| `sap-btp-connectivity` | When the extension consumes S/4 via Destination service + Cloud Connector |
| `sap-fiori-tools` | When the side-by-side extension exposes a Fiori Elements UI |
| `sapui5` ([secondsky/sap-skills](https://github.com/secondsky/sap-skills/tree/main/plugins/sapui5)) | UI5 framework reference for the extension UI; ships 4 dispatchable agents (ui5-api-explorer, ui5-app-scaffolder, ui5-code-quality-advisor, ui5-migration-specialist) |
| `sapui5-linter` | Code quality gate for the generated UI5 |
| `sap-cloud-sdk` | When the extension uses Cloud SDK to consume S/4 services |
| `sap-cloud-sdk-ai` | When the extension includes LLM/embedding logic (e.g. document classification, vendor risk scoring) |

### OPTIONAL — situational

| Plugin / Skill | When |
|---|---|
| **Apify MCP server** | JIT documentation lookups against HTTP/SPA sources (api.sap.com, help.sap.com). Falls back to manual mode if absent |
| `mcp-sap-docs` | Preferred over Apify for SAP Help Portal queries when installed |
| `context7` | Generic library docs for non-SAP dependencies in the extension |
| `sap-btp-job-scheduling` | When the side-by-side includes scheduled jobs |
| `sap-btp-cloud-logging` | Observability for the production extension |
| `sap-btp-master-data-integration` | When the extension subscribes to MDI events (BusinessPartnerChanged etc.) |
| `sap-btp-cloud-transport-management` | When the customer uses cTMS for coordinated transport across S/4 + BTP |
| `sap-btp-cias` | When the customer uses SAP Cloud Identity Services (IAS) instead of XSUAA |
| `sap-btp-business-application-studio` | Dev environment reference for hand-off to the customer's developer team |
| `sap-btp-integration-suite` | When the side-by-side pattern uses iFlows instead of direct CAP |
| `sap-btp-build-work-zone-advanced` | When the extension UI must surface in SAP Work Zone |

### arc-1 native skill chain (already cross-linked in the steps above)

| arc-1 skill | Invoked from |
|---|---|
| [`bootstrap-system-context`](../bootstrap-system-context/SKILL.md) | Step 1e (prereq) |
| [`setup-abap-mirror`](../setup-abap-mirror/SKILL.md) | Step 1 (optional read-only exploration) |
| [`explain-abap-code`](../explain-abap-code/SKILL.md) | Step 4d (research_required fallback) |
| [`sap-clean-core-atc`](../sap-clean-core-atc/SKILL.md) | Step 3 (delegate) |
| [`sap-unused-code`](../sap-unused-code/SKILL.md) | Step 2d (delegate) |
| [`sap-object-documenter`](../sap-object-documenter/SKILL.md) | Step 6c (delegate Level B documentation) |
| [`generate-abap-unit-test`](../generate-abap-unit-test/SKILL.md) | Step 6-pre (regression test for CLAS/FUGR before rewrite) |
| [`generate-cds-unit-test`](../generate-cds-unit-test/SKILL.md) | Step 6-pre (regression test for DDLS before rewrite) |
| [`generate-rap-logic`](../generate-rap-logic/SKILL.md) | Step 6a (when rewrite introduces RAP behavior pool logic) |
| [`generate-rap-service-researched`](../generate-rap-service-researched/SKILL.md) | Step 6a (when rewrite introduces full RAP stack — rare) |
| [`migrate-segw-to-rap`](../migrate-segw-to-rap/SKILL.md) | Step 6a (when the Z package contains a SEGW V2 service to modernize in parallel) |
| [`migrate-custom-code`](../migrate-custom-code/SKILL.md) | Step 6a (sibling — ATC fix patterns for rewrite findings) |
| [`modernize-abap-to-btp-cap`](../modernize-abap-to-btp-cap/SKILL.md) chain | Step 6b (side-by-side scaffold orchestrator) |
| [`convert-ui5-to-fiori-elements`](../convert-ui5-to-fiori-elements/SKILL.md) | Step 6b (Fiori Elements UI on top of new CAP service) |
| [`analyze-chat-session`](../analyze-chat-session/SKILL.md) | Step 7 (session-end learnings capture) |

See [`./INTEGRATIONS.md`](./INTEGRATIONS.md) for the full step-by-step mapping of refactor phase × ARC-1 MCP tool × arc-1 skill × secondsky plugin. See [`../sap-cap-fiori-battle-tested-patterns/SKILL.md#category-8--ecosystem-plugin-landscape`](../sap-cap-fiori-battle-tested-patterns/SKILL.md) for the broader companion plugin map across CAP audit skills.

## See also

- [`./SOURCES.md`](./SOURCES.md) — curated list of authoritative SAP documentation sources consulted by this skill (just the URLs + when-to-use guidance, no crawled content).

## References

- [SAP/abap-atc-cr-cv-s4hc README](https://github.com/SAP/abap-atc-cr-cv-s4hc/blob/main/README.md) — Released ABAP objects authority
- [SAP API Hub (`api.sap.com`)](https://api.sap.com/) — OData service catalog + lifecycle
- [Clean Core principles (help.sap.com)](https://help.sap.com/docs/btp/sap-business-technology-platform/clean-core)
- [SAP Custom Code Migration Guide](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c160bf4ba0fc415da4d34d29c1547d27/d4f8e6cb9c4d4fd99b6a96b3e64dd8e2.html)
- [Apify Website Content Crawler docs](https://apify.com/apify/website-content-crawler)
- [Apify Puppeteer Scraper docs](https://apify.com/apify/puppeteer-scraper)
