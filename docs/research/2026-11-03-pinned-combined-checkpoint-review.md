# Combined integration checkpoint — passed within scope

Reviewed clean primary revision **`2d9ad8e46d624eaceac828b80dc7c9fdb989cc00`** in the immutable snapshot at `/Users/marianzeis/.local/state/arc1-review/pr1142-combined-integration-checkpoint-20261103-080300/source`, based on `49bdd6069`. First and final snapshot verification both passed: **4,811 files unchanged**. Manifest SHA-256: `dc741133a6b56766d13f7193073e8c1b879985d4fde638a4555cf810048b0549`.

No integration blocker was found. This is a bounded combined-code checkpoint, not whole-PR readiness, public-admission approval or a new native execution authorization. The full unit suite is deliberately deferred until the next public-admission integration. No production source, actual native phase, credentials or historical evidence was changed or invoked.

## Integration review

The supplied V5 component comparison is reproduced against the snapshot: all 24 listed current hashes match, covering the 23 unchanged code/test files plus the reviewed registry merge. For FLP, all nine implementation/test files outside its registry and README remain byte-identical to the earlier 11-file comparison. The README adds the V5 section and accurately records the previously completed review/preparation status at this frozen revision.

I independently compared the registry with the committed approved V5 and FLP versions. Relative to V5, its only nonblank addition is the approved `native-flp-cust.ts` → `pr1142-native-flp-cust-v1` entry. Relative to FLP, its only nonblank addition is the approved `native-declarative-v5.ts` → `pr1142-native-declarative-v5` entry. The entries remain exact and separate. Source binding, runtime restrictions, historical roots, one-time claims and admission logic are unchanged. The raw comparisons and README delta are retained alongside this report.

Combined tests exercise both native protocol drivers/coordinators against the newly shared HTTP budget/handoff code, including real loopback direct and Connectivity transport, no-replay, queue/auth/CSRF boundaries, effective deadlines, submitted-result uncertainty and owning cleanup. They also cover the integrated RAP BDEF link correction and parser boundaries, the empty-parent local package read/create path, FLP policies/readbacks, publication, batches and shared class/include lifecycles. Existing public capability and runtime-admission tests remain closed as expected.

## Completed checks

| Check | Result |
|---|---|
| Selected combined tests | **50 files / 2,069 passed / 1 intentionally skipped** |
| Historical synthetic formatter/delete/include regressions | **59 passed** |
| Source, scripts and tests TypeScript projects | All three passed |
| Full Biome check | Passed; three existing informational notices, no fixes |
| File-size and schema budgets | Passed |
| Action policy validation | Passed: 135 entries cover 14 tool schemas |
| Production build | Passed in a separate verified scratch copy |
| Strict MkDocs build | Passed in that scratch copy, output outside source |
| Final immutable verifier | 4,811 files unchanged |

The build copy contains all **2,920 tracked files**, verified against the snapshot before copying and again after build/docs. Source bytes remain identical; generated `dist` and the documentation site are outside the immutable review source. No dependency installation occurred.

The one excluded inherited unit test writes a copied native script tree into linked `node_modules`; it is excluded to protect the immutable review/dependency boundary, not reported as a pass. The selected suite otherwise includes all multiline parser/URI cases. Tests use temporary injected roots and synthetic native dependencies; their labels and success do not establish real SAP qualification.

## Isolation and retained harness incidents

Node `v22.21.1` was used explicitly. A process preload and explicit Vitest worker setup enforce the offline guard; all 50 files reported worker guard checkpoints. The guard allows actual loopback addresses, the inspected pure Undici lookup only after verifying every returned address is loopback, and TSX loader Unix IPC. It blocks external socket destinations and `.env` reads. Final counters show real loopback/mapped-loopback traffic, with **zero blocked external requests and zero `.env` attempts**. The Python documentation guard observed no network attempt.

The initial focused invocation passed 2,041 tests but its exclusion regex unintentionally skipped 28 multiline names in addition to the intended exclusion. I preserved that raw log/JSON, corrected the regex to include newlines, explicitly added worker guard setup and reran the same bounded 50-file selection successfully. This was a review-harness correction; production was unchanged.

The first guarded MkDocs launch failed before building because the external `sitecustomize` displaced Homebrew's package-path initialization. The final command explicitly includes the existing `/opt/homebrew/lib/python3.14/site-packages` path alongside the guard. It passed without installation or networking. Both logs are retained.

FEAT-93 and its named native, current-build two-writer PP, negative-route, public/schema and final acceptance gaps remain accurately open. No roadmap change is needed for this read-only checkpoint. Later public-admission changes require their own review and the planned full combined test run. Root's separately completed FLP native evidence will be audited independently; this checkpoint makes no claim about those actual outcomes.
