# Generate RAP OData Service — Research-First

Generate a production-quality RAP OData service through deep system research, best-practice analysis, and iterative planning before writing a single line of code.

This skill produces an implementation plan informed by the target SAP system's actual capabilities, existing code patterns, SAP documentation, and user requirements — then executes it only after explicit user approval.

## Smart Defaults (apply silently, do NOT ask before research)

| Setting | Default | Rationale |
|---|---|---|
| Package | User's Z* package with transport | Production-ready; only use `$TMP` if user explicitly asks |
| Key strategy | UUID (`sysuuid_x16`), managed numbering | Simplest, no collision risk |
| Behavior scenario | Managed | Framework handles CRUD, most common |
| OData version | V4 | Current SAP standard |
| Draft | Prefer for transactional Fiori Elements UI services; verify against system release and BO constraints | Best default for editable FE apps, but not every RAP service needs draft |
| Strict mode | `strict ( 2 )` unless system patterns or SAP constraints justify otherwise | Current RAP best practice, but not universal |
| Naming | SAP standard (see reference section) | Overridden by existing system patterns if found |
| Admin fields | System-appropriate (`syuname`/`timestampl` or `abp_*`) | Detected from system type |
| Service exposure | OData V4 UI provider contract by default | Best fit for Fiori Elements unless the use case is an API-first service |

These defaults are starting points — research in Phase 1 may override them based on existing system patterns.

## Input

The user provides a natural language description of the business requirement. This can range from vague ("I need something to track maintenance orders") to detailed ("REST API for plant maintenance with equipment hierarchy, work orders, and time recording").

Only the **business requirement** is required. Gather initial context — do NOT over-interview at this stage. Research will surface the right questions later.

Optionally, the user may specify:
- **Package** (required — ask if not provided; only default to `$TMP` if user explicitly says so)
- **Transport request** (only needed for non-`$TMP` packages — resolved in Phase 1-pre)
- **Any known constraints** (e.g., "must use existing table ZMAINT_ORDER", "needs to integrate with PM module")

If the user provides just a description, proceed directly to research. Questions come AFTER research, when you know enough to ask the right ones.

---

## Phase 1-pre: Resolve Package and Transport

Ask the user for their target package if not provided. Then resolve the transport request (skip only if package is `$TMP`):

```
SAPTransport(action="check", objectType="DDLS", objectName="<placeholder_name>", package="<package>")
```

This checks if a transport is required and returns existing transports for the package. If a transport is required:

1. **User provided a transport**: Use it for all creates
2. **Existing transport found**: Present the list and ask the user to pick one
3. **No transport available**: Create one:
   ```
   SAPTransport(action="create", description="RAP Service: <Entity>", package="<package>")
   ```

**If transport is required but unavailable, STOP** — all write operations will fail without a valid transport for non-`$TMP` packages.

---

## Phase 1: Deep System Research

Research the target system thoroughly before designing anything. Every finding informs the plan.

### 1a. System Capabilities & Version

Detect what the system supports — this determines available RAP features, syntax, naming, and safe defaults.

If `./system-info.md` already exists from `bootstrap-system-context`, use it as input. Otherwise, reproduce the critical reads inline:

```
SAPRead(type="SYSTEM")
SAPRead(type="COMPONENTS")
SAPManage(action="probe")
SAPLint(action="list_rules")
```

**Note:** `rap.available` in the probe response is informational — it indicates whether the DDL source endpoint was detected, but RAP may still be available. Proceed with creation and handle errors if they occur.

Extract and note:
- **System type**: BTP ABAP Environment vs. On-Premise (and release level: 7.52, 7.54, 7.57, S/4HANA 2020+, etc.)
- **ABAP language version**: Cloud (strict, released APIs only) vs. Standard (full ABAP)
- **RAP support level**: Managed, unmanaged, abstract BOs? Draft support? Late numbering? Determination on modify vs. save?
- **CDS capabilities**: View entities vs. classic views? Table entities? Metadata extensions? Access control?
- **Available features**: ATC, syntax check, unit test runner, transport management, FLP customization, abapGit/gCTS, version history
- **FLP support**: If `flp` feature is available, the service can be registered in the Fiori Launchpad after creation
- **Lint profile**: cloud vs on-prem preset, active ABAP version, formatter style

### 1b. Existing RAP Projects — Pattern Mining

Search for existing RAP artifacts to understand the system's established patterns. This is critical for consistency.

```
SAPSearch(query="BDEF Z*", maxResults=20)
```

```
SAPSearch(query="SRVD Z*", maxResults=20)
```

```
SAPSearch(query="SRVB Z*", maxResults=20)
```

```
SAPSearch(query="DCLS Z*", maxResults=20)
```

```
SAPSearch(query="DDLX Z*", maxResults=20)
```

**If NO Z* BDEFs are found**, you MUST still ground yourself in at least one real system example before writing any code. Use this deterministic fallback:

```
SAPRead(type="TABL", name="SCARR")
```

This shows you the system's actual TABL annotation pattern (enhancement category, delivery class, data maintenance, client handling). Then read one activated CDS view:

```
SAPSearch(query="DDLS I_*", maxResults=5)
SAPRead(type="DDLS", name="<first_result>")
```

This shows CDS conventions (client field handling, alias style, annotation patterns). **Do NOT proceed to Phase 4 until at least one real system table and one CDS view are in context.** Writing from memory of documentation alone is the #1 cause of wasted retries.

If results are found, read 2-3 representative RAP stacks to extract the team's patterns:

```
SAPRead(type="BDEF", name="<found_bdef>")
```

```
SAPRead(type="DDLS", name="<found_interface_view>")
```

```
SAPRead(type="DDLS", name="<found_projection_view>")
```

```
SAPRead(type="DDLX", name="<found_metadata_ext>")
```

```
SAPRead(type="SRVB", name="<found_service_binding>")
```

```
SAPContext(type="DDLS", name="<found_interface_view>", action="impact")
```

```
SAPRead(type="VERSIONS", name="<found_interface_view>", objectType="DDLS")
```

```
SAPRead(type="SKTD", name="<found_interface_view>")
```

From these, extract:
- **Naming conventions**: What prefix pattern? `ZI_`/`ZC_`/`ZR_`? Entity suffix patterns? Table naming?
- **Architecture style**: Managed vs. unmanaged? Draft enabled? `strict ( 2 )` or `strict`?
- **Annotation patterns**: Which `@UI` annotation style? Header info pattern? Facet structure?
- **Field naming**: CamelCase aliases? Underscore style? Abbreviation patterns?
- **Admin field patterns**: Which timestamp/user field types are used? (`syuname` vs `abp_creation_user`, `timestampl` vs `abp_creation_tstmpl`)
- **Key strategy**: UUID (`sysuuid_x16`)? Semantic keys? Number ranges?
- **Behavior patterns**: Which determinations/validations are standard? Authorization pattern?
- **Draft handling**: `with draft` present? Draft table naming? Draft actions included?
- **OData exposure**: UI vs Web API bindings? V2 or V4? Service definition/provider contract style?
- **Recent evolution**: Did the revision history show stable patterns or an ongoing migration?
- **Documentation presence**: Are SKTD notes attached to important RAP artifacts?

