# Function groups and function modules

**Inventory rows:** 12–14  
**Primary code:** `src/adt/client.ts`, `src/handlers/intent.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`functions`** → **`groups`** → `{group}` → **`fmodules`** / group `source/main`. |
| **Typical packages** | **`SFUNC_ADT`** (function module ADT integration). |
| **Typical classes** | **`CL_FB_ADT_RES_FUNC_SOURCE`** (FM source resource); related **`CL_FB_ADT_*`** resource helpers. |
| **TADIR / object types** | **R3TR FUGR** (function group, top-level). Function modules are **LIMU FUNC** sub-objects under the parent FUGR — there is no `R3TR FUNC` and ADT does not emit `FUNC/FM`. ADT slash codes verified live (a4h S/4HANA 2023 + npl NW 7.50, 2026-05-08): **`FUGR/F`** (group container) and **`FUGR/FF`** (function module under group). See research/abap-types/types/{fugr,func}.md. |

*Procedure:* [README](./README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET /sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main`

### SAP system

- **ICF:** ADT function module resources.
- **Auth:** Function group / module display; cloud may restrict classic FUGR/FM.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | Both `group` and `name` are `encodeURIComponent` |
| Headers | Default `Accept: */*` |

### ARC-1

- `getFunctionModule` — `Read`, `'GetFunctionModule'`.
- **406/415:** **Yes**

### Tests

- **Integration:** function group structure; **Unit:** client tests for FM path.

### Alternatives

- **BTP ABAP:** Classic function modules may be **unsupported** — expect 403/404; `btp-abap.*.integration.test.ts` may assert that.

### Actions & verdict

| Action | Priority |
|--------|----------|
| Document “FM read only on stacks that expose FUGR ADT” in ops notes | Low |

**Verdict:** **OK** on classic stacks; **expect failures** on restricted cloud profiles — not necessarily an ARC-1 defect.

---

## B. `GET /sap/bc/adt/functions/groups/{name}`

### ARC-1

- `getFunctionGroup` — `Read`, `'GetFunctionGroup'`.

### Verdict

**OK** (same caveats as A).

---

## C. `GET /sap/bc/adt/functions/groups/{name}/source/main`

### ARC-1

- `getFunctionGroupMain` — `Read`, `'GetFunctionGroupMain'`.

### Verdict

**OK**

---

## D. `POST /sap/bc/adt/functions/groups` (create)

- Via `createObject`; **Create** safety.

### Verdict

**OK** when allowed by config and SAP.
