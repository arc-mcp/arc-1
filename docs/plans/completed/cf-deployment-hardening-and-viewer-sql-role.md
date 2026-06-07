# CF Deployment Hardening + Viewer-SQL Role-Collection Parity

## Overview

Two narrow, config-only operational improvements drawn from the `Raistlin82/btp-sap-odata-to-mcp-server-optimized` review (review thread, May 2026):

1. **CF deployment hardening** — set the Node heap flag explicitly on `mta.yaml`'s start command (`--max-old-space-size=448`) so V8 doesn't run with a default heap target larger than the 512M dyno cgroup, and bind a `application-logs` (lite plan) service so historical CF logs survive dyno restarts. Together these stop the silent OOM-kill failure mode that V8-on-CF is prone to and give us a Kibana-backed log retention story to pair with the existing `src/server/sinks/btp-auditlog`.

2. **xs-security `viewer-sql` parity** — close a small but real gap: the documented API-key profile `viewer-sql` (read + data + sql, no writes) has no matching XSUAA role-collection. A user authenticating via XSUAA cannot today get the "read-only + free SQL" combo without being granted full developer rights. Add a new `ARC-1 Viewer + SQL` role-collection composing the existing `MCPViewer` + `MCPSqlUser` templates.

Neither change touches `src/`. There are no new code paths, no new env vars, no new tests beyond verifying the YAML/JSON parse cleanly. The risk surface is small and the audit trail is one mta.yaml + one xs-security.json + a handful of doc-table edits.

## Context

### Current State

- `mta.yaml` (line 51) sets `memory: 512M` with `command: node dist/index.js` — no heap flag. V8 doesn't read cgroup limits and will run with a default heap target ~1.5–2GB, leading to silent OOM-kills (CF SIGKILL, exit code 137) instead of clean GC pressure.
- `mta.yaml` defines three resources: `arc1-xsuaa`, `arc1-destination`, `arc1-connectivity`. There is no `application-logs` binding. `cf logs --recent` is the only retrieval method, and history is lost on dyno restart.
- `xs-security.json` defines 5 role-templates and 6 role-collections. The list of role-collections (xsuaa-setup.md table at line 47–54): `ARC-1 Viewer`, `ARC-1 Developer`, `ARC-1 Data Viewer`, `ARC-1 Developer + Data`, `ARC-1 Developer + SQL`, `ARC-1 Admin`. Notably absent: `ARC-1 Viewer + SQL`.
- `CLAUDE.md` (line 84) and `docs_page/api-key-setup.md` document `viewer-sql` as a valid API-key profile (`read`, `data`, `sql`).
- `docs_page/authorization.md` line 184 already mentions assigning `ARC-1 Developer + SQL` to grant SQL — but offers no read-only equivalent.

### Target State

- `mta.yaml` start command reads `node --max-old-space-size=448 dist/index.js` with a one-line comment explaining why (V8 + cgroup mismatch). Heap target sits at 87.5% of dyno RAM, leaving ~64MB headroom for native (better-sqlite3, undici buffers) and stack.
- `mta.yaml` declares a fourth resource `arc1-application-logs` (service `application-logs`, plan `lite`) and the `arc1-mcp-server` module `requires:` it.
- `xs-security.json` has a 7th role-collection `ARC-1 Viewer + SQL` referencing `$XSAPPNAME.MCPViewer` + `$XSAPPNAME.MCPSqlUser`.
- The documentation tables in `docs_page/xsuaa-setup.md`, `docs_page/authorization.md`, and `docs_page/btp-cloud-foundry-deployment.md` reflect both changes (new collection row, new service row).
- A single-line completed entry in `docs_page/roadmap.md` records the change.

### Key Files

