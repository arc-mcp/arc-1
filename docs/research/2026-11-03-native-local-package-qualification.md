# Fixed native LOCAL package qualification

Status: the independently reviewed attempt at `fc14a7465cf10eed29b5e0291f33b3310e8a5ac0`
ran once and stopped at its first negative DELETE. The [audited partial result](2026-11-03-native-local-package-failure.md)
created and verified the root, child and class. Its HTTP 400 body was digest-only, so the reason and
non-cascade behavior remain unqualified. All three owners were subsequently removed by the
[separate audited cleanup](2026-11-03-native-local-package-recovery-audit-verbatim.md) at `71e1af3c82603dfe6d7ab58bc834d615aef1d1d3`.
Both claims are permanently consumed. This grants no public, PP or whole-PR qualification.
The sections below describe the original intended experiment.

## Fixed scope and native evidence

`native-package.ts` owns the new fixed `pr1142-native-local-package-v1` state root. Its immutable intent
chooses one fresh 16-hex suffix and three owners only: `$ARC1_PK_R_<suffix>`,
`$ARC1_PK_C_<suffix>`, and `ZCL_ARC1_PK_<suffix>`. The root is an explicitly parentless LOCAL development
package; the child names that actual root; the class belongs to the child. `$TMP` is neither a parent
nor an ancestry grant. Both package policies contain exactly the two future package names; both
request policies explicitly contain `*`, as required by the reviewed private LOCAL root profile.

