# DDLS — CDS DDL Source

## TL;DR
Canonical TADIR R3TR `DDLS` (CDS Data Definition Language source — `define view`,
`define view entity`, `define table function`, `extend view`, `extend view entity`, etc.). ARC-1's spelling,
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
- [`EXTEND VIEW`](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_EXTEND_VIEW.html)
  is the legacy DDIC-based form; [`EXTEND VIEW ENTITY`](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_EXTEND_VIEW_ENTITY.html)
  is the view-entity form. Both remain one DDLS/DF repository object type.
- Steampunk/BTP releases CDS as the primary modeling artifact; DDLS is the foundation.

## Other MCP servers / cross-reference
- abapGit / abap-file-formats: serializes as `<name>.ddls.source.cds` + `<name>.ddls.json`.
- mcp-abap-abap-adt-api: uses `DDLS` directly.

## Live verification
### a4h (S/4HANA 2023)
- SAP_BASIS 758 SP02: `extend view` and `extend view entity` both created and activated through
  SAPWrite in a Standard ABAP package.
- The same legacy `extend view` source in an ABAP Cloud package (`pak:languageVersion="5"`, exposed
  on DDLS metadata as `cloudDevelopment`) reproduced `[?/006] V1=View Extend: Object type View
  Extend is not allowed in this system`. The source PUT failed after the DDLS/DF shell create.
- `extend view entity` saved in that Cloud package and reached the separate released-API and field-name
  activation checks. This confirms a language-version restriction, not a separate DDLS subtype, but
  does not establish that the reporter's Standard-ABAP failure has the same immediate cause.

### Issue #614 reporter evidence (S/4HANA 2023 FPS01)
- The reporter confirmed that both the target package and base object use Standard ABAP.
- After creating the View Extend shell manually in ADT, ARC-1 can update its fields and activate it.
  The remaining failure is therefore isolated to the initial create path on that system level, not
  normal DDLS updates or activation.
- [SAP Note 3567464](https://me.sap.com/notes/3567464/E), released after FPS01, describes this exact
  DDLS006 symptom. It states that DDIC-based CDS extends require Standard ABAP and provides correction
  instructions or a containing support package, including an improved DDLS011 diagnostic.
- Without the reporter's Note/support-package status or a create trace, it is not proven whether the
  remaining failure is an uncorrected SAP backend level or create metadata that FPS01 interprets
  differently. Keep #614 open for that evidence.

### a4h (S/4HANA 2025)
- SAP_BASIS 816 SP01: both extension forms created and activated through the same DDLS/DF path.

### 7.50 (NW 7.50)
- Floor `minRelease: 740` per `src/probe/catalog.ts`. CDS reads work, but SAP's syntax check rejects
  modern `extend view entity` grammar. Write verification was blocked by the test user's missing
  development license.

## ARC-1 current surface
| Location | Form used | Correct? |
|---|---|---|
| `src/handlers/object-types.ts` `SLASH_TYPE_MAP` | `DDLS/DF → DDLS` | ✅ |
| `src/handlers/object-types.ts` `objectBasePath` | `/sap/bc/adt/ddic/ddl/sources/` | ✅ |
| `src/handlers/write-helpers.ts` `buildCreateXml` | `adtcore:type="DDLS/DF"` for every DDLS form | ✅ |
| `src/handlers/read.ts` | `case 'DDLS'` | ✅ |
| `src/lint/lint.ts` `detectFilename` | `DEFINE VIEW` and `EXTEND VIEW` → `.ddls.asddls` | ✅ (#614) |
| `src/adt/errors.ts` | DDLS006 View Extend restriction diagnostic + SAP Note fallback | ✅ (#614) |

## Verdict
- **Status**: correct routing; lint detection and DDLS006 guidance improved in #614
- **Evidence**: verified from abap-file-formats + Eclipse + probe catalog, then live on SAP_BASIS 758 and 816
- **Issue**: annotation-free `extend view entity` previously fell through to `.clas.abap` pre-write lint;
  SAP's View Extend restriction previously received only the generic DDIC-save hint. The reporter's
  Standard-ABAP FPS01 initial-create failure remains open pending backend/trace evidence.

## Recommendation
- Keep `DDLS/DF` as the single alias; do not add a View Extend subtype.
- Let SAP enforce the full language-version, base-extensibility, and released-API contracts. Classify
  the exact `/006` diagnostic instead of duplicating those evolving rules in a client-side preflight.
- Do not treat the Cloud-package reproduction as the reporter's root cause. On Standard ABAP, check
  SAP Note 3567464/support-package status before changing ARC-1's create metadata.
- **Breaking change**: no
- **Tests**: pin both extension filename forms, the SAP-domain hint, and the LLM-visible tool guidance.
