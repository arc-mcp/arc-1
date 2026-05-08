# ADR 0003 — SAPRead `version` parameter stays internal until diff feature is designed

**Status:** **Superseded** — see [PR #186](https://github.com/marianfoo/arc-1/pull/186) (merged 2026-04-28).
**Original date:** 2026-04-28 (proposed)
**Superseded date:** 2026-04-28
**Related PR:** [#196](https://github.com/marianfoo/arc-1/pull/196) (NW 7.50 compatibility fixes — proposed `version` on SAPRead)

## Resolution: superseded by maintainer design choice

PR [#186](https://github.com/marianfoo/arc-1/pull/186) (merged 2026-04-28, the same day this ADR was drafted) shipped the etag-validated source cache and **also** added a user-facing `version: 'active' | 'inactive' | 'auto'` parameter to `SAPRead`. The maintainer judged that surfacing the version axis directly to LLMs was valuable enough to warrant the public-API change despite Principle #6 of the etag plan. ADR-0003 is therefore retained only as a record of the analysis at the time the PR-196 split was being designed; it does not reflect ARC-1's current shipped behavior.

The analysis below is preserved verbatim. Read it as a snapshot of one design option, not a current recommendation. Two of its three claims still hold:

- **Claim 1 (etag plan principle #6):** Correct — the etag plan internally tracked version as a cache-key axis. PR #186 implemented that *and* added the user-facing surface.
- **Claim 2 (FEAT-DIFF as natural home for `version`):** Open question — FEAT-DIFF is still on the roadmap. SAPRead now has `version`; FEAT-DIFF will need to choose a different parameter name (e.g. `version1`/`version2` for two-revision diff) to avoid collision.
- **Claim 3 (defer to avoid public-API churn):** Rejected by PR #186. The churn risk was judged smaller than the LLM-discoverability benefit.

## Context (preserved from original draft)

[PR #196](https://github.com/marianfoo/arc-1/pull/196) proposes adding `version: 'active' \| 'inactive'` to `SAPReadSchema` / `SAPReadSchemaBtp`, with an early-return path in [src/handlers/intent.ts](../../src/handlers/intent.ts) that appends `?version=…` to the source URL.

The pre-existing etag-and-inactive-objects plan (commit `c9ebe47`, [docs/plans/etag-conditional-get-and-inactive-objects-fix.md](../plans/etag-conditional-get-and-inactive-objects-fix.md)) explicitly excluded this surface change in Design Principle #6:

> **No breaking changes to the SAPRead schema.** This plan does not add a `version` parameter to the SAPRead Zod schema or tool description. The cache internally tracks versions for correctness; the surface stays exactly as today. A future plan can add the user-facing parameter if there's demand for reading inactive drafts directly.

Live probe of A4H 758 SP02 confirmed both halves of this plan's reasoning are accurate:

- The SAP server already supports `?version=active|inactive` on source URLs and returns different etags per version (DDLS `I_TIMEZONE` returned etag suffix `…0011` for active, `…0001` for inactive — exactly matching the etag plan's predicted cache-key shape).
- Surfacing `version` on `SAPRead` would design a public API on top of a backend feature the etag plan already plans to consume internally.

The roadmap also already lists [FEAT-24 CompareSource (Diff)](../../docs_page/roadmap.md) as the home for user-facing version-aware reads — *"Client-side diff of two revision sources — ADT has no server-side diff endpoint"*. Adding `version` on `SAPRead` now creates a near-future API churn (add now, possibly remove or restructure when FEAT-DIFF lands).

PR [#179](https://github.com/marianfoo/arc-1/pull/179) (already merged) added `version: 'active' \| 'inactive'` to `SAPDiagnose action=syntax`, scoped to the syntax-check use case where active-vs-inactive matters today (post-write diagnostics on the inactive draft).

## Original decision (not adopted)

Defer surfacing `version` on `SAPRead` until FEAT-DIFF is designed. Concrete actions:

1. Drop the `version` field from `SAPReadSchema` and `SAPReadSchemaBtp` in [src/handlers/schemas.ts](../../src/handlers/schemas.ts).
2. Drop the early-return `version` branch in `handleSAPRead` (around line 1404 in PR #196's intent.ts) and the associated `SOURCE_TYPES` set.
3. Drop the `version` property from the SAPRead JSON schema in [src/handlers/tools.ts](../../src/handlers/tools.ts).
4. Treat the `version` axis as **cache-internal only**, exactly as the etag plan specifies. When the etag plan ships the cache key change to `(type, name, version)`, the existing `version` query parameter becomes part of the conditional-GET layer — invisible to LLMs.
5. The STRU active/inactive lifecycle e2e test added by PR #196 ([tests/e2e/ddic-write.e2e.test.ts](../../tests/e2e/ddic-write.e2e.test.ts)) is restructured: assert STRU CRUD round-trip (create → activate → update → activate → delete) without a `version` parameter. The active/inactive comparison can be re-added later via `SAPDiagnose action=syntax version=…` (already exposed) if needed for regression coverage.

## What main actually shipped

PR #186 added `version: 'active' | 'inactive' | 'auto'` to both `SAPReadSchema` and `SAPReadSchemaBtp` (default `'active'`). The handler routes through the conditional-GET cache layer with the version axis as the cache key. STRU was independently collapsed into TABL by PR [#219](https://github.com/marianfoo/arc-1/pull/219). The combined effect: LLMs can now read active or inactive sources directly, and the etag-validated cache treats the two as separate cache entries (per the etag plan's internal design).

## Lesson for future ADRs

ADRs that recommend declining a feature are at higher risk of being superseded by parallel implementation work, especially in a fast-moving repo. When drafting an ADR that says "don't do X," check open PRs for in-flight work on the same feature before publishing — and link to those PRs in the ADR so reviewers see the trade-off being made simultaneously elsewhere.

## References

- [PR #186](https://github.com/marianfoo/arc-1/pull/186) — etag-validated source cache + `version` parameter (the change that superseded this ADR).
- [docs/plans/etag-conditional-get-and-inactive-objects-fix.md](../plans/etag-conditional-get-and-inactive-objects-fix.md) — the pre-existing plan with Principle #6 (now overridden in practice).
- [docs_page/roadmap.md](../../docs_page/roadmap.md) FEAT-24 CompareSource (Diff) — needs to choose a non-`version` parameter name to avoid collision with the now-shipped SAPRead `version`.
- PR [#179](https://github.com/marianfoo/arc-1/pull/179) — SAPDiagnose `version` precedent.
