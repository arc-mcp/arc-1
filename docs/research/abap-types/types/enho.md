# ENHO — Enhancement Implementation

## TL;DR
Canonical TADIR R3TR `ENHO` (Enhancement Implementation — BAdI implementations,
explicit/implicit enhancement source plug-ins, enhanced classes). Spelling is correct.
URL `/sap/bc/adt/enhancements/enhoxhb/<name>` and Accept
`application/vnd.sap.adt.enh.enhoxhb.v4+xml` are correct (`enhoxhb` = enhancement object
"hbi" / extended-BAdI form). On-prem only in ARC-1.

## TADIR ground truth
- **R3TR type**: `ENHO`.
- **LIMU sub-objects**: ENHO has internal sub-elements (BAdI implementations, source plug-ins)
  but TADIR doesn't carry them as separate LIMU rows in the way FUGR carries FUNC.
- **abap-file-formats support**: ✅ released — `file-formats/enho/`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (no alias in ARC-1) | Enhancement Implementation | `/sap/bc/adt/enhancements/enhoxhb/<name>` | probe catalog, ARC-1 client |

## SAP docs & notes
- "Enhancement Framework" (SAP Help — ABAP Workbench Tools).
- BAdI / Implicit / Explicit enhancement spots.

## Other MCP servers / cross-reference
- abap-file-formats: serializes `enho` (✅ verified in this audit's gh api dump).
- mcp-abap-abap-adt-api: `ENHO`.

## Live verification
### a4h (S/4HANA 2023)
- Probe `knownObjects: []` per `src/probe/catalog.ts:190` — no SAP-shipped ENHO universally
  guaranteed; customer-defined.

### 7.50 (NW 7.50)
- Available — `minRelease: 702`.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `handleSAPRead` | 1581–1584 | `case 'ENHO'` → `getEnhancementImplementation` | ✅ |
| `client.getEnhancementImplementation` | 512–518 | `/sap/bc/adt/enhancements/enhoxhb/<name>` | ✅ |
| `src/probe/catalog.ts` | 187–193 | `ENHO` | ✅ |
| `objectBasePath` | n/a (read-only path; no URL builder entry) | n/a | acceptable — read uses dedicated client method |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source (abap-file-formats released, probe catalog)
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: no
- **Test gap to close**: none specifically; covered by probe.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### ENHO/XHB

- Observed object: `ZABAPGIT_REPOS`; GET `/sap/bc/adt/enhancements/enhoxhb/zabapgit_repos`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `enho:objectData`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/enho-xhb.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<enho:objectData adtcore:name="ZABAPGIT_REPOS" adtcore:type="ENHO/XHB" adtcore:version="active" xmlns:enho="http://www.sap.com/adt/enhancements/enho" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24test_abapgit" adtcore:type="DEVC/K" adtcore:name="$TEST_ABAPGIT"/>
</enho:objectData>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
