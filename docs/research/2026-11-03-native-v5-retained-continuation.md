# Retained V5 service correction and qualification

Status: prepared offline for independent exact-source review. No continuation phase or native
request has run. This is a fixed Basic-native experiment, not PP/public admission or merge approval.

## Actual V5 outcome

The once-only V5 run at `59eab1d09c331e605593284700bc180423aa74fe` completed five
create→activate→update→activate lifecycles, including the corrected abstract BDEF. Its service
was created and saved inactive, then native activation refused the fixture's leading comment
at source line 1 and returned EU202 cancellation. V5 remains failed and consumed. Four owners
were deleted; the service and its active view dependency remain for this separately reviewed plan.

This is a fixture correction. The shared fixture factory prepended a comment to every type;
the production writer preserved that source and the activation adapter correctly reported failure.
No production comment stripping or weaker activation check is warranted. Every historical builder,
source graph, proof and claim is preserved.

Private read-only inspection confirmed these exact owners in `$TMP`, created/changed/responsible
MARIAN on A4H/001:

| Owner | Actual retained state | Source SHA256 |
|---|---|---|
| `ZARC1_V5S_3481C958A6CA5AC1` (SRVD) | Inactive, original 193-byte source | `fb29a9b67fceb26e82ce701b003c860f82075d09d0ddf21e03875439c386ef6a` |
| `ZARC1_V5V_3481C958A6CA5AC1` (DDLS) | Active, completed updated source | `20800608b7cb47ae19e944191bf5c3ba906cf8cab478c4a18535549535c67398` |

Default, active and inactive query forms returned the same source for each owner. The SRVD
metadata still said **inactive** even on an active query: HTTP200 is not activation evidence.
The four deleted peers and default BDEF implementation-class reference returned native typed404.
The owned inactive inventory entry was the service only. Unrelated inventory is kept private.

The fixed history verifier binds all 980 original files (956 journal rows), the failed result,
18 fresh GET observations, collector and all post-controls, including the explicitly invalid
expired-session observation. It also revalidates the older V5 history chain. The failed result hash is
`36da5677a1a68a509941a0fc6c2ed613b78b036228f41be6d307273abbe6732b`.
Raw session-close responses are not retained; closure remains the shared cleanup predicate.
Old post-controls are historical evidence and cannot supply a new execution baseline.

## Bounded continuation

The new fixed root is `pr1142-native-declarative-v5-retained-v1`. It has one fresh claim and no
caller-selected root, owner, source, profile or operation. It creates no SAP object.

1. Recheck both exact initial raw metadata/source receipts, the five absence-only references,
   and owned inventory through bounded GET-only preflight. Fresh execution repeats the inspection.
2. Update the existing SRVD using its expected source hash, removing only its known leading
   comment. The fixed comment-free source is 153 bytes with SHA256
   `30a88a649a3a3761c61aa785327d0d8ff872f366959f1d5ab5d704ecb9db20fe`.
3. Activate only that service and verify actual native active state and exact active source.
4. Update its label to `ARC1 declarative v5 3481C958A6CA5AC1 revised`, then activate and verify
   again. This 161-byte source has SHA256
   `0c042b46e8d74d7ee0ab45a2b684f057aa369d9e4f5e5f174fafa8ebfd37d26c`.
5. Delete the service once; require owning-session cleanup and independent native absence.
   Only then delete the exact unchanged active view. Finally require all six original owners and
   the read-only reference absent, plus valid suffix-free inventory.

The view is a read-only dependency until its final deletion. The implementation-class reference
never grants ownership or deletion authority. The second label may legitimately appear in native
metadata description; only the exact original and explicitly intended new label are admitted at
that transition, then the observed full receipt is bound. Creator, type, package, source, semantic
version, counterpart links and source/metadata race checks remain strict.

The existing private source writer, activation preparation and reviewed cleanup loop perform
native operations. New orchestration supplies the fixed sequence and receipts. Unknown mutation,
activation or cleanup stops the sequence and preserves explicit remaining/inspection owners;
there is no automatic rollback, ambiguous request replay or new six-owner lifecycle.

