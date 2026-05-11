# Generate RAP OData UI Service

Generate a complete RAP OData UI service from a natural language description of a business object. Creates the full artifact stack: database table, CDS views, behavior definitions, metadata extension, service definition, and behavior pool class.

This skill replicates SAP Joule's "RAP Service Generation" capability by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices).

**v1 Guardrails** (fast path): managed scenario only, UUID internal early numbering, single root entity by default, standard CRUD first, draft optional, OData V4 preferred. For multi-entity compositions or heavy custom actions, prefer `generate-rap-service-researched`.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Package | User's Z* package with transport | Production-ready; only use `$TMP` if user explicitly asks |
| Key strategy | UUID (`sysuuid_x16`), managed numbering | Simplest, no collision risk |
| Behavior scenario | Managed | Framework handles CRUD |
| OData version | V4 | Current SAP standard |
| Draft | Prefer for transactional Fiori Elements UI services; verify against release/constraints | Best default for editable FE apps, but not every RAP service needs draft |
| Admin fields | `syuname`/`timestampl` (on-prem) or `abp_*` types (BTP) | System-appropriate |
| Strict mode | `strict ( 2 )` unless system patterns or SAP constraints justify otherwise | Current RAP best practice, but not universal |
| Entity prefix | `Z` + entity name (e.g., `ZTRAVEL`) | SAP standard Z namespace |
| Naming | SAP standard: `ZI_`, `ZC_`, `ZSD_`, `ZSB_`, `ZBP_I_` | Consistent with SAP docs |
| Service exposure | OData V4 UI provider contract by default | Best fit for Fiori Elements unless the use case is API-first |

## Input

The user provides a natural language description of the business object (e.g., "a travel booking app with fields for agency, customer, destination, begin/end date, total price, currency, status").

Only the **business object description** is required. If the user provides just a description, apply Smart Defaults and proceed immediately.

Optionally, the user may specify:
- **Entity name prefix** (default: auto-generate from description)
- **Package** (required — ask if not provided; only default to `$TMP` if user explicitly says so)
- **Transport request** (only needed for non-`$TMP` packages — see Step 1b)
- **Draft enabled** (default: yes on BTP, no on-prem)
- **OData version** (default: V4)

## Step 1: Check System Capabilities

Verify the SAP system supports RAP/CDS and detect the system type.

```
SAPManage(action="probe")
```

If you need a firmer baseline for syntax and formatter behavior, also read:

```
SAPRead(type="SYSTEM")
SAPLint(action="list_rules")
SAPLint(action="get_formatter_settings")
```

**Critical gate:** If probe clearly reports RAP/CDS unavailable, stop and tell the user RAP object creation cannot proceed via ARC-1 until the endpoint/system setup is fixed.

Determine BTP vs on-prem — this affects naming conventions, language version, and draft handling.

### Step 1b: Resolve Package and Transport

Ask the user for their target package if not provided. Then resolve the transport request (skip only if package is `$TMP`):

```
SAPTransport(action="check", objectType="DDLS", objectName="<first_object_name>", package="<package>")
```

This checks if a transport is required and returns existing transports for the package. If a transport is required:

1. **User provided a transport**: Use it for all creates
2. **Existing transport found**: Present the list and ask the user to pick one
3. **No transport available**: Create one:
   ```
   SAPTransport(action="create", description="RAP Service: <Entity>", package="<package>")
   ```

**If transport is required but unavailable, STOP** — all write operations will fail without a valid transport for non-`$TMP` packages.

If the package does not exist yet and the user wants a new one, create it first:

```
SAPManage(action="create_package", name="<package>", description="<description>", transport="<transport_if_required>")
```

### BTP vs On-Prem Differences

| Aspect | BTP (ABAP Cloud) | On-Prem (ABAP Platform) |
|---|---|---|
| Namespace | Z*/Y* only | Z*/Y* or customer namespace |
| Language version | ABAP for Cloud Development (strict) | Standard ABAP or ABAP for Cloud |
| Draft tables | Must be explicitly created (framework manages data, not table) | Must be explicitly created |
| OData version | V4 preferred | V2 or V4 |
| Behavior pool | `ABSTRACT` class, ABAP Cloud only | `ABSTRACT` class, classic ABAP allowed |
| Table entity | `DEFINE TABLE ENTITY` DDL syntax | Classic DDIC table (SE11) or table entity |

