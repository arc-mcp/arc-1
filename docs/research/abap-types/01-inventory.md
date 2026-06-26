# ABAP Type Inventory & Research Plan

This is the master list of every ABAP object-type identifier ARC-1 currently exposes —
through schema enums, slash-form aliases, URL builders, switch cases, and tool descriptions.
Each row has its own `types/<short>.md` deep-dive document.

## Sources scanned

- `src/handlers/schemas.ts` — `SAPREAD_TYPES_ONPREM`, `SAPREAD_TYPES_BTP`,
  `SAPWRITE_TYPES_ONPREM`, `SAPWRITE_TYPES_BTP`, `SAPCONTEXT_TYPES_*`
- `src/handlers/intent.ts` — `SLASH_TYPE_MAP` (~line 2558), `objectBasePath` (~2667),
  `inferObjectType` (~2722), `mainObjectType`, all switch-on-type handlers
- `src/handlers/tools.ts` — type lists in tool descriptions
- `src/probe/catalog.ts` — probe entries
- `src/adt/client.ts` — getter methods (`getProgram`, `getClass`, …)

## Canonical short types (schema enums)

These are the strings ARC-1 accepts as `type` after slash-form normalization. Each gets a
deep-dive in `types/<short>.md`.

### Source-bearing object types

| Short | Suspected R3TR | Used in | Priority |
|---|---|---|---|
| `PROG` | R3TR PROG (program) | Read, Write, Context, Activate | P1 |
| `CLAS` | R3TR CLAS (class) | Read, Write, Context, Activate, Navigate | P1 |
| `INTF` | R3TR INTF (interface) | Read, Write, Context, Activate | P1 |
| `INCL` | R3TR PROG with attribute, or LIMU sub | Read, Write | P1 |
| `FUGR` | R3TR FUGR (function group) | Read, Write, Activate | **P0 — issue #218** |
| `FUNC` | LIMU FUNC under FUGR (pseudo as top-level) | Read, Write, Context | **P0 — issue #218** |

### DDIC / data dictionary types