## Phase and dispatch controls

Entry: `scripts/qualification/pr1142/native-v5-retained.ts`. Accepted flags are
`--prepare-reviewed-v5-retained`, `--preflight-reviewed-v5-retained`,
`--check-reviewed-v5-retained` and `--execute-reviewed-v5-retained`, each followed by the reviewed
full revision; check/execute also require the exact preflight sample ID. The existing clean source,
real checkout, package-lock and Node v22.21.1 binding is retained; installed dependency bytes are
not independently attested. All NODE_OPTIONS/GIT_* overrides remain refused by the runtime guard.

Prepare writes only the fixed local intent. Preflight uses GET only, at most 48 sends, 2 MiB
responses and 60 seconds. Then capture and independently inspect genuine zero-lock SM12 searches
for client001/table*, this suffix across all users, and all MARIAN locks. Save unchanged JPEG bytes
as `sm12-suffix.jpg` and `sm12-user.jpg` with the exact `sm12-baseline.json` schema in the fixed
sample directory. No image conversion or extension relabeling is permitted. Signature/hash
validation does not inspect the pixels or establish that the displayed filters are correct.

The offline check is read-only: no client/configuration/credential loading, writes, umask change
or attempt claim. It grants no execution authority. Execute permanently claims before independently
rereading every source/history/intent/preflight/image proof; failure also consumes the claim.

All stage requests retain the original earliest five-minute evidence expiry, a four-minute
execution ceiling, 30-second per-request cap, 256 main sends and cumulative 2 MiB response budget.
Original smaller caller allowances remain enforced. Final source/history/stop/freshness checks
occur after queue/CSRF/auth waits and synchronous parent proof work, with the core effective-deadline
check immediately before send. Request intent and actual handoff are recorded separately.
Fixed PUT/activation/DELETE stages cannot replay. Owning UNLOCK keeps its independent four-attempt,
64 KiB/30-second allowance per owning stage, and the shared session-close budget remains available
after stop or expiry. No handle/password/cookie is retained; opaque lock responses and unrelated
inventory are hash-only, and adapter diagnostic text is projected to semantic facts plus size/hash.

A final binding/completion failure preserves confirmed deletion/cleanup facts but cannot become
success. After any actual attempt, independently capture fresh raw-JPEG post-controls and audit
all outcomes before declaring native cleanup qualified. A stopped attempt requires separate
inspection/review; never reset, remove or replay any claim.

## Qualification limit

If successful, original creation evidence plus this continuation could establish a transparently
composed native lifecycle across two revisions and two claims. The original V5 failure must remain
visible. A clean SRVD create-and-activate in one uninterrupted run would still be unobserved.
Current-code two-writer PP, recorded variants, public admission and whole-PR readiness remain open.

## Independent selected-owner absence correction

The first independent review at `9b0f8073a86786973b756ff8bb311b72135e35d2` found that the shared cleanup loop could mark a newly deleted owner confirmed from a namespace-invalid404 before the stricter later check failed. Four direct/Connectivity probes reproduced the incorrect confirmation for both retained owners; positive and late-package-drift controls passed. The original negative verdict is retained privately with SHA256 `ba85a5e6504afa8cc2c37d1b01ce0549c8c5d6182edff7b14fd77917299b26d5`.

The correction supplies the fixed continuation's strict own-absence callback to the shared recovery loop before it sets `confirmedDeleted`. Historical callers keep their existing default; their native evidence and consumed attempts are unchanged. Native execution remains pending independent closure review and fresh prerequisites.

## Retained-v1 execution update

The reviewed v1 attempt stopped before mutation because its entry omitted the pinned mutation safety policy. Both owners remain. See the [independent execution audit and separate v2 correction](2026-11-03-native-v5-retained-entry-correction.md); the v1 claim and all prior review results remain historical and unchanged.

Execution status update: the separately reviewed [v2 entry correction and actual audit](2026-11-03-native-v5-retained-entry-correction.md#actual-v2-execution-and-independent-audit) completed all six retained-owner stages and removed both owners. The original design and failed v1 evidence above remain historical; no consumed claim is reusable.