This implements the experiment described in the private local-package lifecycle assessment
(SHA-256 `a7564de58b3715db7ded5bc078c2deb78c3944b4d9b29644d1177b9289612d7c`), using the existing
[LOCAL root profile](2026-11-03-pinned-local-root-create.md),
[empty-parent reader](2026-11-03-pinned-local-root-create.md#native-empty-parent-representation-correction), and
[LOCAL delete profile](2026-11-03-pinned-local-package-delete.md). No production writer, public schema,
capability matrix or request policy is widened.

Saved, target-bound active `CL_PAK_ADT_PERSIST` and `CL_PACKAGE` source supports parentless LOCAL
creation and native DELETE eligibility checks for directory objects, child packages and interfaces,
without cascading their deletion. `CL_PACKAGE` reports `object_not_empty` with PAK 051 and the
package name. The actual ADT wire encoding of this refusal has not been observed for this experiment.
The harness accepts only a native exception envelope with exact PAK/051/owner T100 fields, or the
exact source-documented English nonempty message without conflicting structured fields. An arbitrary
400/500, authorization refusal, HTML error, timeout or different diagnostic is unclassified and stops
the run. The language is explicitly EN. This expected discriminator is not mocked native proof.

Source bindings: `CL_PAK_ADT_PERSIST` SHA-256
`d1d0642e184eff2c365f7d621b8bb7a5d29472022be22ffd84c94202330c7acf`; `CL_PACKAGE`
`cb1ab0d07cb20d148a7187c6bd0ed625bb81fe27072501a1b20650831e8d66c1`; captured `$TMP` metadata
`48ebdcbb310c677f5942f148aa2c7b06a8e49479666f3081c54b41c479f3c984`.
The latter demonstrates a present empty native `superPackage` and lowercase encoded child-package
URIs. Tests reuse its already sanitized repository fixture. Private raw SAP implementation source and
unrelated package/draft inventories are not copied into this repository.

## Declared sequence and evidence

1. Create the root with the private root profile and verify actual parentlessness, identity,
   description, creator MARIAN, responsibility, LOCAL/development, disabled recording and empty layer.
2. Create the child through the real parent path, using native local recording checks; verify its
   exact parent and all the same native package properties.
3. Create/save the fixed minimal class through the shared private source writer, then activate the
   whole declared class through its existing activation coordinator. Verify the exact source and
   native active state, including exposed owned include states and the explicit active source.
4. Attempt one root DELETE with the child present, then one child DELETE with its class present.
   These two fixed harness profiles skip only the optional positive browser shortcut and retain the
   shared recording, owning-session lock, DELETE, typed absence and cleanup machinery. Each negative
   stage needs the specific native nonempty refusal, successful own cleanup, and independent matching
   metadata/source receipts proving all three owners survived before proceeding.
5. Delete class, child and root in that order. Empty package cleanup uses the ordinary private
   package delete profile, including its browser shortcut. Each success needs owning cleanup and an
   independent native typed absence. Finally read all three exact owners and a valid inactive
   inventory without the suffix again.

The class DELETE has an additional fixed receipt precondition through the shared owner profile.
No reference creates ownership. Package membership is proven by the child's own exact parent; an
absent or empty `subPackages` view is not complete inventory or emptiness evidence. Positive foreign
references stop. Only the declared child create/delete transitions may refresh the subpackage view;
all other metadata, including opaque slots, remains compared. The only URI spelling equivalence for
that view is the exact owned uppercase request path and its source-observed lowercase native form.

The negative and cleanup DELETEs are separately declared stages after a verified native state
change. They are not retries of an ambiguous DELETE. There is no automatic rollback on failure and
no later stage runs after uncertain creation, source/metadata drift, unclassified refusal, failed own
cleanup or cancellation. Earlier confirmed successes remain in the result. `confirmedDeleted`
requires the additional typed read; `adapterReportedDeleted` retains a shared adapter's reported
result even if later qualification fails. Remaining/inspection owners stay explicit.

Root recording remains **native-governed-unverified**, even after matching LOCAL readback. Native CTS
bookkeeping may occur before a refusal; the protocol promises neither zero recording effects nor a
universal cross-writer freeze. It supplies no fabricated non-recording receipt for a nonexistent root.

## Fixed phases and execution controls

The only accepted flags are `--prepare-reviewed-local-package-v1`,
`--preflight-reviewed-local-package-v1`, `--check-reviewed-local-package-v1`, and
`--execute-reviewed-local-package-v1`, each with the reviewed full 40-character revision. Check and
execute also require the exact 16-character preflight ID. No caller-selected root, owner, package,
source, operation or protocol is accepted. The entry binds its real checkout, clean tracked source,
package-lock hash and Node v22.21.1; installed dependency bytes are explicitly not attested.

Preparation writes only the local intent. Preflight is separately bounded to GET-only native reads
of the three future owners and the inactive inventory; no existence is inferred from indexed search.
Then an operator must capture fresh actual SM12 zero-lock searches for client 001, suffix across all
users and all MARIAN locks, after preflight. Save the unchanged JPEG bytes as `sm12-suffix.jpg` and
`sm12-user.jpg`, alongside the exact receipt in `preflight/<id>/sm12-baseline.json`. No image conversion
or extension relabeling is allowed. The bounded JPEG validator verifies signatures and hashes, not
what the pixels show; human/independent image inspection is still required.

The offline check rereads source, intent, preflight and receipt/image bytes, identity, ordering and
five-minute freshness, without credentials, native imports, writes or an attempt claim. It is not an
execution grant. Execute independently repeats these checks after permanently claiming `attempt`;
a prerequisite/configuration failure consumes that claim too. Preflight cannot overlap or follow a
claimed execution. Historical declarative, recovery and other protocol roots are untouched.

All stage requests retain the original absolute prerequisite expiry, a four-minute run ceiling,
a 30-second per-request cap, no replay, a cumulative 256-send allowance and a shared all-response
2 MiB budget. The existing final request-attempt boundary repeats source/receipt/policy/stop checks
after queue/auth/CSRF awaits and original synchronous proof work, then checks the effective deadline.
It does not depend on mutation-intent observation to stop freshness checks. An individual stage
cannot repeat a mutating request, including a manual content-type fallback. Owning UNLOCK and session
close retain their separately bounded cleanup capacity after cancellation, proof failure or expiry.

Raw owned metadata/source and semantic outcomes are retained. Unrelated inactive inventory and
lock-related response bodies stay hash-only; no headers, cookies, password or lock handle is recorded.
Adapter errors retain outcome fields plus size/digest rather than free text that could echo a handle.
A terminal proof/completion failure cannot erase confirmed deletion facts or become success. Session
closure is reported through the existing shared cleanup predicate; it is not a retained raw close
response.

## Remaining qualification

After any real attempt, independently capture fresh suffix/all-MARIAN SM12 post-controls as unchanged
JPEGs and audit the journal/result before declaring native cleanup qualified. The driver’s own-session
cleanup predicate and typed object absence do not substitute for those observations.

The actual attempt observed native name creation, package metadata/readback, seven local CTS
checks and class activation. Root creation retains its native-governed recording uncertainty.
PAK051 wire encoding, both native noncascade refusals and final graph cleanup remain unqualified. A
successful local Basic experiment does not prove recorded packages, transports, PP identity
separation, public admission or the broader accepted P2-E matrix. Any stopped attempt requires
bounded inspection and separately reviewed recovery; never delete, edit, reset or replay its claim.
