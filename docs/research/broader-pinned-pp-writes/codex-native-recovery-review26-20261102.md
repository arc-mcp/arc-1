# Review 26 — recovery observation correction

Reviewer: Codex fallback after the confirmed Claude usage limit. I reviewed R25-1 and authored neither this correction nor its tests. This is not a Claude review.

Candidate: `eb82bd99cd786e5b073b79cfd300ad3696465123`  
Base: `4575b2cb2ee05283ff9fd5426c3551b94186bc1d`  
Snapshot: `/Users/marianzeis/.local/state/arc1-review/pr1142-recovery-review26-20261102-195731/source`

## Verdicts

**(a) Private correction checkpoint: GO.** R25-1 is closed. I found no new High, Medium or Low finding in the focused correction and necessary unchanged context. Review 25's NO-GO remains valid history for its older revision.

**(b) Exactly one cleanup invocation: GO at `eb82bd99cd786e5b073b79cfd300ad3696465123`, subject to the concrete controls below.** This covers only the existing, unchanged inactive `DDLS ZARC1_NV_61EDD87470C55DB0` in `$TMP` on A4H/001, using the fixed MARIAN direct-Basic cleanup entry. No create, source repair, activation, other owner, repeat invocation or full lifecycle attempt is included.

This is authorization of a bounded attempt, not a prediction of native success. The original v1 run remains failed and its claim remains permanently consumed. Nothing here establishes PP qualification, public admission, a v2 lifecycle or whole-PR merge readiness.

## R25-1 closure

[native-observed-http.ts:54](/Users/marianzeis/.local/state/arc1-review/pr1142-recovery-review26-20261102-195731/source/scripts/qualification/pr1142/native-observed-http.ts:54) now marks a request sensitive whenever any query key case-insensitively equals `lockHandle`, before removing that key from the recorded URI. Both successful and error response-body branches use this flag.

The error branch now retains status, response byte count and SHA-256 without retaining the sensitive body. Successful responses retain the same nonsecret receipt fields. This changes observation only; it does not alter the request sent to SAP, the request validator, receipt guards, replay policy or outcome classification. Handle-free GETs retain their typed absence evidence.

The two new tests exercise the actual recovery/client/observer path:

- A typed HTTP 500 DELETE exception echoes the actual test handle in its request URI. Exactly one DELETE occurs; the outcome remains `delete-unconfirmed`, the owner remains for inspection, and own UNLOCK/session close still complete. The exact error receipt has status/size/digest and no body.
- A legitimate HTTP 200 DELETE response echoes the same handle. Its body is omitted, and success still requires independent typed absence and confirmed cleanup. Exactly one DELETE, UNLOCK and close occur.

The existing after-each sweep checks persisted records and outcome for the handle, context, password and private exception text. Both regressions and the wider focused cases passed. This closes the earlier deterministic leak path; it is not a claim about which native error SAP will return.

## Unchanged cleanup controls

The follow-up contains no production `src`, cleanup-scope, fixture-receipt, claim or source-binding change. I rechecked the observer and recovery driver around the affected calls.

The driver still checks the fixed namespace-bound post-failure metadata and source hashes before locking and again through independent same-principal reads while the shared adapter holds its own lock. It still rechecks continuation after those reads, resolves/revalidates native package and local recording state, and permits only the exact selected DELETE.

The validator remains narrower than the historical lifecycle: no create, PUT, activation, foreign owner, non-local CTS payload or extra query/body input. Only an exact validated own UNLOCK bypasses a stop/source-binding failure. Forward work remains bounded and non-replayed; owning cleanup has its separate bounded policy. Unknown deletion outcomes remain failed.

Independent typed owner absence, a valid suffix-free inactive inventory and confirmed own cleanup are still required for a pass. The earlier `version=active` fallback observation is not promoted to active-state proof.

