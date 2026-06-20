---
name: migrate-custom-code
description: ATC-driven S/4HANA custom code migration — runs ATC readiness checks, groups findings, and generates clean-core replacement code following modern ABAP patterns. Use when asked to "migrate this Z program", "fix ATC findings", "modernize this code for S/4HANA", "clean-core fixes", or "ABAP Cloud readiness for this object".
---

# Migrate Custom Code

ATC-driven S/4HANA custom code migration assistant with automated fix proposals.

This skill replicates SAP Joule's "Custom Code Migration" capability by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices). It runs ATC readiness checks, groups and explains findings, and generates replacement code following modern ABAP patterns.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Object type | Auto-detect via SAPSearch | Don't make user look up the type |
| ATC variant | System default | Use what's configured on the system |
| Scope | `fix` (explain + fix proposals) | Most actionable output |
| Priority filter | All priorities (start with Priority 1 errors) | Don't miss anything, but fix most critical first |

## Input

The user provides an object or package to check (e.g., `ZCL_SALES_HANDLER`, `Z_REPORT_POSTING`, `ZSALES_PKG`).

Only the **object name** is required. If the user provides just an object name, auto-detect the type and proceed with the default variant and fix scope.

Optionally, the user may specify:
- **Object type** (default: auto-detect via SAPSearch)
- **Target release variant** (e.g., `S4HANA_2023`, `S4HANA_READINESS`; default: system default)
- **Scope** — `explain` (findings only) or `fix` (explain + fix proposals; default: `fix`)

## Step 1: Run ATC Readiness Check

> **ATC gotchas (verified live on S/4HANA 2023):**
> - **ATC skips `$TMP` / local objects.** A check run against a `$TMP` object resolves to an empty object set and returns **zero findings** — this is not "clean code", it's "not checked". Run ATC against objects in a **transportable package**. If the user points you at `$TMP` code, say so and ask them to assign it to a transportable package first.
> - **The check variant must exist on the system.** `ABAP_CLOUD_READINESS` is the standard name on SAP BTP ABAP / S/4HANA Cloud, but on-premise systems often ship `S4HANA_READINESS_<release>` (e.g. `S4HANA_READINESS_2023`) or `SAP_CLOUD_PLATFORM_DEFAULT` instead. If the named variant is absent, fall back to the system default (omit `variant`).

### 1a. Run ATC on the target object

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>", variant="<variant>")
```

If no variant was specified, run with the system default first (omitting `variant` uses the system's configured default check variant):

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>")
```

Then suggest a readiness variant if available (e.g., `S4HANA_READINESS_2023`, `ABAP_CLOUD_READINESS`). If a run returns zero findings on code you expect to be flagged, first confirm the object is **not** in `$TMP` (see the gotcha above).

### 1b. For package-level checks — find all objects first

```
SAPRead(type="DEVC", name="<package_name>")
```

This returns all objects in the package. Then run ATC on each object individually. For large packages, prioritize PROG, CLAS, FUGR, FUNC types first as they typically contain the most migration-relevant findings.

## Step 2: Group and Prioritize Findings

Organize findings into a structured summary. Deduplicate findings with the same checkTitle across multiple locations.

### Summary Table

Present findings grouped by priority and category:

```
Migration Readiness Report for <object_name>
=============================================

Total findings: <N>
  Priority 1 (Errors):   <n>
  Priority 2 (Warnings): <n>
  Priority 3 (Info):     <n>

| # | Priority | Check | Category | Count | Affected Objects |
|---|----------|-------|----------|-------|------------------|
| 1 | 1 | Use of obsolete statement MOVE | Syntax Change | 3 | Z_REPORT_POSTING |
| 2 | 1 | Call to released API CL_GUI_ALV_GRID | Deprecated API | 1 | Z_REPORT_POSTING |
| 3 | 2 | SELECT...ENDSELECT pattern | Performance | 5 | Z_REPORT_POSTING |
| ...
```

### Categories

Group findings into these categories:
- **Deprecated API**: Calls to functions, classes, or methods that are deprecated or not released in S/4HANA
- **Syntax Change**: Obsolete ABAP statements that must be replaced
- **Semantic Change**: Behavior differences in S/4HANA (e.g., changed table structures, removed fields)
- **Performance**: Patterns that need optimization for S/4HANA
- **Simplification**: Items from the S/4HANA simplification list

Ask the user: **"Which findings should I explain and fix? (all / specific numbers / errors only)"**

## Step 3: Explain Findings

For each selected finding, provide a detailed explanation.

