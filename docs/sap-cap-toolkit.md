# SAP CAP + Clean Core Toolkit — Overview & Navigation Guide

A consolidated guide to the **13-skill SAP toolkit** contributed across PRs #278, #279, #280, and #281: end-to-end coverage from ABAP custom-code refactor through CAP service development to BTP deployment, with audits, gates, and battle-tested patterns.

---

## 1. Mission

SAP customers carry decades of custom ABAP code that needs to evolve toward **Clean Core compliance** and **side-by-side BTP extensions**. The journey is multi-step:

1. **Inventory** the custom code that exists.
2. **Classify** each object against Clean Core Levels A/B/C/D.
3. **Decide**, per object, between rewrite-in-place, side-by-side extraction, keep-at-B, or remove.
4. **Generate** the rewritten ABAP and/or the new BTP CAP scaffold.
5. **Verify** with regression tests and ATC gates.
6. **Audit** the resulting CAP+Fiori+BTP application end-to-end before deployment.
7. **Enforce** compliance as CI gates that catch regressions.

This toolkit covers all seven steps in a coherent, generic, OSS-shareable form. Every contribution is **100% generic** — no domain-specific names, no customer-specific patterns hardcoded. The toolkit operates on **any** SAP CAP + ABAP + Fiori project.

### Audience

- **SAP architects** planning Clean Core programs or pre/post-S/4HANA migrations.
- **SAP delivery teams** building BTP applications that consume S/4HANA Tier-2 services.
- **Customer development teams** modernizing legacy ABAP custom code.
- **SAP partners** delivering Clean Core compliance assessments and refactor projects.

### Scope

| In scope | Out of scope |
|---|---|
| CAP service development (Node.js + TypeScript) | CAP Java runtime (patterns differ; future contribution) |
| Fiori Elements V4 apps + UI5 freestyle | SAPUI5 < 1.108 (legacy UI5; use modernize-ui5-app for migration) |
| BTP Cloud Foundry + BTP Kyma + On-Premise Kyma | On-Premise CF (EOL) |
| S/4HANA Public Cloud + Private Cloud + On-Premise | ECC < 6.0 (use SAP Activate methodology for migration first) |
| ABAP custom code refactor (Z*/Y*/namespace) | ABAP standard code (never touched) |
| Released APIs only (Clean Core Level A target) | Non-released RFC/BAPI consumption (flagged for refactor) |

---

## 2. Quick start (30 seconds)

```bash
# Pre-flight (one-time)
gh repo clone marianfoo/arc-1-fork
cd arc-1-fork
npx skills add Raistlin82/arc-1-fork -g -y                       # install all 13 skills
npx skills add secondsky/sap-skills -s sap-abap -g -y            # required companion
npx skills add secondsky/sap-skills -s sap-abap-cds -g -y
npx skills add secondsky/sap-skills -s sap-cap-capire -g -y
npx skills add secondsky/sap-skills -s sap-btp-developer-guide -g -y

# Set up ARC-1 MCP server connection to your SAP system (see arc-1 README)

# Three most common invocations
/sap-erp-clean-core-refactor ZFI plan                            # plan a Clean Core refactor (default target=btp-cf)
/sap-cap-stack-audit-full                                         # pre-release audit of a CAP project
/sap-cap-clean-core-enforce --enforce                            # block deployment if non-released API consumed
```

---

## 3. Toolkit at a glance

### Visual map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        REFERENCE LAYER (knowledge base)                 │
│  sap-cap-fiori-battle-tested-patterns                                   │
│  ~70 patterns in 8 categories — UI5/FE V4 traps, CAP/TS, BTP deploy,    │
│  security, customizing, lifecycle, events, ecosystem plugins            │
└─────────────────────────────────────────────────────────────────────────┘
                            ↑ cross-link by anchor
                            │
┌───────────────────────────┴─────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                              │
│  sap-cap-stack-audit-full  (master orchestrator, asks target)           │
│  sap-cap-ci-gates-pattern  (5 reusable CI gate patterns)                │
└─────────────────────────────────────────────────────────────────────────┘
                            ↑ orchestrates / generates
                            │
┌───────────────────────────┴─────────────────────────────────────────────┐
│                          AUDIT LAYER                                    │
│  sap-cap-clean-core-enforce  (Tier-2 S/4 API gate, --enforce mode)      │
│  sap-cap-customizing-honor   (bidirectional CSV↔code, ValueList)        │
│  sap-cap-security-rbac-matrix (OWASP/ASVS/NIST/CIS/SAP-SOM matrix)      │
│  sap-fiori-app-audit          (per-app UI/UX + FE/BE contract)          │
│  sap-cap-text-polish          (user-text + PII detection)               │
└─────────────────────────────────────────────────────────────────────────┘
                            ↑ produces findings consumed by gates above
                            │
┌───────────────────────────┴─────────────────────────────────────────────┐
│                    REFACTOR / MIGRATION LAYER                           │
│  sap-erp-clean-core-refactor (Z* refactor planner + executor, JIT KB)   │
│   ├── SKILL.md     — 668 lines protocol                                 │
│   ├── SOURCES.md   — 23 SAP sources organized in 4 tiers                │
│   └── INTEGRATIONS.md — full mapping ARC-1 MCP × skill × secondsky      │
│                                                                          │
│  modernize-abap-to-btp-cap  (top-level orchestrator)                    │
│   ├── modernize-abap-cap-schema  (Z-table → CDS entity)                 │
│   └── modernize-abap-cap-service (FM/program → CAP service action)      │
└─────────────────────────────────────────────────────────────────────────┘
                            ↑ delegates to other arc-1 native skills
                            │
