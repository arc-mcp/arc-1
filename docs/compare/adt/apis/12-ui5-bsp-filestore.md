# UI5 BSP filestore (ADT read-only)

**Inventory rows:** 39–41  
**Primary code:** `src/adt/client.ts`, `src/adt/features.ts` (ui5 probe)

### SAP ABAP-side: implementation & relevant objects

| Item | Detail |
|------|--------|
| **ICF path** | `...` → `adt` → **`filestore`** → **`ui5-bsp`** → **`objects`** (+ `/content` for listing / file body). |
| **Typical packages** | UI5 / BSP filestore ADT integration (search **`UI5*BSP*ADT*`**, **`FIORI*FILESTORE*`**, or **`SADT*UI5*`** pattern in SE80 on your SID). |
| **Typical classes** | REST resources serving Atom/XML directory listings and MIME-typed file payloads — **handler from SICF** is the reliable name. |
| **Related objects** | **BSP** applications (e.g. `/UI5/APP` paths) as repository objects; distinct from **`/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`** (OData deploy API). |

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## Feature gating

- **`features.ui5`:** If probe says unavailable, handlers return a **clear error** (see `intent.ts`) — not an `AdtApiError` from SAP.

### SAP system

- **ICF:** `/sap/bc/adt/filestore/ui5-bsp` must be active.
- **Auth:** Read access to BSP filestore.

---

## A. `GET /sap/bc/adt/filestore/ui5-bsp/objects[?name=&maxResults=]`

### Contract

| Item | Value |
|------|--------|
| Accept | `application/atom+xml` (explicit in `listBspApps`) |

### ARC-1

- `listBspApps` — `Read`, `'ListBSPApps'`.
- **406/415:** **Yes**

### Tests

- **Unit:** `xml-parser` BSP list fixtures; **integration** when UI5 feature on.

### Verdict

**OK** when service exists.

---

## B. `GET .../objects/{objectPath}/content` (folder listing)

### Contract

- Headers in code: **`Accept: application/xml`**, **`Content-Type: application/atom+xml`** (unusual pairing on GET — **verify** against SAP; harmless if ignored).

### ARC-1

- `getBspAppStructure` — `'GetBSPApp'`.

### Actions

| Action | Priority |
|--------|----------|
| Capture real request from Eclipse ADT and **diff headers**; remove redundant `Content-Type` on GET if SAP ignores it | Low |

**Verdict:** **Functionally OK** if systems accept; **header hygiene** could be improved.

---

## C. `GET .../objects/{objectPath}/content` (file bytes)

### Contract

- `Accept: application/xml`, `Content-Type: application/octet-stream` on **GET** — again **verify**; often **`Accept: application/octet-stream`** is more appropriate for binary.

### ARC-1

- `getBspFileContent` — `'GetBSPFile'`.

### Actions

| Action | Priority |
|--------|----------|
| Test with a real `.js` / `.properties` file; if corrupt, switch **Accept** to `*/*` or `application/octet-stream` | Medium |

**Verdict:** **Verify on system** — **possible MIME mismatch** for binary files.
