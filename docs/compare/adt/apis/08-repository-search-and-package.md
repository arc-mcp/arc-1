# Repository: quick search, source text search, package tree

**Inventory rows:** 27–29  
**Primary code:** `src/adt/client.ts`, `src/adt/features.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ADT paths** | `...` → `adt` → **`repository`** → **`informationsystem`** → **`search`** (quick search); lowercase **`textsearch`** (source search); **`nodestructure`** (package tree — often POST). The source-search collection must be confirmed through `/sap/bc/adt/discovery`; a 404 from an unmapped URI does not by itself prove an inactive dedicated SICF node. |
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

## B. `GET .../repository/informationsystem/textsearch?searchString=...&searchFromIndex=1&searchToIndex=...[&objectType=][&packageName=]`

### SAP system

- **Discovery:** the collection is lowercase `textsearch`; camel-case `textSearch` is unmapped and
  returns 404 `No suitable resource found` on 7.58/8.16.
- **Auth/support:** a generic 401/403 can be authorization-related, but the support resource also
  returns 403 `SADT_REST 020` when source search is disabled. Classify the response body, not status
  alone.
- **SAP Note:** 3605050 mentioned for 500-class search framework errors.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Query | `searchString`, 1-based `searchFromIndex`/`searchToIndex`; optional repeatable `packageName`, `userName`, `objectName`, `objectType`; optional `getAllResults`. There is no `maxResults` parameter. |
| Response | `textSearchResult` tree: `textSearchObjects/textSearchObject`, `adtMainObject`, and `textLines/textLine/content`. Object names and line positions are encoded in proxy URIs. |

### ARC-1

- `searchSource` — `Search`, `'SearchSource'`.
- The endpoint's type filter uses the named-item catalog's short `name` (`CLAS`, `FUNC`), not its
  slash-form `data` (`CLAS/OC`, `FUGR/FF`).
- **406/415:** **Yes**

### Tests

- **Unit:** request shape, paging, catalog type mapping, live-format XML parser, and support probe.
- **Live:** negative paths verified on 7.50/7.58/8.16. The maintained 7.58/8.16 systems currently
  report backend source search disabled, so a positive integration run remains environment-dependent.

### Alternatives

- Basis **7.50** may not advertise the collection and returns 404.
- Newer systems may advertise the resource family while the backend feature remains disabled
  (`SADT_REST 020` from support; `SRIS_SEARCH 006` from an attempted search).

### Verdict

**OK** after the lowercase endpoint/paging/parser correction. Availability is system-dependent and
must be probed without conflating backend-disabled and authorization responses.

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