### On-Prem 7.5x Fast Guardrails

- In TABL source, use `syuname` + `timestampl` (not `abap.uname` / `abap.utclong`).
- Use `abap.char(1)` for boolean-like flags in TABL (not `abap.boolean`).
- Every `abap.curr(...)` field needs `@Semantics.amount.currencyCode` above it.
- Keep projection BDEF header as `projection;` (do not add `use etag` header lines).
- Keep RAP preflight checks enabled (default) so deterministic TABL/BDEF/DDLX issues are blocked before activation churn. Only use `preflightBeforeWrite=false` as a local escape hatch.
- If behavior-pool full-class writes fail with generic save errors, use `SAPWrite(action="scaffold_rap_handlers", ...)` first to derive/apply signatures, then use quickfix fallback + `SAPWrite(action="edit_method")` for method bodies.

## Step 2: Design the Data Model

Based on the user's description, design the complete artifact stack. Follow SAP naming conventions:

### Naming Conventions

| Artifact | Pattern | Example |
|---|---|---|
| Database table (table entity) | `Z<ENTITY>_D` | `ZTRAVEL_D` |
| Interface CDS view | `ZI_<Entity>` | `ZI_TRAVEL` |
| Projection CDS view | `ZC_<Entity>` | `ZC_TRAVEL` |
| Metadata extension | `ZC_<Entity>` | `ZC_TRAVEL` |
| Interface behavior definition | `ZI_<Entity>` | `ZI_TRAVEL` |
| Projection behavior definition | `ZC_<Entity>` | `ZC_TRAVEL` |
| Access control (DCL) | `ZI_<Entity>_DCL` | `ZI_TRAVEL_DCL` |
| Service definition | `ZSD_<Entity>` | `ZSD_TRAVEL` |
| Service binding | `ZSB_<Entity>_V4` | `ZSB_TRAVEL_V4` |
| Behavior pool class | `ZBP_I_<Entity>` | `ZBP_I_TRAVEL` |
| Draft table (if draft) | `Z<ENTITY>_DD` | `ZTRAVEL_DD` |

### Field Design Rules

Every entity gets these standard fields:

| Field | Type | Purpose |
|---|---|---|
| `key_uuid` | `sysuuid_x16` | UUID primary key (internal early numbering) |
| `created_by` | `syuname` / `abp_creation_user` | Admin: created by |
| `created_at` | `timestampl` / `abp_creation_tstmpl` | Admin: created at |
| `last_changed_by` | `syuname` / `abp_locinst_lastchange_user` | Admin: last changed by |
| `last_changed_at` | `timestampl` / `abp_locinst_lastchange_tstmpl` | Admin: last changed at (local instance) |
| `local_last_changed_at` | `timestampl` / `abp_lastchange_tstmpl` | Admin: total ETag field |

Add business fields based on user description. Choose appropriate ABAP types:
- Text: `abap.char(N)` or `abap.sstring(N)`
- Amount: `abap.curr(15,2)` with a currency code field (`abap.cuky(5)`)
- Date: `abap.dats`
- Status: `abap.char(1)` with fixed values
- Quantity: `abap.quan(13,3)` with a unit field (`abap.unit(3)`)
- Integer: `abap.int4`

### Output to User

Present the complete design as a table:

```
Proposed artifact stack for "Travel Booking":

| # | Type | Name | Description |
|---|------|------|-------------|
| 1 | TABL | ZTRAVEL_D | Database table entity |
| 2 | DDLS | ZI_TRAVEL | Interface CDS view entity |
| 3 | DCLS | ZI_TRAVEL_DCL | CDS access control (authorization rules) |
| 4 | BDEF | ZI_TRAVEL | Interface behavior definition |
| 5 | DDLS | ZC_TRAVEL | Projection CDS view entity |
| 6 | BDEF | ZC_TRAVEL | Projection behavior definition |
| 7 | DDLX | ZC_TRAVEL | Metadata extension (UI annotations) |
| 8 | SRVD | ZSD_TRAVEL | Service definition |
| 9 | CLAS | ZBP_I_TRAVEL | Behavior pool class |
| 10 | SRVB | ZSB_TRAVEL_V4 | Service binding |

Fields: key_uuid, agency_id, customer_id, destination, begin_date, end_date,
        total_price, currency_code, status, created_by, created_at,
        last_changed_by, last_changed_at, local_last_changed_at
```

