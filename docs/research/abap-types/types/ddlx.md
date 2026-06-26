# DDLX — CDS Metadata Extension

## TL;DR
Canonical TADIR R3TR `DDLX` (CDS metadata extension — non-intrusive UI / Fiori annotations
on top of a base CDS view). Spelling, alias `DDLX/EX`, and URL
`/sap/bc/adt/ddic/ddlx/sources/` are correct. **Note:** the alias `DDLX/EX` is *not* found
in the local Eclipse ADT plugin grep (only `DDLS/*`, `DCLS/*`, `BDEF/*`, `SRVD/*`, `SRVB/*`
turn up). It is, however, the documented slash-subtype in SAP docs and is consistent with
the rest of the ADT object-type taxonomy. Verified-from-source rather than verified-from-Eclipse-jar.

## TADIR ground truth
- **R3TR type**: `DDLX`.
- **LIMU sub-objects**: none.
- **abap-file-formats support**: ✅ released — `file-formats/ddlx/`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DDLX/EX` | Metadata Extension | `/sap/bc/adt/ddic/ddlx/sources/<name>` | abap-file-formats + ADT URL conventions; not present in local Eclipse jar grep |

## SAP docs & notes
- "ABAP CDS — Metadata Extensions" (SAP Help).
- Available SAP_BASIS 7.51+ (probe `minRelease: 751`).

## Other MCP servers / cross-reference
- abap-file-formats: `<name>.ddlx.source.cds` + JSON.
- mcp-abap-abap-adt-api: `DDLX`.

## Live verification
### a4h (S/4HANA 2023)
- No SAP-shipped DDLX in probe catalog (`knownObjects: []`). Customer-defined or app-specific.
- URL pattern `/sap/bc/adt/ddic/ddlx/sources/<name>/source/main` returns CDS-style annotations.

### 7.50 (NW 7.50)
- Not available pre-7.51.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2572 | `DDLX/EX → DDLX` | ✅ |
| `objectBasePath` | 2689–2690 | `/sap/bc/adt/ddic/ddlx/sources/` | ✅ |
| `handleSAPRead` | 1511 | `case 'DDLX'` | ✅ |
| `src/probe/catalog.ts` | 137–143 | `DDLX` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source (abap-file-formats released, probe catalog) — no Eclipse-jar confirmation of slash form
- **Issue**: minor — `DDLX/EX` alias should be re-confirmed against a live ADT typestructure response when convenient

## Recommendation
- Keep as-is. Optionally add a fixture-backed test that confirms `DDLX/EX` is what ADT
  actually returns for a customer-created DDLX, to close the Eclipse-jar gap.
- **Breaking change**: no
- **Test gap to close**: `tests/fixtures/probe/<a4h>/ddlx-typestructure.xml` snapshot showing
  `<adtcore:objectType>DDLX/EX</adtcore:objectType>` from a live response — gives us
  Eclipse-jar-equivalent evidence.
