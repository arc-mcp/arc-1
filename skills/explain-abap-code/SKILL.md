---
name: explain-abap-code
description: Explain ABAP objects with full dependency context (via SAPContext) and optional ATC code quality analysis — replicates SAP Joule's "Explain Code" capability, including behavior definitions (BDEF — CRUD graph, determinations/validations, bound handler class). Use when asked to "explain this ABAP", "what does ZCL_X do", "walk me through this class/CDS view/behavior definition", or "review this object's quality".
---

# Explain ABAP Code

Explain ABAP objects with full dependency context and optional ATC code quality analysis.

This skill replicates SAP Joule's "Explain Code" capability by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices). It goes beyond J4D by providing compressed dependency graphs via SAPContext.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Object type | Auto-detect via SAPSearch | Don't make user look up the type |
| Depth | Overview | Start high-level, user can ask for detail |
| ATC | No | Only run if user asks about code quality |
| Dependencies | Fetch via SAPContext | Always get the dependency graph |
| BDEF handler class | Discover from `implementation in class` clause | The behavior logic lives in the bound pool class |

## Input

The user provides an ABAP object name (e.g., `ZCL_TRAVEL_HANDLER`, `ZI_SALESORDER`, `Z_REPORT_POSTING`).

Only the **object name** is required. If the user provides just an object name, auto-detect the type and proceed immediately with an overview explanation.

Optionally, the user may specify:
- **Object type** (default: auto-detect)
- **Explain ATC findings?** (default: no)
- **Depth** — "overview" or "detailed" (default: overview)

## Step 1: Read the Object

### 1a. Resolve type (if not provided)

If the user didn't specify a type, search for the object:

```
SAPSearch(query="<object_name>")
```

Use the first result's type. If ambiguous (multiple matches), ask the user.

### 1b. Read the source code

```
SAPRead(type="<type>", name="<object_name>")
```

### 1c. For classes — also get the method listing

```
SAPRead(type="CLAS", name="<class_name>", method="*")
```

This returns all methods with their signatures, visibility (public/protected/private), and parameter types. Essential for understanding the class API.

### 1d. For CDS entities — also get the structured field list

```
SAPRead(type="DDLS", name="<entity_name>", include="elements")
```

Returns a formatted listing of all fields with key markers, aliases, associations, and expression types.

### 1e. (Optional) Read related artifacts

Depending on type, also read associated objects:
- **CLAS**: `SAPRead(type="CLAS", name="<class>", include="testclasses")` — check if tests exist
- **DDLS**: `SAPRead(type="BDEF", name="<entity>")` — check if behavior definition exists; `SAPRead(type="DCLS", name="<entity>_DCL")` — check CDS access control; `SAPRead(type="DDLX", name="<entity>")` — check for metadata extensions
- **BDEF**: `SAPRead(type="DDLS", name="<entity>")` — read the associated CDS view

These may fail if the related artifact doesn't exist — that's fine, skip them.

### 1f. For behavior definitions (BDEF) — walk the RAP graph

A behavior definition is only meaningful together with its bound CDS root entity and its behavior pool (handler) class. When the object is a BDEF, do this instead of (or in addition to) the steps above:

**Read the BDEF source:**

```
SAPRead(type="BDEF", name="<bdef_name>")
```

**Identify the implementation type + bound pool class** by reading the BDEF source:
- First non-comment token: `managed` / `unmanaged` / `projection` / `abstract` / `interface` — this is the implementation kind
- `strict ( 2 )` → latest RAP syntax checks; `with draft` / `with collaborative draft` → draft-enabled
- The clause `... implementation in class <ZBP_NAME> unique;` names the **behavior pool class**. Extract `<ZBP_NAME>` with a regex like `implementation\s+in\s+class\s+(\S+)`. (A `projection;` BDEF may have no pool class — it reuses the base behavior via `use ...`.)

**Read the behavior pool class** (the handler logic lives in its local includes — usually CCIMP):

```
SAPRead(type="CLAS", name="<ZBP_NAME>", include="implementations")
```

If that returns empty, also try `include="definitions"` (CCDEF) and the main include. The local handler classes are named `lhc_<alias>` and each `FOR DETERMINE` / `FOR VALIDATE` / `FOR MODIFY` method implements the corresponding BDEF declaration.

**Read the bound CDS root entity** to understand the data model the behavior governs:

```
SAPRead(type="DDLS", name="<root_cds>", include="elements")
```

The root CDS name appears in `define behavior for <root_cds> alias <alias>`.

**For a projection BDEF**, also read the underlying base BDEF (the one it projects) to see which operations are reused (`use create; use update; use action ...`).