Ask the user: **"Should I proceed with this design? (yes / modify fields / change names)"**

## Step 3: (Optional) Research RAP Patterns

If mcp-sap-docs is available, fetch current RAP best practices. Start with reference-style queries (`includeSamples=false`) and then use examples (`includeSamples=true`) only where needed:

```
search(query="RAP projection BO vs RAP BO interface", includeSamples=false, abapFlavor="<cloud|standard>")
```

```
search(query="RAP draft handling total etag draft-enabled associations", includeSamples=false, abapFlavor="<cloud|standard>")
```

```
search(query="service definition provider contracts odata_v4_ui odata_v4_webapi", includeSamples=false, abapFlavor="<cloud|standard>")
```

```
search(query="metadata-driven UI metadata extension RAP Fiori Elements", includeSamples=false, abapFlavor="<cloud|standard>")
```

Use the returned documentation to inform correct annotation patterns, draft handling, provider contracts, and behavior definition syntax.

## Batch Creation (Preferred)

Instead of creating each artifact individually in Steps 4-13, you can use batch creation to create all RAP artifacts in a single tool call:

```
SAPWrite(action="batch_create", objects=[
  {type: "TABL", name: "<table_name>", description: "<Entity> Table", source: "<table_ddl>"},
  {type: "DDLS", name: "ZI_<entity>", description: "<Entity> Interface View", source: "<interface_view_ddl>"},
  {type: "DCLS", name: "ZI_<entity>_DCL", description: "<Entity> Access Control", source: "<interface_dcl_source>"},
  {type: "DDLS", name: "ZC_<entity>", description: "<Entity> Projection View", source: "<projection_view_ddl>"},
  {type: "BDEF", name: "ZI_<entity>", description: "<Entity> Interface Behavior", source: "<interface_bdef>"},
  {type: "BDEF", name: "ZC_<entity>", description: "<Entity> Projection Behavior", source: "<projection_bdef>"},
  {type: "DDLX", name: "ZC_<entity>", description: "<Entity> Metadata Extension", source: "<ddlx_source>"},
  {type: "SRVD", name: "ZSD_<entity>", description: "<Entity> Service Definition", source: "<srvd_source>"},
  {type: "CLAS", name: "ZBP_I_<entity>", description: "<Entity> Behavior Pool", source: "<class_source>"},
  {type: "SRVB", name: "ZSB_<entity>_V4", description: "<Entity> Service Binding", serviceDefinition: "ZSD_<entity>", bindingType: "ODataV4-UI"}
], package="<package>", transport="<transport>")
```

Objects are created and activated in array order — put dependencies first (table before CDS views, DCLS after DDLS, CDS views before BDEFs, behavior pool before interface BDEF). The batch stops on the first failure and reports which objects succeeded and which failed.

Set `package` and `transport` at the top level when every artifact shares them. If a batch item needs to override either value, put `package` and/or `transport` on that object; item-level values win.

**Pass `activateAtEnd: true` for stacks with cross-sibling references** (e.g. composition-linked DDLS where the parent's `composition [0..*] of ZR_CHILD` references a child that's also in this batch). ARC-1 writes inactive drafts for every object and then issues one terminal `activateBatch` — SAP's activator sees the whole graph and resolves the cross-references in a single pass. Without this flag, the parent's inline activation fails with `"data source ZR_CHILD does not exist or is not active"`.

If batch creation fails, fall back to the sequential approach below (Steps 4-13).

## Step 4: Create Database Table (Sequential Fallback)

Create the table entity via CDS DDL.

```
SAPWrite(action="create", type="TABL", name="<table_name>", package="<package>", transport="<transport>", source="<ddl_source>")
```

### Table Entity DDL Template

```cds
@EndUserText.label : '<Entity description>'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table <table_name> {
  key client            : abap.clnt not null;
  key key_uuid          : sysuuid_x16 not null;
  <business_field_1>    : <type>;
  <business_field_2>    : <type>;
  // ... more business fields
  created_by            : syuname;
  created_at            : timestampl;
  last_changed_by       : syuname;
  last_changed_at       : timestampl;
  local_last_changed_at : timestampl;
}
```

Activate the table:

```
SAPActivate(type="TABL", name="<table_name>")
```

**Fallback**: If table entity creation fails (e.g., on older on-prem systems), instruct the user to create the table manually via SE11 or ADT, providing the field list and types.

