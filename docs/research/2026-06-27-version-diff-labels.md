# Research: readable labels for `SAPRead action="diff"`

Dated 2026-06-27. Scope: extend the existing single-system source diff API with caller-supplied
display labels for the two patch headers.

## Goal

Let callers replace raw refs in unified-diff headers with human-readable revision context, for
example:

```diff
--- ZCL_ORDER (DNT-6-6: Validate discounts, DS7K900123)
+++ ZCL_ORDER (active)
```

This is useful when a caller already fetched `SAPRead(type="VERSIONS")` and has `versionTitle`,
`transport`, author, or timestamp metadata. The diff remains the same; only the labels shown in the
patch header and one-line summary change.

## Verified contract

No new ADT endpoint or SAP behavior is introduced. The existing diff contract remains authoritative:
`docs/research/2026-06-15-version-diff-saved-read-action.md`.

Key inherited facts:

| Concern | Current verified behavior |
|---|---|
| Active/inactive source | `GET <sourceUrl>?version=active|inactive`, raw text |
| Revision source | `GET .../versions/<timestamp>/<sequence>/content`, raw text |
| Revision id resolution | Bare ids resolve through the existing `VERSIONS` feed |
| Server-side diff | None; ARC-1 computes a local unified diff |
| Release behavior | Existing research marked the `?version=` and revision endpoints release-invariant |

Because labels are local presentation data, there is no response-content behavior to re-probe on SAP
systems. Existing live checks already cover the source bytes, no-draft guard, revision URI/id
resolution, and supported-type matrix.

## External input

The fork branch `Prolls:arc-1:feat/compare-source-diff` contains a useful `label1`/`label2` idea for
readable diff headers. Its implementation targets the pre-consolidation `SAPDiagnose`/`intent.ts`
path and is superseded by main's `SAPRead action="diff"` implementation. The idea to keep is only
optional caller labels.

## ARC-1 impact map

| File | Change |
|---|---|
| `src/adt/version-diff.ts` | Extend diff options with optional `fromLabel`/`toLabel`; feed labels into `unifiedDiff` |
| `src/handlers/read.ts` | Read optional labels from tool args and use them in the summary line |
| `src/handlers/schemas.ts` | Add `fromLabel`/`toLabel` to both SAPRead schemas |
| `src/handlers/tools.ts` | Expose `fromLabel`/`toLabel` in the LLM-visible SAPRead JSON schema |
| `docs_page/tools.md` | Document the optional labels |
| `tests/unit/handlers/read.test.ts` | Assert headers and summary use custom labels |
| `tests/unit/handlers/schemas.test.ts` | Assert schema accepts labels |
| `tests/fixtures/tool-definitions/*.json` | Regenerate because the SAPRead tool surface changes |

## Design choice

Use `fromLabel` and `toLabel`, not `label1`/`label2`, so the names align with the existing
`from`/`to` parameters and avoid introducing a second naming convention.

The labels are optional display strings only. They must not affect source resolution, not trigger any
extra SAP requests, and not change the existing default labels.
