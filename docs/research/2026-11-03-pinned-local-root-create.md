# Private parentless LOCAL package creation

Status: offline candidate; native lifecycle, current-code two-writer PP and public admission remain open.

The earlier private package adapter required a parent for every CREATE and used `$TMP` in its positive
mock. Native source distinguishes a parentless LOCAL root from the `$TMP` tree display anchor. The
ordinary CREATE branch does not establish the setter's `$TMP` refusal as a CREATE restriction. This
candidate refuses `$TMP` as an asserted parent within its own bounded profile; it does not claim that
ordinary SAP CREATE rejects it. The legacy package builder and single-target behavior are unchanged.

The source assessment binds the active `CL_PACKAGE` and `CL_PAK_ADT_PERSIST` capture to the requested
on-premise 758 target/client. It establishes the ordinary root model, native LOCAL attributes and
separate real-parent flow. The private assessment is SHA-256
`b5161c8e83fe4873f0b78ef16b5b8bc8cfaa9baebdbaf37f2465ee036596a100`.
No proprietary SAP source or unrelated repository inventory is included here.

## Root admission and native recording

`executePrivatePinnedLocalRootCreate` is a private qualification entry. It adds no dispatcher branch,
public schema, configuration toggle or public capability row. It requires raw read/write scope, the
shared strict-PP pinned-write ceiling, an exact selected target/client and registered mutation context,
both deny-action lists and the actual invocation identity when one exists. The optional absent async
request context supports direct internal qualification; it is not evidence of a mapped PP identity.

Coverage is explicitly limited to configured on-premise 758, a dollar-prefixed local name other than
`$TMP`, an explicit native responsible user and an omitted parent. Cloud, other releases, transportable
roots and conflicting/unsupported inputs refuse. Both effective server and destination request
policies must explicitly contain `*`; missing, narrow, malformed, sparse or deny-all policies refuse.
The shared pure predicate is also used by the unchanged FLP profile.

Both package policies authorize the actual future name, as does the server configuration. Exact names,
name-prefix grants, the root's own subtree grant and `*` use existing package semantics. No hierarchy
lookup can manufacture ancestry for a nonexistent root: `$TMP/**` alone grants nothing to `$NEW`.
The generated payload forces component `LOCAL`, development kind, recording disabled, empty layer
and empty superpackage. Target absence must be a typed native not-found response.

There is no fabricated transport check against the nonexistent root or `$TMP`. As permitted by
ADR-0011's native-governed alternative, both unrestricted request policies constrain any native request
selection; SAP still governs authority and optional bookkeeping. The result reports
`recording: "native-governed-unverified"` with an explicit note. It never invents `local: true`, a selected
request/task or proof that no CTS/directory effects occurred. Successful package metadata is not a CTS
receipt. This is package-specific source coverage, not a transfer of FLP's customizing contract.

## Shared submission, proof and failure

The path reuses the package XML builder, `createObject`, mutation HTTP/context and budgets. It keeps
one outer deadline (at most one minute), inherited cancellation, an all-response allowance of at most
4 MiB, at most 16 request attempts, and any smaller inherited attempt allowance. Its internal profile
is bound to the original client, mutation context and exact name. The guarded attempt budget rechecks
target, identity, scope/ceiling, both request/package policies and coverage at the actual send boundary,
after semaphore/auth waits on both direct and Connectivity transports. Automatic replay/transient
retry remains disabled.

After an acknowledged POST, direct native readback must prove the exact DEVC identity, explicit empty
parent, responsible, description, LOCAL component, development kind, disabled recording and explicit
empty layer. The native parent reference may be `<pak:superPackage/>` or carry an explicit empty core
name. Only a present, uniquely namespace-bound empty element is normalized to an empty parent; missing,
foreign, duplicate or nonempty nameless parent evidence remains unverified. Other missing attributes,
including the transport layer name, are not evidence of empty values. Final policy revalidation follows the
last awaited read. A failed/different readback remains `created-unverified`; a submitted rejection or
uncertain transport remains `creation-unconfirmed`. Even a returned 4xx can have earlier CTS/directory
effects. No automatic retry, DELETE or rollback is attempted.

