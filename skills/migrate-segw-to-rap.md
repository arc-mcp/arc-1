# Migrate SEGW OData V2 service ➜ RAP service

Reverse-engineer a classic SEGW-built OData V2 service (MPC/DPC/MPC_EXT/DPC_EXT) into a modern
RAP service (CDS root + projection + BDEF + SRVD + SRVB + behavior pool) on the same SAP system.
Runs side-by-side: the legacy service stays live; the new RAP service lands in a separate,
resettable package.

> **Domain example.** Templates in this skill use an illustrative `Project → Tasks → TimeEntries`
> domain (entity names like `ZR_DM_PROJECT`, `ZBP_DM_PROJECT`, `ZDM_PROJECT_D`) so the shape is
> concrete. Substitute the user's entities throughout — the LLM running this skill should
> rewrite every entity identifier to match the source service.

## Smart defaults (apply silently — do NOT ask before research)

| Setting | Default | Rationale |
|---|---|---|
| Discovery strategy | MPC class source (Tier 1) | ARC-1 reads it natively; richer than `$metadata` |
| Target package | User-provided. If absent, create a child of the source package via `SAPManage(action="create_package")`; default name `<source_package>_RAP`. Only fall back to `$TMP` if the user explicitly asks. | Keeps the migration output isolated and resettable. |
| Target transport | User-provided existing, or auto-created via `SAPTransport(action="create", description="RAP migration of <legacy_service>", package="<target_package>")`. | Required for non-`$TMP` packages. |
| OData version on target | V4 | Current SAP standard; FE-ready |
| RAP scenario | Managed with internal numbering | Simplest read-mostly; matches legacy SEGW behaviour |
| Draft | Off for read-mostly entities. ON when the legacy service exposed CUD (function imports, deep inserts, or sap:updatable=true on entity sets) and the user wants Fiori Elements compatibility. | Match the legacy service's behavior contract; FE list+OP work best with draft on. |
| Strict mode | `strict ( 2 )` | Current best practice |
| Projection layer | **Mandatory — always create a `ZC_*` projection alongside every `ZR_*` root view**. Service binding exposes the projection, never the root. | Run 1 of the skill skipped projections after a misread CDS error; spell out so the LLM never drops them. |
| `provider contract` on projections | **On the root projection only**, not on the root view, not on child projections. The contract sits at exactly one level. Use `transactional_query` when combining projection BDEF + `use draft` on 7.58; `transactional_interface` for read-mostly without draft. | Putting it on a root view → *"only valid on projection views"*. Putting it on child projections → *"inappropriate provider contract on …"*. Children are exposed via `redirected to parent` and inherit the BO contract from the root projection. Run 3 confirmed `_query` is needed for draft on 7.58. |
| CDS composition syntax (managed) | `composition [0..*] of <child> as <name>` — **no `on` clause**. Key linking is implicit via matching key fields / `with foreign key` in the child | 7.58 rejects `on` on managed compositions. The recovery is dropping `on`, not switching to `association to`. |
| `@Semantics.*` on 7.58 | Use only `@Semantics.systemDateTime.createdAt : true` and `@Semantics.systemDateTime.lastChangedAt : true`. Do NOT use `localInstanceLastChangedAt`, `businessDate.*`, or other newer annotations. | Run 2 hit *"Annotation `Semantics.systemDateTime.localInstanceLastChangedAt` is unknown"* on 7.58. Those came in 7.59+. Same for `@Semantics.businessDate.*`. |
| Draft table field names (when draft=ON) | Use BO-alias casing **without underscores** — e.g. `projectid`, `startdate`, NOT `project_id`, `start_date`. ABAP normalizes BDEF aliases (`ProjectId`, `StartDate`) to `PROJECTID`, `STARTDATE` — the draft table lookup is by that normalized name, not by the active table's snake_case. | Run 2: BDEF activation failed with *"key field PROJECTID expected at position 2, found PROJECT_ID"*. The active table can keep snake_case (BDEF mapping handles it); the draft table cannot — it has no mapping clause. |
| Naming | SAP-standard `Z<prefix>_<entity>`: `ZR_` root, `ZC_` projection, `ZI_<entity>_BEH` BDEF, `ZBP_` behavior pool, `ZUI_<service>_O4` V4 SRVB | Aligns with SAP-internal conventions; the leading `Z` is the customer namespace |
| Pre-write lint | On | Set `SAP_ABAP_RELEASE=<your_release>` in ARC-1 config (PR #255) so the lint preset matches the system release. The older `SAP_LINT_BEFORE_WRITE=false` workaround is no longer needed. |
| Pre-write SAP check | On for activation-blockers only | We rely on activation feedback, not `--check-before-write` |

## Input

The user must provide **at minimum**:

- **One of**: a SEGW service technical name (e.g. `Z<SOMETHING>_SRV`), a package containing
  the SEGW-generated classes, or an MPC class name directly. Ask if not given.
- **Target package** for the new RAP objects. Skill will create one (`<source_package>_RAP`)
  if not given and the source package is known; otherwise asks. Only defaults to `$TMP` if
  the user explicitly asks.
- **Transport** for non-`$TMP` writes — existing or auto-created (see Smart Defaults).

Optional:

- **RAP scenario** (default: managed with internal numbering).
- **Draft on/off** (skill infers from legacy CUD surface).
- **OData version** (default: V4).
- **Naming overrides** (default: SAP standard `Z<prefix>_<entity>`).

If only the legacy identifier is given, skill applies smart defaults and surfaces the resolved
plan in Phase 5 for user `ok` before any writes.

---

## Phase 0 — Authorization preflight

Run **before** any modelling work. Aborts cleanly if anything is missing, with the specific SAP
auth object the user needs.

### 0a. Server-side capability + auth probe

```text
SAPManage(action="probe")
```

Assert from the response:
- `systemType` ∈ {`onprem`, `btp`} — needed for naming + admin-field choices
- `rap.available == true` — fail with: *"This system doesn't expose RAP/CDS endpoints. Migration
  cannot proceed."*
- `transport.available == true` — fail with: *"Transport API unavailable; check ICF
  `/sap/bc/adt/cts/transports`."*
- `authProbe.searchAccess == true` — fail with: *"User cannot search ADT objects; need
  `S_DEVELOP` ACTVT=03 OBJTYPE=CLAS DEVCLASS=`<source-pkg>`."*
- `authProbe.transportAccess == true` — fail with: *"User cannot read transports; need
  `S_TRANSPRT` ACTVT=03."*

### 0b. Read the legacy MPC class — confirms read on source

```text
SAPRead(type="CLAS", name="<MPC>", method="*")
```

On HTTP 403: stop with *"Cannot read `<MPC>` — need `S_DEVELOP` ACTVT=03 OBJTYPE=CLAS
DEVCLASS=`<source-pkg>` P_GROUP=`<auth-group>`. Run SU53 in SAP GUI to see the missing field."*

### 0c. Confirm write on target package

```text
SAPTransport(action="check", objectType="DDLS", objectName="ZX_PRECHECK", package="<target_package>")
```

Then dry-run a write+delete on a throwaway DDLS:

```text
SAPWrite(action="create", type="DDLS", name="ZR_DM_PRECHECK",
         source="@AccessControl.authorizationCheck: #NOT_REQUIRED\ndefine root view entity ZR_DM_PRECHECK as select from t000 { client }",
         description="ARC-1 preflight",
         package="<target_package>",
         transport="<transport>")
SAPWrite(action="delete", type="DDLS", name="ZR_DM_PRECHECK")
```

On 403 from create: stop with *"Cannot write to `<target_package>` — need `S_DEVELOP` ACTVT=01,02,07
OBJTYPE=DDLS DEVCLASS=`<target_package>`."*

If all three pass, print **"Phase 0 ✓ Authorizations OK — proceeding to discovery."** and continue.


---

## Phase 1 — Discover the legacy service

### 1a. Resolve the MPC class name

If user gave a service name (e.g. `<legacy_service>`):
- Try convention: trim `_SRV` → append `_MPC` → `<MPC_class>`. Verify with
  `SAPRead`.
- If not found:
  ```text
  SAPQuery(action="sql", sql="SELECT obj_name, devclass FROM tadir
    WHERE pgmid = 'R3TR' AND object = 'CLAS'
      AND obj_name LIKE 'Z%_MPC' ORDER BY obj_name")
  ```
  and ask the user to pick.

If user gave a package (e.g. `<source_package>`):
- ```text
  SAPRead(type="DEVC", name="<package>")
  ```
  Filter for classes ending `_MPC`.

If user gave an MPC class directly: use it as-is.

Determine the corresponding `_MPC_EXT`, `_DPC`, `_DPC_EXT` by name convention.

### 1b. Confirm the four classes exist + record metadata

```text
SAPSearch(action="object", query="<base>_*", maxResults=10)
```

Expected: 4 hits. Record `objectName` + `packageName` for each.

Print to user:
```
Legacy service: <legacy_service>
  Package:      <source_package>
  MPC class:    <MPC_class>      (model)
  MPC_EXT:      <MPC_EXT_class>  (model overrides — usually empty)
  DPC class:    <DPC_class>      (data provider — generated)
  DPC_EXT:      <DPC_EXT_class>  (data provider — your custom code)
```


---

## Phase 2 — Extract the OData model from MPC source

The MPC class's private `DEFINE_*` methods carry the full model. Read them.

### 2a. Method inventory

```text
SAPRead(type="CLAS", name="<MPC>", method="*")
```

You're looking for:
- `DEFINE_<entity>` — one per entity type
- `DEFINE_ASSOCIATIONS` — all associations + nav properties
- `DEFINE_ACTIONS` — all function imports

### 2b. Per-entity read

For each `DEFINE_<entity>` method:

```text
SAPRead(type="CLAS", name="<MPC>", method="DEFINE_<ENTITY>")
```

Parse the body for:
- Entity type name + entity set name (look for `create_entity_type(...)` and
  `create_entity_set(...)`)
- Underlying ABAP DDIC bind (look for `bind_structure(...)` or `set_data_source(...)`)
- Each property: name, EDM type, max-length, is-key, sortable/filterable/creatable/updatable
  (look for `create_property(...)` followed by `set_*` calls)

### 2c. Associations

```text
SAPRead(type="CLAS", name="<MPC>", method="DEFINE_ASSOCIATIONS")
```

Parse for each `create_association(...)`:
- Association name
- Principal entity + cardinality
- Dependent entity + cardinality
- Navigation property name(s)
- Referential constraints (principal property ↔ dependent property)

### 2d. Function imports

```text
SAPRead(type="CLAS", name="<MPC>", method="DEFINE_ACTIONS")
```

Parse for each `create_action(...)`:
- Action / function-import name
- HTTP method
- Return type (entity / complex / primitive / void)
- Return cardinality
- Parameters: name, type, length, mode (in/out/inout)

### 2e. Compile into a structured model

After Phase 2, you should be able to print a complete table like:

```
=== Extracted OData model ===

Entity types (3):
  Project    bound to ZDM_PROJECT     key: ProjectId       12 properties
  Task       bound to ZDM_TASK        key: TaskId          15 properties (FK ProjectId)
  TimeEntry  bound to ZDM_TIMEENTRY   key: EntryId         15 properties (FKs TaskId, ProjectId)

Entity sets (3):  ProjectSet, TaskSet, TimeEntrySet

Associations (2):
  Project_Tasks       Project [1] ↔ Task [0..n]            ref: ProjectId ↔ ProjectId   nav on Project: Tasks
  Task_TimeEntries    Task [1]    ↔ TimeEntry [0..n]       ref: TaskId    ↔ TaskId      nav on Task:    TimeEntries

Function imports (1):
  ApproveProject  POST  in: ProjectId (Edm.String, len 10)  return: Project (Entity, 1)
```

Print it and ask the user **"Does this match what you expected?"** before proceeding.


---

## Phase 3 — Extract the behavior from DPC_EXT

### 3a. Method inventory

```text
SAPRead(type="CLAS", name="<DPC_EXT>", method="*")
```

Categorize each redefined method:

| Method pattern | Maps to RAP |
|---|---|
| `<EntitySet>_GET_ENTITYSET` | CDS view's read access — usually free in managed scenario |
| `<EntitySet>_GET_ENTITY` | Same — free in managed scenario |
| `<EntitySet>_CREATE_ENTITY` | BDEF `create` enabled (with optional determination/validation) |
| `<EntitySet>_UPDATE_ENTITY` | BDEF `update` enabled |
| `<EntitySet>_DELETE_ENTITY` | BDEF `delete` enabled |
| `/IWBEP/IF_MGW_APPL_SRV_RUNTIME~EXECUTE_ACTION` | BDEF static or instance `action(...)` per function import |

### 3b. Per-method body read (only the ones with logic)

For each redefined method, decide:

- **Trivial GET** (just `SELECT * FROM <table> WHERE <key>` + `MOVE-CORRESPONDING`): drop entirely
  — RAP managed scenario does this for free.
- **Filtered GET** (additional WHERE clauses, derived fields): translate to CDS view filters or
  field aliases.
- **Function imports**: read the body, identify the business effect (status update, calculation,
  external call), translate to BDEF action with appropriate behavior pool method.

```text
SAPRead(type="CLAS", name="<DPC_EXT>", method="<METHOD_NAME>")
```

For mostly-trivial methods, this is a 30-line read. For complex business logic, expect 100+
lines and plan to rewrite carefully.

### 3c. Compile into a behavior summary

```
=== Extracted behavior ===

Read-only (drop, free in RAP managed):
  PROJECTSET_GET_ENTITYSET, PROJECTSET_GET_ENTITY,
  TASKSET_GET_ENTITYSET, TASKSET_GET_ENTITY,
  TIMEENTRYSET_GET_ENTITYSET, TIMEENTRYSET_GET_ENTITY

Function imports → BDEF actions:
  ApproveProject(ProjectId)     ➜  static action ApproveProject parameter $self
                                   sets Status='A' + admin fields, returns Project
                                   (legacy did UPDATE + COMMIT WORK + reread; RAP managed
                                    handles persistence — no manual COMMIT needed)

Custom create/update/delete: none (read-only service)
```

If `_CREATE_ENTITY` / `_UPDATE_ENTITY` / `_DELETE_ENTITY` were present, list them with notes
on what would become BDEF determinations / validations.


---

## Phase 4 — Read underlying tables

For each table identified in Phase 2 (e.g. `ZDM_PROJECT`, `ZDM_TASK`, `ZDM_TIMEENTRY`):

```text
SAPRead(type="TABL", name="<table>")
```

Record:
- Field list with ABAP types + lengths
- Key fields
- Admin fields convention (classic `ERNAM/ERDAT/ERZET/AENAM/AEDAT/AEZET` vs modern `abp_*`)
- Foreign-key references (the `with foreign key` clauses)

The tables stay as-is — the new RAP CDS views read from them.


---

## Phase 5 — Design plan + user approval

Before any write operation, present the **complete RAP design** as a design plan, get explicit
user approval, then proceed.

### 5a. Naming

```
Legacy → New RAP

ZDM_PROJECT (table, untouched)        ─► ZR_DM_PROJECT  (CDS root view entity)
                                        ZC_DM_PROJECT  (CDS projection view, exposed via service)
                                        ZI_DM_PROJECT  (BDEF for root)
ZDM_TASK    (table, untouched)        ─► ZR_DM_TASK    + ZC_DM_TASK
ZDM_TIMEENTRY (table, untouched)      ─► ZR_DM_TIMEENTRY + ZC_DM_TIMEENTRY

(no SEGW project on the new side)     ─► ZUI_DM_PROJECTS  (service definition — exposes ZC_*)
                                        ZUI_DM_PROJECTS_O4 (service binding, OData V4 UI)
                                        ZBP_DM_PROJECT  (behavior pool class for actions)
```

### 5b. Composition tree

```
root: ZR_DM_PROJECT
  composition [0..*] of ZR_DM_TASK as _Tasks
                        composition [0..*] of ZR_DM_TIMEENTRY as _TimeEntries
```

Maps the SEGW associations 1:1 — except now they're **compositions** (parent owns children),
which gives RAP managed lifecycle semantics for free.

### 5c. Action

```
ZI_DM_PROJECT (BDEF):
  define behavior for ZR_DM_PROJECT alias Project
    persistent table zdm_project
    lock master
    authorization master ( instance )
    etag master last_changed_at
    
    {
      field ( readonly ) ProjectId;
      action approve_project result [1] $self;        ← matches SEGW ApproveProject
    }
```

The `approve_project` action → handler in `ZBP_DM_PROJECT` → sets `status='A'` + admin fields
via the framework's MODIFY ENTITIES interface (no manual UPDATE + COMMIT).

### 5d. Service binding URL

```
Old (SEGW V2):  /sap/opu/odata/sap/<legacy_service>
New (RAP V4):   /sap/opu/odata4/sap/zui_dm_projects_o4/srvd_a2x/sap/zui_dm_projects/0001
```

(or the FLP-bound URL if the service binding is published as UI.)

### 5e. Show + ask

Print the full plan to the user. Wait for explicit **"yes, proceed"** or modifications. If
the user wants changes (different naming, draft enabled, different RAP scenario), revise and
re-present.

> **Non-interactive mode.** If the user's initial prompt already supplied the Phase-5
> equivalent inputs (legacy service, target package, transport, scenario, draft on/off)
> AND said "run end-to-end" / "don't stop for review", skip the rhetorical *"yes, proceed?"*
> gate. Print the plan as a manifest and advance directly to Phase 5f / Phase 6. Only stop
> if Phase 5 surfaced a genuine conflict (missing input, contradictory scenario flags, etc.).
> See Run 6 findings — full-chain automations otherwise hit a phantom gate.

### 5f. Lock the artifact list as a Phase-6 contract

**Before leaving Phase 5, the skill MUST emit an artifact-list contract that Phase 6 will
echo back with status. Print this verbatim:**

```
=== Phase 6 will create + activate these artifacts (Phase 5 → Phase 6 contract) ===

Roots (CDS):           [ ] ZR_DM_PROJECT  [ ] ZR_DM_TASK  [ ] ZR_DM_TIMEENTRY
Projections (CDS):     [ ] ZC_DM_PROJECT  [ ] ZC_DM_TASK  [ ] ZC_DM_TIMEENTRY
                       (projections are MANDATORY — service binding never exposes roots directly)
Draft tables (TABL):   [ ] ZDM_PROJECT_D  [ ] ZDM_TASK_D  [ ] ZDM_TIMEENTRY_D
                       (only when draft is on — based on Phase 5d)
BDEFs:                 [ ] ZR_DM_PROJECT (root behavior)  [ ] ZC_DM_PROJECT (projection behavior)
Behavior pool (CLAS):  [ ] ZBP_DM_PROJECT (empty shell — generate_behavior_implementation will populate)
Service definition:    [ ] ZUI_DM_PROJECTS  (exposes projections, NOT roots)
Service binding:       [ ] ZUI_DM_PROJECTS_O4 (OData V4 UI)

Manual steps remaining after Phase 6 build:
  [ ] /IWFND/MAINT_SERVICE — register V4 service group ZUI_DM_PROJECTS_O4 (else 403 at runtime)
```

Phase 6 must walk through this list at the end and print the same checkbox list with each
item marked `✓` or `✗` (with the failing tool call args + response on `✗`). Do NOT declare
Phase 6 done until every box is `✓` or explicitly waived by the user.

---

## Phase 6 — Build the RAP stack

### 6a. Reset existing artifacts (idempotent re-runs)

If `<target_package>` package contains objects from a previous run, delete them first:

```text
SAPRead(type="DEVC", name="<target_package>")
```

For each object in **reverse dependency order** (SRVB → SRVD → BDEF → DDLS_C → DDLS → CLAS → TABL):

```text
SAPWrite(action="delete", type="<type>", name="<name>", transport="<transport>")
```

(SAP recommends releasing the transport before re-running, but for resettable demos we just
reuse `<transport>` — it's fine.)

**Plus a TADIR cross-check** (Run 1 found a stub draft table sitting in a different transport
that the package scan missed; Run 6 found that ADT 404s can coexist with TADIR ghost rows —
the "split-brain" failure mode). On ARC-1 ≥ 0.9.5 (PR #270), the canonical reset truth
comes from `source="both"` mode, which queries ADT and DB TADIR in one call and emits a
`splitBrain` warning array for any divergent names:

```text
SAPSearch(searchType="tadir_lookup",
          source="both",
          names=["ZDM_PROJECT_D","ZDM_TASK_D","ZDM_TIMEENTRY_D",
                 "ZR_DM_PROJECT","ZR_DM_TASK","ZR_DM_TIMEENTRY",
                 "ZC_DM_PROJECT","ZC_DM_TASK","ZC_DM_TIMEENTRY",
                 "ZI_DM_PROJECT_BEH","ZI_DM_TASK_BEH","ZI_DM_TIMEENTRY_BEH",
                 "ZBP_DM_PROJECT","ZUI_DM_PROJECTS","ZUI_DM_PROJECTS_O4"])
```

Read the response in this order:

1. **`results`** — names found via ADT discovery (the "is the object actually live"
   question). Empty = the package is clean from ADT's perspective.
2. **`splitBrain`** — names where ADT and DB disagree (the "ghost" cases). For each, the
   array entry tells you which source saw it. The pragmatic interpretation: if a name is
   in DB-only (TADIR row, no ADT object), it's a ghost — treat as already absent for the
   purposes of `SAPWrite create`. If it's in ADT-only (rare), there's a stale ADT cache —
   `SAPSearch` again after a few seconds.

`source="both"` requires `sql` scope (the DB leg uses the free-SQL path). If your profile
doesn't have it, fall back to `source="adt"` (default) for the live check + `SAPQuery` for
a broader package sweep:

```text
SAPQuery(action="sql", sql="SELECT obj_name, object, devclass, korrnum FROM tadir
  WHERE devclass = '<target_package>' AND obj_name LIKE 'Z%'")
```

If a planned name appears in a *different* package, it's a leftover stub — delete via its
actual transport before proceeding.

### 6b. Build order — strict, no improvisation

The order below was learned the hard way (Run 1, calls #22–33). **Do not reorder.** Each step
prevents a specific failure mode in the next.

#### Step 1 — Draft tables (only if Phase 5d.draft = ON)

```text
SAPWrite(action="batch_create", objects=[
  { type: "TABL", name: "ZDM_PROJECT_D",   source: "<draft table source — see template below>", package: "<target_package>", transport: "<transport>" },
  { type: "TABL", name: "ZDM_TASK_D",      source: "<...>", package: "<target_package>", transport: "<transport>" },
  { type: "TABL", name: "ZDM_TIMEENTRY_D", source: "<...>", package: "<target_package>", transport: "<transport>" }
])
SAPActivate(action="activate", objects=[ {type:"TABL", name:"ZDM_PROJECT_D"}, ... ])
```

**Draft table template** — three rules learned in Run 2:

1. **Field names use BO-alias casing without underscores** (`projectid`, `startdate`,
   not `project_id`, `start_date`). ABAP normalizes BDEF aliases to uppercase no-underscore;
   draft binding looks up by that name, not by the active table's snake_case.
2. **`creationtimestamp` and `lastchangedstamp` columns required** for `total etag` +
   `etag master` clauses in the BDEF to bind.
3. **`@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE` is mandatory** — without it
   the TABL save fails on 7.58.

```abap
@EndUserText.label : 'Demo: Project (draft shadow)'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table zdm_project_d {
  " Field names match the BO aliases (no underscore) — required by RAP draft binding.
  " The active table ZDM_PROJECT can keep its snake_case names; the BDEF mapping bridges
  " them. The draft table has no mapping clause, so its names must align with the BO directly.

  key client            : abap.clnt not null;
  key projectid         : abap.char(10) not null;
  title                 : abap.char(100);
  description           : abap.char(255);
  status                : abap.char(1);
  startdate             : abap.dats;
  enddate               : abap.dats;
  erdat                 : abap.dats;
  erzet                 : abap.tims;
  ernam                 : abap.char(12);
  aedat                 : abap.dats;
  aezet                 : abap.tims;
  aenam                 : abap.char(12);

  " Required for `total etag CreationTimeStamp` + `etag master LastChangedStamp` in BDEF.
  " Computed in CDS root view via dats_tims_to_tstmp(...); persisted on draft instances.
  creationtimestamp     : abap.dec(15,0);
  lastchangedstamp      : abap.dec(15,0);

  include sych_bdl_draft_admin_inc;
}
```

`ZDM_TASK_D` mirrors with `taskid` + `projectid` (FK), all task-specific columns aliased
no-underscore. `ZDM_TIMEENTRY_D` mirrors with `entryid` + `taskid` + `projectid` (FKs).

#### Step 2 — CDS roots (`ZR_DM_*`)

Top-down: parent first, then children. Use `composition [0..*] of <child> as <name>` —
**no `on` clause** for managed scenario.

If your legacy DPC_EXT did Aedat → Erdat fallback (run 1 found this), bake it into the root
view's timestamp computation. **Use 7.58-compatible annotations only**:
`@Semantics.systemDateTime.createdAt` and `@Semantics.systemDateTime.lastChangedAt`.
**Do NOT use** `localInstanceLastChangedAt`, `localInstanceCreatedAt`, or any
`@Semantics.businessDate.*` — those came in 7.59+ and 7.58 rejects them as unknown.

```cds
@Semantics.systemDateTime.createdAt : true
dats_tims_to_tstmp(
  zdm_project.erdat,
  zdm_project.erzet,
  abap_system_timezone($session.client, 'NULL'),
  $session.client,
  'NULL'
) as CreationTimeStamp,

@Semantics.systemDateTime.lastChangedAt : true
dats_tims_to_tstmp(
  case zdm_project.aedat when '00000000' then zdm_project.erdat else zdm_project.aedat end,
  case zdm_project.aedat when '00000000' then zdm_project.erzet else zdm_project.aezet end,
  abap_system_timezone($session.client, 'NULL'),
  $session.client,
  'NULL'
) as LastChangedStamp
```

> **Activation order for composition CDS.** The default `batch_create` activates each
> object inline in array order, so the parent `composition [0..*] of ZR_DM_TASK as _Tasks`
> activates **before** `ZR_DM_TASK` exists, hitting *"data source `ZR_DM_TASK` does not
> exist"* (Run 6 reproducer). Three safe paths, pick whichever fits the run:
>
> 1. **`batch_create` with `activateAtEnd: true`** (ARC-1 ≥ 0.9.5, PR #270). Writes
>    inactive drafts for every object, then issues one terminal `activateBatch` so SAP's
>    activator resolves the cross-references in a single pass. This is the recommended
>    pattern when ARC-1 supports it — single tool call, no recovery dance:
>    ```text
>    SAPWrite(action="batch_create", activateAtEnd: true, objects=[...])
>    ```
> 2. **Per-file `SAPWrite(action="create")`** for each root, then a **single
>    `SAPActivate(action="activate", objects=[...])` batch** at the end (after every DDL
>    source has landed). Works on every ARC-1 release.
> 3. Manual bottom-up: `SAPWrite create` parent → `SAPActivate` child first → activate
>    parent last. More tool calls; rarely needed.
>
> The same fix applies to **Step 3 projections** (composition chain mirrored). Activate the
> projection trio together at the end, not inline.

#### Step 3 — CDS projections (`ZC_DM_*`) — DO NOT SKIP

This is where Run 1 silently dropped the layer. **A `provider contract` error here means
"create projections", NOT "remove the contract".**

**Critical: `provider contract transactional_interface` goes on the *root* projection
ONLY (`ZC_DM_PROJECT`).** Child projections (`ZC_DM_TASK`, `ZC_DM_TIMEENTRY`) use bare
`as projection on …` and inherit the BO contract via `redirected to parent`. Putting
the contract on children yields *"inappropriate provider contract on …"* on activation
(Run 2).

##### Root projection — WITH contract

Pick the contract based on scenario:
- **Managed + draft + CUD** (this skill's default): `provider contract transactional_query`
  (Run 3 evidence on 7.58: combining projection BDEF + `use draft` rejects `transactional_interface`).
- **Read-mostly, no draft, no CUD**: `provider contract transactional_interface`.

```cds
@AccessControl.authorizationCheck : #NOT_REQUIRED
@EndUserText.label : 'Demo project — UI projection (root)'
@Metadata.allowExtensions: true
define root view entity ZC_DM_PROJECT
  provider contract transactional_query
  as projection on ZR_DM_PROJECT
{
  key ProjectId,
      Title,
      Description,
      Status,
      StartDate,
      EndDate,
      Erdat, Erzet, Ernam, Aedat, Aezet, Aenam,
      CreationTimeStamp,
      LastChangedStamp,
      _Tasks : redirected to composition child ZC_DM_TASK
}
```

##### Child projections — WITHOUT contract, with `redirected to parent`

```cds
@AccessControl.authorizationCheck : #NOT_REQUIRED
@EndUserText.label : 'Demo task — UI projection (child)'
@Metadata.allowExtensions: true
define view entity ZC_DM_TASK
  as projection on ZR_DM_TASK
{
  key TaskId,
      ProjectId,
      Title, Description, Status, Priority, DueDate, AssignedTo, EstimatedHours,
      Erdat, Erzet, Ernam, Aedat, Aezet, Aenam,
      _Project      : redirected to parent ZC_DM_PROJECT,
      _TimeEntries  : redirected to composition child ZC_DM_TIMEENTRY
}
```

Same shape for `ZC_DM_TIMEENTRY` (no contract, `_Task : redirected to parent ZC_DM_TASK`).

> Note `define view entity` (not `define root view entity`) on children — only the BO
> root has `define root view entity`.

#### Step 4 — Empty behavior pool (skeletons created automatically by Step 7)

Write only the empty global class shell. The local handler classes (`lhc_project`,
`lhc_task`, `lhc_timeentry`) are no longer pre-created here — Step 7's
`SAPWrite action=generate_behavior_implementation` (PR-C, ARC-1 ≥ post-2026-05-10)
auto-creates them when missing, then injects every required handler signature and stub
in one call. Run 2's mandatory ADT-paste pause for CCDEF/CCIMP is gone.

```text
SAPWrite(action="create", type="CLAS", name="ZBP_DM_PROJECT",
         source="CLASS zbp_dm_project DEFINITION
                   PUBLIC ABSTRACT FINAL
                   FOR BEHAVIOR OF zr_dm_project.
                 ENDCLASS.

                 CLASS zbp_dm_project IMPLEMENTATION.
                 ENDCLASS.",
         description="Behavior pool for ZR_DM_PROJECT BO",
         package="<target_package>", transport="<transport>")
SAPActivate(type="CLAS", name="ZBP_DM_PROJECT")
```

> **Expected activation behavior.** The `SAPActivate` here may return *"no behavior
> definition for `zr_dm_project`"* — that's **expected and OK**. The BDEF doesn't exist
> yet; it's created in Step 5. Don't treat this as a real failure. The class will activate
> cleanly once the BDEF is in place; Step 7 (`generate_behavior_implementation`) re-activates
> the class with handlers anyway. Either:
> - Skip activation here (write only) and rely on Step 7 to activate.
> - Or accept the warning and re-activate the class as part of Step 10's batch activate.

That's it. No CCDEF/CCIMP write here. No ADT pause. Continue to Step 5.

#### Step 5 — Root BDEF with the managed-with-draft rules baked in

Run 1 calls #22–31 discovered ten managed-with-draft rules the hard way. Bake them in:

```abap
managed implementation in class zbp_dm_project unique;
strict ( 2 );
with draft;

define behavior for ZR_DM_PROJECT alias Project
  persistent table zdm_project
  draft table zdm_project_d
  lock master
  total etag CreationTimeStamp                 " <- required by `with draft`
  etag master LastChangedStamp
  authorization master ( instance )
{
  create;
  update;
  delete;

  field ( readonly : update ) ProjectId;
  field ( readonly )          CreationTimeStamp, LastChangedStamp;

  " composition associations: only `create` is allowed in the inline block
  association _Tasks { create; with draft; }

  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare;              " <- 'determine' keyword required, not just 'draft action'

  action approve_project result [1] $self;     " <- DO NOT remove on activation failure;
                                               "    Step 7 (generate_behavior_implementation)
                                               "    auto-creates the lhc_project skeleton and
                                               "    injects the handler in one call.

  mapping for zdm_project { … all field maps … }
}

define behavior for ZR_DM_TASK alias Task
  persistent table zdm_task
  draft table zdm_task_d
  lock dependent by _Project                   " <- not _Project of root; use the cross-BO assoc you added in roots
  etag dependent by _Project
  authorization dependent by _Project
{
  update; delete;

  field ( readonly : update ) TaskId, ProjectId;   " <- lock-by reference fields MUST be readonly
  association _Project    { with draft; }
  association _TimeEntries { create; with draft; }

  " NO draft Edit/Activate/Discard/Resume — those belong on the root only.

  mapping for zdm_task { … }
}

define behavior for ZR_DM_TIMEENTRY alias TimeEntry
  persistent table zdm_timeentry
  draft table zdm_timeentry_d
  lock dependent by _Project                   " <- not by _Task — chain must reach a `lock master`
  etag dependent by _Project
  authorization dependent by _Project
{
  update; delete;

  field ( readonly : update ) EntryId, TaskId, ProjectId;
  association _Project { with draft; }
  association _Task    { with draft; }

  mapping for zdm_timeentry { … }
}
```

If TimeEntry can only reach `_Task` and not `_Project`, you must add a **cross-BO
`association to ZR_DM_PROJECT as _Project`** in `ZR_DM_TIMEENTRY` (root view) — the lock
chain has to terminate at the entity that holds `lock master`.

#### Step 6 — Projection BDEF

Declares the behavior alias for the projection. Run 6 found that 7.58 enforces two
non-obvious syntax rules in projection BDEFs — bake them in:

1. `use draft;` at the **top** (not inside the body) when the root BDEF declared
   `with draft`. Without it, `use action Edit/Activate/Discard/Resume/Prepare` is rejected.
2. Inside `use association _X { ... }` blocks, write **bare operation names** (`create;`),
   **not** `use create;` — the `use` keyword belongs at the top level only.

Canonical projection BDEF for the root projection (managed + draft + CUD scenario):

```abap
projection;
strict ( 2 );
use draft;

define behavior for ZC_DM_PROJECT alias Project
  use etag
{
  use create;
  use update;
  use delete;

  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;
  use action approve_project;

  use association _Tasks { create; }     " <- bare 'create;' inside, NOT 'use create;'
}
```

Child projections (`ZC_DM_TASK`, `ZC_DM_TIMEENTRY`) need their own projection BDEF blocks
in the same DDLS or as separate definitions, each using
`use association _Project` / `_Task` to expose the upward composition for the lock-master
chain. Bare `create;` inside association bodies, same rule.

#### Step 7 — Generate the behavior implementation (one call, fully autonomous)

```text
SAPWrite(action="generate_behavior_implementation", type="CLAS", name="ZBP_DM_PROJECT")
```

That single call (PR-C, ARC-1 ≥ post-2026-05-10) does:

1. Reads class metadata → extracts `<class:rootEntityRef>` to auto-discover the bound
   BDEF (no need to pass `bdefName`).
2. Cross-validates that MAIN's `FOR BEHAVIOR OF zr_dm_project` and the BDEF's
   `managed implementation in class zbp_dm_project unique` agree. Refuses to mutate
   on mismatch.
3. Calls the same scaffold engine `scaffold_rap_handlers` uses, with `autoApply=true`:
   - Auto-creates missing `lhc_<alias>` skeletons (CCDEF + CCIMP).
   - Injects `METHODS …` signatures for every action / determination / validation /
     authorization the BDEF requires.
   - Injects empty `METHOD … ENDMETHOD.` stubs in CCIMP.
4. Writes CCDEF + CCIMP via the PR #257 include= path under one stateful lock.
5. Activates the class.

Returns a structured JSON report including `discovery`, `validation`, `scaffoldChanged`,
counts, and `activation.success`. If activation fails with the well-known "Local classes
of CL_ABAP_BEHAVIOR_HANDLER…" stale-active coupling, the response includes a guided
`activation.hint` with concrete recovery options instead of throwing — the just-written
CCDEF/CCIMP source remains useful for both recovery paths.

**If activation fails for any non-obvious reason**, run `SAPDiagnose(action="object_state",
type="CLAS", name="ZBP_DM_PROJECT")` (PR #254) to see active vs inactive divergence per
include before retrying. It surfaces the exact include that's out of sync without dumping
raw source.

**Lower-level alternative**: if you need to scaffold against an existing populated class
or want a dry-run-style preview without auto-activating, use `scaffold_rap_handlers`
directly with `autoApply=true|false` and `bdefName` explicit. Prefer
`generate_behavior_implementation` for fresh behavior pools.

#### Step 8 — Fill action body via `edit_method`

```text
SAPWrite(action="edit_method", type="CLAS", name="ZBP_DM_PROJECT",
         method="lhc_project~approve_project",
         source="
  METHOD approve_project.
    READ ENTITIES OF zr_dm_project IN LOCAL MODE
      ENTITY Project FIELDS ( ProjectId Status Aedat Aezet Aenam )
        WITH CORRESPONDING #( keys )
      RESULT DATA(projects).

    MODIFY ENTITIES OF zr_dm_project IN LOCAL MODE
      ENTITY Project
        UPDATE FIELDS ( Status Aedat Aezet Aenam )
        WITH VALUE #( FOR p IN projects (
          %tky    = p-%tky
          Status  = 'A'
          Aedat   = sy-datum
          Aezet   = sy-uzeit
          Aenam   = sy-uname
        ) ).

    READ ENTITIES OF zr_dm_project IN LOCAL MODE
      ENTITY Project ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(updated).

    result = VALUE #( FOR u IN updated ( %tky = u-%tky %param = u ) ).
  ENDMETHOD.",
         transport="<transport>")
```

(No `COMMIT WORK` — the framework saves automatically on action commit.)

#### Step 9 — Service definition + binding

```text
SAPWrite(action="batch_create", objects=[
  { type: "SRVD", name: "ZUI_DM_PROJECTS",
    source: "@EndUserText.label : 'Demo Project Manager (V4)'\ndefine service ZUI_DM_PROJECTS {\n  expose ZC_DM_PROJECT as Project;\n  expose ZC_DM_TASK as Task;\n  expose ZC_DM_TIMEENTRY as TimeEntry;\n}",
    package: "<target_package>", transport: "<transport>" },
  { type: "SRVB", name: "ZUI_DM_PROJECTS_O4",
    bindingType: "ODataV4-UI",
    serviceDefinition: "ZUI_DM_PROJECTS",
    package: "<target_package>", transport: "<transport>" }
])
```

> **Note:** SRVD exposes `ZC_DM_*` (projections), never `ZR_DM_*` (roots). If you exposed
> roots, the projection layer is missing — go back to Step 3.

#### Step 10 — Activate everything

```text
SAPActivate(action="activate", objects=[
  { type: "DDLS", name: "ZR_DM_PROJECT" },
  { type: "DDLS", name: "ZR_DM_TASK" },
  { type: "DDLS", name: "ZR_DM_TIMEENTRY" },
  { type: "DDLS", name: "ZC_DM_PROJECT" },
  { type: "DDLS", name: "ZC_DM_TASK" },
  { type: "DDLS", name: "ZC_DM_TIMEENTRY" },
  { type: "BDEF", name: "ZR_DM_PROJECT" },
  { type: "BDEF", name: "ZC_DM_PROJECT" },
  { type: "CLAS", name: "ZBP_DM_PROJECT" },
  { type: "SRVD", name: "ZUI_DM_PROJECTS" },
  { type: "SRVB", name: "ZUI_DM_PROJECTS_O4" }
])
```

#### Step 11 — Publish the V4 service binding

```text
SAPActivate(action="publish_srvb", name="ZUI_DM_PROJECTS_O4")
```

#### Step 12 — CONTINGENT manual step: V4 service-group registration

`publish_srvb` activates the binding at ADT level. On most 7.5x systems there are **two
runtime URL shapes** that consume the binding, and only one needs Gateway-hub registration:

| Path | Behavior on a fresh `publish_srvb` (no IWFND step) |
|---|---|
| **Gateway hub** — `http://<host>:50000/sap/opu/odata4/sap/<srvb>_o4/srvd_a2x/sap/<srvb_short>/0001/` | Returns **403** with `IWBEP/CM_V4_COS/136 — Service 'ZUI_DM_PROJECTS' repository 'SRVD_A2X' is not assigned to group 'ZUI_DM_PROJECTS_O4'`. Needs registration. |
| **SRVD-direct** — `https://<host>:50001/sap/opu/odata4/sap/<srvb>_o4/srvd/sap/<srvb>/0001/` | Returns **200** without IWFND registration — verified Run 5 + Run 6. Path segment `srvd/sap/<srvb>` (not `srvd_a2x/sap/<srvb_short>`). |

**Decision:**
1. Try the **SRVD-direct path** in Phase 7 first (no manual step). If it works, proceed —
   Step 12 becomes a no-op.
2. Only return here to do the manual step if the SRVD-direct path also fails on the
   target system, OR if the consumer (FE app, partner) is hardwired to the hub path.

If you do need the manual step, in SAP GUI:

```text
/n/IWFND/MAINT_SERVICE
  Add Service → System Alias = LOCAL → Filter "ZUI_DM_PROJECTS*" → Get Services
  Select ZUI_DM_PROJECTS_O4 → Add Selected Services → Package <target_package> → Transport <transport>

  (Or, on systems with the V4-specific transaction:)

/n/IWFND/V4_ADMIN
  → Service Group "ZUI_DM_PROJECTS_O4" → Assign SRVD_A2X service "ZUI_DM_PROJECTS"
```

Note: the hub path can return a transient **503 `CM_V4_RUNTIME/000`** ("Service alias cache
outdated") immediately after `publish_srvb`, followed by **403 `COS/136`** on the next call.
Distinct symptoms — the 503 is an alias-cache wedge, the 403 is the missing registration.
Wait a few seconds and re-test before assuming the registration is the cause.

#### Step 13 — Phase 5 → Phase 6 contract echo

Walk the artifact-list contract from Phase 5f and print every box's status:

```
=== Phase 6 contract echo ===

Roots (CDS):           [✓] ZR_DM_PROJECT  [✓] ZR_DM_TASK  [✓] ZR_DM_TIMEENTRY
Projections (CDS):     [✓] ZC_DM_PROJECT  [✓] ZC_DM_TASK  [✓] ZC_DM_TIMEENTRY
Draft tables (TABL):   [✓] ZDM_PROJECT_D  [✓] ZDM_TASK_D  [✓] ZDM_TIMEENTRY_D
BDEFs:                 [✓] ZR_DM_PROJECT (root)  [✓] ZC_DM_PROJECT (projection)
Behavior pool (CLAS):  [✓] ZBP_DM_PROJECT (with lhc_project, lhc_task, lhc_timeentry skeletons)
                       [✓] approve_project handler stub injected via scaffold_rap_handlers
                       [✓] approve_project body filled via edit_method
Service definition:    [✓] ZUI_DM_PROJECTS (exposes 3 projections)
Service binding:       [✓] ZUI_DM_PROJECTS_O4 (published at ADT level)

Manual steps remaining:
  [✗ — waiting on user] /IWFND/MAINT_SERVICE V4 group registration
```

If any box is `✗` and not waived, **do not advance to Phase 7**. Either fix or escalate to
the user.


---

## Phase 7 — Side-by-side smoke test

Verify the new V4 service returns the same data as the legacy V2.

### 7a. Legacy V2 baseline

```bash
curl -u "$USER:$PASS" "<base>/sap/opu/odata/sap/<legacy_service>/ProjectSet/\$count"
# expect: 5
curl -u "$USER:$PASS" "<base>/sap/opu/odata/sap/<legacy_service>/ProjectSet('PRJ-0001')/Tasks/\$count"
# expect: 3
```

### 7b. New V4 — pick the URL shape that works

Try both in parallel. The SRVD-direct path usually works without the Step 12 manual
registration; the Gateway hub path requires it.

```bash
# SRVD-direct (HTTPS, port 50001, /srvd/sap/<srvb>/ path) — preferred, no Step 12 needed
NEW_BASE_DIRECT="https://<host>:50001/sap/opu/odata4/sap/zui_dm_projects_o4/srvd/sap/zui_dm_projects_o4/0001"

# Gateway hub (HTTP, port 50000, /srvd_a2x/sap/<srvb_short>/ path) — needs Step 12
NEW_BASE_HUB="<base>/sap/opu/odata4/sap/zui_dm_projects_o4/srvd_a2x/sap/zui_dm_projects/0001"

# Smoke-test the SRVD-direct path first
curl -s -o /dev/null -w "%{http_code}\n" -u "$USER:$PASS" \
  "$NEW_BASE_DIRECT/Project?\$top=1&sap-client=001"
# 200 = good; 403 = check Gateway hub registration; 503 = transient alias cache, retry
```

Pick whichever path returned 200, then use it for the rest of Phase 7. Pin the working
URL into RUN-NOTES for the demo.

### 7c. Draft V4 keying — non-obvious

For a service generated from a **managed-with-draft** BDEF, the entity keys exposed in
`$metadata` are **composite**: every primary key field PLUS `IsActiveEntity` (Edm.Boolean).
Bare `Project('PRJ-0001')` returns **400**; the correct form is:

```bash
NEW_BASE="$NEW_BASE_DIRECT"   # or $NEW_BASE_HUB after Step 12

# Counts — same as legacy V2 if the migration is byte-equivalent
curl -u "$USER:$PASS" "$NEW_BASE/Project/\$count?sap-client=001"
# expect: 5

# Composite key — note ProjectId AND IsActiveEntity, not just ProjectId
curl -u "$USER:$PASS" \
  "$NEW_BASE/Project(ProjectId='PRJ-0001',IsActiveEntity=true)/_Tasks/\$count?sap-client=001"
# expect: 3
```

Filter the active row set explicitly via `?$filter=IsActiveEntity eq true` if you want
parity with legacy V2's no-draft semantics.

### 7d. Action invocation — CSRF + If-Match required

V4 bound actions on draft entities need **both** `X-CSRF-Token` (with session cookies) and
`If-Match: <etag>`. Missing `If-Match` returns **428 `CX_OD_PRECOND_REQUIRED`**.

```bash
# 1. Fetch CSRF token + session cookies
curl -s -u "$USER:$PASS" -c /tmp/cookies.txt \
     -H "X-CSRF-Token: Fetch" \
     "$NEW_BASE/?sap-client=001" -D - -o /dev/null | grep -i 'x-csrf-token'

# 2. Get the current etag for the target row
ETAG=$(curl -s -u "$USER:$PASS" -b /tmp/cookies.txt \
       "$NEW_BASE/Project(ProjectId='PRJ-0003',IsActiveEntity=true)?sap-client=001" \
       -D - -o /dev/null | grep -i 'etag' | awk '{print $2}' | tr -d '\r')

# 3. POST the action with both headers
curl -u "$USER:$PASS" -b /tmp/cookies.txt -X POST \
     "$NEW_BASE/Project(ProjectId='PRJ-0003',IsActiveEntity=true)/com.sap.gateway.srvd.zui_dm_projects.v0001.approve_project?sap-client=001" \
     -H "Content-Type: application/json" \
     -H "X-CSRF-Token: <from step 1>" \
     -H "If-Match: $ETAG" \
     -d '{}'
# expect: 200 + entity with Status="A"
```

If counts don't match, the CDS where-clauses are likely wrong — re-read the legacy DPC_EXT
methods for filters you missed. If actions fail with 412/428 even with both headers, the
service likely needs a fresh `publish_srvb` to pick up newer BDEF action declarations.


---

## Reset / re-run

Re-run this skill — Phase 6a deletes everything in `<target_package>` first, so multiple runs
are safe. Transport `<transport>` stays in `D` (modifiable) state until you explicitly release
it. To clear the transport too:

```text
SAPTransport(action="release_recursive", number="<transport>")
SAPTransport(action="create", description="ARC-1 RAP migration outputs (resettable)", transportType="K")
```

…then update the transport ID in this skill's smart defaults.

---

## Error handling

| Symptom | Likely cause | Fix |
|---|---|---|
| Phase 0 — `rap.available=false` | System release < 7.54 OR ABAP-Cloud-mode disabled | Migration cannot proceed; tell user |
| Phase 0 — preflight DDLS create returns 403 | `S_DEVELOP` ACTVT=01,02 missing for DDLS in target package | User runs SU53 in SAP GUI; basis admin grants role |
| Phase 1 — MPC class not found by convention | Service uses non-standard naming or is in a sub-package | Fall back to TADIR query (1a alt path) |
| Phase 2 — `DEFINE_<entity>` body uses helper methods you can't parse | SEGW uses `define_<entity>_property_<n>(...)` calls | Read those helper methods too — `SAPRead method="DEFINE_PROJECT_PROPERTY_1"` |
| Phase 3 — `EXECUTE_ACTION` body has multiple `IF iv_action_name = 'X'` branches | One DPC_EXT, multiple function imports | Translate each branch to a separate BDEF action |
| Phase 6 — activation fails with "released-API contract violation" | Legacy DPC_EXT used unreleased ABAP API; CDS where-clause inherits the same | Replace with released equivalent (use `mcp__sap-docs__search` to look up modern API) |
| Phase 6 — `scaffold_rap_handlers` returns 0 missing methods | Activation order inverted | Activate BDEF before scaffolding the behavior pool — `scaffold_rap_handlers` reads activated BDEF |
| Phase 7 — V4 `Project/$count` differs from V2 `ProjectSet/$count` | CDS view has implicit filter (e.g. `WHERE delivered_status <> 'X'`) you forgot | Re-read `DEFINE_PROJECT` for any `set_filter_*` calls in MPC |
| Phase 7 — V4 `_Tasks` returns empty | Composition wrong direction or missing referential constraint | Inspect `ZR_DM_PROJECT` source; the `composition of` clause must reference the child by FK |
| Phase 7 — V4 endpoint returns 403 with `IWBEP/CM_V4_COS/136 … not assigned to group` | Skipped Phase 6 Step 12 (V4 routing-group registration) | User runs `/n/IWFND/MAINT_SERVICE` Add Service for `ZUI_DM_PROJECTS_O4` |
| Phase 6 Step 5 — BDEF activation rejects `association _X { update; delete; }` | Only `create` is allowed in association inline block | Remove `update`/`delete` from association blocks; the child entity's own behavior block declares them |
| Phase 6 Step 5 — BDEF rejects `draft action Prepare` | Must be `draft determine action Prepare` (the `determine` keyword is mandatory) | Fix to `draft determine action Prepare` |
| Phase 6 Step 5 — BDEF rejects child entity `Edit/Activate/Discard/Resume` declarations | Draft lifecycle actions belong on the root only (the entity with `lock master`) | Move them to root; children only need composition associations + `update;`/`delete;` |
| Phase 6 Step 5 — BDEF rejects `with draft` without `total etag` | RAP requires a total etag field when draft is on | Add `total etag CreationTimeStamp` (or your timestamp field) to the root behavior |
| Phase 6 Step 5 — BDEF rejects child `lock dependent by _Task` if `_Task` itself has no `lock master` | Lock chain must terminate at a `lock master` entity | Add cross-BO `association to ZR_DM_<root> as _Project` in the grandchild root view, and use `lock dependent by _Project` in the BDEF |
| Phase 6 Step 5 — BDEF rejects child entity `ProjectId` updates when used in `lock dependent by _Project` | Lock-by reference fields must be readonly | Add `field ( readonly : update ) <field>` to the child behavior block |
| Phase 6 Step 5 — BDEF rejects `strict ( 2 )` without `authorization` on every entity | `strict ( 2 )` enforces explicit auth declarations | Add `authorization master ( instance )` on root, `authorization dependent by _Project` on children. Step 7 (`generate_behavior_implementation`) auto-creates the matching `lhc_<alias>` skeletons and injects the `get_instance_authorizations` stub — no manual pre-create required. **Do NOT** drop `strict ( 2 )` as the workaround. |
| Phase 6 Step 7 — `generate_behavior_implementation` returns `activation: { success: false, hint: <stale-active recovery> }` | The well-known stale-active CCDEF/CCIMP coupling: active includes are SAP placeholder comments while inactive includes now contain real handlers, and RAP refuses the inactive→active transition. | Two recovery options in the hint: (a) activate the class once via Eclipse "Generate Behavior Implementation" wizard (it bypasses the coupling), or (b) `SAPManage(action="delete", type="CLAS")` + `SAPWrite(action="create")` + rerun `generate_behavior_implementation` against the freshly created class. The just-written CCDEF/CCIMP source is correct in either path. |
| Phase 6 — CDS rejects `composition [0..*] of <child> as <name> on …` | Managed compositions don't take an `on` clause; key linking is implicit / via `with foreign key` in the child | Remove the `on` clause; do NOT switch to `association to` |
| Phase 6 — CDS rejects `provider contract transactional_interface` on root view | The contract is only valid on projection views (`ZC_DM_*`) | This error means you're missing the projection layer — create the `ZC_DM_*` projection (Step 3) and put the contract there |
| Phase 6 — CDS rejects `tstmp_from_dat_tim(...)` | Function name wrong | Use `dats_tims_to_tstmp(...)` (note the order: `dats` first, `tims` second) |
| Phase 6 — Batch activate emits `ED 064 — "no next/previous object found"` warning | Benign batch-activate quirk in 7.58 | Ignore the warning; if all objects show `active`, batch succeeded. If a real error mixed in, retry with single-object activate. |
| Phase 6a — `SAPWrite create` returns "object exists" but Phase 6a reset showed empty package | Object exists in a different transport, not the target package | Query TADIR for the name across all packages: `SAPQuery sql="SELECT * FROM tadir WHERE obj_name = '<name>'"`. If found, delete it first using its actual transport, then retry create. |
| Phase 6 Step 2/3 — CDS rejects `@Semantics.systemDateTime.localInstanceLastChangedAt` or `@Semantics.businessDate.*` as "unknown annotation" | These annotations were added in 7.59+; on 7.58 they don't exist | Use `@Semantics.systemDateTime.createdAt` / `@Semantics.systemDateTime.lastChangedAt` (without `localInstance`). For business dates: just use `@Semantics.businessDate.from/to` if available, else omit. |
| Phase 6 Step 3 — CDS rejects "inappropriate provider contract on `ZC_DM_<child>`" | `provider contract transactional_interface` was put on a child projection | Remove the contract from `ZC_DM_TASK` / `ZC_DM_TIMEENTRY`. The contract goes only on the *root* projection (`ZC_DM_PROJECT`). Children declare bare `as projection on …` and use `redirected to parent` for upward navigation. |
| Phase 6 Step 5 — BDEF activation rejects with `"key field PROJECTID expected at position 2, found PROJECT_ID"` (or similar field-name mismatch on a draft table) | Draft table was written with snake_case field names (`project_id`, `start_date`) instead of the BO-alias-normalized names (`projectid`, `startdate`) | Rewrite the draft TABL with field names matching the BO aliases: drop underscores. Active table can keep snake_case (BDEF mapping bridges); draft table cannot. Use `update + activate` via SAPWrite — Run 2 confirmed this works. |
| Phase 6a — `SAPQuery` returns HTTP 400 on a long `WHERE obj_name IN ('a','b','c',…)` filter | ARC-1 ≥ 0.10.0 auto-chunks simple long `IN (…)` literal lists (PR #254). Older builds and complex filters (`NOT IN`, multi-SELECT, subqueries) still hit 400. | Prefer `SAPSearch(searchType="tadir_lookup", source="both", names=[...])` for cross-package existence checks (PR #256 + PR #270) — no SQL needed; the `splitBrain` warning array surfaces ADT/DB divergence in one call. As broader-sweep fallback, `SAPQuery` with `devclass = '<package>'`. |

---

## Notes

- This skill **never touches** the legacy source package, the legacy SEGW project, or its
  transport. The migration runs side-by-side; legacy stays live until the user explicitly
  retires it.
- Use `mcp__sap-docs__search` whenever the legacy DPC_EXT body contains an unfamiliar API call —
  it'll tell you the released-cloud equivalent.
- Use `mcp__sap-docs__abap_feature_matrix` to check which RAP features are available on the
  user's release (e.g. `etag master`, `unmanaged save`, `lock master`).
- `generate-rap-service-researched.md` is the canonical creator. This skill's job is the
  *discovery + translation*; delegating the actual create+activate to the deeper skill keeps
  this one focused.
