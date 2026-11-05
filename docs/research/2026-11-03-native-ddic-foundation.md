# Fixed private DOMA / DTEL native qualification candidate

This is an offline-authored candidate for exact-source review, not a native execution approval or
qualification result. The public pinned DDIC context and activation routes remain closed. The
separate current-code two-writer PP CLAS workflow does not qualify these DDIC native contracts;
this slice uses the configured MARIAN identity on A4H/001 with `$TMP` only. No secondary-user
permission change is required or proposed.

## Fixed scope and production path

`native-ddic-foundation.ts` has the fixed protocol/root `pr1142-native-ddic-foundation-v1`. Pure
preparation creates one random 16-hex suffix and a durable intent for exactly two owners:
`ZARC1_DM_<suffix>` (DOMA) and `ZARC1_DE_<suffix>` (DTEL). The latter references the former.
No existing owner, caller-selected package, recording request, source body or alternate root can
be supplied. The endpoint spellings and XML contract use the existing DOMA/DTEL readers/builders;
standard readable captures provide representation evidence, not create/activation qualification.

The runner constructs the real `AdtClient` with the same fixed private safety policy consumed by
`createPinnedDdicContext`, `executePinnedSourceWrite` and
`preparePrivatePinnedBatchActivation`. It exercises:

1. Create a CHAR(4) domain with two fixed values, lowercase enabled and sign disabled; verify saved
   non-active metadata (`inactive` or `new`), activate, then verify default/active/inactive views all identify the active owner.
2. Refuse an intentionally stale metadata hash without a PUT, then update only the description.
   Verify the inactive result and preservation of every unselected field, then reactivate.
3. Create the dependent data element using the production mandatory post-create PUT. Its labels,
   domain reference, `deactivateInputHistory=true` and `changeDocument=false` must survive native
   readback. Activate; refuse another stale hash; update only the short label; verify partial merge
   including the negative input-history flag and reactivate.
4. Delete DTEL before DOMA using the production owner deletion path. Before each DELETE, re-read
   exact identity/package/creator/state and the complete canonical metadata in the owning session; before
   DOMA deletion also require independent typed DTEL absence. Confirm both typed absences and a
   valid fixture-specific inactive inventory after the final operation.

The successful create/save and activation checks use semantic metadata hashes and complete
namespace-qualified canonical metadata. Raw metadata bytes and their digests are retained separately
for audit; attribute order or XML formatting alone does not define a different owner receipt. Native generated attributes may change during activation only within the
production adapter's permitted projection. No alternate-state link is followed: its owner and
version spelling must be one of the exact bounded same-owner forms, without duplicates or a
remaining inactive counterpart after activation.

## Phase and evidence controls

Each command takes the reviewed full source SHA. Only check/execute take the generated preflight
sample ID; the source, root, identity, graph and endpoints are not caller selectable.

- `--prepare-reviewed-ddic-foundation-v1 FULL_SHA`: local preparation; no client/credentials.
- `--preflight-reviewed-ddic-foundation-v1 FULL_SHA`: three bounded GETs only: two native typed
  absences and a valid inactive inventory without the suffix. Each sample has durable receipts.
- After preparation and the selected preflight, the operator captures fresh genuine SM12 suffix
  and MARIAN searches, both zero. Save unmodified JPEG bytes as `sm12-suffix.jpg` and `sm12-user.jpg`
  plus the source/intent/sample-bound `sm12-baseline.json` under that sample. Image signatures,
  private modes, exact receipt fields, byte hashes and freshness are checked; operator/reviewer
  inspection of the actual displayed filters and results remains necessary.
- `--check-reviewed-ddic-foundation-v1 FULL_SHA SAMPLE_ID`: a read-only offline prerequisite check.
  It creates no directory or claim and never imports the native runtime or reads credentials.
- `--execute-reviewed-ddic-foundation-v1 FULL_SHA SAMPLE_ID`: permanently claims the sole attempt
  before reading execution prerequisites or credentials. It independently rechecks everything,
  even after a successful check. No reset, replay or automatic cleanup on failure exists.

Use Node 22.21.1 with only `--import tsx`, the reviewed clean checkout and its existing dependencies.
The existing source/runtime gate rejects environment/module/Git overrides. A reviewed invocation
can use a minimal environment (`env -i HOME="$HOME" PATH="<node-bin>:/opt/homebrew/bin:/usr/bin:/bin"`)
before the exact Node command; this document does not authorize running it.

The original absolute prerequisite freshness deadline is preserved through the complete lifecycle,
with an additional four-minute execution cap, 256 aggregate request attempts and 2 MiB aggregate
response bytes. Per-send bounds and final attempt validation cover direct and Connectivity paths,
queue/CSRF/token waits and the synchronous proof work. Source/intent/receipt hashes, policy, stop
and effective deadline are rechecked before dispatch and after the final await. Owning UNLOCK and
session closure retain separate bounded cleanup after stop/expiry; they do not permit a new owner
operation. Intent and actual dispatch are recorded separately, and uncertain mutations remain
uncertain. A known successful deletion is retained even if a later immutable-binding check fails.
That history does not certify later state: any subsequent present or unreadable owner absence
proof puts that owner in current `remaining` and `inspectionRequired`. An unavailable final suffix
inventory leaves both owners uncertain. A failed dependent absence proof still stops before the
parent DELETE; these diagnostics add no retry, mutation or automatic cleanup.

The journal omits lock-handle response bodies and inactive inventory bodies while retaining status,
byte count and digest. Session closure is supported by the production cleanup predicate, not a
claimed retained raw response. The operator must capture fresh post-run SM12 controls and obtain
an independent execution audit before considering native cleanup qualified.

## Validation and remaining work

Offline tests use the actual entry, factory, client, private mutation contexts and HTTP dispatch,
with `.invalid` mock origins and an explicit socket guard. They cover partial/unknown outcomes,
negative flag preservation, stale refusal, metadata/namespace/identity drift, dependency order,
terminal binding failure, raw-JPEG prerequisites, replay refusal, and queued/token-delayed final
send checks. They cannot prove native SAP semantics or PP behavior.

Independent exact-source review and all real phases remain pending. TTYP, table/structure/settings/
index, other DDIC variants, AFF/DDL/immediate-active, ENHO/SKTD workflows, recording and current-code
public DDIC/PP acceptance remain separate gaps in the accepted P2-D/P2-H plan. This two-owner slice
does not waive or fabricate any of them. Historical failed attempts and consumed recovery roots
remain unchanged and are not reused.
