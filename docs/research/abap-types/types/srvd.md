# SRVD — Service Definition

## TL;DR
Canonical TADIR R3TR `SRVD` (RAP service definition — exposes CDS entities as service-aware
units). Spelling, slash alias `SRVD/SRV`, and URL `/sap/bc/adt/ddic/srvd/sources/` are all
correct and verified.

## TADIR ground truth
- **R3TR type**: `SRVD`.
- **LIMU sub-objects**: none.
- **abap-file-formats support**: ✅ released — `file-formats/srvd/`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `SRVD/SRV` | Service Definition source | `/sap/bc/adt/ddic/srvd/sources/<name>` | Eclipse plugin grep, probe catalog |
| `SRVD/SRVB` | Reverse pair: SRVD supporting SRVB | n/a | Eclipse only — informational |

## SAP docs & notes
- "ABAP RAP — Service Definition" (SAP Help).
- Available from SAP_BASIS 7.54+.

## Other MCP servers / cross-reference
- abap-file-formats: `<name>.srvd.source.srvd` + JSON.
- mcp-abap-abap-adt-api: `SRVD`.

## Live verification
### a4h (S/4HANA 2023)
- Probe `minRelease: 754`; RAP E2E exercises create/activate/delete on a4h.

### 7.50 (NW 7.50)
- Not available — pre-754.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2570 | `SRVD/SRV → SRVD` | ✅ |
| `objectBasePath` | 2687–2688 | `/sap/bc/adt/ddic/srvd/sources/` | ✅ |
| `revisionsUrlFor` | 473–474 | `/sap/bc/adt/ddic/srvd/sources/{n}/source/main/versions` | ✅ |
| `src/probe/catalog.ts` | 152–159 | `SRVD` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source + verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: no
- **Test gap to close**: none.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### SRVD/SRV

- Observed object: `ZTEST_MCP_SD_FLIGHT`; GET `/sap/bc/adt/ddic/srvd/sources/ztest_mcp_sd_flight`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `srvd:srvdSource`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/srvd-srv.json) also preserves one observed WUL edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<srvd:srvdSource adtcore:name="ZTEST_MCP_SD_FLIGHT" adtcore:type="SRVD/SRV" adtcore:version="active" xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP"/>
</srvd:srvdSource>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
