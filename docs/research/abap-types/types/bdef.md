# BDEF — Behavior Definition

## TL;DR
Canonical TADIR R3TR `BDEF` (RAP behavior definition for a CDS root entity). Spelling,
slash alias `BDEF/BDO`, and URL prefix `/sap/bc/adt/bo/behaviordefinitions/` are all correct
and verified.

## TADIR ground truth
- **R3TR type**: `BDEF` (Behavior Definition).
- **LIMU sub-objects**: none directly; behavior implementation lives in CLAS handlers,
  not BDEF LIMU rows.
- **abap-file-formats support**: ✅ released — `file-formats/bdef/`.
- **Source URL or fixture**: `gh api repos/SAP/abap-file-formats/contents/file-formats`
  shows `bdef` directory.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `BDEF/BDO` | Behavior Definition Object | `/sap/bc/adt/bo/behaviordefinitions/<name>` | Eclipse ADT plugin (quoted hit `"BDEF/BDO"`), probe catalog |
| `BDEF/SRVD` | Reverse-relationship: BDEF supporting SRVD (typestructure pair) | n/a | Eclipse only — informational |

## SAP docs & notes
- "ABAP RESTful Application Programming Model — Behavior Definition" (SAP Help).
- Available from SAP_BASIS 7.54+ (S/4HANA 2020 / Cloud).

## Other MCP servers / cross-reference
- abap-file-formats: `<name>.bdef.source.bdef` + JSON metadata.
- mcp-abap-abap-adt-api: `BDEF`.

## Live verification
### a4h (S/4HANA 2023)
- Probe `knownObjects: []` per `src/probe/catalog.ts:148`; no SAP-shipped BDEF universally.
- Live RAP E2E `tests/e2e/rap-write.e2e.test.ts` exercises BDEF create/activate against a4h.

### 7.50 (NW 7.50)
- Not available — `minRelease: 754` (`src/probe/catalog.ts:149`).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2569 | `BDEF/BDO → BDEF` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2685–2686 | `/sap/bc/adt/bo/behaviordefinitions/` | ✅ |
| `src/handlers/intent.ts` switch cases | 1499, 2054, 2410, 2685 | `BDEF` | ✅ |
| `src/probe/catalog.ts` | 144–151 | `BDEF` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source + verified-on-live-system (E2E RAP tests pass on a4h)
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: no
- **Test gap to close**: none — covered by `tests/e2e/rap-write.e2e.test.ts`.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### BDEF/BDO

- Observed object: `ZR_FbClubTP`; GET `/sap/bc/adt/bo/behaviordefinitions/zr_fbclubtp`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `blue:blueSource`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/bdef-bdo.json) also preserves one observed WUL edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<blue:blueSource adtcore:name="ZR_FBCLUBTP" adtcore:type="BDEF/BDO" adtcore:version="active" xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:adtcore="http://www.sap.com/adt/core">
</blue:blueSource>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