The supplied original manifest/result and inspector hashes match review 25. The committed copy of review 25 has SHA-256 `8088fb6f44c745192b809ce4f1ed5ed5eaa67ad259d79f4f632d351295d981ab`. Original failed-result hashes remain those enforced by the entry. Historical native and SM12 evidence remains historical; it does not replace the fresh controls below.

## Conditions for the single invocation

1. **Exact bytes and runtime:** use a clean detached checkout at `eb82bd99cd786e5b073b79cfd300ad3696465123`, from its real path, with no subsequent source/lockfile edits or shadowing JavaScript siblings. Keep the checkout unchanged through execution. Use its real installed dependencies from the recorded lockfile and Node `v22.21.1` consistently.
2. **Environment:** use exactly `node --import tsx`. Keep `NODE_OPTIONS`, all `GIT_*`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_PATH`, all `TSX_*` and `ARC1_LOG_HTTP_DEBUG` unset; satisfy the existing TLS/diagnostic guards. Use the existing authorized private MARIAN/001 credentials for `https://a4h.marianzeis.de`. Do not print credential values or change permissions/configuration.
3. **Claims and baseline:** preserve `pr1142-native-declarative-v1` and all original receipts. The distinct `pr1142-native-declarative-recovery-v1` claim must not have been consumed. Immediately before invocation, obtain a fresh SM12 user-wide MARIAN/001 search across all tables with no argument filter, showing zero locks. Do not use SM12 lock deletion.
4. **Execution:** keep the host awake, retain output privately and permit no other activity on the fixture. Invoke exactly once:

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-recovery.ts --execute-reviewed-inactive-ddls-cleanup eb82bd99cd786e5b073b79cfd300ad3696465123
   ```

   The entry itself must pass its original-receipt, runtime/source, credential and fresh native receipt checks. Do not bypass a refusal. To stop, signal once and wait for own bounded cleanup.
5. **Post-run controls:** after exit, capture a fresh all-table suffix search for `*61EDD87470C55DB0*`, then clear the argument and capture a fresh user-wide MARIAN/001 all-table search.
6. **Pass definition:** require `failure: false`, `confirmedDeleted: true`, `cleanupConfirmed: true`, independent typed absence and clean inventory in the retained evidence, and zero locks in both post-run searches. Exit code alone is insufficient.
7. **Any other outcome:** preserve the consumed recovery claim and receipts, stop and inspect read-only. No rerun, claim deletion/renaming, source repair, activation, other-owner deletion or SM12 lock removal follows from this GO. Any later mutation requires its own review.

Any change to the reviewed bytes voids this execution verdict.

## Independently executed checks

Each check ran alone and completed with exit code 0:

| Check | Result |
|---|---|
| Initial snapshot verifier | Candidate matched; 4,623 files unchanged |
| Focused recovery driver, recovery entry, preflight and declarative qualification suites | 4 files, 109 tests passed, including both new echo regressions |
| `npm run typecheck` | All three TypeScript projects passed |
| `npm run check:sizes` | 988 source/test files and all 12 schema scenarios passed |
| Final snapshot verifier | Candidate matched; 4,623 files unchanged |

I did not repeat the entire unit suite for this narrow observation-only correction. The author reports 504 files/13,581 tests, build, lint, policy, strict docs and 59 historical scenarios passing at this candidate. Those broader results and remote CI are not independently verified by this follow-up. The prior review independently ran the complete older suite; it is not substituted for current-revision evidence.

## Limits and procedure

The first and last source actions were the supplied verifier. No source reads followed the final verification; this report is written outside the snapshot under explicit authorization.

No native entry, preflight, inspector, SAP/browser action, external-service request, credential read, install, manual Git operation, edit, delegation or mutant was performed. Approved offline checks loaded dependencies and wrote their normal ignored unit report. Installed third-party dependency bytes are not attested.

There were no command refusals or procedural deviations in this follow-up. Focused-test output was tool-truncated, but its completed final summary and exit code were observed. FEAT-93 was checked at the start and again before completion; its cleanup/native/PP/public gaps remain open until actual evidence resolves them.
