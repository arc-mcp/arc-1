---
name: sap-cap-clean-core-enforce
description: Discovery-driven Clean Core Level A enforcement audit for SAP CAP + S/4HANA projects. Scans `cds.connect.to()` runtime calls + `@cds.external` services, identifies SAP-released probe objects, builds an availability matrix (Public Cloud × Private Cloud × On-Premise) via `mcp-sap-docs`, detects catalog drift versus the project's declared compatibility policy, and suggests SAP-released replacements for non-released references. Use when asked to "verify Clean Core Level A compliance", "audit S/4 API usage", "check which S/4 services we consume are released", "are we Clean Core compliant on BTP", or "build a Clean Core compliance matrix".
---

# SAP CAP Clean Core Level A Enforcement

Discovery-driven Clean Core Level A compliance audit for SAP CAP + S/4HANA projects. This skill **scans your CAP codebase for S/4 API consumption**, **verifies each service against the SAP API release-state repository** ([`SAP/abap-atc-cr-cv-s4hc`](https://github.com/SAP/abap-atc-cr-cv-s4hc)) on all three editions (Public Cloud, Private Cloud / RISE, On-Premise), and produces a **compliance matrix** that can be checked into the repo as compliance evidence.

Unlike [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) which classifies **ABAP custom code on the SAP side** into Levels A-D, this skill classifies **the BTP CAP application's outbound S/4 API consumption** — useful when the CAP app is the consumer and the question is "are all S/4 APIs we call actually released?".

Read-only audit, idempotent, ~5 minute run, zero side-effects on either the source SAP system or the target CAP project (unless `--apply` mode is selected).

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Target edition | All 3: `public_cloud`, `private_cloud`, `on_premise` | Full matrix — multi-customer-deployable projects need to know per-edition availability |
| Clean Core level | `A` (Released APIs only) | The most restrictive level — works for any cloud target |
| Compatibility policy file | Auto-detect: `srv/integration/s4*Policy*.{ts,js,cds}` → `srv/config/s4*.{ts,js}` → `src/config/clean-core*.{ts,js}` | Project-specific files vary; auto-detect first, fall back to discovery-only |
| Probe identification | Catalog `probeObject` field if present → CDS view naming heuristic (`I_*API01` / `I_*`) → MCP search fallback | Multi-strategy gives best coverage |
| BTP managed services | Excluded from S/4 audit | `db`, `auth`, `messaging`, `connectivity`, `responsibility-management`, `enterprise-messaging`, `audit-log-service`, `nats`, `redis` are not S/4 |
| Report output | `docs/audit/<yyyy-mm-dd>-clean-core-level-a.md` | Markdown + committable for traceability |
| Mode | `report` (read-only) | Reversible by default; user opts into `apply` mode for catalog updates |
| Drift severity | Over-declared = HIGH, Under-declared = MEDIUM, Missing-field = LOW | HIGH if catalog claims availability that MCP denies (customer would fail in prod) |

## Input

Optional flags (all auto-detected by default):

- **scope** — `all` (default) | `discovery-only` (skip MCP) | `matrix-only` (presume discovery cached) | `<SERVICE_NAME>` (focus single service)
- **policy file path** — explicit override for the compatibility policy file
- **target editions** — comma list to restrict, e.g., `public_cloud,private_cloud`
- **mode** — `report` (default) | `apply` (auto-update catalog `availability[]` field if MCP-verified differs from declared)

If neither flag is provided, run with defaults and full discovery.

## Step 1: Pre-flight + Compatibility Policy Discovery

### 1a. Verify project type

```bash
test -f package.json && grep -q '"@sap/cds"' package.json
```

If not a CAP project, stop and inform the user this skill targets CAP+S/4HANA stacks.

### 1b. Detect compatibility policy file

Search for the project's S/4 compatibility policy file (commonly used pattern: a JS/TS module exporting a `SERVICE_CATALOG` constant that maps logical service names to OData version + destination aliases + entity sets + Communication Scenarios).

Auto-detect order:

```bash
find srv/integration -name "s4*Policy*.{ts,js}" -maxdepth 2 2>/dev/null
find srv/config -name "*compat*.{ts,js}" -maxdepth 2 2>/dev/null
find src/config -name "clean-core*.{ts,js}" -maxdepth 2 2>/dev/null
```

If multiple candidates → ask user to pick one. If none → proceed with `discovery-only` scope (no catalog drift detection, only inventory + MCP verification).

### 1c. Parse compatibility policy

Extract from the policy file (regardless of exact location):

- Service entries (keys of `SERVICE_CATALOG` or equivalent): logical names like `BUSINESS_PARTNER`, `SUPPLIER_INVOICE`, `PURCHASE_ORDER`, etc.
- Per-entry: `odata` (versions array), `destinations` (alias names), `entitySets`, `communicationScenarios`, optionally `availability` (already-declared edition list), optionally `probeObject` (already-declared SAP probe object).

If the policy file does not exist or doesn't follow this convention, proceed with code-grep discovery only.

## Step 2: Dynamic Discovery (4 sources)

Combine 4 input sources to build the candidate service list. **Do not** start from a hardcoded list — discover dynamically.

### 2a. Runtime destinations (`cds.connect.to`)

```bash
grep -rhE "cds\.connect\.to\(['\"]([A-Z][A-Z0-9_-]+)['\"]" srv/ \
  --include="*.ts" --include="*.js" 2>/dev/null \
  | grep -oE "['\"][A-Z][A-Z0-9_-]+['\"]" \
  | tr -d "'\"" \
  | sort -u
```

### 2b. External service contracts

```bash
ls srv/external/*.cds 2>/dev/null | xargs -I {} basename {} .cds | sort -u
```

These are typically `@cds.external` services or remote OData proxies with metadata committed to the project.

### 2c. SERVICE_CATALOG declared destinations (if Step 1c succeeded)

Extract from the parsed policy file.

### 2d. ServiceConnectors seed CSV (if present)

```bash
test -f db/data/sap.*-ServiceConnectors.csv && \
  awk -F',' 'NR>1 {print $2}' db/data/sap.*-ServiceConnectors.csv | sort -u
```

This is a common pattern for CAP apps that declare admin-configurable S/4 service connectors as master data.

### 2e. Apply exclusions

Remove BTP managed services (not S/4):

```
db | auth | messaging | connectivity | responsibility-management |
enterprise-messaging | audit-log-service | nats | redis
```

Also remove dev / mock / test destinations (matching `mock-*`, `test-*`, `dev-*`).

The result is the **service candidate list** to audit.

## Step 3: Probe Identification

For each service candidate, identify the representative SAP object to query against the SAP API Release State repository.

### Heuristic order (most preferred first)

1. **Explicit `probeObject`** from policy file (if Step 1c found it) — zero cost, already documented.
2. **Naming convention** — SAP's pattern for OData service-backing CDS views:
   - Destination `API_*` (e.g., `API_PURCHASEORDER_PROCESS_SRV`) → probe `I_*API01` (e.g., `I_PURCHASEORDERAPI01`)
   - Destination `I_*` directly (e.g., `I_PURCHASEORDERHISTORYAPI01`) → probe is the destination itself
3. **Special cases** (known SAP framework patterns):
   - Electronic Document Files / DRC services → probe `DTEL EDOC_TYPE` (component `CA-GTF-CSC-EDO`)
   - Attachment service (`API_CV_ATTACHMENT_SRV`) → probe `CLAS CL_ATTACHMENT_SERVICE_API` (component `CA-DMS`)
   - Workflow services (`s4-flexible-workflow`) → probe `DDLS I_WORKFLOWEXTERNALSTATUS` (component `BC-BMT-WFM`)
4. **MCP search fallback** for ambiguous cases:
   ```
   mcp-sap-docs:sap_search_objects(
     query="<keyword derived from logical name>",
     system_type="public_cloud",
     clean_core_level="A",
     object_type="DDLS",
     limit=10
   )
   ```
   Take the first result matching `I_<TOPIC>API01` or `I_<TOPIC>` pattern.

### Untraceable services

If no probe object can be identified for a service (none of the heuristics produce a match), emit a **LOW finding** in the report:

```
[LOW] Untraceable service: <SERVICE_NAME>
  - Destination(s): <list>
  - Inferred attempts:
    - Naming heuristic I_*API01: no MCP match
    - Search fallback: no result matching pattern
  - Recommendation: manually add `probeObject` field to the catalog entry
```

The skill continues without crashing — untraceable services are flagged but not treated as compliance gaps (they may be released, just not auto-detectable).

## Step 4: Matrix MCP-Verified (3 editions × N services)

For each `(service, probe_object)` identified, issue **3 parallel MCP queries** — one per edition:

```
mcp-sap-docs:sap_get_object_details(
  object_type=<probe.type>,
  object_name=<probe.name>,
  system_type="public_cloud",       # then private_cloud, then on_premise
  target_clean_core_level="A"
)
```

### Per-cell evaluation

For each `(service, edition)` cell of the matrix:

| MCP response | Interpretation | Matrix value |
|---|---|---|
| `found: true && state: "released" && cleanCoreLevel: "A" && complianceStatus: "compliant"` | Released L-A available | ✅ |
| `found: true && state: "released" && cleanCoreLevel: "B/C/D"` | Released but not L-A | 🟡 (level mismatch) |
| `found: true && state: "deprecated"` | Available but deprecated | ⚠️ (deprecated, migration needed) |
| `found: true && state: "notToBeReleased*"` | Not released, internal use | 🔴 (Clean Core violation) |
| `found: false` | Not in repository | ⚪ (unknown — probe may be wrong) |

### Cache MCP results

Cache by `(object_type, object_name, system_type)` — the same probe is often queried for multiple services that share a CDS view backbone (e.g., `I_BUSINESSPARTNER` underlies multiple API_* services). 30+ queries for a 12-service catalog is normal.

## Step 5: Catalog Drift Detection

For each catalog entry, compare declared `availability[]` against MCP-verified result.

### Drift classification

| Drift type | Declared vs Verified | Severity | Impact |
|---|---|---|---|
| **NONE** | Declared matches verified exactly | — | Healthy |
| **OVER_DECLARED** | Catalog says `['PUBLIC', 'PRIVATE', 'ONPREM']` but MCP confirms only 2 editions | 🔴 **HIGH** | Customer on Public Cloud configures connector → runtime fails with 404. False positive. |
| **UNDER_DECLARED** | Catalog says `['PRIVATE']` but MCP confirms 3 editions | 🟡 **MEDIUM** | Customer Public Cloud blocked unnecessarily. False negative. |
| **MISSING_FIELD** | Catalog has no `availability` field | 🟢 **LOW** | Undefined runtime behavior. Defaults may be too permissive. |
| **STATE_CHANGE** | Catalog implies released but MCP reports deprecated | ⚠️ **MEDIUM** | Migration needed (probably future cutoff). |

## Step 6: Compliance Matrix Rollup

Aggregate the per-cell matrix into multi-dimensional reports.

### Rollup A: Per-service matrix

```
| Service          | Public | Private | OnPrem | Probe                       | App Component       | Drift          |
|------------------|--------|---------|--------|-----------------------------|---------------------|----------------|
| BUSINESS_PARTNER | ✅      | ✅       | ✅      | DDLS I_BUSINESSPARTNER      | AP-MD-BP            | NONE           |
| PURCHASE_ORDER   | ✅      | ✅       | ✅      | DDLS I_PURCHASEORDERAPI01   | MM-PUR-PO-2CL       | NONE           |
| HYPOTHETICAL_X   | ❌      | ✅       | ✅      | DDLS I_HYPOTHETICALX        | (not found public)  | OVER_DECLARED  |
```

### Rollup B: Per Communication Scenario

For each `SAP_COM_XXXX` in the catalog, list which services use it and their edition coverage:

```
| SAP_COM      | Description                       | Services NOVA using       | Edition coverage     |
|--------------|-----------------------------------|---------------------------|----------------------|
| SAP_COM_0008 | Business Partner Integration      | BUSINESS_PARTNER          | All 3 ✅              |
| SAP_COM_0057 | Supplier Invoice + Attachments    | SUPPLIER_INVOICE, ATTACHMENT | All 3 ✅          |
```

### Rollup C: Coverage summary

```
Total services audited:           N
Cells (services × 3 editions):    M
Cells compliant (L-A all 3):      X (X/M %)
Cells with drift HIGH:            n
Cells with drift MEDIUM:          n
Cells with drift LOW:             n
Untraceable services:             n
Z-namespace runtime references:   n

Rating: A (≥95% compliant) / A- (90-94%) / B (75-89%) / C (<75%)
```

## Step 7: Emit Report

Save markdown to `docs/audit/<yyyy-mm-dd>-clean-core-level-a.md` (create `docs/audit/` directory if needed):

```markdown
# Clean Core Level A Compliance Audit — <yyyy-mm-dd>

## Pre-flight
- Branch: <branch>
- Commit: <sha>
- Compatibility policy file: <path or 'not detected'>
- Scope: <discovery sources used>

## Discovery
- Runtime destinations (cds.connect.to): N
- External service contracts: N
- SERVICE_CATALOG entries: N
- ServiceConnectors CSV: N
- Effective services (post-dedup + post-exclusion): N

## Probe Identification
| Service | Probe | Type | App Component | Source |

## Matrix (MCP-verified)
| Service | Public | Private | OnPrem | Notes |

## Drift Detection
| Service | Declared | Verified | Drift | Severity |

## Compliance per Communication Scenario
| SAP_COM | Description | Services | All editions |

## Findings (≥0.8 confidence)
### [HIGH] OVER_DECLARED: <service>
- Catalog: <declared>
- MCP verified: <actual>
- Impact: <concrete failure scenario>
- Fix: <recommendation>

## Compliance Summary
- Services: N · Cells compliant: X/M
- Rating: A / A- / B / C

## Fix Plan / Applied
| Service | Field | Before | After | Status |

## Re-verification process
- Cadence: quarterly (Q-review) or on SAP API sunset announcement
- Command: `sap-cap-clean-core-enforce` (this skill)
- Output: re-save report with current date
```

## Step 8: Apply Fixes (only when `--apply` mode)

When user explicitly opts in:

### Safe auto-fixes

1. **Sync `availability[]` field** for services where MCP-verified is a **superset** of declared (UNDER_DECLARED case) — adding editions never breaks customers; only removing does.
2. **Add `probeObject` field** when missing but heuristic-identified — improves traceability for re-verification.
3. **Add timestamp comment** at the top of the catalog file recording verification date.

### NOT auto-applied (require manual review)

- **Remove edition from `availability[]`** when OVER_DECLARED — risks breaking customers on the over-declared edition. Surface as a finding with recommendation, but never auto-remove.
- **Add new service entry** not currently in catalog. Use `--add-service <name>` explicit flag.
- **Z-namespace usage** at runtime — architectural decision, not auto-fixable.

### Verification after fix

Re-run Steps 4-6 against the updated catalog to confirm zero drift remains.

## BTP vs On-Premise Differences

| Aspect | BTP target (Public Cloud) | Private Cloud / RISE | On-Premise |
|---|---|---|---|
| Software component | `SAPSCORE` | `S4CORE` | `S4CORE` or `SAP_BASIS` |
| App component suffix | `-2CL` ("To Cloud") | base name (no suffix) | base name (no suffix) |
| Released API set | Most restrictive | Includes legacy classic APIs | Same as Private |
| ABAP CDS views | `I_*` views released L-A | `I_*` views (no -2CL suffix) | Same as Private |
| Cross-edition probes | Use Public Cloud `-2CL` as authoritative | Both base + -2CL may exist | base name preferred |

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `mcp-sap-docs not connected` | MCP server unavailable | Run installation: `npx skills add marianfoo/arc-1` includes recommended MCP setup |
| `mcp-sap-docs returns found: false` for known SAP object | Repository dataset lag or wrong probe object | Try alternative probe (variant CDS view name); flag service as untraceable |
| Policy file detected but parse fails | Non-standard policy file format | Skill falls back to `discovery-only` scope and logs warning |
| Multiple policy files candidates found | Project structure ambiguity | Ask user to pick one (interactive prompt) |
| Probe object naming heuristic miss | Custom destination name doesn't match `API_*` / `I_*` pattern | Manual probe specification via policy file `probeObject` field |
| No `cds.connect.to` calls found | Project uses different connection pattern (e.g., `cds.requires.<dest>`) | Extend Step 2a grep with project-specific pattern; report what was found |
| Catalog file in TypeScript with complex syntax | Cannot statically parse with regex | Read entries via `node -e` evaluation or ask user to export JSON snapshot |

## What This Skill Does NOT Do

- **No SAP write operations** — read-only on SAP side via mcp-sap-docs queries
- **No replacement code generation** — suggests replacement APIs (in drift report), but does not generate the replacement CAP service binding
- **No ABAP-side classification** — that's [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) (which audits Z code on SAP)
- **No SystemParameter / customizing validation** — separate concern (see [sap-cap-customizing-honor](../sap-cap-customizing-honor/SKILL.md))
- **No deployment / runtime testing** — static audit only; doesn't make HTTP calls to the destination
- **No CDS compile validation** — assumes the project already compiles; this skill audits the S/4 API surface, not CDS syntax
- **No Z-namespace runtime replacement** — flags Z-namespace usage as finding but architectural redesign is out of scope
- **No catalog file generation** — works against an existing compatibility policy or with `discovery-only` if none exists

## When to Use This Skill

- **Pre-deployment audit** — before committing to a BTP customer go-live, verify that all S/4 APIs consumed are released for that customer's edition
- **Quarterly compliance check** — schedule as part of release governance; re-verifies the catalog matches latest SAP API release state
- **After adding a new S/4 destination** — verify the new service is released before merge
- **Pre-CI gate validation** — pair with a CI script (e.g., `scripts/ci/check-s4-compat-coverage.sh`) for runtime drift prevention
- **Pre-acquisition audit** — when assessing a 3rd-party CAP application, verify it's Clean Core L-A before adoption
- **Documentation evidence** — auditor-friendly report committed to `docs/audit/` for compliance trail

## When NOT to Use This Skill

- **Greenfield project with no SERVICE_CATALOG yet** — there's nothing to audit yet; start with [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md) to scaffold the project, then audit later
- **ABAP-only codebase** (no CAP) — use [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) instead
- **Custom Z* CDS views on the S/4 side that are NOT meant to be released** — that's a design choice; this skill measures consumption, not source generation
- **Single-edition deployment fixed by customer contract** — you can use this skill but most of the value (cross-edition matrix) is lost; consider `--target-editions public_cloud` flag

## Follow-up

After this skill produces the compliance matrix:

- **HIGH drift findings**: investigate manually, decide whether to remove edition from declared availability OR switch to a different SAP service that IS released on the affected edition
- **UNDER_DECLARED findings**: run with `--apply` to expand `availability[]` and unlock customer editions
- **Untraceable services**: manually add `probeObject` field to policy entries
- **Deprecated state warnings**: plan migration to successor APIs (use [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) for ABAP-side migrations)
- **Z-namespace runtime references**: architectural review — either Clean Core B opt-in (documented exception) or replacement

Related skills:

- [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md) — ABAP-side classification (companion, source side)
- [migrate-custom-code](../migrate-custom-code/SKILL.md) — ABAP-side ATC fixes when replacements are needed
- [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md) — generate the CAP scaffold this skill later audits

## References

- [SAP API Release State repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) — authoritative source for object classifications
- [Clean Core principles](https://help.sap.com/docs/btp/sap-business-technology-platform/clean-core)
- [SAP API Business Hub](https://api.sap.com)
- [CAP `cds.connect.to` documentation](https://cap.cloud.sap/docs/node.js/cds-connect)
- [SAP Communication Management (S/4HANA Cloud)](https://help.sap.com/docs/SAP_S4HANA_CLOUD/0f69f8fb28ac4bf48d2b57b9637e81fa/community-management.html)
