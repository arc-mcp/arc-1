# Native where-used filters and details (#1018)

## Evidence and scope

Read-only native probes and temporary class fixtures on 2026-10-18 establish:

- `/usageReferences/scope{?uri}` is advertised as a discovery template link on SAP_BASIS 816 and BTP 920, absent on 750/758. Scope POST needs the URI, vendor MIME and `usageScopeRequest` root. Echo the supplied grade/programs/payload, select all advertised object types and use `propertyFilter package:A,B` for exact packages.
- Scope XML must emit explicit boolean attribute values. SAP defaults omit several object types; a package query must select every advertised type.
- `/usageSnippets` is a discovery collection on all four systems. Its MIME family is `usagesnippets`, not `usagereferences.snippet`. Expand the opaque identifiers on reference nodes, including `isResult=false, canHaveChildren=true` nodes. Class method nodes inherit their owner's type for filtering.
- 750 snippet URIs can omit columns (`#type=CLAS%2FOM;name=CALCULATE;start=2`); match ranges supply columns. Method positions are relative to that component, not necessarily the complete class source.
- Existing standard-object probes and owned class pairs verify actual snippets. Native scope reduced T000's 816 response to 226 KB for classes and 263 KB for structures. 750's broad T000 search fails inside SAP; narrower owned-class searches work. Do not hide backend errors.

## Plan

1. Reuse the current reference parser; retain native identifiers only internally for opt-in details. Preserve the ordinary response and advisory consumers.
2. Add a small native API module: discover only on package/detail requests, fetch/echo scope when advertised, otherwise filter locally. Never follow a discovery URL or interpret opaque payloads. No cache or new admin setting.
3. Add `packages` (1–20 exact names, no wildcards or recursive package expansion) and `detail=objects|positions|snippets` to SAPNavigate.references. `objectType` stays local; native scope categories are not assumed to match result types.
4. Details expand at most 10 unique native identifiers in one request, return at most maxResults usage entries, and retain access/grade match text. Bound cumulative metadata to 8 MiB, snippets to 2 MiB, and the operation to 30 seconds. Missing identifiers, endpoint support and caps are visible; authorization/transport failures propagate. No source scanning fallback.
5. Keep SAP's search explanation, including unsupported-position responses. Do not turn an empty list into an inventory guarantee.
6. Test real XML shapes, filtering and ancestor resolution, escaping, old-system fallback, authorization failures, bounds and schema rejection. Run build/typecheck/lint/full units/docs; live fixtures on 750/758/816/BTP; independent Claude Opus 5.5 max review and assess findings before PR readiness.

## Plan review

The implementation stays on SAP's existing per-user read path. Exact package names avoid a misleading server-side wildcard promise. Existing reference consumers retain their behavior. Parent traversal must be cycle-bounded; mixed results without identifiers must be reported as unexpanded rather than lost silently. Empty native search results are valid and must not trigger a broader retry. The 50-candidate structure append guard remains unchanged; native filtering does not distinguish an append from other TABL/DS consumers.

No roadmap impact: #1018 tracks this work; the roadmap contains no separate scope/snippet entry. Deferred wildcard/package-tree expansion and customizable grades are not required for this first implementation.

## Implementation review and validation

The final design adds one native ADT module and one detail projection module, reusing the existing
parser and reference handler. No cache, source scanning, custom ABAP, new permission or global
option is introduced. The empty SAP explanation also reaches SAPContext usages/impact; an empty
cursor identifier alone no longer triggers whole-interface enrichment when no native rows exist.

Owned fixtures passed on 750/758/816/BTP. On 758, a static-constant-only consumer was absent
from the class reference results; using a real class instance establishes the intended fixture.
The test retains the constant usage for snippet verification; the cause of the missing
constant-only reference was not established. A maintained integration test covers the lifecycle.
All temporary research objects were deleted.

Schema growth is two parameters, about 556 wire bytes. The full-write ceiling moves from 74,500
to 75,000 bytes, with corresponding token/count ratchets; existing descriptions are retained as
requested. Read-only, aggregate, hyperfocused and per-tool wire ceilings remain unchanged. The
small schema line-budget increases keep these two fields beside their action, avoiding modules
whose only purpose would be evading the size guard.

## Independent review corrections

Claude Opus 5.5 max found three issues: ordinary objectType-only lookups changed paths,
SAPContext impact descriptions suppressed sibling checks, and analysis limits gave data-query
or connectivity advice. Keep objectType filtering local, return searchedFor separately, and
classify limits explicitly. Native scopes retain SAP’s proposed grade: omitting it dropped a
reference in both 816/BTP fixtures despite matching the ordinary response’s echoed grade.
The native handler’s compatibility branch enables indirect references when no scope is supplied;
the response echo does not establish that effective default. The live regression compares actual
in-package result URIs, not just the echoed metadata.
Regression checks also cover discovery denial, package containers and enrichment, local packages,
legacy detail counts, preserved snippet indentation, and scopes without an optional payload.
