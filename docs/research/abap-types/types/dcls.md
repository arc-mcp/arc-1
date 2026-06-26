# DCLS — CDS Access Control (DCL Source)

## TL;DR
Canonical TADIR R3TR `DCLS` (CDS Data Control Language source — defines access controls
for CDS entities). Spelling, alias `DCLS/DL`, and URL `/sap/bc/adt/acm/dcl/sources/` are
correct.

## TADIR ground truth
- **R3TR type**: `DCLS`.
- **LIMU sub-objects**: none.
- **abap-file-formats support**: ✅ released — `file-formats/dcls/`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DCLS/DL` | DCL source | `/sap/bc/adt/acm/dcl/sources/<name>` | Eclipse plugin grep, probe catalog |

## SAP docs & notes
- "ABAP CDS — Access Controls" (SAP Help).
- Available NW 7.50+ with limited syntax; richer DCL features added in later releases.

## Other MCP servers / cross-reference
- abap-file-formats: serializes as `<name>.dcls.source.cds`.
- mcp-abap-abap-adt-api: `DCLS`.

## Live verification
### a4h (S/4HANA 2023)
- Probe known object `P_USER002` (SAP-shipped on NW 7.50+, contributed via #162 probe run).
- ADT URL: `/sap/bc/adt/acm/dcl/sources/P_USER002/source/main`.

### 7.50 (NW 7.50)
- Available with limited syntax (`minRelease: 750`, `src/probe/catalog.ts:133`).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2568 | `DCLS/DL → DCLS` | ✅ |
| `objectBasePath` | 2683–2684 | `/sap/bc/adt/acm/dcl/sources/` | ✅ |
| `handleSAPRead` | 1493 | `case 'DCLS'` | ✅ |
| `revisionsUrlFor` | 469–470 | matches | ✅ |
| `src/probe/catalog.ts` | 125–135 | `DCLS` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source + verified-on-live-system (probe known object)
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: no
- **Test gap to close**: none.