## Step 5: Create Interface CDS View

```
SAPWrite(action="create", type="DDLS", name="ZI_<entity>", package="<package>", transport="<transport>", source="<ddl_source>")
```

### Interface View DDL Template

```cds
@AccessControl.authorizationCheck: #MANDATORY
@EndUserText.label: '<Entity description>'
define root view entity ZI_<Entity>
  as select from <table_name>
{
  key key_uuid              as KeyUuid,
      <business_field_1>    as <CamelCaseAlias1>,
      <business_field_2>    as <CamelCaseAlias2>,
      // ... more business fields

      @Semantics.amount.currencyCode: 'CurrencyCode'
      total_price            as TotalPrice,
      currency_code          as CurrencyCode,

      @Semantics.user.createdBy: true
      created_by             as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at             as CreatedAt,
      @Semantics.user.localInstanceLastChangedBy: true
      last_changed_by        as LastChangedBy,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at  as LocalLastChangedAt,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at        as LastChangedAt
}
```

Activate:

```
SAPActivate(type="DDLS", name="ZI_<entity>")
```

## Step 5a: Create Interface Access Control (DCLS)

Create a basic CDS access control role for the interface view.

```
SAPWrite(action="create", type="DCLS", name="ZI_<entity>_DCL", package="<package>", transport="<transport>", source="<dcl_source>")
```

### Interface DCL Template

```dcl
@EndUserText.label: '<Entity description> Access Control'
@MappingRole: true
define role ZI_<Entity>_DCL {
  grant select on ZI_<Entity>
    where inheriting conditions from super;
}
```

Activate:

```
SAPActivate(type="DCLS", name="ZI_<entity>_DCL")
```

## Step 5b: Create Draft Table (if draft enabled)

If draft is enabled, create the draft table entity before creating the behavior definition that references it. The RAP framework manages runtime persistence of draft data to this table, but the table itself must be created explicitly.

```
SAPWrite(action="create", type="TABL", name="<draft_table>", package="<package>", transport="<transport>", source="<ddl_source>")
```

### Draft Table Entity DDL Template

```cds
@EndUserText.label : '<Entity description> - Draft'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table <draft_table> {
  key client            : abap.clnt not null;
  key key_uuid          : sysuuid_x16 not null;
  <business_field_1>    : <type>;
  <business_field_2>    : <type>;
  // ... same business fields as the main table
  created_by            : syuname;
  created_at            : timestampl;
  last_changed_by       : syuname;
  last_changed_at       : timestampl;
  local_last_changed_at : timestampl;
}
```

Activate the draft table:

```
SAPActivate(type="TABL", name="<draft_table>")
```

**Note**: On BTP ABAP Environment, the draft table must still be explicitly created — the framework manages draft data persistence at runtime, not the table's existence.

## Step 6: Create Interface Behavior Definition

```
SAPWrite(action="create", type="BDEF", name="ZI_<entity>", package="<package>", transport="<transport>", source="<bdef_source>")
```

### With Draft

```
managed implementation in class ZBP_I_<Entity> unique;
strict ( 2 );
with draft;

define behavior for ZI_<Entity> alias <Entity>
persistent table <table_name>
draft table <draft_table>
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( instance )
{
  field ( readonly )
    KeyUuid,
    CreatedBy,
    CreatedAt,
    LastChangedBy,
    LastChangedAt,
    LocalLastChangedAt;

  field ( numbering : managed )
    KeyUuid;

  create;
  update;
  delete;

  draft action Resume;
  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft determine action Prepare;
}
```

### Without Draft

```
managed implementation in class ZBP_I_<Entity> unique;
strict ( 2 );

define behavior for ZI_<Entity> alias <Entity>
persistent table <table_name>
etag master LocalLastChangedAt
lock master
authorization master ( instance )
{
  field ( readonly )
    KeyUuid,
    CreatedBy,
    CreatedAt,
    LastChangedBy,
    LastChangedAt,
    LocalLastChangedAt;

  field ( numbering : managed )
    KeyUuid;

  create;
  update;
  delete;
}
```

Do NOT activate the interface BDEF individually — it references the behavior pool class (ZBP_I_<Entity>) which does not exist yet. It will be activated in the batch activation step after the class is created.

## Step 7: Create Projection CDS View

```
SAPWrite(action="create", type="DDLS", name="ZC_<entity>", package="<package>", transport="<transport>", source="<ddl_source>")
```

