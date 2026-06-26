# DTEL — DDIC Data Element

## TL;DR
`DTEL` is a real TADIR R3TR type. ADT slash subtype is `DTEL/DE`. URL `/sap/bc/adt/ddic/dataelements/`. ARC-1's mapping is correct.

## TADIR ground truth
- **R3TR type**: `DTEL`
- **LIMU sub-objects**: `DTED` (data element definition).
- **abap-file-formats support**: ✅ [`file-formats/dtel`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/dtel).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DTEL/DE` | Data Element | `/sap/bc/adt/ddic/dataelements/<NAME>` | a4h ✅ |

Live evidence: `objectType=DTEL` and `objectType=DTEL/DE` both return `adtcore:type="DTEL/DE"` references with URLs `/sap/bc/adt/ddic/dataelements/...`.

## SAP docs & notes
- AFF `dtel` schema covers cloud-released form.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: `DTEL/DE`.

## Live verification
### a4h (S/4HANA 2023)
- Search returns `DTEL/DE` references.
- `GET /sap/bc/adt/ddic/dataelements/MANDT` → 200.
- Note: ARC-1's `crud.ts` includes a content-type fallback (DTEL v2→v1 on 415) — unchanged by this audit.

### 7.50 (NW 7.50)
- Not verified live; stable since 7.40.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2585 | `DTEL/DE → DTEL` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2700-2701 | `/sap/bc/adt/ddic/dataelements/` | ✅ |
| `src/handlers/schemas.ts` enums | 34, 69, 232, 247 | `DTEL` | ✅ |
| `src/probe/catalog.ts` | — | `DTEL` collection `/ddic/dataelements` | ✅ |
| `src/adt/ddic-xml.ts` | — | DTEL XML builder | ✅ |
| `src/adt/crud.ts` `CONTENT_TYPE_FALLBACKS` | — | DTEL v2→v1 on 415 | ✅ (unrelated to typing) |

## Verdict
- **Status**: correct
- **Evidence**: verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: none.
- **Test gap to close**: assert `normalizeObjectType('DTEL/DE') === 'DTEL'`.
