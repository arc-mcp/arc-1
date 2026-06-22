# SKTD — Knowledge Transfer Document

## TL;DR
`SKTD` is a real ADT object type with slash code `SKTD/TYP`, used for Markdown documentation
attached to ABAP objects via `/sap/bc/adt/documentation/ktd/documents/`. The
`<sktd:docu>` XML envelope carries the Markdown body base64-encoded inside `<sktd:text>`.
ARC-1's surface is **correct** — type code, slash alias, URL, and MIME all match the
canonical ADT shape. SKTD is unique among the wave-6 types in that it is genuinely a
TADIR / ADT object type, not a pseudo cross-cutting read.

## TADIR ground truth
- **R3TR type**: `SKTD` (Knowledge Transfer Document)
- **LIMU sub-objects**: none observed
- **abap-file-formats support**: ❌ — no `sktd/` directory in `SAP/abap-file-formats`
  `file-formats/` (verified via `gh api repos/SAP/abap-file-formats/contents/file-formats`,
  2026-05-08). abapGit serializers do not handle SKTD either; it is an ADT-only object
  exposed through the documentation/ktd REST surface.
- **Source URL or fixture**: eclipse-adt corpus
  `/Users/marianzeis/DEV/arc-1-eclipse-adt/api/11-repository-search-and-object-paths.md:17`
  lists `SKTD` in the canonical type map alongside `PROG`, `CLAS`, etc.;
  `api/18-ktd-documentation.md` documents the endpoint and `application/vnd.sap.adt.sktdv2+xml` MIME.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `SKTD/TYP` | Knowledge Transfer Document (only known subtype) | `/sap/bc/adt/documentation/ktd/documents/` | a4h ✅ (PR #134 merged 2026-04-16); 7.50 N/A — feature-gated |

The `adtcore:type="SKTD/TYP"` literal appears in the create XML envelope at
`src/handlers/intent.ts:2956`. No other slash subtype is documented or observed.

## SAP docs & notes
- No public SAP help portal page for the `documentation/ktd/documents` endpoint; ADT
  surfaces it implicitly through the "Documentation" tab on supported object types.
- MIME `application/vnd.sap.adt.sktdv2+xml` is the v2 envelope (PR #134 only supports v2).
- SAP Note 3102916 says KTD is supported from SAP_BASIS 7.55, but it covers an
  outdated-client exception, not the class-parent null-reference dump.
- Live registry check (`WBOBJTYPES_SCOPE`, `SCOPE_ID = 'DOCUMENTATION'`) on SAP_BASIS
  758 and 816 is the backend source of truth for KTD parent support. Observed entries:
  `APIC/TYP`, `BDEF/*`, `CFDB/CFB`, `CFDG/CFG`, `CFDS/CFS`, `CHKO/TYP`, `DDLA/ADF`,
  `DDLS/DF`, `DEVC/K`, `DRTY/STY`, `DSFD/SCF`, `EEEC/EVC`, `EVTB/EVB`, `PARA/R`,
  `RONT/ROT`, `SMBC/TYP`, `SOD1`, `SOD2`, `SRVB/SVB`, and `SRVD/SRV`. Some are
  release-specific (for example 816-only entries) and some are not yet routable by
  ARC-1 because `objectBasePath` has no parent URI builder for them.
- `CLAS/OC`, `INTF/OI`, and `PROG/P` are **not** in that registry on the tested systems.
  For those code objects, use ABAP Doc.

## Other MCP servers / cross-reference
- `compare/00-feature-matrix.md:108` and `:138` and `:302`/`:347`: ARC-1 is the **only**
  ADT-MCP implementation that supports SKTD read or write — confirmed across `mcp-abap-abap-adt-api`,
  `mcp-abap-adt`, `aws-abap-accelerator`, `fr0ster`, `dassian-adt`, `vibing-steampunk`, `sapcli`,
  `J4D`. ARC-1's PR #134 (2026-04-16) by lemaiwo is the first.
- abap-file-formats: no entry.

## Live verification
### a4h (S/4HANA 2023)
- Test object: KTD attached to a DDLS via Eclipse ADT
- ADT response: `200 application/vnd.sap.adt.sktdv2+xml` with `<sktd:docu>` root
  containing base64-encoded `<sktd:text>` body. Verified in PR #134 integration tests.
  ARC-1 caches the raw envelope (`src/handlers/intent.ts:1534` comment) and edits only
  `<sktd:text>` on update to preserve metadata.
- Negative test (2026-06-22): class-backed KTD create with `refObjectType="CLAS/OC"`
  dumps in SAP standard code (`CL_KTD_UTILITY=>GET_DOCU_STRUCTURE`,
  `OBJECTS_OBJREF_NOT_ASSIGNED_NO`) because no `CLAS/OC` DOCUMENTATION-scope handler
  exists in `WBOBJTYPES_SCOPE`.

### 7.50 (NW 7.50)
- Test object: N/A — could not verify directly; SKTD is an S/4-era feature and likely
  absent or unsupported on classic NW 7.50 trial systems. Feature gating not currently
  applied in ARC-1 (no probe entry in `src/probe/catalog.ts` for SKTD), so a 404 on 7.50
  surfaces as a generic "not found" error.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 30, 66, 229, 244 | `SKTD` (Read & Write enums, both onprem + BTP) | ✅ |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | 2590 | `SKTD/TYP → SKTD` | ✅ |
| `src/handlers/intent.ts` objectBasePath | 2708-2709 | `/sap/bc/adt/documentation/ktd/documents/` | ✅ |
| `src/handlers/intent.ts` Read switch | 1532-1574 | full read incl. base64 decode | ✅ |
| `src/handlers/intent.ts` Write switch (create) | 2932-2986 | POST collection + envelope build with `adtcore:type="SKTD/TYP"` | ✅ |
| `src/handlers/intent.ts` SKTD_V2_CONTENT_TYPE | 2009 | `application/vnd.sap.adt.sktdv2+xml` | ✅ |
| `src/adt/client.ts` getKtd | 318-326 | GET with sktdv2 Accept | ✅ |
| `src/probe/catalog.ts` | — | no probe entry | ⚠️ minor — no feature-gate, 7.50 surfaces as 404 |

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source (eclipse ADT api docs + ARC-1 PR #134 integration tests
  on a4h)
- **Issue**: none for the type/URL mapping itself. Parent object type support is narrower
  than the early ARC-1 wording implied: class/interface/program parents are not
  registered for KTD on the tested 758/816 systems and can dump SAP standard code if
  posted blindly. SAP-registered parent types that ARC-1 cannot yet route should return
  an explicit "parent URI routing not implemented" error rather than falling through to
  `objectBasePath` or SAP. Minor: SKTD has no probe entry, so the type is silently exposed
  on backends that 404 the documentation/ktd endpoint.
  abap-file-formats lacks an `sktd/` directory, which means SAP has not yet committed to
  a stable serialization for git/CTS — keep an eye on this for future CTS workflows.

## Recommendation
- **Keep as-is.** Slash form `SKTD/TYP`, short form `SKTD`, URL prefix
  `/sap/bc/adt/documentation/ktd/documents/`, and MIME `application/vnd.sap.adt.sktdv2+xml`
  are all canonical.
- Guard SKTD create by `refObjectType`: allow ARC-routable documented parents such as
  `DDLS/DF`, `BDEF/*`, `SRVD/SRV`, `SRVB/SVB`, and `DEVC/K`; reject `CLAS/OC`, `INTF/OI`,
  and `PROG/P` with an ABAP Doc hint before SAP can dump. Phrase unknown-type errors as
  "unverified" rather than "SAP cannot support this type": KTD create needs both a
  `WBOBJTYPES_SCOPE` DOCUMENTATION handler and a correct parent `adtcore:uri`. For
  SAP-registered but non-routable parents such as `DDLA/ADF` or `EVTB/EVB`, fail fast with a
  routing-specific message until ARC-1 adds verified parent URI builders.
- **Optional follow-up:** add a probe entry in `src/probe/catalog.ts` so non-S/4 backends
  (NW 7.50) report SKTD as unavailable instead of returning a raw 404 to the LLM.
- **Breaking change**: no.
- **Test gap to close**: a unit test in `tests/unit/handlers/intent.test.ts` asserting
  `SLASH_TYPE_MAP['SKTD/TYP'] === 'SKTD'` and that `objectBasePath('SKTD')` returns the
  documentation/ktd path; an E2E test already exists implicitly via PR #134's CRUD tests.