### 1b2. Optional Git / Delivery Context

If `SAPManage(action="probe")` shows `abapGit` or gCTS support and the target package may already belong to a repo-backed workflow, inspect that context before creating new artifacts:

```
SAPGit(action="list_repos")
SAPGit(action="objects", repoId="<repo_id>")
SAPGit(action="history", repoId="<repo_id>", limit=20)
```

Use this to learn:
- Whether the target package is already repo-managed
- Which naming/branching conventions are active
- Whether the package is under active delivery and should align with an existing repo layout

### 1c. Existing Database Tables & Domain Objects

If the user mentioned existing tables or business objects, read them:

```
SAPSearch(query="<mentioned_table_or_object>")
```

```
SAPRead(type="TABL", name="<found_table>")
```

```
SAPContext(type="TABL", name="<found_table>")
```

Also search for related SAP standard objects in the domain:

```
SAPSearch(query="<domain_keyword>", maxResults=10)
```

Check if there are existing CDS views or tables the new service should build on rather than duplicating data.

If building on existing objects on a BTP system, check their API release state for Clean Core compliance:

```
SAPRead(type="API_STATE", name="<found_table_or_view>", objectType="TABL")
```

If an object is deprecated (C2) or not released, avoid building on it — search for its released successor instead.

To understand what already depends on a found CDS object, use CDS-specific impact instead of generic where-used:

```
SAPContext(type="DDLS", name="<found_view>", action="impact")
```

Use generic reverse dependencies only for non-DDLS objects:

```
SAPContext(type="CLAS", name="<found_class>", action="usages")
```

### 1d. Code Guidelines & Quality Standards

Check if the system has ATC configuration or custom check variants that indicate code quality standards:

```
SAPDiagnose(action="atc", type="CLAS", name="<any_existing_class>", variant="DEFAULT")
```

If existing RAP classes were found in 1b, read one and run lint + formatter discovery to understand the baseline:

```
SAPRead(type="CLAS", name="<found_bp_class>")
SAPLint(action="lint", source="<class_source>", name="<found_bp_class>")
SAPLint(action="get_formatter_settings")
```

This reveals what lint rules, strictness levels, and keyword/indentation preferences are enforced.

### 1e. Best Practices Research — SAP Documentation

Use the SAP documentation MCP server deliberately, not as a generic keyword dump.

1. Start with **official/reference-oriented** queries:
   - `includeSamples=false`
   - `abapFlavor="cloud"` on BTP / ABAP Cloud systems
   - `abapFlavor="standard"` on classic on-prem systems when relevant
2. Then run **example-oriented** queries:
   - `includeSamples=true`
3. Use `fetch(...)` on the top hits you actually rely on.
4. Use `sap_community_search(...)` only for edge cases, undocumented errors, or workaround hunting after official docs are insufficient.

The search terms below are **starting suggestions** — adapt them based on the user's specific business requirement and the architecture decisions that need to be made. Craft search queries that target the gaps in your knowledge for this particular service.

**Architecture and layering**:

```
search(query="RAP projection BO vs RAP BO interface", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="RAP service definition provider contracts odata_v4_ui odata_v4_webapi", includeSamples=false, abapFlavor="<cloud|standard>")
```

**Domain-specific** — tailor to the user's business domain:

```
search(query="<business_domain> RAP example SAP", includeSamples=true, abapFlavor="<cloud|standard>")
```

For example, if the user wants a travel app: `search("RAP travel booking managed scenario example")`

**Architecture decisions** — search only for topics relevant to this service:

```
search(query="RAP managed vs unmanaged scenario when to use", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="RAP draft handling total etag draft-enabled associations", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="RAP compositions parent child entity", includeSamples=true, abapFlavor="<cloud|standard>")
```

**UI / service behavior** — search if the service is UI-facing:

```
search(query="RAP value help metadata extension additional binding OData V4", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="RAP feature control side effects authorization control", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="metadata-driven UI metadata extension RAP Fiori Elements", includeSamples=false, abapFlavor="<cloud|standard>")
```

**Clean core / released APIs** — for BTP or released-object reuse:

```
search(query="ABAP API release RAP business object interface C1 C0", includeSamples=false, abapFlavor="cloud")
```

**Edge cases / troubleshooting only after official docs fail:**

```
sap_community_search(query="<exact error text or obscure RAP symptom>")
```

**Important:** Don't just run these searches verbatim. Analyze the user's spec and craft targeted queries that fill specific knowledge gaps. If the user asks for something unusual (for example, integration with a specific SAP module, specific field types, custom numbering, collaborative draft, or released BO interface consumption), search for those specifics.

No need to research naming conventions at runtime — the official SAP naming schema is documented below in the "SAP Official Naming Conventions" reference section. Use it directly as the default.

### 1f. Research Summary

Before proceeding, compile a structured research summary. Present this to the user:

```
## System Research Summary

### System Profile
- Type: [BTP / On-Prem S/4HANA 20XX / ECC with ABAP Platform]
- ABAP Version: [Cloud / Standard ABAP 7.5X]
- RAP Support: [Full managed+draft / Managed only / Basic]

### Existing Code Patterns Found
- Naming: [e.g., "ZI_ prefix for interface views, ZC_ for projections, Z prefix + _D suffix for tables"]
- Architecture: [e.g., "All existing BOs use managed with draft, strict(2), UUID keys"]
- Field Style: [e.g., "CamelCase aliases, abp_ admin field types on BTP"]
- Annotation Style: [e.g., "Metadata extensions for all UI annotations, facet-based layout"]
- Service exposure: [e.g., "projection view + OData V4 UI binding, provider contract aligned"]
- N existing RAP services found: [list names]

### Domain Research
- Related existing objects: [tables, views, classes found]
- SAP standard objects in domain: [relevant standard CDS views, BAPIs]
- Clean core posture: [released APIs confirmed / successor required / custom tables only]
- Best practices from docs: [key findings]

### Quality Baseline
- ATC variant: [DEFAULT / custom]
- Lint findings: [clean / N issues on existing code]
- Strictness: [strict(2) / strict / none]
- Formatter settings: [keywordUpper / keywordLower / keywordAuto, indentation on/off]
```

---

## Phase 2: Clarifying Questions

Based on research findings, ask targeted questions. Only ask what research couldn't answer. Group questions by category and provide recommendations based on findings.

### Architecture Questions

For each question, lead with a concrete recommendation based on the user's spec and research, explain why, then list alternatives with upsides/downsides. **These are foundational decisions — changing them after creation requires rebuilding most artifacts.** Make sure the user understands the trade-offs.