### Projection View DDL Template

```cds
@AccessControl.authorizationCheck: #MANDATORY
@EndUserText.label: '<Entity description> - Projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_<Entity>
  provider contract transactional_query
  as projection on ZI_<Entity>
{
  key KeyUuid,

      @Search.defaultSearchElement: true
      <BusinessField1>,
      @Search.defaultSearchElement: true
      <BusinessField2>,
      // ... more business fields

      TotalPrice,
      CurrencyCode,

      CreatedBy,
      CreatedAt,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt
}
```

Mark the most important business fields (typically name, ID, description) with `@Search.defaultSearchElement: true`.

Activate:

```
SAPActivate(type="DDLS", name="ZC_<entity>")
```

## Step 8: Create Projection Behavior Definition

```
SAPWrite(action="create", type="BDEF", name="ZC_<entity>", package="<package>", transport="<transport>", source="<bdef_source>")
```

### With Draft

```
projection;
strict ( 2 );
use draft;

define behavior for ZC_<Entity> alias <Entity>
{
  use create;
  use update;
  use delete;

  use action Resume;
  use action Edit;
  use action Activate;
  use action Discard;
  use action Prepare;
}
```

### Without Draft

```
projection;
strict ( 2 );

define behavior for ZC_<Entity> alias <Entity>
{
  use create;
  use update;
  use delete;
}
```

Do NOT activate the projection BDEF individually — it uses `use create`, `use update`, `use delete` which reference the interface BDEF (ZI_<Entity>), and that BDEF is not yet activated. It will be activated in the batch activation step after all artifacts are created.

## Step 9: Create Metadata Extension (DDLX)

```
SAPWrite(action="create", type="DDLX", name="ZC_<entity>", package="<package>", transport="<transport>", source="<ddlx_source>")
```

### Metadata Extension Template

```cds
@Metadata.layer: #CUSTOMER
@UI: {
  headerInfo: {
    typeName: '<Entity Name>',
    typeNamePlural: '<Entity Name Plural>',
    title: { type: #STANDARD, value: '<MainBusinessField>' },
    description: { type: #STANDARD, value: '<SecondaryField>' }
  }
}
annotate view ZC_<Entity> with
{
  @UI.facet: [
    {
      id: 'idIdentification',
      type: #IDENTIFICATION_REFERENCE,
      label: 'General Information',
      position: 10
    }
  ]

  @UI.hidden: true
  KeyUuid;

  @UI: {
    lineItem: [{ position: 10, importance: #HIGH }],
    identification: [{ position: 10 }],
    selectionField: [{ position: 10 }]
  }
  <BusinessField1>;

  @UI: {
    lineItem: [{ position: 20, importance: #HIGH }],
    identification: [{ position: 20 }],
    selectionField: [{ position: 20 }]
  }
  <BusinessField2>;

  // ... more business fields with incrementing positions

  @UI: {
    lineItem: [{ position: 50, importance: #MEDIUM }],
    identification: [{ position: 50 }]
  }
  TotalPrice;

  @UI.hidden: true
  CreatedBy;

  @UI.hidden: true
  CreatedAt;

  @UI.hidden: true
  LastChangedBy;

  @UI.hidden: true
  LastChangedAt;

  @UI.hidden: true
  LocalLastChangedAt;
}
```

Position numbering: increment by 10. Assign `importance: #HIGH` to the most relevant business fields (shown in narrow screens), `#MEDIUM` for secondary fields. Add `@UI.selectionField` to fields the user would filter by.

Activate:

```
SAPActivate(type="DDLX", name="ZC_<entity>")
```

## Step 10: Create Service Definition

```
SAPWrite(action="create", type="SRVD", name="ZSD_<entity>", package="<package>", transport="<transport>", source="<srvd_source>")
```

### Service Definition Template

```cds
@EndUserText.label: '<Entity description> Service'
define service ZSD_<Entity>
  provider contracts odata_v4_ui
{
  expose ZC_<Entity> as <Entity>;
}
```

If the primary consumer is an API/integration use case rather than Fiori Elements, switch the provider contract and binding type together:

```cds
define service ZSD_<Entity>
  provider contracts odata_v4_webapi
{
  expose ZC_<Entity> as <Entity>;
}
```

Activate:

```
SAPActivate(type="SRVD", name="ZSD_<entity>")
```

