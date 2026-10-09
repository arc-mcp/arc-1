# Prove active table entities before permitting guarded data reads

## Native evidence and root cause

2025/816 and BTP920 SP04 support physical CDS table entities. Their direct graph
request returns HTTP400 NoDependencyGraphDataCalculationPossible; a view graph
contains an unnamed terminal with explicitly empty TYPE, equal ENTITY_NAME and
NODE_NAME, RELATION=FROM and AC_STATE=NA. Active DDLS metadata identifies the exact
source as DDLS/DF, source_type="table entity", version="active". 750 refuses create;
758 native syntax rejects this DDL. Unknown graph nodes remain unsafe by default.

SAP documents table entities as physical database tables. Their associations do
not make a base-column query read every association target; any expanded SQL
branch still needs lineage. DCL is native authorization, not an ARC-1 allow rule.
Sources: SAP Help ABAP data models, Properties of Table Entities; ADT user guide,
Creating and Activating Data Models. Raw native evidence is retained in the local
816 audit's implementation/table-entity-{816,btp}.json and graph captures.

## Reviewed bounded design

1. Keep the strict parser's default refusal. Only the captured unnamed, untyped,
   childless FROM/INNER_JOIN leaf with equal valid identities can request additional proof.
   All other unsupported/malformed branches remain refused. Never accept a new
   wire TYPE by adding it to the allowlist.
2. Resolve the candidate through the existing exact-name unique STOB/DDLS search.
   Limit this initial contract to equal entity/DDLS names; ambiguous aliases are
   refused. GET that DDLS with version=active and require exact name/type/version
   and source_type. Missing/403/404/wrong kind/inactive metadata refuses.
3. Reparse the same bounded graph with a request-local set of proven names. Limit
   extra candidate resolutions to 64. The parser still inspects the complete graph;
   the resulting internal table-entity terminal does not use DD02L replacement
   metadata. Exact blocklist rules apply to every identity as before.
4. Direct table entities use the same active proof only after the specific native
   unsupported-entity graph error. No fallback after arbitrary 400/403/404/network
   failures. Require graph/root identity agreement as before.
5. No cache, source-code parsing, release heuristic, fallback to unguarded queries,
   SQL grammar broadening or support for table functions/set operations.

## Acceptance and review

Captured-shape and hostile controls: empty/missing TYPE, unknown kind, children,
conflicting names, wrong active metadata, unreadable metadata, ambiguous search,
root mismatch, blocked direct/transitive leaves, unchanged legacy graphs. Verify
no requested data POST occurs on denial for SAPQuery, TABLE_QUERY and TABLE_CONTENTS.
Native 816/BTP: direct, view, nested view and join, blocked roots/leaves, fresh
inactive draft differing from active, public read paths and complete cleanup.
Repeat normal guarded reads on 758 and the known unavailable-catalog behavior on
750. Full repository gates, then final review before PR.


Plan review refinement: a fresh direct table-entity self-join on 816 exposed the
same unnamed terminal shape with RELATION=INNER_JOIN. The first implementation
correctly refused it. Added that exact verified relation and a regression; do not
broaden the fallback to arbitrary relation kinds. Joins through typed views had
already passed on both newer targets.

## Final validation (2026-10-09 UTC)

Compiled public-tool matrix on 816 and BTP920 SP04: 33 records each, including
creation/activation, direct entity, one/two-level view, direct table self-join,
SAPQuery/TABLE_QUERY/TABLE_CONTENTS allow and blocked-leaf cases, and active
metadata while a changed table definition remains inactive. All four owned DDLS
objects on each target were deleted and returned 404. Earlier view-to-view joins
also passed. A fresh BTP directory audit found no remaining DDLS/STOB rows for
these fixtures. Native graph fixtures preserve both captured leaf relations.

Fresh 758 guarded SCARR and DEMO_CDS_SUMDIST reads pass. 750 retains its honest
DATA_POLICY_UNAVAILABLE refusal when the replacement-catalog data endpoint is
absent, including the legacy graph path. Table-entity creation was independently
refused on 750 and rejected by native syntax on 758; no newer grammar is advertised
as supported there.

34 focused regressions cover bounded 64-identity proof, fresh metadata per request,
missing/draft/wrong-name/wrong-kind metadata, 403/404, arbitrary graph failures,
unknown/missing TYPE, children, conflicting identity, alias ambiguity, direct and
transitive blocks, all three data-read boundaries and batch preflight. Existing
legacy/view-entity/projection/table-function tests remain green. Full unit suite,
typecheck, lint, policy validation, build, size/schema budgets and docs build pass.

Final review: the new TABLE_ENTITY kind is internal proof output, never accepted
as a wire TYPE. There is no data-query fallback, cross-request proof cache,
replacement-catalog shortcut, or change to the strict SQL grammar. Same-name
active identity remains required; unverified graph relations remain refused.
Roadmap checked: COMPAT-07, COMPAT-10 and SEC-18 are unchanged. This covers the
local outage audit's COMPAT-13 contract only for these verified shapes.