┌───────────────────────────┴─────────────────────────────────────────────┐
│              SUPPORT / DELEGATE SKILLS (existing arc-1 native)          │
│  bootstrap-system-context · setup-abap-mirror · explain-abap-code       │
│  sap-clean-core-atc · sap-unused-code · sap-object-documenter           │
│  generate-abap-unit-test · generate-cds-unit-test · generate-rap-logic  │
│  generate-rap-service-researched · migrate-segw-to-rap                  │
│  migrate-custom-code · convert-ui5-to-fiori-elements · modernize-ui5-app │
│  analyze-chat-session                                                   │
└─────────────────────────────────────────────────────────────────────────┘
                            ↑ executes operations via
                            │
┌───────────────────────────┴─────────────────────────────────────────────┐
│              EXECUTION LAYER (MCP servers + plugins)                    │
│  ARC-1 MCP server          — 12 ABAP intent-based tools (the hands)     │
│  secondsky/sap-skills       — 32 plugins (the library of patterns)       │
│   ├── sap-abap (MUST)                                                   │
│   ├── sap-abap-cds (MUST)                                               │
│   ├── sap-cap-capire (MUST, 4 dispatchable agents)                      │
│   ├── sap-btp-developer-guide (MUST)                                    │
│   └── 19 SHOULD / OPTIONAL plugins                                      │
│  Apify MCP (JIT documentation lookup, user-paid per page)               │
│  mcp-sap-docs (when installed — free SAP doc lookup)                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skill count and provenance

| Skill | Layer | PR | Provenance |
|---|---|---|---|
| `sap-cap-fiori-battle-tested-patterns` | Reference | #280 | New — distilled from production patterns |
| `sap-cap-stack-audit-full` | Orchestration | #280 | New — orchestrator |
| `sap-cap-ci-gates-pattern` | Orchestration | #280 | New — CI library |
| `sap-cap-clean-core-enforce` | Audit (gate) | #279 | New — Tier-2 S/4 API gate |
| `sap-cap-customizing-honor` | Audit | #279 | New — CSV ↔ code |
| `sap-cap-security-rbac-matrix` | Audit | #280 | New — OWASP/ASVS/NIST/CIS/SAP-SOM |
| `sap-fiori-app-audit` | Audit | #280 | New — single Fiori app |
| `sap-cap-text-polish` | Audit | #280 | New — user-text + PII |
| `sap-erp-clean-core-refactor` | Refactor | #281 | New — Z* refactor planner |
| `modernize-abap-to-btp-cap` | Refactor | #278 | New — top-level orchestrator |
| `modernize-abap-cap-schema` | Refactor | #278 | New — Z-table → CDS |
| `modernize-abap-cap-service` | Refactor | #278 | New — FM → CAP |

**Total: 12 new skills + 1 knowledge-base reference (battle-tested-patterns) = 13 contributed artifacts.**

---

## 4. Skill catalog

### 4.1 Reference — battle-tested patterns

#### `sap-cap-fiori-battle-tested-patterns`

A curated reference catalog of **~70 production-distilled patterns** organized in 8 categories. Not runnable — it's a knowledge base linked by anchor from other skills.

| Category | Pattern count | Examples |
|---|---|---|
| 1 — UI5 / Fiori Elements V4 traps | 12 | `@UI.Hidden` + `OperationAvailable` interaction; actions returning entity NO `.columns()`; `liveMode` only on small datasets; Composition vs Association for audit children |
| 2 — CAP / TypeScript pitfalls | 8 | `cds.tx` autonomous deadlock on SQLite; `forUpdate` before lifecycle UPDATE; post-commit side effects in `req.on('succeeded')`; cds.log discipline; centralized reject helper |
| 3 — BTP / Kyma / On-Premise deployment | 30+ | 4-target decision matrix (BTP CF default, BTP Kyma, On-Prem Kyma — On-Prem CF dropped as EOL); per-target sub-sections with 5-7 patterns each; Clean Core as deployment gate (3.11) |
| 4 — Security defense-in-depth | 7 | Audit log append-only 3-layer; PII sanitize before audit; magic bytes upload; per-class rate limiters; token rotation; OData $expand depth |
| 5 — Customizing-driven | 5 | SystemParameter SSOT + bounded cache; adapter dual-source fallback; per-tenant override; master-data ValueList enforcement; bidirectional CSV ↔ code |
| 6 — Lifecycle / process | 6 | Centralized phase boundary map; CAS marker for idempotent advance; touchless handler idempotency; exception auto-dispatch ordering |
| 7 — Events / messaging | 5 | Declarative event service; post-commit fire-and-forget; connection cache as Promise; idempotency key cross-emit; outbox replay mirror |
| 8 — Ecosystem plugin landscape | 16 entries | Map of all secondsky/sap-skills plugins applicable to CAP+Fiori projects |

Each pattern: **symptom** observed by users/operators → **root cause** in framework/runtime/deployment layer → **generic remedy** with portable code snippet.

### 4.2 Orchestration

#### `sap-cap-stack-audit-full`

Master orchestrator. Asks the deployment target (Step 0), runs all relevant audits in parallel, consolidates a deduplicated report. Engages every audit skill from §4.3 plus static checks (UI5 linter, manifest validation, CDS compile, TypeScript typecheck, hardcoded customizing sweep).

Always read-only. Output: a single markdown report under `docs/audit/<date>-stack-audit.md` with severity rollup A/B/C/D.

#### `sap-cap-ci-gates-pattern`

