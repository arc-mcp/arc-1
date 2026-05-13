---
name: modernize-abap-to-btp-cap
description: End-to-end migration orchestrator from classic ABAP Z* packages to a BTP-native CAP application (Node.js + Fiori Elements V4 + Cloud Foundry). Chains specialized `modernize-abap-cap-*` sub-skills to produce a target CAP project. Use when asked to "port this Z package to BTP CAP", "modernize ABAP to CAP", "generate a CAP scaffold from this Z package", or "migrate custom code to BTP greenfield".
---

# Modernize ABAP → BTP CAP

Orchestrator that takes an ABAP Z* package and produces a CAP project under `<target>/.target-cap-staging/`. Leaves the ABAP system untouched.

Different from [`../migrate-custom-code/SKILL.md`](../migrate-custom-code/SKILL.md): that skill fixes ATC findings *inside* an ABAP system. This one produces a *side-by-side BTP target* that consumes released S/4HANA APIs instead.

## Input

```
<Z-package> <target-dir> [--cap-runtime=node|java] [--skip=…]
```

Examples:
- `ZSALES_PKG ./out` — full default chain
- `ZSALES_PKG ./out --skip=fiori,mta` — only schema + service, no UI / deploy artifacts

## Defaults (applied silently)

| Aspect | Default |
|---|---|
| Target | `public_cloud` (Clean Core L-A goal) |
| CAP runtime | Node.js (Java deferred to v2) |
| OData | V4 |
| Fiori pattern | List Report + Object Page (LROP) |
| Auth | XSUAA |
| DB | HANA Cloud prod + SQLite dev |
| Output mode | Sandbox `./target-cap-staging/` (reversible) |
| MTA build | `mbt` |
| Output language | English i18n bundle |

## Chain

The orchestrator runs the 6 sub-steps below sequentially. Each can be re-run independently via the linked sub-skill.

| Step | Sub-skill | Produces |
|---|---|---|
| 1 | (this orchestrator) Pre-flight + skeleton | CAP `cds init`-style structure under `<target>/.target-cap-staging/`, package.json with `@sap/cds ^9` + `@cap-js/hana` + `@cap-js/sqlite` |
| 2 | Clean Core gap analysis | `docs/clean-core-gap.md` with per-object A/B/C/D level + replacement suggestions. **Gate**: > 30% C/D → recommend `migrate-custom-code` first |
| 3 | [`../modernize-abap-cap-schema/SKILL.md`](../modernize-abap-cap-schema/SKILL.md) | `db/schema.cds` from Z-tables / DDIC structures |
| 4 | [`../modernize-abap-cap-service/SKILL.md`](../modernize-abap-cap-service/SKILL.md) | `srv/service.cds` + handler stubs from FMs / programs |
| 5 | Fiori Elements V4 scaffold | `app/<namespace>/` LROP with annotations |
| 6 | Auth + MTA | `xs-security.json` + `mta.yaml` for `cf deploy` |

## Pre-flight

```
SAPManage(action="probe")   # verify ARC-1 + ADT + CDS/RAP availability
```

If CDS/RAP unavailable → stop (cannot inventory). If package in `$TMP` → warn user to use a transportable package first.

Validate `<target-dir>` is empty or contains a previous staging output only. Refuse to overwrite an existing CAP project without explicit confirmation.

## Gates

- **Clean Core gap > 30% C/D objects** → warn, recommend `migrate-custom-code` first, then retry
- **No released equivalent found for a critical object** → flag in `clean-core-gap.md`; user decides whether to extract custom logic to CAP side-by-side or block
- **Target dir not empty / not staging** → refuse without `--apply` confirmation

If the source project has a Clean Core CI gate (`scripts/ci/check-s4-compat-coverage.sh` or equivalent), invoke it after staging — drift detection against `SAP/abap-atc-cr-cv-s4hc`.

## Output

```
<target>/.target-cap-staging/
├── db/schema.cds            (Step 3)
├── srv/service.cds          (Step 4)
├── srv/handlers/            (Step 4)
├── app/<namespace>/         (Step 5)
├── xs-security.json         (Step 6)
├── mta.yaml                 (Step 6)
├── package.json             (Step 1)
├── docs/
│   ├── clean-core-gap.md    (Step 2)
│   └── porting-plan.md      (orchestrator summary + ADRs)
└── README.md
```

The user reviews under the staging dir, then promotes to the real CAP project (rename / move, or invoke with `--apply` to write directly).

## Hand-off

Generated CAP project is **sandbox**. Manual next steps (not in this skill):

```bash
cd <target>/.target-cap-staging
npm install
cds deploy --to hana    # or sqlite for dev
mbt build               # build MTA archive
cf deploy mta_archives/<archive>.mtar
```

For audit / hardening / CI gates of the generated CAP project, see [`Raistlin82/sap-cap-toolkit`](https://github.com/Raistlin82/sap-cap-toolkit).

## When NOT to use

- ABAP-system-internal ATC fixes → use [`../migrate-custom-code/SKILL.md`](../migrate-custom-code/SKILL.md)
- Single-object refactor (not whole package) → invoke a sub-skill directly
- Multi-package coordinated migration → split per package, run orchestrator N times
- Java CAP runtime → v2 (not yet supported)
- Kyma deployment → v2 (defaults to CF for now)

## Recommended companion plugins

From [secondsky/sap-skills](https://github.com/secondsky/sap-skills):

- `sap-abap` (MUST) — ABAP source patterns the sub-skills consume
- `sap-abap-cds` (MUST) — CDS view patterns for Step 3
- `sap-cap-capire` (MUST, 4 agents) — CAP scaffolding patterns for Steps 3-4
- `sap-btp-developer-guide` (MUST) — BTP deployment for Step 6
- `sap-fiori-tools` (SHOULD) — Fiori Elements scaffolding for Step 5

Plus ARC-1 MCP (mandatory — system probe + source read in Steps 1-2).
