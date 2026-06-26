# BSP — Deployed UI5/Fiori (BSP Filestore) Application

## TL;DR
ARC-1's `BSP` short type is a **pseudo / repurposed** identifier. It does NOT correspond
to TADIR R3TR `BSP` (which historically meant "Business Server Pages — page-based BSP
applications"). Instead, ARC-1 uses `BSP` as a name for the **UI5 ABAP Repository BSP
filestore** (deployed Fiori/UI5 apps stored under `/sap/bc/adt/filestore/ui5-bsp/objects/`).
This is a deliberate repurposing because that's how Eclipse/ADT exposes UI5 deployed apps.
Naming is misleading but functionally correct.

## TADIR ground truth
- **R3TR type**: `BSP` historically exists (BSP application). UI5 apps deployed via
  SAPUI5 ABAP Repository are *also* stored as TADIR rows (`BSP/SICF` mapping varies by
  release).
- **LIMU sub-objects**: legacy BSP had `WAPP`, `WAPA` — not used by ARC-1.
- **abap-file-formats support**: ❌ no `bsp` directory.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none used by ARC-1) | UI5/BSP filestore root | `/sap/bc/adt/filestore/ui5-bsp/objects/<APP>/content` | ARC-1 `client.listBspApps`/`getBspAppStructure`/`getBspFileContent` |

## SAP docs & notes
- "ABAP UI Development Toolkit for HTML5 — Deployment to BSP Repository".
- Filestore endpoint family: `/sap/bc/adt/filestore/ui5-bsp/objects/`.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: similar BSP filestore browsing.
- abap-file-formats: not covered; UI5 apps are not part of the ABAP file format scope.

## Live verification
### a4h (S/4HANA 2023)
- `SAPRead(type='BSP', name='')` → `listBspApps()` returns deployed apps.
- `SAPRead(type='BSP', name='ZAPP')` → `getBspAppStructure('ZAPP')`.
- `SAPRead(type='BSP', name='ZAPP', include='manifest.json')` → `getBspFileContent`.

### 7.50 (NW 7.50)
- Same filestore endpoint exists; depends on whether UI5 ABAP repo ICF is active.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `handleSAPRead` | 1731–1753 | `case 'BSP'` → filestore APIs | ✅ functional |
| `objectBasePath` | n/a (no entry) | falls through to default | ⚠️ — `BSP` is read-only, no URL builder needed |
| `client.listBspApps`/`getBspAppStructure`/`getBspFileContent` | 668–700 | `/sap/bc/adt/filestore/ui5-bsp/objects/` | ✅ |
| `cachedFeatures.ui5` gate | 1732–1737 | feature-probed | ✅ |
| Tool description | 104, 108 | `BSP (deployed UI5/Fiori apps …)` | ⚠️ — naming overloads legacy BSP semantics |

## Verdict
- **Status**: legacy-tolerable (semantically misleading name; functionally correct)
- **Evidence**: verified-from-source (filestore endpoint), verified-on-live-system (probe)
- **Issue**: the short `BSP` is overloaded — users coming from classic ABAP may expect
  classic Business Server Page object reads, not UI5 filestore browsing.

## Recommendation
- Long-term: rename to `UI5_APP` or `BSP_APP` to disambiguate from legacy R3TR BSP. For
  now keep as `BSP` for compatibility, but make the tool description leading sentence
  explicit ("deployed UI5/Fiori app via filestore" — already partly there).
- Consider exposing `UI5_APP` as an alias that normalizes to `BSP` so the tool description
  can be migrated without breaking existing prompts.
- **Breaking change**: a rename WOULD be a breaking change for prompts that hardcode `BSP`.
- **Test gap to close**: an integration test that asserts `listBspApps()` succeeds against
  a4h (gated by `cachedFeatures.ui5.available`) so we catch ICF deactivation regressions.