These reads may fail if an artifact doesn't exist (e.g. a pure abstract BDEF) — skip gracefully.

### 1g. For function groups (FUGR) — read the full code tree

A function group's logic is spread across nested includes: the main program references the `TOP` (global data) and `UXX` (function-module dispatcher) includes, and the actual `FUNCTION … ENDFUNCTION` bodies live in further-nested `LZ<grp>U01/U02…` includes pulled in from `UXX` (PBO/PAI subroutines in `…O…/…I…` includes). Read the whole tree in one call with `expand_includes`:

```
SAPRead(type="FUGR", name="<group>", expand_includes=true)
```

This returns the main source plus every nested include (recursively, depth/count-capped), each prefixed with a `=== <name> ===` marker — so you get all the function module bodies and flow logic in one read. Without `expand_includes`, you only get the function-module list.

> **Screen flow is not available.** Dynpros (screens) and GUI status (CUA) are **not exposed by ADT over REST** — they are SAPGUI-only (SE51/SE41), and the endpoints return 404. So for a FUGR you can explain the **business purpose, function-module responsibilities, and flow logic** from the code, but **not** the screen layout / PBO-PAI screen sequence beyond what the PBO/PAI module *code* reveals. State this limitation if the user asks about the screen flow specifically.

## Step 2: Get Dependency Context

```
SAPContext(type="<type>", name="<object_name>")
```

This automatically extracts all dependencies and fetches compressed public API contracts for each. It provides:
- For classes: used interfaces, superclasses, injected dependencies, called methods on other classes
- For CDS views: data sources (FROM, JOIN), associations, compositions, projection bases
- For programs: called function modules, used classes, included programs

For complex objects with deep dependency chains, use `depth=2`:

```
SAPContext(type="<type>", name="<object_name>", depth=2)
```

If SAPContext fails (e.g., unsupported type), fall back to manual reads of key dependencies identified in the source code.

**Supported types:** `SAPContext` accepts `CLAS`, `INTF`, `PROG`, `FUNC`, `DDLS` (on-prem) / `CLAS`, `INTF`, `DDLS` (BTP). It does **not** accept `BDEF`. So when explaining a BDEF, run dependency/impact analysis on the **bound CDS root entity** instead:

```
SAPContext(action="impact", name="<root_cds>")
```

`action="impact"` (DDLS only) returns the downstream blast radius — projection views, consumption views, and services that build on the behavior. This is the "dependencies / who consumes this" answer for a behavior definition. For the handler class internals, run `SAPContext(type="CLAS", name="<ZBP_NAME>")`.

## Step 3: (Optional) Run ATC Check