**1. Implementation scenario**
> Based on your spec [quote relevant part], I would suggest **managed** because [reason — e.g., "this is a new greenfield BO with no existing persistence logic to wrap"].
>
> Your options:
> | Option | Upside | Downside |
> |--------|--------|----------|
> | **Managed** | Framework handles CRUD automatically, less code, faster to build | Less control over persistence, must follow RAP conventions |
> | **Unmanaged** | Full control over persistence, can wrap existing BAPIs/FMs | You must implement all CRUD yourself, significantly more code |
> | **Managed with unmanaged save** | Managed convenience + custom save (e.g., call BAPI in save phase) | More complex, need to understand save sequence |
>
> Does managed fit, or do you need to wrap existing logic?

**2. Entity structure**
> Based on your spec [quote relevant part], I would suggest **[single entity / compositions]** because [reason — e.g., "your description mentions line items which is a classic parent-child pattern"].
>
> Your options:
> | Option | Upside | Downside |
> |--------|--------|----------|
> | **Single root entity** | Simplest, one table, one CDS stack | Cannot model hierarchies |
> | **Compositions (parent → child)** | Models real business hierarchies (Order → Items), draft cascades to children | Each child entity needs its own table + draft table + CDS stack |
> | **Associations** | Lightweight references to related entities (e.g., lookup to Customer) | No lifecycle dependency, no cascade delete |
>
> How many entities do you need and what are their relationships?

**3. Key strategy**
> Based on your spec, I would suggest **UUID (internal early numbering)** because [reason — e.g., "there's no mention of a user-visible business key, and UUID is the simplest and most reliable approach"].
>
> Your options:
> | Option | Upside | Downside |
> |--------|--------|----------|
> | **UUID (internal early numbering)** | Auto-generated, no user input, no collision risk, simplest | Keys are not human-readable |
> | **Semantic key** | User-provided meaningful key (e.g., OrderNumber) | Needs uniqueness validation, user must know the key upfront |
> | **Number range** | Server-assigned sequential numbers, human-readable | Needs number range object configuration, more setup |
>
> Which key strategy fits your use case?

**4. Service exposure / provider contract**
> I recommend **OData V4 UI** if this is a Fiori Elements-facing service, or **OData V4 Web API** if it is primarily for programmatic consumers. The service definition provider contract and the service binding type must match.
>
> **Important context on service exposure:**
> - **OData V4 UI**: Best default for Fiori Elements List Report / Object Page apps.
> - **OData V4 Web API**: Better when the primary consumer is integration code, tests, or external apps.
> - **OData V2**: Use only if there is a hard legacy/UI client requirement.
>
> Which consumer is primary: Fiori UI or API/integration?

**4b. Draft model**
> I recommend **draft** for transactional Fiori Elements applications unless your use case is explicitly non-draft, API-only, or constrained by system/version realities.
>
> Important constraints from SAP docs:
> - Draft requires a dedicated draft table and total ETag.
> - Every child in a draft-enabled composition hierarchy must be represented in the BDEF.
> - Some OData/Fiori behaviors differ between V2 and V4.
>
> Should this service be draft-enabled?

**4c. Authorization model**
> I recommend **`@AccessControl.authorizationCheck: #MANDATORY` + DCLS** so the service has explicit row-level authorization from day one. SAP's RAP docs recommend `#MANDATORY` instead of `#CHECK` for RAP BOs.
>
> Your options:
> | Option | Upside | Downside |
> |--------|--------|----------|
> | **#MANDATORY + DCLS** | Correct RAP baseline, production-ready authorization model | Requires access-control design decisions |
> | **#NOT_ALLOWED / #NOT_REQUIRED** | Faster prototyping | Not suitable for production authorization |
>
> Should I generate a strict baseline DCLS now (with inheriting conditions) and mark domain-specific rules as follow-up?

### Data Model Questions

**5. Fields and types**
> Based on your description, I've identified these business fields:
> | Field | Proposed Type | Notes |
> |-------|--------------|-------|
> | ... | ... | ... |
>
> Are these correct? Any fields to add, remove, or change types?

**6. Value helps / fixed values**
> Which fields need dropdowns or value helps?
> - Status field → fixed values (e.g., New/Open/Completed)?
> - Reference fields → value help from other CDS views?

**7. Existing data sources**
> [If tables/views were found in research]
> Should this service read from existing table `<TABLE>` or create a new table?

**7b. Proper DDIC typing (production services)**
> For production-quality services, I can create **proper domains (DOMA) and data elements (DTEL)** instead of using inline types. This enables:
> - Reusable field types across multiple tables/views
> - Fixed value lists on domains (e.g., status domain with A=Active, I=Inactive)
> - Consistent field labels (short/medium/long/heading) across all UIs
> - Search help attachments on data elements
>
> For `$TMP` prototypes, inline types are fine. For transportable packages, proper DOMA/DTEL is recommended.
> Want me to create dedicated domains and data elements for the business fields?

### Naming Questions

**8. Entity naming**
> I'm using the **official SAP naming conventions** (see reference section below). For an entity named e.g. `Travel`:
>
> | Artifact | SAP Convention | Proposed Name |
> |----------|---------------|---------------|
> | Active persistence table | `A_` prefix | `ZA_TRAVEL` |
> | Draft table | `D_` prefix | `ZD_TRAVEL` |
> | Base/interface CDS view | `R_` or `I_` prefix, `TP` suffix | `ZR_TravelTP` |
> | Projection CDS view | `C_` prefix | `ZC_Travel` |
> | Interface BDEF | Same as root entity | `ZR_TravelTP` |
> | Projection BDEF | Same as projection view | `ZC_Travel` |
> | Metadata extension | Same as CDS entity it annotates | `ZC_Travel` |
> | Service definition | `UI_` prefix (if UI service) | `ZUI_Travel` |
> | Service binding | `UI_` prefix, `_O4` suffix | `ZUI_Travel_O4` |
> | Behavior pool class | `BP_` prefix | `ZBP_R_TravelTP` |
>
> [If different patterns were found on the system]: Note: I found existing RAP projects on your system using a different convention (`<pattern found>`). I'm defaulting to SAP standard naming, but if you prefer to match the existing system-wide convention, or use a completely different one, let me know.
>
> Any name changes?

### UI / Service Questions

**9. Fiori Elements frontend**
> Will this service be consumed by a **Fiori Elements** app (auto-generated UI from annotations)?
>
> If yes, the metadata extension (DDLX) and UI annotations in the plan will be optimized for Fiori Elements List Report + Object Page (the most common pattern).
>
> **Note**: ARC-1 currently does not generate the Fiori Elements frontend application itself — only the backend OData service with proper annotations. The Fiori app can be generated from ADT ("Create Fiori Project..." on the service binding) or via the SAP Fiori tools in VS Code. The plan will include guidance on this as a follow-up step.
>
> If no (freestyle UI5 app or non-UI consumer), we can simplify the annotations.

