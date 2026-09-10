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

## TADIR ground truth
- **R3TR type**: SAP's `SOBJ` maintenance objects are distinct from ARC-1's pseudo type.
  ARC-1's SOBJ refers to **BOR object
  types** (table `TOJTB`, methods in `SWOTLV`).
- **LIMU sub-objects**: N/A
- **abap-file-formats support**: ❌ — no `sobj/` directory; BOR objects are not
  serialized by abapGit either.
- **Source URL or fixture**: BOR objects predate ADT. Maintained via tx `SWO1` only.
  `src/handlers/intent.ts:1668-1710`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none) | ARC-1 SOBJ uses no ADT URL | `runQuery('SELECT ... FROM SWOTLV ...')` then `getProgram(prog)` | a4h ✅ — works only when free SQL is allowed |

ARC-1 reads BOR data via two SQL queries against `SWOTLV` (`LOBJTYPE`, `VERB`, `PROGNAME`,
`FORMNAME`, `DESCRIPT`) and then loads the program containing the implementation form.

## SAP docs & notes
- BOR (Business Object Repository) is part of classic SAP Workflow / BAPI infrastructure;
  superseded by RAP behavior definitions on cloud. SAP help: tx `SWO1` / `BAPI`.
- ARC-1's BTP hint at `src/handlers/intent.ts:1244` correctly states: *"BOR business
  objects (SOBJ) are not available on BTP ABAP Environment. Use RAP behavior definitions
  (BDEF) instead."*

## Other MCP servers / cross-reference
- `mcp-abap-abap-adt-api`, `fr0ster`, `dassian-adt`, `vibing-steampunk`, `sapcli`: none
  expose BOR object reading. ARC-1 is the only one with this synthetic type.
- Eclipse ADT plugin (`/Users/marianzeis/DEV/arc-1-eclipse-adt/api/`): no mention of
  `SOBJ` as an ADT object type — confirms it is not a real slash form.

## Live verification
### a4h (S/4HANA 2023)
- Test object: any BOR object such as `BUS1001` (material).
- ADT response: N/A — ARC-1 doesn't call ADT for SOBJ. The free-SQL read of `SWOTLV`
  succeeds when `allowFreeSQL=true`.

### 7.50 (NW 7.50)
- Test object: same. SWOTLV exists on every NetWeaver release back to 4.6.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 38 (Read enum onprem only) | `SOBJ` | ✅ correctly excluded from BTP |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | — | (no entry — correct, no slash form) | ✅ |
| `src/handlers/intent.ts` Read switch | 1668-1710 | SQL on SWOTLV + getProgram | ✅ |
| `src/handlers/intent.ts` BTP_HINTS | 1244 | "Use BDEF instead" hint | ✅ |
| `src/handlers/intent.ts` unknown-type error string | 1776 | mentions `SOBJ` in supported list | ✅ |

## Verdict
- **Status**: pseudo (legitimate "action disguised as type")
- **Evidence**: verified-from-source — full implementation visible in `intent.ts`;
  no ADT call is involved.
- **Issue**: the name `SOBJ` is a poor fit because TADIR also has an unrelated `R3TR
  SOBJ`. A reader scanning `SLASH_TYPE_MAP` could believe SOBJ is an ADT type — it isn't.

## Recommendation
- **Keep as a pseudo type, but document it explicitly** as "BOR object methods (SQL-only
  read of SWOTLV)" in the tool description (`src/handlers/tools.ts`) so LLMs don't try to
  pass slash forms or expect an ADT URL. No code change to `SLASH_TYPE_MAP` needed
  because there is no slash entry to remove.
- **Consider renaming** to `BOR` in a future major release — `BOR` matches SAP user
  terminology better and avoids the TADIR-`SOBJ` collision. Breaking change; defer until
  a coordinated type rename pass.
- **Breaking change**: no (current path); yes if renamed.
- **Test gap to close**: a unit test asserting `SOBJ` is rejected when `allowFreeSQL=false`,
  with a clear error message pointing the user at the `--allow-free-sql` flag — currently
  the SQL call would throw deep in `runQuery` with a less obvious message.
