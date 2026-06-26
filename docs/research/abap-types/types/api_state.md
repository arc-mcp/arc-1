# API_STATE — API Release State (pseudo-type)

## TL;DR
`API_STATE` is **not** an ABAP object type. It is an ARC-1 pseudo-type encoding "look up
the API release state for the object whose URI you reconstruct from `objectType` + `name`".
It is an action disguised as a type. The real ADT endpoint it calls is
`/sap/bc/adt/apireleases/<URL-encoded object URI>` returning
`application/vnd.sap.adt.apirelease.v10+xml`.

## TADIR ground truth
- **R3TR type**: does not exist.
- **abap-file-formats support**: n/a.

## What ADT URL ARC-1 actually calls
- `/sap/bc/adt/apireleases/<URL-encoded(objectUrl)>` — see
  `src/adt/client.ts:530` (`getApiReleaseState`) and
  `src/handlers/intent.ts:1649–1661` where `objectUrlForTypeRaw(inferredType, name)` builds
  the inner URI and the apireleases endpoint encodes it as a single path segment.

## Architectural assessment — type vs view/action
- `API_STATE` is best modeled as a **view** of any other object (CLAS, INTF, DDLS, …),
  not as a sibling type. The `objectType` arg is essentially required (auto-inferred from
  `CL_/IF_/CX_` only) — proving the model is wrong: a real type doesn't need a *second*
  type parameter.
- Recommended target shape: `SAPRead(type='CLAS', name='ZCL_FOO', view='api_state')`
  or `SAPRead(type='CLAS', name='ZCL_FOO', action='api_state')` — separates "what
  object" from "what perspective on that object".
- Until refactor: the current pseudo-type works and is widely cited in tool description
  and prompts, so don't break it gratuitously.

## Live verification
### a4h (S/4HANA 2023)
- Endpoint exists; returns C0–C4 contract states + successor info per `parseApiReleaseState`.

### 7.50 (NW 7.50)
- Endpoint may be absent on older releases; ARC-1 surfaces 404 from underlying call.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| Schema enum | `src/handlers/schemas.ts:46, 77` | `API_STATE` | ✅ functional |
| `handleSAPRead` | 1649–1661 | `case 'API_STATE'` | ✅ |
| `client.getApiReleaseState` | 528–534 | `/sap/bc/adt/apireleases/{enc(uri)}` | ✅ |
| Tool description | 104, 108 | "API_STATE (API release state — …)" | ✅ |

## Verdict
- **Status**: pseudo (action disguised as type)
- **Evidence**: verified-from-source; ADT endpoint exists per official "Released APIs"
  feature on S/4HANA Cloud.
- **Issue**: schema/UX smell — should be a view/action parameter, not a sibling of `CLAS`.

## Recommendation
- Architectural: introduce a `view` (or `action`) param on SAPRead, route `view='api_state'`
  to current handler, deprecate `type='API_STATE'` over a major release.
- **Breaking change**: yes if removed; soft-deprecate first.
- **Test gap to close**: integration test reads API state for a known released class
  (e.g., `CL_ABAP_TSTMP`) and asserts contract state ≠ unknown.
