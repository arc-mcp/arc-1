---
name: sap-clean-core-atc
description: Audit a package of custom code and bucket every Z/Y object into Clean Core Levels A–D based on the SAP APIs it uses — the "is this cloud-ready?" assessment. Use when asked to "classify this package for clean core", "clean core readiness report", "Level A-D audit", or "is this code cloud-ready".
---

# SAP Clean Core ATC Classification

Inventory a package of custom code and bucket every Z/Y object into **Clean Core Levels A–D** based on the SAP APIs it uses — the "is this cloud-ready?" audit.

This is different from [migrate-custom-code](../migrate-custom-code/SKILL.md): that skill fixes one object's ATC findings; this one **produces a package-wide classification report** with per-object levels, used to plan a clean-core / BTP migration. It combines ARC-1 (ATC + source access) with mcp-sap-docs (released-API classification data from `SAP/abap-atc-cr-cv-s4hc`).

## Clean Core Levels (what they mean)

| Level | Meaning | Cloud-ready? |
|---|---|---|
| **A** | Uses only released SAP APIs | ✅ Yes — move as-is to ABAP Cloud / BTP |
| **B** | Uses classic APIs (on-premise-only, documented) | 🟡 Works on on-prem S/4HANA; needs rewrite for cloud |
| **C** | Uses internal/stable SAP objects (not customer-released) | 🔴 Supported today but no API guarantee |
| **D** | Uses objects with no API status (deep internals, undocumented) | 🔴 High migration risk, may break on upgrade |

Source: [SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc) — SAP's official machine-readable release state list.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Target system type | `public_cloud` | Clean-core audits almost always target cloud readiness |
| ATC variant | `ABAP_CLOUD_READINESS` if available, else system default | Cloud readiness is the point of the exercise |
| Include in scope | Z*, Y*, plus any `/namespace/*` the user names | Customer code only; skip SAP-shipped |
| Report detail | Summary table + level-breakdown + top violations | Actionable overview; drill-down on request |

## Input

The user provides a **package** (preferred) or a comma-separated object list, plus optional target system type.

- **Package** (e.g., `Z_FI_CUSTOM`): audit every custom object in it
- **Object list** (e.g., `ZCL_POSTING, ZR_SALES_REPORT`): audit only the named ones
- **Target system type**: `public_cloud` (default) | `btp` | `private_cloud` | `on_premise`

If neither package nor object list is given, ask which to use. Do NOT audit "everything" — that's never what the user wants.

## Step 1: Enumerate Custom Objects

### 1a. Package path

```
SAPRead(type="DEVC", name="<package>")
```

Filter results to keep only `PROG | CLAS | INTF | FUGR | FUNC | DDLS | BDEF | SRVD | TABL` with names starting `Z`, `Y`, or a customer namespace. Skip subpackages (audit them separately) unless the user says "recursive".

### 1b. Object-list path

For each name, resolve the type:

```
SAPSearch(query="<name>")
```

Use the first exact match.

## Step 2: Extract SAP API References per Object

For each custom object, collect the list of SAP-shipped objects it references.

### 2a. Use SAPContext for dependency extraction

```
SAPContext(type="<type>", name="<object_name>", depth=1)
```

SAPContext returns a dependency list. Keep only dependencies whose names do NOT start with Z/Y/customer-namespace — those are SAP references. Record each as `(objectType, objectName)`.

`SAPContext` supports CLAS, INTF, PROG, FUNC, DDLS (on-prem) and CLAS, INTF, DDLS (BTP). For other types (FUGR, BDEF, SRVD, TABL), fall back to reading the source with `SAPRead` and extracting SAP class / interface / function references with a regex scan over lines (e.g., `CL_*`, `IF_*`, `SAP*`, `CALL FUNCTION '...'`). Mark these references as "static-scan" in the report so the user knows confidence is lower than AST-derived deps.

