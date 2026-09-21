# SOBJ — BOR Business Object (pseudo)

## TL;DR
ARC-1's `SAPRead(type="SOBJ")` is an SQL-backed pseudo type for
"BOR (Business Object Repository) object type", reading methods from table `SWOTLV` and
fetching the implementing program source via `getProgram`. There is no
`/sap/bc/adt/sobj/...` endpoint used by that reader. SAP also has an unrelated native
maintenance-object identity, `SOBJ/MO`, reachable through a VIT metadata path. ARC-1's
BOR reader does not use that API. Do not map `SOBJ/MO` to this pseudo read type.

## Relation review correction — 2026-09-10

Live metadata GETs on SAP_BASIS 758 resolved `/BA1/B121` and `/BA1/B122` as `SOBJ/MO`,
with `adtcore:mainObject` roots under
`/sap/bc/adt/vit/wb/object_type/sobjmo/object_name/`. These are maintenance objects,
not BOR object types such as `BUS1001`. The former relation-root mapping is removed;
both `SOBJ` and `SOBJ/MO` are rejected for `SAPNavigate(action="relations")` before SAP access.
Native `SOBJ/MO` neighbors may remain visible as unexpanded boundary evidence. Existing
SAPRead BOR behavior and its permissions remain unchanged. A future naming solution must
be coordinated across tools, not introduced as a silent alias here.

SAP distinguishes [BOR object types](https://help.sap.com/docs/PRODUCT_ID/0d74d6667d234d4fa1dcd4440b7334be/adae3e3fd5a24db380adc8b7ff48058c.html)
from [central maintenance object types](https://help.sap.com/docs/ABAP_PLATFORM_NEW/521cd184dd2f491a9a4179edb66951c3/4dad3efbbd316d57e10000000a42189e.html)
and [SOBJ transport-object definitions](https://help.sap.com/docs/ABAP_PLATFORM_NEW/f7db12726e594673b085a18f19d14ba4/4a2c10af6ed91c62e10000000a42189c.html).

## Current implementation evidence

| Location | Observed behavior |
|---|---|
| `src/handlers/read.ts`, `case 'SOBJ'` | List up to 100 BOR methods from SWOTLV, or resolve one named method and load its implementing program. These are alternative request paths, not a native maintenance-object read. |
| `src/handlers/read.ts`, `swotlv` | A data-source-policy denial names the affected BOR lookup operation. Existing SQL, source-policy and SAP authorization checks are not bypassed. |
| `src/handlers/tool-registry.ts`, `SAPREAD_TYPE_TABLE` | SOBJ is an on-premises-only ARC-1 read type (`btp: false`). |
| `src/handlers/object-types.ts`, `SLASH_TYPE_MAP` | No SOBJ/MO alias to the BOR pseudo type. |
| `tests/unit/handlers/read.test.ts`, `SAPRead SOBJ` | BOR method listing and implementation-read regressions. |
| `tests/unit/handlers/live-relations.test.ts` | Both SOBJ root spellings rejected before GET, POST or SQL. |
| `tests/unit/adt/relation-types.test.ts` | Native SOBJ/MO neighbors retained as unexpanded type boundaries. |

Earlier versions of this document cited the retired `intent.ts` monolith and inferred that no
native SOBJ identity existed from its absence in a local Eclipse corpus. That inference was
incorrect: the live SOBJ/MO metadata above disproves it. BOR lookup code and maintenance-object
metadata must be evaluated separately. No cross-release BOR or maintenance qualification is
claimed by this correction, and no BOR SQL was executed during this review.

## Decision

Keep the existing BOR pseudo read compatible; do not introduce a maintenance alias in this PR.
A future coordinated rename to `BOR`, or an explicitly named maintenance capability, can resolve
the terminology across tools. Neither is necessary to offer the other 25 qualified relation roots.