| File | Role |
|------|------|
| `mta.yaml` | BTP MTA descriptor — start command + service bindings |
| `xs-security.json` | XSUAA role-templates + role-collections (the file that becomes the BTP service config) |
| `docs_page/xsuaa-setup.md` | User-facing XSUAA setup guide — role-collection table + Step 3 listing |
| `docs_page/authorization.md` | Three-layer authorization model — BTP role-collection table |
| `docs_page/btp-cloud-foundry-deployment.md` | BTP CF deployment guide — services table |
| `docs_page/roadmap.md` | Roadmap completed log |
| `mta-overrides.mtaext.example` | Tracked template for landscape-specific overrides — DO NOT add the heap flag here (it belongs on the base) |

### Design Principles

1. **Config-only.** No source files under `src/` are touched. No new env vars, no new flags, no new tests beyond YAML/JSON parse validity.
2. **Set on the base, not the override.** The heap flag is a property of the runtime environment (CF dyno), not the landscape — every deployment of `mta.yaml` benefits, no `mta-overrides.mtaext` change required.
3. **No memory bump.** Stay at `memory: 512M`. Bumping to 1G doubles BTP CF RAM cost — defer until a single OOM (`cf events` exit code 137) is observed.
4. **Compose, don't add new templates.** The `viewer-sql` role-collection bundles existing `MCPViewer` + `MCPSqlUser` templates. Adding a new template (e.g. `MCPViewerSql`) would expand the XSUAA scope surface for no functional gain.
5. **Doc symmetry.** Three docs reference the role-collection list (`xsuaa-setup.md`, `authorization.md`, `btp-cloud-foundry-deployment.md`); all three must be updated in lock-step to avoid drift.
6. **Heap value rationale must live in the file.** A bare `--max-old-space-size=448` is unintuitive. Add an inline `# rationale: ...` comment directly above the `command:` so a future operator understands the constraint when they see a 1G dyno bump request.

## Development Approach

- All changes are textual edits to YAML/JSON/Markdown. No `npm test` will exercise them.
- `npm run typecheck` and `npm run lint` should still be run end-of-job as a basic sanity check (Biome has JSON formatters, will catch xs-security.json indentation drift).
- YAML/JSON parse validity is verified by a small `node -e "..."` command in the final task.
- `mbt build` and `cf deploy` are out of sandbox scope — verified by code review, not by deployment.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `node -e "require('js-yaml').load(require('fs').readFileSync('mta.yaml','utf8'))"` (YAML parse check)
- `node -e "JSON.parse(require('fs').readFileSync('xs-security.json','utf8'))"` (JSON parse check)

### Task 1: Add Node heap flag to mta.yaml start command

**Files:**
- Modify: `mta.yaml`

V8 doesn't read cgroup limits — running with the default ~1.5–2GB heap target inside a 512M CF dyno results in silent OOM-kills (SIGKILL, exit code 137) instead of clean GC pressure. Setting `--max-old-space-size=448` puts the heap target at ~87.5% of dyno RAM, leaving ~64MB headroom for native allocations (better-sqlite3, undici buffers) and stack.

- [ ] Read `mta.yaml` to locate the `arc1-mcp-server` module's `command:` line (currently `command: node dist/index.js`).
- [ ] Replace the line with `command: node --max-old-space-size=448 dist/index.js`.
- [ ] Add an inline comment ABOVE the `command:` line explaining the rationale: `# Node heap target sized to 87.5% of dyno memory (512M → 448M) so V8 GCs cleanly inside the CF cgroup instead of being SIGKILL'd; bump in lockstep when memory: changes.`
- [ ] Verify `mta.yaml` still parses as valid YAML by running: `node -e "require('js-yaml').load(require('fs').readFileSync('mta.yaml','utf8'))"`. If the project doesn't have js-yaml installed, fall back to: `python3 -c "import yaml; yaml.safe_load(open('mta.yaml'))"`.
- [ ] No tests to add — `mta.yaml` has no unit-test counterpart.

### Task 2: Add application-logs resource binding to mta.yaml

**Files:**
- Modify: `mta.yaml`

Bind a `application-logs` (lite) service so historical CF logs survive dyno restarts and are aggregated to BTP's centralized log endpoint (Kibana). Pairs with our existing `src/server/sinks/btp-auditlog` audit sink — application-logs handles operational logs (HTTP, lifecycle), btp-auditlog handles audit events.