### 3a. Read the affected source code

```
SAPRead(type="<type>", name="<object_name>")
```

Show the code context around each finding (the line with the issue and a few lines before/after).

### 3b. Search documentation for migration guidance

```
search("<checkTitle> S/4HANA migration")
search("<deprecated_api> replacement ABAP")
```

For specific simplification items:

```
search("<simplification_item_id> simplification list")
```

### 3c. Search SAP Notes (if SAP Notes MCP is available)

```
sap_notes_search(q="<checkTitle>")
sap_notes_search(q="<deprecated_api> replacement")
```

### 3d. Present explanation for each finding

For each finding, present:
- **What**: The finding description and where it occurs (file, line)
- **Why**: Why this is a problem for S/4HANA (compatibility, removal, behavior change)
- **Replacement**: The recommended modern ABAP pattern or API to use instead
- **Impact**: Risk level of the change (low = syntax swap, medium = logic change, high = redesign needed)

## Step 4: Generate Fix Proposals

For each fixable finding, generate replacement code based on documentation and modern ABAP patterns.

### 4a. Check SAP quickfix first (before LLM-generated fixes)

For each finding location, first check whether SAP provides a native quickfix:

```
SAPDiagnose(action="quickfix", type="<type>", name="<object_name>", source="<current_source>", line=<finding_line>, column=0)
```

If proposals are returned:
- Present them as **SAP-verified fixes** (higher confidence than LLM-generated fixes)
- If the user selects one, apply it and get exact text deltas:

```
SAPDiagnose(action="apply_quickfix", type="<type>", name="<object_name>", source="<current_source>", line=<finding_line>, column=0, proposalUri="<proposal_uri>", proposalUserContent="<proposal_user_content>")
```

- `apply_quickfix` returns ranged **text deltas — it does not persist**. Apply the returned deltas to the source yourself, then write the result via `SAPWrite(action="update")`. When applying multiple fixes to the same object, re-resolve each finding's line after each write (earlier edits shift later line numbers), or fix top-to-bottom.

> **Quickfix availability is system-dependent.** SAP only offers quickfix proposals where the system has the corresponding check/cloudification content installed. On a bare ABAP trial or a system without the Clean-Core remediation content, `getFixProposals` returns `[]` and ATC findings carry `hasQuickfix=false` — that's expected, not a bug. In that case skip straight to LLM-generated fixes (the options below). Prefer SAP quickfixes only when they actually come back.

> **Match the proposal to the finding — don't blindly apply `proposals[0]`.** `quickfix` returns *every* proposal applicable at that source position, which often includes generic **refactorings** unrelated to the finding (verified live on S/4HANA 2023: a position returned "Rename", "Convert to attribute", "Convert to importing parameter", "Extract local variable", …). Pick the proposal whose `name`/`description` actually addresses the finding; ignore the rest.

> **Refactoring-style proposals can't be auto-applied here.** Proposals whose `uri` contains `/providers/refactoring/` (rename / convert-to-X / extract / introduce) are interactive refactorings that ride the separate `/sap/bc/adt/refactorings` multi-step flow — `apply_quickfix` returns **HTTP 500** for them (verified live). They are not finding fixes; skip them for automated apply and fall back to an LLM-generated fix. Only proposals from non-refactoring providers apply cleanly through `apply_quickfix`.

### Fix Options

Present 4 options per finding:
1. **Apply** — Auto-write the fix via ARC-1
2. **Show** — Display the before/after diff without applying
3. **Skip** — Move to the next finding
4. **SAP Quick Fix** — Apply SAP's quickfix proposal when available (preferred over LLM-generated fix)

Group related fixes that can be applied together (e.g., multiple deprecated statements in the same method).

### Common Migration Patterns

Use these replacement patterns when generating fixes:

| Old Pattern | New Pattern | Notes |
|---|---|---|
| `CALL FUNCTION '<fm>'` | Class method call | Find replacement class in documentation |
| `SELECT...ENDSELECT` | `SELECT INTO TABLE` + loop | Avoid row-by-row processing |
| `MOVE-CORRESPONDING src TO dst` | `dst = CORRESPONDING #( src )` | New ABAP syntax |
| `READ TABLE itab WITH KEY k = v` | `line_exists( itab[ k = v ] )` or `VALUE #( itab[ k = v ] OPTIONAL )` | Use table expressions |
| `FORM/PERFORM` | Method call | Extract to class method |
| `DESCRIBE TABLE itab LINES lv_cnt` | `lv_cnt = lines( itab )` | Built-in function |
| `CALL METHOD obj->method` | `obj->method( )` | Functional call syntax |
| `CREATE OBJECT obj TYPE cls` | `obj = NEW cls( )` | NEW operator |
| `TRANSLATE str TO UPPER CASE` | `str = to_upper( str )` | Built-in function |
| Classic DB view | CDS view entity | Redesign required |
| `WRITE:` / ALV list | Fiori / RAP service | Major redesign |

