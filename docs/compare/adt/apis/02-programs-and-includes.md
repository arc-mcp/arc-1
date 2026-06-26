# Programs and includes

**Inventory rows:** 4–7 (+ `POST` collections for create)  
**Primary code:** `src/adt/client.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`programs`** → **`programs`** (source under `.../source/main`); includes: `programs` → **`includes`**. |
| **Typical packages** | **`SEDI_ADT`** (SE Source Editor ADT — program/include **source** resources), **`SADT_TOOLS_CORE`** / **`SEU_ADT`** (XSLT such as **`SADT_ABAP_SOURCE_MAIN_OBJECT`**, **`SADT_ABAP_SOURCE_OBJECT`** for source serialization). |
| **Typical classes** | **`CL_SEDI_ADT_RES_SOURCE`** (and subclasses) — **GET** with URI attribute `source/main` reads ABAP source; **`CL_SEDI_ADT_RES_SOURCE_BASE`**; workbench integration may involve **`SWB_ADT_TOOL`** / **`CL_WB_ADT_REST_RESOURCE`**. |
| **Workbench types** | Repository objects **PROG/P**, **PROG/I** (TADIR **R3TR** **PROG**, **REPS** / includes as applicable). |
| **Create (`POST` collection)** | Same ICF subtree; **POST** body is object creation XML — handled by program/include **resource/collection** classes in **`SEDI_ADT`** / **`SWB_ADT_*`**. |

#### Per ARC-1 API (same SAP stack)

| ARC-1 method | URL suffix (after `.../programs/programs/{name}/`) | SAP objects |
|--------------|------------------------------------------------------|-------------|
| `getProgram` | `source/main` | **PROG/P**; resource **`CL_SEDI_ADT_RES_SOURCE`** hierarchy |
| `getTextElements` | `textelements` | Text pool / text elements resource (same **SEDI_ADT** family) |
| `getVariants` | `variants` | Variant resource (same family) |
| `getInclude` | *(under `.../programs/includes/{name}/`)* `source/main` | **PROG/I** / include; same **`CL_SEDI_ADT_*`** pattern |

*Procedure:* [README — SAP ABAP](README.md#sap-abap-where-server-side-code-lives-all-apis). *Verified example (on-prem):* **`CL_SEDI_ADT_RES_SOURCE`** implements **`GET`** for `/source/main` (SAP standard).

---

## A. `GET /sap/bc/adt/programs/programs/{name}/source/main`

### SAP system

- **ICF:** Program / source resources under `adt` → programs.
- **Auth:** `S_DEVELOP` / object access for program read; namespace programs need correct authority.
- **PP:** Per-user SAP authorization applies.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | `/sap/bc/adt/programs/programs/{name}/source/main` — `{name}` is `encodeURIComponent(name)` |
| Query | `sap-client`, `sap-language` |
| Headers | Default `Accept: */*` |
| Body | none |
| Response | Negotiated; typically **plain ABAP source** text |

### ARC-1

| Item | Detail |
|------|--------|
| Caller | `getProgram` — `checkOperation(..., Read, 'GetProgram')` |
| Cache | `intent.ts` may use `cachedGet('PROG', ...)` |
| Errors | `AdtApiError` 404 for missing program; `AdtSafetyError` if Read disallowed |
| 406/415 | **Yes** |

### Tests

- **Unit:** `client.test.ts`, `http.test.ts`
- **Integration:** `adt.integration.test.ts` — `RSHOWTIM`, non-existent program
- **E2E:** fixtures use programs in `$TMP`

### Alternatives

- **BTP ABAP:** Classic **PROG** may be restricted or absent; integration tests may expect failures on cloud-only stacks.
- **ETag / 304:** SAP may support conditional GET; ARC-1 does not send `If-None-Match` — optional future optimization, not a bug.

### Actions & verdict

**Verdict:** **OK** for on-prem and systems with reports. **Document** BTP limitations in ops runbook if not already.

---

## B. `GET .../textelements` and `GET .../variants`

### Contract

- Same base as (A), suffix `/textelements` or `/variants`.
- **GET**, `Accept: */*` default.

### ARC-1

- `getTextElements`, `getVariants` — `Read`, operation names `'GetTextElements'`, `'GetVariants'`.
- **406/415:** **Yes**

### Tests

- Primarily **unit** / handler paths; **integration** coverage thinner than `getProgram` — consider adding one integration case if regressions appear.

### Actions & verdict

| Action | Priority |
|--------|----------|
| Optional: add **integration** smoke for textelements/variants on a known program | Low |

**Verdict:** **OK**; integration depth **lighter** than main source read.

---

## C. `GET /sap/bc/adt/programs/includes/{name}/source/main`

### SAP system / contract

- Same pattern as program source; object is **include** (REPS).

### ARC-1

- `getInclude` — `Read`, `'GetInclude'`.

### Tests

- **Unit** / CRUD tests use program URLs; include read **less** covered in integration — **gap to watch**.

### Actions & verdict

| Action | Priority |
|--------|----------|
| Add integration test for a known standard include if CI stability allows | Low |

**Verdict:** **Assumed OK** (same SEDI stack as programs); **verify** on target system.

---

## D. `POST /sap/bc/adt/programs/programs` (create collection)

### SAP system

- **ICF:** Collection POST for new program.
- **Auth:** Create + package; transport if non-local.

### Contract

| Item | Value |
|------|--------|
| Method | `POST` |
| Path | `/sap/bc/adt/programs/programs[?corrNr=]` |
| Content-Type | `application/xml` (AFF/object XML from handler) |
| CSRF | Required — auto via `http.post` |

### ARC-1

- `createObject` in `crud.ts` — `checkOperation(..., Create, 'CreateObject')`; `intent.ts` builds body and parent URL.
- **406/415:** **Yes** (415 may fallback Content-Type)

### Tests

- **Integration:** batch create, CRUD lifecycle, transport tests.

### Verdict

**OK** where write + package allowlists permit.