| Short | Suspected R3TR | Used in | Priority |
|---|---|---|---|
| `TABL` | R3TR TABL (covers DD02L TRANSP + INTTAB + APPEND) | Read, Write | P1 (already addressed in PR #219, audit completeness) |
| `DOMA` | R3TR DOMA (domain) | Read, Write | P1 |
| `DTEL` | R3TR DTEL (data element) | Read, Write | P1 |
| `VIEW` | R3TR VIEW (DDIC view) | Read | P1 |
| `MSAG` | R3TR MSAG (message class) | Write only | P1 |
| `ENHO` | R3TR ENHO (enhancement implementation) | Read | P2 |
| `AUTH` | R3TR AUTH? Or pseudo? | Read | P2 |

### ABAP Cloud / RAP types

| Short | Suspected R3TR | Used in | Priority |
|---|---|---|---|
| `DDLS` | R3TR DDLS (CDS DDL source) | Read, Write, Context | P1 |
| `DCLS` | R3TR DCLS (CDS DCL source) | Read, Write | P2 |
| `DDLX` | R3TR DDLX (metadata extension) | Read, Write | P2 |
| `BDEF` | R3TR BDEF (behavior definition) | Read, Write | P1 |
| `SRVD` | R3TR SRVD (service definition) | Read, Write, Activate | P1 |
| `SRVB` | R3TR SRVB (service binding) | Read, Write, Activate | P1 |
| `SKTD` | R3TR SKTD (knowledge transfer document) | Read, Write | P3 |

### Workbench / container / pseudo types

| Short | Suspected R3TR | Used in | Priority |
|---|---|---|---|
| `DEVC` | R3TR DEVC (package) | Read, Manage | P1 |
| `TRAN` | R3TR TRAN (transaction) | Read | P2 |
| `BSP` | R3TR SICF? Or BSP/IWMO | Read | P2 |
| `BSP_DEPLOY` | UI5 ABAP repo (`/UI5/UI5_REPOSITORY_LOAD`) | Read | P2 |
| `SOBJ` | TADIR repository search synonym | Read | P3 |
| `FTG2` | Authorization field-group? | Read | P3 |

### Read-only "reports" — not real R3TR types

These are ARC-1 pseudo-types for cross-cutting reads. They don't map to TADIR; they're tool
"actions" disguised as types. Each gets a doc to confirm the API endpoints they call.

| Short | What it actually does | Priority |
|---|---|---|
| `TABLE_CONTENTS` | Table data preview via ADT data preview API | P2 |
| `SYSTEM` | System info / discovery aggregate | P3 |
| `COMPONENTS` | Software component list | P3 |
| `MESSAGES` | System log read | P3 |
| `TEXT_ELEMENTS` | Program text-element fetch | P3 |
| `VARIANTS` | Report variant fetch | P3 |
| `API_STATE` | API release state lookup | P2 |
| `INACTIVE_OBJECTS` | Inactive draft list per user | P2 |
| `VERSIONS` | Source revision list | P2 |
| `VERSION_SOURCE` | Specific revision body | P2 |

## Slash-form aliases in `SLASH_TYPE_MAP`

These are the slash codes ARC-1 currently *accepts* and normalizes to a canonical short
type. The audit must check every row: does the slash form actually exist in ADT? Does it
exist in TADIR? Or is it invented?

| Slash | Maps to | Hypothesis | Status |
|---|---|---|---|
| `PROG/P` | `PROG` | Real ADT subtype (program) | verify |
| `PROG/I` | `INCL` | Real ADT subtype (include) | verify |
| `CLAS/OC` | `CLAS` | Real ADT subtype (Object Class) | verify |
| `CLAS/LI` | `CLAS` | Local Impl include of class | verify |
| `INTF/OI` | `INTF` | Real ADT subtype (Object Interface) | verify |
| **`FUNC/FM`** | `FUNC` | **Suspected invented per #218** | **investigate** |
| `FUGR/F` | `FUGR` | FUGR top? | verify |
| `FUGR/FF` | `FUGR` | Function-group function (real per #218) | verify |
| `DDLS/DF` | `DDLS` | Real | verify |
| `DCLS/DL` | `DCLS` | Real | verify |
| `BDEF/BDO` | `BDEF` | Behavior Definition Object | verify |
| `SRVD/SRV` | `SRVD` | Real | verify |
| `SRVB/SVB` | `SRVB` | Real | verify |
| `DDLX/EX` | `DDLX` | Real | verify |
| `TABL/DT` | `TABL` | Real (transparent) | confirmed in PR #219 |
| `TABL/DS` | `TABL` | Real (structure) | confirmed in PR #219 |
| `STRU/DS` | `TABL` | Legacy alias kept after #218 | confirmed legacy |
| `DOMA/DD` | `DOMA` | Real | verify |
| `DTEL/DE` | `DTEL` | Real | verify |
| `MSAG/N` | `MSAG` | Real | verify |
| `DEVC/K` | `DEVC` | Real | verify |
| `TRAN/O` | `TRAN` | Real | verify |
| `VIEW/V` | `VIEW` | Real | verify |
| `SKTD/TYP` | `SKTD` | Real | verify |

## Research execution order

Process by priority. Within a priority, group by namespace (source-bearing vs DDIC vs
cloud) so each batch can share live-system probes.

1. **Wave 1 (P0 — issue #218 follow-up)**: `FUGR`, `FUNC`. These are the immediate ask.
2. **Wave 2 (P1 source-bearing)**: `PROG`, `CLAS`, `INTF`, `INCL`.
3. **Wave 3 (P1 DDIC)**: `TABL` (re-verify), `DOMA`, `DTEL`, `VIEW`, `MSAG`.
4. **Wave 4 (P1 cloud)**: `DDLS`, `BDEF`, `SRVD`, `SRVB`.
5. **Wave 5 (P2 misc)**: `DCLS`, `DDLX`, `DEVC`, `TRAN`, `BSP`, `BSP_DEPLOY`, `ENHO`,
   `AUTH`, `API_STATE`, `INACTIVE_OBJECTS`, `VERSIONS`, `VERSION_SOURCE`,
   `TABLE_CONTENTS`.
6. **Wave 6 (P3 pseudo / low-traffic)**: `SKTD`, `SOBJ`, `FTG2`, `SYSTEM`, `COMPONENTS`,
   `MESSAGES`, `TEXT_ELEMENTS`, `VARIANTS`.

## Live verification commands (reusable)

```bash
# ADT object-type discovery against a4h
arc1-cli call SAPManage --action probe

# Direct ADT URL probe
curl -u <user>:<pass> -H 'Accept: application/vnd.sap.adt.repository.typestructure.v2+xml' \
  'https://a4h:50001/sap/bc/adt/repository/typestructure'

# Search by objectType slash code
curl -u <user>:<pass> \
  'https://a4h:50001/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&objectType=TABL%2FDT&maxResults=5'
```

## Issue-#218 follow-up questions specific to FUNC/FUGR

- Does `R3TR FUNC` exist? (Hypothesis from comment: no — FUNC is only `LIMU FUNC` under
  parent `FUGR`.)
- Does ADT ever return `FUNC/FM` as `<adtcore:objectType>`? (Hypothesis: no, it returns
  `FUGR/FF` for individual function modules.)
- Does abap-file-formats define a `func/` directory? (Hypothesis: no — function modules
  are serialized as part of the FUGR file format.)
- What does `WBOBJTYPE` (or eclipse `CL_WB_OBJECT_TYPE`) say?
- Does ARC-1's `SLASH_TYPE_MAP['FUNC/FM']` ever get hit by real traffic, or only by users
  who wrongly typed `FUNC/FM` based on ARC-1's own (incorrect) prior docs?

The research must answer these for every analogous suspect alias, not just `FUNC/FM`.