## Step 5: Apply Selected Fixes

### 5a. Apply fixes

For method-level fixes in classes:

```
SAPWrite(action="edit_method", type="CLAS", name="<class>", method="<method>", source="<fixed_source>", transport="<transport>")
```

For full-source updates (programs, functions):

```
SAPWrite(action="update", type="<type>", name="<object_name>", source="<fixed_source>", transport="<transport>")
```

### 5b. Validate after each batch of fixes

```
SAPDiagnose(action="syntax", type="<type>", name="<object_name>")
```

If syntax errors are introduced: revert by writing back the original source and report the issue.

### 5c. Activate

```
SAPActivate(type="<type>", name="<object_name>")
```

## Step 6: Re-validate

Run ATC again to confirm findings are resolved:

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>", variant="<variant>")
```

### Report results

Present a final summary:

```
Migration Fix Summary for <object_name>
========================================

Findings fixed:             <n>
Findings remaining:         <n>
Findings needing manual fix: <n>

Fixed:
  - [FIXED] Use of obsolete statement MOVE (3 occurrences)
  - [FIXED] SELECT...ENDSELECT replaced with SELECT INTO TABLE

Remaining:
  - [MANUAL] CL_GUI_ALV_GRID replacement requires UI redesign
  - [SKIPPED] User skipped FORM/PERFORM migration

Next steps:
  - Address remaining manual findings
  - Run full regression tests
  - Consider running ATC on dependent objects
```

## Error Handling

### Common Issues and Fixes

| Error | Cause | Fix |
|---|---|---|
| ATC variant not found | Variant doesn't exist on this system | Run default ATC, list available variants with `SAPDiagnose(action="atc")` |
| Object locked by another user | Object is being edited elsewhere | Inform user, suggest trying later or contacting the lock holder |
| Fix causes new syntax error | Generated replacement code is incorrect | Revert to original source, show the diff, suggest manual correction |
| No mcp-sap-docs available | Documentation MCP not configured | Explain findings using ATC finding text only, recommend user check SAP Help Portal |
| Package has too many objects | Large package with 100+ objects | Suggest breaking into smaller batches by sub-package or object type |
| ATC returns no findings | Object is already S/4HANA ready | Inform user — no findings is good news, suggest checking with a stricter variant |
| Transport required but not provided | Object is in a transportable package | Ask user for transport request number before applying fixes |

## Notes

### BTP vs On-Premise Differences

- **BTP**: Limited ATC variants — primarily cloud readiness checks. BTP objects already use ABAP Cloud syntax, so migration focus is different: deprecated released APIs, not classic ABAP constructs. Fewer findings expected since ABAP Cloud enforces modern patterns.
- **On-Premise**: Full range of S/4HANA readiness variants available (2020, 2021, 2022, 2023+). Classic ABAP objects may have many findings. FORM/PERFORM, function modules, classic reports, and DB views are common migration targets. Custom Code Migration Worklist (SCMA) may provide additional context.

### Quickfix Availability

- SAP quickfixes are available for many common ATC findings (for example obsolete statements, missing declarations, straightforward syntax issues).
- Not every finding has a quickfix. Deprecated API replacements and architecture-level redesign usually still require manual/LLM-guided refactoring.

### What This Skill Does NOT Do

- **No transport management**: User is responsible for creating and releasing transport requests
- **No migration dossier**: Handles one object or one package finding workflow — for reviewed, saved, or visual package-level dossiers, use [sap-migration-dossier](../sap-migration-dossier/SKILL.md)
- **No custom ATC variant creation**: Uses existing ATC variants on the system
- **No table structure migration**: Cannot modify DDIC table structures (e.g., field length changes for S/4HANA)
- **No test execution**: Does not run regression tests after fixes — user should validate manually or use generate-abap-unit-test skill

### When to Use This Skill

- When preparing custom code for S/4HANA migration
- When checking if code meets ABAP Cloud readiness standards
- When investigating ATC findings and needing explanation + fix proposals
- When modernizing legacy ABAP code patterns (FORM, obsolete statements)
- NOT for greenfield development — use generate-rap-service for new objects
