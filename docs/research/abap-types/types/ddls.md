# DDLS — CDS DDL Source

## TL;DR
Canonical TADIR R3TR `DDLS` (CDS Data Definition Language source — `define view`,
`define view entity`, `define table function`, `extend view`, etc.). ARC-1's spelling,
URL prefix, and slash alias `DDLS/DF` are all correct and verified across abap-file-formats,
the Eclipse ADT plugin, the local probe catalog, and live-system fixtures.

## TADIR ground truth
- **R3TR type**: `DDLS` (CDS DDL source). Stored as DDDDLSRC entries.
- **LIMU sub-objects**: none (single-source unit; no LIMU children).
- **abap-file-formats support**: ✅ released — `file-formats/ddls/` exists in
  [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats/tree/main/file-formats/ddls).
- **Source URL or fixture**: `gh api repos/SAP/abap-file-formats/contents/file-formats`
  enumerates `ddls` (verified in this audit).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DDLS/DF` | DDL source (Data Definition File) | `/sap/bc/adt/ddic/ddl/sources/<name>` | Eclipse ADT plugin (grep hit), probe catalog, abap-file-formats |
| `DDLS/BDEF` | Reverse-relationship hint (DDLS that supports a BDEF — appears in ADT type-structure XML, not a standalone object slash code) | n/a | Eclipse plugin only — informational |

## SAP docs & notes
- ABAP CDS — Data Definitions (SAP Help "ABAP — Keyword Documentation → CDS DDL").
- Steampunk/BTP releases CDS as the primary modeling artifact; DDLS is the foundation.

## Other MCP servers / cross-reference
- abapGit / abap-file-formats: serializes as `<name>.ddls.source.cds` + `<name>.ddls.json`.
- mcp-abap-abap-adt-api: uses `DDLS` directly.

## Live verification
### a4h (S/4HANA 2023)
- Probe catalog known object: `I_LANGUAGE` (SAP-shipped on every release with CDS support).
- ADT URL: `/sap/bc/adt/ddic/ddl/sources/I_LANGUAGE/source/main` returns CDS source text.

### 7.50 (NW 7.50)
- Floor `minRelease: 740` per `src/probe/catalog.ts:122`. CDS introduced in 7.40 SP05; full
  ADT read support 7.50+. Could not re-verify in this audit (relying on probe catalog and
  prior fixtures).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2567 | `DDLS/DF → DDLS` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2681–2682 | `/sap/bc/adt/ddic/ddl/sources/` | ✅ |
| `src/handlers/intent.ts` `handleSAPRead` | 1473 | `case 'DDLS'` | ✅ |
| `src/adt/client.ts` `revisionsUrlFor` | 467–468 | `/sap/bc/adt/ddic/ddl/sources/{n}/source/main/versions` | ✅ |
| `src/probe/catalog.ts` | 116–124 | `DDLS` | ✅ |
| `src/handlers/tools.ts` description | 104, 108, 441–442 | `DDLS` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source (abap-file-formats + Eclipse + probe catalog) and previously verified-on-live-system via fixtures
- **Issue**: none

## Recommendation
- Keep as-is. `DDLS/DF` alias is genuine and worth keeping for slash-form input.
- **Breaking change**: no
- **Test gap to close**: none specifically; covered by existing probe + RAP E2E.
