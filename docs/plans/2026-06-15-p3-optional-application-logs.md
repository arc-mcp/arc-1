# P3 — Make the deprecated `application-logs` service optional (default off)

**Date:** 2026-06-15
**Branch:** `chore/optional-application-logs`
**Source:** customer feedback (Manuel Fahrbach) — `application-logs` shows as *deprecated* with a
warning at deploy; "was passiert denn, wenn ich kein Application Log mehr drin habe?" Marian: "vielleicht
sollte ich das dann in die mtaext auslagern."

## Problem

`mta.yaml` unconditionally creates and binds the **SAP Application Logging Service**
(`arc1-application-logs`, `service: application-logs`). That service is **deprecated** — SAP removed it
from the list of Eligible Cloud Services on **2025-07-31** (SAP Note 3557260; replacement is **SAP Cloud
Logging**, OpenTelemetry-based). Consequences today:

- On subaccounts that still have it: a deprecation **warning** at every deploy (what Manuel saw).
- On newer subaccounts where the service is no longer offered: `cf create-service application-logs lite`
  is unavailable, so the MTA resource creation can **fail the whole deploy** — a hard block, not a warning.

## Verified facts (live / sourced)

- **Zero code dependency.** `src/adt/btp.ts` parses `VCAP_SERVICES` only for destination / connectivity /
  xsuaa. Nothing reads an `application-logs` binding. Logs go to **stderr**; CF aggregates them. Removing
  the binding has **no code impact** — `cf logs` / `cf logs --recent` still work; only the managed
  aggregation backend (Kibana) goes away.
- **MTA mechanism (verified against SAP's own `cf-mta-examples/active-optional-resources`):**
  - `active` is a **resource-level** attribute (sibling of `type`/`parameters`), default `true`.
    `active: false` ⇒ the service instance is **not created**, and a module that `requires:` it simply
    **skips the binding** — no deploy failure. SAP's example literally uses `service: application-logs`
    as the optional-resource demo.
  - `active` can be **flipped per-deployment via an extension descriptor** (mtaext) — so opt-in is one
    line in `mta-overrides.mtaext`.
  - (`optional: true` is a different lever — "ignore failures for this service"; not needed here.)
- **Schema:** arc1's `mta.yaml` is `_schema-version: "3.1"`. Spiked locally: `npx mbt validate` accepts
  `active: false` on the resource **and** an mtaext setting `active: true` under 3.1. **No schema bump
  needed.** (mbt 1.2.26.)

## Decision: default OFF (`active: false`), documented opt-in

Set the resource `active: false` in the base `mta.yaml`; keep the resource definition and the module's
`requires:` entry intact (so opt-in is just flipping `active`). Rationale:

- The service is removed from the catalog → **active-by-default risks hard deploy failures** on current
  subaccounts. Off-by-default makes a fresh deploy robust everywhere. This is the stronger argument.
- Kills the deprecation warning by default (Manuel's complaint).
- **Tradeoff (call out loudly):** an *existing* deployment that currently relies on Kibana aggregation
  loses it on its next `cf deploy` unless it opts back in. Acceptable because (a) the service is going
  away regardless, (b) `cf logs` still works, (c) opt-in is one line, (d) we document it as a migration
  note. Not silent: the PR body + docs flag it.

Rejected alternative — default ON + documented opt-out: maximally backward-compatible but leaves every
new deploy pulling a deprecated/removed service (warning, or hard failure on new subaccounts). Net worse.

## Changes

### 1. `mta.yaml`
- Add `active: false` to the `arc1-application-logs` resource.
- Replace the bare resource with a comment block: why it's off (deprecated, SAP Note 3557260, removed
  2025-07-31), that `cf logs` still works, how to opt in (mtaext `active: true`), and the Cloud Logging
  pointer.
- Keep `requires: - name: arc1-application-logs` on the module (harmless when inactive; needed for opt-in).
- Update the services-overview comment if any references it.

### 2. `mta-overrides.mtaext.example`
- Add a documented, commented opt-in block:
  ```yaml
  # ── Application logging (OFF by default — deprecated service) ─────
  # SAP Application Logging Service is deprecated (SAP Note 3557260; use
  # SAP Cloud Logging instead). It is NOT created by default. `cf logs`
  # works without it. To re-enable CF log aggregation on a subaccount
  # that still offers the service, flip the resource active:
  # resources:
  #   - name: arc1-application-logs
  #     active: true
  ```
  (As a sibling of `modules:`, matching the existing `arc1-xsuaa` override example at the bottom.)

### 3. Docs — `docs_page/btp-cloud-foundry-deployment.md`
- The four-services table lists `Application Logs … Centralized log aggregation (Kibana)`. Change its row
  to note **optional / off by default / deprecated**, with the opt-in pointer + Cloud Logging.
- The MTA "services created automatically" prose says *four* services — adjust to "three by default
  (XSUAA, Destination, Connectivity); Application Logs is optional/off."
- Add a short note under the deploy/verify area: `cf logs --recent` works without the service.

### 4. Docs — `docs_page/log-analysis.md`
- The "Enabling File Logging → BTP Cloud Foundry" snippet and surrounding text: add one line that CF
  `cf logs` works out of the box; managed aggregation needs the (optional) Application Logging service
  or SAP Cloud Logging.

### 5. Docs — `docs_page/roadmap.md` (roadmap note only; do NOT implement AMS/Cloud Logging)
- One forward-looking bullet: migrate observability to **SAP Cloud Logging** (OpenTelemetry); track XSUAA
  → AMS separately. Keeps the bigger migration visible without scope creep.

### Out of scope
- Implementing SAP Cloud Logging binding / OpenTelemetry export (separate, larger).
- XSUAA → AMS migration (separate authorization topic; Manuel conflated the two — different deprecations).

## Test plan

1. `npm run btp:validate` — base `mta.yaml` **and** `mta-overrides.mtaext.example` validate (the CI
   `mta-validate` gate).
2. `npx mbt build` then inspect the generated `mta_archives/.../META-INF/mtad.yaml`: confirm
   `arc1-application-logs` carries `active: false` and the module still lists the requires. This is the
   definitive "deploy will skip it" check short of a real deploy.
3. Add an mtaext opt-in spike (`active: true`) and `npx mbt validate -e` it — confirm opt-in is accepted
   (already spiked; keep as a throwaway, do not commit).
4. Full gate: `npm run build && npm run typecheck && npm run lint && npm test` (no code changed, but
   confirm nothing regressed; biome formats yaml? no — md/ts only).
5. **Live deploy is NOT required** for this PR (no target space provisioned for it; the change is
   deploy-descriptor-only and verified via `mbt build` output). If the user wants belt-and-suspenders, a
   real `cf deploy` to a throwaway space would confirm the resource is skipped — offer, don't assume.

## Commit / PR
- Conventional commit: `chore(deploy): make deprecated application-logs service opt-in (default off)`.
  `chore:` ⇒ no release line, and the CI gate skips the SAP-hitting jobs (this change doesn't need SAP).
- New PR from `chore/optional-application-logs` → `main`, with the migration-note tradeoff called out.
