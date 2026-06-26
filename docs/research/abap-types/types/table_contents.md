# TABLE_CONTENTS — Table Data Preview (pseudo-type)

## TL;DR
`TABLE_CONTENTS` is a pseudo-type for "preview rows of a named DDIC table or CDS view via
the ADT data preview endpoint". Distinct from free SQL (`SAPQuery`) — gated by
`allowDataPreview`, not `allowFreeSQL`. Real ADT endpoint:
`/sap/bc/adt/datapreview/ddic?ddicEntityName=<TABLE>&rowNumber=<N>` (POST with optional
SQL filter expression as the body, `text/plain`).

## TADIR ground truth
- **R3TR type**: does not exist.

## What ADT URL ARC-1 actually calls
- `POST /sap/bc/adt/datapreview/ddic?rowNumber=<n>&ddicEntityName=<name>` with the
  filter expression as the body (`src/adt/client.ts:594–606`).
- Distinct from freestyle SQL `POST /sap/bc/adt/datapreview/freestyle` (used by
  `SAPQuery`).

## Architectural assessment
- Plausibly a *type* in the loose sense — it's "the contents of table T". But because
  TABL is already a real type that returns *metadata*, having `TABLE_CONTENTS` be a
  separate type instead of `SAPRead(type='TABL', name='T000', view='contents')` is the
  same anti-pattern as `API_STATE`/`VERSIONS`.
- Strict TypeScript Zod refinements already exist on this type (no SELECT, no WHERE,
  no semicolons — `src/handlers/schemas.ts:129–157`), so the cross-field validation
  effort here is already non-trivial. A `view='contents'` model would simplify schema.

## Live verification
### a4h (S/4HANA 2023)
- Endpoint live; returns row data for SAP-shipped tables (e.g., `T000`).
- BTP variant: only released CDS / custom tables — SAP standard tables blocked
  (per tool description).

### 7.50 (NW 7.50)
- Same endpoint.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| Schema enum | `src/handlers/schemas.ts:36, 70` | `TABLE_CONTENTS` (+ validation 129–157) | ✅ |
| `handleSAPRead` | 1663–1667 | `case 'TABLE_CONTENTS'` | ✅ |
| `client.getTableContents` | 594–606 | `/sap/bc/adt/datapreview/ddic` | ✅ |
| Error hints | 423–428, 471–476 | sqlFilter shape + safety hints | ✅ |
| Tool description | 104, 108 | clear distinction from SQL | ✅ |

## Verdict
- **Status**: pseudo (action disguised as type), but well-scaffolded
- **Evidence**: verified-on-live-system
- **Issue**: same architectural smell as the other pseudo-types.

## Recommendation
- Eventually: `SAPRead(type='TABL', name='T000', view='contents', maxRows=…, sqlFilter=…)`.
- Until then: keep — has the most polished schema/error hints of any pseudo-type.
- **Breaking change**: yes if renamed.
- **Test gap to close**: integration test asserting `allowDataPreview=false` blocks but
  `allowFreeSQL=true` alone does NOT (i.e., `TABLE_CONTENTS` and free SQL are decoupled).
