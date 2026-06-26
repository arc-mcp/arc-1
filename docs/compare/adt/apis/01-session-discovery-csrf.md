# Session: discovery and CSRF (`/sap/bc/adt/core/discovery`)

**Inventory rows:** 1–3  
**Primary code:** `src/adt/http.ts`, `src/adt/client.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `default_host` → `sap` → `bc` → `adt` → **`core`** → **`discovery`** (matches URL `/sap/bc/adt/core/discovery`). |
| **Typical packages** | **`SADT_REST`** (REST framework, CSRF/discovery integration), **`SADT_CORE_UTILITIES`**, core ADT service registration packages adjacent to `SADT_*` on your release. |
| **Typical classes** | Dispatcher / discovery handlers registered with the ADT REST router — often tied to **`IF_REST_HANDLER`** and **`CL_ADT_REST_*`**; exact handler name is on the **ICF node**. |
| **BAdIs / enhancements** | **`BADI_ADT_REST_RFC_APPLICATION`** (`SADT_REST`) — registers discoverable resources; auth **`BADI_ADT_REST_AUTHORIZATION`**. |
| **TADIR types** | **ICF** service + **CLAS** (handlers). |

*Procedure:* See [README — SAP ABAP: where server-side code lives](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## 1. `HEAD /sap/bc/adt/core/discovery` (CSRF token fetch)

### SAP system

- **ICF:** Node under `/sap/bc/adt/core/discovery` must be active (same tree as ADT core).
- **Auth:** Must succeed for the technical or interactive user; response must include **`X-CSRF-Token`** (not only `Required`).
- **PP:** Same path; identity determines SAP session and whether ADT is allowed.

### Contract

| Item | Value |
|------|--------|
| Method | `HEAD` |
| Path | `/sap/bc/adt/core/discovery` |
| Query | `sap-client`, `sap-language` appended by `buildUrl()` |
| Headers | `X-CSRF-Token: Fetch` (see `fetchCsrfToken` in `http.ts`) |
| Body | none |

### ARC-1

| Item | Detail |
|------|--------|
| Caller | `AdtHttpClient.fetchCsrfToken()`; triggered before **POST/PUT/PATCH/DELETE** if token empty; also on **403** retry for modifying methods |
| Safety | No `checkOperation` — internal transport concern |
| Errors | `AdtApiError` / `AdtNetworkError` from `request` path |
| 406/415 | **Unusual** on HEAD; retry logic still runs if SAP returned 406/415 |

### Tests

- **Unit:** `tests/unit/adt/http.test.ts` — CSRF fetch, cookie jar, 403 refresh patterns.
- **Integration:** Indirectly via “POST requests work (CSRF + cookie correlation)” in `adt.integration.test.ts`.

### Alternatives

- Some docs/scripts reference **`/sap/bc/adt/discovery`** (no `core`). ARC-1 **only** uses **`/sap/bc/adt/core/discovery`** — align external scripts (`scripts/e2e-deploy.sh`) with this.

### Actions & verdict

| Action | Owner | Priority |
|--------|--------|----------|
| Align `scripts/e2e-deploy.sh` and any doc that still curls `/sap/bc/adt/discovery` with **`core`** segment | Docs / CI | Medium |
| On new SAP version, confirm HEAD still returns token (SAP rarely changes this) | Ops | Low |

**Verdict:** Implementation matches common ADT client practice; **fix script/doc URL drift** where found.

---

## 2. `GET /sap/bc/adt/core/discovery` (CSRF retry / auth probe)

### SAP system

Same as HEAD; **GET** may return a larger service document than HEAD.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | `/sap/bc/adt/core/discovery` |
| Headers | Default `Accept: */*` then merged with extras on retry paths in `http.ts` |

### ARC-1

| Item | Detail |
|------|--------|
| Caller | `http.ts` — used when refreshing CSRF after **401/403** on modifying requests (see retry branch) |
| 406/415 | **Yes**, single retry with negotiation fallback |

### Tests

- Covered indirectly via `http.test.ts` and integration POST tests.

### Actions & verdict

**Verdict:** **OK** as transport-internal.

---

## 3. `GET /sap/bc/adt/core/discovery` (`getSystemInfo`)

### SAP system

- Requires read access to ADT discovery document.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | `/sap/bc/adt/core/discovery` |
| Response | XML service document; parsed by `parseSystemInfo` in `xml-parser.ts` |

### ARC-1

| Item | Detail |
|------|--------|
| Caller | `AdtClient.getSystemInfo()` — `checkOperation(..., Read, 'GetSystemInfo')` |
| Tool path | SAPRead `SYSTEM` via `intent.ts` |
| Errors | `AdtSafetyError` if Read blocked; `AdtApiError` on HTTP error |
| 406/415 | **Yes** |

### Tests

- **Integration:** `adt.integration.test.ts` — “gets structured system info with user”.

### Alternatives

- BTP / Steampunk may expose different discovery **content**; parser should tolerate missing fields (already defensive in practice).

### Actions & verdict

**Verdict:** **OK** for intended use; validate parser on each major SAP line if fields move.
