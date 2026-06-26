# ARC-1 Authorization Concept

**Date:** 2026-04-07
**Author:** ralphex / marianfoo
**Status:** Draft v3

---

## 1. Problem Statement

ARC-1 is an MCP server that gives LLM clients (Claude Desktop, Cursor, Copilot Studio, etc.) access to SAP ABAP systems. We need a layered authorization model that covers three deployment scenarios:

| Scenario | Auth Method | User Identity | Example |
|----------|-------------|---------------|---------|
| **A. Local / npx** | None (stdio) or API key | Single user, their own credentials | Developer running `npx arc-1` with Claude Desktop |
| **B. Self-hosted server** | API key or OIDC JWT | Multiple users, shared technical user OR per-user PP | Team deploys ARC-1 on a VM behind nginx |
| **C. BTP Cloud Foundry** | XSUAA OAuth 2.0 | Multiple users, XSUAA roles + principal propagation | Enterprise deployment on BTP |

The goal is a **single, consistent role model** that maps cleanly across all three scenarios, using familiar SAP authorization concepts where possible.

### Design Principle: Server First, Then Roles

The server-level safety config is always the **ceiling**. Roles/scopes can only **restrict** within that ceiling, never expand beyond it.

```
Server config (env vars)     ← hard limit, set by admin at deployment
  └─ Per-user scopes (JWT)   ← further restricts within the ceiling
      └─ SAP-level auth      ← final enforcement in the backend (especially with PP)
```

This is especially important with principal propagation: even if ARC-1 grants `write` scope, the SAP system still enforces the user's own S_DEVELOP authorizations. ARC-1's safety layer is a **first line of defense**, not the only one.

---

## 2. Current State (What Already Exists)

### 2.1 Safety System (`src/adt/safety.ts`)

Server-level, configured via env vars / CLI flags. Applies globally to ALL users.

| Setting | Effect | Default |
|---------|--------|---------|
| `--read-only` | Blocks all write ops (Create, Update, Delete, Activate, Workflow) | `true` |
| `--block-free-sql` | Blocks freestyle SQL execution | `true` |
| `--allowed-ops "RSQTI"` | Allowlist of operation type codes | `""` (no allowlist filter) |
| `--disallowed-ops "F"` | Blocklist of operation type codes (takes precedence over allowlist) | `""` |
| `--allowed-packages "Z*,Y*"` | Package restriction (wildcard support) | `"$TMP"` |
| `--enable-transports` | Allow CTS transport operations | `false` |

**Operation Types:**
```
R = Read         S = Search       Q = Query (table preview)
F = FreeSQL      C = Create       U = Update
D = Delete       A = Activate     T = Test (unit tests, ATC)
L = Lock         I = Intelligence (code nav, completion)
W = Workflow     X = Transport
```

### 2.2 XSUAA Scopes & Role Templates (`xs-security.json`)

Three scopes, three role templates, three role collections:

| Scope | Role Template | Role Collection | Tool Access |
|-------|---------------|-----------------|-------------|
| `read` | MCPReader | ARC-1 Viewer | SAPRead, SAPSearch, SAPQuery, SAPNavigate, SAPContext, SAPLint, SAPDiagnose |
| `write` | MCPEditor | ARC-1 Editor | + SAPWrite, SAPActivate, SAPManage, SAPTransport |
| `admin` | MCPAdmin | ARC-1 Admin | Full access + future admin features |

**Enforcement:** Scopes are checked per-tool-call in `src/handlers/intent.ts` (TOOL_SCOPES mapping). Only active when `authInfo` is present (XSUAA/OIDC mode). Additive to safety config — both must pass.

### 2.3 Principal Propagation

When `--pp-enabled`, each MCP request's JWT is used to look up a per-user BTP Destination, so the SAP system sees the actual user identity (not a shared technical user). This means SAP-level authorizations (S_DEVELOP, etc.) apply per-user.

### 2.4 Gap: Safety Config Is Global

The safety config (readOnly, allowedPackages, etc.) is set at server startup and applies to ALL users equally. There's no way to give User A write access to `Z_TEAM_A*` packages while restricting User B to read-only — you'd need two server instances.

---

## 3. SAP Authorization Objects — Detailed Reference

This section documents exactly which SAP authorization objects are needed for each ARC-1 operation. This is critical for SAP Basis teams setting up technical users.

### 3.1 Key Authorization Objects

| Auth Object | Purpose | Key Fields |
|-------------|---------|------------|
| **S_ADT_RES** | ADT HTTP resource access | `ADT_URI` (URI pattern), `ACTVT` (01=Read, 02=Modify) |
| **S_DEVELOP** | ABAP Workbench development | `ACTVT` (01=Display, 02=Change, 06=Delete, 07=Activate), `DEVCLASS` (package), `OBJTYPE` (PROG, CLAS, etc.), `OBJNAME` (object name) |
| **S_TRANSPRT** | Transport Organizer | `ACTVT` (01=Display, 02=Change, 43=Release), `TTYPE` (K=Workbench, W=Customizing) |
| **S_CTS_ADMI** | CTS Administration | `CTS_ADMFCT` (TABL=List, SYSC=Cross-client) |
| **S_SQL_VIEW** | SQL access via ADT data preview | `ACTVT`, `VIEWNAME` |

### 3.2 Complete Endpoint-to-Authorization Mapping

Every HTTP call ARC-1 makes to SAP, with the exact SAP authorization objects checked server-side.