**9b. Backend-driven UI features**
> If this is a Fiori Elements app, should I plan any of these from the start?
> - Field-level read-only / mandatory behavior
> - Value helps
> - Side effects
> - Feature control for actions or updates
>
> Note: feature control and side effects are RAP concepts, but they are primarily consumable by Fiori Elements UIs.

**10. Searchable fields**
> Which fields should be searchable (appear in the search bar)?

### Business Logic Questions (if applicable)

**12. Validations needed**
> Which business rules should be enforced?
> - Mandatory fields?
> - Cross-field validations (e.g., start date < end date)?
> - Status transition rules?

**13. Determinations needed**
> Which values should be auto-calculated?
> - Default values on create?
> - Derived fields (e.g., total = price × quantity)?

**14. Custom actions**
> Beyond standard CRUD, do you need actions like "Approve", "Release", "Cancel"?

**Important**: Don't ask all 14 questions. Research should have answered many of them. Only ask what's genuinely needed. Group remaining questions and present them concisely. Provide your recommendations for each.

Wait for the user to answer before proceeding.

---

## Phase 3: Implementation Plan

Based on research + user answers, create a detailed implementation plan.

### 3a. Design the Complete Artifact Stack

Create a comprehensive design table:

```
## RAP Service Implementation Plan: <Service Name>

### Architecture Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scenario | Managed / Unmanaged | [why] |
| Service exposure | OData V4 UI / OData V4 Web API / OData V2 | [why] |
| Draft | Yes / No | [why] |
| Key strategy | UUID / Semantic / NumberRange | [why] |
| Provider contract | `odata_v4_ui` / `odata_v4_webapi` / `odata_v2_*` | [why] |
| Strict mode | strict(2) / strict | [system dependent] |
| Admin fields | syuname+timestampl / abp_* types | [system dependent] |
| Authorization | `#MANDATORY + DCLS` / prototype-only | [why] |

### Entity Model
| Entity | Role | Key Fields | Business Fields |
|--------|------|-----------|-----------------|
| <Root> | Root entity | key_uuid | field1, field2, ... |
| <Child> | Composition of Root | key_uuid, parent_uuid | field_a, field_b, ... |

### Artifact Stack
| # | Type | Name | Description | Dependencies |
|---|------|------|-------------|-------------|
| 1 | DDLS | <table> | Database table entity | — |
| 2 | DDLS | <draft_table> | Draft table (if draft) | — |
| 3 | DDLS | ZI_<Entity> | Interface CDS view | #1 |
| 4 | DCLS | ZI_<Entity>_DCL | Access control for interface CDS view | #3 |
| 5 | CLAS | ZBP_I_<Entity> | Behavior pool class | #3 |
| 6 | BDEF | ZI_<Entity> | Interface behavior definition | #3, #5 |
| 7 | DDLS | ZC_<Entity> | Projection CDS view | #3 |
| 8 | BDEF | ZC_<Entity> | Projection behavior definition | #6, #7 |
| 9 | DDLX | ZC_<Entity> | Metadata extension | #7 |
| 10 | SRVD | ZSD_<Entity> | Service definition | #7 |
| 11 | SRVB | ZSB_<Entity>_V4 | Service binding | #10 |

### Field Definitions
| Field | DB Column | CDS Alias | Type | Annotations | Notes |
|-------|-----------|-----------|------|-------------|-------|
| Key | key_uuid | KeyUuid | sysuuid_x16 | @Semantics | Internal numbering |
| ... | ... | ... | ... | ... | ... |

### Behavior Definition Spec
- Scenario: managed
- Draft: with draft / without draft
- ETag: LocalLastChangedAt
- Lock: master [total etag LastChangedAt]
- Numbering: managed (KeyUuid)
- Read-only fields: KeyUuid, CreatedBy, CreatedAt, LastChangedBy, LastChangedAt, LocalLastChangedAt
- Draft actions: Resume, Edit, Activate (optimized), Discard, Prepare
- Determinations (Phase 1): [list with triggers]
- Validations (Phase 1): [list with triggers]
- Custom actions (Phase 1): [list or "none — add later"]

### UI Annotations Spec
- Header: typeName="<Entity>", title=<MainField>, description=<SecondaryField>
- Facets: [list facet structure]
- List columns: [ordered list with position, importance]
- Selection fields: [filter bar fields]
- Search fields: [searchable fields]

### Naming Convention Used
<Document which convention was followed and why — matches existing code / SAP standard / user preference>

