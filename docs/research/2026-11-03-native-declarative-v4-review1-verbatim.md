# Independent native declarative V4 review — NO-GO

Candidate: `c362ed42e2b9fbb90d0d22f1fc303b52e2bef87d`. Base: `6a229e8cd3826dcd50dc094d19d7fbf690e73cd2`.
Actual proposed execution checkout: `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`, branch `codex/native-declarative-v4-execution`, frozen by the parent at that exact candidate. This review used an immutable archive from that checkout, not the concurrently released author worktree.

Snapshot: `/Users/marianzeis/.local/state/arc1-review/pr1142-native-declarative-v4-review1-20261103-015221/source`.
Author-report SHA-256 verified: `bf2f9c2a3579b3a97a1eb8d07624d0a843fe4e18eaf8ce178daaeeba87cf117f`.
First and final source actions ran the snapshot verifier; **4,737 files unchanged**. No source operation followed final verification. This report is written outside the source snapshot.

## Exact phase verdict

| Phase | Verdict at c362ed42 |
| --- | --- |
| Fixed offline preparation | **NO-GO for this phase chain**: do not permanently bind the V4 root/intent to a source revision with the known correction outstanding. No separate preparation defect was found. |
| Fixed GET-only preflight | **NO-GO pending corrected exact-source review**. Its GET-only and evidence boundaries passed; do not start an obsolete prerequisite chain. |
| Offline nonclaiming check | **NO-GO pending corrected exact-source review**. Its read-only/non-grant behavior passed; no real prepared V4 protocol exists. |
| One six-owner Basic-native lifecycle | **NO-GO — F1 below.** |

The real fixed V4 root was absent during this review. No real preparation, preflight, check, claim, credential load or native attempt was invoked by the reviewer. No native-execution, PP, public-admission or whole-PR approval follows from passing offline tests. A corrected source must receive its own exact-source review before this once-only protocol is prepared.

## F1 — P2: exact owned relative state links are incorrectly restricted to DDLS

Location: `src/adt/pinned-declarative-state-link.ts:12–13`.
Affected caller: `scripts/qualification/pr1142/native-declarative-evidence.ts:127–132`, reached after the acknowledged private save at `native-declarative-driver.ts:104–123`. The production declarative activation reader also uses this shared helper.

The helper recognizes the literal metadata alternative `./<exact owner leaf>?version=active` or `inactive` only when `type === 'DDLS'`. The independently verified native owner/type, package, marker, current version and source do not make that URI identity test type-specific. For the other fixed families, the same exact own-resource spelling is rejected as `metadata-state-link` solely because of the type gate.

Independent probes copied the real-driver/mock-HTTP fixture harness outside the snapshot and changed only the synthetic state-link representation on the inactive update. Canonical six-owner operation and the DDLS relative variant pass. DCLS, DDLX, BDEF and SRVD each fail after their acknowledged update PUT, keep the changed owner plus its dependency, report unconfirmed cleanup and never reach complete qualification:

| Synthetic variant | Remaining owners reported after failure |
| --- | --- |
| DCLS relative own metadata alternative | DCLS plus view DDLS |
| DDLX relative own metadata alternative | DDLX plus view DDLS |
| BDEF relative own metadata alternative | BDEF plus abstract DDLS |
| SRVD relative own metadata alternative | SRVD plus view DDLS |

All four failures occur in the update phase with reason `metadata-state-link`. This reproduces the same avoidable post-save preservation pattern as the actual V3 failure, now for the other families. The preservation itself is correct; the unnecessary representation refusal causes it.

**Evidence distinction:** actual native DDLS relative-link evidence exists in the retained V3 capture. The four additional family variants here are **synthetic executable compatibility probes**, not new SAP observations and not native-family qualification. They prove the code's inconsistent exact-URI recognition and resulting partial workflow. They do not prove that this backend will return any particular link for those families.

**Required correction:** share bounded literal same-owner metadata-alternative recognition across the already supported declarative families. Keep exact owner identity and explicit lowercase `active`/`inactive`; do not introduce URL following or broad normalization. Continue refusing foreign owners/origins, traversal, malformed or extra query data, duplicate links, missing version and active verification with an inactive alternative. The existing BDEF mock `./<name>/source/main` without a version is a different, genuinely unresolved shape and must not become accepted incidentally. Preserve per-family native metadata/type/source validation, active/default consistency, all package/recording checks and public closure. Update the intentional cross-family-refusal test and research wording, and retain real-driver positive and adversarial controls.

## Independent checks and retained evidence