#### Read Operations (Viewer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `getProgram()` | `/sap/bc/adt/programs/programs/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=PROG) | |
| `getClass()` | `/sap/bc/adt/oo/classes/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=CLAS) | Also fetches includes (definitions, implementations, macros, testclasses) |
| `getInterface()` | `/sap/bc/adt/oo/interfaces/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=INTF) | |
| `getFunction()` | `/sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=FUGR) | |
| `getFunctionGroup()` | `/sap/bc/adt/functions/groups/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=FUGR) | Metadata only |
| `getInclude()` | `/sap/bc/adt/programs/includes/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=PROG) | |
| `getDdls()` | `/sap/bc/adt/ddic/ddl/sources/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=DDLS) | CDS View |
| `getBdef()` | `/sap/bc/adt/bo/behaviordefinitions/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=BDEF) | RAP Behavior |
| `getSrvd()` | `/sap/bc/adt/ddic/srvd/sources/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=SRVD) | Service Definition |
| `getDdlx()` | `/sap/bc/adt/ddic/ddlx/sources/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=DDLX) | Metadata Extension |
| `getSrvb()` | `/sap/bc/adt/businessservices/bindings/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=SRVB) | Service Binding |
| `getTable()` | `/sap/bc/adt/ddic/tables/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=TABL) | |
| `getView()` | `/sap/bc/adt/ddic/views/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=VIEW) | On-prem only |
| `getStructure()` | `/sap/bc/adt/ddic/structures/{name}/source/main` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=STRU) | |
| `getDomain()` | `/sap/bc/adt/ddic/domains/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=DOMA) | XML metadata |
| `getDataElement()` | `/sap/bc/adt/ddic/dataelements/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=DTEL) | XML metadata |
| `getTransaction()` | `/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=TRAN) | |
| `getMessages()` | `/sap/bc/adt/msg/messages/{name}` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01, OBJTYPE=MSAG) | |
| `getTextElements()` | `/sap/bc/adt/programs/programs/{name}/textelements` | GET | S_ADT_RES (ACTVT=01), S_DEVELOP (ACTVT=01) | |
| `getVariants()` | `/sap/bc/adt/programs/programs/{name}/variants` | GET | S_ADT_RES (ACTVT=01) | |

#### Search & Discovery (Viewer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `searchObject()` | `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query={q}` | GET | S_ADT_RES (ACTVT=01) | Quick search |
| `searchSource()` | `/sap/bc/adt/repository/informationsystem/textSearch?searchString={q}` | GET | S_ADT_RES (ACTVT=01) | Source code search |
| `getPackageContents()` | `/sap/bc/adt/repository/informationsystem/search?packageName={pkg}` | GET | S_ADT_RES (ACTVT=01) | Switched from `nodestructure` POST in 2026-05 — that endpoint returned object descriptions misaligned with names. Search endpoint returns reliable descriptions and avoids the CSRF round-trip. |
| `getSystemInfo()` | `/sap/bc/adt/core/discovery` | GET | S_ADT_RES (ACTVT=01) | Atom service document |
| `getInstalledComponents()` | `/sap/bc/adt/system/components` | GET | S_ADT_RES (ACTVT=01) | |

#### Code Intelligence (Viewer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `findDefinition()` | `/sap/bc/adt/navigation/target` | **POST** | S_ADT_RES (ACTVT=01,02) | **POST needed for read!** |
| `findReferences()` | `/sap/bc/adt/repository/informationsystem/usageReferences` | GET | S_ADT_RES (ACTVT=01) | |
| `findWhereUsed()` | `/sap/bc/adt/repository/informationsystem/usageReferences` | **POST** | S_ADT_RES (ACTVT=01,02) | **POST needed for read!** |
| `getWhereUsedScope()` | `/sap/bc/adt/repository/informationsystem/usageReferences/scope` | **POST** | S_ADT_RES (ACTVT=01,02) | **POST needed for read!** |
| `getCompletion()` | `/sap/bc/adt/abapsource/codecompletion/proposals` | **POST** | S_ADT_RES (ACTVT=01,02) | **POST needed for read!** |

#### Data Preview & SQL (requires `data` or `sql` scope)

These endpoints access **live SAP table data**, not source code. They are separated from object-level read access because reading business data is a fundamentally different permission than reading ABAP source code.

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Required Scope | Notes |
|----------------|-------------|-------------|------------------|----------------|-------|
| `getTableContents()` | `/sap/bc/adt/datapreview/ddic?ddicEntityName={name}` | **POST** | S_ADT_RES (ACTVT=01,02), S_SQL_VIEW | `data` | Named table preview — reads actual business data |
| `runQuery()` | `/sap/bc/adt/datapreview/freestyle` | **POST** | S_ADT_RES (ACTVT=01,02), S_SQL_VIEW | `sql` | **Freestyle SQL — most privileged data access** |

#### Diagnostics & Testing (Viewer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `syntaxCheck()` | `/sap/bc/adt/checkruns` | **POST** | S_ADT_RES (ACTVT=01,02) | POST for read |
| `runUnitTests()` | `/sap/bc/adt/abapunit/testruns` | **POST** | S_ADT_RES (ACTVT=01,02) | POST for read |
| `runAtcCheck()` | `/sap/bc/adt/atc/runs?worklistId=1` | **POST** | S_ADT_RES (ACTVT=01,02) | Creates then fetches worklist |
| `listDumps()` | `/sap/bc/adt/runtime/dumps` | GET | S_ADT_RES (ACTVT=01) | |
| `getDump()` | `/sap/bc/adt/runtime/dump/{id}` + `/formatted` | GET | S_ADT_RES (ACTVT=01) | |
| `listTraces()` | `/sap/bc/adt/runtime/traces/abaptraces` | GET | S_ADT_RES (ACTVT=01) | |
| `getTraceHitlist()` | `/sap/bc/adt/runtime/traces/abaptraces/{id}/hitlist` | GET | S_ADT_RES (ACTVT=01) | |
| `getTraceStatements()` | `/sap/bc/adt/runtime/traces/abaptraces/{id}/statements` | GET | S_ADT_RES (ACTVT=01) | |
| `getTraceDbAccesses()` | `/sap/bc/adt/runtime/traces/abaptraces/{id}/dbAccesses` | GET | S_ADT_RES (ACTVT=01) | |

#### Write Operations (Developer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `lockObject()` | `{objectUrl}?_action=LOCK&accessMode=MODIFY` | POST | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=02) | Prerequisite for edit |
| `unlockObject()` | `{objectUrl}?_action=UNLOCK&lockHandle={h}` | POST | S_ADT_RES (ACTVT=02) | Cleanup after edit |
| `createObject()` | `{objectUrl}?corrNr={transport}` | POST | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=01,02) | Needs transport if transportable pkg |
| `updateSource()` | `{sourceUrl}?lockHandle={h}&corrNr={t}` | PUT | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=02) | Needs lock handle |
| `deleteObject()` | `{objectUrl}?lockHandle={h}&corrNr={t}` | DELETE | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=06) | |
| `activate()` | `/sap/bc/adt/activation?method=activate` | POST | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=07) | Single object |
| `activateBatch()` | `/sap/bc/adt/activation?method=activate` | POST | S_ADT_RES (ACTVT=02), S_DEVELOP (ACTVT=07) | Multiple objects |

#### Transport Operations (Developer role)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `listTransports()` | `/sap/bc/adt/cts/transportrequests` | GET | S_TRANSPRT (ACTVT=01), S_CTS_ADMI (CTS_ADMFCT=TABL) | Optional `?user=` filter |
| `getTransport()` | `/sap/bc/adt/cts/transportrequests/{id}` | GET | S_TRANSPRT (ACTVT=01) | |
| `createTransport()` | `/sap/bc/adt/cts/transportrequests` | POST | S_TRANSPRT (ACTVT=02), S_CTS_ADMI | |
| `releaseTransport()` | `/sap/bc/adt/cts/transportrequests/{id}/newreleasejobs` | POST | S_TRANSPRT (ACTVT=43) | |

#### Infrastructure (no role required)

| ARC-1 Function | ADT Endpoint | HTTP Method | SAP Auth Objects | Notes |
|----------------|-------------|-------------|------------------|-------|
| `fetchCsrfToken()` | `/sap/bc/adt/core/discovery` | HEAD | S_ADT_RES (ACTVT=01) | Automatic, every state-changing request |

### 3.3 Critical Insight: POST Needed for Read-Only Users

**6 out of 36 "read" endpoints use HTTP POST.** This is a common pitfall when setting up SAP roles:

- `findDefinition()` — POST
- `findWhereUsed()` — POST
- `getWhereUsedScope()` — POST
- `getCompletion()` — POST
- `syntaxCheck()` — POST
- `runUnitTests()` — POST
- `runAtcCheck()` — POST
- `getTableContents()` — POST
- `runQuery()` — POST

**If you restrict S_ADT_RES to ACTVT=01 (GET only), read-only users will not be able to:**
- Navigate code (go-to-definition)
- Find where objects are used
- Get code completion suggestions
- Run syntax checks or unit tests
- Preview table contents

**The correct read-only S_ADT_RES configuration is ACTVT=01 AND 02.** The SAP system distinguishes "modify" operations at the S_DEVELOP level, not at the HTTP method level.

### 3.4 Recommended SAP Roles for Technical User

The SAP roles follow the same objects-vs-data separation as the ARC-1 scope model. There are **four composable SAP roles** — two for the object dimension, two for the data dimension:

```
SAP Role Composition:

