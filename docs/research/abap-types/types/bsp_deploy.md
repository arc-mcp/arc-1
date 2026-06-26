# BSP_DEPLOY — UI5 ABAP Repository Deployment Lookup

## TL;DR
`BSP_DEPLOY` is an **ARC-1-invented short type** (not TADIR, not ADT). It maps to a query
against the UI5 ABAP Repository **OData service** (`/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/`)
to resolve metadata about a deployed UI5 app — package, description, version. It is
orthogonal to the ADT-filestore-based `BSP` type and is best understood as a pseudo-type /
"action disguised as type".

## TADIR ground truth
- **R3TR type**: does not exist as `BSP_DEPLOY` in TADIR.
- **LIMU sub-objects**: n/a.
- **abap-file-formats support**: ❌ n/a.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| n/a | UI5 ABAP Repository OData metadata | `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('<NAME>')` | ARC-1 `getAppInfo` (`src/adt/ui5-repository.ts`) |

## SAP docs & notes
- SAPUI5 ABAP Repository OData Service documentation.

## Other MCP servers / cross-reference
- Not commonly exposed by other MCP-ADT servers; ARC-1-specific convenience.

## Live verification
### a4h (S/4HANA 2023)
- Probed via `cachedFeatures.ui5repo.available`; returns `Repositories('ZAPP_BOOKING')`-style
  metadata when ICF is active.

### 7.50 (NW 7.50)
- Depends on UI5 add-on/SP level; older systems may not ship the OData service.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `handleSAPRead` | 1754–1768 | `case 'BSP_DEPLOY'` → `getAppInfo` | ✅ functional |
| Schema enum | `src/handlers/schemas.ts` SAPREAD types | `BSP_DEPLOY` | ✅ |
| Tool description | 104, 108 | "BSP_DEPLOY (query deployed UI5 apps via ABAP Repository OData…)" | ✅ |

## Verdict
- **Status**: pseudo (action disguised as type — same architectural smell as
  `API_STATE`, `INACTIVE_OBJECTS`, `VERSIONS`, `VERSION_SOURCE`, `TABLE_CONTENTS`)
- **Evidence**: verified-from-source (it's our own code; no external truth claim to make)
- **Issue**: name overlap with `BSP` is confusing; users may not know whether to use
  `BSP` (filestore) or `BSP_DEPLOY` (OData metadata).

## Recommendation
- Architectural: move `BSP_DEPLOY` out of the `type` enum and into a separate
  `view`/`action` parameter (e.g., `SAPRead(type='BSP', name='ZAPP', view='deployment')`),
  consistent with the broader recommendation for pseudo-types. Defer until the
  pseudo-type cluster is reorganized as a group.
- Until then: keep with the current name, but ensure the description clarifies the
  difference between `BSP` (file browsing) and `BSP_DEPLOY` (OData metadata).
- **Breaking change**: yes if renamed; minimal user impact if combined with other
  pseudo-type cleanup.
- **Test gap to close**: integration test asserting both `BSP` and `BSP_DEPLOY` work and
  return non-overlapping payloads for the same app.