A real child still reads and authorizes its actual parent, uses that parent's native recording check
and verifies the resulting exact parent. Local children require affirmative LOCAL/non-recording/
empty-layer/development parent metadata. Recorded children retain their existing selected-request
verification. The private positive test now uses a real `$DEST` parent rather than `$TMP`.

## Qualification still required

Mock HTTP tests cover root/readback, policy intersections, real-parent recording, public closure,
legacy builder behavior, malformed/unsupported input, typed absence, ambiguous failures, inherited
budgets, cancellation and policy/expiry changes during actual queue/auth waits. These establish offline
behavior only. The configured release alone is not universal native-source proof.

A separately reviewed bounded native experiment should create a uniquely named root and real child,
verify the actual metadata/hierarchy and available recording evidence, exercise native non-cascade
refusals, and delete child before parent with verified cleanup/locks. It must retain uncertain outcomes
and avoid replay. This implementation supplies no native phase entry or execution approval. Native
Basic qualification, two-user strict-PP evidence and public admission are separate remaining gates.

Roadmap impact: FEAT-93 distinguishes this private root candidate from outstanding native local
lifecycle/CTS and PP/public qualification. No claim of completed package parity is made.

## Independent review

[Exact-source review](2026-11-03-pinned-local-root-create-review1-verbatim.md) approved private integration of `8628c1963a2203ed23cc6b2c13d5a250bfaf1101`: 475 affected tests and 18 additional actual-HTTP MockAgent probes passed, as did three TypeScript projects, lint, policy and sizes. All 4,747 snapshot files remained unchanged. Integration shares the already-identical request-policy predicate with publication and FLP; no second policy is introduced. Native root/child lifecycle, actual readback/recording effects, cleanup, PP and public admission remain unqualified.


## Native empty-parent representation correction

An existing A4H/001 metadata capture represents `$TMP`'s parent as `<pak:superPackage/>`, without a
name attribute. The original reader returned `undefined`, conservatively leaving the root CREATE
result `created-unverified`. The private reader now preserves the distinction between that exact
present empty reference (`''`) and a missing element (`undefined`). Named real parents retain their
exact value and real-child readback still requires the requested parent. Shared legacy package
builders, moves, delete policy, request gates and public admission are unchanged.

The capture is 10,213 bytes, SHA-256
`48ebdcbb310c677f5942f148aa2c7b06a8e49479666f3081c54b41c479f3c984`.
Active `CL_PAK_ADT_PERSIST` source SHA-256
`d1d0642e184eff2c365f7d621b8bb7a5d29472022be22ffd84c94202330c7acf`, lines 613–619,
only populates the parent reference when its native parent is noninitial, and catches a URI-mapping
exception without exposing it. The empty reference is therefore supported native representation,
not universal proof of the internal parent field or a CTS receipt. Root CREATE still requires its
fixed parentless payload and every other affirmative identity/local/readback check. Runtime package
lifecycle, exact-child relationships, recording and cleanup remain separately unqualified.

The sanitized XML regression preserves the captured empty reference and local fields, removes all
links/unrelated subpackage inventory, and rebinds name, description and responsible to synthetic test
values. It is not a captured newly created root. Actual private create/readback wrapper mocks cover
both direct and Connectivity paths, alternate namespace spellings, old explicit-empty attributes,
missing/foreign/duplicate/malformed content, and no replay or automatic compensation on failed
readback. Raw backend source and inventory remain private.


## Empty-parent reader review

The native empty-parent correction at `f1fd62d8` passed [independent private-integration review](2026-11-03-pinned-local-root-empty-parent-review-verbatim.md):
316 tests including 28 additional actual-HTTP direct/proxy probes, all three TypeScript projects,
lint, policy and size checks. All 4,771 snapshot files remained unchanged. A unique present empty
native parent element is accepted for fresh-root readback; missing, foreign or malformed evidence
stays unknown/refused. The native URI-mapping exception caveat remains: this is not a universal
proof of hidden `PARENTCL` or ancestry. Native local lifecycle, PP and public admission remain open.
