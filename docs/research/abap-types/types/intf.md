# INTF — ABAP Interface

## TL;DR
`INTF` is a real TADIR R3TR type. ADT's slash subtype is `INTF/OI` (Object Interface). ARC-1 maps `INTF/OI → INTF` correctly with URL `/sap/bc/adt/oo/interfaces/`. No bug.

## TADIR ground truth
- **R3TR type**: `INTF`
- **LIMU sub-objects**: `INTD` (interface definition section), `METH` (interface method).
- **abap-file-formats support**: ✅ [`file-formats/intf`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/intf).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `INTF/OI` | Object Interface (global interface) | `/sap/bc/adt/oo/interfaces/<NAME>` | a4h ✅ |

Live evidence: `objectType=INTF/OI` search returns `adtcore:type="INTF/OI"` references; URLs are `/sap/bc/adt/oo/interfaces/...`. No other `INTF/*` subtypes observed.

## SAP docs & notes
- ADT plugin `com.sap.adt.oo_3.56.1` registers `/sap/bc/adt/oo/interfaces`.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: `INTF/OI`.
- Eclipse `arc-1-eclipse-adt/api/11-repository-search-and-object-paths.md` recommends `INTF/OI` as a canonical alias.

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?query=*&objectType=INTF` → returns `INTF/OI` references.
- `GET /repository/informationsystem/search?query=*&objectType=INTF/OI` → returns `INTF/OI` references.
- Object reads at `/sap/bc/adt/oo/interfaces/IF_*` → 200.

### 7.50 (NW 7.50)
- Not verified live; same scheme.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2563 | `INTF/OI → INTF` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2673 | `/sap/bc/adt/oo/interfaces/` | ✅ |
| `src/handlers/schemas.ts` enums | 20, 57, 220, 237 | `INTF` | ✅ |
| `src/probe/catalog.ts` | — | `INTF` collection `/oo/interfaces` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: none.
- **Test gap to close**: covered by the same `normalize-types` test suggested for CLAS.
