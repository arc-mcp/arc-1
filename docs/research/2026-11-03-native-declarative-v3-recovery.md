# Declarative v3 failure and completed one-owner recovery

Status: **the separately reviewed one-owner recovery completed successfully on 2026-11-03**.
Its intent and attempt are permanently consumed. The original v3 lifecycle remains failed.
This is Basic-native contract work for A4H/001/MARIAN, not PP, public admission or full lifecycle qualification.

## What happened

The fixed v3 attempt at `8135cea8e7ff550964260b22009c980e477a2a10` is permanently failed and consumed.
Its initial DDLS `ZARC1_V2V_F4C656905A65AA61` was created, activated with matching active source,
and updated successfully. The update saved an inactive draft; its owning UNLOCK returned 200 and
its editing session closed. At `2026-11-02T23:43:25.377Z`, journal row 00095 stopped with
`metadata-state-link`: the native inactive metadata linked to the active owner using
`./zarc1_v2v_f4c656905a65aa61?version=active`, while the harness accepted only absolute source links.
This was a read-guard mismatch after a successful update, not a syntax or native save refusal.

No DELETE was sent. The result retains exactly that owner for inspection, with
`cleanupUnconfirmed:true`. The five other fixed owners were never created. The original result
SHA-256 is `3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d`.
Preserve its intent, manifest, prerequisites, result and all 95 journal rows. Never rerun or repair its claim.

The separate 23:50:28 UTC GET-only inspection confirmed the exact pair:

| Resource | Evidence |
|---|---|
| Default metadata | Inactive, MARIAN, `$TMP`, original nonce/description; raw SHA `48f3d49d31716ab25d007008725b8ca2168006ba0a2eec170044f203f6e8fc55` |
| Explicit active metadata | Active with the exact relative inactive counterpart; raw SHA `fca28398d250795a5bf79d94bf352de7175f851a39c177a38ba105969109009c` |
| Active source | Original 340 bytes; SHA `62e1dfa3ccbfc456e91338019fbb2e03c25c2a595de264e3dc23742e4c6c2a8a` |
| Inactive source | Updated 367 bytes; SHA `06b0b8832019beef3310cf3b4e3d05d908a191c7aac67be5eb892f32fa4b2d5f` |
| Other five owners | Individually absent through native typed 404 responses |
| Inactive inventory | Valid native XML containing the selected retained owner; unrelated draft data stays private |

Two genuinely rerun post-failure SM12 searches showed zero locks at 23:46:41.211 and23:46:53.510 UTC.
The earlier timed-out display was not evidence. These historical controls are not fresh cleanup prerequisites.

## Narrow link correction

One pure exact-match helper now serves production private declarative activation and qualification.
It retains the prior exact owned absolute source-state links and admits the observed DDLS-only
`./<exact-owned-leaf>?version=active|inactive` form. It never follows links or resolves dot segments.
Foreign owners, extra/duplicate parameters, fragments, alternate encodings of the observed relative leaf, unknown forms and duplicate
alternatives refuse. Other declarative families do not gain relative-link qualification.

Ordinary activation verification still requires active metadata in both reads, the matching active
source and no inactive counterpart. Recovery deliberately verifies an active/inactive pair separately;
it does not pretend this retained object is solely active. Tests include the actual owned metadata
and a production activation regression; both positive reproductions failed before the correction.
No new full-lifecycle protocol or fixture work is introduced.

## Recovery scope and phases

The new fixed entry `native-declarative-v3-recovery.ts` owns the root
`~/.local/state/arc1-qualification/pr1142-native-declarative-v3-recovery-v1`.
No argument can choose a root, owner, source, transport, native operation or old claim.
The previously reviewed cleanup loop is shared by explicit fixed profiles; the consumed v1 recovery
keeps its original owner/source/metadata checks and separate root.

The new profile permits only the selected owner's LOCK, existing-owner local recording check,
one ordinary DELETE and owning UNLOCK. No create, save, activation, repair, foreign deletion or
transport request is allowed. Before locking and again while its own lock is held, stateless reads
must match both canonical metadata receipts and both exact source byte strings, and prove all five
other owners absent. The stateless reads do not disturb the editing session. The shared adapter
keeps DELETE and UNLOCK in that same owning session, including cleanup on guard drift or cancellation.
Typed independent owner absence, the five other absences, clean suffix inventory and confirmed
session cleanup are required for success. Failure/uncertainty never causes an automatic retry.

