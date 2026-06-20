---
name: sap-object-documenter
description: Produce stable, package-scoped Markdown documentation for many custom ABAP objects at once — classifies each by style (Classic/Modern/Mixed) and summarizes purpose and dependencies. Use when asked to "document this package", "generate onboarding docs for Z code", "seed a docs folder", or "knowledge transfer for this package".
---

# SAP Object Documenter

Produce stable, package-scoped documentation for custom ABAP objects — classifies each by style (Classic / Modern / Mixed), summarizes purpose and dependencies, and outputs Markdown suitable for a repo wiki or onboarding doc.

This skill complements [explain-abap-code](../explain-abap-code/SKILL.md) which targets a single object interactively. Use this one when you want **written docs for many objects at once** — e.g., to seed a `docs/` folder during onboarding, or to generate knowledge-transfer material before a team handoff.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Include | Z*, Y*, customer-namespace | Customer code only |
| Depth | 1 (direct dependencies only) | Keep docs readable; don't drown in transitive graph |
| Style classification | Yes | Free signal — just ask SAPLint |
| Per-object section length | ~30–60 lines Markdown | Enough to be useful, not so long it's unread |
| Output format | Markdown file(s) | Portable, fits any wiki |

## Input

The user provides **one of**:

- **Package** (e.g., `Z_SALES_EXTENSIONS`) — document every custom object in it
- **Object list** — comma-separated (e.g., `ZCL_SALES_HANDLER, ZR_POSTING_JOB`)
- **Type + prefix** — e.g., "document all Z* classes" → runs `SAPSearch(query="Z*", objectType="CLAS")`

And optionally:
- **Output path** — default: `docs/custom-code/<package_or_group>.md`
- **One file or one-per-object** — default: one file with per-object sections, unless >30 objects in which case one-per-object

If the scope would produce >100 objects, stop and ask the user to narrow it — documentation nobody reads is worse than no documentation.

## Step 1: Enumerate Scope

### 1a. Package path

```
SAPRead(type="DEVC", name="<package>")
```

### 1b. Object-list path

Resolve each:

```
SAPSearch(query="<name>")
```

Filter to document-worthy types: `CLAS, INTF, FUGR, PROG, DDLS, BDEF, SRVD, TABL`. Skip generated proxies, transport objects, and test include classes.

## Step 2: For Each Object — Read Source + Metadata

Run these in parallel for each object:

```
SAPRead(type="<type>", name="<name>")             # Source
SAPContext(type="<type>", name="<name>", depth=1) # Dependencies (CLAS/INTF/PROG/FUNC/DDLS only; BTP: CLAS/INTF/DDLS)
```

For object types SAPContext doesn't support (FUGR, BDEF, SRVD, TABL, DOMA, DTEL), skip the dependency call and list the "obvious" callers/dependencies by regex-scanning the source for `CL_*`, `IF_*`, `SAP*` and `CALL FUNCTION '...'`. Note the degraded confidence in the "Dependencies" section.

For classes, also:

```
SAPRead(type="CLAS", name="<name>", method="*")   # Method listing with signatures
```

For CDS views, also:

```
SAPRead(type="DDLS", name="<name>", include="elements")  # Field list
```

## Step 3: Classify ABAP Style (Classes + Programs only)

```
SAPLint(action="lint", name="<name>")
```

(Pass `source=<source>` instead of `name` if you already have the source in memory — avoids a second fetch.)

Interpret the lint findings:

| Signals of **Modern** ABAP | Signals of **Classic** ABAP |
|---|---|
| Uses CDS, RAP, inline declarations, `NEW`, `REDUCE`, `CORRESPONDING` | Uses `FORM/ENDFORM`, `TABLES` statements, `OCCURS` |
| No `SELECT *`, has `ORDER BY`, bulk operations | Line-by-line `SELECT SINGLE` in loops, `SELECT *` |
| Classes with test classes, uses interfaces for DI | Function modules with global state |
| No `MOVE-CORRESPONDING`, uses `CORRESPONDING OF` | Heavy `PERFORM` chains |

Classify as:
- **Modern** — mostly modern patterns, cloud-ready style
- **Classic** — mostly classic patterns, pre-7.40 feel
- **Mixed** — both present (often: modern wrapper around classic guts)

If SAPLint fails or object isn't lintable (e.g., CDS view, table), skip this section.

## Step 4: (Optional) Business-Context Lookup via mcp-sap-docs

For objects whose name or structure references an SAP app component (FI, SD, MM, etc.), enrich with component context:

```
search("<component_code> application component")
```

Example: `ZCL_FI_GL_POSTING` → search `"FI-GL general ledger"` to get the SAP application-component description for the doc header.

