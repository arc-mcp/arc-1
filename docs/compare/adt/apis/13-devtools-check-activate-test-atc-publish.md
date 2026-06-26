# Dev tools: syntax check, activation, AUnit, ATC, SRVB publish

**Inventory rows:** 42–48  
**Primary code:** `src/adt/devtools.ts`, `src/handlers/intent.ts`

### SAP ABAP-side: implementation & relevant objects

| API | ICF path (under `.../adt/`) | Typical packages / classes |
|-----|-----------------------------|----------------------------|
| **Syntax check** | **`checkruns`** | **`SEU_ADT`**: **`CL_SEU_ADT_RES_CHECK_RUN`**, **`CL_SEU_ADT_CHECK_RUN_RESULT`**, check helpers; check object XML namespace `http://www.sap.com/adt/checkrun`. |
| **Activation** | **`activation`** | **`SEU_ADT`**: **`CL_SEU_ADT_RES_ACTIVATION`**, **`CL_SEU_ADT_RES_ACT_*`** (background activation, URI builder). |
| **Publish SRVB** | **`businessservices`** → **`odatav2`** → **`publishjobs`** / **`unpublishjobs`** | **`SDDIC_ADT_SRVB_*`** / business services ADT (same family as SRVB read). |
| **ABAP Unit** | **`abapunit`** → **`testruns`** | **`SAUNIT_ADT`** (AUnit ADT — search **`CL_AUNIT_ADT*`** / **`CL_*ABAPUNIT*ADT*`**); config/result vendor MIME types. |
| **ATC** | **`atc`** → **`runs`**, **`atc`** → **`worklists`** | **`SATC_ADT`** / ATC worklist ADT resources (**`CL_ATC_ADT_*`** pattern). |

Shared framework: **`SADT_REST`**, **`CL_ADT_REST_RESOURCE`**, **`SEU_ADT`** XSLT for check/activation payloads where used.

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## A. `POST /sap/bc/adt/checkruns`

### Contract

| Item | Value |
|------|--------|
| Content-Type | `application/vnd.sap.adt.checkobjects+xml` |
| Accept | `application/vnd.sap.adt.checkmessages+xml` |
| Body | `checkObjectList` with `adtcore:uri="{objectUrl}"` |

### ARC-1

- `syntaxCheck` — **`Read`**, `'SyntaxCheck'` (POST used for check — matches SAP ADT pattern).
- **406/415:** **Yes**

### Tests

- **Unit:** `devtools.test.ts` extensive.

### Verdict

**OK**

---

## B. `POST /sap/bc/adt/activation?method=activate&preauditRequested=true`

### Contract

| Item | Value |
|------|--------|
| Content-Type | `application/xml` |
| Accept | `application/xml` |
| Body | `objectReferences` |

### ARC-1

- `activate`, `activateBatch` — `Activate`, `'Activate'` / `'ActivateBatch'`.

### Tests

- **Unit:** `devtools.test.ts`; **integration** via CRUD / transport flows.

### Verdict

**OK**

---

## C. `POST .../businessservices/odatav2/publishjobs` / `unpublishjobs`

### Contract

- Query: `servicename`, `serviceversion` (encoded).
- Body: small `objectReferences` XML via `publishBody`.

### ARC-1

- `publishServiceBinding` / `unpublishServiceBinding` — **`Activate`** type (same as activate in safety layer).
- Accept: `application/*`

### Verdict

**OK** where OData v2 publish API exists.

---

## D. `POST /sap/bc/adt/abapunit/testruns`

### Contract

| Item | Value |
|------|--------|
| Content-Type | `application/vnd.sap.adt.abapunit.testruns.config.v4+xml` |
| Accept | `application/vnd.sap.adt.abapunit.testruns.result.v2+xml` |

### ARC-1

- `runUnitTests` — `Test`, `'RunUnitTests'`.
- **406/415:** **Yes** — version skew risk between **v4 config** and **v2 result**.

### Tests

- **Unit:** `devtools.test.ts` with XML fixtures.

### Alternatives

- SAP may expose newer result MIME — monitor **406**.

### Actions

| Action | Priority |
|--------|----------|
| On 406, docs/compare Eclipse ADT traffic for updated MIME pair | Medium |

**Verdict:** **OK** today; **MIME** is maintenance hotspot.

---

## E. `POST /sap/bc/adt/atc/runs?worklistId=1` + `GET /sap/bc/adt/atc/worklists/{id}`

### Contract

- Create: `application/xml` ATC run XML.
- Worklist GET: `Accept: application/atc.worklist.v1+xml`

### ARC-1

- `runAtcCheck` — **`Read`** for ATC (POST+GET sequence) — `'RunATCCheck'`.
- Parses `worklistId` from create response with fallbacks.

### Tests

- **Unit:** `devtools.test.ts`.

### Verdict

**OK**; **worklist id = 1** default is SAP convention used in code — document if systems differ.
