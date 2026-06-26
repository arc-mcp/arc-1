# Repository: quick search, source text search, package tree

**Inventory rows:** 27–29  
**Primary code:** `src/adt/client.ts`, `src/adt/features.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`repository`** → **`informationsystem`** → **`search`** (quick search); **`textSearch`** (source search); **`nodestructure`** (package tree — often POST). |
| **Typical packages** | **`SRIS_ADT`** (Repository Information System ADT — e.g. **`CL_RIS_ADT_SOURCE_HANDLER`**, usage-reference stack), **`SEU_ADT`** (project explorer / node structure resources such as **`CL_SEU_ADT_RES_REPO_STRUCTURE`**, **`CL_SEU_ADT_RES_OBJ_STRUCTURE`**), **`SWB_ADT_*`**. |
| **Typical classes** | Search + text search: RIS ADT handlers; **nodestructure**: SEU ADT “repository structure” resources. |
| **Related components** | Basis search framework **BC-DWB-AIE** (SAP Notes for text search errors). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET .../repository/informationsystem/search?operation=quickSearch&query=...&maxResults=...`

### SAP system

- **ICF:** `informationsystem/search` must be active.
- **Auth:** `S_ADT_RES` typical; object catalog visibility.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Query | `operation=quickSearch` (required), `query`, `maxResults` |

### ARC-1

- `searchObject` — `Search`, `'SearchObject'`.
- **406/415:** **Yes**

### Tests

- **Integration:** multiple search tests; **Feature probe** uses `CL_ABAP_*` quick search (`probeAuthorization`).

### Verdict

**OK**

---

## B. `GET .../repository/informationsystem/textSearch?searchString=...&maxResults=...[&objectType=][&packageName=]`

### SAP system

- **ICF:** `textSearch` node must be active (error message in `features.ts` references SICF path).
- **Auth:** Often stricter; 403 classified in `classifyTextSearchError`.
- **SAP Note:** 3605050 mentioned for 500-class search framework errors.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Query | `searchString`, `maxResults`; optional `objectType`, `packageName` |

### ARC-1

- `searchSource` — `Search`, `'SearchSource'`.
- **406/415:** **Yes**

### Tests

- **Integration:** search tests; **probeTextSearch** at startup.

### Alternatives

- Basis **&lt; 7.51** may return **501** — handled in `classifyTextSearchError`.

### Verdict

**OK** when service active; failures are **environment/config**, not client URL shape.

---

## C. `POST .../repository/nodestructure?parent_type=DEVC/K&parent_name={pkg}&withShortDescriptions=true`

### Contract

| Item | Value |
|------|--------|
| Method | `POST` |
| Content-Type | `application/xml` |
| Body | `undefined` (empty) in current code — SAP accepts POST for tree expansion |

### ARC-1

- `getPackageContents` — `Read`, `'GetPackage'` (note: operation name says GetPackage).
- **CSRF:** Yes (POST).
- **406/415:** **Yes**

### Tests

- **Unit:** `xml-parser` discovery fixtures include nodestructure hrefs; **integration** for package browse may vary.

### Actions

| Action | Priority |
|--------|----------|
| Confirm integration test for `getPackageContents` on a known package (e.g. `$TMP`) | Medium |

**Verdict:** **OK** in code; **integration coverage** should be **explicitly confirmed** (add test if missing).
