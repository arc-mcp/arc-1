# Independent exact-source v3 recovery verdict

**Candidate:** `67b01c60acc0e18f53d7e193567eb2ddeb13d18a`  
**Base:** `e7d6156483ec6c78d1412cb90fd9fb04921f3eea`  
**Proposed execution checkout:** `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`, branch `codex/native-declarative-v3-recovery`.  
**Verdict: NO-GO for this exact operational phase chain; one P2 requires correction.**

This reviewer authored neither the recovery harness nor the relative-link correction. Review used a snapshot made from the actual clean frozen execution checkout with the authorized snapshot utility. The first and final source actions were the snapshot verifier: **4,717 files unchanged**. No source edits, manual Git, installs, actual entry/phase, SAP/browser/credentials/.env/external-network activity, delegation or push occurred. Original failed-v3 evidence and all claims were read-only.

## F1 — [P2] Recheck immutable binding after the final evidence awaits

Location: `scripts/qualification/pr1142/native-declarative-recovery-shared.ts:99–105`; persistence boundary also at `native-declarative-v3-recovery.ts:168–175`.

After production deletion/owning cleanup, the shared loop checks `verifySource()` before the independent owner-absence read. It then awaits owner absence, the other five owner absences and the final inactive inventory, but never rechecks the immutable binding after those awaits. The entry persists the returned outcome without a further verification. Therefore a source/original-proof/intent/image/receipt binding failure arising during those last reads can still produce `failure:false`, `confirmedDeleted:true`, `cleanupConfirmed:true`, `remaining:[]`, `inspectionRequired:[]`.

Two independent executable probes use the real shared recovery driver and actual mocked HTTP lifecycle. They set the binding failure during (a) the final other-owner absence reads and (b) the final inventory response. Both reproduce that incorrect success. The same copied suite's 40 existing driver controls pass; the two added cases fail. No second DELETE or cleanup failure is required to reproduce it.

Preserve the final binding check after the last asynchronous evidence and before successful persistence, while retaining known facts: a binding failure after confirmed deletion should still report `confirmedDeleted:true`, `cleanupConfirmed:true`, `remaining:[]`, but `failure:true` and the required inspection state. Do not reinterpret this as a requirement for the old SM12 timestamp to stay fresh after DELETE: the entry intentionally exempts freshness after actual submission while retaining immutable source/receipt checks. Own unlock/session closure must remain available. This is a bounded terminal-evidence correction, not a request for a new protocol, retry or fixture.

Evidence:
- `independent-tail-probes.test.ts`, SHA256 `c646f2fb91b453ffa711e3cc84c76a26afd011f5e2540bf21968affeb3092b47`.
- `independent-tail-probes-final.log`, SHA256 `3f8bb129d5e22ee98864983995301768c01dcdbb9666d3f8e66e927645026c8f` — 40 pass / 2 fail.

## Separate phase assessment

| Proposed phase at 67b01c60 | Assessment |
| --- | --- |
| Offline prepare | Its native-free/original-proof/source-binding implementation passed inspection and focused tests; no separate prepare defect found. **Do not run it for this rejected phase chain:** it would permanently bind the one fixed recovery root/intent to a revision whose execute phase is not approved. Review and prepare the corrected exact revision instead. |
| Offline check | Its read-only/nonclaiming checks, no native dependency initialization and no execution-grant semantics passed. **No operational check approval for this rejected chain:** the real recovery root is still absent and the corrected revision must receive its own intent/fresh evidence. |
| One fixed cleanup execute | **NO-GO due to F1.** A corrected exact-source review is required before the attempt is claimed or native dependencies/credentials are loaded. |

The original consumed v3 root remains consumed forever. This verdict authorizes no recovery phase, future lifecycle, additional fixture, publication, PP/public admission or merge. It does not require an advance guarantee that SAP DELETE will succeed. The reviewed design may legitimately refuse or report uncertainty; it must preserve the exact one-owner scope, consumed attempt and truthful partial state.

## Other reviewed boundaries

- Fixed owner only: DDLS `ZARC1_V2V_F4C656905A65AA61`, A4H/001, Basic-native MARIAN, `$TMP`, exact original marker. No caller root/owner/type/source/request selector, create/PUT/activation/repair, foreign DELETE or guessed generated-child cleanup.
- Original intent, manifest, result, all 95 sequential journal files and four manifest-bound prior prerequisites are fixed by hashes. Independently checked **102 original protocol files**, including result SHA `3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d`; all matched. No recovery root existed during review.
- Independently hashed the 10 retained current-inspection payloads. The repository fixture metadata and both exact source strings equal the actual default/active metadata and inactive/active source capture bytes. Only hashes of the unrelated inactive inventory were used; other users' draft names were not exposed. See `independent-original-evidence.json` (SHA256 `fddbc7d8b7e0db5810b0925fc96d190ad3b49afbe2f5095c1adff57e4a6fca7e`).
- The DDLS-only relative helper accepts the exact owned leaf and explicit active/inactive value, without URL following/normalization or expansion to other families. Hostile query/path/encoding variants and duplicates refuse. Ordinary completed-activation checks still refuse an inactive counterpart; the recovery itself separately requires the precise opposite-version link and complete fixed canonical metadata hash for both retained versions.
- Before LOCK and again while the owning session holds LOCK, exact metadata/source/package/author/marker and all five typed other-owner absences are checked. The actual observer revalidates after its awaited pre-DELETE receipt guard. Actual driver tests verify one DELETE, the real lock handle/session for DELETE and UNLOCK, and independent stateless checks without disturbing the editing session.
- The fixed new claim is separate and permanent. Execute claims before prerequisite validation, re-reads rather than trusting check output, and remains consumed after failure. Preparation/check import paths stay native/credential-free; execution verifies after awaited imports/client setup. Runtime restrictions require Node22.21.1 and reject unsafe overrides/debug.
- New raw JPEG files must be private regular files, bounded and hash/signature matched; strict receipts bind revision, intent, original result, exact client/table/user/argument/count and time. Manual image interpretation remains an operator prerequisite, not a capability implied by hashing a JPEG. Existing historical SM12 images are insufficient for a new cleanup.
- Native response/deadline/no-replay controls and exact-own cleanup remain shared. Typed absence and inventory failures retain uncertainty; a known deleted owner remains distinguishable from failed cleanup. F1 is the remaining terminal binding gap.

## Independent checks and limits

- **234 tests passed** across seven focused state-link/activation/recovery/original-proof/binding/import suites: `independent-focused.log`.
- **69 tests passed** across the shared historical recovery/entry/lock suites: `independent-shared-recovery.log`.
- Actual-driver adversarial suite: **40 existing controls pass, 2 new regressions fail**, as reported above.
- Source TypeScript passed: `independent-types.log`.
- Final snapshot verifier: **4,717 files unchanged**, `independent-final-verification.log`.

The author's reported full 541-file / 15,570-test suite, all static/docs gates and 59 historical scenarios were read as author evidence, not rerun or represented as independent results. The first outside-snapshot probe invocation hit Vitest's mock-import resolution restriction before tests ran; the outside-only alias configuration corrected it. Initial log remains `independent-tail-probes.log`; no source edit or native access resulted.

After correction, a renewed exact-source review may grant the fixed preparation/check/single cleanup chain subject to new complete, actual, manually inspected zero-lock JPEGs bound to the new intent; fresh exact live native preconditions; no overlapping CI/native work; and the host remaining awake. Even successful cleanup would establish only removal of this retained owner, leaving the failed v3 lifecycle and broader native/PP/public qualification open.