### Quality Checks Planned
- Lint validation before each write (automatic via arc-1)
- PrettyPrint of ABAP sources using SAP formatter settings before CLAS writes
- Syntax check after each activation
- ATC check after full stack activation
- Revision/history readback if iterating on pre-existing artifacts
- [If behavior logic]: Unit test skeleton
```

### 3b. Present Plan for Approval

Present the plan clearly and ask. **Emphasize that changes after creation are significantly harder:**

> **Implementation Plan Ready**
>
> I've designed a [managed/unmanaged] RAP service with [N] entities, [with/without] draft, using [naming convention].
>
> [Show the Artifact Stack table and Field Definitions table]
>
> **⚠️ Important: Please review carefully before approving.** Once the artifacts are created on the SAP system, changing fundamental decisions (managed vs. unmanaged, key strategy, entity structure, draft yes/no) requires deleting and recreating most artifacts. It is **much easier to change the plan now** than to restructure after creation. If anything is unclear or you're unsure about a decision, ask now.
>
> **Please review:**
> 1. Are the artifact names correct?
> 2. Are the fields complete and correctly typed?
> 3. Is the architecture (managed/draft/keys) what you need?
> 4. Any questions about the design decisions?
> 5. Any changes before I start creating?
>
> **Say "approve" to proceed, or ask questions / tell me what to change.**

Do NOT proceed until the user explicitly approves.

---

## Phase 4: Implementation

After approval, create the artifacts. Use batch creation when possible.

**Fail fast:** If the first DDLS/BDEF write fails with 415 or 500, stop all further CDS writes immediately. Do not retry with different types — the underlying issue is system-level, not object-specific. Run `SAPManage(action="probe")` to verify `rap.available` status.

### MANDATORY: Error Recovery Protocol

**On ANY save failure (400, 007, syntax error) — follow this protocol, no exceptions:**

1. **STOP.** Do NOT retry with small variations. Do NOT delete and recreate.
2. **Read the full error text first.** ARC-1 now returns structured DDIC diagnostics (`SBD...` message IDs, `V1..V4` variables, and line-aware details; for source-based DDIC creates it may also append inactive syntax-check results). Use these details to identify the exact failing field/annotation.
3. **Read back** the object to see what actually saved: `SAPRead(type=X, name=Y)`
4. **Isolate the cause** by trying the absolute minimum source (just key fields + all required annotations). If minimum works → add fields one at a time. If minimum fails → the problem is annotations or object type, not your fields.
5. **Change only ONE thing** between retries. Never vary both annotations and fields simultaneously.
6. **After 3 failures on the same object**: STOP. Report the exact error text to the user and ask for guidance. Do NOT continue improvising.

**Key principle:** The problem is almost always your source content, never the object's state. Deleting and recreating with the same source will produce the same error. Fix the source first.

### MANDATORY: Use batch_create First

**ALWAYS try `batch_create` first.** Do not start with sequential creates. `batch_create` creates all objects in one call — put dependencies first in the array (tables → views → DCLS → class → BDEFs → service definition).

```
SAPWrite(action="batch_create", objects=[...], package="<package>", transport="<transport>")
```

**For composition-linked DDLS or other interdependent siblings** (parent's `composition [0..*] of ZR_CHILD` where the child is also in the same batch), pass `activateAtEnd: true` so ARC-1 writes inactive drafts for every object first and then issues ONE terminal `activateBatch`. SAP's activator sees the whole graph at once and resolves cross-references between siblings. Per-object inline activation would fail on the parent with `"data source ZR_CHILD does not exist or is not active"` because the child is still inactive when the parent gets activated.

```
SAPWrite(action="batch_create", activateAtEnd: true, objects=[...], package="<package>", transport="<transport>")
```

If some generated objects need explicit per-item routing, put `package` and `transport` on the individual objects. Item-level values override the top-level batch values and are required when a recovered plan mixes packages:

```
SAPWrite(action="batch_create", objects=[
  {type: "TABL", name: "<table>", package: "<package>", transport: "<transport>", source: "<ddl>"},
  {type: "DDLS", name: "ZI_<entity>", package: "<package>", transport: "<transport>", source: "<ddl>"}
])
```

Only fall back to sequential creation (Phase 4b) if `batch_create` returns an error. If batch fails: read the error, fix the SPECIFIC failing object's source, and retry `batch_create`. Do NOT switch to sequential mode after one batch failure.

### 4-pre. Pre-Implementation Check

Before creating artifacts, optionally check for lingering inactive objects that might cause conflicts:

```
SAPRead(type="INACTIVE_OBJECTS")
```

**Note:** This may return 404 on some systems where the `/sap/bc/adt/activation/inactive` endpoint is not available. If so, skip this check and proceed — it's a convenience check, not a requirement.

If inactive objects with conflicting names exist, resolve them first (activate or delete).

For reset/create preflights that need to know whether target names exist anywhere in the repository, use exact object-directory lookup instead of a long `SAPQuery` against TADIR:

```
SAPSearch(searchType="tadir_lookup",
  names=["<table>","ZI_<entity>","ZC_<entity>","ZSB_<entity>_V4"],
  objectTypes=["TABL","DDLS","BDEF","SRVD","SRVB","CLAS"])
```

The lookup groups exact matches by requested name and returns `missing`; do not build large `WHERE OBJ_NAME IN (...)` SQL lists for this check.

**After cleanup, verify the names are truly gone** — the default ADT info-system endpoint filters out TADIR rows that don't resolve to a workbench resource, so an orphan "ghost" (TADIR row left behind by an aborted create/delete) is invisible. Re-run the lookup with `source: "both"` to detect ghosts. This requires `sql` scope (admin must have `SAP_ALLOW_FREE_SQL=true`):

```
SAPSearch(searchType="tadir_lookup",
  names=["<table>","ZI_<entity>","ZC_<entity>","ZSB_<entity>_V4"],
  source: "both")
```

If the response contains a `splitBrain` array, the listed names exist in TADIR but ADT can't resolve them — clean up via SE03 / RS_DD_TADIR_CLEANUP before retrying create.

### 4-doma. Create Domains and Data Elements (if approved in Phase 2)

If the user opted for proper DDIC typing, create domains and data elements before the table entity:

```
SAPWrite(action="create", type="DOMA", name="Z<DOMAIN>", package="<package>", transport="<transport>",
  dataType="CHAR", length=1, fixedValues=[{low:"A", description:"Active"}, {low:"I", description:"Inactive"}])
```

```
SAPWrite(action="create", type="DTEL", name="Z<DATAELEMENT>", package="<package>", transport="<transport>",
  typeKind="domain", dataType="Z<DOMAIN>", labels={short:"Status", medium:"Object Status", long:"Object Status", heading:"Status"})
