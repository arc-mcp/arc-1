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
