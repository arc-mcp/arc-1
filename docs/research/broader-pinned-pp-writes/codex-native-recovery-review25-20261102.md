# Review 25 — cleanup/correction commit 4575b2cb

Reviewer: Codex fallback following the confirmed Claude usage limit. This is an independent Codex review, not a Claude verdict. I authored neither this cleanup implementation nor its tests.

Candidate: `4575b2cb2ee05283ff9fd5426c3551b94186bc1d`  
Base: `e2b08f3d984f8cd84a30038f74820932db36cf1a`  
Snapshot: `/Users/marianzeis/.local/state/arc1-review/pr1142-recovery-review25-20261102-193629/source`

## Separate verdicts

**(a) Private development checkpoint: NO-GO for review-complete acceptance.** One P2/Medium finding remains in the reused observation helper. Continued private correction work is appropriate; the request scope and ownership controls are otherwise sound in the reviewed paths. There is no production `src` change or public admission in this delta.

**(b) Exactly one cleanup invocation at this commit: NO-GO.** Do not run the cleanup at these bytes. Fix the response-body observation issue, add its regression, and independently review the resulting exact revision before any native invocation. Passing existing tests does not close this missing case.

This is not a whole-PR merge-readiness review. The original v1 experiment remains failed and its claim remains permanently consumed. A future v2 lifecycle is outside this review.

## Finding R25-1 — P2/Medium: A typed DELETE response can persist its live lock handle

Primary location: [native-observed-http.ts:54](/Users/marianzeis/.local/state/arc1-review/pr1142-recovery-review25-20261102-193629/source/scripts/qualification/pr1142/native-observed-http.ts:54), with body retention at lines 93 and 102–107. The new `native-declarative-recovery-driver.ts` uses this observer for its guarded DELETE.

The observer marks only requests containing `_action` as sensitive. DELETE instead carries `?lockHandle=...`, so `sensitive` remains false. Removing that query parameter from the journal's path label does not remove it from a returned body. For a typed SAP DELETE error whose XML message or request URI echoes the supplied lock handle, the error-body branch persists the complete raw XML.

This path is not repaired by the HTTP error layer: [http.ts:1004](/Users/marianzeis/.local/state/arc1-review/pr1142-recovery-review25-20261102-193629/source/src/adt/http.ts:1004) passes the raw body to `AdtApiError`, whose `responseBody` parameter retains it. An otherwise valid typed exception containing the test handle `RECOVERY-FIXTURE-LOCK` therefore reaches the private journal unchanged. Successful responses on a lock-bearing request are also retained without scrubbing at observer line 93.

The new recovery fault tests use untyped `PRIVATE_ERROR` bodies for DELETE failures. Those bodies are omitted by `extractExceptionType`, so the tests' handle/password/context sweep does not exercise this leak.

**Impact:** the cleanup path can write a live editing handle to disk despite the secret-safe journal contract. Owner-only file permissions reduce exposure but do not satisfy the explicit requirement to keep runtime handles out of persisted receipts. This is a defect in an inherited helper now exercised by the new cleanup entry; it is not evidence of a previous native leak.

**Required correction:** treat requests carrying a lock handle as sensitive, or reliably remove known runtime secrets before retaining their bodies. Cover both successful and typed-error response branches. Retain safe status, byte-count/digest and conservative outcome evidence; do not weaken the deletion guard or owning cleanup.

**Required regression:** use the real recovery/observer path with a typed DELETE error that echoes its actual test lock handle, and assert the handle is absent from all persisted records and outcome. Assert exactly one DELETE attempt, a failed/unconfirmed outcome and continued own UNLOCK/session close. Also cover the successful-response body branch.

This finding is based on the deterministic source path, not a custom executed reproducer or a claim about which text SAP will return in this run. No new tests or source mutations were allowed in this immutable review.

## Controls assessed

| Area | Assessment |
|---|---|
| Exact cleanup scope | The literal DDLS owner, original source and metadata receipt are fixed. The narrow request validator rejects create, PUT, activation, other owners, non-local CTS payloads, extra query keys and bodies on lock/delete requests. |
| Ownership and state | The fixed full namespace-bound metadata hash includes inactive state, MARIAN authorship, package, marker and post-failure activation-log links. Source is independently bound by hash. Changed selected metadata/source or author/package refuses before mutation, and the independent receipt check repeats under the owning lock. |
| Active query fallback | Supplied six-GET evidence explicitly reports inactive metadata for default/inactive/active queries and the same source. An active query response alone is correctly not claimed as active-state proof. |
| Shared mutation policy | The private declarative context invokes the existing guarded deletion adapter. It resolves the real package and local recording state before LOCK and rechecks them under that same session's lock. |
| Stop and source binding | Validation precedes the continuation exception. Only the exact validated own UNLOCK survives a stop or binding failure. Receipt checks are followed by another continuation check before DELETE. The recovery tests exercise stop and binding changes arising inside the independent under-lock reads. |
| Budgets and replay | Forward recovery has a 90-second deadline. Native requests are capped at 30 seconds, disable replay/transient retries and enforce response allowances. The observer rechecks budget after guard reads and requires five seconds remaining for DELETE. Own cleanup has separately bounded unlock/session-close policy. |
| Unknown outcomes | Rejected/network/503 DELETE outcomes do not become absence or retry permission. Success requires adapter state `deleted`, independent typed absence, valid suffix-free inventory and confirmed cleanup. Dirty inventory and cleanup failure remain failures. |
| Runtime and claims | Runtime and exact source binding precede claim/credentials. The separate fixed recovery claim is created before reading credentials and never reused. Original manifest/result hashes are checked before credentials. Literal HTTPS target and MARIAN/001 are enforced. HTTP debug is explicitly refused for recovery. |
| Journal secrecy | Fixed error codes, field names and sanitized labels are appropriate; R25-1 is the remaining response-body exception. |
| Public behavior | No public DDLS or other family admission changed. Basic-native cleanup is not PP qualification or permission to expose Basic writes. |