Object dimension:           Data dimension (additive):
├── ZMCP_READ  (viewer)     ├── ZMCP_DATA (table preview)
└── ZMCP_WRITE (developer)  └── ZMCP_SQL  (freestyle SQL, extends ZMCP_DATA)
```

Assign these in combination based on the ARC-1 scopes the user needs:

| ARC-1 Profile | SAP Roles to Assign |
|---------------|---------------------|
| `viewer` | ZMCP_READ |
| `viewer-data` | ZMCP_READ + ZMCP_DATA |
| `viewer-sql` | ZMCP_READ + ZMCP_DATA + ZMCP_SQL |
| `developer` | ZMCP_READ + ZMCP_WRITE |
| `developer-data` | ZMCP_READ + ZMCP_WRITE + ZMCP_DATA |
| `developer-sql` | ZMCP_READ + ZMCP_WRITE + ZMCP_DATA + ZMCP_SQL |

#### ZMCP_READ — Object Read Access (Viewer)

The base role. Required for all ARC-1 users. Grants read access to ABAP source code, search, code intelligence, tests, and diagnostics.

```
┌─────────────────────────────────────────────────────────────────┐
│ Role: ZMCP_READ                                                 │
│ Description: Read-only access to ABAP development objects       │
│ ARC-1 scope: read                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ S_ADT_RES (ADT Resource Access)                                 │
│   ADT_URI      = /sap/bc/adt/*                                  │
│   ACTVT        = 01, 02         ← 02 needed! POST used for     │
│                                   search, code intel, tests     │
│   HTTP_METHOD  = GET, POST, HEAD ← HEAD for CSRF token          │
│                                                                 │
│ S_DEVELOP (ABAP Workbench)                                      │
│   ACTVT        = 01, 03         ← Display only                  │
│   DEVCLASS     = *              ← or restrict: Z*, Y*           │
│   OBJTYPE      = PROG, CLAS, INTF, FUGR, DDLS, DDLX, BDEF,    │
│                  SRVD, SRVB, TABL, VIEW, STRU, DOMA, DTEL,     │
│                  TRAN, MSAG                                      │
│   OBJNAME      = *                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What this user CAN do:**
- Read source code of all 18 ABAP object types
- Search objects and source code
- Navigate code (go-to-definition, where-used, code completion)
- Run syntax checks, unit tests, ATC checks
- View short dumps and profiler traces
- List transports (read-only)

**What this user CANNOT do:**
- Create, modify, or delete any ABAP objects
- Activate objects
- Create or release transports
- Preview table contents or execute SQL queries (needs ZMCP_DATA)

**Verification:** Log in as the tech user in SE80/ADT. Confirm you can browse objects but not edit them. Try to open a class — source should be visible but the edit button grayed out.

#### ZMCP_WRITE — Object Write Access (Developer)

Adds write capabilities. Always assign together with ZMCP_READ.

```
┌─────────────────────────────────────────────────────────────────┐
│ Role: ZMCP_WRITE (extends ZMCP_READ)                            │
│ Description: Write access to ABAP development objects           │
│ ARC-1 scope: write                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ S_ADT_RES (ADT Resource Access)                                 │
│   ADT_URI      = /sap/bc/adt/*                                  │
│   ACTVT        = 01, 02                                          │
│   HTTP_METHOD  = GET, POST, PUT, DELETE, HEAD                   │
│                  ← PUT for source update, DELETE for object del  │
│                                                                 │
│ S_DEVELOP (ABAP Workbench)                                      │
│   ACTVT        = 01, 02, 03, 06, 07                             │
│                  01=Display, 02=Change, 03=Display,              │
│                  06=Delete, 07=Activate                          │
│   DEVCLASS     = *              ← restrict per team: Z_TEAM_A*  │
│   OBJTYPE      = PROG, CLAS, INTF, FUGR, DDLS, DDLX, BDEF,    │
│                  SRVD, SRVB, TABL, VIEW, STRU, DOMA, DTEL,     │
│                  TRAN, MSAG                                      │
│   OBJNAME      = *                                               │
│                                                                 │
│ S_TRANSPRT (Transport Organizer)                                │
│   ACTVT        = 01, 02, 43    ← Display, Change, Release       │
│   TTYPE        = K, W          ← Workbench + Customizing        │
│                                                                 │
│ S_CTS_ADMI (CTS Administration)                                 │
│   CTS_ADMFCT   = TABL          ← List transports                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What this adds over ZMCP_READ:**
- Create, modify, delete ABAP objects (with transport)
- Activate objects (single and batch)
- Create and release transports
- PUT (source update) and DELETE (object deletion) HTTP methods

**Security recommendation:** Even with ZMCP_WRITE, restrict with ARC-1's safety config:
- `--allowed-packages "Z*"` to prevent modifications to SAP standard objects
- Use per-user scopes (XSUAA/OIDC) to restrict individual users within the write-capable server

#### ZMCP_DATA — Table Data Preview

Additive role for named table preview. Does NOT include freestyle SQL.

```
┌─────────────────────────────────────────────────────────────────┐
│ Role: ZMCP_DATA (additive)                                      │
│ Description: Preview contents of named SAP tables               │
│ ARC-1 scope: data                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ S_SQL_VIEW (SQL/Data Preview Access)                            │
│   ACTVT        = 01                                              │
│   VIEWNAME     = *              ← or restrict to specific tables │
│                                                                 │
│ Note: S_ADT_RES with ACTVT=02 is already in ZMCP_READ          │
│ (POST is needed for the data preview endpoint)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What this adds:**
- Preview contents of named tables (e.g., "show me rows from MARA where MTART = 'FERT'")
- The preview uses `/sap/bc/adt/datapreview/ddic` which requires a known table name

**What this does NOT allow:**
- Freestyle SQL queries (needs ZMCP_SQL)

**Why separate?** Table data often contains business-sensitive information (customer data, pricing, HR records). A developer who needs to read ABAP source code doesn't necessarily need to see table contents. This maps to how SAP separates S_DEVELOP (object access) from S_SQL_VIEW / S_TABU_DIS (data access).

#### ZMCP_SQL — Freestyle SQL Access

Additive role for freestyle SQL. Always assign together with ZMCP_DATA.

```
┌─────────────────────────────────────────────────────────────────┐
│ Role: ZMCP_SQL (extends ZMCP_DATA)                              │
│ Description: Execute freestyle SQL SELECT queries               │
│ ARC-1 scope: sql                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ S_SQL_VIEW (SQL/Data Preview Access)                            │
│   ACTVT        = 01, 02        ← 02 for freestyle execution     │
│   VIEWNAME     = *              ← or restrict to specific tables │
│                                                                 │
│ Note: This is the same auth object as ZMCP_DATA but with        │
│ additional activity 02 for freestyle query execution.            │
│ The SAP system enforces table-level access via S_TABU_DIS       │
│ and S_SQL_VIEW.VIEWNAME.                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What this adds over ZMCP_DATA:**
- Execute arbitrary `SELECT` queries (e.g., `SELECT * FROM mara WHERE matnr LIKE 'A%'`)
- Uses `/sap/bc/adt/datapreview/freestyle` endpoint

**Why the most restricted scope?** Freestyle SQL can access ANY table the SAP user has S_SQL_VIEW/S_TABU_DIS authorization for. This is the most powerful data access capability in ARC-1. An LLM with this access could potentially read sensitive business data. Always consider whether named table preview (`data` scope) is sufficient before granting `sql`.

---

## 4. Proposed Role Model

### 4.1 Two Dimensions: Objects vs Data

The key insight is that ARC-1 provides access to two fundamentally different things:

1. **ABAP Objects** — source code, metadata, development artifacts (reading, writing, activating, transporting)
2. **SAP Data** — live table contents, SQL queries on business data

These require separate permissions. A developer who can write ABAP code should not automatically be able to SELECT from PA0008 (HR salary data). Conversely, a data analyst who needs to query tables for troubleshooting shouldn't need write access to ABAP objects.

### 4.2 Scope Model

**Four scopes**, two for objects, two for data:

| Scope | Category | Description | Op Types |
|-------|----------|-------------|----------|
| `read` | Objects | Read ABAP source code, search, navigate, test, diagnose | R, S, I, T |
| `write` | Objects | Create, modify, delete, activate, transport ABAP objects | C, U, D, A, L, W, X |
| `data` | Data | Preview named table contents (SELECT from known tables) | Q |
| `sql` | Data | Execute freestyle SQL queries (arbitrary SELECT) | F |

**Scope hierarchy:**
- `write` implies `read` (you can't write without reading)
- `sql` implies `data` (freestyle SQL is a superset of named table preview)
- `data` does NOT imply `read` (you could query tables without seeing source code, though unlikely in practice)
- `admin` is reserved for future server-level operations

### 4.3 Roles (Composite Scope Assignments)

Roles are predefined combinations of scopes. They exist in XSUAA as role templates and in CLI as `--profile`:

| Role | Scopes | Description | MCP Tools |
|------|--------|-------------|-----------|
| **Viewer** | `read` | Browse source code, search, navigate, run tests | SAPRead, SAPSearch, SAPNavigate, SAPContext, SAPLint, SAPDiagnose |
| **Developer** | `read`, `write` | Full ABAP development lifecycle (includes transports) | + SAPWrite, SAPActivate, SAPManage, SAPTransport |
| **Admin** | `read`, `write`, `admin` | Reserved for future admin features | all |

| Additive Scope | Effect | Typical Combination |
|----------------|--------|---------------------|
| **data** | + SAPQuery (named table preview) | Viewer + data, Developer + data |
| **sql** | + SAPQuery (freestyle SQL), implies data | Viewer + sql, Developer + sql |

**Examples:**
- `Viewer` — can read source code, search, navigate code, run syntax checks. Cannot see table data.
- `Viewer + data` — same as Viewer, plus can preview contents of named tables (e.g., "show me what's in table MARA").
- `Viewer + sql` — same as Viewer + data, plus can run `SELECT * FROM mara WHERE matnr = '12345'`.
- `Developer` — full ABAP development: create objects, edit source, activate, manage transports. Cannot see table data.
- `Developer + data` — full development plus table preview (most common for developers).
- `Developer + sql` — full development plus freestyle SQL (power user, use with caution).

**Key design decisions:**
- **Transports are part of Developer**, not a separate role. Developers need to assign changes to transports as part of normal workflow.
- **Activate is part of write**, not separate. Writing code without activating is rarely useful in practice.
- **Data access is separate from object access.** Reading source code (`read`) and reading table data (`data`) are different permissions. This maps to how SAP itself separates S_DEVELOP (object access) from S_SQL_VIEW / S_TABU_DIS (data access).
- **SQL is the most privileged data scope.** It allows arbitrary SELECT on any table the SAP user has access to. Named table preview (`data`) is safer because the LLM can only request specific known tables.
- **Admin is reserved** for future server-level operations (view audit logs, change runtime config). Not needed for development.

### 4.4 Mapping to Each Deployment Scenario

#### Scenario A: Local / npx (stdio)

No auth layer — safety config is the entire authorization system. Configuration via env vars in the MCP client config:

```json
{
  "mcpServers": {
    "arc-1-viewer": {
      "command": "npx",
      "args": ["-y", "arc-1", "--profile", "viewer"],
      "env": {
        "SAP_URL": "http://myhost:50000",
        "SAP_USER": "DEVELOPER",
        "SAP_PASSWORD": "secret"
      }
    },
    "arc-1-developer": {
      "command": "npx",
      "args": ["-y", "arc-1", "--profile", "developer-data"],
      "env": {
        "SAP_URL": "http://myhost:50000",
        "SAP_USER": "DEVELOPER",
        "SAP_PASSWORD": "secret",
        "SAP_ALLOWED_PACKAGES": "Z_MY_PROJECT*"
      }
    }
  }
}
```

**Profile -> Config mapping:**

| Profile | `READ_ONLY` | `BLOCK_FREE_SQL` | `BLOCK_DATA` | `ENABLE_TRANSPORTS` | `ALLOW_TRANSPORTABLE_EDITS` |
|---------|-------------|-------------------|--------------|---------------------|----|
| `viewer` | `true` | `true` | `true` | `false` | `false` |
| `viewer-data` | `true` | `true` | `false` | `false` | `false` |
| `viewer-sql` | `true` | `false` | `false` | `false` | `false` |
| `developer` | `false` | `true` | `true` | `true` | `true` |
| `developer-data` | `false` | `true` | `false` | `true` | `true` |
| `developer-sql` | `false` | `false` | `false` | `true` | `true` |

Note: `BLOCK_DATA` is a **new config flag** (`--block-data` / `SAP_BLOCK_DATA`) that blocks the `Query` (Q) operation type (named table preview). Today only `--block-free-sql` exists for freestyle SQL; we need a separate toggle for named table access.

#### Scenario B: Self-hosted Server (HTTP transport)

Two sub-options:

**B1. Shared technical user, OIDC per-user scopes:**
The server connects to SAP with a technical user (ZMCP_WRITE role in SAP). Per-user restrictions are enforced at the ARC-1 level via OIDC JWT scopes.

```bash
# Server startup — set ceiling to maximum, let scopes restrict per-user
SAP_URL=http://myhost:50000 \
SAP_USER=ZMCP_TECH \
SAP_PASSWORD=*** \
SAP_TRANSPORT=http-streamable \
SAP_READ_ONLY=false \
SAP_ENABLE_TRANSPORTS=true \
SAP_OIDC_ISSUER=https://login.mycompany.com \
SAP_OIDC_AUDIENCE=arc1-mcp \
npx arc-1
```

The OIDC provider (Entra ID, Keycloak, Auth0) issues tokens with scopes like `read`, `write`, `data`, `sql`. ARC-1 derives per-request safety config from scopes.

**Current gap:** `http.ts:274` hardcodes full scopes for OIDC tokens. Needs fix — see [5.1](#51-oidc-scope-extraction).

**B2. Principal propagation (each user's own SAP identity):**
Each user authenticates via OIDC/XSUAA. ARC-1 uses their JWT to obtain a per-user SAP session. SAP-level authorizations apply per-user.

```bash
SAP_TRANSPORT=http-streamable \
SAP_BTP_SERVICE_KEY_FILE=./service-key.json \
SAP_PP_ENABLED=true \
SAP_PP_STRICT=true \
SAP_READ_ONLY=false \
SAP_ENABLE_TRANSPORTS=true \
npx arc-1
```

With PP, the server config ceiling should be generous (read-only=false, transports=true) because the SAP system enforces the user's actual authorizations. ARC-1's role scopes add a first-line check, but the SAP backend is the authority.

#### Scenario C: BTP Cloud Foundry (XSUAA)

The cleanest option. `xs-security.json` defines the role model:

```
xs-security.json  →  XSUAA  →  BTP Cockpit Role Collections  →  Users/Groups
```

**Updated `xs-security.json` scopes:**

```json
{
  "scopes": [
    { "name": "$XSAPPNAME.read",  "description": "Read ABAP source code and objects" },
    { "name": "$XSAPPNAME.write", "description": "Create, modify, delete, activate ABAP objects and manage transports" },
    { "name": "$XSAPPNAME.data",  "description": "Preview named table contents" },
    { "name": "$XSAPPNAME.sql",   "description": "Execute freestyle SQL queries (implies data)" },
    { "name": "$XSAPPNAME.admin", "description": "Reserved for future admin features" }
  ]
}
```

**Role templates:**

| Role Template | Scopes | Description |
|---------------|--------|-------------|
| MCPViewer | `read` | Read ABAP objects only |
| MCPDeveloper | `read`, `write` | Full ABAP development |
| MCPDataViewer | `data` | Additive: named table preview |
| MCPSqlUser | `data`, `sql` | Additive: freestyle SQL (implies data) |
| MCPAdmin | `read`, `write`, `admin` | Reserved |

**Role collections (assigned to users in BTP Cockpit):**

| Role Collection | Role Templates | Scopes | Use Case |
|-----------------|----------------|--------|----------|
| ARC-1 Viewer | MCPViewer | `read` | Browse code, search, navigate |
| ARC-1 Viewer + Data | MCPViewer + MCPDataViewer | `read`, `data` | + preview table contents |
| ARC-1 Viewer + SQL | MCPViewer + MCPSqlUser | `read`, `data`, `sql` | + freestyle SQL |
| ARC-1 Developer | MCPDeveloper | `read`, `write` | Full development, no data access |
| ARC-1 Developer + Data | MCPDeveloper + MCPDataViewer | `read`, `write`, `data` | Full dev + table preview |
| ARC-1 Developer + SQL | MCPDeveloper + MCPSqlUser | `read`, `write`, `data`, `sql` | Full dev + freestyle SQL |
| ARC-1 Admin | MCPAdmin | `read`, `write`, `admin` | Reserved |

---

## 5. Implementation Plan

### 5.1 OIDC Scope Extraction (Priority: High)

**Problem:** `src/server/http.ts:274` hardcodes full scopes for OIDC tokens:
```typescript
scopes: ['read', 'write', 'admin'], // OIDC tokens get full access
```

**Fix:** Extract scopes from the JWT `scope` or `scp` claim:

```typescript
// In validateOidcToken():
const payload = await jwtVerify(token, jwks, { issuer, audience });
const tokenScopes = typeof payload.payload.scope === 'string'
  ? payload.payload.scope.split(' ')
  : Array.isArray(payload.payload.scp)
    ? payload.payload.scp
    : ['read', 'write', 'data', 'sql', 'admin']; // fallback for backward compat

// Filter to known scopes only
const knownScopes = ['read', 'write', 'data', 'sql', 'admin'];
const scopes = tokenScopes.filter(s => knownScopes.includes(s));
if (scopes.length === 0) scopes.push('read'); // minimum access

// Implied scopes: sql implies data, write implies read
if (scopes.includes('sql') && !scopes.includes('data')) scopes.push('data');
if (scopes.includes('write') && !scopes.includes('read')) scopes.push('read');
```

**Effort:** Small. One file change in `http.ts`.

### 5.2 Update XSUAA Scopes & Role Templates (Priority: High)

Update `xs-security.json` to match the new role model:

**Changes:**
1. Add `data` scope (named table preview)
2. Add `sql` scope (freestyle SQL, implies data)
3. Rename MCPReader → MCPViewer, MCPEditor → MCPDeveloper
4. Move transport access from `admin` to `write`/Developer
5. Add MCPDataViewer role template (additive)
6. Add MCPSqlUser role template (additive)
7. Update role collections

Clean rename — no production BTP deployments exist yet.

### 5.3 Update TOOL_SCOPES and Scope Enforcement in intent.ts (Priority: High)

**Current mapping** has two problems: SAPTransport requires `admin` (should be `write`), and SAPQuery is gated by `read` (should require `data`).

**New TOOL_SCOPES mapping:**
```typescript
export const TOOL_SCOPES: Record<string, string> = {
  SAPRead: 'read',
  SAPSearch: 'read',
  SAPQuery: 'data',        // was 'read' — table data access is separate from code access
  SAPNavigate: 'read',
  SAPContext: 'read',
  SAPLint: 'read',
  SAPDiagnose: 'read',
  SAPWrite: 'write',
  SAPActivate: 'write',
  SAPManage: 'write',
  SAPTransport: 'write',   // was 'admin' — developers need transports
};
```

**SAPRead TABLE_CONTENTS special case:** SAPRead is gated by `read` scope at the tool level, but the `TABLE_CONTENTS` sub-type calls `getTableContents()` which checks `OperationType.Query` — this is blocked by `blockData=true`. So the safety system (via `deriveUserSafety()`) correctly blocks data access even through SAPRead, without needing to change SAPRead's tool scope. The layering works: tool scope (`read`) ≠ operation type (`Query`).

**Additional scope check for freestyle SQL** — within SAPQuery, freestyle SQL requires the `sql` scope on top of `data`:

```typescript
// In handleSAPQuery() or handleToolCall():
if (args.sql && authInfo && !authInfo.scopes.includes('sql')) {
  return errorResult("Insufficient scope: 'sql' required for freestyle SQL queries. Your scopes: [" + authInfo.scopes.join(', ') + "]");
}
```

**Implied scope logic in scope check** — when checking TOOL_SCOPES, handle implications:
```typescript
function hasRequiredScope(authInfo: AuthInfo, requiredScope: string): boolean {
  const scopes = authInfo.scopes;
  if (scopes.includes(requiredScope)) return true;

  // write implies read
  if (requiredScope === 'read' && scopes.includes('write')) return true;
  // sql implies data
  if (requiredScope === 'data' && scopes.includes('sql')) return true;

  return false;
}
```

### 5.4 New Config Flag: `--block-data` (Priority: High)

To support the objects-vs-data separation, we need a new safety config flag:

| Flag | Env Var | Effect | Default |
|------|---------|--------|---------|
| `--block-data` | `SAP_BLOCK_DATA` | Block named table preview (Query op type) | `true` |

This is analogous to the existing `--block-free-sql` but for the safer named table preview. Both default to `true` (safe by default).

**Changes needed:**
- `src/adt/safety.ts`: Add `blockData: boolean` to `SafetyConfig`, check in `isOperationAllowed()` for `OperationType.Query`
- `src/server/config.ts`: Parse `--block-data` / `SAP_BLOCK_DATA`
- `src/server/types.ts`: Add to `ServerConfig`

### 5.5 Per-Request Safety Config (Priority: High)

Derive a per-request SafetyConfig by merging server config with JWT scopes:

```typescript
function deriveUserSafety(serverConfig: SafetyConfig, scopes: string[]): SafetyConfig {
  // Server config is the ceiling — scopes can only restrict further
  const config = { ...serverConfig };

  // No write scope → force read-only (even if server allows writes)
  if (!scopes.includes('write')) {
    config.readOnly = true;
    config.enableTransports = false;
  }

  // No data scope (and no sql scope, since sql implies data) → block table preview
  if (!scopes.includes('data') && !scopes.includes('sql')) {
    config.blockData = true;
  }

  // No sql scope → block freestyle SQL
  if (!scopes.includes('sql')) {
    config.blockFreeSQL = true;
  }

  return config;
}
```

**Key principle:** Scopes can only RESTRICT, never EXPAND.
- Server `readOnly=true` + JWT `write` scope → still read-only (server wins)
- Server `readOnly=false` + JWT no `write` scope → read-only (scope restricts)
- Server `blockFreeSQL=true` + JWT `sql` scope → still blocked (server wins)
- Server `blockFreeSQL=false` + JWT no `sql` scope → blocked (scope restricts)
- Server `blockData=true` + JWT `data` scope → still blocked (server wins)
- Server `blockData=false` + JWT no `data` scope → blocked (scope restricts)

**Where to apply:** In `server.ts` tool call handler, before passing config to `handleToolCall()`:

```typescript
// In server.ts, tool call handler:
const effectiveConfig = authInfo?.scopes
  ? deriveUserSafety(config, authInfo.scopes)
  : config;
```

**Effort:** Medium. Changes in `server.ts` + `safety.ts` (new function) + tests.

### 5.6 Named Profiles (Priority: Medium)

Pre-configured profiles for local/npx usage:

```bash
npx arc-1 --profile viewer
npx arc-1 --profile developer-data --allowed-packages "Z*"
npx arc-1 --profile developer-sql --allowed-packages "Z*"
```

| Profile | `readOnly` | `blockData` | `blockFreeSQL` | `enableTransports` | `allowTransportableEdits` |
|---------|------------|-------------|----------------|--------------------|----|
| `viewer` | true | true | true | false | false |
| `viewer-data` | true | false | true | false | false |
| `viewer-sql` | true | false | false | false | false |
| `developer` | false | true | true | true | true |
| `developer-data` | false | false | true | true | true |
| `developer-sql` | false | false | false | true | true |

**Effort:** Small. New profile mapping in `config.ts`.

### 5.7 Startup Authorization Smoke Test (Priority: Low)

**Research finding:** There is no SAP ADT endpoint to directly check authorization objects (no `AUTHORITY_CHECK` via REST). However, we can do lightweight probes:

**What we CAN probe at startup (without modifying anything):**

| Probe | How | What it tells us |
|-------|-----|------------------|
| Authentication | `HEAD /sap/bc/adt/core/discovery` (already done for CSRF) | 401 = bad credentials, 403 = no ADT access |
| Basic ADT access | `GET /sap/bc/adt/core/discovery` (already done for system info) | Success = S_ADT_RES is OK |
| Search access | `GET /sap/bc/adt/repository/informationsystem/search?query=CL_ABAP_*&maxResults=1` | Failure = missing search authorization |
| Transport access | `GET /sap/bc/adt/cts/transportrequests?user=__NONEXISTENT__` | 403 = no S_TRANSPRT |

**What we CANNOT probe:**
- Write authorization (S_DEVELOP ACTVT=02) — can only be verified by attempting a lock, which modifies state
- Specific package restrictions (S_DEVELOP DEVCLASS) — would need to attempt an operation on an object in that package
- Activation authorization (S_DEVELOP ACTVT=07) — requires an actual activation attempt

**Recommendation:** Extend the existing `features.ts` probe mechanism to test read-level authorizations at startup. Log warnings for failures. Don't attempt write probes — too risky. Instead, provide clear error messages when a write operation fails with 403, pointing to the ZMCP_READ/ZMCP_WRITE role documentation.

```typescript
// In features.ts, extend probeFeatures():
async function probeAuthorization(): Promise<AuthProbeResult> {
  const results = {
    adtAccess: false,    // HEAD /sap/bc/adt/core/discovery
    searchAccess: false, // GET search with dummy query
    transportAccess: false, // GET transport list
  };

  // These are already attempted during startup; capture results
  // Log warnings for missing capabilities
  if (!results.searchAccess) {
    logger.warn('SAP user may lack search authorization (S_ADT_RES). Search and navigation may fail.');
  }
  return results;
}
```

**Effort:** Small-medium. Extend existing probe pattern, add warning logs.

---

## 6. What's Good, What's Bad, Implementation Risks

### What's Good

1. **XSUAA scope enforcement already works per-tool-call.** Core mechanism is in place.
2. **Safety system is comprehensive.** 12 op types, package wildcards, transport restrictions.
3. **Principal propagation works.** Per-user SAP identity via BTP Destination Service.
4. **Server-first design is correct.** Safety config as ceiling, scopes narrow within it.
5. **All 36 endpoints have safety guards.** (One minor gap: `unlockObject()` — should be fixed.)

### What's Bad / Needs Fixing

1. **OIDC tokens get hardcoded full scopes.** Biggest gap — blocks per-user auth for self-hosted.
2. **No `data` or `sql` scope.** Table data access is all-or-nothing at server level.
3. **SAPTransport requires `admin` scope.** Should be `write` (developers need transports).
4. **No `blockData` config flag.** Can't separately control named table preview vs freestyle SQL.
5. **SAPQuery gated by `read` scope.** Should be `data` (object access ≠ data access).
6. **Minor: `unlockObject()` in crud.ts has no `checkOperation()` guard.**

### Resolved Decisions

| Decision | Resolution |
|----------|------------|
| Rename role templates? | **Yes** — no production BTP deployments. Clean rename. |
| `admin` scope? | **Reserved** for future admin features. No effect today. |
| PP + scopes? | **Defense in depth.** ARC-1 enforces scopes even with PP. SAP is the final authority. |
| Table contents scope? | **Separate `data` scope.** Objects and data are different permission dimensions. |
| Activate separate? | **No.** Activate is part of `write`. |
| Ship together or split? | **Ship all together** as one release. |

### Implementation Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Breaking change: SAPQuery now requires `data` instead of `read`** | High | Users who currently use SAPQuery with `read` scope will lose access. Must be clearly documented in CHANGELOG as breaking. Fallback in OIDC: if no known scopes found, grant all (backward compat). |
| **Breaking change: SAPTransport moves from `admin` to `write`** | Medium | Users who granted `admin` for transport access need `write` instead. Actually EXPANDS access (more users can use transports), so less disruptive. |
| **New `blockData` flag defaults to `true`** | Medium | Existing users who rely on SAPQuery for table preview will need to add `SAP_BLOCK_DATA=false`. Document clearly. Consider defaulting to `false` for backward compat and `true` only for new profiles. |
| **Implied scopes (`sql` → `data`, `write` → `read`) must be consistent** | Medium | Must be enforced in ALL code paths: XSUAA token verifier, OIDC token verifier, API key auth, tool listing filter, scope check. Easy to miss one path. |
| **Per-request safety config derivation touches hot path** | Low | `deriveUserSafety()` is cheap (object spread + string checks). No performance concern. |

---

## 7. Implementation Order (Single Release)

All changes ship together. Implementation order within the release:

```
Step 1 — Safety system changes
├── Add `blockData` to SafetyConfig (safety.ts)
├── Add `blockData` check for OperationType.Query in isOperationAllowed()
├── Add deriveUserSafety() function (safety.ts)
├── Parse --block-data / SAP_BLOCK_DATA in config.ts
└── Unit tests for new safety logic

Step 2 — Scope model changes
├── Update TOOL_SCOPES in intent.ts:
│   ├── SAPQuery: 'read' → 'data'
│   └── SAPTransport: 'admin' → 'write'
├── Add hasRequiredScope() with implied scope logic (intent.ts)
├── Add sql scope check within SAPQuery handler (intent.ts)
├── Update tool listing filter in server.ts (respect implied scopes)
└── Unit tests for scope enforcement

Step 3 — Auth provider changes
├── Fix OIDC scope extraction in http.ts (stop hardcoding)
├── Add 'data' and 'sql' to XSUAA checkLocalScope() in xsuaa.ts
├── Add implied scope expansion in all auth code paths
├── Wire deriveUserSafety() in server.ts tool call handler
└── Unit tests for scope extraction + derivation

Step 4 — XSUAA configuration
├── Update xs-security.json (new scopes, renamed templates, new role collections)
└── No code change — just config

Step 5 — DX improvements
├── Add --profile flag in config.ts (viewer, viewer-data, viewer-sql, developer, developer-data, developer-sql)
├── Startup authorization probe (extend features.ts)
└── CHANGELOG + migration notes

Step 6 — Documentation
├── SAP role setup guide (ZMCP_READ, ZMCP_WRITE) — this document, cleaned up
├── Scope model documentation in README
└── Migration guide for existing users (SAPQuery scope change, SAPTransport scope change)
```

### Files Changed (Summary)

| File | Changes |
|------|---------|
| `src/adt/safety.ts` | + `blockData` field, + `deriveUserSafety()`, update `isOperationAllowed()` |
| `src/server/config.ts` | + `--block-data` flag, + `--profile` flag |
| `src/server/types.ts` | + `blockData` to ServerConfig |
| `src/handlers/intent.ts` | Update TOOL_SCOPES, + `hasRequiredScope()`, + sql scope check in SAPQuery |
| `src/server/http.ts` | Fix OIDC scope extraction (line ~274), + implied scope logic |
| `src/server/xsuaa.ts` | + `data` and `sql` in checkLocalScope() |
| `src/server/server.ts` | Wire `deriveUserSafety()`, update tool listing filter |
| `src/adt/features.ts` | + authorization probe at startup |
| `xs-security.json` | New scopes, renamed templates, new role collections |
| `tests/unit/adt/safety.test.ts` | + blockData tests, + deriveUserSafety() tests (~30 new) |
| `tests/unit/handlers/intent.test.ts` | + hasRequiredScope(), TOOL_SCOPES, SQL scope (~20 new) |
| `tests/unit/server/config.test.ts` | + profile flag tests (~8 new) |
| `tests/unit/server/http.test.ts` | + OIDC scope extraction tests (~7 new) |
| `tests/unit/server/xsuaa.test.ts` | + data/sql scope tests (~4 new) |
| `tests/integration/authorization.integration.test.ts` | NEW: per-user SAP auth tests (~40 tests, 7 SAP users) |
| `tests/e2e/authorization.e2e.test.ts` | NEW: full MCP protocol auth tests (~25 tests, 6 server instances) |
| `tests/e2e/deploy-auth.sh` | NEW: deployment script for auth E2E test servers |

---

## 8. Test Strategy

Testing the authorization system requires three levels: unit tests for logic, integration tests for scope enforcement with a real SAP system, and E2E tests with dedicated SAP users per role to validate the full stack.

### 8.1 SAP Test Users

Create dedicated SAP users on the A4H test system (SU01) for each role combination. These users validate that the SAP roles (ZMCP_READ, ZMCP_WRITE, ZMCP_DATA, ZMCP_SQL) work correctly and that ARC-1's scope enforcement matches SAP-level enforcement.

**Users to create via SU01 (copy from DEVELOPER):**

| SAP User | SAP Roles | ARC-1 Profile | Purpose |
|----------|-----------|---------------|---------|
| `ZMCP_VIEWER` | ZMCP_READ | `viewer` | Can read objects, cannot see table data, cannot write |
| `ZMCP_VIEWER_DATA` | ZMCP_READ + ZMCP_DATA | `viewer-data` | Can read objects + preview tables, no SQL, no write |
| `ZMCP_VIEWER_SQL` | ZMCP_READ + ZMCP_DATA + ZMCP_SQL | `viewer-sql` | Can read objects + preview tables + freestyle SQL, no write |
| `ZMCP_DEV` | ZMCP_READ + ZMCP_WRITE | `developer` | Can read + write objects, no data access |
| `ZMCP_DEV_DATA` | ZMCP_READ + ZMCP_WRITE + ZMCP_DATA | `developer-data` | Can read + write + preview tables |
| `ZMCP_DEV_SQL` | ZMCP_READ + ZMCP_WRITE + ZMCP_DATA + ZMCP_SQL | `developer-sql` | Full access |
| `ZMCP_NONE` | _(no ZMCP roles)_ | — | Should fail everything — validates error handling |

**Environment variables for tests:**
```bash
# Each user gets its own env var pair
TEST_SAP_USER_VIEWER=ZMCP_VIEWER
TEST_SAP_PASS_VIEWER=<password>
TEST_SAP_USER_VIEWER_DATA=ZMCP_VIEWER_DATA
TEST_SAP_PASS_VIEWER_DATA=<password>
TEST_SAP_USER_VIEWER_SQL=ZMCP_VIEWER_SQL
TEST_SAP_PASS_VIEWER_SQL=<password>
TEST_SAP_USER_DEV=ZMCP_DEV
TEST_SAP_PASS_DEV=<password>
TEST_SAP_USER_DEV_DATA=ZMCP_DEV_DATA
TEST_SAP_PASS_DEV_DATA=<password>
TEST_SAP_USER_DEV_SQL=ZMCP_DEV_SQL
TEST_SAP_PASS_DEV_SQL=<password>
TEST_SAP_USER_NONE=ZMCP_NONE
TEST_SAP_PASS_NONE=<password>
```

### 8.2 Unit Tests

Pure logic tests, no SAP system needed. Mock HTTP layer.

#### Safety system (`tests/unit/adt/safety.test.ts`)

Extend existing tests (currently 289 lines, 8 test groups):

```
New tests for blockData:
├── isOperationAllowed: blockData=true blocks Query (Q) operation
├── isOperationAllowed: blockData=false allows Query (Q) operation
├── isOperationAllowed: blockData does not affect FreeSQL (F) — that's blockFreeSQL
├── isOperationAllowed: blockData + blockFreeSQL both true → blocks both Q and F
└── checkOperation: throws AdtSafetyError for Query when blockData=true

New tests for deriveUserSafety():
├── No write scope → readOnly=true, enableTransports=false
├── No data scope and no sql scope → blockData=true
├── No sql scope → blockFreeSQL=true
├── Has write scope → readOnly unchanged from server config
├── Has sql scope → blockFreeSQL unchanged from server config
├── Has data scope → blockData unchanged from server config
├── Server ceiling enforcement:
│   ├── Server readOnly=true + write scope → still readOnly=true (server wins)
│   ├── Server blockFreeSQL=true + sql scope → still blocked (server wins)
│   └── Server blockData=true + data scope → still blocked (server wins)
├── Implied scopes:
│   ├── sql scope but no data scope → blockData unchanged (sql implies data)
│   └── write scope but no read scope → readOnly unchanged (write implies read)
└── Empty scopes → most restrictive (readOnly, blockData, blockFreeSQL all true)
```

#### Scope enforcement (`tests/unit/handlers/intent.test.ts`)

Extend existing tests:

```
New tests for hasRequiredScope():
├── Direct match: scopes=['read'], required='read' → true
├── Direct match: scopes=['write'], required='write' → true
├── Implied: scopes=['write'], required='read' → true (write implies read)
├── Implied: scopes=['sql'], required='data' → true (sql implies data)
├── Missing: scopes=['read'], required='write' → false
├── Missing: scopes=['data'], required='sql' → false
├── Missing: scopes=['read'], required='data' → false (read ≠ data)
└── Missing: scopes=[], required='read' → false

New tests for TOOL_SCOPES changes:
├── SAPQuery requires 'data' scope (was 'read')
├── SAPQuery allowed with 'sql' scope (implied data)
├── SAPQuery blocked with only 'read' scope
├── SAPTransport requires 'write' scope (was 'admin')
├── SAPTransport blocked with only 'read' scope
├── SAPTransport allowed with 'write' scope (no need for admin)
└── All read tools still work with 'read' scope

New tests for freestyle SQL scope check:
├── SAPQuery with sql param + sql scope → allowed
├── SAPQuery with sql param + data scope only → blocked with clear error
├── SAPQuery with sql param + no data/sql scope → blocked
├── SAPQuery without sql param (named table) + data scope → allowed
└── SAPQuery without sql param + read scope only → blocked (needs data)
```

#### Config profiles (`tests/unit/server/config.test.ts` or `tests/unit/cli/`)

```
New tests for --profile flag:
├── --profile viewer → readOnly=true, blockData=true, blockFreeSQL=true, enableTransports=false
├── --profile viewer-data → readOnly=true, blockData=false, blockFreeSQL=true
├── --profile viewer-sql → readOnly=true, blockData=false, blockFreeSQL=false
├── --profile developer → readOnly=false, blockData=true, blockFreeSQL=true, enableTransports=true
├── --profile developer-data → readOnly=false, blockData=false, blockFreeSQL=true, enableTransports=true
├── --profile developer-sql → readOnly=false, blockData=false, blockFreeSQL=false, enableTransports=true
├── --profile overridden by explicit flags: --profile viewer --read-only=false → readOnly=false
└── Unknown profile name → error
```

#### OIDC scope extraction (`tests/unit/server/http.test.ts`)

```
New tests for OIDC token scope extraction:
├── JWT with 'scope' claim (space-separated string) → parsed correctly
├── JWT with 'scp' claim (array) → parsed correctly
├── JWT with unknown scopes filtered out → only known scopes kept
├── JWT with no scope claims → fallback to full access (backward compat)
├── Implied scopes applied: token has 'sql' → 'data' added
├── Implied scopes applied: token has 'write' → 'read' added
└── Empty scopes after filtering → minimum 'read' scope
```

#### XSUAA scope extraction (`tests/unit/server/xsuaa.test.ts`)

```
New tests for checkLocalScope():
├── Token with 'data' scope → extracted
├── Token with 'sql' scope → extracted
├── Implied scope expansion after extraction
└── Token with only legacy scopes (read/write/admin) → still works
```

### 8.3 Integration Tests

Test against real SAP system with different user credentials. Skip automatically when `TEST_SAP_URL` is not set.

**File:** `tests/integration/authorization.integration.test.ts` (new)

```typescript
// Pattern: create AdtClient with specific user, test operations succeed/fail

describe('Authorization — ZMCP_VIEWER (read only, no data)', () => {
  // Uses TEST_SAP_USER_VIEWER credentials
  let client: AdtClient;

  beforeAll(async () => {
    client = createClientForUser('VIEWER'); // helper reads TEST_SAP_USER_VIEWER
  });

  // ── Should SUCCEED ──
  it('reads program source code', async () => {
    const source = await client.getProgram('RSHOWTIM');
    expect(source).toBeTruthy();
  });

  it('searches objects', async () => {
    const results = await client.searchObject('CL_ABAP*', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('navigates to definition', async () => {
    // findDefinition uses POST — verifies S_ADT_RES ACTVT=02 for read user
    const result = await client.findDefinition(...);
    expect(result).toBeTruthy();
  });

  it('runs syntax check', async () => {
    // syntaxCheck uses POST
    const result = await client.syntaxCheck(...);
    expect(result).toBeDefined();
  });

  // ── Should FAIL ──
  it('REJECTS table preview (no data scope)', async () => {
    // Depends on SAP-level auth — may get 403 or empty result
    // With ARC-1 safety (blockData=true), this is blocked before HTTP
    await expect(client.getTableContents('T000', 5)).rejects.toThrow(/blocked|forbidden/i);
  });

  it('REJECTS freestyle SQL', async () => {
    await expect(client.runQuery('SELECT * FROM T000')).rejects.toThrow(/blocked|forbidden/i);
  });

  it('REJECTS object creation', async () => {
    await expect(
      createObject(client, 'ZARC1_AUTH_TEST', 'PROG', ...)
    ).rejects.toThrow(/blocked|forbidden|safety/i);
  });
});

describe('Authorization — ZMCP_DEV_DATA (write + data, no SQL)', () => {
  // Uses TEST_SAP_USER_DEV_DATA credentials

  // ── Should SUCCEED ──
  it('reads program source');
  it('creates object in $TMP');
  it('activates object');
  it('previews table contents');
  it('lists transports');

  // ── Should FAIL ──
  it('REJECTS freestyle SQL');
});

describe('Authorization — ZMCP_NONE (no roles)', () => {
  // Uses TEST_SAP_USER_NONE credentials

  it('REJECTS basic read (403 from SAP)', async () => {
    await expect(client.getProgram('RSHOWTIM')).rejects.toThrow(/403|forbidden|authorization/i);
  });
});
```

**Test matrix (integration):**

| Operation | VIEWER | VIEWER_DATA | VIEWER_SQL | DEV | DEV_DATA | DEV_SQL | NONE |
|-----------|--------|-------------|------------|-----|----------|---------|------|
| Read source | OK | OK | OK | OK | OK | OK | 403 |
| Search | OK | OK | OK | OK | OK | OK | 403 |
| Code intelligence (POST) | OK | OK | OK | OK | OK | OK | 403 |
| Syntax check (POST) | OK | OK | OK | OK | OK | OK | 403 |
| Unit tests (POST) | OK | OK | OK | OK | OK | OK | 403 |
| Table preview | BLOCKED | OK | OK | BLOCKED | OK | OK | 403 |
| Freestyle SQL | BLOCKED | BLOCKED | OK | BLOCKED | BLOCKED | OK | 403 |
| Create object | 403 | 403 | 403 | OK | OK | OK | 403 |
| Update source | 403 | 403 | 403 | OK | OK | OK | 403 |
| Delete object | 403 | 403 | 403 | OK | OK | OK | 403 |
| Activate | 403 | 403 | 403 | OK | OK | OK | 403 |
| Create transport | 403 | 403 | 403 | OK | OK | OK | 403 |

Note: "BLOCKED" = ARC-1 safety system blocks before HTTP call. "403" = SAP rejects at HTTP level due to missing S_DEVELOP/S_SQL_VIEW.

### 8.4 E2E Tests (Primary Focus)

Full MCP protocol tests through the HTTP transport, testing scope enforcement end-to-end with real MCP clients. These are the most valuable tests because they validate the entire chain: MCP protocol → scope check → safety config → ADT HTTP → SAP authorization.

**Infrastructure:** Deploy multiple ARC-1 instances with different configurations, or use a single instance with scope-based per-user enforcement.

**Approach:** Start an ARC-1 server in HTTP mode with `readOnly=false`, `blockData=false`, `blockFreeSQL=false` (ceiling = everything allowed). Use API keys or OIDC tokens with different scope sets to simulate different roles. This tests ARC-1's scope enforcement without needing multiple server instances.

**File:** `tests/e2e/authorization.e2e.test.ts` (new)

#### Option A: Multiple server instances per profile (simplest)

Start separate ARC-1 processes with different `--profile` settings, each on a different port:

```typescript
// tests/e2e/authorization.e2e.test.ts

describe('E2E Authorization — Viewer profile', () => {
  // Server started with: --profile viewer --user ZMCP_VIEWER
  // Port: E2E_MCP_URL_VIEWER (e.g., http://localhost:3001/mcp)
  let client: Client;

  beforeAll(async () => {
    client = await connectClient(process.env.E2E_MCP_URL_VIEWER);
  });

  it('lists only read tools (no SAPWrite, SAPActivate, SAPTransport, SAPQuery)', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('SAPRead');
    expect(names).toContain('SAPSearch');
    expect(names).toContain('SAPNavigate');
    expect(names).not.toContain('SAPWrite');
    expect(names).not.toContain('SAPActivate');
    expect(names).not.toContain('SAPTransport');
    // SAPQuery should NOT be listed (requires data scope, viewer has only read)
    expect(names).not.toContain('SAPQuery');
  });

  it('SAPRead PROG — reads standard program', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });
    expectToolSuccess(result);
  });

  it('SAPRead CLAS — reads standard class', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES' });
    expectToolSuccess(result);
  });

  it('SAPSearch — finds objects', async () => {
    const result = await callTool(client, 'SAPSearch', { query: 'CL_ABAP*', maxResults: 3 });
    const text = expectToolSuccess(result);
    expect(JSON.parse(text).length).toBeGreaterThan(0);
  });

  it('SAPNavigate definition — works (POST to SAP)', async () => {
    const result = await callTool(client, 'SAPNavigate', {
      action: 'definition',
      type: 'CLAS',
      name: 'CL_ABAP_CHAR_UTILITIES',
      line: 1,
      column: 1,
    });
    // May succeed or fail depending on exact navigation target,
    // but should NOT fail with safety/scope error
    expect(result.content[0].text).not.toContain('blocked by safety');
  });

  it('SAPDiagnose syntax — works', async () => {
    const result = await callTool(client, 'SAPDiagnose', {
      action: 'syntax',
      name: 'RSHOWTIM',
      type: 'PROG',
    });
    // Should succeed (syntax check is a read operation)
    expect(result.isError).toBeFalsy();
  });

  it('SAPWrite REJECTS with safety error', async () => {
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: 'ZARC1_AUTH_FAIL',
      source: 'REPORT zarc1_auth_fail.',
      package: '$TMP',
    });
    expectToolError(result, 'blocked by safety');
  });

  it('SAPQuery REJECTS with safety error (no data scope)', async () => {
    const result = await callTool(client, 'SAPQuery', {
      sql: 'SELECT * FROM T000',
      maxRows: 1,
    });
    expectToolError(result, 'blocked');
  });

  it('SAPRead TABLE_CONTENTS REJECTS (blockData=true)', async () => {
    const result = await callTool(client, 'SAPRead', {
      type: 'TABLE_CONTENTS',
      name: 'T000',
      maxRows: 1,
    });
    expectToolError(result, 'blocked');
  });
});

describe('E2E Authorization — Viewer-Data profile', () => {
  // Server started with: --profile viewer-data --user ZMCP_VIEWER_DATA
  let client: Client;

  beforeAll(async () => {
    client = await connectClient(process.env.E2E_MCP_URL_VIEWER_DATA);
  });

  it('lists SAPQuery tool (has data scope)', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('SAPQuery');
    expect(names).not.toContain('SAPWrite');
  });

  it('SAPRead TABLE_CONTENTS — previews named table', async () => {
    const result = await callTool(client, 'SAPRead', {
      type: 'TABLE_CONTENTS',
      name: 'T000',
      maxRows: 5,
    });
    const text = expectToolSuccess(result);
    const data = JSON.parse(text);
    expect(data.columns).toContain('MANDT');
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('SAPQuery freestyle SQL REJECTS (no sql scope)', async () => {
    const result = await callTool(client, 'SAPQuery', {
      sql: 'SELECT * FROM T000',
      maxRows: 1,
    });
    expectToolError(result, 'blocked');
  });

  it('SAPWrite REJECTS', async () => {
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: 'ZARC1_AUTH_FAIL',
      source: 'REPORT zarc1_auth_fail.',
      package: '$TMP',
    });
    expectToolError(result, 'blocked');
  });
});

describe('E2E Authorization — Developer-Data profile', () => {
  // Server started with: --profile developer-data --user ZMCP_DEV_DATA
  let client: Client;

  beforeAll(async () => {
    client = await connectClient(process.env.E2E_MCP_URL_DEV_DATA);
  });

  it('lists all tools except SAPQuery freestyle', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('SAPRead');
    expect(names).toContain('SAPWrite');
    expect(names).toContain('SAPActivate');
    expect(names).toContain('SAPTransport');
    expect(names).toContain('SAPQuery');
  });

  it('SAPRead — reads source code', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });
    expectToolSuccess(result);
  });

  it('SAPRead TABLE_CONTENTS — previews table data', async () => {
    const result = await callTool(client, 'SAPRead', {
      type: 'TABLE_CONTENTS',
      name: 'T000',
      maxRows: 5,
    });
    expectToolSuccess(result);
  });

  it('SAPWrite create + SAPActivate — full write cycle', async () => {
    const progName = 'ZARC1_E2E_AUTH';

    // Create
    const createResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: progName,
      source: `REPORT ${progName.toLowerCase()}.\nWRITE: / 'Auth test'.`,
      package: '$TMP',
    });
    expectToolSuccess(createResult);

    // Activate
    const activateResult = await callTool(client, 'SAPActivate', {
      name: progName,
      type: 'PROG',
    });
    expect(activateResult.isError).toBeFalsy();

    // Cleanup: delete
    const deleteResult = await callTool(client, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: progName,
    });
    expect(deleteResult.isError).toBeFalsy();
  });

  it('SAPQuery freestyle SQL REJECTS (no sql scope)', async () => {
    const result = await callTool(client, 'SAPQuery', {
      sql: 'SELECT * FROM T000',
      maxRows: 1,
    });
    expectToolError(result, 'blocked');
  });

  it('SAPTransport list — developer can list transports', async () => {
    const result = await callTool(client, 'SAPTransport', {
      action: 'list',
      user: 'ZMCP_DEV_DATA',
    });
    // May be empty but should not error
    expect(result.isError).toBeFalsy();
  });
});

describe('E2E Authorization — Developer-SQL profile (full access)', () => {
  // Server started with: --profile developer-sql --user ZMCP_DEV_SQL
  let client: Client;

  beforeAll(async () => {
    client = await connectClient(process.env.E2E_MCP_URL_DEV_SQL);
  });

  it('SAPQuery freestyle SQL — succeeds', async () => {
    const result = await callTool(client, 'SAPQuery', {
      sql: 'SELECT * FROM T000',
      maxRows: 5,
    });
    const text = expectToolSuccess(result);
    const data = JSON.parse(text);
    expect(data.columns).toContain('MANDT');
  });

  it('everything else also works', async () => {
    // Read
    const read = await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });
    expectToolSuccess(read);

    // Table preview
    const table = await callTool(client, 'SAPRead', {
      type: 'TABLE_CONTENTS',
      name: 'T000',
      maxRows: 1,
    });
    expectToolSuccess(table);

    // Search
    const search = await callTool(client, 'SAPSearch', { query: 'CL_ABAP*', maxResults: 1 });
    expectToolSuccess(search);
  });
});

describe('E2E Authorization — SAP-level enforcement (ZMCP_NONE user)', () => {
  // Server started with: --profile developer-sql --user ZMCP_NONE
  // Server allows everything, but SAP rejects because user has no roles
  let client: Client;

  beforeAll(async () => {
    client = await connectClient(process.env.E2E_MCP_URL_NONE);
  });

  it('SAPRead fails with 403 from SAP (not ARC-1 safety)', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });
    // Error should come from SAP (403/authorization), not from ARC-1 safety
    expectToolError(result, 'authorization');
  });

  it('SAPSearch fails with authorization error', async () => {
    const result = await callTool(client, 'SAPSearch', { query: 'CL_ABAP*' });
    expectToolError(result);
  });
});
```

#### Option B: Single server with scope-based enforcement (advanced, for later)

A single ARC-1 instance with XSUAA or OIDC auth. Different test users get different JWT tokens with different scopes. Tests connect with different Bearer tokens.

This is the ideal setup for testing the per-request safety derivation (`deriveUserSafety()`) but requires OIDC/XSUAA infrastructure. Implement after Phase 1.

### 8.5 E2E Test Infrastructure

**Deployment script** (`tests/e2e/deploy-auth.sh`):

```bash
#!/usr/bin/env bash
# Deploy multiple ARC-1 instances for authorization E2E tests.
# Each instance runs a different profile with a different SAP user.

set -euo pipefail

BASE_PORT=3001
LOG_DIR="${E2E_LOG_DIR:-/tmp/arc1-e2e-auth-logs}"
mkdir -p "$LOG_DIR"

declare -A PROFILES=(
  [VIEWER]="viewer"
  [VIEWER_DATA]="viewer-data"
  [VIEWER_SQL]="viewer-sql"
  [DEV_DATA]="developer-data"
  [DEV_SQL]="developer-sql"
  [NONE]="developer-sql"  # max permissions, but SAP user has no roles
)

PORT=$BASE_PORT
for KEY in "${!PROFILES[@]}"; do
  PROFILE="${PROFILES[$KEY]}"
  USER_VAR="TEST_SAP_USER_${KEY}"
  PASS_VAR="TEST_SAP_PASS_${KEY}"

  SAP_USER="${!USER_VAR}" \
  SAP_PASSWORD="${!PASS_VAR}" \
  SAP_URL="${TEST_SAP_URL}" \
  SAP_CLIENT="${TEST_SAP_CLIENT:-001}" \
  SAP_TRANSPORT=http-streamable \
  node dist/index.js \
    --profile "$PROFILE" \
    --transport http-streamable \
    --port "$PORT" \
    > "$LOG_DIR/server-${KEY}.log" 2>&1 &

  echo "E2E_MCP_URL_${KEY}=http://localhost:${PORT}/mcp"
  PORT=$((PORT + 1))
done

echo "All servers started. Logs in $LOG_DIR"
```

### 8.6 Test Summary

| Level | File | Tests | SAP Required | What It Validates |
|-------|------|-------|--------------|-------------------|
| **Unit** | `tests/unit/adt/safety.test.ts` | ~30 new | No | `blockData`, `deriveUserSafety()` logic |
| **Unit** | `tests/unit/handlers/intent.test.ts` | ~20 new | No | `hasRequiredScope()`, TOOL_SCOPES changes, SQL scope check |
| **Unit** | `tests/unit/server/config.test.ts` | ~8 new | No | Profile flag parsing |
| **Unit** | `tests/unit/server/http.test.ts` | ~7 new | No | OIDC scope extraction |
| **Unit** | `tests/unit/server/xsuaa.test.ts` | ~4 new | No | XSUAA `data`/`sql` scope extraction |
| **Integration** | `tests/integration/authorization.integration.test.ts` | ~40 new | Yes (7 users) | SAP-level auth enforcement per user/role |
| **E2E** | `tests/e2e/authorization.e2e.test.ts` | ~25 new | Yes (6 servers) | Full MCP protocol → scope → safety → SAP chain |
| | | **~134 total** | | |

### 8.7 CI Considerations

- **Unit tests:** Always run in CI (no SAP needed). `npm test`.
- **Integration tests:** Run when `TEST_SAP_URL` is set. Skip gracefully otherwise. Need the 7 SAP test users created once.
- **E2E tests:** Most expensive — start 6 ARC-1 server processes + need SAP. Run on-demand or nightly, not on every PR.
- **SAP user creation is a one-time setup.** Users and roles persist across test runs. Document the SU01/PFCG steps in INFRASTRUCTURE.md.

---

## 9. Appendix: Complete ARC-1 Operation Type -> SAP Auth Object Matrix

| ARC-1 Op Type | Code | SAP Auth Object | SAP Activity | HTTP Methods Used | Endpoints (count) |
|---------------|------|-----------------|--------------|-------------------|----|
| Read | R | S_DEVELOP (ACTVT=01), S_ADT_RES | Display | GET, POST | 21 |
| Search | S | S_ADT_RES | Read | GET | 2 |
| Query | Q | S_ADT_RES, S_SQL_VIEW | Read | POST | 1 |
| FreeSQL | F | S_ADT_RES, S_SQL_VIEW | Read | POST | 1 |
| Create | C | S_DEVELOP (ACTVT=01,02), S_ADT_RES | Change | POST | 1 |
| Update | U | S_DEVELOP (ACTVT=02), S_ADT_RES | Change | PUT | 1 |
| Delete | D | S_DEVELOP (ACTVT=06), S_ADT_RES | Delete | DELETE | 1 |
| Activate | A | S_DEVELOP (ACTVT=07), S_ADT_RES | Activate | POST | 2 |
| Test | T | S_ADT_RES | Read | POST | 1 |
| Lock | L | S_DEVELOP (ACTVT=02), S_ADT_RES | Change | POST | 1 |
| Intelligence | I | S_ADT_RES | Read | GET, POST | 5 |
| Transport | X | S_TRANSPRT, S_CTS_ADMI | Varies | GET, POST | 4 |
| **Total** | | | | | **36+** |
