# Generic CRUD and package resolution

**Inventory rows:** 69–73 + **`GET {objectUrl}`** for package resolution  
**Primary code:** `src/adt/crud.ts`, `src/adt/client.ts` (`resolveObjectPackage`), `src/handlers/intent.ts`

### SAP ABAP-side: implementation & relevant objects

CRUD is **not one SAP class** — it delegates to the **same resource classes** as the object-type-specific reports ([`02`](02-programs-and-includes.md)–[`06`](06-ddic-tables-views.md), etc.).

| Operation | SAP-side behavior | Typical implementation |
|-----------|-------------------|-------------------------|
| **`POST ?_action=LOCK`** | ADT lock contract | Object resource (e.g. **`CL_SEDI_ADT_RES_SOURCE`**, **`CL_WB_ADT_REST_RESOURCE`** subclass) processes lock; response **`LOCK_HANDLE`**, **`CORRNR`** in **`application/vnd.sap.as+xml...lock.result`**. |
| **`POST ?_action=UNLOCK`** | Releases lock | Same resource family; **`UNLOCK`** + **`lockHandle`**. |
| **`POST` (create)** | Creates TADIR object | Collection resource on parent URL (`.../programs/programs`, `.../oo/classes`, …). |
| **`PUT .../source/main`** | Updates source | Source resource **`GET`/`PUT`** handling in **`SEDI_ADT`** / OO / DDIC ADT classes. |
| **`DELETE`** | Deletes object | Object resource **`delete`** method on same hierarchy. |
| **`GET` object URL** | Object metadata XML | Used for **`adtcore:packageRef`** — served by object’s **metadata** resource (not always the same class as source). |

**Relevant SAP object types (examples):** **PROG**, **CLAS**, **INTF**, **DDLS**, **TABL**, **FUGR**, … (R3TR) per URL.

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis). For a given `{objectUrl}`, open the matching leaf in **SICF** and follow the **handler → resource class**.

---

## Pattern summary

All operations apply to **object URLs** built from `objectUrlForType` / ADT URIs (programs, classes, DDIC, etc.).

| # | Method | Pattern | Function | Safety op type | `checkOperation` name |
|---|--------|---------|----------|----------------|----------------------|
| 69 | POST | `{objectUrl}?_action=LOCK&accessMode=...` | `lockObject` | Lock (MODIFY) / read path for non-MODIFY | `'LockObject'` |
| 70 | POST | `{objectUrl}?_action=UNLOCK&lockHandle=...` | `unlockObject` | *(none in crud — consider if this should be gated)* | — |
| 71 | POST | `{objectUrl}[?corrNr=]` | `createObject` | Create | `'CreateObject'` |
| 72 | PUT | `{sourceUrl}?lockHandle=...[&corrNr=...]` | `updateSource` | Update | `'UpdateSource'` |
| 73 | DELETE | `{objectUrl}?lockHandle=...[&corrNr=...]` | `deleteObject` | Delete | `'DeleteObject'` |

### SAP system

- **Stateful session:** `withStatefulSession` **required** for lock → PUT → unlock sequences (shared cookies + `X-sap-adt-sessiontype: stateful`).
- **ICF:** Underlying object services must allow POST/PUT/DELETE.
- **Auth:** `S_DEVELOP` activities for change; transport `corrNr` when object is transportable.
- **PP:** Same URLs; effective user from PP mapping.

### Contract highlights

| Call | Content-Type notes | CSRF |
|------|-------------------|------|
| LOCK | `Accept: application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result` | Yes |
| UNLOCK | default | Yes |
| Create | caller-supplied (often `application/xml`) | Yes |
| PUT source | `text/plain` | Yes |
| DELETE | default | Yes |

### ARC-1 errors

- **`AdtSafetyError`** before HTTP when operation type blocked (read-only, allowedOps, etc.).
- **`AdtApiError`** on SAP 4xx/5xx — includes lock conflicts, etc.
- **406/415:** **Yes** for all modifying methods.

### Tests

- **Unit:** `crud.test.ts`, `intent.test.ts`, integration CRUD lifecycle, transport integration.

### Alternatives

- Some systems return **423** locked — ensure message surfaces to MCP user (via `AdtApiError` body).

### Actions

| Action | Where | Priority |
|--------|--------|----------|
| Confirm whether **`unlockObject`** should call `checkOperation` for symmetry | `crud.ts` | Low (unlock usually follows successful lock in same session) |

**Verdict:** **OK** — architecture matches ADT lock protocol.

---

## `GET {objectUrl}` — `resolveObjectPackage`

### Purpose

- Fetch object metadata XML and **regex** extract `adtcore:packageRef` → `adtcore:name`.

### Contract

- **GET**, default `Accept: */*`.
- **406/415:** **Yes**

### ARC-1

- `resolveObjectPackage` — `Read`, `'ResolveObjectPackage'`.
- **Fragile if SAP changes XML shape** — currently regex-based.

### Actions

| Action | Where | Priority |
|--------|--------|----------|
| Prefer **XML parse** (`parseXml` + stable path) over regex for package | `client.ts` | Medium (robustness) |

### Verdict

**Works** but **regex is a maintenance risk** — **recommended improvement** documented above.

---

## Inventory section 21 (handler base paths)

- Not separate HTTP calls — **prefix builders** in `intent.ts` only.
- **Verdict:** **N/A** (no standalone contract).
