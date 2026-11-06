# Where-used preflight correction (#1018)

The existing helper posted to `/usageReferences/scope` without `uri`, using the
wrong MIME type and root element. Its parser expected reference counts that the
native response does not contain. This prevented append discovery and added a
failed request to CDS guidance.

The reviewed fix removes that helper and its invented fixture. CDS guidance uses
one ordinary where-used query and retains deduplication. Structure discovery uses
one query per visited node, filters actual TABL/DS results and confirms
`extend type <base> with` in each candidate source. Actual endpoint absence still produces a structure warning;
authorization failures still propagate. More than 50 candidates stop append discovery
with an explicit incomplete-result warning; includes are retained. No new tool
parameters are added.

## Large-result review

On 816, T000 returned 6,760 where-used rows: 4,080 transparent tables and 320
structures. Reading every TABL candidate would cause thousands of requests.
Transparent tables cannot be append structures (verified TABL/DS contract), and
scanning over 50 structure candidates now stops with a warning instead of silently
returning a complete-looking empty result. This is a bounded bug fix; native scope
filtering remains a separate feature. The guarded T000 call completed in 12 seconds
with only its root source read. The CI regression case BAPIRET2 returned 72 structure
candidates and completed in 15 seconds with only its root source read, below the
integration test's 30-second timeout. These timings are from 816, not latency guarantees.

## Live evidence, 17 October 2026

Disposable append creation failed through the tested ADT routes. Positive append
checks use existing objects read-only; additional 750/BTP checks are recorded below.

- 758: `/AIF/FHEAD` has append `/AIF/ECATT`. Main returned zero appends with a
  scope warning; the fix returns the append with no warning.
- 816: `SEPA_STR_MANDATE_ALV` has append `DDMA_APPEND_MNDT_ALV`. Main returned zero
  appends; the fix returns the append and its nested includes without a warning.
- 758, 816 and BTP: disposable base/consumer CDS views were created and activated.
  Guidance found the consumer using exactly one where-used request. All fixtures
  were deleted and the inactive list checked.
- 750: the disposable classic CDS pair activated, but SAP returned HTTP 200 with
  zero results and “Where-used is not supported at this position”. Cleanup passed.
  CDS consumer discovery is therefore unverified on 750; zero results are not proof
  that no consumer exists.
- Native scope requests work on 816 and BTP. They return selectable categories,
  grades and an opaque payload, not per-type counts. The scope endpoint returns
  404 on 750 and 758.

Raw discovery rechecked on 18 October after [kts982's correction](https://github.com/arc-mcp/arc-1/pull/1022#issuecomment-6242448000):
816 and BTP advertise the scope path as an `adtcomp:templateLink` inside the
`usageReferences` collection. Its `rel` is
`http://www.sap.com/adt/relations/informationsystem/usageReferences/scope`, and its
`template` is `/sap/bc/adt/repository/informationsystem/usageReferences/scope{?uri}`.
That link is absent on our 750 and 758 systems. The earlier absence claim came
from ARC-1's collection/MIME map, which does not retain nested template links.
Future native scope support can use this relation as its discovery gate.

## Remaining-limit checks, 18 October 2026

- 750: `BAPI0002_2` resolves `APPEND_BAPI0002_2_2`, without warnings.
- BTP: `/AIF/T_FINF` resolves `/AIF/ODATA_SRV` and `/AIFX/APPEND_ST`, including
  the latter's nested `/AIFX/ECH_APPEND_ST`, without warnings.
- The 750 CDS fixture still returns the unsupported-position message. CRUD hints
  now preserve SAP's explanation for empty results verbatim; they do not infer
  support from HTTP 200 or classify translated text. The fixtures were deleted.
- Regression tests cover exactly 50 candidates, the existing over-limit case,
  retaining root appends after a nested scan stops, and candidate-read 403 errors.

The candidate bound limits additional source scans, not SAP's initial where-used
response or total graph work. The latest CI BAPIRET2 call passed in 25.3 seconds
within its 30-second timeout. Native narrowing remains #1018 work; do not remove
the incomplete-result warning or treat an empty result as proof of no appends.

#1018's package filtering and bounded position/snippet retrieval remain separate
research. Correcting request headers alone would not fix the callers' assumptions.
Roadmap checked: no existing item changed by this bug fix.

The `isResult !== false` append-candidate filter is based on the observed append rows, not a universal SAP contract. Other genuine consumers can be expandable `isResult=false` nodes; a future append with that shape would require revisiting this filter.