```

```
SAPActivate(objects=[{type:"DOMA", name:"Z<DOMAIN>"}, {type:"DTEL", name:"Z<DATAELEMENT>"}])
```

Then reference the data elements in the table entity DDL instead of inline types (e.g., `status : z<dataelement>` instead of `status : abap.char(1)`).

### 4a. Batch Creation (Preferred)

If the system supports it and the artifact stack is straightforward:

```
SAPWrite(action="batch_create", objects=[
  {type: "TABL", name: "<table>", description: "<desc>", source: "<ddl>"},
  {type: "DDLS", name: "ZI_<entity>", description: "<desc>", source: "<ddl>"},
  {type: "DCLS", name: "ZI_<entity>_DCL", description: "<desc>", source: "<dcl>"},
  {type: "DDLS", name: "ZC_<entity>", description: "<desc>", source: "<ddl>"},
  {type: "BDEF", name: "ZI_<entity>", description: "<desc>", source: "<bdef>"},
  {type: "BDEF", name: "ZC_<entity>", description: "<desc>", source: "<bdef>"},
  {type: "DDLX", name: "ZC_<entity>", description: "<desc>", source: "<ddlx>"},
  {type: "SRVD", name: "ZSD_<entity>", description: "<desc>", source: "<srvd>"},
  {type: "CLAS", name: "ZBP_I_<entity>", description: "<desc>", source: "<class>"},
  {type: "SRVB", name: "ZSB_<entity>_V4", description: "<desc>", serviceDefinition: "ZSD_<entity>", bindingType: "ODataV4-UI"}
], package="<package>", transport="<transport>")
```

Objects are created in array order — put dependencies first.

### 4b. Sequential Fallback

If batch creation fails or the stack is complex (compositions, multiple entities), create sequentially in **two passes**. This avoids BDEF↔behavior-pool deadlocks and reduces retries on on-prem 7.5x.

**Pass 1 — minimal working BO (CRUD + compositions):**

1. **Active tables only** → Create + Activate each. Defer draft tables.
2. **Child interface CDS view(s)** → Create + Activate.
3. **Root interface CDS view** with compositions (`composition [0..*]`) → Create + Activate.
4. **Empty behavior pool class** (no `METHODS ... FOR ...` declarations) → Create + Activate.
5. **Interface BDEF** with CRUD + composition create only. No actions, no determinations/validations, no strict/auth hardening yet.
6. **Projection CDS view(s)** with redirects → Create + Activate.
7. **Projection BDEF** (`projection;` header only, use-clauses only) → Create + Activate.
8. **Service definition + service binding** → Create + Activate + publish.

At this point the service is previewable and stable.

**Pass 2 — business logic + hardening:**

9. Add actions/determinations/validations to interface BDEF and activate.
10. Generate missing behavior handler signatures:
   - First preference: `SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="ZBP_I_<entity>", bdefName="ZI_<entity>")` to list missing signatures.
   - Then rerun with `autoApply=true` to inject declarations plus empty implementation stubs into class sections (`main`, `definitions`, `implementations`) when possible.
   - Next fallback: `SAPDiagnose(action="quickfix", ...)` + `SAPDiagnose(action="apply_quickfix", ...)` if proposals are available.
   - Fallback: ADT quick-fix in editor if no MCP quick-fix proposal is exposed.
11. Implement method bodies with `SAPWrite(action="edit_method", ...)` (avoid full-class rewrites when behavior pools are unstable).
12. Add `strict ( 2 )` and authorization handlers only after signatures and method bodies are active.
13. Add draft last. Prefer generated draft tables (ADT quick-fix) over hand-written draft table definitions.
14. Create/activate DCLS and DDLX after BO logic is green.

After pass 2 changes, batch activate interdependent objects:

```
SAPActivate(objects=[
  {type: "CLAS", name: "ZBP_I_<entity>"},
  {type: "BDEF", name: "ZI_<entity>"},
  {type: "BDEF", name: "ZC_<entity>"}
])
```

**Note:** Activation returns structured responses with detailed error/warning messages including line numbers and URIs. Errors block activation; warnings allow it but should be reviewed. Use this information to pinpoint exact issues rather than re-reading full source.

### 4c. Source Code Templates

Use the source code templates from the plan. Adapt them based on research findings:

- **BTP systems**: Use `abp_*` admin field types, ABAP Cloud syntax, `strict ( 2 )`
- **On-Prem systems**: Use `syuname`/`timestampl` types, classic or Cloud syntax depending on what existing code uses
- **Follow existing patterns**: If existing RAP projects use a specific annotation style or field naming pattern, match it exactly
- **Draft**: Include draft table, draft actions in interface BDEF, `use draft` in projection BDEF
- **Service exposure**: Ensure the service definition provider contract matches the planned binding type
- **ABAP formatting**: Run `SAPLint(action="format", source="<abap_source>", name="<class_name>")` on generated ABAP classes before writing them if you want SAP-native keyword case/indentation

### 4d. Post-Creation Validation

After all artifacts are created and activated:

1. **Syntax check** the behavior pool:
   ```
   SAPDiagnose(action="syntax", type="CLAS", name="ZBP_I_<entity>")
   ```

2. **ATC check** the full stack (if ATC is available):
   ```
   SAPDiagnose(action="atc", type="BDEF", name="ZI_<entity>")
   ```

3. **Verify no inactive objects remain** (may return 404 on some systems — skip if so):
   ```
   SAPRead(type="INACTIVE_OBJECTS")
   ```

4. **Read back** key artifacts to confirm they're correct:
   ```
   SAPRead(type="BDEF", name="ZI_<entity>")
   SAPRead(type="DDLS", name="ZI_<entity>")
   SAPRead(type="SRVD", name="ZSD_<entity>")
   ```

5. **Lint + formatter check** the behavior pool:
   ```
   SAPRead(type="CLAS", name="ZBP_I_<entity>")
   SAPLint(action="lint", source="<behavior_pool_source>", name="ZBP_I_<entity>")
   SAPLint(action="get_formatter_settings")
   ```

Fix any issues found. Re-activate if needed.

### 4e. Create and Publish Service Binding

Create the service binding:

```
SAPWrite(action="create", type="SRVB", name="ZSB_<entity>_V4", package="<package>", transport="<transport>",
  serviceDefinition="ZSD_<entity>", bindingType="ODataV4-UI", description="<Entity> OData V4 Service")
```

Activate the service binding:

```
SAPActivate(type="SRVB", name="ZSB_<entity>_V4")
```

Publish the service binding (makes the OData service available):

```
SAPActivate(action="publish_srvb", name="ZSB_<entity>_V4")
```

Verify the publish status and service URL:

```
SAPRead(type="SRVB", name="ZSB_<entity>_V4")
```

⚠️ **CHECKPOINT**: Verify the SRVB read shows `published: true`, the expected binding type, and a service URL. For OData V4 bindings, publish/unpublish applies to the whole binding, not per service version.

### 4f. Preview the Service

After the service binding is published, the RAP service can be previewed directly. In ADT, the user can open the service binding, select an entity (e.g., "Root"), and click "Preview..." to launch the Fiori Elements preview in a browser. This generates a preview URL via the ADT business services endpoint.

Inform the user:

> **Your service is live!** Open the service binding `ZSB_<ENTITY>_V4` in ADT, select the root entity, and click "Preview..." to see the auto-generated Fiori Elements List Report + Object Page.

---

## Phase 5: Verification & Summary

### 5a. Final Verification Checklist

```
RAP Service Generation Complete!

## Architecture
- Scenario: [managed/unmanaged]
- Draft: [enabled/disabled]
- Key strategy: [UUID/semantic/number range]
- OData version: [V4/V2]
- Followed conventions from: [existing code / SAP standard]

## Created Artifacts
  [x] Database table entity: <table_name>
  [x] Draft table entity: <draft_table> (if applicable)
  [x] Interface CDS view: ZI_<Entity>
  [x] Interface behavior definition: ZI_<Entity>
  [x] Projection CDS view: ZC_<Entity>
  [x] Projection behavior definition: ZC_<Entity>
  [x] Metadata extension: ZC_<Entity>
  [x] Service definition: ZSD_<Entity>
  [x] Behavior pool class: ZBP_I_<Entity>
  [x] Service binding: ZSB_<Entity>_V4
  [x] Service binding published

## Quality Checks
  [x] All artifacts activated successfully
  [x] Syntax check: clean
  [x] Lint check: clean
  [x] ATC check: [clean / N findings noted]

## Consistency with Existing Code
  [x] Naming matches existing convention: [pattern]
  [x] Annotation style matches: [pattern]
  [x] Admin fields match: [pattern]
```

### 5b. Next Steps

Offer follow-up actions based on the plan:

```
## Recommended Next Steps

1. **Preview the service** in Fiori Elements (ADT → Service Binding → select entity → Preview...)
2. **Add business logic** → use `generate-rap-logic` skill:
   - Determinations: [list from plan]
   - Validations: [list from plan]
