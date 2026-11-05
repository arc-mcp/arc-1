# Pinned public admission wiring candidate

This offline implementation is based on `afce2539960a5679851ec9c6e6176cb027be9aad`.
It prepares the public wiring for the [accepted PR 2 plan](../plans/2026-10-26-broader-pinned-pp-writes.md).
It is not native evidence, PP qualification, deployment authorization or a whole-PR release verdict.
Independent source review and the remaining current-build native/PP acceptance gates must finish
before integration for release. Existing published support claims remain unchanged until then.

## Routing and authority

The explicit server capability matrix selects reviewed action/type/input combinations. Public
dispatch reuses the existing private handlers, context factories and native cores; it adds no second
save, activation, CTS or publication engine. Raw verified write scope, functional scope, exact verified
read/write target grants, selected client, standard strict PP and per-user runtime remain mandatory.
Destination read-only, aggregate, shared Basic and Copilot paths cannot acquire mutation rights.
Source recording and CTS management remain separate: only management needs the transports scope and
server transport-write switch. Both applicable server/destination package/request policies remain independent.

Metadata hashes are accepted only for admitted pinned native operations. A supplied malformed, blank
or null guard cannot disappear during normalization. Per-type raw field checks run before legacy
normalization; recursive checks refuse nested fields discarded by Zod. Native CTS input validation is
shared with admission, so its native `target` never becomes a pinned route selector. API release uses
exact type/name/group and the current native contract state. Ordinary single-target callers retain
their original metadata/owner-input contract.

The additional dispatcher selects source/declarative/function/DDIC/SDO, ENHO/SKTD, SRVB CRUD,
whole-owner activation, bounded batches, RAP, package/API-state, CTS, quickfix, trace, formatter and
classic FLP profiles. The ordinary editable-read companions retain normal read/package behavior.
Writer-only formatter, FLP, CTS-routing and feature/probe/cache companions retain read scope.
Catalog annotations and action descriptions are recomputed after functional scope and deny pruning.
Pinned-only wording removes duplicated field guidance; the 50,000-byte wire wall and token budgets remain
unchanged. The description-count allowance grows from 195 to 245 for the added operation/metadata fields.

The common context has one deadline, no replay, an all-response budget and a send-count budget;
profiles may tighten these bounds. Document writes use the existing 64-attempt ceiling. Root-local
creation and publication use their existing 4 MiB ceiling. Local package deletion, root creation,
FLP and publication cannot use a configured release override as selected native platform evidence.
FLP/publication public selection requires explicit unrestricted `*` on both effective request policies.
Their distinct explicitly selected/non-recording internal profiles are preserved. A native-governed
result does not establish a CTS receipt, universal frontend/alias state or a recording-free operation.
Generic OData 404 and application 604 remain unknown. No automatic compensation is added.

## Explicit implementation and qualification gaps

- Generated/published SRVB deletion retains its existing refusal. A separately reviewed generated-owner
  cleanup policy/read contract is still required; publication wiring does not authorize child cleanup.
- The existing batch-create adapter excludes FUGR, grouped INCL, ENHO/SKTD and server-driven creation.
  Existing group/document batch activation combinations also remain refused. These require bounded
  additions to the existing batch preparation hooks, not a legacy fallback. Current caps are 10 inputs,
  20 owners and 100 raw references, pending measured native/PP qualification.
- Recorded package deletion, narrower-policy ambient FLP/publication recording selection, publication
  V2/cloud/draft variants, unsupported enhancement/parent contracts and unqualified RAP parser/native
  forms remain named limitations. ST05 all-users selection is not admitted.
- Current-build native lifecycles, restored settings/traces/FLP state, transport effects, cleanup and
  two-writer PP evidence are still required across the accepted operation groups. Earlier independent
  private reviews and mock successes are not that evidence. Git, custom extensions, arbitrary ABAP
  execution, RFC and temporary helpers remain excluded.

## Offline verification and retained failures

Real AdtHttpClient mocks exercise public source and metadata updates, stale guards, ENHO/SKTD aliases,
quickfix delta-only behavior, SRVB cleanup refusal and CTS management using the real destination/role
builder. Authorization and catalog tests cover invalid grants/raw scopes, wrong clients, native evidence
absence, independent request policies, scope/deny pruning and unsupported combinations. Existing public
lifecycle fixtures now supply explicit synthetic verified middleware output rather than omitting it.

Initial failures exposed discarded FUNC-only fields after type normalization, harmless undefined keys
breaking quickfix parsing, profile budget ceilings, and the distinction between a failed release response
and successful independent terminal evidence. Those failures are retained in the private author log;
obsolete private-closure expectations were updated while retaining unauthenticated/public-denial tests.
The first clean full suite also exposed historical closure assertions and conditional schema-key/inventory
expectations; those are retained and updated with explicit pinned/non-pinned parity tests and a complete
capability snapshot. A copied-entry test needs a real archive node_modules directory with individual
dependency links: linking the entire directory changes its lexical entry path and skips its CLI guard.
No native phase, network request, credential/environment-file access or deployment was performed by
this author task. Final checks, exact commit and remaining release gates are recorded in its author report.