## Step 11: Create Behavior Pool Class

Create the behavior pool class BEFORE batch activation — the interface BDEF references this class via `implementation in class ZBP_I_<Entity>`.

Before writing, optionally run the SAP PrettyPrinter so the class source matches the system's keyword style and indentation:

```
SAPLint(action="format", source="<class_source>", name="ZBP_I_<entity>")
```

```
SAPWrite(action="create", type="CLAS", name="ZBP_I_<entity>", package="<package>", transport="<transport>", source="<class_source>")
```

### Behavior Pool Class Template

```abap
CLASS zbp_i_<entity> DEFINITION
  PUBLIC ABSTRACT FINAL
  FOR BEHAVIOR OF zi_<entity>.
ENDCLASS.

CLASS zbp_i_<entity> IMPLEMENTATION.
ENDCLASS.
```

Activate:

```
SAPActivate(type="CLAS", name="ZBP_I_<entity>")
```

## Step 12: Batch Activate All Artifacts

First, optionally check for any lingering inactive objects that might interfere:

```
SAPRead(type="INACTIVE_OBJECTS")
```

**Note:** This may return 404 on some systems where the `/sap/bc/adt/activation/inactive` endpoint is not available. If so, skip this check and proceed.

Activate all artifacts together to resolve cross-dependencies:

```
SAPActivate(objects=[
  {type:"TABL", name:"<table_name>"},
  {type:"DDLS", name:"ZI_<entity>"},
  {type:"DCLS", name:"ZI_<entity>_DCL"},
  {type:"CLAS", name:"ZBP_I_<entity>"},
  {type:"BDEF", name:"ZI_<entity>"},
  {type:"DDLS", name:"ZC_<entity>"},
  {type:"BDEF", name:"ZC_<entity>"},
  {type:"DDLX", name:"ZC_<entity>"},
  {type:"SRVD", name:"ZSD_<entity>"}
])
```

**Note:** Activation returns structured responses with detailed error/warning messages including line numbers and URIs. Errors block activation; warnings allow it but should be reviewed.

If batch activation fails, activate sequentially in dependency order:
1. Table entity
2. Interface CDS view
3. Interface access control (DCLS)
4. Behavior pool class
5. Interface behavior definition
6. Projection CDS view
7. Projection behavior definition
8. Metadata extension
9. Service definition

If behavior pool activation fails because `METHODS ... FOR ...` signatures are missing:
- Use `SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="<bp_class>", bdefName="ZI_<entity>")` to list missing signatures.
- If needed, rerun with `autoApply=true` to inject signatures into class declarations plus empty method stubs.
- If signatures are still unresolved, use `SAPDiagnose(action="quickfix", ...)` and `SAPDiagnose(action="apply_quickfix", ...)` when proposals are available.
- Fallback to ADT editor quick-fix generation, then patch method bodies with `SAPWrite(action="edit_method", ...)`.

For any failing object, run syntax check to identify the issue:

```
SAPDiagnose(action="syntax", type="<type>", name="<name>")
```

## Step 13: Create and Publish Service Binding

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

⚠️ **CHECKPOINT**: Verify the SRVB read shows `published: true`, the expected binding type, and a service URL. For OData V4 bindings, publish/unpublish applies to the whole binding.

## Step 14: Verify Complete Service

Read back key artifacts and run final checks:

```
SAPRead(type="DDLS", name="ZI_<entity>")
SAPRead(type="DCLS", name="ZI_<entity>_DCL")
SAPRead(type="BDEF", name="ZI_<entity>")
SAPRead(type="DDLS", name="ZC_<entity>")
SAPDiagnose(action="syntax", type="CLAS", name="ZBP_I_<entity>")
```

Present a summary checklist:

```
RAP Service Generation Complete!

Created artifacts:
  [x] Database table entity: <table_name>
  [x] Interface CDS view: ZI_<Entity>
  [x] Interface access control: ZI_<Entity>_DCL
  [x] Interface behavior definition: ZI_<Entity>
  [x] Projection CDS view: ZC_<Entity>
  [x] Projection behavior definition: ZC_<Entity>
  [x] Metadata extension: ZC_<Entity>
  [x] Service definition: ZSD_<Entity>
  [x] Behavior pool class: ZBP_I_<Entity>
  [x] Service binding: ZSB_<Entity>_V4
  [x] Service binding published

Next steps:
  - Add validations and determinations (use generate-rap-logic skill)
  - Add value helps for business fields
  - Add custom actions if needed
  - Generate unit tests (use generate-abap-unit-test skill)
  - Register in FLP launchpad (use SAPManage flp_create_catalog, flp_create_tile, flp_create_group)
  - Create proper DOMA/DTEL for reusable typing (use SAPWrite with type=DOMA/DTEL)
  - Attach SKTD documentation to the service or BDEF (optional)
  - Review later iterations with `SAPTransport(action="history")` + `SAPRead(type="VERSIONS", ...)`
```

