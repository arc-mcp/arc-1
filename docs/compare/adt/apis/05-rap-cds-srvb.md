# RAP / CDS: DDLS, BDEF, SRVD, DDLX, SRVB

**Inventory rows:** 15–19  
**Primary code:** `src/adt/client.ts`, `src/handlers/intent.ts`, `src/adt/devtools.ts` (activation batch URLs in tests)

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`ddic`** → **`ddl`** → **`sources`** (DDLS); **`ddic`** → **`srvd`** → **`sources`** (SRVD); **`ddic`** → **`ddlx`** → **`sources`** (DDLX); **`bo`** → **`behaviordefinitions`** (BDEF); **`businessservices`** → **`bindings`** (SRVB). |
| **Typical packages** | **`SDDIC_ADT_DDLS_CORE`**, **`SDDIC_ADT_SRVB_CORE`**, **`SDDIC_ADT_SRVB_ODATAV2`** / **`ODATAV4`**, **`SDDIC_ADT_SRVB_*`**, behavior/RAP **`SBOBT`**, **`/BOBF/`** ADT packages (BDEF), metadata extension packages under **`SDDIC_ADT_*`**. |
| **Typical classes** | DDIC/RAP resource classes (often **`CL_*DDIC*ADT*`**, **`CL_ADT_ODATAV2_RESOURCE`**, **`CL_ADT_ODATAV4_RESOURCE`**, **`CL_ADT_SCHEMA_SERVICE_RESOURCE`** — search in **`SDDIC_ADT_*`**); SRVB binding XML via business services ADT facade. |
| **TADIR / object types** | **DDLS**, **BDEF**, **SRVD**, **DDLX**, **SRVB** (R3TR types; ADT URI suffixes as used by ARC-1). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `GET .../ddic/ddl/sources/{name}/source/main` (DDLS)

### SAP system

- Requires RAP/CDS ADT support (basis release dependent).
- **Feature probe:** `features.ts` uses `GET /sap/bc/adt/ddic/ddl/sources` for `rap`.

### Contract

- **GET**, encoded name, default `Accept: */*`.

### ARC-1

- `getCdsView` — `Read`, `'GetCdsView'`.
- **406/415:** **Yes**

### Tests

- **Integration:** DDLX tests exist; DDLS may vary by fixture availability.

### Verdict

**OK** on RAP-capable systems.

---

## B. `GET .../bo/behaviordefinitions/{name}/source/main` (BDEF)

### ARC-1

- `getBehaviorDefinition` — `'GetBehaviorDefinition'`.

### Verdict

**OK** where BDEF exists.

---

## C. `GET .../ddic/srvd/sources/{name}/source/main` (SRVD)

### ARC-1

- `getServiceDefinition` — `'GetServiceDefinition'`.

### Verdict

**OK**

---

## D. `GET .../ddic/ddlx/sources/{name}/source/main` (DDLX)

### Tests

- **Integration:** explicit DDLX read tests in `adt.integration.test.ts`.

### Verdict

**OK**

---

## E. `GET .../businessservices/bindings/{name}` (SRVB)

### Contract

| Item | Value |
|------|--------|
| Headers | `Accept: application/vnd.sap.adt.businessservices.v1+xml` (see `client.ts`) |

### ARC-1

- `getServiceBinding` — `'GetServiceBinding'`.
- **406/415:** **Yes** — important for **version-specific** vendor MIME types.

### Tests

- **Integration:** SRVB read + V2 binding cases.

### Alternatives

- Newer SAP versions might prefer a **newer v2+ MIME** — if integration hits **406**, capture response and extend Accept list or negotiation.

### Actions & verdict

| Action | Priority |
|--------|----------|
| If 406 seen in CI on newer systems, add **Accept** variant or document required basis | Medium |

**Verdict:** **Mostly OK**; **highest MIME negotiation risk** in this group.