- **Normal full suite:** **546 files / 15,863 tests passed** under Node **22.21.1**, in the clean git-archive snapshot with `.env` absent and a minimal environment. No global dotenv stub or altered test setup was used. Log: `independent-full-unit.log` (SHA-256 `067321bfa73d9ec38c402b1ff2e502b35d3c7d14e6de20dda86fbd7bbd262c1b`). This replaces the author's ambient-checkout run as the clean-suite evidence for this review.
- **Independent real-driver probes:** **8 total, 4 passed / 4 failed**. Passing controls are the existing fixture alias assertion, canonical six-owner lifecycle, DDLS relative lifecycle and binding drift during the real initial CSRF await (no repository creation follows). The four F1 failures are preserved without editing the source. Source: `independent-driver-probes.test.ts` (SHA-256 `d826289f2cc0e1d9118b23d0a013f45f0e6ca0bc194b35d0883c5e4ffa449269`); raw log: `independent-driver-probes.log` (SHA-256 `4afe8c067a5f082e58418dba5ef9de56ea51b98f16a47084291c1b643690ce10`). These use mock credentials and mocked fetch only.
- **Independent phase/terminal controls:** **3 passed**. An actual prerequisite-image edit while an awaited failed driver returns preserves confirmed deletion facts but marks binding/cleanup unconfirmed; an actual saved-intent byte edit during independent absence refuses terminal success; saved-intent drift during final GET-only inventory refuses preflight with no attempt. Replay remains refused. Source/log: `independent-phase-probes.test.ts` and `independent-phase-probes.log`.
- **All three TypeScript projects passed:** `independent-typecheck.log`.
- **Independent historical file audit:** rehashed all **265** selected files (24 proof files plus 241 exact consecutively named journal rows), matched all committed individual/aggregate digests, confirmed the deliberately absent V2 attempt manifest and the absent real V4 root. `independent-history-hashes.json` retains names and hashes only. The two identical successful recovery result byte sequences remain bound to distinct manifests, roots and journals. This is a read-only recheck of the V4 selected history set, not a new audit of every ancillary historical file.
- **Final verifier:** `independent-final-verification.log`, 4,737 files unchanged. All external probe/config/log hashes are retained in `independent-review-evidence-hashes.json`.

The full clean run includes the existing import-purity tripwires, JPEG/chronology/tamper tests, exact history checks, final-driver/runner drift tests, source/runtime-binding tests and complete fixed-fixture adapter matrix. Those tests use bounded temporary protocol roots and injected dependencies; they are not execution of the real fixed protocol. The already passing author build/lint/policy/size/docs and 59 historical scenarios were read as author evidence rather than redundantly rerun here. No review source edits, install, push, browser or SAP/network task was performed; ordinary local unit-server and mocked-HTTP behavior remains part of the test suite.

## Other inspected boundaries and retained limits

The fixed wrapper binds the V4 entry/root and refuses arbitrary profile/owner/source arguments. Its fresh 16-hex suffix and disjoint V4 names reject the three consumed historical suffixes. The exact fixture graph retains `ConnectionId`, one read-only SFLIGHT view, an abstract DDLS, DCLS and DDLX depending on the view, abstract BDEF depending on the abstract DDLS, and SRVD exposing the view. No behavior implementation class, service binding/publication, table-data write, helper or unrelated object is introduced. Comment-only updates and reverse dependency cleanup remain fixed. Native compilation/normalization of the five not-yet-completed families remains genuinely unqualified; mocks do not erase that limit.

Preparation and check import no native credential/client execution path; the read-only binding option avoids state creation and optional Git index writes. GET-only preflight verifies typed absence for all six names and a well-formed suffix-free inventory; arbitrary HTML/not-found responses do not become absence. V4 additionally binds preflight chronology to its intent. JPEG signatures/digests, exact SM12 filters/counts, observation chronology and five-minute freshness are checked, while visual meaning/provenance still needs independent inspection of the genuine fresh images.

The exclusive attempt claim precedes prerequisite/credential loading and survives refusal, failure and revision changes. Successful offline check confers no grant. Execute rereads intent/history/prerequisites after claiming; preflight/attempt sentinels prevent overlap. Initial, per-operation and terminal binding checks include the fixed predecessor proof. The workflow's new post-final-absence check and runner's unconditional pre-result check retain confirmed native facts while refusing drift. Baseline age alone is exempt after mutation; immutable proof checks remain. Request ownership checks, exact source PUTs, single-owner activation, owning DELETE lock/receipt and direct-child absence guards remain intact. Own UNLOCK/session cleanup retains its narrow exception after stop/binding refusal. Uncertain children preserve their bases; no rollback/retry or forced cleanup is introduced.

A corrected candidate's later bounded execution verdict must still require actual fresh complete preflight, both independently inspected zero-lock raw JPEG SM12 proofs (client001, table*, user*/new suffix and MARIAN/*), unchanged source/runtime/proof, no CI/native overlap and an awake host. Post-run proof and any needed recovery remain separate. These are retained protocol/operator prerequisites, not advance approval from this NO-GO review.

FEAT-93 was checked at start and finish; native lifecycle, current-code two-writer PP and public admission remain open. No roadmap modification was authorized or made.
