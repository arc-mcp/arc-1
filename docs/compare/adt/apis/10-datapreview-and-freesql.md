# Data preview (DDIC) and freestyle SQL

**Inventory rows:** 35–36  
**Primary code:** `src/adt/client.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`datapreview`** → **`ddic`** (named entity preview) or **`freestyle`** (SQL console). |
| **Typical packages** | Data preview / DB access ADT (**`SABP_DBC2ABAP_ADT`**, **`SQLM_ADT_TOOLS`**, and related **`CL_ADT_SQL*`** / service resource classes — names vary by release). |
| **Typical classes** | Search **`CL_*DATAPREVIEW*`**, **`CL_ADT_SQL1_SERVICE_RESOURCE`** (example from SAP ADT SQL integration packages). |
| **TADIR / object types** | Underlying access uses DDIC entities / views; authorization via **`S_TABU_DIS`**, **`S_SQL_*`**, and ADT-specific checks. |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `POST /sap/bc/adt/datapreview/ddic?rowNumber={maxRows}&ddicEntityName={table}`

### SAP system

- **Named table preview** — subject to **`blockData`** (`OperationType.Query`).
- Auth: data access + ADT data preview services.

### Contract

| Item | Value |
|------|--------|
| Method | `POST` |
| Content-Type | `text/plain` |
| Body | Optional SQL WHERE fragment or empty |

### ARC-1

- `getTableContents` — `Query`, `'GetTableContents'`.
- **CSRF:** Yes.
- **406/415:** **Yes**

### Tests

- **Integration:** `T000` table contents.
- **Safety:** read-only client can read table data when `blockData` false; default **viewer** profiles may block.

### Verdict

**OK**

---

## B. `POST /sap/bc/adt/datapreview/freestyle?rowNumber={maxRows}`

### SAP system

- **Freestyle SQL** — **`blockFreeSQL`** + `OperationType.FreeSQL`.
- Parser quirks on some releases (SAP Note **3605050** referenced in tool schema / docs).

### Contract

| Item | Value |
|------|--------|
| Body | Full SQL statement, `text/plain` |

### ARC-1

- `runQuery` — `FreeSQL`, `'RunQuery'`.

### Tests

- **Integration:** where SQL allowed; **safety** tests block free SQL in read-only / viewer.

### Alternatives

- **BTP ABAP:** SQL console may be **restricted** or different — expect errors.

### Verdict

**OK** with safety gates; **operational** risk is **SAP SQL parser** differences, not URL.