Skip this step if the object name gives no hint.

## Step 5: Write the Markdown

### 5a. One-file structure (≤30 objects)

```markdown
# <Package or group name> — Custom Code Documentation

_Generated <date> via sap-object-documenter skill on system <SID>._

## Overview

| Object | Type | Style | Purpose (1 line) |
|---|---|---|---|
| ZCL_SALES_HANDLER | CLAS | Modern | Behavior implementation for sales order RAP service |
| ZR_OLD_POSTING | PROG | Classic | Nightly batch for legacy FI posting |
| ...

## Objects

### ZCL_SALES_HANDLER

- **Type:** CLAS
- **Package:** Z_SALES_EXTENSIONS
- **Style:** Modern (uses RAP, inline decls, no SELECT *)
- **Purpose:** Handle validations and determinations for the Sales Order RAP business object.

**Public API**
- `validate_credit_limit( i_order )` — checks customer credit limit before save
- `determine_currency( c_order )` — defaults currency from sales org

**Dependencies**
- ZI_SALESORDER (CDS — root entity)
- CL_SALV_TABLE (A — released ALV class)
- ZCL_CREDIT_SERVICE (Z — custom credit service wrapper)

**Notes**
- No direct DB access; routes everything through the RAP entity.
- Tests: `ZCL_SALES_HANDLER_UT` (present, 8 test methods).

---

### ZR_OLD_POSTING
...
```

### 5b. One-file-per-object structure (>30 objects)

Create `docs/custom-code/<package>/README.md` with the overview table (linking to each file) plus one `<object_name>.md` per object with the same sections as above.

### 5c. Header per object (canonical fields)

```markdown
- **Type:** <TADIR type>
- **Package:** <package>
- **Style:** Modern | Classic | Mixed | n/a
- **Purpose:** <one-sentence summary>
- **Last change:** <SAPRead VERSIONS — most recent timestamp + user>
- **Transports:** <SAPTransport action="history" — last 3 TR numbers>
```

The "Last change" + "Transports" lines come for free from ARC-1's version/transport APIs and anchor the doc in time.

## Step 6: Write to Disk + Report

Use the local file system (Write tool) to emit the Markdown file(s). Return a short summary:

```
Wrote 42 object docs to docs/custom-code/Z_SALES_EXTENSIONS/
  12 Modern | 18 Classic | 8 Mixed | 4 n/a (CDS/tables)

Longest objects (may need deeper docs):
  ZCL_SALES_HANDLER   (847 lines, 14 methods)
  ZR_OLD_POSTING      (1,204 lines)
  ...
```

### Follow-up Options

- "Want to expand any of these into deeper explanations?" (→ [explain-abap-code](../explain-abap-code/SKILL.md))
- "Want to check clean-core readiness for this package?" (→ [sap-clean-core-atc](../sap-clean-core-atc/SKILL.md))
- "Want to prune the dead ones first?" (→ [sap-unused-code](../sap-unused-code/SKILL.md))
- "Want to package documentation, usage, ATC, and review cards into a migration dossier?" (→ [sap-migration-dossier](../sap-migration-dossier/SKILL.md))

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| Object not found | Wrong name or deleted | Log and skip; continue with rest |
| SAPContext fails | Unsupported type | Manually list imports via regex scan of source |
| SAPLint fails | No source (table, CDS), unsupported syntax | Skip style classification for that object |
| Source is empty | Generated proxy or stub | Note "no source available" in doc, still emit other metadata |
| Output path exists | File collision | Add timestamp suffix or ask user |
| >100 objects in scope | Doc would be unreadable | Stop and ask user to narrow scope |

## Caveats

### What this skill does NOT do

- **No code generation** — pure read + summarize.
- **No English translation of business logic** — the "Purpose" line is derived from naming, class header comments, and test-class names. If those are missing, it says so.
- **Not a substitute for good code comments** — the output is only as good as the source naming.
- **No cross-object consolidation** — each object is documented independently. Package-level architecture description is out of scope.

### When to Use This Skill

- Onboarding new developers to a custom-code package
- Before a consulting handoff — capture institutional knowledge as docs
- Pre-migration documentation (snapshot what exists before rewriting)
- Compliance / audit trail (some orgs require per-object documentation)
- Seeding a knowledge base / repo wiki

### When NOT to Use This Skill

- For a single object — use [explain-abap-code](../explain-abap-code/SKILL.md), faster and interactive.
- For SAP-shipped code — this is Z/Y-only; for SAP objects, use mcp-sap-docs directly.
- When code quality analysis is the goal — use [migrate-custom-code](../migrate-custom-code/SKILL.md).
