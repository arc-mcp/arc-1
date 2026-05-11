# Convert legacy UI5 JS app ➜ Fiori Elements V4 (annotation-first)

Generate a Fiori Elements V4 list-report + object-page app driven by `@UI.*` annotations on
the RAP CDS projection. Backend annotations are derived from the **legacy** UI5 app's actual
features (columns, search, sort, formatters, action buttons, tab structure) so the FE app
reproduces the user-visible contract. Custom behavior FE templates can't express is wired via
the extension API.

This skill is **one of two parallel UI paths** after the RAP backend lands. Pick this one if
the target architecture is **Fiori Elements V4** (annotation-driven; minimal custom code). Pick
`modernize-ui5-app.md` instead if the target is **freestyle TypeScript** (custom controllers,
manual binding). Both start from the same legacy JS app + the same V4 RAP service.

```
                  migrate-segw-to-rap.md  (backend: SEGW V2 → RAP V4)
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
    modernize-ui5-app.md      convert-ui5-to-fiori-elements.md
        (freestyle TS)               (Fiori Elements V4)
```

This skill depends on:

- `migrate-segw-to-rap.md` having produced an active V4 RAP service (CDS roots + projections,
  BDEF, SRVD, SRVB published, V4 routing group registered in `/n/IWFND/MAINT_SERVICE`).
- The legacy app (`<source_app>/`) still being readable — Phase 1 mines its features even
  though the legacy app itself is not modified.

> **Independent of `modernize-ui5-app.md`.** This skill does not require the modern TS app to
> exist. The legacy app is the single source of truth for user-visible features; the FE app
> reproduces them through annotations + extensions directly.

> **Domain example.** Annotation templates use an illustrative `Project → Tasks → TimeEntries`
> domain. Substitute the user's entities throughout — the LLM rewrites every projection /
> entity / field identifier to match the V4 service.

> **Canonical annotation reference.** This skill points at the **ABAP RAP Fiori Feature
> Showcase** (`SAP-samples/abap-platform-fiori-feature-showcase`) as the authoritative source
> for `@UI.*` / `@ObjectModel.*` / `@Common.*` annotation patterns. When uncertain about how
> to express a legacy UI feature as an annotation, search the showcase via
> `mcp__sap-docs__search` with the feature's *Search Term* (e.g. `#OPHeaderAction`,
> `#LineItemHighlight`, `#HeaderInfo`, `#ActionInLineItem`). The showcase is the
> ground-truth catalog every annotation in this skill maps back to.

---

## Using `mcp__sap-docs__search` for annotation discovery (read this first)

This skill names a handful of canonical annotation patterns inline. **Treat them as
starting points, not the whole catalog.** Anything not explicitly covered — alternate
visual representations, dynamic feature control, charts, value helps, semantic keys,
multi-level OP routing, draft-specific UI behavior, or 7.58-specific syntax issues —
**look up in `mcp__sap-docs__search` before guessing**. The MCP indexes the
authoritative SAP-maintained references, has up-to-date showcase tags, and includes
release-specific documentation (758 news, cloud differences, etc.) that this skill text
can't keep current with on its own.

### Canonical libraries to know

