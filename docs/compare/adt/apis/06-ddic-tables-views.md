# DDIC: tables, views, structures, domains, data elements

**Inventory rows:** 20–24  
**Primary code:** `src/adt/client.ts`, `src/adt/xml-parser.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`ddic`** → **`tables`**, **`views`**, **`structures`**, **`domains`**, **`dataelements`** (+ `/source/main` where used for technical definition source). |
| **Typical packages** | **`SDDIC_ADT_*`** (DDIC ADT — multiple subpackages for tables, domains, data elements, views). |
| **Typical classes** | DDIC ADT REST resource classes (search **`CL_*DDIC*ADT*RES*`** or **`CL_DDIC_ADT_*`** in **`SDDIC_ADT_*`** on your release). |
| **TADIR / object types** | **TABL**, **VIEW**, **DOMA**, **DTEL**, **STRU** (as R3TR; ADT exposes DDIC XML/source views). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET /sap/bc/adt/ddic/tables/{name}/source/main`

### SAP system

- Table definition source via ADT; auth for DDIC object.

### ARC-1

- `getTableDefinition` — `Read`, `'GetTableDefinition'`.
- **406/415:** **Yes**

### Tests

- **Integration:** table **contents** (`datapreview/ddic`) is covered; **table definition** source read may be **thinner** — confirm with grep.

### Actions

| Action | Priority |
|--------|----------|
| Consider one integration test reading `T000` or similar **definition** if not present | Low |

**Verdict:** **Assumed OK**; **confirm integration** coverage for `/source/main` vs only metadata elsewhere.

---

## B. `GET /sap/bc/adt/ddic/views/{name}/source/main`

### ARC-1

- `getViewDefinition` — `'GetViewDefinition'`.

### Verdict

**Assumed OK** (same as A).

---

## C. `GET /sap/bc/adt/ddic/structures/{name}/source/main`

### Tests

- **Integration:** `BAPIRET2`, `SYST`.

### Verdict

**OK**

---

## D. `GET /sap/bc/adt/ddic/domains/{name}`

### Contract

- **Object** endpoint (XML), not `/source/main`.

### ARC-1

- `getDomain` — `'GetDomain'`; `parseDomainMetadata`.

### Tests

- **Integration:** `MANDT`, `BUKRS` style cases.

### Verdict

**OK**

---

## E. `GET /sap/bc/adt/ddic/dataelements/{name}`

### ARC-1

- `getDataElement` — `'GetDataElement'`.

### Tests

- **Integration:** `MANDT`, `BUKRS`.

### Verdict

**OK**

---

## Create collections (`POST .../tables`, `.../structures`, etc.)

- Routed through `intent.ts` + `createObject`; **Create** safety + AFF validation paths.

### Verdict

**OK** when enabled.
