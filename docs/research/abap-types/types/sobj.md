# SOBJ — BOR Business Object (pseudo)

## TL;DR
`SOBJ` is **not** an ADT object type — ARC-1 implements it as an SQL-only synonym for
"BOR (Business Object Repository) object type", reading methods from table `SWOTLV` and
fetching the implementing program source via `getProgram`. There is no
`/sap/bc/adt/sobj/...` endpoint. The short form `SOBJ` happens to coincide with TADIR's
`R3TR SOBJ` (object directory entry container) but the relationship is incidental — ARC-1
does not call any SOBJ-specific ADT URL. This is a **pseudo type** that should remain
typed as such; it does not belong in any slash-form alias map.

## TADIR ground truth
- **R3TR type**: `SOBJ` exists in TADIR as a generic "object directory entry" container
  type, but ARC-1's SOBJ has nothing to do with it. ARC-1's SOBJ refers to **BOR object
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
