# ADR 0001 — Discovery-driven endpoint routing replaces release-version gating

**Status:** Proposed
**Date:** 2026-04-28
**Related PR:** [#196](https://github.com/marianfoo/arc-1/pull/196) (NW 7.50 compatibility fixes)
**Supersedes:** N/A
**Superseded by:** N/A

## Context

[PR #196](https://github.com/marianfoo/arc-1/pull/196) introduced static SAP_BASIS release maps (`READ_RELEASE_GATES`, `WRITE_RELEASE_GATES`, `ACTION_RELEASE_GATES`) duplicated in [src/handlers/intent.ts](../../src/handlers/intent.ts) and [src/handlers/tools.ts](../../src/handlers/tools.ts) to gate types and route TABL→STRU on NW 7.50. Live verification surfaced four problems with this design:

1. **Two sources of truth.** The maps in `intent.ts` and `tools.ts` must stay in sync manually; the PR already had a divergence (`TABL: 751` was in tools.ts but missing from intent.ts).
2. **Manual maintenance burden.** Every new SAP support pack that back-ports an endpoint to NW 7.50 needs a manual map update. Conversely, S/4HANA endpoints that reach BTP at different times require per-release literals.
3. **Async-loaded `cachedFeatures` doesn't reach all entry points.** `runStartupProbe()` populates `cachedFeatures` only in MCP-server mode. Live probe confirmed `arc1-cli call SAPRead TABL T000` against NPL still hits `/sap/bc/adt/ddic/tables` (404) because `isRelease750()` returns `false` when features are `undefined`.
4. **Empirical evidence aligns with discovery, not release literals.** Direct comparison of `/sap/bc/adt/discovery` between A4H 758 SP02 and NPL 750 SP02 shows the discovery feed is already the authoritative answer to "is this collection available on this system?" The release-number heuristic is a proxy for what the discovery feed says directly.

| Collection | A4H discovery | NPL discovery | Release map says |
|---|---|---|---|
| `/sap/bc/adt/ddic/tables` | ✅ | ❌ | gate `TABL: 751` (correct outcome, brittle reasoning) |
| `/sap/bc/adt/ddic/structures` | ✅ | ✅ | always allowed (correct outcome, no gate needed) |
| `/sap/bc/adt/ddic/domains` | ✅ | ❌ | gate `DOMA: 751` (correct outcome, brittle reasoning) |
| `/sap/bc/adt/ddic/ddlx/sources` | ✅ | ❌ | gate `DDLX: 751` (correct outcome, brittle reasoning) |
| `/sap/bc/adt/bo/behaviordefinitions` | ✅ | ❌ | gate `BDEF: 754` (correct outcome, brittle reasoning) |
| `/sap/bc/adt/businessservices/bindings` | ✅ | ❌ | gate `SRVB: 754` (correct outcome, brittle reasoning) |
| `/sap/bc/adt/enhancements/enhoxhb` | ✅ | ❌ | gate `ENHO: 751` (NPL has `enhoxh` but not `enhoxhb` — release map can't express this) |

The `enhoxh` vs `enhoxhb` row is decisive: the static release map cannot express that NPL has *one* of two enhancement endpoints but not the other, because the release literal is not a fine-enough discriminator. Discovery answers the right question directly.

## Decision

Replace the two static release-gate tables and `isRelease750()` helper with a **discovery-driven routing primitive** built on the already-cached `/sap/bc/adt/discovery` feed.

Concrete shape:

- A new `discoveryHasCollection(uri: string): boolean` helper in [src/adt/discovery.ts](../../src/adt/discovery.ts) that consults the same cache used today for MIME negotiation, but does not require a `<app:accept>` element on the collection (the current parser drops accept-less collections — useful for MIME, harmful for availability).
- A new `resolveSourceUrl(type: string, name: string): { url: string } | { unavailable: string }` helper in [src/handlers/intent.ts](../../src/handlers/intent.ts) that maps each ABAP object type to an ordered candidate-URL list and returns the first URL whose collection is published in discovery.
- `filterByDiscovery(items, typeToCollection, discoveryMap)` replaces `filterByRelease` for tool-enum filtering in [src/handlers/tools.ts](../../src/handlers/tools.ts).
- All discovery-feed loading paths (MCP server `runStartupProbe`, CLI lazy load, integration tests) populate the same cache, so routing decisions are consistent across entry points.

Out of scope for this ADR (retain release-aware logic where structurally needed):

- The `convertNw750HtmlConflictToProperError` heuristic (covered by ADR-0002) — error reclassification is a different problem from endpoint routing.
- The `version=active|inactive` query parameter (covered by ADR-0003 + the etag plan).

## Consequences

**Positive:**

- One source of truth (the discovery feed) for "what does this system support."
- Self-correcting across SAP support packs — when SAP back-ports `/ddic/domains` to NW 7.50 SP15, ARC-1 picks it up automatically.
- Works identically in MCP-server, stdio, CLI, and integration-test paths.
- Replaces ~150 lines of duplicated release maps with one ordered candidate-list per type.
- Existing probe fixtures ([tests/fixtures/probe/npl-750-sp02-dev-edition](../../tests/fixtures/probe/npl-750-sp02-dev-edition), [tests/fixtures/probe/ecc-ehp8-nw750-sp31-onprem-prod](../../tests/fixtures/probe/ecc-ehp8-nw750-sp31-onprem-prod)) become regression tests for the new routing logic.

**Negative:**

- Discovery fetch becomes a hard dependency for routing, not just MIME negotiation. Today's graceful degradation (`fetchDiscoveryDocument` returns an empty map on failure) must be preserved — when discovery is unavailable, fall back to a defensive routing strategy ("try the canonical URL; surface SAP's response unmodified").
- Adds one additional structural piece to discovery parsing (collection-without-accept tracking).
- Behavior depends on accuracy of `/sap/bc/adt/discovery`. If a SAP system mis-publishes a collection that is not actually wired in SICF, ARC-1 routes optimistically and surfaces SAP's 404 — this is not a regression vs. the static map (which would also send the request), but it shifts the failure mode.

**Migration path:**

- ARCH-01 ships the primitive (PR-δ); the gates and `isRelease750()` are not touched.
- PR-ε removes `READ_RELEASE_GATES`, `WRITE_RELEASE_GATES`, `ACTION_RELEASE_GATES`, `parseRelease`, `parseReleaseNum`, `filterByRelease`, the TABL→STRU read fallback, and the TABL write block. Each removal is paired with a discovery-based equivalent.

## Alternatives considered

**Keep the static release map but move to a single source of truth.** Solves the duplication concern but leaves the manual-update burden, the CLI feature-cache gap, and the `enhoxh` vs `enhoxhb` precision gap.

**Run a runtime probe on first use of each type.** Self-correcting like discovery, but adds an HTTP roundtrip per type per session and requires careful caching to avoid storms. Discovery is one HTTP call at startup that already happens.

**Use SAP Note metadata.** Authoritative, but no machine-readable feed exists; would require manual SAP Note research per type.

**Status quo (release literals).** Rejected — see Context.

## References

- Live probe data captured 2026-04-28 against `a4h.marianzeis.de:50000` (S/4HANA 2023, SAP_BASIS 758 SP02) and `npl.marianzeis.de` (NetWeaver 7.50 SP02).
- [docs/nw750-discovery-gap-analysis.md](../nw750-discovery-gap-analysis.md) — empirical NW 7.50 endpoint inventory contributed by PR [#196](https://github.com/marianfoo/arc-1/pull/196) author.
- [docs/plans/discovery-driven-endpoint-routing.md](../plans/discovery-driven-endpoint-routing.md) — implementation plan (ARCH-01 / PR-δ).
- [src/adt/discovery.ts](../../src/adt/discovery.ts), [src/adt/xml-parser.ts](../../src/adt/xml-parser.ts) `parseDiscoveryDocument`.
