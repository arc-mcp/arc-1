# Feature probes and authorization probes

**Inventory rows:** 60–68  
**Primary code:** `src/adt/features.ts`

### SAP ABAP-side: implementation & relevant objects

Probes call **the same ICF services** as the real features (no separate probe code on SAP side). Map each probe URL to the report that documents that API:

| Probe # | Path | See report |
|---------|------|------------|
| 60 | `/sap/bc/adt/ddic/sysinfo/hanainfo` | DDIC/HANA info ADT — **SICF** under `ddic/sysinfo`; package often **`SDDIC_*`** / HANA info tool. |
| 61 | `/sap/bc/adt/abapgit/repos` | abapGit ADT integration — **abapGit** SAP package (e.g. **`/ABAPGIT/*`**) + ICF under `abapgit`. |
| 62 | `/sap/bc/adt/ddic/ddl/sources` | [`05-rap-cds-srvb.md`](05-rap-cds-srvb.md) (DDLS collection). |
| 63 | `/sap/bc/adt/debugger/amdp` | Debugger ADT — **`SWDA_DEBUGGER_ADT`** / similar; ICF `debugger`. |
| 64 | `/sap/bc/adt/filestore/ui5-bsp` | [`12-ui5-bsp-filestore.md`](12-ui5-bsp-filestore.md). |
| 65, 68 | `/sap/bc/adt/cts/transportrequests` | [`14-cts-transports.md`](14-cts-transports.md). |
| 66 | `.../textSearch?...` | [`08-repository-search-and-package.md`](08-repository-search-and-package.md). |
| 67 | `.../search?...` | [`08-repository-search-and-package.md`](08-repository-search-and-package.md). |

**Non-ADT probe:** `GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` — **IWFND / Gateway** service, not `/sap/bc/adt/`.

*Procedure:* [README](README.md#sap-abap-where-server-side-code-lives-all-apis).

---

## Important implementation note

- File header comments say probes use **HEAD**, but **`probeFeatures` uses `client.get()`** for feature URLs — **GET**, not HEAD.
- **Impact:** Slightly heavier than HEAD; may hit **auth / body parse** paths. **Not wrong**, but **comment drift**.

### Actions

| Action | Where | Priority |
|--------|--------|----------|
| Update **comment** in `features.ts` to say GET (or switch implementation to HEAD if SAP supports for all probe paths) | `src/adt/features.ts` | Low |

---

## Probed endpoints (GET)

| ID | Path | Feature / purpose |
|----|------|-------------------|
| 60 | `/sap/bc/adt/ddic/sysinfo/hanainfo` | `hana` |
| 61 | `/sap/bc/adt/abapgit/repos` | `abapGit` |
| 62 | `/sap/bc/adt/ddic/ddl/sources` | `rap` |
| 63 | `/sap/bc/adt/debugger/amdp` | `amdp` |
| 64 | `/sap/bc/adt/filestore/ui5-bsp` | `ui5` |
| 65 | `/sap/bc/adt/cts/transportrequests` | `transport` |
| 66 | `.../textSearch?searchString=SY-SUBRC&maxResults=1` | `textSearch` capability |
| 67 | `.../search?operation=quickSearch&query=CL_ABAP_*&maxResults=1` | Auth probe — search |
| 68 | `.../cts/transportrequests?user=__PROBE__` | Auth probe — transport |

### SAP system (auth / availability)

- Same ICF + auth as the **real** endpoints; **404** → feature “not available” in auto mode.
- **PP:** Probes run as **configured** SAP session (PP or shared).
- **ABAP code location:** see **§ SAP ABAP-side** at the top of this file (and linked area reports).

### ARC-1

- **No `checkOperation`** — runs at startup / probe; uses raw `client.get`.
- **406/415:** **Yes** (theoretically; probes treat `<400` as success).

### Tests

- **Unit:** feature / intent tests mock probe outcomes.

### Verdict

**OK** for gating; **fix misleading HEAD comment**; optional **switch to HEAD** only after verifying each path supports HEAD on your minimum SAP version.

---

## Non-ADT probe (reference)

- `GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` — **`ui5repo`** — see `src/adt/ui5-repository.ts` (separate from ADT inventory).