3. **Add value helps** for reference fields
4. **Add custom actions** if needed (e.g., Approve, Release)
5. **Generate unit tests** → use `generate-abap-unit-test` skill
6. **Add compositions** for child entities (if multi-entity scenario planned for Phase 2)
7. **Register in FLP** (if FLP feature available) → use SAPManage:
  - `SAPManage(action="flp_create_catalog", catalogId="Z_<ENTITY>_C", title="<Entity> Catalog")`
  - `SAPManage(action="flp_create_tile", catalogId="Z_<ENTITY>_C", tile={id:"Z_<ENTITY>_T", title:"<Entity>", semanticObject:"<Entity>", semanticAction:"manage"})`
  - `SAPManage(action="flp_create_group", groupId="Z_<ENTITY>_G", title="<Entity>")`
  - `SAPManage(action="flp_add_tile_to_group", groupId="Z_<ENTITY>_G", catalogId="Z_<ENTITY>_C", tileId="Z_<ENTITY>_T")`
8. **Create DOMA/DTEL** (if not done in Phase 4) for proper reusable typing
9. **Release transport** (if transportable package) → use `SAPTransport(action="release_recursive", transport="<TR>")` to release tasks and parent in one step
10. **Attach generated documentation** (optional) → use `SAPWrite(action="create", type="SKTD", refObjectType="SRVD", name="<service_doc_name>", source="<architecture_summary_markdown>")`
11. **Review transport + revision context on later iterations** → use `SAPTransport(action="history", objectType="SRVD", objectName="ZSD_<ENTITY>")` and `SAPRead(type="VERSIONS", name="ZSD_<ENTITY>", objectType="SRVD")`
12. **If the package is repo-managed** → use `SAPGit` (`list_repos`, `objects`, `history`) before changing naming or branch conventions
```

---

## On-Prem 7.5x RAP Quick Reference (read before Phase 4)

This section covers common pitfalls that cause repeated save failures on on-prem ABAP 7.5x systems. Every rule here was learned from real failures — violating any one often returns `SBD_MESSAGES 007` save errors. ARC-1 surfaces more detail now, but these pitfalls remain the root causes.

### TABL (transparent table) — required annotations

Without ALL of these annotations, the table save **always fails** with 007:

```
@EndUserText.label : '<description>'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table <name> {
  key client    : abap.clnt not null;
  key <uuid_key> : sysuuid_x16 not null;
  ...
}
```

### TABL field types — use qualified names

| Correct | Wrong (causes 007 / activation failure) |
|---------|-----------------------------------------|
| `abap.int4` | `int4` |
| `abap.char(N)` | `char(N)` |
| `abap.numc(N)` | `numc(N)` |
| `abap.dec(N,M)` | `dec(N,M)` |
| `abap.clnt` | `clnt` |
| `sysuuid_x16` | `raw(16)` for UUID |
| `timestampl` | `abap.utclong` in TABL |
| `syuname` | `abap.uname` in TABL |
| `abap.cuky` | `cuky` |
| `abap.curr(N,M)` | `curr(N,M)` without reference annotation |
| `abap.char(1)` (X/space booleans) | `abap.boolean` in TABL |

### Client handling

- **TABL**: Include `key client : abap.clnt not null;` as the **first key field**
- **CDS view entity**: **OMIT** client from the select list entirely. SAP handles client filtering implicitly. Do NOT add `@ClientHandling` annotation — it is rejected on view entities.

### Composition and association rules

- **Composition**: NO `on` clause. Write `composition [0..*] of ChildView as _Child` — the framework resolves by key automatically. Adding `on` causes "On conditions are not allowed in compositions."
- **Association `on` conditions**: Use CamelCase **aliases** from the select list, NOT the DB column name. Write `$projection.ClubUuid = _Club.ClubUuid`, NOT `$projection.club_uuid`. Using the DB column name causes "The referenced select list name is obscured by an alias."
- **FK relationship**: Express via CDS composition/association in the view entity. Do NOT add `foreign key` clauses in the TABL definition — keep tables simple.

### Activation order for parent-child

Activate the **child view entity first**, then the root. The root's `composition` references the child, so the child must be active. Use batch activation with both: `SAPActivate(objects=[{type:"DDLS",name:"<child>"},{type:"DDLS",name:"<root>"}])` — the activation engine resolves the order.

### Lint and non-ABAP types

Pre-write lint runs by default for ABAP sources and DDLS. BDEF/SRVD/SRVB/DDLX/TABL/DOMA/DTEL still need activation or RAP preflight validation for most semantic checks. Keep RAP preflight enabled by default; only use `preflightBeforeWrite: false` for narrowly-scoped recovery when you understand the specific rule being bypassed. If lint blocks a known-valid case, use `lintBeforeWrite: false` for that specific write and keep the override local.

---

## Error Recovery

### If Research Finds No Existing RAP Projects

This is fine — the system may be new to RAP. Fall back to SAP standard naming conventions and best practices from documentation. Note this in the plan:

> "No existing RAP projects found on system. Using SAP standard naming conventions and current best practices from documentation."

### If System Doesn't Support Required Features

If research reveals the system lacks a feature the user needs (e.g., draft on old on-prem, table entities pre-7.55):

1. Inform the user of the limitation
2. Propose an alternative (e.g., classic DDIC table instead of table entity, without draft)
3. Adjust the plan accordingly

### If Batch Creation Fails

Fall back to sequential creation (Phase 4b). Report which objects succeeded and which failed. Fix the failing object and retry.

### Common Issues

| Error | Cause | Fix |
|---|---|---|
| 415 Unsupported Media Type on DDLS/BDEF | RAP/CDS endpoint not responding as expected | Check `SAPManage(action="probe")` for system info. Verify ICF service activation. Try creating the object in ADT to confirm system capability. |
| `Resource X does already exist` on create | Prior stub or name collision | Switch immediately to `SAPWrite(action="update", ...)` and resend the full source. Do not retry `create` with the same payload. |
| Feature not supported | System version too old | Adapt plan to available features |
| Activation error | Dependency order wrong | Use batch activation or sequential in dependency order |
| Lint blocks write | Code doesn't match lint rules | Adjust generated code to pass lint, or check if lint config is too strict |
| BDEF syntax error | Wrong field aliases or entity references | Cross-check CDS aliases with BDEF field references |
| Transport required | Non-$TMP package without transport | Use `SAPTransport(action="check")` to find or create a transport — see Phase 1-pre |
| Lock conflict on create | Object locked by another user/transport | Wait or use a different name; check `SAPTransport(action="list")` for conflicting transports |
| `Annotation with reference to currency code for field X is missing` | `abap.curr` field has no currency reference | Add `@Semantics.amount.currencyCode` directly above each amount field; pair with `abap.cuky` field. |
| `"global or instance" was expected, not "none"` | Invalid BDEF auth enum on 7.5x | Use `( global )` or `( instance )`, or defer auth until handler exists. |
| `dependent entity cannot have the identically named field ... as the etag master entity` | Root and child etag names collide | Use different etag field names for root vs dependent entities. |
| `"draft or side" was expected, not "etag"` in projection BDEF | `use etag` header is invalid on 7.5x | Keep projection header as `projection;` only. |
| `not a suitable draft persistency ... there is no "X" field` | Hand-written draft table column naming mismatch | Generate draft table via quick-fix (preferred), or follow CDS-name derivation exactly. |
| `Annotation 'UI.headerInfo.X' used at wrong position` in DDLX | Unsupported annotation scope in DDLX on 7.5x | Move `@UI.headerInfo`, `@Search.searchable`, `@ObjectModel.*` to projection DDLS source. |
| `Multiple entries with same name 'X' not allowed` in DDLX | Duplicate annotation blocks on same field | Consolidate field annotations into one block. |
| `[?/011]` while updating behavior pool class | Full-class behavior-pool write path unstable for `METHODS ... FOR ...` | Use `SAPWrite(action="scaffold_rap_handlers", ...)` first (optionally `autoApply=true`), then quick-fix fallback, then patch bodies with `SAPWrite(action="edit_method", ...)`. |

---

## Notes

### Philosophy

This skill prioritizes **correctness and consistency** over speed. The extra research time (5-10 minutes) pays off by:
- Avoiding naming conflicts with existing code
- Following established team conventions automatically
- Catching system limitations before hitting errors
- Producing code that looks like it belongs in the codebase
- Giving the user confidence in the architecture before committing

### What This Skill Does NOT Do (yet)

- **Very large multi-BO landscapes** in a single run — keep one business capability per execution
- **Unmanaged save** implementation (plan it, implement the managed wrapper, note the save handler as a follow-up)
- **Custom CDS functions/actions** (plan them, implement standard CRUD, add as follow-up)
- **Fiori app generation** (generates the OData service; Fiori Elements app is auto-generated from annotations)

### Relationship to Other Skills

| Skill | Relationship |
|---|---|
| `generate-rap-service` | Vibe code version — faster, less thorough, good for prototypes |
| `generate-rap-logic` | Natural follow-up — implement determinations/validations identified in the plan |
| `generate-abap-unit-test` | Follow-up — generate tests for the behavior pool |
| `explain-abap-code` | Can be used during research to understand existing RAP projects found on the system |
| `implement-feature` | For implementing non-RAP features in the arc-1 codebase itself |

---

## Reference: SAP Official Naming Conventions for RAP Artifacts

Source: [SAP Help — Naming Conventions for Development Objects](https://help.sap.com/docs/ABAP_Cloud/f055b8bf582d4f34b91da667bc1fcce6/8b8f9d8f3cb948b2841d6045a255e503.html)

### General Rule

```
[/<namespace>/][<prefix>]_<object_name>_[<suffix>]
```

- Use your own namespace reserved for your organization (Z* or Y* for customer objects)
- The `/DMO/` namespace is reserved for SAP demo purposes only — never use it in productive development
- Prefixes convey semantic differences between types of the same object kind
- Suffixes add secondary differentiation (e.g., OData version, development guide variant)

### ABAP Dictionary Objects

| Object | Convention | Example (customer namespace) |
|--------|-----------|------------------------------|
| **Active persistence table** | `A_` prefix | `ZA_TRAVEL` |
| **Draft table** | `D_` prefix | `ZD_TRAVEL` |

### CDS Objects

| Object | Convention | Notes | Example |
|--------|-----------|-------|---------|
| **Base/Root CDS view entity** | `R_` prefix | The base BO entity. Use `TP` suffix to indicate transactional processing relevance | `ZR_TravelTP` |
| **Interface CDS view** | `I_` prefix | Reusable interface view layer (alternative to R_ in some patterns) | `ZI_Travel` |
| **Projection CDS view** | `C_` prefix | `C` = consumption layer. If multiple projections exist, the name should represent the projection role | `ZC_Travel` |
| **Extension include view** | `E_` prefix | For extensibility | `ZE_Travel` |
| **Behavior definition** | Same name as root entity | BDEF always shares the name of the CDS view it belongs to | `ZR_TravelTP` (interface), `ZC_Travel` (projection) |
| **Metadata extension** | Same name as CDS entity | If multiple extensions for one entity, add numbered suffix | `ZC_Travel`, `ZC_Travel_2` |

### Business Services

| Object | Convention | Notes | Example |
|--------|-----------|-------|---------|
| **Service definition** | No mandatory prefix | If not reused across UI/API, may use `UI_` or `API_` prefix | `ZUI_Travel` or `Z_Travel` |
| **Service binding (UI)** | `UI_` prefix | For Fiori Elements / UI consumption | `ZUI_Travel_O4` |
| **Service binding (Web API)** | `API_` prefix | For programmatic / integration consumption | `ZAPI_Travel_O4` |
| **OData V2 suffix** | `_O2` | | `ZUI_Travel_O2` |
| **OData V4 suffix** | `_O4` | | `ZUI_Travel_O4` |

### Source Code Objects

| Object | Convention | Notes | Example |
|--------|-----------|-------|---------|
| **Behavior pool class** | `BP_` prefix | Global class implementing BO behavior | `ZBP_R_TravelTP` |
| **Local handler class** | `LHC_` prefix | Local class within behavior pool | `LHC_Travel_Create` |
| **Local saver class** | `LSC_` prefix | Local class within behavior pool | `LSC_Travel` |

### Complete Example: "Travel" Entity (V4, UI, Draft, Managed)

| # | Object Type | SAP Naming | Name |
|---|-------------|-----------|------|
| 1 | Database table (active) | `A_` prefix | `ZA_TRAVEL` |
| 2 | Database table (draft) | `D_` prefix | `ZD_TRAVEL` |
| 3 | Base CDS view entity | `R_` prefix + `TP` suffix | `ZR_TravelTP` |
| 4 | Projection CDS view | `C_` prefix | `ZC_Travel` |
| 5 | Interface BDEF | = root entity name | `ZR_TravelTP` |
| 6 | Projection BDEF | = projection view name | `ZC_Travel` |
| 7 | Metadata extension | = projection view name | `ZC_Travel` |
| 8 | Service definition | `UI_` prefix (optional) | `ZUI_Travel` |
| 9 | Service binding | `UI_` prefix + `_O4` suffix | `ZUI_Travel_O4` |
| 10 | Behavior pool class | `BP_` prefix | `ZBP_R_TravelTP` |

### Notes on R_ vs I_ Prefix

- **`R_`** (base/root view entity): Used in the SAP standard RAP development guides (managed, unmanaged, draft). This is the **current SAP recommendation** for new RAP development.
- **`I_`** (interface view): Historically used and still common. Represents a reusable interface layer. Many existing tutorials and older projects use `I_` instead of `R_`.
- Both are valid. Default to `R_` for new projects following SAP's latest guides. If existing code on the system uses `I_`, match that for consistency.

### Notes on Table Naming

- SAP uses `A_` and `D_` prefixes for active and draft tables respectively
- Some older tutorials and community patterns use `_D` suffix for the table and `_DD` for draft — this is **not** the official SAP convention but is widely seen in practice
- The SAP "OData UI Service from Scratch" wizard generates tables with these prefixes automatically