- [ ] In `mta.yaml`, locate the `requires:` block under module `arc1-mcp-server` (currently lists `arc1-xsuaa`, `arc1-destination`, `arc1-connectivity`).
- [ ] Add `- name: arc1-application-logs` as the fourth entry, preserving alphabetical-or-existing ordering (place it last, after `arc1-connectivity`).
- [ ] In the top-level `resources:` block, append a new resource definition AFTER `arc1-connectivity`:
  ```yaml
  - name: arc1-application-logs
    type: org.cloudfoundry.managed-service
    parameters:
      service: application-logs
      service-plan: lite
  ```
  Match existing indentation exactly (2 spaces under `resources:`, 4 spaces for `parameters:`).
- [ ] Verify YAML parse: `node -e "require('js-yaml').load(require('fs').readFileSync('mta.yaml','utf8'))"` (or python3 fallback).
- [ ] No tests — config-only change.

### Task 3: Add ARC-1 Viewer + SQL role-collection to xs-security.json

**Files:**
- Modify: `xs-security.json`

Closes parity gap: API-key profile `viewer-sql` (documented in `CLAUDE.md` line 84 and `docs_page/api-key-setup.md`) grants `read` + `data` + `sql` with no writes, but no XSUAA role-collection composes the same scope set. Compose existing `MCPViewer` + `MCPSqlUser` templates — no new role-template is needed because both already exist.

- [ ] Read `xs-security.json` to locate the `role-collections` array. The existing 6 collections appear in this order: `ARC-1 Viewer`, `ARC-1 Developer`, `ARC-1 Data Viewer`, `ARC-1 Developer + Data`, `ARC-1 Developer + SQL`, `ARC-1 Admin`.
- [ ] Insert a new collection between `ARC-1 Data Viewer` and `ARC-1 Developer + Data` (groups it with the other read-only collection, matches the placement in `docs_page/xsuaa-setup.md` and `docs_page/authorization.md`):
  ```json
  {
    "name": "ARC-1 Viewer + SQL",
    "description": "Read-only SAP access with table data preview and freestyle SQL",
    "role-template-references": [
      "$XSAPPNAME.MCPViewer",
      "$XSAPPNAME.MCPSqlUser"
    ]
  }
  ```
  Match the existing JSON indentation (2 spaces) and trailing-comma rules — pure JSON, no trailing comma after the last array element.
- [ ] Verify JSON parses: `node -e "JSON.parse(require('fs').readFileSync('xs-security.json','utf8'))"` exits 0.
- [ ] Run `npm run lint` — Biome will reformat JSON and surface any indentation drift.
- [ ] No source tests — xs-security.json is consumed by the XSUAA service at deploy time, not by ARC-1 code.

### Task 4: Update xsuaa-setup.md role-collection table

**Files:**
- Modify: `docs_page/xsuaa-setup.md`

The user-facing XSUAA setup guide lists role-collections in two places: the table at line 47–54 and the Step 3 listing at line 88. Both need the new collection.

- [ ] Read `docs_page/xsuaa-setup.md` lines 40–95 for context.
- [ ] At line 45, change `And 6 pre-defined role collections` to `And 7 pre-defined role collections`.
- [ ] In the role-collection table at lines 47–54, insert a new row between `ARC-1 Data Viewer` and `ARC-1 Developer + Data` (preserving the read→write→admin order):
  ```
  | ARC-1 Viewer + SQL        | `read`, `data`, `sql`                                    | Read-only + table preview + freestyle SQL |
  ```
  Pad the columns to match the existing alignment widths.
- [ ] At line 88, update the Step 3 listing from `"ARC-1 Viewer", "ARC-1 Developer", "ARC-1 Developer + Data", "ARC-1 Developer + SQL", "ARC-1 Data Viewer", or "ARC-1 Admin"` to insert `"ARC-1 Viewer + SQL"` after `"ARC-1 Data Viewer"`. Result: `"ARC-1 Viewer", "ARC-1 Developer", "ARC-1 Developer + Data", "ARC-1 Developer + SQL", "ARC-1 Data Viewer", "ARC-1 Viewer + SQL", or "ARC-1 Admin"`.
- [ ] No tests — markdown-only change.