Internal CSRF bootstrap and owning-session close remain part of the existing HTTP/session implementation; they are not evidence of additional caller-selectable cleanup targets.

## Review 24 Low findings and fixture correction

All four listed Low findings are closed in this delta:

1. Non-200 nonthrowing absence responses now report `absence-not-typed` with status. New 204/302/307 cases pass.
2. README adds `delete-not-sent` and explains dependency bases retained outside `cleanupNotAttempted`.
3. Preflight configuration refusals retain invalid field names and `mutationAttempted: false`; the README explains the ignored credential file in a new checkout.
4. Post-run controls require both all-table suffix and MARIAN/001 user-wide SM12 captures.

The fixture uses `ConnectionId` in both generated source variants; the regression passes. The recovery fixture deliberately retains the historical rejected `Connection` source and cannot repair it. This proves an offline fixture correction, not successful native compilation.

## Supplied native evidence

The original native journal shows one DDLS create/save/unlock, then HTTP 200 containing failed activation with DT205 reserved-word diagnostics. It shows no DELETE and no other create. The result remains failed with one retained owner.

I independently verified these supplied-file SHA-256 values:

- Original manifest: `8e728667000831c462cfe10f1854dffa65fad6f8fb75d124e22278e2d995a605`.
- Original failed result: `e4a1997c61034c9de302dd0e25c44b524b1d9caa4af69fcb0270685ae13a7bf4`.
- GET-only inspector source: `9d8e9c9c2e26d630e1019b7a1a9b7dc57c8181af4d084b9dcab25d06983788ec`.
- Verbatim review 24: `e3d57519532b28f16333f0424e19978fe5407c1221a51de17557e47d00649633`.

The 19:10:54–19:10:55 UTC inspection receipts show the same 331-byte source and inactive metadata across all requested views. The recorded SM12 controls show zero locks at 18:55:17 (before), 18:56:54 (suffix) and 18:57:46 (user-wide), all A4H/001 MARIAN. These are historical controls, not a current baseline for a later cleanup.

## Independently executed checks

Each check ran alone and completed with exit code 0.

| Check | Result |
|---|---|
| Initial snapshot verifier | Candidate revision matched; 4,622 files unchanged |
| Focused recovery driver, recovery entry, preflight and declarative qualification tests | 4 files, 107 tests passed, including the 57 new recovery cases |
| Full `npm exec -- vitest run --silent=true` | 504 files, 13,579 tests passed |
| `npm run typecheck` | All three TypeScript projects passed |
| `npm run check:sizes` | 988 source/test files and 12 schema scenarios passed |
| `npm run validate:policy` | 135 policy entries and 14 schemas passed |
| Final snapshot verifier | Candidate revision matched; 4,622 files unchanged |

Build, full lint, strict documentation checks and the 59 historical scenarios are author-reported for this candidate; I did not independently rerun them. I did not inspect remote CI status. The unit output was large and tool-truncated, but both completed final summaries and exit codes were observed.

## Re-review and eventual execution conditions

These are requirements for a future decision, **not a GO for 4575b2cb**:

- Review the exact committed fix and its regression, including unchanged scope, claim, receipt and cleanup semantics. Do not substitute changed bytes into this verdict.
- If a future reviewer gives GO, execute only the separately claimed cleanup entry once against the unchanged owned inactive `DDLS ZARC1_NV_61EDD87470C55DB0`.
- Use the clean detached exact reviewed checkout, its real dependency installation/lockfile, Node v22.21.1 consistently, prescribed runtime environment, existing private MARIAN/001 credentials and private output. Keep the host awake and avoid other fixture activity.
- Obtain a fresh zero-lock MARIAN/001 SM12 baseline immediately before that invocation. Preserve the original consumed v1 claim and ensure the separate recovery claim has not already been consumed.
- After exit, capture fresh suffix and user-wide all-table SM12 results. Accept cleanup only with `failure: false`, `confirmedDeleted: true`, `cleanupConfirmed: true`, independent typed absence/clean inventory and zero locks in both searches.
- On any mismatch, stop with receipts preserved and inspect read-only. No claim removal, retry, source repair, activation, SM12 lock deletion or full lifecycle rerun is authorized by this review.
- Even successful cleanup cannot change the original failed experiment into a pass, establish PP/public admission, or make PR #1142 merge-ready.

## Procedure and limits

First and last source actions were the supplied verifier. No source reads occurred after the final verification. This report was written outside the snapshot as authorized.

No native entry, preflight, inspector, SAP/browser action, external-service request, credential read, install, manual Git operation, source edit, delegation or mutant was performed. Approved tests loaded installed dependencies and generated their usual ignored unit report. Installed third-party dependency bytes are not attested.

One read-only search failed before execution because zsh found no match for an unquoted `tests/unit/handlers/native-declarative*.test.ts` glob. It was replaced by an exact-path search. Some large read outputs were truncated; the relevant SM12 fields were subsequently obtained with bounded searches. There were no approval refusals or other tool deviations.

FEAT-93 was checked at the start and again before completion. Its incomplete implementation/native/PP/public qualification status remains appropriate.
