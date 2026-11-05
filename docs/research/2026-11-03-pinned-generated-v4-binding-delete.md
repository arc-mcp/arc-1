# Private generated V4 binding parent deletion

This offline candidate implements the bounded source-backed alternative from ADR-0011 and the
accepted broader pinned-write plan. It is not public capability admission, a native execution
protocol, PP qualification or whole-PR approval. The ordinary generated-binding deletion refusal
remains unchanged. No public input, toggle or schema enables the alternative.

## Native scope and provenance

The private source assessment and wildcard addendum bind captured A4H SAP_BASIS 758 active
standard sources. Their proprietary source packets remain private. The decisive chain is
`CL_SRVB_OBJECT_PERSIST` / `CL_ADT_SRVB_DELETABLE` → `CL_ODATAV4_BINDING_TYPE_IMPL` →
`CL_RAP_SERVICE_BINDING_V4` → the native authorization/registry/group deletion delegates.
Both parent deletion entry points supply the parent name as the implementation instance key;
the V4 delegate uses that key for the generated group. This is not an ABAP implementation class.

The profile therefore requires native `implementation` to equal the exact selected parent,
active SRVB metadata, explicit native `bindingCreated=true` and `published=false` flags, ODATA/V4,
known category and one native service/version/reference. The captured `bindingCreated` getter
confirms active binding-owned details, not physical generated-group persistence or frontend state. Different implementation mappings, V2, other releases,
coexisting inactive drafts, missing/ambiguous metadata and unqualified variants refuse. The
private caller must bind the source coverage from independent target evidence; a configured
release string is not itself native evidence, and runtime projection does not inherit a global
release override.

The fresh native metadata hash covers opaque state as well as known fields and is revalidated
before and under the owning parent lock. All metadata remains unchanged. There is no child
DELETE or SRVD DELETE, no guess at a generated-object package/absence endpoint, and no use of
ADT related-object lists as a generated-child inventory or ownership proof.

## Admission and lifecycle

`executePrivatePinnedGeneratedBindingDelete` takes the existing registered pinned mutation
context and verified HTTP `AuthInfo`, never caller-supplied claims in tool arguments. It requires
raw write scope, functional read/write scopes, verified exact write-target grant, read-target
grant, the exact selected client/target, standard strict PP and per-user request context. Global
and destination write gates and deny actions apply. Basic, aggregate, read-only and Copilot
routes gain no admission. The private function neither verifies JWTs nor manufactures a
mapped-user client; those remain responsibilities of the existing trusted HTTP boundary.

Both effective package policies and both effective request policies must explicitly contain
`*`. Empty, narrower, malformed and deny-all policies refuse before native requests. This
eliminates the otherwise unresolved generated-group package-membership read gap without
asserting a package identity. It does not authorize another target, arbitrary URL or child.

The existing `deletePinnedOwner` engine still performs fresh native parent CTS checks before and
under lock, including ordinary local/request/task membership and native lock validation. The
optional `transport` selects the parent request through those existing checks; it does not
invent a generated-child selector or recording receipt. Source recording remains independent
of transport-management scope. An unrestricted downstream request policy does not bypass the
parent recording contract.

The entry limits the shared mutation to three minutes, 64 HTTP attempts and 2 MiB across all
responses. The actual direct/Connectivity send boundary revalidates current authority after
queue/authentication waits and after any synchronous parent proof. The shared HTTP effective
deadline/cancellation check still follows that proof. Actual DELETE dispatch is counted at
transport handoff, not from an early observer intent. No retry is added. The separate bounded
owning-session UNLOCK/close survives expiry or authority narrowing.

## Result meaning

Only the shared typed native parent-not-found contract confirms `parentState=deleted`; a generic
404 remains unknown. A confirmed parent is reported as `state=accepted-unverified`, with
`generatedCleanup=accepted-unverified` and `recording=native-governed-unverified`. `ok=true` means
the bounded parent deletion/owning cleanup succeeded; it does not claim generated persistence
or CTS completion. Failed cleanup retains the confirmed parent fact and returns `ok=false`.
A submitted rejected/uncertain DELETE keeps generated cleanup unknown; an acknowledged DELETE
with unavailable parent readback keeps parent deletion unconfirmed. `submitted=0` is an
independent dispatch fact even if the shared engine conservatively reports deletion unconfirmed.

Standard native deletion governs its own group association, usage, authority and CTS checks.
It is not universal proof of all frontend aliases, an unbound/branch-dependent cloud BAdI,
foreign service relationships, physical G4BA/SUSH absence or transport tombstone removal.
Native refusal may follow partial effects, including CTS changes. There is no automatic CTS
compensation, forced lock removal or deletion of a referenced service definition.

## Validation and remaining work

The tests use real shared handlers/AdtHttpClient with direct and Connectivity MockAgent routes
and external connections disabled. They exercise both-policy intersections, verified grants,
raw/functional scopes, metadata drift before and under lock, queue/authentication waits,
synchronous final proof changes, cancellation/deadlines, native refusal/unknown outcomes,
owning cleanup, no replay, budgets, minimal diagnostics and unchanged ordinary/public refusal.
No native request, environment-file read, credentials, browser or installation is involved.
The final new suite has 117 passing cases; 13 affected/shared suites passed 844 cases before the
last twelve test-only additions. All three TypeScript projects, build, Biome, policy/file/schema
budgets and strict documentation passed. Exact commands and retained initial failures are in
the private author report.

Independent immutable review, actual source-bound native parent/generated cleanup qualification,
current-code successful second-writer PP and separate public integration remain open. This
candidate does not claim native or PP evidence and does not remove any wider FEAT-93 acceptance
gate. Restricted package/request policies still need an independently established native
membership/recording contract before this alternative could support them.

Source assessment SHA-256: `e70cd4b1881160b8f4f60e7ff2b566af2fab6bb0d4761907887562637b2a9441`.
Wildcard addendum SHA-256: `d8d863e3003ceb435926ee0d612836f84fff8be789784c4dc8c7e4484bbb706f`.
The private author provenance JSON binds the original source ledger and verifies its captured
ABAP payload hashes; no proprietary SAP source is committed here.
