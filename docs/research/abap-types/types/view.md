# VIEW — DDIC View (classic)

## TL;DR
`VIEW` is a real TADIR R3TR type (classic DDIC views — projection, database, help, maintenance). **Two bugs in ARC-1**: (1) the `SLASH_TYPE_MAP` entry `'VIEW/V'` is **invented** — ADT actually returns `VIEW/DV` for DDIC views; (2) the `objectBasePath('VIEW')` URL is **wrong** — ARC-1 (via the probe catalog) uses `/sap/bc/adt/ddic/views/` which returns HTTP 500 on object reads on a4h; the real ADT URL is `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/<NAME>`. ARC-1 currently only `Read`-exposes VIEW; the existing `getView()` path is broken on this system.

## TADIR ground truth
- **R3TR type**: `VIEW`. Covers DD25L view classes: `D` (database view), `H` (help view), `P` (projection view), `S` (structure view), `M` (maintenance view), `C` (CDS classical).
- **LIMU sub-objects**: `VIED` (view definition).
- **abap-file-formats support**: ❌ no `view/` directory in AFF — classic DDIC views are not on the cloud-released list (CDS DDLS replaces them in cloud).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `VIEW/DV` | DDIC View (the umbrella code returned for classic views on S/4HANA 2023) | `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/<NAME>` | a4h ✅ |
| `VIEW/V` | **Does not exist** | n/a | a4h ❌ — search filter is silently ignored; no object ever returns this code |

Live evidence:
- `GET /repository/informationsystem/search?objectType=VIEW/V&query=V_USR_NAME` → returns the object but with `adtcore:type="VIEW/DV"` (filter not honored).
- `GET /repository/informationsystem/search?objectType=VIEW&query=V_USR_NAME` → same `VIEW/DV` output.
- `GET /sap/bc/adt/ddic/views/V_USR_NAME` → **HTTP 500** (the path exists for some operations but blows up on object retrieval here).
- `GET /sap/bc/adt/ddic/views/V_USR_NAME/source/main` → **HTTP 404**.
- `GET /sap/bc/adt/vit/wb/object_type/viewdv/object_name/V_USR_NAME` → **HTTP 200** ✅.

## SAP docs & notes
- The `vit/wb/object_type/<X>/object_name/<NAME>` URL pattern is ADT's "generic object type" workbench wrapper for object types whose dedicated REST resource is incomplete or read-only via metadata. Classic DDIC views are routed through it on this release.
- `mcp-abap-abap-adt-api` also routes via this pattern for `VIEW/DV`.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: uses `VIEW/DV` and the `vit/wb/object_type/viewdv/...` URL.
- Eclipse ADT: classic-view editing is largely SAP GUI-tunneled; the ADT object node uses the same generic-VIT URL.

## Live verification
### a4h (S/4HANA 2023)
- Test object: `V_USR_NAME` (sample SAP-shipped view).
- `objectType=VIEW` search ↦ `adtcore:type="VIEW/DV"`, `adtcore:uri="/sap/bc/adt/vit/wb/object_type/viewdv/object_name/V_USR_NAME"`.
- Direct `/sap/bc/adt/ddic/views/V_USR_NAME` ↦ HTTP 500. **ARC-1's current URL is broken on a4h.**
- Direct `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/V_USR_NAME` ↦ HTTP 200.

### 7.50 (NW 7.50)
- Not verified live. Probable: same pattern (the `vit/wb/object_type/...` route exists since 7.40).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2589 | `VIEW/V → VIEW` | ❌ invented (should be `VIEW/DV → VIEW`) |
| `src/handlers/intent.ts` `objectBasePath` | (none — falls through to default `/programs/programs/`) | — | ❌ no `case 'VIEW':` arm; default sends VIEW reads to **`/sap/bc/adt/programs/programs/`** which is nonsense |
| `src/handlers/schemas.ts` enums | 32 | `VIEW` (read enum only) | ✅ |
| `src/probe/catalog.ts` | — | collectionUrl `/sap/bc/adt/ddic/views`, objectUrlTemplate `/sap/bc/adt/ddic/views/{name}/source/main` | ❌ — returns 404/500 on a4h |
| `src/adt/client.ts` getView (if present) | — | should use `vit/wb/...` route | ❌ |

(Re-check: `objectBasePath` switch at intent.ts:2667-2712 has **no `case 'VIEW':`** — confirmed. So `objectUrlForType('VIEW', name)` returns `/sap/bc/adt/programs/programs/<name>` — wrong type **and** wrong URL.)

## Verdict
- **Status**: **wrong** — both the slash alias and the URL prefix are invented. This is a real bug, not legacy-tolerable.
- **Evidence**: verified-on-live-system
- **Issue**: any caller doing `SAPRead --type VIEW --name <V>` against a4h-class systems will hit the default `/programs/programs/` URL, get 404, and surface the wrong error class. The probe `collectionUrl` also misclassifies VIEW as available-but-broken.

## Recommendation
- **Replace** in `SLASH_TYPE_MAP`: `'VIEW/V': 'VIEW'` → `'VIEW/DV': 'VIEW'` (and keep `'VIEW/V'` as a deprecated alias for one release if telemetry shows usage).
- **Add** `case 'VIEW': return '/sap/bc/adt/vit/wb/object_type/viewdv/object_name/';` to `objectBasePath` in `src/handlers/intent.ts:~2710`. Names go into the URL **uppercase** (live probe shows `/V_USR_NAME`, not lower).
- **Fix probe** in `src/probe/catalog.ts`: `collectionUrl` and `objectUrlTemplate` to the `vit/wb/...` form. Also: classic DDIC views don't have a stable `/source/main` endpoint — the probe should hit the metadata URL, not source.
- **Breaking change**: yes for any caller that passed `VIEW/V` literally — but the existing path is already broken (HTTP 500/404 on real reads), so the user impact is "feature stops silently 404'ing and starts working".
- **Test gap to close**:
  - Unit: assert `normalizeObjectType('VIEW/DV') === 'VIEW'` and `objectBasePath('VIEW')` includes `vit/wb`.
  - Integration: add a `VIEW` read against `V_USR_NAME` to `tests/integration/adt.integration.test.ts` (currently no VIEW coverage; this gap is what hid the bug).
  - Probe replay fixture under `tests/fixtures/probe/` showing `VIEW` returning 200 from the corrected URL.
