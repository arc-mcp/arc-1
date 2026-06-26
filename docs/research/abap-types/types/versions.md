# VERSIONS — Source Revision List (pseudo-type)

## TL;DR
`VERSIONS` is a pseudo-type that lists revisions for an object identified by
`objectType` + `name` (+ optional `include` for CLAS, `group` for FUNC). Real ADT endpoints
are per-type `versions` Atom feeds. The type encoding is the wrong shape — `VERSIONS`
demands a *second* `objectType` arg, exactly the same anti-pattern as `API_STATE`.

## TADIR ground truth
- **R3TR type**: does not exist.

## What ADT URL ARC-1 actually calls
Built by `revisionsUrlFor` in `src/adt/client.ts:436–478`:
- `PROG`: `/sap/bc/adt/programs/programs/<n>/source/main/versions`
- `CLAS`: `/sap/bc/adt/oo/classes/<n>/includes/<include>/versions`
- `INTF`: `/sap/bc/adt/oo/interfaces/<n>/source/main/versions`
- `FUNC`: `/sap/bc/adt/functions/groups/<group>/fmodules/<n>/source/main/versions`
- `INCL`: `/sap/bc/adt/programs/includes/<n>/source/main/versions`
- `DDLS`: `/sap/bc/adt/ddic/ddl/sources/<n>/source/main/versions`
- `DCLS`: `/sap/bc/adt/acm/dcl/sources/<n>/source/main/versions`
- `BDEF`: `/sap/bc/adt/bo/behaviordefinitions/<n>/source/main/versions`
- `SRVD`: `/sap/bc/adt/ddic/srvd/sources/<n>/source/main/versions`

Accept `application/atom+xml;type=feed`. Response parsed by `parseRevisionFeed`.

## Architectural assessment
- Same pseudo-type smell. Real shape should be
  `SAPRead(type='CLAS', name='ZCL_FOO', view='versions')` — separates "what object" from
  "what view of it". Today's `VERSIONS` requires `objectType` to do exactly that
  separation, but in an awkward back-channel field.

## Live verification
### a4h (S/4HANA 2023)
- Versions endpoint exists for all listed types; returns Atom feed.

### 7.50 (NW 7.50)
- May 404 on some DDIC types (per error-handling at `intent.ts:1606–1611`).

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| Schema enum | `src/handlers/schemas.ts:51, 91` | `VERSIONS` | ✅ functional |
| `handleSAPRead` | 1585–1614 | `case 'VERSIONS'` | ✅ |
| `client.revisionsUrlFor`/`getRevisions` | 436–490 | per-type URL | ✅ |
| Tool description | 104 | "VERSIONS (list revision history…)" | ✅ |

## Verdict
- **Status**: pseudo (action disguised as type)
- **Evidence**: verified-from-source; on-prem only per current code comment
- **Issue**: same as `API_STATE` — type enum is the wrong place.

## Recommendation
- Future major release: introduce `view='versions'`, route through current `revisionsUrlFor`,
  soft-deprecate `type='VERSIONS'`.
- BTP path is intentionally not wired up — keep that boundary explicit.
- **Breaking change**: yes if removed.
- **Test gap to close**: integration test for VERSIONS on each supported type (PROG, CLAS,
  INTF, INCL, FUNC, DDLS, DCLS, BDEF, SRVD) confirming non-empty feed and correct URL shape.