### Task 5: Update authorization.md role-collection table

**Files:**
- Modify: `docs_page/authorization.md`

Mirror the new role-collection in the three-layer authorization model doc (BTP XSUAA role-templates section, table at line 173–180).

- [ ] Read `docs_page/authorization.md` lines 155–195.
- [ ] In the "Common role collections" table at lines 173–180, insert a new row between `ARC-1 Data Viewer` and `ARC-1 Developer`:
  ```
  | `ARC-1 Viewer + SQL` | `read`, `data`, `sql` |
  ```
- [ ] At line 184, expand the example: change `"(for example `ARC-1 Developer + SQL`)"` to `"(for example `ARC-1 Viewer + SQL` for read-only SQL or `ARC-1 Developer + SQL` for full developer access)"`. Use exact wording above.
- [ ] No tests.

### Task 6: Update btp-cloud-foundry-deployment.md services table for application-logs

**Files:**
- Modify: `docs_page/btp-cloud-foundry-deployment.md`

The MTA-method services table at lines 106–112 currently lists 3 services. Add the application-logs binding so operators see the full set.

- [ ] Read `docs_page/btp-cloud-foundry-deployment.md` lines 95–115 for context.
- [ ] At line 106, change `The mta.yaml defines three BTP services that are created automatically:` to `The mta.yaml defines four BTP services that are created automatically:`.
- [ ] In the services table at lines 108–112, append a new row after the Connectivity row:
  ```
  | Application Logs | `arc1-application-logs` | `lite` | Centralized log aggregation (Kibana) |
  ```
  Match the existing column alignment.
- [ ] No tests.

### Task 7: Update roadmap.md and finalize

**Files:**
- Modify: `docs_page/roadmap.md`
- Move: `docs/plans/cf-deployment-hardening-and-viewer-sql-role.md` → `docs/plans/completed/cf-deployment-hardening-and-viewer-sql-role.md`

Single completed-row entry in the roadmap. Per the SORT RULES comment in `roadmap.md`, this only requires a row in the "Overview: Completed" table — no detail section needed for changes this small.

- [ ] Read `docs_page/roadmap.md` lines 100–125 for the Completed table format.
- [ ] At the top of the "Overview: Completed" table (line 119, immediately under the header row, newest-first ordering), insert a new row dated today:
  ```
  | — | CF deployment hardening (Node `--max-old-space-size=448` heap flag on mta.yaml + `application-logs` lite binding) and XSUAA `ARC-1 Viewer + SQL` role-collection parity with the `viewer-sql` API-key profile. Config-only — no source changes. | <YYYY-MM-DD> | Ops |
  ```
  Replace `<YYYY-MM-DD>` with the current date (use `date +%Y-%m-%d` to get it).
- [ ] Run all validation commands:
  - `npm run typecheck` — must pass with no errors
  - `npm run lint` — must pass; Biome may reformat xs-security.json indentation, accept that
  - `node -e "require('js-yaml').load(require('fs').readFileSync('mta.yaml','utf8'))"` — must exit 0 (or python3 fallback)
  - `node -e "JSON.parse(require('fs').readFileSync('xs-security.json','utf8'))"` — must exit 0
  - `npm test` — sanity, must pass (no test changes expected)
- [ ] Verify by `git diff` that ONLY these files changed: `mta.yaml`, `xs-security.json`, `docs_page/xsuaa-setup.md`, `docs_page/authorization.md`, `docs_page/btp-cloud-foundry-deployment.md`, `docs_page/roadmap.md`. No file under `src/`, `tests/`, or `package.json` should be modified.
- [ ] Move this plan: `mkdir -p docs/plans/completed && git mv docs/plans/cf-deployment-hardening-and-viewer-sql-role.md docs/plans/completed/cf-deployment-hardening-and-viewer-sql-role.md`.
