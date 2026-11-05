# Independent procedural/text review — NO-GO

Exact candidate: `80468edc979ce72f6df728d1e95c4683c9bfb682`; base `5aa7533d6bf71388318510abeae630483e33ba53`. This is **NO-GO for the proposed fixed native qualification source**, with one actionable P2. It is not native, PP, public-admission or merge approval. No procedural phase was invoked.

## F1 — P2: Enable post-create parent ownership validation before subsequent mutation

Location: `scripts/qualification/pr1142/native-procedural-driver.ts:94` and `181–195`.

`createdGroup` is declared `const ... = false` and never changes. Consequently the selected-parent GET and `contractIdentity(..., MARKER)` check before subsequent POST/PUT are unreachable. The production factories still enforce real identity/package policy, but those checks do not establish this experiment's exact fresh parent marker. The protocol therefore continues modifying the graph after that marker has changed.

Three independent tests change only the parent description/marker after initial capture, leaving the exact name, type, package and native shape valid. Changing it at `module-create` still submits one module collection POST; at `include-create` still submits one include collection POST; at `text-headings` still submits one headings PUT. Each continues through the later graph work and only stops at `group-delete`, where the complete baseline finally detects the drift. Historical child deletions are retained and parent cleanup is refused; this does not undo the earlier out-of-binding changes.

Restore a real post-create ownership state only after successful owned creation/receipt validation, and perform the intended selected-parent check before subsequent authorized changes. Preserve legacy behavior, separate owning cleanup, exact source/identity checks and existing refusal semantics. The original marker must not be refreshed from a drifting parent. Re-run all three unchanged external cases; no selected POST/PUT may occur after their marker drift.

Evidence: `codex-independent.test.ts`, `codex-probes.log`, and `codex-parent-{module-create,include-create,text-headings}-result.json` (full synthetic actual-dispatch calls/results/records). Final run: **3 failing finding cases / 6 passing controls**. The final harness preserves the real composed attempt-budget dispatcher, with MockAgent beneath it; these are synthetic regressions, not native observations.

## C1 — Test/provenance correction

`tests/unit/scripts/pr1142-native-procedural.test.ts:215–216` replaces `init.dispatcher` with MockAgent at the fetch boundary. That also replaces `fetchWithAttemptBudget`'s composed final-send validator, attempt charging and no-replay wrapper. Passing committed mock tests alone therefore cannot substantiate the claimed actual final synchronous dispatch proof. Bind Agent/global selection to MockAgent underneath the real wrapper and forward `init` unchanged. The final independent harness does this and demonstrates the narrower 30-second deadline crossing is correctly refused before CREATE. **No production deadline defect is claimed.** This correction should accompany the author regression so it actually exercises the boundary it describes.

## Scope assessed and passing checks

- Fixed FUGR → normal FUNC plus structural INCL graph; real private context factories, shared source/create/delete lifecycle and entry policy injection. No generated child receives independent DELETE authority.
- Native signature proof accepts identifier/type casing while preserving the mixed-case default literal and body; FORM surgery preserves the sibling; group generation is checked separately from selected function activation.
- The active function and pending signature draft are checked through each whole text-part workflow. Native inactive/active part checks and post-activation pool checks preserve the documented pending-part distinction. Nonempty FUGR selections and other owner text variants remain explicit gaps.
- Entry claims and intent/prerequisite chronology, private runtime/config injection, real JPEG schema checks, no-reset/no-replay and final history checks were inspected. Source/revision/runtime binding remains separate from operator inspection of actual SM12 searches.
- Final independent positive graph, submitted-save uncertainty, own cleanup uncertainty, literal drift, late generated-source drift/parent-delete refusal, and final synchronous 30-second deadline refusal all pass.
- Committed protocol suite: **31/31 pass**. Additional unchanged shared function activation and text-pool suites: **144/144 pass**. No unrelated whole-suite run.
- All three TypeScript projects, repository lint, policy validation and size budgets pass. Their exact commands and exit results are in `codex-static-checks.json`; focused logs/check JSON are retained separately.

## Isolation, incidents and immutable provenance

I did not author this procedural/text delta or its committed tests. I previously authored/reviewed adjacent native qualification and shared adapter work; this report is an independent review of the stated delta and its used boundaries.

The archive was made from the explicit preserved commit, not the original checkout's newer HEAD. Its package-lock bytes matched the available dependency runtime. It has independent local Git metadata and the standard dependency links/copies. Original procedural and frozen CTS checkouts were not changed. First and final verifiers both report **4,924 files unchanged**; the final verifier was the last source action. The supplied author report (`24dbf8e8…cdb`) and author `result.json` ledger (`26a38a4f…92a`) hashes match. The additional `source-files-final.json` is a different file/hash, recorded accurately in `codex-input-ledger.json`. All six bound input files retain hash, size, mode, uid and gid.

Both startup and worker guards blocked network/DNS and `.env` reads; Vite used `envDir:false` and external cache. No credentials, SAP/browser/cloud calls, installation, source edits, real qualification roots/claims or native execution occurred. Author initial compile/mock/import and signature-case failure history remains unchanged in its report and logs.

Reviewer incident retained: the first external harness inherited the author's dispatcher replacement, producing an invalid apparent deadline failure (not a finding). After preserving the real wrapper, its first incomplete Agent confinement reached the inherited long-operation Agent and triggered **five guard-blocked synthetic TCP attempts**; none connected and no `.env` read occurred. `codex-probes-wrapper-agent-incident.log` and guard ledgers preserve that run. The final external helper confines Agent beneath the wrapper and explicitly rejects unexpected Connectivity Client construction; the final nine-case run records **zero network/env attempts**. Earlier external harness versions/logs remain retained. No claim of zero attempts across the entire review is made. Two harmless inspection commands used unmatched filename globs; they did not modify source or serve as evidence.

## Disposition and limits

Author correction plus independent re-review of F1/C1 is required before the root operator separately considers the fixed native prerequisites. These mocks do not establish actual SAP fixture shapes, completed cleanup, PP identity, recorded-object workflows, or any broader native release/platform support. Source/code review cannot replace fresh operator concurrency and actual visual SM12 controls.
