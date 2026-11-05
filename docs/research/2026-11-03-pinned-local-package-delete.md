# Private local package deletion using the native non-cascade contract

This independently reviewed private implementation replaces the unconditional private package-delete refusal with a narrowly
selected local profile. It reuses `deletePinnedOwner` and `withLockedMutation`; public capability
admission remains closed. No native execution, new native fixture, PP test or deployment was
performed. The user-authorized Codex fallback was used after Claude reached its session limit.

## Source contract and limits

The private active-source assessments connect the observed DEVC/K registration and package
collection discovery to the generic workbench REST/plugin handler, package persistence and the
ordinary package DELETE/SAVE implementation. The captured target reports SAP_BASIS 758, support
package 0002. Static source evidence from that target does not qualify every 758 system, another
release, cloud behavior, runtime caches, the mapped PP identity or a completed native lifecycle.

The evidence supports ordinary native deletion as the authoritative eligibility check:

- `CL_PAK_ADT_PERSIST` uses ordinary package DELETE followed by SAVE, without recursive delete.
- `CL_PACKAGE` checks actual TADIR contents, child packages and interfaces before marking the
  package deleted. Its database deletion removes the selected package's metadata/bookkeeping;
  it does not loop over and delete contained repository objects or child packages.
- The generic REST resource binds the supplied lock handle to the selected object/type and invokes
  native modify authorization. ARC-1 still requires its explicit owning-session lock, even though
  the native handler also supports a transient-lock path.
- Native local classification requires software component `LOCAL` and disabled recording.
  `$` name spelling alone is not evidence. The package's own local TADIR cleanup remains a real
  effect. The generic dark CTS insertion path still runs for DEVC; local does not mean no bookkeeping.

The generic handler inserts correction data before package persistence. It requests deferred CTS
commit and contains rollback attempts, but these are not proof of universal rollback. The second
SAVE-time recording path matters for recorded packages. Recorded deletion remains closed pending
qualification that both passes retain the prevalidated allowed task/request or refuse. No universal
emptiness service, special memory bridge or cross-writer freeze is required or invented.

Private evidence provenance, retained unchanged outside the repository:

| Assessment / verification inventory | SHA-256 |
| --- | --- |
| `package-active-source-assessment.md` | `bb1958795eddbf7de187a750b8575d888a8400a717a04d1f50044a32af34361b` |
| `package-active-source-assessment-addendum.md` | `c73569dc57685cf65ce81fa1ee25add18b6bf86c3d0cd6f1187dad8e282361b2` |
| `package-active-source-hash-verification-2026-11-03.json` | `1229aa6ea70d759af70064ea7dfe721481b60f14a646d2837b35b3aeb28d1b78` |

The inventory binds 37 file-bearing observations in nine packets, including handler/CTS dependencies
and some unrelated source. Raw proprietary SAP source is not copied into this repository. The
initial assessment's open handler/discovery questions are superseded only as described in its
addendum; no native mutation evidence is implied by those GET captures.

## Private profile

`deletePinnedPackage` requires a registered matching pinned context and an internal environment
selection of on-premise release `758`. That parameter follows the existing private package-create
pattern: it is a candidate coverage selector, not a feature probe, response-attested system identity
or native qualification grant. It is not a public argument. A future separately reviewed native
harness must bind it to actual target/release observations.

The profile rejects `$TMP`, unsafe names, unsupported inputs and every explicit transport value.
Fresh namespace-aware metadata must identify the exact DEVC/K package and show development kind,
`LOCAL`, `recordChanges="false"` and no transport layer. Both package policies apply to the actual
package. These checks repeat under the owning lock. A local package need not have a `$` name.

The existing browser may refuse known contained content. Empty or incomplete browsing is never
promoted into completeness or absence proof; only its specific no-evidence condition is tolerated.
Authorization, malformed-response and transport errors still propagate. Native DELETE supplies
the final nonempty/non-cascade check. The ordinary recording helper executes before and under the
lock; the shared profile validator requires both results to be local without any request. The
native lock must independently affirm that local context and contain no correction request.

Every request retains the same cancellation/deadline and no-replay context. This candidate requires
an outer all-response allowance no larger than 8 MiB; it does not reset that allowance for nested
metadata, browser or transport checks. Native package metadata remains capped at 1 MiB before
parsing. Cleanup keeps the existing independent bounded allowance and owning SAP session.

## Outcomes and checks

Exactly one DELETE may be submitted, without `corrNr`. Successful status alone does not confirm
deletion: the shared typed owner-absence GET is required. Generic/HTML 404 remains unconfirmed.
`contentEvidence: native-delete-contract`, returned only after possible submission, names the
selected eligibility contract; it does not claim that a refused request reached the content check.
Known rejection statuses remain `delete-rejected`; timeout, cancellation after submission and
uncertain failures remain `delete-unconfirmed`. `unchanged` means no DELETE was sent, not a promise
that lock acquisition or all native checks had no effects. No automatic retry or compensating CTS
cleanup is performed. Results explicitly retain the unresolved bookkeeping effects.

Own-session UNLOCK and close run even after cancellation or policy drift. A successful deletion
with failed cleanup remains `deleted` with `ok: false` and cleanup evidence. Typed absent UNLOCK
is resolved only through confirmed close of that same owning session. Handles, cookies and native
error diagnostics are not exposed in the returned result.

Offline tests use the real HTTP client with mock fetch, existing inline package/lock shapes and
explicit synthetic state transitions. They cover positive deletion, empty/incomplete browser
results, known contents and late child appearance, native metadata drift/ambiguity, both package
policies, a fully valid recorded CTS result that must still refuse, protected/input/environment
limits, deadlines/cancellation/budgets, no replay on CSRF/native/network failures, typed absence,
cleanup failures, secret-safe outcomes and ordinary single-target regression coverage. No new
native wire fixture was added. Failed initial checks are retained in the private author report.

Before public admission: separately reviewed native empty-leaf success,
contained-object refusal and child-package refusal on strictly owned disposable packages; actual
owning-session/SM12 cleanup and native recording/bookkeeping evidence; current-source PP and the
full grant/deny/read-only/Basic/aggregate truth table. Recorded variants need separate selected-task
qualification. This candidate does not authorize execution of those experiments.

Roadmap impact: FEAT-93 now tracks local native lifecycle qualification, recorded selection/CTS
qualification and public admission, replacing the broader claim that no native non-cascade
contract is known.

## Independent review and integration

The [independent review](2026-11-03-pinned-local-package-delete-review1-verbatim.md) approved private
integration of `881bbad2c023368d4865f6f57d29f32b1395f0d3` after 215 affected tests and 18 additional
real-client/mock-fetch probes. It also rehashed the native source evidence and parsed the actual
read-only `$TMP` metadata capture through the scoped reader. That establishes representation only;
`$TMP` remains protected and no native deletion was attempted.

All four source/test files match the candidate byte for byte at integrated `6a229e8cd`. The
[combined checkpoint](2026-11-03-pinned-integration-checkpoint.md) passed its full offline gates.
Native empty-leaf/content/child cases, recording effects, PP and public admission remain unqualified.
