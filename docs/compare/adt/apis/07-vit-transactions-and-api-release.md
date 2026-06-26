# VIT transactions and API release state

**Inventory rows:** 25–26  
**Primary code:** `src/adt/client.ts`

### SAP ABAP-side: implementation & relevant objects

#### Transactions (VIT)

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`vit`** → **`wb`** → **`object_type`** → **`trant`** → **`object_name`** → `{tcode}`. |
| **Typical packages** | VIT + workbench integration (search packages **`VIT*`** + **`ADT`**, or **`SWB_ADT_*`** helpers). |
| **Typical classes** | VIT ADT resource classes for transaction metadata (**`CL_*VIT*ADT*`** pattern — confirm via SICF handler). |
| **TADIR / object types** | **TRAN** (T-code). |

#### API release state

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`apireleases`** → `{encoded-object-uri}`. |
| **Typical packages** | **`S_ARS_ADT`** (API release / clean-core ADT). |
| **Typical classes** | **`CL_ARS_ADT_BASE_RESOURCE`** and successors (release-state XML, MIME **`application/vnd.sap.adt.apirelease.v10+xml`**). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET /sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`

### SAP system

- **VIT** (Workbench integration for transactions).
- **ICF:** Must be active for transaction metadata.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | `encodeURIComponent(name)` on final segment |

### ARC-1

- `getTransaction` — `Read`, `'GetTransaction'`.
- **406/415:** **Yes**

### Tests

- **Integration:** `SE38` metadata; non-existent returns empty-handling path per test description.

### Verdict

**OK**

---

## B. `GET /sap/bc/adt/apireleases/{objectUri}`

### SAP system

- **ABAP Cloud / clean core** API release tooling; may **404** on older on-prem where feature absent.

### Contract

| Item | Value |
|------|--------|
| Path | **Full** object URI **percent-encoded as a single path segment** |
| Accept | `application/vnd.sap.adt.apirelease.v10+xml` |

### ARC-1

- `getApiReleaseState` — `Read`, `'GetApiReleaseState'`.
- **406/415:** **Yes**

### Tests

- **Unit:** `intent.test.ts` mocks; **Integration** coverage depends on `SAPRead` COMPONENTS / tool usage.

### Alternatives

- SAP may introduce **v11+** API release MIME — watch for **406**.

### Actions

| Action | Priority |
|--------|----------|
| Add integration skip-if-not-supported for `apireleases` on 404 | Low |

**Verdict:** **OK** when feature exists; **graceful degradation** on missing feature is **SAP-side 404** — ensure handlers surface a clear message (review `intent.ts`).
