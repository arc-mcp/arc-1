# Code intelligence: definition, references, where-used, completion

**Inventory rows:** 30–34  
**Primary code:** `src/adt/codeintel.ts`, `src/handlers/intent.ts` (SAPNavigate)

### SAP ABAP-side: implementation & relevant objects

| Endpoint area | ICF segment | Typical packages / classes |
|---------------|-------------|------------------------------|
| **Definition** | `...` → **`navigation`** → **`target`** | Navigation ADT (search **`CL_*NAV*ADT*`** / handler from SICF on `navigation/target`). |
| **References (GET)** | `...` → **`repository`** → **`informationsystem`** → **`usageReferences`** | **`SRIS_ADT`**, **`CL_RIS_ADT_*`** (simpler object reference list). |
| **Where-used scope + POST** | same + **`usageReferences/scope`** | **`SRIS_ADT`** / RIS usage-reference request handlers; vendor MIME **`application/vnd.sap.adt.repository.usagereferences.*+xml`**. |
| **Code completion** | `...` → **`abapsource`** → **`codecompletion`** → **`proposals`** | **`SEDI_ADT`**: **`CL_SEDI_ADT_RES_APP_ABAPSOURCE`** registers `/abapsource/...`; **`S_CODE_COMPLETION_ADT`** (e.g. **`CL_CC_ADT_*`** from registration constants in SAP standard). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## Shared notes

- All are **`OperationType.Intelligence`** — gated by **`I`** in `allowedOps` (default profiles include it for developer tools).
- **POST** bodies are often **full source** (`text/plain`) — large payloads possible.

---

## A. `POST /sap/bc/adt/navigation/target?uri={sourceUrl}&line=&column=`

### Contract

| Item | Value |
|------|--------|
| Body | Current source text, `Content-Type: text/plain` |
| Accept | `application/xml` (explicit) |

### ARC-1

- `findDefinition` — `'FindDefinition'`.
- **406/415:** **Yes**

### Tests

- **Unit:** `codeintel.test.ts`.

### Verdict

**OK**

---

## B. `GET .../usageReferences?uri={objectUrl}`

### Contract

- **GET**, `Accept: application/xml`.

### ARC-1

- `findReferences` — `'FindReferences'`.

### Verdict

**OK**; simpler reference list than scope-based where-used.

---

## C. `POST .../usageReferences/scope`

### Contract

| Item | Value |
|------|--------|
| Content-Type | `application/xml` |
| Body | `usageReferences:scopeRequest` with `objectReference uri="..."` |

### ARC-1

- `getWhereUsedScope` — `'FindWhereUsed'`.

### Verdict

**OK**

---

## D. `POST .../usageReferences?uri={objectUrl}` (detailed where-used)

### Contract

| Item | Value |
|------|--------|
| Content-Type | `application/vnd.sap.adt.repository.usagereferences.request.v1+xml` |
| Accept | `application/vnd.sap.adt.repository.usagereferences.result.v1+xml` |

### ARC-1

- `findWhereUsed` — `'FindWhereUsed'`.
- **406/415:** **Yes** — **critical** if SAP bumps vendor MIME versions.

### Alternatives

- Older systems may **ignore** `objectType` filter (noted in tool schema).

### Actions

| Action | Priority |
|--------|----------|
| If 406 in CI, extend Accept / Content-Type variants per SAP version | Medium |

**Verdict:** **OK**; **MIME version** is the main long-term risk.

---

## E. `POST .../abapsource/codecompletion/proposals?uri=&line=&column=`

### Contract

- Body: `text/plain` source; `Accept: application/xml`.

### ARC-1

- `getCompletion` — `'GetCompletion'`.

### Tests

- **Unit:** `codeintel.test.ts`.

### Verdict

**OK**
