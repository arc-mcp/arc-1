# DEVC — Package (Development Class)

## TL;DR
Canonical TADIR R3TR `DEVC` (development class / package — the workbench container). Spelling
and slash alias `DEVC/K` are correct. URL `/sap/bc/adt/packages/<name>` is correct for
package read; package nodestructure (contents listing) uses
`parent_type=DEVC/K&parent_name=<pkg>`, which is the canonical form ADT expects.
**Caveat:** `devc` is NOT present in abap-file-formats yet — it's a workbench-only artifact
(the package itself isn't a serialized cloud object).

## TADIR ground truth
- **R3TR type**: `DEVC`.
- **LIMU sub-objects**: none in TADIR; subordinate objects belong to TADIR R3TR rows that
  reference the package via `DEVCLASS`.
- **abap-file-formats support**: ❌ no `devc` directory in
  https://github.com/SAP/abap-file-formats/tree/main/file-formats (verified via
  `gh api repos/SAP/abap-file-formats/contents/file-formats` — 85 dirs, none named `devc`).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DEVC/K` | Package (workbench type) | `/sap/bc/adt/packages/<name>` | Used by ARC-1's `getPackageContents` (`src/adt/client.ts:584`); standard nodestructure parent_type |

## SAP docs & notes
- SE21 / SE80 package maintenance.
- ADT exposes packages via `/sap/bc/adt/packages/` (single-object) and
  `/sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=<pkg>` (children).

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: `DEVC`.
- abapGit: serializes packages as `package.devc.xml` (devc form is real in abapGit even
  though not yet in abap-file-formats).

## Live verification
### a4h (S/4HANA 2023)
- `SAPRead(type='DEVC', name='$TMP')` invokes `getPackageContents` → POSTs nodestructure
  with `parent_type=DEVC/K`. Returns child object list (empirically validated by ARC-1
  integration tests).

### 7.50 (NW 7.50)
- Same endpoint; no version gating.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2587 | `DEVC/K → DEVC` | ✅ |
| `objectBasePath` | 2704–2705 | `/sap/bc/adt/packages/` | ✅ |
| `handleSAPRead` | 1708–1711 | `case 'DEVC'` → `getPackageContents` | ✅ |
| `client.getPackageContents` | 583–588 | uses `parent_type=DEVC/K` | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source + verified-on-live-system (integration tests use $TMP)
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: no
- **Test gap to close**: none.