## Error Handling

### Common Issues and Fixes

| Error | Cause | Fix |
|---|---|---|
| 415 Unsupported Media Type on DDLS/BDEF | RAP/CDS endpoint not responding as expected | Check `SAPManage(action="probe")` for system info. Verify ICF service activation. Try creating the object in ADT to confirm system capability. |
| `Resource X does already exist` on create | Existing object or stub collision | Switch to `SAPWrite(action="update", ...)` and resend full source. Do not retry create blindly. |
| Activation error: dependency not found | Objects activated in wrong order | Use sequential activation in dependency order (Step 12 fallback) |
| Draft table not found | Draft table not yet created | Create draft table entity first, or remove `with draft` from BDEF |
| Field mapping incomplete | BDEF field names don't match CDS aliases | Verify CDS field aliases match BDEF field references exactly |
| ETag field not found | `LocalLastChangedAt` missing or misnamed | Verify admin fields exist in CDS view with correct aliases |
| Behavior pool not found | Class name doesn't match BDEF `implementation in class` | Ensure class name in BDEF matches the created class exactly |
| BDEF creation/save fails with generic `[?/011]` | Behavior-pool full-class save path is unstable for RAP handler declarations | Keep class minimal, generate signatures via quickfix (MCP or ADT), then use `edit_method` for bodies |
| Lint blocks write | Generated code has lint warnings | Review lint findings, adjust code patterns to pass lint rules |
| Table entity creation not supported | Older on-prem system | Create table via SE11 manually, provide field list |
| Transport required | Non-$TMP package without transport | Use `SAPTransport(action="check")` to find or create a transport — see Step 1b |
| Lock conflict on create | Object locked by another user/transport | Wait or use a different name; check `SAPTransport(action="list")` for conflicting transports |
| Currency reference annotation missing | `abap.curr` field has no currency semantics annotation | Add `@Semantics.amount.currencyCode` above each amount field and ensure a `abap.cuky` field exists |
| `"draft or side" was expected, not "etag"` | Invalid projection BDEF header syntax on 7.5x | Keep header as `projection;` only |

## Notes

### BTP vs On-Prem Summary

- **BTP**: Z*/Y* namespace only, ABAP Cloud syntax enforced, draft tables must be explicitly created (framework manages draft data at runtime), V4 OData preferred, `strict ( 2 )` in BDEF, table entity DDL syntax, released SAP APIs only.
- **On-Prem**: More namespace flexibility, classic ABAP allowed in behavior pool (not recommended), explicit draft table creation may be needed, V2 or V4, `strict` level depends on release.

### What This Skill Does NOT Do (v1)

- **Complex compositions / child hierarchies**: Use `generate-rap-service-researched` for multi-entity BOs and two-pass rollout.
- **Custom actions**: No `action` declarations beyond draft actions. Use generate-rap-logic skill after.
- **Determinations / validations**: No business logic. Use generate-rap-logic skill to add these after.
- **Value helps**: No `@Consumption.valueHelpDefinition` annotations. Add manually.
- **Feature control / side effects**: No backend-driven UI behavior beyond standard CRUD. Add manually when the UI needs dynamic enablement or recalculation hints.
- **Unmanaged / abstract BOs**: Only managed scenario with UUID keys.
- **DOMA/DTEL creation**: Uses inline types. For production services, create proper domains and data elements afterward using `SAPWrite(type="DOMA"/"DTEL")`.
- **FLP registration**: Does not auto-register in Fiori Launchpad. Use `SAPManage` FLP actions afterward.

### When to Use This Skill

- When starting a new RAP application from scratch
- When the user describes a business object in natural language
- When prototyping a Fiori Elements app quickly
- NOT for adding to an existing RAP service (use manual editing or generate-rap-logic)
- NOT for complex data models with multiple entities (v1 is single root entity only)