If the user asked to explain code quality or ATC findings:

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>")
```

If a specific ATC variant is needed (e.g., S/4HANA readiness):

```
SAPDiagnose(action="atc", type="<type>", name="<object_name>", variant="<variant>")
```

Group findings by priority:
- **Priority 1 (Errors)**: Must-fix issues — deprecated APIs, syntax problems
- **Priority 2 (Warnings)**: Should-fix — performance, maintainability
- **Priority 3 (Info)**: Nice-to-fix — style, conventions
- Check each finding's `hasQuickfix` flag. If `true`, mention that SAP provides a machine-applicable quickfix proposal for that location.

## Step 4: (Optional) Research with mcp-sap-docs

For unfamiliar SAP APIs found in the source code:

```
search("<class_or_function_name> ABAP documentation")
```

For ATC findings that need explanation:

```
search("<checkTitle> simplification item S/4HANA")
```

For SAP Notes if available:

```
sap_notes_search(q="<finding_or_api_name>")
```

Use documentation results to enrich the explanation with official SAP context.

## Step 5: Explain

Present a structured explanation with the following sections. Adapt depth based on user preference (overview vs detailed).

### Summary
- **Purpose**: What the object does in one sentence
- **Type**: Object type and classification (e.g., "RAP behavior pool", "interface CDS view", "ALV report")
- **Scope**: How many methods/fields/lines, complexity assessment

### Public API
For classes:
- Key public methods with their signatures and purpose
- Implemented interfaces
- Constructor parameters (especially injected dependencies)
- Events raised

For CDS views:
- Exposed fields with business meaning
- Parameters (if any)
- Associations available for navigation

### Business Logic
- Core processing flow (what happens when key methods are called)
- Important business rules and conditions
- Data transformations and calculations
- Error handling approach

### Behavior Definition (if the object is a BDEF)
Structure the explanation around the RAP behavior graph you read in Step 1f:
- **Implementation kind**: managed / unmanaged / projection / abstract / interface — and what that implies (framework-provided CRUD vs custom handlers vs reuse/typing layer). Note `strict(2)` and `with draft` if present.
- **Business purpose**: derived from the bound CDS root entity + the BDEF header comments.
- **Per-entity model**: for each `define behavior for <CDS> alias <alias>` — persistent table, `lock master`/`lock dependent`, `authorization master`/`authorization dependent`, `etag`.
- **Operations (the CRUD graph)**: `create` / `update` / `delete`, create-by-association (`association _X { create; }`), and whether draft actions (`Edit`, `Activate`, `Discard`, `Resume`, `Prepare`) are present.
- **Determinations**: `determination <name> on save|on modify` — what each derives, read from the matching `FOR DETERMINE` method in the pool class.
- **Validations**: `validation <name> on save` — what each enforces, from the `FOR VALIDATE` method.
- **Actions / functions**: `action <name>` (+ `static`/`factory`/`parameter`/`result`), from the `FOR MODIFY` / `FOR READ` methods.
- **Side effects**: `side effects { ... }` declarations (what UI refresh / recompute they trigger).
- **Field controls**: `field ( readonly | mandatory | numbering : managed )`, `mapping for <table>`.
- For a **projection** BDEF: which base operations/actions are reused via `use ...`.

### Dependencies
From SAPContext results:
- Direct dependencies with their roles (data source, helper, framework)
- Key interfaces/classes used and why
- External system calls (RFC, HTTP, etc.) if any
- Database tables accessed

### Security / Authorization
- CDS access control (`DCLS`) rules if present (row-level restrictions, role mapping)
- Behavior-level authorization hints (`authorization master`, `authorization dependent by`) when present in BDEF
- Practical impact: what data/operations may be restricted at runtime

### Code Quality (if ATC was run)
From ATC results:
- Summary: total findings by priority
- Top findings with explanation of impact
- Recommendations for improvement

### Follow-up Options

Offer the user next steps:
- "Want me to explain a specific method in detail?"
- "Want me to get SAP quickfix proposals for the ATC findings?" (→ `SAPDiagnose(action="quickfix")`)
- "Want me to apply SAP's quickfix for <finding>?" (uses SAP-verified fix proposals + `apply_quickfix`)
- "Want me to analyze the ATC findings and suggest fixes?" (→ migrate-custom-code skill)
- "Want me to generate unit tests for this class?" (→ generate-abap-unit-test skill)
- "Want me to show the full dependency graph?" (→ SAPContext with depth=2)
- For a BDEF: "Want me to implement a missing determination/validation/action body?" (→ generate-rap-logic skill) or "Want me to scaffold the behavior pool handlers?" (→ `SAPWrite(action="scaffold_rap_handlers")`)

## Error Handling

### Common Issues and Fixes

| Error | Cause | Fix |
|---|---|---|
| Object not found | Name misspelled or object doesn't exist | Use SAPSearch to find similar names |
| SAPContext fails | Object type not supported for dependency analysis | Fall back to manual reads of key dependencies found in source |
| ATC check returns no findings | No ATC configuration or clean code | Inform user — no findings is good news |
| ATC variant not found | Specified variant doesn't exist on system | Run default ATC, list available variants |
| Method listing empty | Object is not a class or has no methods | Skip method listing, explain from source only |
| Source is empty | Object exists but has no source (e.g., generated proxy) | Inform user, try reading related objects instead |
| `SAPContext` rejects BDEF type | BDEF isn't a supported SAPContext type | Run `SAPContext(action="impact", name="<root_cds>")` on the bound CDS root instead |
| BDEF pool class not found | `projection;` BDEF (no own pool) or class name parsed wrong | Skip the class read; explain from the projection's `use` clauses + base BDEF |

## Notes

### BTP vs On-Premise Differences

- **BTP**: Fewer object types available — no PROG, INCL, FUGR. Focus on released APIs and ABAP Cloud objects. DDLS, DCLS, CLAS, INTF, BDEF, DDLX, SRVD are the primary types. ATC variants are limited to cloud readiness checks.
- **On-Premise**: Full range of object types. All ATC variants available. Can explain legacy objects (FORM routines, function modules, classic reports).

### What This Skill Does NOT Do

- **No code modification**: This skill only reads and explains — it never writes or changes code
- **No refactoring suggestions**: For improvement suggestions, use ATC analysis or migration skill
- **No test generation**: For generating tests, use generate-abap-unit-test or generate-cds-unit-test skills
- **No cross-system comparison**: Explains objects on one system at a time

### When to Use This Skill

- When onboarding to an unfamiliar codebase
- When investigating a bug or understanding existing behavior
- When reviewing code quality before a migration
- When documenting an undocumented object
- When understanding the impact of changing a shared class or CDS view