### 2b. Also run ATC for cloud readiness

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>", variant="ABAP_CLOUD_READINESS")
```

If `ABAP_CLOUD_READINESS` doesn't exist on the system, use the system default (omit `variant` — that runs the system's configured default check variant) and note this in the report. On-premise systems often ship `S4HANA_READINESS_<release>` (e.g. `S4HANA_READINESS_2023`) or `SAP_CLOUD_PLATFORM_DEFAULT` instead of `ABAP_CLOUD_READINESS`. ATC findings complement the API classification — a released API can still be used incorrectly.

> **ATC skips `$TMP` / local objects (verified live on S/4HANA 2023).** A check run against a `$TMP` object resolves to an empty object set and returns **zero findings** — that's "not checked", not "clean". Package-wide classification only works on **transportable** packages. If a package is local/`$TMP`, note in the report that ATC results are unavailable and fall back to the mcp-sap-docs API classification alone. A finding count of 0 on code you expect to be flagged is almost always the `$TMP` trap, not clean code.

## Step 3: Classify Each SAP Reference via mcp-sap-docs

For each unique SAP object the custom code references:

```
sap_get_object_details(object_type="<type>", object_name="<name>", system_type="<target>", target_clean_core_level="A")
```

This returns:
- `cleanCoreLevel` — A, B, C, or D
- `state` — released | deprecated | classicAPI | stable | notToBeReleased | noAPI
- `complianceStatus` — `compliant` | `non_compliant` vs. the target level
- `successorObjects` — replacement recommendations if deprecated

Cache results by `(object_type, object_name)` — the same SAP class is often referenced from many Z-objects.

If an object isn't found in the dataset (`found: false`), classify as **D (unknown / no API)** and flag it as requiring manual review.

## Step 4: Roll Up to Per-Object Level

Each custom object's level is **the highest (worst) level among its SAP references**:

| If any reference is … | Object level |
|---|---|
| D | D |
| C (and no D) | C |
| B (and no C/D) | B |
| All A | A |

Record per object:
- Object level (A/B/C/D)
- Reference breakdown (counts per level)
- Top 3 worst references with their successors (if any)
- ATC cloud-readiness findings count (Priority 1/2/3)

## Step 5: Emit the Report

### 5a. Headline summary

```
Clean Core Audit — <package_or_list>
Target system: <target>   ATC variant: <variant>

Objects audited:  42
  Level A:  12  (29%)  — ready for ABAP Cloud as-is
  Level B:  18  (43%)  — on-prem only; rewrite for cloud
  Level C:   8  (19%)  — uses internal APIs; plan replacement
  Level D:   4   (9%)  — high risk; manual review required
```

### 5b. Per-level tables

For each level (start with D, work down — worst first):

```
Level D — High Risk (4 objects)

Object                    Non-compliant refs  Top violation           ATC P1
ZCL_MIGRATION_HELPER      8                   CL_SALV_TREE_WRAPPER    3
ZR_OLD_POSTING           12                   SAPLSMTR_NAVIGATION     5
...
```

### 5c. Replacement suggestions (Level B/C/D only)

For the top 10 most-referenced deprecated APIs, show `{deprecated → successor}` pairs with counts:

```
CL_GUI_ALV_GRID  (used in 18 Z-objects)  →  CL_SALV_TABLE  (A)
CL_IXML          (used in 12 Z-objects)  →  XML transformations (A)
...
```

### 5d. Follow-up Options

Offer next steps:
- "Want per-object detail for Level D objects?" (drill into the 4 riskiest)
- "Want to migrate one of these objects now?" (→ [migrate-custom-code](../migrate-custom-code/SKILL.md))
- "Want to see which Z-objects are even USED?" (→ [sap-unused-code](../sap-unused-code/SKILL.md) — no point migrating dead code)
- "Want to document the Level A objects as reference examples?" (→ [sap-object-documenter](../sap-object-documenter/SKILL.md))
- "Want a reviewed dossier with saved evidence, customer questions, and visualizations?" (→ [sap-migration-dossier](../sap-migration-dossier/SKILL.md))

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `sap_get_object_details` returns `found: false` | SAP object not in the release state dataset | Classify as D, flag for manual review; dataset covers S/4HANA only |
| `ABAP_CLOUD_READINESS` variant not found | System doesn't have it configured | Fall back to default variant; note in report that finding is less cloud-specific |
| SAPContext unsupported for object type | E.g., dynamic programs, generated code | Fall back to regex scan of source for `CL_*`, `IF_*`, `SAP*` patterns |
| Empty package | Typo or package is only a structure package | Verify via SAPSearch; ask user to pick a child package |
| mcp-sap-docs not connected | Missing MCP server | Skill degrades to ATC-only classification; warn user |

## Caveats

### What this skill is NOT

- **Not a migration tool** — it classifies risk; use [migrate-custom-code](../migrate-custom-code/SKILL.md) to actually fix.
- **Not a replacement for SAP's Custom Code Migration app** — that tool has more depth (runtime usage analysis, simplification DB, transport impact). This skill is a fast, LLM-friendly approximation.
- **Accuracy depends on mcp-sap-docs dataset freshness** — the SAP/abap-atc-cr-cv-s4hc repo is updated per S/4HANA release.

### BTP vs On-Premise

- **BTP audit (`system_type=btp`)**: Level B becomes non-compliant — BTP only accepts Level A. Stricter than public_cloud.
- **On-premise audit (`system_type=on_premise`)**: Level A+B are both compliant. Use this when the goal is "does my custom code survive the next S/4HANA upgrade?" rather than "can I run this in the cloud?".

### When to Use This Skill

- Planning a move from ECC → S/4HANA Cloud
- Planning a move from ECC → ABAP Cloud on BTP
- Quarterly custom-code health check
- Before a major release upgrade (to flag high-risk objects early)
- Scoping a custom-code retirement project (combine with [sap-unused-code](../sap-unused-code/SKILL.md))
