# PROG — ABAP Program / Report

## TL;DR
`PROG` is a real TADIR R3TR type. ADT exposes two slash subtypes under it: `PROG/P` (executable program / module pool) and `PROG/I` (include). ARC-1 maps both correctly: `PROG/P → PROG`, `PROG/I → INCL`. URL prefixes (`/programs/programs/`, `/programs/includes/`) are correct. No bug.

## TADIR ground truth
- **R3TR type**: `PROG` (Program)
- **LIMU sub-objects**: `REPS` (report source), `REPT` (text pool). LIMU `FUNC`/`METH` belong to other parents.
- **abap-file-formats support**: ✅ released. `file-formats/prog` exists ([link](https://github.com/SAP/abap-file-formats/tree/main/file-formats/prog)).
- **Source URL or fixture**: `gh api repos/SAP/abap-file-formats/contents/file-formats` returns `prog`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `PROG/P` | Program / report / module pool | `/sap/bc/adt/programs/programs/<NAME>` | a4h ✅ (live search returned this code) |
| `PROG/I` | Include program (also covers includes generated for FUGRs) | `/sap/bc/adt/programs/includes/<NAME>` | a4h ✅ (live search returned this for `%_HR1000` etc.) |

Live evidence: `GET /sap/bc/adt/repository/informationsystem/search?objectType=PROG/P` returns `adtcore:type="PROG/P"` references; `objectType=PROG/I` returns `adtcore:type="PROG/I"`. Both filters are honored. There is no `PROG/R`, `PROG/M`, etc. surfaced by the search API on a4h.

## SAP docs & notes
- ADT REST API "Programs" resource — covered in `com.sap.adt.programs_3.56.1` plugin.xml.
- abap-file-formats `prog` schema documents the released form for cloud.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: spells it `PROG/P` and `PROG/I` consistently.
- abapGit: `prog` lower-case file form.
- Eclipse ADT: bundle `com.sap.adt.programs_3.56.1` registers `/sap/bc/adt/programs/programs` and `/sap/bc/adt/programs/includes` (per `arc-1-eclipse-adt/api/11-repository-search-and-object-paths.md`).

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?query=*&objectType=PROG/P` → 200, `adtcore:type="PROG/P"`.
- `GET /repository/informationsystem/search?query=*&objectType=PROG/I` → 200, `adtcore:type="PROG/I"`.
- Direct read `GET /sap/bc/adt/programs/programs/<NAME>` → 200.

### 7.50 (NW 7.50)
- Could not verify directly — same endpoints exist since NW 7.0 per Eclipse plugin; safe to assume stable.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2559 | `PROG/P → PROG` | ✅ |
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2560 | `PROG/I → INCL` | ✅ (correctly routes ADT's include subtype to ARC-1's `INCL` canonical) |
| `src/handlers/intent.ts` `objectBasePath` | 2669 | `/sap/bc/adt/programs/programs/` | ✅ |
| `src/handlers/schemas.ts` SAPREAD/WRITE enums | 18, 218 | `PROG` | ✅ |
| `src/probe/catalog.ts` | n/a | `PROG` collection `/programs/programs` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: none.
- **Test gap to close**: add a unit test asserting `normalizeObjectType('PROG/P') === 'PROG'` and `normalizeObjectType('PROG/I') === 'INCL'` (likely already exists; verify).
