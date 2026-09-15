# Normal object-search filtering (customer B-2)

## Root cause and protocol evidence

`SAPSearch` accepts `objectType`, but its default/object handler drops it before
calling `AdtClient.searchObject`. Filtering after the result cap would miss valid
objects, so SAP must apply the filter.

Read-only requests on A4H, SAP_BASIS 758 SP02, client 001 (14 September 2026):

| Quick-search parameter, query `*` | HTTP | Returned types |
|---|---|---|
| none, limit 10 | 200 | LDBA/L, DEVC/K |
| `objectType=CLAS`, limit 10 | 200 | CLAS/OC only |
| `objectType=CLAS/OC`, limit 5 | 200 | CLAS/OC only |
| `objectType=UIAC`, limit 5 | 200 | UIAC only |
| `objectType=FUGR/FF` or `FUNC`, limit 5 | 200 | FUGR/FF only |
| `objectType=NOSUCH` | 406 | rejected |
| `searchObjectType=CLAS`, `CLAS/OC`, `UIAC`, or `NOSUCH` | 200 | unfiltered LDBA/L, DEVC/K |

Endpoint: `/sap/bc/adt/repository/informationsystem/search`, with
`operation=quickSearch`, `query=*`, `maxResults`. Omitting `operation` while
using the reported `searchObjectType` parameter returned HTTP 400. The customer
parameter name is therefore not a portable contract. Existing exact lookup in
ARC-1 independently uses `objectType`. No customer-system reproduction is claimed.

## Implementation plan and review

1. Add an optional third `searchObject` argument, trim/uppercase it, preserve ADT
   slash subtypes, and URL-encode it as `objectType`. Forward the normal handler
   argument. Keep unfiltered calls and the source/exact-lookup branches unchanged.
2. Describe the supported filter in both tool variants. Bound the existing string
   to 64 characters in both runtime schemas and the advertised JSON schema.
3. Add regressions through real handler dispatch for default/explicit object mode,
   slash values and encoding, plus direct-client compatibility and schema bounds.
4. Run focused tests, review deliberate schema snapshots, and run repository gates.

Plan review: no extra SAP calls, local filtering, fallback to unfiltered results,
new write capability, or allowlist changes. The search gate remains before HTTP.
Unknown types remain SAP errors; no guessed type enum. Preserving slash types is
necessary to retain subtype precision. The public client argument is optional.

## Verification and implementation review

The five new handler/schema regressions failed before implementation and passed
afterward. Full unit suite: 6,586 tests across 213 files passed. Typecheck, Biome,
action-policy validation, build, file-size and tool-schema budgets passed. Reviewed
all seven snapshot changes: only the type-filter description and maximum length
changed. Direct-client tests cover omitted filters, subtype preservation, and a
rejected type propagating without an unfiltered retry. Security review: the new
value is bounded at dispatch and encoded at the URL sink; the existing search
permission check still runs first. No mutation, identity or caching changes.

## Follow-up review of Claude's findings

Accepted the missing normal-search documentation and contextual guidance for a
filtered 406 or empty result. Only a filtered 406 is translated; authorization
and other failures propagate, with no automatic unfiltered retry. Empty results
on older systems mention the requested filter. The guidance does not copy SAP
response details, including under minimalErrors.

Additional inspection found that dispatch collapsed recognized slash types before
calling the handler. The earlier encoding test used an unrecognized slash string,
so it did not catch this. Object search now preserves real CLAS/OC and DDLS/DF
subtypes while translating the existing friendly KTD alias to SKTD. Source-code
and exact-lookup normalization retain their prior behavior.

Validation: 130 focused tests and all 6,594 unit tests (213 files) passed; build,
typecheck, lint, policy and size/schema gates passed. Read-only live calls through
dispatch on SAP_BASIS 758 SP02 and 816 SP01 verified NOSUCH produces the new error
and CLAS/OC and DDLS/DF each return the requested subtype with maxResults=1.

## Review round 2 (2026-09-15)

No additional code finding. Added the optional release caveat after independently
running the combined compiled CLI on 7.50: `SAPSearch query="*" objectType="TABL/DS"
maxResults=8` returns both TABL/DT and TABL/DS. ARC-1 preserves the requested filter;
this backend ignores its subtype. This was a read-only verification.

Documentation update verification: build, typecheck, lint, policy, file/schema budgets
and all **6,594 tests in 213 files** passed.
