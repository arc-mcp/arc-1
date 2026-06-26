# CTS transport requests

**Inventory rows:** 49–52  
**Primary code:** `src/adt/transport.ts`, `src/adt/safety.ts` (`checkTransport`)

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`cts`** → **`transportrequests`** (+ `/{id}`, `/newreleasejobs`). |
| **Typical packages** | CTS ADT transport manager — search packages `CTS*ADT*`, `SADT*CTS*`, or read handler package from **SICF**. |
| **Typical classes** | Transport organizer ADT facade classes processing **`application/vnd.sap.adt.transportorganizer*.v1+xml`** and tree **`transportorganizertree.v1+xml`**. |
| **TADIR / business objects** | **CTS** requests / tasks (E070, E071, …) behind the XML API. |
| **Auth** | **`S_TRANSPRT`**, CTS display vs change rights. |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## Safety

- **`enableTransports`** must be true for **any** call.
- **Writes** (`createTransport`, `releaseTransport`) also require **`transportReadOnly`** false.
- **`allowedTransports`** whitelist when non-empty.

---

## A. `GET /sap/bc/adt/cts/transportrequests[?user=]`

### Contract

| Accept | `application/vnd.sap.adt.transportorganizertree.v1+xml` |

### ARC-1

- `listTransports` — `'ListTransports'`.

### Tests

- **Unit:** `transport.test.ts`; **integration:** `transport.integration.test.ts`.

### Verdict

**OK**

---

## B. `GET /sap/bc/adt/cts/transportrequests/{id}`

### ARC-1

- `getTransport` — `'GetTransport'`.

### Verdict

**OK**

---

## C. `POST /sap/bc/adt/cts/transportrequests` (create)

### Contract

| Content-Type / Accept | `application/vnd.sap.adt.transportorganizer.v1+xml` |
| Body | `tm:root` XML |

### ARC-1

- `createTransport` — write flag **true** in `checkTransport`.

### Verdict

**OK**

---

## D. `POST /sap/bc/adt/cts/transportrequests/{id}/newreleasejobs` (release)

### ARC-1

- `releaseTransport` — **no body**; CSRF still sent.

### Verdict

**OK**

---

## Principal propagation

- Transport visibility is **per SAP user** — PP user must have **`S_TRANSPRT`** (and CTS visibility) or list/create will **403**.

### Verdict

**OK** with correct SAP auth + ARC-1 flags.
