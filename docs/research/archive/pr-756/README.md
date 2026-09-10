# Repository graph experiment: decision and retained research

**Decision, 2026-09-10:** retire [PR #756](https://github.com/arc-mcp/arc-1/pull/756)
without merging its implementation. Continue with live navigation from
[PR #769](https://github.com/arc-mcp/arc-1/pull/769), merged as `81baa517`.
The persistent graph remains an unshipped experiment; its `SAPGraph` settings and proposed
ADR-0008 are not current ARC capabilities or accepted policy.

The [findings](findings.md) retain useful results, counterexamples, measurements and remaining
gates. The [source index](sources.md) accounts for every reviewed document and links the full
records and raw evidence through immutable commits. A tagged snapshot also preserves the two
recovered local notes and documentation diff. Duplicate setup guides, superseded plans and
intermediate receipts are kept in history rather than the maintained tree.

## Why this direction?

| Need | Chosen live approach | Persistent graph's remaining value/cost |
|---|---|---|
| Explain selected objects and explore dependencies | Native relations, references and selected source/context reads | An index adds collection and freshness management |
| Repeated package-wide analytics | Bounded neighborhoods, without an aggregate coupling ranking | Indexed directional coupling and paths avoid SAP during queries |
| Authorization | Existing caller SAP identity | Separately approved shared metadata audience; collector visibility is not caller authorization |
| Operation | Existing ARC deployment | Database, API, collector, credentials, refresh and recovery ownership |

The graph pilot exposed stale dependency-context caching, which #769 fixed while retaining
source/ETag caching and PP isolation. Native relations also recovered an implementation-include
edge that the graph collector missed. Neither approach proves complete impact or runtime use.
The persistent graph's strongest distinct use case is repeated aggregate analysis; the pilot
alone did not establish enough benefit to justify its ongoing operation.

## Next work

1. Qualify native relations under real BTP PP/Cloud Connector, restricted identities and another
   SAP release. Preserve missing-edge cases and ordinary model-workflow failures in evaluation.
2. Address deeper SAPContext total-work limits or parser improvements separately when needed.
   The relation action's budgets do not globally bound legacy context expansion.
3. Revisit a database only for a measured recurring aggregate workload, with include-aware
   extraction, honest dynamic/partial coverage, durable refresh/deletion, approved access and
   rehearsed recovery. Semantic retrieval additionally needs a defined relevance benchmark and
   agreed source/embedding retention. See the [current research direction](../../repository-retrieval-consolidated.md).

## Infrastructure is a separate retirement task

On 2026-09-10, a read-only Docker inventory found two comparison containers and three PG/API
projects still running. CF inventory failed because its login token had expired or been revoked;
current BTP resources were not verified. Historical names and free-plan dates are inventory
leads, not a deletion list. Closing the PR does not stop apps or back up their data.

A separately authorized teardown should identify owners/bindings, preserve needed datasets and
verify recovery, then retire only confirmed experiment resources and credentials. Keep unrelated
ARC services, original worktrees and private reproduction folders. The older source-index
prototype is separate. No infrastructure, SAP or credential change accompanies this documentation.
