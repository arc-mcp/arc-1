---
name: modernize-abap-to-btp-cap
description: End-to-end migration orchestrator from classic ABAP Z* packages to a BTP-native CAP application (CAP Node.js + Fiori Elements V4 + Cloud Foundry). Chains together specialized modernize-abap-* sub-skills (clean-core-gap, schema, service, fiori, auth-mapping, mta). Use when asked to "port this Z package to BTP CAP", "modernize this ABAP code to CAP", "generate a CAP scaffold from this Z package", or "migrate this custom code to BTP greenfield".
---

# Modernize ABAP to BTP CAP

End-to-end migration orchestrator from classic ABAP custom code (Z* packages) to a BTP-native CAP application — Fiori Elements V4 frontend, Node.js backend, Cloud Foundry deployment artifacts.

This skill chains together specialized `modernize-abap-*` skills (Clean Core gap analysis → CDS schema → CAP service → Fiori Elements → auth mapping → MTA deployment) to produce a complete target CAP project. Combines ARC-1 (source / dependency / lint via ADT) with `mcp-sap-docs` (Clean Core release state via [`SAP/abap-atc-cr-cv-s4hc`](https://github.com/SAP/abap-atc-cr-cv-s4hc)).

Different from [migrate-custom-code](../migrate-custom-code/SKILL.md): that skill fixes ATC findings inside an ABAP system; this one **leaves the ABAP system untouched** and produces a side-by-side BTP CAP target project that consumes released S/4HANA APIs instead.

## v1 Guardrails (fast path)

- **Single Z* package per run** — split very large packages (> 200 objects) into sub-packages first
- **CAP Node.js target** — Java target deferred to v2
- **Fiori Elements V4 only** — Freestyle UI5 deferred
- **Cloud Foundry deployment** — Kyma deferred to v2
- **Read-only ARC-1 access** — no `SAPWrite` needed; can run against any ARC-1 deployment without `--allow-writes`
- **Sandbox output** — generates everything under `./target-cap-staging/`; user reviews + activates with explicit `--apply` flag
- **Scaffold + plan, not auto-deploy** — `cf push` and HANA service binding stay manual

For research-first, multi-package, or production-quality migrations, run each sub-skill individually with explicit configuration instead of this orchestrator.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Target system type | `public_cloud` | Clean Core Level A is the migration goal |
| ATC variant | `ABAP_CLOUD_READINESS` if available, else system default | Cloud-target focus |
| CAP runtime | Node.js | Default for greenfield BTP CAP; broader ecosystem |
| OData version | V4 | Current SAP standard; required for Fiori Elements V4 |
| Fiori app pattern | List Report + Object Page (LROP) | Most common CRUD pattern |
| Auth provider | XSUAA | BTP-native; Clean Core L-A compliant |
| DB target | HANA Cloud (prod) + SQLite (dev) | CAP-native; multi-target via `cds.requires` |
| Output mode | Sandbox (`./target-cap-staging/`) | Reversible review before apply |
| Output language | English (i18n bundle) | Default; user can add IT/DE/ES bundles later |
| Sub-skill chain | All 6 sequential | Full end-to-end |
| MTA build tool | `mbt` (Multitarget Application Build Tool) | SAP standard for BTP CF |

## Input

The user provides:

- **Z package name** (required) — e.g., `ZSALES_PKG`, `Z_FI_CUSTOM`
- **Target directory** (required) — where CAP project will be generated (must not exist or must be empty)

Optionally:

- **ATC variant override** — `S4HANA_2023`, `ABAP_CLOUD_READINESS`, system default
- **CAP runtime override** — `node` (default) | `java` (v2 only)
- **Skip sub-skills** — comma list, e.g., `--skip fiori,mta` if user wants only schema + service
- **Fiori app namespace** — default derived from package name (`zsales_pkg` → `com.example.zsalespkg`)
- **Output mode** — `sandbox` (default) | `apply` (write directly to target dir)

If only the package name is provided, ask for the target directory once and proceed with all defaults.

## Step 1: System Probe + Target Setup

### 1a. Verify ARC-1 + ADT availability

```
SAPManage(action="probe")
```

**Critical gate:** If probe reports CDS/RAP unavailable, stop — modernization needs the source system for inventory. If the system is BTP and the package is in `$TMP`, warn the user that the migration target should use a transportable package on the source side first.

### 1b. Validate target directory

Ensure the user-provided target directory either does not exist, is empty, or contains only a previous staging output. Do NOT overwrite an existing CAP project without explicit confirmation.

### 1c. Initialize CAP skeleton

Create the target structure (sandbox):

```
<target>/.target-cap-staging/
├── db/
│   └── schema.cds                  (empty — filled by Step 3)
├── srv/
│   ├── service.cds                 (empty — filled by Step 4)
│   └── handlers/                   (empty — filled by Step 4)
├── app/                            (empty — filled by Step 5)
├── xs-security.json                (empty — filled by Step 6)
├── mta.yaml                        (empty — filled by Step 7)
├── package.json                    (CAP boilerplate)
├── .cdsrc.json
├── .gitignore
└── README.md                       (porting plan + ADRs)
```

The skeleton mirrors a `cds init` output; the orchestrator owns it. Generate `package.json` with:

```json
{
  "name": "<derived-from-package>",
  "version": "0.1.0",
  "dependencies": {
    "@sap/cds": "^9",
    "@cap-js/sqlite": "^2",
    "@cap-js/hana": "^2",
    "express": "^5"
  },
  "scripts": {
    "start": "cds-serve",
    "watch": "cds watch",
    "build": "cds build --production",
    "test": "cds test"
  }
}
```

## Step 2: Run modernize-abap-clean-core-gap (sub-skill)

Hand off to [modernize-abap-clean-core-gap](../modernize-abap-clean-core-gap/SKILL.md) with the same package + target directory.

**Expected output**: `<target>/.target-cap-staging/docs/clean-core-gap.md` containing:

- Per-object Clean Core level (A/B/C/D) for every `Z*` object in scope
- Cross-edition compliance matrix (`public_cloud` × `private_cloud` × `on_premise`)
- Replacement suggestions for Level B/C/D references
- Risk assessment: per-object migration effort estimate

**Gate**: if more than 30% of objects are Level C/D, the skill warns the user that a "lift-and-shift" approach may be infeasible and recommends [migrate-custom-code](../migrate-custom-code/SKILL.md) first to fix ATC findings before retrying modernization.

## Step 3: Run modernize-abap-cap-schema (sub-skill)

Hand off to [modernize-abap-cap-schema](../modernize-abap-cap-schema/SKILL.md) with the same package + target directory.

**Expected output**: `<target>/.target-cap-staging/db/schema.cds` containing:

- Namespace derived from package (e.g., `namespace com.example.zsalespkg;`)
- One CDS entity per `TABL` in the source package
- DDIC → CDS type mapping applied (DEC → Decimal, CHAR → String, DATS → Date, …)
- Associations / compositions from foreign-key references
- `@assert` annotations for NOT NULL fields
- `@Common.Label` from ABAP table short text
- `cuid` / `managed` aspects auto-applied where keys are sysuuid_x16 or fields named `created_*`/`changed_*`

**Validation**:

```bash
npx cds compile <target>/.target-cap-staging/db/schema.cds --to edmx
```

Must succeed. If errors → log + stop + show user the offending entities.

## Step 4: Run modernize-abap-cap-service (sub-skill)

Hand off to [modernize-abap-cap-service](../modernize-abap-cap-service/SKILL.md) with the same package + target directory.

**Expected output**: 
- `<target>/.target-cap-staging/srv/service.cds` with entity projections + action signatures derived from Z* function modules + reports
- `<target>/.target-cap-staging/srv/handlers/*.ts` TypeScript stub files with `// TODO` placeholders for business logic
- One handler file per service action

**Validation**:

```bash
npx cds compile <target>/.target-cap-staging/srv --to edmx
```

## Step 5: Run modernize-abap-fiori-elements (sub-skill, optional)

Skip if `--skip fiori` was provided.

Hand off to [modernize-abap-fiori-elements](../modernize-abap-fiori-elements/SKILL.md).

**Expected output**: `<target>/.target-cap-staging/app/<entity>/` for each main entity, containing:

- `webapp/manifest.json` with Fiori Elements V4 LROP route configuration
- `webapp/Component.ts`
- `annotations/annotations.cds` with `UI.LineItem` + `UI.HeaderInfo` + `UI.FieldGroup` + `UI.Facets`
- `webapp/i18n/i18n.properties` (default EN)

## Step 6: Run modernize-abap-auth-mapping (sub-skill, optional)

Skip if `--skip auth` was provided.

Hand off to [modernize-abap-auth-mapping](../modernize-abap-auth-mapping/SKILL.md).

**Expected output**:
- `<target>/.target-cap-staging/xs-security.json` with scopes derived from `AUTHORITY-CHECK` statements
- `@restrict` annotations injected into `srv/service.cds`
- Role-templates aligned with ABAP authorization objects

## Step 7: Run modernize-abap-btp-mta (sub-skill, optional)

Skip if `--skip mta` was provided.

Hand off to [modernize-abap-btp-mta](../modernize-abap-btp-mta/SKILL.md).

**Expected output**:
- `<target>/.target-cap-staging/mta.yaml` — MTA descriptor with srv + db-deployer + approuter modules
- `<target>/.target-cap-staging/Dockerfile` — multi-stage Node.js build
- `<target>/.target-cap-staging/manifest.yml` — CF deployment manifest
- `<target>/.target-cap-staging/.cfignore`

## Step 8: Generate Architecture Decision Records

Write `<target>/.target-cap-staging/docs/adr/` with one ADR per major decision:

- `0001-cap-runtime-node.md` — Why Node.js (vs Java)
- `0002-db-target-hana-sqlite.md` — Why HANA Cloud prod + SQLite dev
- `0003-auth-xsuaa.md` — Why XSUAA (vs IAS / Keycloak)
- `0004-fiori-elements-v4-lrop.md` — Why FE V4 LROP pattern
- `0005-clean-core-level-a.md` — Why released APIs only + replacement strategy from Step 2
- `0006-side-by-side-no-abap-write.md` — Why we leave the ABAP system read-only

Each ADR follows the MADR (Markdown Architecture Decision Record) format:

```markdown
# <number> - <title>

## Status
Proposed

## Context
<from inventory: what we observed in the Z package>

## Decision
<the choice we made + rationale linked to Smart Defaults>

## Consequences
<what enables / what blocks / what to revisit>
```

## Step 9: Final Audit

Run pre-flight checks against the generated scaffold:

```bash
cd <target>/.target-cap-staging
npm install
npx cds compile srv --service all --to edmx > /dev/null
npx cds compile db/schema.cds --to sql > /dev/null
```

If the target NOVA-style project has `scripts/ci/check-s4-compat-coverage.sh` (or equivalent Clean Core CI gate), invoke it.

Emit final summary report at `<target>/.target-cap-staging/docs/migration-summary.md`:

```
Modernization Summary — <package> → BTP CAP
===========================================

Source ABAP:
  Package: ZSALES_PKG
  Objects audited: 47
  Tables (TABL):   12
  Reports (PROG):   8
  Function modules: 18
  Classes (CLAS):   6
  CDS views (DDLS): 3

Clean Core gap (target: public_cloud):
  Level A objects:  31 (66%)
  Level B objects:   9 (19%)
  Level C objects:   5 (11%)
  Level D objects:   2  (4%)

Generated artifacts:
  db/schema.cds                   12 entities, 4 associations
  srv/service.cds                  3 services, 14 actions
  srv/handlers/*.ts               14 handler stubs
  app/*/webapp/manifest.json       2 Fiori Elements V4 apps
  xs-security.json                 9 scopes, 4 role-templates
  mta.yaml                         3 modules, 2 resources
  docs/adr/                        6 ADR drafts
  docs/clean-core-gap.md           Risk assessment + replacement table

Next steps (manual):
  1. Review docs/migration-summary.md + docs/clean-core-gap.md
  2. Review handler TODO comments and implement business logic
  3. Test locally: cd target-cap-staging && cds watch
  4. Bind HANA Cloud + run: cds deploy --to hana
  5. Build MTA: mbt build
  6. Deploy: cf deploy mta_archives/*.mtar
```

## Re-validate

Re-run after manual handler implementations:

```bash
cd <target>/.target-cap-staging
npm test
npx cds compile srv --service all --to edmx
```

## BTP vs On-Premise Differences (target architecture)

| Aspect | BTP target (this skill) | On-Premise CAP target (out of scope v1) |
|---|---|---|
| Runtime | Node.js on Cloud Foundry | Node.js on ABAP Cloud or external server |
| Auth | XSUAA + Destination Service | XSUAA on CF or IAS or Keycloak |
| DB | HANA Cloud (prod) + SQLite (dev) | HANA on-prem + SQLite (dev) |
| S/4 connection | Destination Service + Communication Arrangement | Cloud Connector + Destination |
| Build | `mbt build` → MTA → `cf deploy` | `npm run build` + custom CI/CD |
| Auth propagation | Principal Propagation via X.509 | SAML or SSO custom |

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `SAPManage probe` reports CDS unavailable | System lacks RAP/CDS support | Stop — modernization needs source CDS read access |
| Target directory not empty | Risk of overwriting unrelated content | Ask user to confirm or pick a fresh directory |
| CDS compile fails after schema generation | Type mapping edge case (e.g., unusual `CURR` with non-standard `Semantics`) | Log offending entity, show source, allow user to edit + retry |
| `cf push` step missing CF CLI | User runs without CF CLI installed | Surface clearly + link to CF CLI install docs; this skill stops at scaffold |
| Clean Core gap > 30% C/D | Package too coupled to internal/deprecated APIs | Recommend [migrate-custom-code](../migrate-custom-code/SKILL.md) first to address findings, then retry |
| `npm install` fails offline | No network for CAP deps | Skill output is generated; user runs `npm install` separately |
| Source package contains > 200 objects | Too large for single-run handoff | Suggest splitting into sub-packages; skill processes top-level only |
| sub-skill output missing expected files | Sub-skill failed silently | Re-run failed sub-skill standalone with verbose flag to diagnose |

## What This Skill Does NOT Do

- **No SAP write operations** — leaves source ABAP system untouched (read-only ARC-1 mode)
- **No CF deployment automation** — generates artifacts only; `cf push` / `cf deploy` stay manual
- **No HANA service provisioning** — user creates HANA Cloud instance + binds manually
- **No XSUAA service creation** — user creates `xsuaa` service instance via `cf create-service` or BTP cockpit
- **No automatic handler logic generation** — handlers are stubs with `// TODO`; user implements business logic
- **No regression test execution** — generates test scaffold via `generate-cds-unit-test` (separate skill); execution is user's responsibility
- **No migration of ABAP CDS Views to released SAP CDS Views** — the [modernize-abap-clean-core-gap](../modernize-abap-clean-core-gap/SKILL.md) report suggests replacements; manual mapping required
- **No transport-coordinated migration** — this is greenfield CAP, no ABAP transport involvement
- **No big-bang cutover plan** — assume coexistence (source ABAP + target CAP) for a transition period
- **No source-system ATC fix application** — that's [migrate-custom-code](../migrate-custom-code/SKILL.md)

## When to Use This Skill

- **Greenfield BTP CAP migration** of a Z* package previously in ECC / S/4HANA on-premise / PCE
- **Lift-and-redesign** of a custom ABAP-only application stack to BTP-native architecture
- **POC / pilot** for evaluating BTP CAP as a target for custom code
- **Quarterly modernization assessment** — run with `--skip fiori,mta,auth` to get just the inventory + gap analysis as a planning artifact
- **Pre-deployment audit** — verify Clean Core compliance before committing to a BTP migration roadmap

## When NOT to Use This Skill

- **The package must stay in S/4 as ABAP Cloud** — use [generate-rap-service-researched](../generate-rap-service-researched/SKILL.md) instead (RAP on ABAP Cloud)
- **Single object refactor** — use [migrate-custom-code](../migrate-custom-code/SKILL.md) (ATC-driven fix)
- **Unused code retirement** — run [sap-unused-code](../sap-unused-code/SKILL.md) first to scope what's actually live
- **The package has > 30% Level C/D objects** — too risky; iterate on source-side fixes first
- **You need Kyma deployment** — v1 targets CF only; track Kyma support in v2

## Follow-up

After successful run, the user typically runs:

- [generate-cds-unit-test](../generate-cds-unit-test/SKILL.md) → for the new CAP CDS entities
- [generate-abap-unit-test](../generate-abap-unit-test/SKILL.md) → for any remaining source ABAP objects kept in coexistence
- [analyze-chat-session](../analyze-chat-session/SKILL.md) → review the modernization run, capture learnings
- Manual `cds watch` + Fiori UI review
- Manual `mbt build` + `cf deploy <mtar>`

## References

- [SAP CAP documentation](https://cap.cloud.sap)
- [SAP Fiori Elements V4](https://experience.sap.com/fiori-design-web/floorplan-list-report/)
- [BTP Cloud Foundry deployment](https://help.sap.com/docs/btp/sap-business-technology-platform/cloud-foundry-environment)
- [Clean Core principles](https://help.sap.com/docs/btp/sap-business-technology-platform/clean-core)
- [SAP API release state repository](https://github.com/SAP/abap-atc-cr-cv-s4hc)
- [MTA development descriptor](https://help.sap.com/docs/btp/sap-business-technology-platform/multitarget-applications-in-cloud-foundry-environment)