The phases require the exact clean reviewed full revision and Node 22.21.1, with the existing runtime
and diagnostic restrictions, including unset HTTP debug:

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-v3-recovery.ts --prepare-reviewed-v3-ddls-cleanup <reviewed-full-commit>
node --import tsx scripts/qualification/pr1142/native-declarative-v3-recovery.ts --check-reviewed-v3-ddls-cleanup <reviewed-full-commit>
node --import tsx scripts/qualification/pr1142/native-declarative-v3-recovery.ts --execute-reviewed-v3-ddls-cleanup <reviewed-full-commit>
```

These historical phase forms were reviewed and executed once at `9c103ab74852d75db5f518e4d0f93e777d5cf8ca`.
The fixed recovery root is now consumed; never rerun or reset it.
Prepare validates original receipts and saves the fixed cleanup intent without native dependencies.
Check is read-only and nonclaiming, including no state-parent creation or Git index writes. It verifies
source, original intent/manifest/result/all 95 journal hashes and original prerequisite bytes, the saved
cleanup intent, and fresh zero-lock SM12 receipts/images. It gives no execution grant.

After prepare, obtain new zero-lock searches for client 001/table `*`: user `*`, argument `*F4C656905A65AA61*`;
and user `MARIAN`, argument `*`. Save unmodified JPEGs as `prerequisites/sm12-suffix.jpg` and
`prerequisites/sm12-user.jpg`, mode 0600. The strict `sm12-baseline.json` contains `protocol`, reviewed
`revision`, cleanup `intentHash`, the fixed `originalResultHash`, and `suffixSearch`/`userSearch`.
Each search contains `observedAt`, `client`, `user`, `table`, `argument`, `lockCount:0`, and the image's
`evidenceSha256`. Both observations must postdate the cleanup intent and remain within five minutes.

Execute permanently claims `attempt/` before checking prerequisites and never reuses check output.
It independently rereads source, all receipts and freshness, including after asynchronous dependency
loading and client setup. These checks continue through the owning lifecycle; freshness remains
required until the DELETE is submitted. Exact-own UNLOCK remains available on stop/drift. A failed
claimed attempt remains consumed even when no native request was sent. The original v3 failure and
all previous recovery claims stay unchanged.

The driver rechecks immutable source/proof/receipt bindings after the final independent absence and
inventory awaits; the entry checks them again after the driver resolves, immediately before saving
the result. Late drift makes the attempt fail and requires inspection while preserving any confirmed
deletion and session cleanup. Earlier failure reasons remain recorded. Expiry of otherwise unchanged
SM12 evidence after an observed DELETE remains exempt; immutable byte checks are never exempt.

## Completed recovery and independent audit

The [first review](2026-11-03-native-declarative-v3-recovery-review1-verbatim.md) found missing
terminal binding checks. The correction at `9c103ab74852d75db5f518e4d0f93e777d5cf8ca` received
[exact-source approval](2026-11-03-native-declarative-v3-recovery-review2-verbatim.md).

A new intent was prepared at 01:05:26.873 UTC on November 3, followed by actual zero-lock JPEG
observations at 01:05:54.558 and 01:06:09.981. The non-claiming check passed, all GitHub active/queued/
pending runs were absent, the host was held awake and other agents remained offline. The one
execution ended successfully at 01:07:24 UTC. It sent exactly one DELETE of the retained DDLS,
received HTTP 200, confirmed typed absence of all six original owners, completed its owning UNLOCK
and session cleanup, and reported a clean inactive inventory. Its result SHA-256 is
`31f1bd4a81643f79adfdc6a19ca816e1aeb6a4eb855a59e3a18b2738a23e3130`;
`failure:false`, `confirmedDeleted:true`, `cleanupConfirmed:true`, with no remaining or inspection owners.

Fresh post-cleanup SM12 searches at 01:08:08.993 and 01:08:48.885 again showed zero locks for the
user and suffix. The [independent evidence audit](2026-11-03-native-declarative-v3-recovery-audit-verbatim.md)
verified the journal, both saved post images and all 117 unchanged original files. It distinguishes
callback-derived session closure and hash-only private inventory from direct saved wire/image facts.
No unrelated inventory contents or native lock handles are published.

Cleanup of this owned view is complete. The failed six-owner lifecycle is not qualified by that
cleanup; a later lifecycle needs a new reviewed protocol, claim and fresh operational prerequisites.
No PP, public-admission or whole-PR qualification is inferred.
