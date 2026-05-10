# OO: classes and interfaces

**Inventory rows:** 8–11  
**Primary code:** `src/adt/client.ts`, `src/handlers/intent.ts`

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`oo`** → **`classes`** (metadata on class node; `source/main`, `includes/...` below). Interfaces: **`oo`** → **`interfaces`**. |
| **Typical packages** | **`SEO_ADT`** / **`SEO_UNIT`** (Object Oriented ADT — naming varies; search **`CL_*OO*ADT*`** / **`CL_OO_ADT_*`** on your system), **`SWB_ADT_TOOL`** (generic workbench REST base). |
| **Typical classes** | Resource controllers for **CLAS/OC** and **INTF/OI** inheriting from **`CL_ADT_REST_RESOURCE`** and/or **`CL_WB_ADT_REST_RESOURCE`**; local includes use dedicated include resource classes. |
| **TADIR / object types** | **R3TR** **CLAS**, **INTF**; ADT URIs use types **CLAS/OC**, **INTF/OI**. |

*Procedure:* [README](./README.md#sap-abap-where-server-side-code-lives-all-apis). Use **SICF** on `.../oo/classes/...` for the exact handler, then **SE24** where-used.

---

## A. `GET /sap/bc/adt/oo/classes/{name}/source/main`

### SAP system

- Standard ADT OO source resource (SEOI/SEOU stack).
- **Auth:** Class display / change authority as per `S_DEVELOP` + object.

### Contract

| Item | Value |
|------|--------|
| Method | `GET` |
| Path | `/sap/bc/adt/oo/classes/{encodeURIComponent(name)}/source/main` |
| Headers | Default `Accept: */*` |

### ARC-1

- `getClass` (no include), `getClassStructured` (parallel fetches).
- `checkOperation(..., Read, 'GetClass')`.
- **406/415:** **Yes**

### Tests

- **Integration:** `CL_ABAP_CHAR_UTILITIES`, includes, structured read, metadata.

### Verdict

**OK**

---

## B. `GET|PUT /sap/bc/adt/oo/classes/{name}/includes/{definitions|implementations|macros|testclasses}`

### Contract

- One include per request (comma-separated **client API** splits into multiple HTTP calls in `getClass`).
- Include writes use the normal ADT source update pattern: lock the parent class object URL (`/sap/bc/adt/oo/classes/{name}`), then `PUT` the include URL with the returned `lockHandle` and optional `corrNr`. Do not lock the include URL separately; class includes inherit the parent class lock.

### ARC-1

- Same `GetClass` safety name.
- `SAPWrite(action="update", type="CLAS", include=...)` routes to these include URLs for `definitions`, `implementations`, `macros`, and `testclasses`. Omitting `include` keeps the existing `/source/main` update route.

### Alternatives

- Missing include may 404 — client handles gracefully where implemented.

### Verdict

**OK**; confirm behavior for **cloud** restricted classes on BTP.

---

## C. `GET /sap/bc/adt/oo/classes/{name}` (metadata)

### Contract

| Item | Value |
|------|--------|
| Headers | **`Accept: application/xml`** explicitly set in `getClassMetadata` |

### ARC-1

- `checkOperation(..., Read, 'GetClassMetadata')`.
- **406/415:** **Yes** (406 may adjust Accept)

### Tests

- **Integration:** structured class / metadata tests; **Unit:** `xml-parser.test.ts` fixtures.

### Verdict

**OK**

---

## D. `GET /sap/bc/adt/oo/interfaces/{name}/source/main`

### ARC-1

- `getInterface` — `Read`, `'GetInterface'`.

### Tests

- **Integration:** standard interface read.

### Verdict

**OK**

---

## E. `POST /sap/bc/adt/oo/classes` / `POST .../oo/interfaces` (create)

### ARC-1

- `createObject` + `intent.ts` templates.
- **Write** safety: `Create`, read-only blocks.

### Verdict

**OK** with package + allowlist gates.