Library of **5 reusable CI gate patterns** (bidirectional CSV ↔ code; catalog raise-coverage; API-availability drift; convention/matrix drift; CSV schema lint). Two modes:
- `describe` (default) — print what each pattern would do.
- `apply` — generate the bash gate scripts + GitHub Actions / GitLab / Jenkins / BTP CI/CD workflow YAML.

The skill never executes the gates — it generates them so the user's CI runs them per-PR.

### 4.3 Audit

#### `sap-cap-clean-core-enforce`

**Discovery-driven Clean Core Level A enforcement** for CAP + S/4HANA projects. Three modes:
- `report` — read-only audit + markdown report
- `--apply` — safe additive corrections to the compatibility catalog
- `--enforce` — **CI-blocking gate** (non-zero exit on HIGH findings); pairs with `sap-cap-ci-gates-pattern` Pattern 3

Consults **two authoritative sources**:
1. `SAP/abap-atc-cr-cv-s4hc` (ABAP API Release State repository — JSON per object class)
2. `api.sap.com` (SAP API Hub — OData service lifecycle, Communication Scenarios)

Per cell of the matrix (service × edition), resolves disagreements: API Hub wins for OData service questions, abap-atc wins for raw ABAP object questions.

#### `sap-cap-customizing-honor`

Bidirectional CSV ↔ code customizing audit. Detects:
- **Inverse orphans** — code reads a parameter that the CSV doesn't seed (admin doesn't know it's configurable).
- **Forward orphans** — CSV seeds a parameter that no code reads (admin thinks they can configure but it's ignored).
- **Hardcoded business decisions** — thresholds/timeouts in code that should be SystemParameter.
- **Master-data unreferenced** — FK fields without `@Common.ValueList` annotation.

Has `fix` mode that applies safe additive corrections (add CSV seed for inverse-orphan; add ValueList annotation on filter bar).

#### `sap-cap-security-rbac-matrix`

Multi-area parallel security scan + role coherence matrix. Five area agents run in parallel (S1 handlers, S2 MCP endpoints, S3 file-upload, S4 deploy YAML, S5 background jobs), one orthogonal OWASP pass (O1, 10 categories). Maps every finding to ≥1 framework citation:

- OWASP Top 10 2021
- OWASP API Security Top 10 2023
- ASVS L1-L3
- NIST CSF 2.0 + NIST SP 800-53
- CIS Kubernetes 1.9 / Docker 1.6
- SAP Secure Operations Map 2024
- GDPR + SOX 404

Role coherence matrix across 4 layers: `xs-security.json` ↔ IdP realm (XSUAA/Keycloak/IAS) ↔ `services-auth.cds` ↔ handlers. Drift between layers is a HIGH finding.

#### `sap-fiori-app-audit`

Single Fiori Elements V4 app audit. Walks the canonical user journey (entry → filter → list → detail → action → refresh), validates the frontend/backend contract chain (annotation → flag → READ projection → `@restrict` grant → handler → SideEffects → test).

Three failure classes:
- **UX-positive-false** — button visible, backend rejects → user gets 403/409.
- **UX-negative-false** — button hidden, backend would allow → user stuck.
- **Stuck state** — no button visible, no auto-job advances → entity dead in status.

Has `fix` mode for safe quick wins (missing `@Core.OperationAvailable`, missing `@Common.SideEffects`, missing tooltip, missing i18n fallback).

#### `sap-cap-text-polish`

Audit and rewrite all user-visible text — backend reject/throw, helper rejects, frontend toasts/dialogs, i18n bundles, CDS labels, CodeList descriptions. Detects 10 anti-patterns:
1. Colloquial / Telegram tone
2. Accusatory ("you did wrong")
3. Unexplained tech jargon (404, null pointer, SQL error)
4. Fragmented / incomplete ("Error.")
5. All-caps / multiple exclamations
6. Unexpanded acronyms (BP, CC, SDI, FE, PO)
7. Mixed locale
8. Missing ICU placeholders (`{0}` instead of concatenation)
9. Inconsistent punctuation
10. **PII leak** (IBAN, fiscal code, VAT, full email — automatic masking)

Tone-profile-driven, locale-aware (resolves primary locale from the project), additive safe rewrites only.

### 4.4 Refactor / migration

#### `sap-erp-clean-core-refactor` (the flagship)

Plans and executes a Level A refactor of ABAP custom code (Z*/Y*). Three modes (`discover` / `plan` / `execute`). **JIT-only** — no centralized pre-built knowledge base; documentation queried on demand within a bounded per-finding budget.

**Decision tree** per object:

```
A → no_action                                           (target: A)
Unused → remove_unused                                  (target: N/A)
D → rewrite_in_place via released API                   (target: A)
   OR rewrite_in_place via BAdI                         (target: B)
   OR extract_to_side_by_side                           (target: A ERP-side)
   OR accept_as_d_documented (last resort)
C → rewrite_in_place via released API                   (target: A)
   OR rewrite_in_place via BAdI                         (target: B)
   OR extract_to_side_by_side                           (target: A ERP-side)
   OR keep_at_level_b                                   (target: B)
B → keep_at_level_b (default)                           (target: B)
   OR rewrite_in_place / extract (via --aggressive flag)
```

**Three escalation mechanisms**:
- `--aggressive` (global) — explore A escalation for every Level B finding.
- `--push-to-a=A,B,C` (selective) — only listed objects get expanded analysis.
- `--target-level=A` (ambitious) — always prefer A; `--target-level=B` (minimal) — settle for B.
- **Plan-file editing** (finest-grained) — edit the emitted markdown before `execute`.

Three ships:
- [`SKILL.md`](../skills/sap-erp-clean-core-refactor/SKILL.md) — 668-line protocol
- [`SOURCES.md`](../skills/sap-erp-clean-core-refactor/SOURCES.md) — 23 SAP sources in 4 tiers
- [`INTEGRATIONS.md`](../skills/sap-erp-clean-core-refactor/INTEGRATIONS.md) — full ARC-1 MCP × skill × secondsky mapping

#### `modernize-abap-to-btp-cap` chain (#278)

Three coordinated skills for ABAP → BTP CAP modernization:

- **`modernize-abap-to-btp-cap`** — top-level orchestrator, takes ABAP target spec, decomposes into schema + service migration.
- **`modernize-abap-cap-schema`** — Z-table / DDIC structure → CDS entity definition. Handles 24 DDIC → CDS type mappings.
- **`modernize-abap-cap-service`** — Function module / report → CAP service action implementation. Preserves semantics, adapts to handler patterns.

Called by `sap-erp-clean-core-refactor` Step 6b when the decision is `extract_to_side_by_side`.

---

## 5. Strategies (architectural patterns)

### 5.1 JIT lookups, no pre-built KB

A pre-crawled knowledge base of SAP documentation sounds appealing but is economically and operationally wrong:
- **Volume**: help.sap.com alone is ~50k pages. Full crawl = GBs of mostly-unread content.
- **Cost**: weekly Apify crawl of 18 sources ≈ €400-780/year. No clear funding model.
- **Staleness**: even weekly is N days behind SAP's monthly API release cadence.

**JIT alternative**:
- Tier-1 git-cloneable sources (`abap-atc-cr-cv-s4hc`, `SAP-samples`, `cloud-sdk`) are pulled weekly via `git pull --ff-only` — free, fast, authoritative.
- Tier-2 HTTP/SPA sources are queried **per finding** via Apify on the user's own account at ~€0.005-0.02 per page. Bounded 5 lookups per finding. Cached locally for 30 days.
- Tier-3 auth-gated sources (`launchpad-support`, `me.sap.com`) are flagged as manual-consultation pointers.
- Tier-4 MCP-server-backed sources (`mcp-sap-docs`, `context7`) are preferred when installed.

**Cost per refactor of 50-200 objects**: €0.50-€5, charged to the **user's own Apify account**. No centralized infrastructure.

### 5.2 Defense-in-depth (audit → enforcement → CI gates)

Every Clean Core / compliance gate has three layers, none of which can be the only one:

1. **Audit layer** (read-only, generates report): `sap-cap-clean-core-enforce report`, `sap-cap-customizing-honor`, `sap-cap-security-rbac-matrix`, `sap-fiori-app-audit`.
2. **Enforcement layer** (CI-blocking gate): `sap-cap-clean-core-enforce --enforce` exits non-zero on HIGH findings. Wired into pre-PR and pre-deploy CI.
3. **Gate generation layer**: `sap-cap-ci-gates-pattern` produces the shell scripts + workflow YAML so the customer's CI runs the gates per-PR.

Findings discovered by audits flow into gates so they don't regress. **Auditing without gates is busywork**.

### 5.3 Three-layer architecture (hands × playbook × library)

| Layer | Role | Examples |
|---|---|---|
| **ARC-1 MCP** | the *hands* — reads/writes ABAP via ADT REST API | 12 intent-based tools (SAPRead, SAPWrite, SAPContext, SAPLint, SAPDiagnose, …) |
| **arc-1 native skills** | the *playbook* — sequences of MCP operations | bootstrap-system-context, sap-clean-core-atc, generate-rap-logic, etc. |
| **secondsky/sap-skills** | the *library of patterns* — how to write what the hands write | sap-abap, sap-abap-cds, sap-cap-capire, sap-btp-developer-guide |
| **This toolkit** | the *orchestrator* — decides what to do with which hands using which book | sap-erp-clean-core-refactor + 12 sibling skills |

Engaging only one layer is insufficient. Without `sap-abap` enforcement, the agent generates ABAP that compiles but doesn't pass ATC. Without `SAPContext(impact)`, the rewrite-vs-extract decision is blind. Without the orchestrator skill, the user has tools but no method.

### 5.4 Decision tree D→B / C→A / B-keep

Defaults reflect cost-minimizing paths that match the SAP-recommended pattern:

| Starting level | Default target | Path |
|---|---|---|
| D | **B** (via BAdI / enhancement-point) | rewrite_in_place. D objects usually have business logic; BAdI rewrite is the eligible pattern |
| C | **A** (via released API) | rewrite_in_place. Released equivalent typically exists |
| B | **B** (keep + document) | keep_at_level_b. B is already compliant; pushing to A is opt-in |
| A | A | no action |
| Unused | (removed) | sign-off + delete |

Override the defaults with `--aggressive` (push B → A everywhere), `--target-level=B` (settle for B even when A possible), or `--push-to-a=A,B,C` (selective).

### 5.5 Target deployment matrix

Three supported targets (On-Premise CF dropped — EOL):

| Target | CDS profile | Auth | DB | UI delivery |
|---|---|---|---|---|
| **BTP Cloud Foundry** *(default)* | `production` / `production-pg` | XSUAA | HANA HDI / BTP Postgres | `@sap/html5-app-repo` Free OK |
| **BTP Kyma** | `k8s` | OIDC (XSUAA / IAS) | PostgreSQL in-cluster / HANA Cloud | UI ZIPs embedded in approuter image |
| **On-Premise Kyma** | `k8s-onprem` / `k8s-hana` | OIDC via Keycloak | HANA on-prem / Postgres on-prem | UI ZIPs embedded; ingress via NGINX |

Default is BTP CF: most widely-adopted SAP-managed runtime, broadest service ecosystem (Free + paid), most mature `mta.yaml` tooling, lowest operational ceremony. BTP Kyma is the deliberate choice for Kubernetes-operational-model customers. On-Premise Kyma is for data-sovereignty mandates.

### 5.6 Cost model

| Layer | Cost per refactor (50-200 objects) | Who pays |
|---|---|---|
| ARC-1 MCP | €0 | User (server hosting) |
| arc-1 native skills | €0 | (agent inference platform-billed) |
| secondsky/sap-skills | €0 | (one-time install) |
| Tier-1 git clones | €0 (~100 MB on first install) | User (bandwidth) |
| Tier-2 Apify JIT | €0.50-€5 | User (own Apify token) |
| Tier-4 MCP-server | €0 | User (server hosting) |

**Total: €0.50-€5 per typical customer refactor, all user-paid. No centralized cost.**

---

## 6. Dependencies

### 6.1 Mandatory

**ARC-1 MCP server** ([marianfoo/arc-1](https://github.com/marianfoo/arc-1))

Setup:
```bash
git clone https://github.com/marianfoo/arc-1.git
cd arc-1
cp .env.example .env
# Edit .env with SAP_HOST, SAP_CLIENT, SAP_USER, SAP_PASSWORD
# Optional: SAP_ALLOW_FREE_SQL=true (for dead-code detection), SAP_ALLOW_GIT_WRITES=true
npm install && npm run build
# Add to Claude Code MCP config (~/.claude/settings.json) as 'arc-1' server
```

Without ARC-1 MCP, the refactor skill cannot discover or modify ABAP code. The audit skills work without ARC-1 (CAP-side only) but are less complete.

### 6.2 MUST companion plugins (4 from secondsky/sap-skills)

```bash
npx skills add secondsky/sap-skills -s sap-abap -g -y
npx skills add secondsky/sap-skills -s sap-abap-cds -g -y
npx skills add secondsky/sap-skills -s sap-cap-capire -g -y
npx skills add secondsky/sap-skills -s sap-btp-developer-guide -g -y
```

| Plugin | Used by |
|---|---|
| `sap-abap` | `sap-erp-clean-core-refactor` Step 6a (ABAP rewrite); `modernize-abap-*` chain |
| `sap-abap-cds` | `sap-erp-clean-core-refactor` when rewrite introduces CDS views; `modernize-abap-cap-schema` |
| `sap-cap-capire` (4 agents) | `sap-erp-clean-core-refactor` Step 6b (side-by-side); `modernize-abap-to-btp-cap` |
| `sap-btp-developer-guide` | All skills that resolve the deployment target |

### 6.3 SHOULD companion plugins (7)

```bash
npx skills add secondsky/sap-skills -s sapui5 -g -y
npx skills add secondsky/sap-skills -s sap-fiori-tools -g -y
npx skills add secondsky/sap-skills -s sapui5-linter -g -y
npx skills add secondsky/sap-skills -s sap-btp-cloud-platform -g -y
npx skills add secondsky/sap-skills -s sap-btp-connectivity -g -y
# sap-cloud-sdk and sap-cloud-sdk-ai are auto-installed with sap-btp-developer-guide bundle
```

### 6.4 OPTIONAL

| Plugin | Use case |
|---|---|
| **Apify MCP server** | JIT documentation lookup (~€0.005-0.02 per page). Without it, the refactor skill degrades to manual mode |
| `mcp-sap-docs` | Preferred over Apify for SAP Help Portal queries; free when installed |
| `context7` | Generic library docs (non-SAP) |
| `playwright` MCP | Browser smoke tests for Fiori app audit |
| 12 optional secondsky plugins (job scheduling, cloud logging, MDI, cTMS, CIAS, BAS, integration suite, work zone, ISA) | Situational based on customer extension scope |

### 6.5 Tier-1 git clones (free, weekly refresh)

```bash
# One-time clone (~100 MB total)
mkdir -p .cache/git
git clone --depth 1 https://github.com/SAP/abap-atc-cr-cv-s4hc            .cache/git/abap-atc-cr-cv-s4hc
git clone --depth 1 https://github.com/SAP/cloud-sdk                       .cache/git/cloud-sdk
git clone --depth 1 https://github.com/SAP-samples/cap-sflight             .cache/git/cap-sflight
git clone --depth 1 https://github.com/SAP-samples/cloud-cap-samples       .cache/git/cloud-cap-samples
git clone --depth 1 https://github.com/SAP-samples/btp-cap-multitenant-saas .cache/git/btp-cap-multitenant-saas
# (+ 3 more from SOURCES.md)

# Weekly refresh
for d in .cache/git/*/; do (cd "$d" && git pull --ff-only --quiet); done
```

### 6.6 Tier-2 JIT Apify (paid per page)

```bash
# One-time
export APIFY_API_TOKEN=apify_api_xxx  # from console.apify.com/account/integrations
# Add apify-mcp to Claude Code MCP config
```

Without Apify, the refactor skill falls back to manual mode: it produces the plan with "consult URL X manually" pointers; the user pastes back doc snippets. Slower (~2-3× JIT) but free.

---

## 7. Usage examples

### 7.1 Example A — End-to-end Clean Core refactor of a Z* package

Scenario: customer has `ZFI_INVOICES` package, 87 Z objects accumulated over 5 years, S/4HANA 2023 on-prem, target = BTP Cloud Foundry side-by-side.

```bash
# Pre-flight: bootstrap system context (once per system)
/bootstrap-system-context S4DEV

# Discovery + plan (defaults: target=btp-cf, mode=plan)
/sap-erp-clean-core-refactor ZFI_INVOICES

# Review the plan
$EDITOR docs/refactor/2026-05-13-clean-core-plan.md
# (optional: edit decisions per row to override defaults)

# Execute Phase 1 (quick wins: removes + Level B keepers)
/sap-erp-clean-core-refactor ZFI_INVOICES execute --start-phase=1

# Execute Phase 2 (in-place rewrites, low-risk first)
/sap-erp-clean-core-refactor ZFI_INVOICES execute --start-phase=2

# Execute Phase 3 (side-by-side extractions)
/sap-erp-clean-core-refactor ZFI_INVOICES execute --start-phase=3
# This delegates to modernize-abap-to-btp-cap per extension

# Verify the BTP side after deploy
cd bs/zfi-extensions/vendor-risk-score && cds deploy
/sap-cap-clean-core-enforce --enforce       # blocks deploy if non-released API consumed
/sap-cap-stack-audit-full                    # pre-release audit

# Capture learnings
/analyze-chat-session
```

**Expected outcome**:
- 47 objects rewritten in-place (mostly via released APIs → Level A)
- 12 objects extracted to 7 BTP CAP extensions
- 18 objects documented as Level B keepers
- 6 objects removed (unused)
- 4 objects deferred to research backlog
- ATC delta: 234 → 18 findings (-92%)
- Clean Core compliance: 14% → 87%
- Cost: ~€2-3 in Apify lookups, charged to user's account
- Wall time: 1-3 days

### 7.2 Example B — Pre-release stack audit (BTP CAP project)

Scenario: CAP project with 9 Fiori apps, ready for deployment to BTP CF. Want full audit before merge to main.

```bash
# One command, runs everything in parallel
/sap-cap-stack-audit-full

# Output: docs/audit/2026-05-13-stack-audit.md with:
# - Phase 1 pre-flight (CDS compile, project shape, target detected)
# - Phase 2 static (UI5 linter × 9, manifest validation × 9, TS typecheck, test suite, hardcoded sweep)
# - Phase 3 specialized (clean-core-enforce, customizing-honor, security-rbac-matrix,
#                       fiori-app-audit × 9, text-polish dry-run)
# - Phase 4 CAP deep (model integrity, profile audit, build dry-run)
# - Phase 5 best-practice cross-check
# - Phase 6 formal code review (if branch ≠ main)
# - Consolidated findings: Critical / High / Medium / Low
# - Severity grade A/B/C/D
```

**Expected outcome**:
- ~2-10 minutes wall time (`quick` mode skips Phase 3 agents → ~2 min)
- Single deduplicated report with file:line citations for every finding
- PRINCIPLE MISMATCH findings escalated to top of report
- Tools-unavailable section if some MCP not installed (graceful degradation)

### 7.3 Example C — Security & compliance review

Scenario: SOX auditor asks for evidence pack of OWASP / NIST CSF / GDPR controls.

```bash
/sap-cap-security-rbac-matrix

# Output: docs/audit/2026-05-13-security-rbac.md with:
# - Per-area findings (S1-S5 + O1 OWASP)
# - Role coherence matrix: xs-security.json ↔ Keycloak realm ↔ services-auth.cds ↔ handlers
# - Drift detected between layers (HIGH if any)
# - CC segregation audit (cross-company-code leak detection)
# - Compliance mapping: every finding maps to OWASP/ASVS/NIST CSF/CIS/SAP-SOM/GDPR/SOX citations
```

### 7.4 Example D — Single Fiori app audit

Scenario: PR adds a new feature to `manager-ui` app; want to verify nothing regressed before merge.

```bash
/sap-fiori-app-audit manager-ui

# Output: docs/audit/2026-05-13-fiori-manager-ui.md
# - User journey walk (entry → filter → list → detail → action → refresh)
# - Frontend/backend contract chain for every primary action
# - Three failure classes detected:
#   * UX-positive-false (button visible, backend rejects)
#   * UX-negative-false (button hidden, backend would allow)
#   * Stuck states

# Optional: apply safe quick-win fixes on a dedicated branch
/sap-fiori-app-audit manager-ui fix
# Creates branch audit/fiori-manager-ui-2026-05-13 with:
# - Missing @Core.OperationAvailable added (referring to already-computed Can* flag)
# - Missing @Common.SideEffects added
# - Missing i18n key added to webapp/i18n/i18n.properties
# - Missing tooltip / @Common.Label
# Run scoped tests + verify, commit, open PR
```

### 7.5 Example E — Text polish before release

Scenario: release candidate has user-visible text that sounds amateur; want polish before going live + PII safety check.

```bash
/sap-cap-text-polish all tone:formal

# Output: docs/audit/2026-05-13-text-polish.md
# - 10 anti-pattern detection per source (backend reject, frontend toast, i18n bundle, …)
# - Before/after rewrites for POLISH / REWRITE classified items
# - PII_RISK items (unmasked IBAN / fiscal code / VAT / email) flagged urgent
# - LEGAL_REVIEW_REQUIRED items (privacy/consent text) deferred to human

# Apply safe rewrites
/sap-cap-text-polish all fix tone:formal
# Creates branch audit/text-polish-all-2026-05-13 with:
# - Typo / capitalization fixes
# - ICU placeholders added (concatenation → {0})
# - PII masking helper calls inserted
# - Missing i18n keys created
# - All within ≤50 lines diff per file
```

### 7.6 Example F — Setting up CI gates from scratch

Scenario: new CAP project, no CI gates yet, want to lock structural invariants.

```bash
# Describe what patterns would apply (no file generation)
/sap-cap-ci-gates-pattern

# Output: which of the 5 patterns apply based on your project structure
# (bidirectional CSV ↔ code; catalog raise-coverage; API-availability drift;
#  convention/matrix drift; CSV schema lint)

# Generate all applicable gates
/sap-cap-ci-gates-pattern all apply

# Generated files:
# - scripts/ci/check-settings-bidirectional.sh
# - scripts/ci/check-catalog-raise-coverage.sh
# - scripts/ci/check-availability-drift.sh + check-availability-drift.js
# - scripts/ci/check-convention-drift.sh
# - scripts/ci/check-csv-lint.js
# - .github/workflows/ci-gates.yml (matrix strategy, 5 parallel jobs)

# Review + commit + push → next PR is gated
```

### 7.7 Example G — Side-by-side extension scaffold from a Z FM

Scenario: `sap-erp-clean-core-refactor` decided `ZFM_VENDOR_RISK_SCORE` should be `extract_to_side_by_side`. Now generate the CAP scaffold.

```bash
# Delegated automatically during refactor execute mode, OR invoke directly:
/modernize-abap-to-btp-cap ZFM_VENDOR_RISK_SCORE --target=btp-cf

# Internally orchestrates:
# 1. modernize-abap-cap-schema — derives CDS entities from FM I/O parameters + LFA1 deps
# 2. modernize-abap-cap-service — generates CAP service action that replicates the FM semantics
# 3. Wires deployment manifest (mta.yaml for btp-cf)

# Output: bs/vendor-risk-score/ — a complete CAP project
#   db/schema.cds                  (Vendors entity from BP CDS + RiskScore custom field)
#   srv/risk-service.cds           (calculateRisk action)
#   srv/risk-service.ts            (handler implementation)
#   mta.yaml                       (BTP CF deployment manifest)
#   xs-security.json               (XSUAA scope)
#   package.json                   (cds + dependencies)
#   README.md                      (extension purpose + deploy steps)

cd bs/vendor-risk-score && npm install && cds deploy && mbt build && cf deploy
```

---

## 8. PR roadmap

Four open draft PRs on `marianfoo/arc-1`. They're structurally independent and can be merged in any order; cross-links between PRs degrade gracefully to "see also" hints until all are merged.

| PR | Branch | Scope | Lines | Skills |
|---|---|---|---|---|
| **#278** | `feat/skills-modernize-abap-to-btp-cap` | Modernization chain (Z-table → CDS, FM → CAP) | ~1200 | 3 |
| **#279** | `feat/skills-sap-cap-audit-wave1` | Clean Core enforce + Customizing honor | ~970 | 2 |
| **#280** | `feat/skills-sap-cap-audit-wave2-3` | Audit toolkit + master battle-tested-patterns + orchestrator + CI gates | ~3000 | 6 |
| **#281** | `feat/skills-erp-clean-core-refactor` | ERP refactor planner (JIT, decision tree, ARC-1 + secondsky integration) | ~925 | 1 + 2 reference docs |
| (this) | `feat/docs-sap-cap-toolkit-overview` | This consolidated doc | ~700 | 0 (doc-only) |

**Total upstream**: 13 skills + 2 reference docs (SOURCES.md, INTEGRATIONS.md) + this overview = **~6800 lines**, 100% generic, zero project-specific references.

---

## 9. FAQs

### Why JIT lookups instead of a pre-built KB?

Pre-crawl of 18 SAP sources weekly costs €400-780/year on Apify and produces gigabytes of mostly-unread content. Even weekly crawl is 7 days stale at worst. JIT per-finding lookups cost €0.50-5 per refactor, are always fresh, and the user pays only for what they consume. See [§5.1](#51-jit-lookups-no-pre-built-kb).

### What if my customer has no BTP plan?

The refactor skill works without BTP. All `extract_to_side_by_side` decisions become `research_required` (not actionable), and the skill defaults to `rewrite_in_place` (Level A or Level B) plus `keep_at_level_b`. Compliance score will be lower (60-70% vs 85%+) but the refactor still progresses.

### Can I use only the audit skills without the refactor skill?

Yes. The audit skills (`sap-cap-clean-core-enforce`, `sap-cap-customizing-honor`, `sap-cap-security-rbac-matrix`, `sap-fiori-app-audit`, `sap-cap-text-polish`) work standalone on any CAP+Fiori project, with no ARC-1 MCP requirement. The orchestrator (`sap-cap-stack-audit-full`) coordinates them.

### What's the difference between this toolkit and `sap-clean-core-atc`?

- `sap-clean-core-atc` (existing arc-1 native skill) classifies **ABAP custom code on the SAP side** into Levels A/B/C/D. It answers "what is each Z object's level?"
- `sap-erp-clean-core-refactor` (this toolkit, new) **plans and executes the refactor** to move each Z object toward Level A. It answers "what should we do with each Z object?"
- `sap-cap-clean-core-enforce` (this toolkit, new) verifies **the BTP CAP application's outbound S/4 API consumption** is Level A. It answers "are all the S/4 APIs our CAP app calls actually released?"

The three skills are complementary, addressing classification, refactor planning, and consumption verification respectively.

### What changes when the deployment target is On-Premise Kyma?

- CDS profile becomes `k8s-onprem` instead of `k8s`.
- Authentication switches from XSUAA to OIDC via Keycloak (customer's IdP).
- Side-by-side BTP extensions deploy to the customer's K8s cluster instead of BTP Kyma.
- The toolkit's audit skills handle the difference automatically. `sap-cap-stack-audit-full` Step 0 asks the target.

### Why is On-Premise CF not supported?

SAP Cloud Foundry On-Premise reached end of maintenance. The toolkit does not plan deployments against an EOL runtime. Customers with existing on-prem CF investment should migrate to BTP CF (managed) or BTP Kyma.

### Can I run the toolkit on a project that's not on GitHub?

Yes. The skills are filesystem-driven (read CDS, manifest, schema, etc. from the local working directory). CI gate generation supports GitHub Actions, GitLab CI, Jenkins, and BTP CI/CD. Only the cross-link to `SAP/abap-atc-cr-cv-s4hc` and the optional Apify references require network.

### Where do I report issues with the toolkit?

Open an issue on the relevant PR (#278 / #279 / #280 / #281) or against `marianfoo/arc-1` if the issue is in the underlying MCP. For documentation issues with this overview, open against this PR.

---

## 10. References

### Toolkit skills (this contribution)

- [`sap-cap-fiori-battle-tested-patterns`](../skills/sap-cap-fiori-battle-tested-patterns/SKILL.md) — reference knowledge base
- [`sap-cap-stack-audit-full`](../skills/sap-cap-stack-audit-full/SKILL.md) — orchestrator
- [`sap-cap-ci-gates-pattern`](../skills/sap-cap-ci-gates-pattern/SKILL.md) — CI gate library
- [`sap-cap-clean-core-enforce`](../skills/sap-cap-clean-core-enforce/SKILL.md) — Tier-2 S/4 API gate
- [`sap-cap-customizing-honor`](../skills/sap-cap-customizing-honor/SKILL.md) — CSV ↔ code audit
- [`sap-cap-security-rbac-matrix`](../skills/sap-cap-security-rbac-matrix/SKILL.md) — security + compliance
- [`sap-fiori-app-audit`](../skills/sap-fiori-app-audit/SKILL.md) — Fiori app audit
- [`sap-cap-text-polish`](../skills/sap-cap-text-polish/SKILL.md) — user-text + PII
- [`sap-erp-clean-core-refactor`](../skills/sap-erp-clean-core-refactor/SKILL.md) — ERP refactor planner
  - [`SOURCES.md`](../skills/sap-erp-clean-core-refactor/SOURCES.md) — authoritative SAP source catalog
  - [`INTEGRATIONS.md`](../skills/sap-erp-clean-core-refactor/INTEGRATIONS.md) — ARC-1 MCP × skill × secondsky mapping
- [`modernize-abap-to-btp-cap`](../skills/modernize-abap-to-btp-cap/SKILL.md) — orchestrator
- [`modernize-abap-cap-schema`](../skills/modernize-abap-cap-schema/SKILL.md) — Z-table → CDS
- [`modernize-abap-cap-service`](../skills/modernize-abap-cap-service/SKILL.md) — FM → CAP service

### Supporting arc-1 native skills

- [`bootstrap-system-context`](../skills/bootstrap-system-context/SKILL.md)
- [`setup-abap-mirror`](../skills/setup-abap-mirror/SKILL.md)
- [`explain-abap-code`](../skills/explain-abap-code/SKILL.md)
- [`sap-clean-core-atc`](../skills/sap-clean-core-atc/SKILL.md)
- [`sap-unused-code`](../skills/sap-unused-code/SKILL.md)
- [`sap-object-documenter`](../skills/sap-object-documenter/SKILL.md)
- [`generate-abap-unit-test`](../skills/generate-abap-unit-test/SKILL.md)
- [`generate-cds-unit-test`](../skills/generate-cds-unit-test/SKILL.md)
- [`generate-rap-logic`](../skills/generate-rap-logic/SKILL.md)
- [`generate-rap-service-researched`](../skills/generate-rap-service-researched/SKILL.md)
- [`migrate-segw-to-rap`](../skills/migrate-segw-to-rap/SKILL.md)
- [`migrate-custom-code`](../skills/migrate-custom-code/SKILL.md)
- [`convert-ui5-to-fiori-elements`](../skills/convert-ui5-to-fiori-elements/SKILL.md)
- [`modernize-ui5-app`](../skills/modernize-ui5-app/SKILL.md)
- [`analyze-chat-session`](../skills/analyze-chat-session/SKILL.md)

### External

- [ARC-1 MCP server](https://github.com/marianfoo/arc-1) — 12 ABAP intent-based tools
- [secondsky/sap-skills](https://github.com/secondsky/sap-skills) — 32-plugin SAP catalog
- [SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc/blob/main/README.md) — released ABAP objects authority
- [SAP API Hub](https://api.sap.com/) — OData service catalog + lifecycle
- [SAP Cloud Application Programming Model](https://cap.cloud.sap/docs/) — CAP capire
- [SAP Fiori Elements V4 Guidance](https://sapui5.hana.ondemand.com/sdk/#/topic/03265b0408e2432c9571d6b3feb6b1fd)
- [BTP Reference Architectures](https://help.sap.com/docs/btp/sap-business-technology-platform/reference-architectures)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST CSF 2.0](https://www.nist.gov/cyberframework)
- [Apify Website Content Crawler](https://apify.com/apify/website-content-crawler)

### Methodology

- [Clean Core principles (BTP docs)](https://help.sap.com/docs/btp/sap-business-technology-platform/clean-core)
- [SAP Custom Code Migration Guide](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c160bf4ba0fc415da4d34d29c1547d27/d4f8e6cb9c4d4fd99b6a96b3e64dd8e2.html)
- [SAP Activate Roadmap Viewer](https://go.support.sap.com/roadmapviewer/) (S-user login required)

---

## License & contribution

This documentation, like the skills it describes, is licensed under the arc-1 fork's license (MIT-compatible). Contributions welcome via PR against `marianfoo/arc-1`. For corrections to this overview, open against the PR that introduced it.