| Library ID | What's in it |
|---|---|
| `/abap-fiori-showcase` | **SAP-samples/abap-platform-fiori-feature-showcase** — the on-prem RAP + FE V4 catalog. Every pattern is tagged with a Search Term like `#HeaderInfo`, `#LineItemHighlight`, `#OPHeaderAction`, `#OPTable`, `#DataFieldForAction`, `#SemanticKey`. The 7.58-accurate baseline for this skill. |
| `/cap-fiori-showcase` | **SAP-samples/fiori-elements-feature-showcase** — CAP/CDS V4 counterpart. Same conceptual patterns from the CAP side; useful when the ABAP showcase tag doesn't include the variant you need, especially for FE manifest layout (`layouts_ChildEntities*.cds`, `#Subpages`, `#InboundNav`). |
| `/abap-docs-standard` | Official ABAP keyword docs (on-prem). Definitive for syntax (`FOR BEHAVIOR OF`, virtual elements, projection BDEF rules), release-specific capabilities (`ABENNEWS-758-RESTFUL` for what's available on 7.58), and the deep theory behind any RAP construct. |
| `/abap-docs-cloud` | Same as above for cloud/BTP. Useful when something looks cloud-only — verify before pulling into on-prem 7.58. |
| `/sap-help` (online) | SAP Help full content. Best for SAPUI5 manifest configuration, FE template runtime details, *Configuring Internal Navigation*. Requires `includeOnline=true`. |
| `/abap-cheat-sheets` | Practical RAP / ABAP snippets with current syntax variants. |

### Search recipe — apply for every annotation question

1. **Identify what the user sees**: "status as a colored chip", "click row → child detail page", "filter with fixed values".
2. **Search the showcase by hashtag** — most patterns are tagged literally in markdown:
   ```
   mcp__sap-docs__search(query="#TagName")           // exact tag lookup
   mcp__sap-docs__search(query="<visual description>")  // semantic fallback
   ```
3. **Fetch the full pattern** of the most relevant hit:
   ```
   mcp__sap-docs__fetch(id="/abap-fiori-showcase/<section>#<tag>")
   ```
4. **Adapt to the user's entities** — the showcase uses `/DMO/FSA_R_RootTP` etc.; substitute the user's projection names.
5. **If the on-prem pattern is rejected on the target release**, search again on a different axis:
   - `/abap-docs-standard/ABENCDS_PROJ_VIEW_VIRTUAL_ELEMENT` (+ example `ABENCDS_PROJ_VIEW_VIRTEL_ABEXA`) for virtual elements with ABAP-class calculation
   - `/abap-docs-standard/ABENNEWS-<release>-RESTFUL` for release-bound capabilities (e.g. `ABENNEWS-758-RESTFUL`)
   - `/cap-fiori-showcase` for an alternate CAP phrasing of the same concept
   - DDLX `annotate view` as a fallback when entity-level annotations are rejected on the DDLS projection (Run 7 evidence: 7.58 routes `@UI.facet`, `@UI.selectionFields`, and header `FOR_ACTION` through DDLX)

### Starter tag pointers (non-exhaustive — search for more)

Search-Term references that resolve to a concrete annotation pattern in the showcase. Each is the *entry point*; fetch the full content to get the canonical syntax for your release.

| Need | Starting search terms / docs |
|---|---|
| Colored status / criticality on a list row | `#LineItemHighlight`, `criticality: 'CriticalityCode'`, `@UI.Criticality` |
| Criticality with calculation logic (not a real column) | `/abap-docs-standard/ABENCDS_PROJ_VIEW_VIRTUAL_ELEMENT`; example `ABENCDS_PROJ_VIEW_VIRTEL_ABEXA`. Also `@ObjectModel.virtualElementCalculatedBy: 'ABAP:<class>'` |
| Header data point / status indicator | `#HeaderFacet`, `#KeyValue`, `#DataPointProgress`, `@UI.dataPoint` |
| Object Page table for a child entity | `#OPTable`, `@UI.lineItem` on the child projection, `@UI.facet` with `type: #LINEITEM_REFERENCE`, `targetElement: '_AssocName'` |
| Drill from one OP to another OP (e.g. Project → Task → TimeEntry) | `#OPTable` (entry); `cap-fiori-showcase/app/listreport-objectpage/layouts_ChildEntities1.cds` etc. (sub-page layout); SAPUI5 *"Configuring Internal Navigation"* (sap-help) for the manifest routing shape |
| In-page navigation between facets | `#InboundNav`, `targetSections`, `navigation` property on `@UI.facet` |
| Action button — OP header | `#OPHeaderAction`, `type: #FOR_ACTION`, `DataFieldForAction` |
| Action button — LR table toolbar | `#ActionInLineItem`, `#WithAction` |
| Sorting + filter bar | `#SelectionFields`, `#PresentationVariant`, `@UI.selectionFields` |
| Search across fields | `#Search`, `@Search.searchable`, `@Search.defaultSearchElement` |
| Semantic key (highlighted/bold in tables) | `#SemanticKey`, `@ObjectModel.semanticKey` |
| Value help / fixed value list | `#ValueHelp`, `@Consumption.valueHelpDefault`, `@ObjectModel.text.element` |
| Dynamic CRUD (hide/show edit/delete by row state) | `#DynamicCRUD`, `@UI.updateHidden`, `@UI.deleteHidden`, BDEF `features: instance` |
| Draft + UI specifics | `#DraftHandling`, `@UI.lineItem` editable qualifier, action keyword `( precheck )` |
| Side effects / re-read on action | `#SideEffects`, `@Common.SideEffects` |
| BDEF action signature variants (precheck, factory, copy) | `/abap-docs-standard/ABENBDL_ACTION`, `#OPCopyAction`, `action ( precheck ) <name>` |
| 7.58 capability boundaries | `/abap-docs-standard/ABENNEWS-758-RESTFUL` + `ABENNEWS-758-CDS_BDL` |

### Anti-patterns

- **Don't take this skill's example code as gospel.** It's a teaching example written at a
  point in time. The showcase is the ground truth.
- **Don't paste a showcase example from a different release without verifying.** A
  `#DataFieldForAction` example branching off the BTP-Cloud branch may use cloud-only
  keywords; the on-prem `main` branch is the safe baseline for 7.58.
- **Don't hand-code FE routing/manifest entries without consulting the SAPUI5 internal
  navigation docs.** The shape varies by template + release and is easier to derive from
  `sap-help` than to reverse-engineer from a runtime failure.
- **Don't accept the first failed-activation symptom as the final answer.** Run 7 hit four
  different blockers in four different layers for one polish item; in every case a follow-up
  search via `mcp__sap-docs__search` would have surfaced an alternative *before* the
  rollback. The cost of one extra search is 5 seconds; the cost of an unnecessary rollback
  is 10+ minutes.

## Why this is its own skill

Fiori Elements isn't a code transformation — it's a **deletion + relocation**. Most of the
freestyle app is replaced by FE templates that interpret CDS annotations. The skill's three
real jobs:

1. **Derive** the right `@UI.*` annotations from the legacy app's user-visible features so the
   FE renders an equivalent UX.
2. **Apply** those annotations to the RAP CDS projection (the service the SRVB exposes).
3. **Generate** the FE list-report + object-page project via the **SAP Fiori MCP server**
   (`@sap-ux/fiori-mcp-server`), and wire **extensions** for anything FE templates can't express.

## Smart defaults (apply silently — do NOT ask before research)

| Setting | Default | Rationale |
|---|---|---|
| Legacy app | `<source_app>/` | The freestyle JS app — read-only; mined in Phase 1 for the feature inventory. Authoritative source of every user-visible behavior the FE app must reproduce. |
| Target FE app | `<fe_app>/` — default name `modern-fe-app/` if user gives no path (mirrors the workspace pattern `legacy-ui5-app/` → `modern-ui5-app/` → `modern-fe-app/`) | Fiori MCP generates here; folder must exist and be empty (or empty subfolders) |
| FE floorplan | List Report + Object Page (LROP V4) when the BO has a clear root + child facets | Maps cleanly to the typical RAP composition root + children. OVP only if the user explicitly asks. |
| Template | `lropv4` | Default unless the user asks otherwise |
| Generator | **SAP Fiori MCP server (`@sap-ux/fiori-mcp-server`)** via the `list_functionalities` → `get_functionality_details` → `execute_functionality` sequence | First-party SAP tool; understands FE V4 patterns natively |
| App namespace | `<source_namespace>.fe` | Keeps the legacy and FE apps distinguishable (and the modern TS app too, if `modernize-ui5-app` was also run as the alternate path) |
| UI5 version | Latest 1.x release (e.g. `1.147.2`) unless user specifies | LTS-track; latest FE V4 features available |
| Language | TypeScript | Modern default; extension files use type-safe APIs |
| OData V4 service URL | **Prefer the SRVD-direct path** on the system's HTTPS port: `https://<host>:<https-port>/sap/opu/odata4/sap/<srvb>/srvd/sap/<srvb>/0001` (e.g. `https://a4h.marianzeis.de:50001/sap/opu/odata4/sap/zui_dm_projects_o4/srvd/sap/zui_dm_projects_o4/0001`). Falls back to the Gateway hub path `http://<host>:<http-port>/sap/opu/odata4/sap/<srvb>/srvd_a2x/sap/<service>/0001` only when SRVD-direct isn't reachable. | Run 5 + Run 6 verified the SRVD-direct path works without `/n/IWFND/MAINT_SERVICE` registration on 7.5x systems. The hub path requires the routing-group manual step. |
| Main entity | Root entity alias exposed by the SRVB (e.g. the alias on `define root view entity ... alias <X>`) | The LR+OP floorplan is rooted at a single entity |
| Annotations location | **In CDS via `SAPWrite update DDLS`** — not in a local annotation file inside the FE app | The annotations belong to the service; FE app reads them through `$metadata`. Local annotation files are an antipattern for RAP-bound apps. |
| Extension language | TypeScript (controller extensions) | Match the rest of the chain |
| Validation | `mcp__SAPUI5_MCP_Server__run_ui5_linter` + `run_manifest_validation` + `tsc --noEmit` all green | The hard acceptance criteria |
| Acceptance | FE app runs end-to-end against the V4 service. Browser smoke covers every feature inventoried in Phase 1 — reproduced through annotations or extension hooks. | Concrete deliverable |

## Input

The user provides:

- **Path** to the legacy app for feature mining (default: `<source_app>/`). Read-only.
- **Path / name** for the FE app (default: `<fe_app>/`).
- **OData V4 service URL** — derived from `migrate-segw-to-rap`'s SRVB output. Required.
- **Root entity alias** (e.g. `Project`). Default: infer from the SRVB's `$metadata`.
- **App namespace** (default: `<source_namespace>.fe`).
- **Transport** for the CDS annotation writes (default: same transport used by
  `migrate-segw-to-rap`, or auto-create via `SAPTransport(action="create")`).
- **UI5 version** (default: latest 1.x).

If only the legacy app path and V4 URL are provided, apply smart defaults and surface the plan
in Phase 3 for user `ok` before any writes.

---

## Phase 0 — Preflight

### 0a. RAP V4 service is live and bindable

```text
SAPManage(action="probe")
```

Assert `rap.available == true`.

```text
SAPRead(type="SRVB", name="<V4_SRVB>")
```

Assert the SRVB exists and is active. If not, stop with *"V4 service binding `<V4_SRVB>` is
missing or inactive — run `migrate-segw-to-rap.md` first."*

```text
Bash: curl -s -o /tmp/svc_metadata.xml -w "%{http_code}\n" "<V4_service_URL>/\$metadata?sap-client=<client>"
```

Assert 200 OK. **Try the SRVD-direct path first** (HTTPS port + `/srvd/sap/<srvb>/0001/`).

If 403 with `IWBEP/CM_V4_COS/136`, the URL is using the Gateway hub path and the routing
group isn't registered. **Switch to the SRVD-direct URL pattern before stopping** — the
direct path bypasses the hub registration. Only fall back to *"register service group via
`/n/IWFND/MAINT_SERVICE`"* if BOTH URL patterns fail.

If 503 with `IWBEP/CM_V4_RUNTIME/000` ("service alias cache outdated"), retry once — this is
a transient Gateway cache issue. If it persists across retries, treat as 403 and switch URL
patterns.

### 0b. CDS projection is readable + writable

```text
SAPRead(type="DDLS", name="<root_projection>")
```

Assert active version returns. If not, stop with *"Root projection is missing — re-run
`migrate-segw-to-rap.md` Phase 6 Step 3."*

### 0c. Legacy app exists and is readable

```text
Bash: ls <source_app>/webapp/controller/ <source_app>/webapp/view/
```

Assert both folders are populated. Stop with explicit reason if either is missing — the
legacy app is the single source of truth for both the annotation plan (Phase 1+2) and the
extension list (Phase 2b).

### 0d. SAP Fiori MCP server reachable

```text
mcp__fiori-mcp__list_functionalities
```

If this call fails, the Fiori MCP server isn't configured in this chat. Surface the
configuration block and stop:

```jsonc
// .cursor/mcp.json (or equivalent)
{
  "mcpServers": {
    "fiori-mcp": {
      "type": "stdio",
      "timeout": 600,
      "command": "npx",
      "args": ["--yes", "@sap-ux/fiori-mcp-server@latest", "fiori-mcp"]
    }
  }
}
```

(Source: [@sap-ux/fiori-mcp-server README on
github.com/SAP/open-ux-tools](https://github.com/SAP/open-ux-tools/tree/main/packages/fiori-mcp-server).)

Optional companion: `mcp__SAPUI5_MCP_Server__*` for post-generation lint + manifest validation.

### 0e. Connection Manager (optional)

For scenarios that use a saved BTP / on-prem system connection rather than a direct service
URL, the Fiori MCP server depends on the **Connection Manager for SAP Systems** VS Code
extension. For the direct-URL flow this skill uses, the extension is **not** required — the
service URL is passed straight through to `execute_functionality`.

---

## Phase 1 — Inventory the legacy app's user-visible features

This is the heart of the annotation plan. The FE app must reproduce every user-visible
behavior of the legacy app. Read **every** relevant legacy file and produce a feature
inventory.

### 1a. Read the legacy manifest

```text
Read: <source_app>/webapp/manifest.json
```

Pull: `sap.ui5.routing.routes` (what URLs the user can reach), `sap.ui5.rootView`,
`sap.app.dataSources`, `i18n`. The routes tell you the navigation tree; the data sources tell
you what service shape the legacy app expects.

### 1b. Read every legacy view

```text
Bash: ls <source_app>/webapp/view/
Read: <source_app>/webapp/view/<each>.view.xml
```

For each view, inventory:

- **Page title** (from `<Page title=...>`).
- **Header content** — buttons, with their conditions (e.g. `enabled="{= ${Status} === 'D'}"`).
- **List/table columns** — every `<Column>` with its bound field, sort direction, alignment.
- **Search fields** — `<SearchField>` with `liveChange` + `placeholder`.
- **Sort defaults** — `sorter` clause on list bindings (path + ascending/descending).
- **Item structure** — `ObjectListItem`/`ColumnListItem`/`ObjectHeader` with their attributes,
  status fields, formatter calls.
- **Tab structure** — `IconTabBar` + `IconTabFilter` entries (which entities are tabbed,
  whether each tab has a counter).
- **Navigation handlers** — `press`/`selectionChange` callbacks (rows clickable → navigation).
- **Counters, footers** — informational widgets (item counts, totals).

### 1c. Read every legacy controller

```text
Bash: ls <source_app>/webapp/controller/
Read: <source_app>/webapp/controller/<each>.controller.js
```

For each controller, inventory:

- **Action handlers** — what does each `on<Action>` method do? (Call OData function import?
  Filter? Re-bind? Show MessageBox?)
- **Filtering / search logic** — what fields, what `FilterOperator`, what bind path?
- **Function-import calls** — `oModel.callFunction(...)` calls and their parameter shapes.
- **Custom validation** — pre-call checks before function imports / submits.
- **Custom navigation** — anything that bypasses the manifest router.
- **Custom client-side state** — JSONModels created for UI-only state (e.g. tab counters fed
  from non-OData sources).

### 1d. Read every legacy formatter

```text
Read: <source_app>/webapp/model/formatter.js
```

For each formatter function, inventory:

- **What it formats** — status code → text, status code → semantic state (Success/Warning/Error),
  date → short format, hours → decimal, etc.
- **The code→text mapping** — capture the exact values (e.g. `D → "Draft"`, `A → "Active"`,
  `C → "Closed"`).

These map directly to CDS annotation patterns — `@Common.Text` + `@UI.TextArrangement`,
`@UI.Criticality`, value-help collections, etc.

### 1e. Build the feature inventory

Print the structured inventory to the user:

```text
Feature inventory — <source_app>:

ROOT ENTITY (Project):
  Display name (header):    Title
  Description (sub):        ProjectId
  Status (criticality):     Status field — values D=Draft (Warning) / A=Active (Success) / C=Closed (Neutral)
  Sort default:             StartDate descending
  Search (master):          ProjectId, Title (Contains, OR-joined)
  Audit fields:             Erdat (Created), Ernam (Created by), Aedat (Changed), Aenam (Changed by)
  Header button:            Approve — enabled when Status == 'D', calls /ApproveProject(ProjectId)
  Count footer:             "<n> projects" displayed below the list

CHILD ENTITY (Task):
  Tab in detail:            "Tasks"
  Counter:                  from binding length
  Columns:                  TaskId, Title+Description, Status, Priority, DueDate, AssignedTo, EstimatedHours
  Status criticality:       Status: D/IP/D/C (Draft/InProgress/Done/Cancelled) — see formatter
  Priority criticality:     L/M/H (Low/Medium/High) — see formatter
  Click behavior:           Selecting a task populates the TimeEntries tab

CHILD-OF-CHILD ENTITY (TimeEntry):
  Tab in detail:            "Time Entries"
  Counter:                  from selected task's TimeEntries length
  Columns:                  EntryId, TaskId, WorkDate, WorkHours, Description, Username

FORMATTERS:
  statusText:       D → "Draft", A → "Active", C → "Closed"
  statusState:      D → Warning, A → Success, C → Neutral
  taskStatusText:   D → "Draft", IP → "In Progress", DN → "Done", CN → "Cancelled"
  taskStatusState:  same scheme
  priorityText:     L → "Low", M → "Medium", H → "High"
  priorityState:    L → Neutral, M → Warning, H → Error
  dateShort:        custom YYYY-MM-DD
  hoursDecimal:     two decimal places

FUNCTION IMPORT (V2):
  ApproveProject(ProjectId) → translates to RAP action approve_project (already in BDEF)
```

This inventory is the contract for Phase 2.

---

## Phase 2 — Map features to annotations + extensions

Classify each inventory item as one of:

- **STANDARD** — FE templates render this natively (pagination, row click navigation,
  search-by-key, basic edit, basic create, basic delete, draft support).
- **ANNOTATION** — needs a specific `@UI.*` / `@Common.*` / `@ObjectModel.*` annotation on
  the CDS projection. Most legacy features land here.
- **EXTENSION** — genuinely custom behavior FE templates can't express; needs a controller
  extension on the FE app side.

### 2a. Annotation map — starting points (verify each pattern via sap-docs)

The table below is a **quick reference**, not a definitive catalog. Apply the search
recipe from the "Using `mcp__sap-docs__search`" section above to confirm the current
canonical syntax for your release, especially for anything tagged ⚠ below.

| Legacy feature | Starting annotation + showcase tag |
|---|---|
| Header title = `Title` | `@UI.HeaderInfo.title.value: 'Title'` — `#HeaderInfo` |
| Header description = `ProjectId` | `@UI.HeaderInfo.description.value: 'ProjectId'` — `#HeaderInfo` |
| Header type label | `@UI.HeaderInfo.typeName: 'Project'`, `typeNamePlural: 'Projects'` — `#HeaderInfo` |
| List columns (master) | `@UI.lineItem: [{ position: N, importance: #HIGH }]` per field — `#LineItemHighlight` for the variant with criticality |
| ⚠ Status code → text + color | **Multiple valid patterns; choose by release/draft constraints.** Search `#LineItemHighlight` for the criticality-via-real-column path. For a calculated criticality without a persistent column, see `/abap-docs-standard/ABENCDS_PROJ_VIEW_VIRTUAL_ELEMENT` + `@ObjectModel.virtualElementCalculatedBy: 'ABAP:<class>'`. On 7.58 + draft, both have known constraints (Run 7 §1 details). Search before adopting. |
| Sort default | `@UI.presentationVariant.sortOrder: [{ by: '<field>', direction: #DESC }]` — `#PresentationVariant` |
| Search across fields | `@Search.searchable: true` at view level + `@Search.defaultSearchElement: true` per field — `#Search` |
| Filter bar | `@UI.selectionFields: [...]` — `#SelectionFields` |
| Audit fields display | `@UI.fieldGroup` + `@UI.facet` of `#FIELDGROUP_REFERENCE` — `#HeaderFieldGroup` |
| Approve button (header) | `@UI.identification: [{ type: #FOR_ACTION, dataAction: 'approve_project', label: 'Approve', criticality: 3, criticalityRepresentation: #WITH_ICON }]` — `#OPHeaderAction`. **The action does NOT auto-render from the BDEF.** Projection BDEF must already expose `use action approve_project;`. |
| LR toolbar action | Same shape on `@UI.lineItem` — `#ActionInLineItem`, `#WithAction` |
| OP table for child entity | `@UI.facet: [{ type: #LINEITEM_REFERENCE, targetElement: '_AssocName', label: '...' }]` on the parent + `@UI.lineItem` on the child projection — `#OPTable` |
| ⚠ Multi-level navigation (Project → Task → TimeEntry) | Two valid shapes — **research before picking**. (a) **Nested LineItem facet** referencing `_Tasks._TimeEntries` from the root projection (release-dependent FE support). (b) **Separate Task OP route** — annotate `ZC_DM_TASK` with `@UI.headerInfo` + its own `_TimeEntries` facet, then add a Task routing target to the FE app's manifest. Search `#OPTable`, `#Subpages`, `#InboundNav` (cap-fiori-showcase); plus SAPUI5 *"Configuring Internal Navigation"* (sap-help) for manifest routing shape. |
| Semantic key bolding | `@ObjectModel.semanticKey: ['ProjectId']` — `#SemanticKey` |
| Dynamic CRUD (hide buttons by row state) | `@UI.updateHidden` + `@UI.deleteHidden` bound to a field — `#DynamicCRUD` |

> **DDLS-vs-DDLX scope on 7.58.** Several entity-level annotations
> (`@UI.facet`, `@UI.selectionFields`, header `FOR_ACTION` via `@UI.identification`) were
> rejected on the projection DDLS in Run 7 but succeeded when moved to a DDLX
> *metadata extension* (`annotate view <ZC_*> with @UI.facet: [...]` etc.). If a DDLS
> entity-level annotation errors with "wrong scope" / "unknown", route it through DDLX.
> Confirm with the relevant `#Tag` in `/abap-fiori-showcase` — the showcase patterns are
> already split between DDLS and DDLX where the on-prem release requires it.

### 2b. Extension map (typical)

| Legacy feature | Extension hook |
|---|---|
| Status === 'D' guard on Approve | FE's BDEF action button is enabled per the BDEF's `precheck`. If the legacy app's enable rule differs from the BDEF, **add the precheck on the BDEF** (Step 2c) rather than overriding in JS. |
| Custom validation before Approve (e.g. require Description) | `editFlow.onBeforeAction` controller extension on the ObjectPage |
| Custom client-side count footer phrasing | Skipped — FE list-report shows native count |
| Custom navigation patterns | Almost never needed; FE's row → OP nav is default |
| MessageBox on approve failure | Native FE error toast already handles this |

### 2c. BDEF-side preparation (run AFTER 2b, BEFORE Phase 4)

If the inventory surfaced a guard like "Approve button only when Status === 'D'", that's a
**precondition**, not a UI concern. Encode it on the BDEF side via the action's `precheck`
clause, then re-activate. (This step belongs in `migrate-segw-to-rap.md` Step 5 but call it
out explicitly here when the legacy guard wasn't already lifted.) Example:

```abap
action approve_project precheck result [1] $self;
```

with a `precheck` method in the behavior pool that fills `%cid` / `%key` and asserts
`Status == 'D'`. Skill defers the actual `precheck` body to `edit_method` if needed.

---

## Phase 3 — Plan + user approval

Print the plan in this exact format and STOP for `ok` / `edit` / question:

```text
Plan — generate FE app at <fe_app>:

Floorplan:           List Report + Object Page (LROP V4)
Namespace:           <source_namespace>.fe
UI5 version:         <user-provided, default latest 1.x>
V4 service:          <V4_service_URL>
Main entity:         <root_alias> (alias on the root projection)
Generator:           SAP Fiori MCP server (@sap-ux/fiori-mcp-server)

Backend annotation writes (via SAPWrite update DDLS on the projection):
  <root_projection>:
    @UI.HeaderInfo, @UI.SelectionFields, @UI.LineItem (root columns),
    @UI.Identification, @UI.PresentationVariant.SortOrder,
    @UI.FieldGroup.Audit, @UI.Facet (Identification + Tasks)
    @Common.Text + virtual <field>Criticality (Status)

  <child_projection_task>:
    @UI.LineItem (Task columns), @UI.HeaderInfo,
    @UI.Facet (Task identification + TimeEntries),
    @Common.Text + virtual fields for Status, Priority

  <child_projection_timeentry>:
    @UI.LineItem (TimeEntry columns), @UI.HeaderInfo

BDEF-side adjustments (via SAPWrite update BDEF / edit_method):
  <list precheck additions, if any>

FE app generation (via Fiori MCP):
  Step 1: list_functionalities      → enumerate supported FE app creations
  Step 2: get_functionality_details → "create FE V4 list-report+OP for external OData service"
  Step 3: execute_functionality     → pass service URL, root entity, namespace, target folder

Extension scaffold (post-generation):
  - <controller-extension list per Phase 2b>

Validation:
  - ui5-linter clean
  - manifest validation clean
  - tsc --noEmit clean
  - browser smoke against every Phase 1 inventory item

Type `ok` to proceed, `edit` to revise, or ask any question.
```

Wait for `ok` before mutating anything in the SAP system or generating the FE app.

---

## Phase 4 — Write `@UI.*` annotations to CDS projections (backend preparation)

This is the "prepare the annotations in the backend" step. Do **all** the CDS writes here
BEFORE invoking the Fiori MCP generator — the generator reads the annotated `$metadata`, so
the annotations must be active and the SRVB republished before the generator runs.

### 4a. Annotate the root projection

```text
SAPRead(type="DDLS", name="<root_projection>")
```

Splice in the planned annotations. Concrete shape (substitute your entities):

```cds
@Metadata.allowExtensions: true

@UI.headerInfo: {
  typeName:       'Project',
  typeNamePlural: 'Projects',
  title:          { value: 'Title' },
  description:    { value: 'ProjectId' }
}
@UI.selectionFields: [ 'ProjectId', 'Title', 'Status' ]
@UI.presentationVariant: [{
  qualifier: 'DefaultSort',
  sortOrder: [{ by: 'StartDate', direction: #DESC }]
}]
@UI.facet: [
  { id: 'GeneralInfo',  purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'General' },
  { id: 'AuditInfo',    purpose: #STANDARD, type: #FIELDGROUP_REFERENCE, label: 'Audit',
    targetQualifier: 'Audit' },
  { id: 'Tasks',        purpose: #STANDARD, type: #LINEITEM_REFERENCE, label: 'Tasks',
    targetElement: '_Tasks' }
]
// Header action — renders as an "Approve" button on the OP header (showcase #OPHeaderAction).
// criticality 3 = green (success), 0 = neutral, 1 = red.
@UI.identification: [
  { type: #FOR_ACTION,
    dataAction: 'approve_project',
    label: 'Approve',
    criticality: 3,
    criticalityRepresentation: #WITH_ICON }
]
@Search.searchable: true
define root view entity <root_projection>
  provider contract transactional_query
  as projection on <root_view>
{
  key   @UI.lineItem:       [{ position: 10, importance: #HIGH }]
        @UI.identification: [{ position: 10 }]
        @UI.selectionField: [{ position: 10 }]
        @Search.defaultSearchElement: true
        ProjectId,

        @UI.lineItem:       [{ position: 20, importance: #HIGH }]
        @UI.identification: [{ position: 20 }]
        @UI.selectionField: [{ position: 20 }]
        @Search.defaultSearchElement: true
        Title,

        @UI.lineItem:       [{ position: 30, criticality: 'StatusCriticality' }]
        @UI.identification: [{ position: 30 }]
        @UI.selectionField: [{ position: 30 }]
        Status,

        @UI.lineItem:       [{ position: 40 }]
        @UI.identification: [{ position: 40 }]
        StartDate,

        @UI.lineItem:       [{ position: 50 }]
        @UI.identification: [{ position: 50 }]
        EndDate,

        @UI.identification: [{ position: 60 }]
        Description,

        @UI.fieldGroup: [{ qualifier: 'Audit', position: 10, label: 'Created at' }]
        Erdat,
        @UI.fieldGroup: [{ qualifier: 'Audit', position: 20, label: 'Created by' }]
        Ernam,
        @UI.fieldGroup: [{ qualifier: 'Audit', position: 30, label: 'Changed at' }]
        Aedat,
        @UI.fieldGroup: [{ qualifier: 'Audit', position: 40, label: 'Changed by' }]
        Aenam,

        // virtual criticality field (computed from Status code)
        @ObjectModel.virtualElementCalculatedBy: 'ABAP:<root_class>'  // OR via case-when below
        virtual StatusCriticality : abap.int1,

        /* associations */
        _Tasks
}
```

For the virtual criticality, simplest cross-7.58-compatible option is a `case-when` directly
in the projection:

```cds
case Status
  when 'D' then 2    // Critical (Warning)
  when 'A' then 3    // Positive (Success)
  when 'C' then 0    // Neutral
  else          0
end as StatusCriticality,
```

Write the spliced source:

```text
SAPWrite(action="update", type="DDLS", name="<root_projection>",
         source="<spliced source>", transport="<transport>")
SAPActivate(type="DDLS", name="<root_projection>")
```

### 4b. Annotate every child projection

Repeat the pattern for each `<child_projection_X>`. Each child gets:

- `@UI.headerInfo` (title/description)
- `@UI.lineItem` for every column the legacy view showed
- `@UI.facet` if the child has further children (e.g. `_TimeEntries` under Task)
- Virtual criticality fields for any code-with-color field surfaced in the inventory

### 4c. Publish the SRVB

The SRVB needs republishing for the new annotations to surface in `$metadata`:

```text
SAPWrite(action="publish_srvb", name="<V4_SRVB>")
```

### 4d. Verify annotations land in `$metadata`

```text
Bash: curl -s "<base>/<V4_service_URL>/$metadata" | grep -oE 'UI\.(LineItem|HeaderInfo|Facets|SelectionFields|PresentationVariant|FieldGroup|Identification)' | sort -u
```

Expected output: every annotation kind you wrote shows up in the listing. If empty, the SRVB
didn't pick up the changes — re-run `publish_srvb`. If only some show, the projection wasn't
re-activated cleanly — `SAPDiagnose(action="object_state", type="DDLS", name="<root_projection>")`
to inspect.

---

## Phase 5 — Generate the FE app via the SAP Fiori MCP server

This is the "use Fiori MCP to create the app" step. The Fiori MCP server exposes a
three-tool dance — `list_functionalities` → `get_functionality_details` → `execute_functionality`.
Each step narrows scope. Do not skip steps even if you think you know the params.

References:
- [SAP/open-ux-tools — fiori-mcp-server README](https://github.com/SAP/open-ux-tools/tree/main/packages/fiori-mcp-server)
- [npm: @sap-ux/fiori-mcp-server](https://www.npmjs.com/package/@sap-ux/fiori-mcp-server)
- [SAP Community: First Release of the SAP Fiori MCP Server](https://community.sap.com/t5/technology-blog-posts-by-sap/sap-fiori-tools-update-first-release-of-the-sap-fiori-mcp-server-for/ba-p/14204694)

> The Fiori MCP server is **experimental** at the time of this skill's writing. Tool
> signatures may change. If `list_functionalities` returns a different shape than expected,
> follow the live response — the README above is the source of truth.

### 5a. Discover what the server can do

```text
mcp__fiori-mcp__list_functionalities
```

Inspect the response for a functionality that matches "create a new Fiori elements application
for an external OData V4 service". The exact name in the response depends on the server version
— look for keywords like `create`, `fiori-elements`, `list-report`, `lropv4`, `external-service`.

If the server doesn't have a matching functionality:

- It might require a CAP project. In that case, generate via the legacy fallback
  (`@sap/generator-fiori` CLI — see 5d) and document the gap as a Run capture for next iteration.
- Or the user's Fiori MCP version is older than expected. Re-check by running:
  ```text
  Bash: npx --yes @sap-ux/fiori-mcp-server@latest --version
  ```
  and instructing the user to update the MCP config to pin the latest.

### 5b. Get parameter requirements for the chosen functionality

```text
mcp__fiori-mcp__get_functionality_details(name="<the-functionality-name-from-5a>")
```

The response lists required + optional parameters. For the LROP-for-external-service flow,
typical required parameters include:

- `serviceUrl` — `<V4_service_URL>` (the `$metadata`-backed endpoint from Phase 0a)
- `mainEntity` or `entitySet` — the root entity alias from the SRVB (e.g. `Project`)
- `targetPath` — `<fe_app>/` (the folder to generate into)
- `namespace` — `<source_namespace>.fe`
- `appId` / `appName` — the application identifier
- `ui5Version` — user-provided (default: latest 1.x)
- `language` — `typescript`

Map the user-supplied inputs onto the required parameters. If a required parameter has no
mapping, **stop and ask the user**. Do not invent values.

### 5c. Execute the generator

```text
mcp__fiori-mcp__execute_functionality(
  name="<the-functionality-name-from-5a>",
  parameters={
    serviceUrl: "<V4_service_URL>",
    mainEntity: "<root_alias>",
    targetPath: "<fe_app>",
    namespace:  "<source_namespace>.fe",
    appName:    "<short-app-id>",
    ui5Version: "<ui5-version>",
    language:   "typescript"
  }
)
```

Wait for the generator to finish. Verify the structure:

```text
Bash: ls <fe_app>/webapp/ && cat <fe_app>/webapp/manifest.json | head -40
```

Expected:

- `webapp/Component.ts`
- `webapp/manifest.json` with `sap.ui.generic.app` / `sap.fe.templates` config
- `webapp/i18n/i18n.properties`
- `webapp/ext/` (extension folder — may be empty)
- `package.json` / `ui5.yaml` / `tsconfig.json`

### 5d. Fallback if the MCP server can't do it

If `list_functionalities` doesn't expose an external-service path, fall back to the
`@sap/generator-fiori` CLI:

```text
Bash: cd <workspace> && npx --yes @sap/generator-fiori --no-deploy
```

Walk through the prompts (or pass `--skip-install` with explicit args). This is the same
generator the MCP server wraps — slower because it's interactive, but always works.

Capture the gap in `RUN-NOTES.md` so the next iteration can fix the prompt for the MCP path.

---

## Phase 6 — Configure extensions for the EXTENSION list from Phase 2b

For each row in the Phase 2b extension map, scaffold a TS controller extension. FE V4
extensions come in two flavors:

- **Controller extensions** — extend the LR or OP controller via the `editFlow` /
  `routing` / `appComponent` API.
- **Extension points** — slot custom XML/Fragment into a specific spot (header, footer,
  before/after a section).

For the talk demo's typical extension (a precheck on approve that the BDEF doesn't already
encode):

```text
Write: <fe_app>/webapp/ext/ObjectPageExt.ts
```

```typescript
import ControllerExtension from "sap/ui/core/mvc/ControllerExtension";
import MessageBox from "sap/m/MessageBox";

/**
 * @namespace <source_namespace>.fe.ext
 */
export default class ObjectPageExt extends ControllerExtension {
  public static overrides = {
    editFlow: {
      onBeforeAction: async function (
        this: ObjectPageExt,
        mParameters: { actionName: string; context: any }
      ) {
        if (!mParameters.actionName.endsWith(".approve_project")) return;
        const description = mParameters.context.getProperty("Description");
        if (!description) {
          MessageBox.error("Cannot approve a project without a description.");
          throw new Error("Approval blocked by extension");
        }
      }
    }
  };
}
```

Register the extension in `<fe_app>/webapp/manifest.json`:

```json
"sap.ui5": {
  "extends": {
    "extensions": {
      "sap.ui.controllerExtensions": {
        "sap.fe.templates.ObjectPage.ObjectPageController": {
          "controllerName": "<source_namespace>.fe.ext.ObjectPageExt"
        }
      }
    }
  }
}
```

Run the linter after each extension scaffold:

```text
mcp__SAPUI5_MCP_Server__run_ui5_linter(files=["<fe_app>/webapp/ext/ObjectPageExt.ts"])
```

Repeat for every entry in the extension map. Keep extensions small — one concern per class.

If a feature classification is ambiguous (annotation? extension?), use the Fiori MCP's docs
search to resolve:

```text
mcp__fiori-mcp__search_docs(query="custom validation before action Fiori elements V4")
```

This pulls the authoritative SAP guidance and prevents speculation.

---

## Phase 7 — Validation + smoke test

### 7a. Static checks

```text
mcp__SAPUI5_MCP_Server__run_ui5_linter
mcp__SAPUI5_MCP_Server__run_manifest_validation
Bash: cd <fe_app> && npx tsc --noEmit
```

All three must return clean.

### 7b. Dev server

Restart the dev server on a free port (default `8082` — pick a different port if the legacy
app's dev server or another running tool already uses it):

```text
Bash: cd <fe_app> && pkill -f "ui5 serve" ; (npm start -- --port 8082 &)
```

Wait ~5 seconds for the server to come up. Probe the entry point:

```text
Bash: curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/index.html
```

### 7c. Browser smoke against the Phase 1 inventory

Open `http://localhost:8082` in a browser and validate **every** Phase 1 inventory item. The
acceptance criterion is: the FE app reproduces every user-visible feature of the legacy app,
either through annotations or extensions.

Reference checklist (adapt to the user's inventory):

1. **List-report renders** with the columns from `@UI.LineItem` in the right order.
2. **Filter bar** shows the fields from `@UI.SelectionFields`.
3. **Search** works on the fields marked `@Search.defaultSearchElement`.
4. **Default sort** matches `@UI.PresentationVariant.SortOrder`.
5. **Row click** opens the OP.
6. **OP header** shows the right title/description from `@UI.HeaderInfo`.
7. **Status field** in the row has the right color (criticality).
8. **Tabs/facets** render each `@UI.Facet`-referenced association.
9. **Nested facets** drill into grandchild entities (e.g. TimeEntries under Tasks).
10. **Action button** renders for the BDEF action (from `@UI.identification` `DataFieldForAction`); clicking executes via the framework's standard CSRF/etag flow — no extension required for the round-trip.
11. **Extension hook** fires for the cases inventoried in Phase 2b (validation, custom prompts).
12. **Audit fields** show in the Audit facet on the OP.
13. **Native FE count** in the list-report header matches the legacy footer phrasing
    (allowing for "X projects" vs "Showing X of Y" UX differences).

### 7c.1 — Draft V4 reality (verified in Run 6)

The V4 service exposes `IsActiveEntity` as part of every entity key under a draft scenario.
Two consequences for testing:

- **Keyed reads** must include `IsActiveEntity`: `Project(ProjectId='PRJ-0001',IsActiveEntity=true)` returns 200; the legacy-style `Project('PRJ-0001')` returns 400.
- **Action invocation** requires the full CSRF dance: GET `<service-root>/?sap-client=<n>` with `X-CSRF-Token: Fetch` first → POST the action URL with the returned `X-CSRF-Token`, session cookie, and `If-Match: <etag>`. Skipping `If-Match` returns 428 (`CX_OD_PRECOND_REQUIRED`).

These are normal for any V4 + draft service; FE templates handle them automatically at runtime. The notes here are for manual `curl` smokes only.

If any step fails:

- For an annotation issue, return to Phase 4 and adjust the CDS, re-activate, `publish_srvb`,
  rerun the smoke step.
- For an extension issue, debug the controller extension in browser DevTools.
- For an FE rendering issue that looks like a tool bug, run
  `mcp__fiori-mcp__search_docs(query="<exact symptom>")` to find the authoritative reference.

### 7d. Final report

```text
Fiori Elements conversion complete — <fe_app>

Floorplan:        LROP V4 (TS)
UI5:              <version>
V4 service:       <V4_service_URL>
Annotations:      <n> @UI.* annotations written across <m> projections
Extensions:       <n> controller extensions
Linter:           clean
Manifest:         clean
TypeCheck:        clean
Browser smoke:    <12+/12+> inventory items reproduced

What just happened (3 sentences):
  - Mined the legacy app's user-visible feature set (columns, sort, search, actions,
    tab structure, formatters).
  - Wrote the equivalent @UI.* / @Common.* / @Search.* annotations onto the RAP CDS
    projections via ARC-1.
  - Generated the FE app on top of the now-annotated $metadata via the SAP Fiori MCP
    server, with extension hooks for the few cases FE templates can't express natively.

ARC-1 calls used:
  - SAPManage(action=probe)
  - SAPRead(type=DDLS, name=<root_projection>)
  - SAPRead(type=SRVB, name=<V4_SRVB>)
  - SAPWrite(action=update, type=DDLS, ...) × <m> projections
  - SAPActivate(type=DDLS, ...)
  - SAPWrite(action=publish_srvb, name=<V4_SRVB>)
  - (Optional) SAPWrite(action=update, type=BDEF, ...) + SAPActivate for BDEF precheck

Fiori MCP calls used:
  - mcp__fiori-mcp__list_functionalities
  - mcp__fiori-mcp__get_functionality_details(name=<chosen>)
  - mcp__fiori-mcp__execute_functionality(...)
  - mcp__fiori-mcp__search_docs(...) × <n> (during extension scaffolding)

UI5 MCP calls used:
  - mcp__SAPUI5_MCP_Server__run_ui5_linter × <n>
  - mcp__SAPUI5_MCP_Server__run_manifest_validation
```

---

## Error handling — known modes

| Symptom | Cause | Fix |
|---|---|---|
| `$metadata` reflects no annotations after `SAPWrite update DDLS` | DDLS reactivated but SRVB wasn't republished | `SAPWrite(action="publish_srvb", name="<V4_SRVB>")` |
| `mcp__fiori-mcp__list_functionalities` returns empty / fails | Server not registered, or `npx` cache stale | Verify `.cursor/mcp.json`; in a fresh shell, `npx --yes @sap-ux/fiori-mcp-server@latest fiori-mcp` should print server-ready logs |
| Generator fails with "service unreachable" | The `<V4_service_URL>` is gated by 403 because of the V4 routing group | Surface the `/n/IWFND/MAINT_SERVICE` manual step from `migrate-segw-to-rap.md` Phase 6 |
| Generator succeeds but FE app shows a blank shell | `mainEntity` passed without annotated CDS | Re-check Phase 4 — every entity in the `@UI.Facet` chain needs at least `@UI.LineItem` and (for OP root) `@UI.HeaderInfo` |
| List-report shows no columns | `@UI.LineItem` annotation is on the root view, not the projection | Move annotations to the projection; FE reads them from the SRVB-exposed projection |
| Action button not visible | Action wasn't exposed on the projection BDEF, or projection BDEF missing `use action approve_project` | Check projection BDEF (`define behavior for <root_projection> { ... use action approve_project; }`) and re-publish |
| Filter bar empty | `@UI.SelectionFields` annotation missing or pointing at field that's not marked `@Search.searchable` at view level | Add `@Search.searchable: true` at the view level and `@Search.defaultSearchElement: true` on the right fields |
| Status field uncolored | No criticality binding | Add the `criticality: '<field>Criticality'` reference on the `@UI.LineItem` entry, AND a virtual `<field>Criticality` projection field that maps the code to FE criticality (0=Neutral, 1=Negative, 2=Critical, 3=Positive) |
| Nested facet (TimeEntries under Tasks) doesn't render | Some 7.5x releases don't honor `_Tasks._TimeEntries` LineItem facet paths | Render TimeEntries as a separate OP if you must — drill from the Task LineItem; verify on user's release |
| Controller extension throws "Override target not found" | Wrong controller path in manifest | LR: `sap.fe.templates.ListReport.ListReportController`; OP: `sap.fe.templates.ObjectPage.ObjectPageController` |
| `MCP server timed out` | Long-running execute_functionality blocked by slow `$metadata` fetch | Increase the MCP `timeout` in `.cursor/mcp.json` (currently 600s); the default is usually enough for the talk-demo's service size |
| Generator hangs on a confirmation prompt | The MCP server tried to interactively confirm an overwrite | Pre-delete `<fe_app>/` before re-running, or pass `overwrite: true` if the functionality details list it |

---

## What this skill explicitly does NOT cover

- **Multi-floorplan composition** (Overview Page + LRO + ALP). Single LRO+OP is the talk
  demo's scope. Composition is a follow-up.
- **Heavy custom rendering** that genuinely can't fit into FE building blocks. If the user
  needs that, they should pick the freestyle path (`modernize-ui5-app.md`) instead.
- **Mock/local-service mode.** The skill targets the live V4 RAP service. The Fiori MCP can
  generate apps for CAP projects, but that's a different flow.
- **Authorization policy.** FE renders what the service authorizes. PFCG / S_DEVELOP changes
  happen on the SAP side, not in this skill.
- **Translation/localization beyond what the CDS `@EndUserText.label` provides.** FE picks
  labels from the service metadata; additional i18n lives in the FE app's i18n files.
- **CAP-side generation.** This skill assumes a RAP backend; for CAP-only flows use the
  Fiori MCP server's CAP-targeted prompts directly.

---

## Notes for the LLM running this skill

- The **annotation-first** discipline is the whole point. Never let the FE generator run
  against an un-annotated `$metadata` — the result is a useless shell.
- The Fiori MCP server is **experimental**. Tool names and parameter shapes may have shifted
  since this skill was written. Always start with `list_functionalities` and adapt.
- Annotations belong on the **projection**, not the root view. The SRVB exposes the projection;
  FE reads from there.
- **Republish the SRVB** after every CDS change that affects exposed annotations. ADT does not
  do this automatically.
- The "facets reference associations" pattern is the trickiest part: a facet of type
  `#LINEITEM_REFERENCE` with `targetElement: '_Tasks'` only works if `_Tasks` is an exposed
  association on the projection. Check the projection's `use association _Tasks { ... }` block.
- Controller extensions are the escape hatch — when in doubt about whether something needs one,
  ask the user. The FE template can express more than people expect; only escalate when truly
  necessary.
- Reach for `mcp__fiori-mcp__search_docs` (or `mcp__sap-docs__search` with `topic="fiori-elements"`)
  before guessing annotation syntax. SAP's annotation reference is the authoritative source.
- If `mcp__fiori-mcp__list_functionalities` returns capabilities you didn't expect (e.g.
  "add page to existing app", "modify manifest"), surface them in the plan — they may simplify
  Phase 6 extension work.
- **Do not** edit `manifest.json` by hand to add pages or change routing if the Fiori MCP can
  do it via `execute_functionality`. The MCP's edits are schema-aware and survive re-generation;
  hand edits can be overwritten.

## Sources

- [SAP/open-ux-tools — fiori-mcp-server README](https://github.com/SAP/open-ux-tools/tree/main/packages/fiori-mcp-server)
- [npm: @sap-ux/fiori-mcp-server](https://www.npmjs.com/package/@sap-ux/fiori-mcp-server)
- [SAP Community: First Release of the SAP Fiori MCP Server](https://community.sap.com/t5/technology-blog-posts-by-sap/sap-fiori-tools-update-first-release-of-the-sap-fiori-mcp-server-for/ba-p/14204694)
- [SAP-samples/ui5con-2026-fiori-mcp-server (hands-on exercises)](https://github.com/sap-samples/ui5con-2026-fiori-mcp-server)
- [SAP-samples/fiori-mcp-server-hands-on](https://github.com/SAP-samples/fiori-mcp-server-hands-on)
- [sapdev.eu: Using Fiori MCP Server in VSCode with Cline or GitHub Copilot](https://www.sapdev.eu/using-fiori-mcp-server-in-vscode-with-cline-or-github-copilot/)
