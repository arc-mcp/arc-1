# VERSION_SOURCE — Specific Revision Body (pseudo-type)

## TL;DR
`VERSION_SOURCE` is a pseudo-type for "GET the source body at the URI returned in a prior
`VERSIONS` response". Takes `versionUri` (must start with `/sap/bc/adt/`); ignores `name`
in the URL build (uses the URI directly).

## TADIR ground truth
- **R3TR type**: does not exist.

## What ADT URL ARC-1 actually calls
- The `versionUri` arg verbatim — typically a path returned in the Atom `<link>` of a
  prior `VERSIONS` feed entry. Accept `text/plain`. Implementation in
  `src/adt/client.ts:493–500`.

## Architectural assessment
- This is the most clearly action-shaped of all pseudo-types. There's no "type" being
  read at all — it's "fetch arbitrary URI from a prior VERSIONS response".
- Better fit: a sibling action of `VERSIONS`, e.g.
  `SAPRead(type=<obj>, name=<n>, view='version_source', versionUri=...)` —
  same pseudo-type cleanup recommendation as `VERSIONS`.

## Live verification
### a4h (S/4HANA 2023)
- Works for any URI returned by `VERSIONS`.

### 7.50 (NW 7.50)
- Same.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| Schema enum | `src/handlers/schemas.ts:52, 110` | `VERSION_SOURCE` (with cross-field validation requiring `versionUri`) | ✅ |
| `handleSAPRead` | 1615–1632 | `case 'VERSION_SOURCE'` | ✅ |
| `client.getRevisionSource` | 493–500 | direct URI fetch | ✅ — `/sap/bc/adt/` prefix guard prevents arbitrary URLs |

## Verdict
- **Status**: pseudo (action disguised as type)
- **Evidence**: verified-from-source
- **Issue**: trivially safe (prefix-checked URI), but enum-shaped wrong.

## Recommendation
- Same as `VERSIONS` — fold into a `view` parameter family in the long term.
- **Breaking change**: yes if removed.
- **Test gap to close**: integration test that round-trips
  `VERSIONS` → `VERSION_SOURCE` for a CLAS and asserts source bytes match a known revision.
