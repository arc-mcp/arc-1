# Research: SAPContext Impact Sibling Consistency Heuristic

**Date:** 2026-04-21
**Scope:** `SAPContext(action="impact")` additive sibling metadata-extension consistency analysis.

## Goal

Detect a common RAP troubleshooting pattern:
- target DDLS has no downstream `DDLX` consumers
- sibling DDLS variants in the same package do have downstream `DDLX` consumers

This indicates likely asymmetric UI-annotation coverage across routing variants.

## Heuristic Design

The sibling check is intentionally conservative:

1. Resolve the target package using `searchObject()` and an exact DDLS name match.
2. Build sibling candidates from `searchObject(stem + "*")`.
3. Keep only candidates that:
   - normalize to `DDLS`
   - are in the same package as the target
   - match numeric-variant sibling naming (`stem` + optional numeric suffix)
   - are not the target itself
4. For each kept candidate (bounded by cap), run where-used and compare `metadataExtensions` count.

Finding rule:
- emit a hint only when target `metadataExtensions=0` and at least one sibling has `metadataExtensions>0`.

## False-Positive Controls

- **Same-package requirement** filters out similarly named objects in unrelated components.
- **Numeric-variant suffix matching** avoids broad prefix-based matches (`*_A`, `*_TEST`, etc.).
- **No hard errors** from sibling analysis; failures become warnings and preserve base impact output.
- **No implicit transitive expansion** beyond normal where-used behavior; sibling analysis only compares bucket counts.

## Bounded-Call Strategy

- `siblingCheck` defaults to `true` for signal, but can be disabled per call.
- `siblingMaxCandidates` defaults to `4`, hard-capped at `10`.
- Search fan-out is capped and candidate comparison is truncated to the configured cap.

This keeps latency predictable and token output bounded.

## Known Limitations

- Naming heuristics only cover numeric variant families; arbitrary sibling naming conventions are out of scope.
- Package resolution depends on quickSearch visibility and may fail on restricted authorizations.
- Metadata-extension signal is based on where-used consumer bucketing, not static source introspection of DDLX content.
- Systems without where-used endpoint support cannot run sibling comparison; callers receive warnings only.
