# Literal matcher review and native-v2 source comparison

Candidate: **`a0681f531efc452edaf8fca0777cfce0d0312ef6`**. Comparison base: **`a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`**.

**Private integration: GO for the literal-matcher delta. No actionable functional finding.** The five-line dotenv isolation change also passes its regression checks; root separately inspected and accepted that change before cherry-picking it.

**Authorship and limits:** this reviewer did not author the literal-matcher implementation/tests. I did author the original v2 implementation and the dotenv isolation change, so those portions are self-review/source comparison, not independent review. Per root's clarified instruction, **this report does not renew native execution authorization**. An independent reviewer who did not author v2 must give the final phase verdict. This is ordinary functional/native-source review, not a delegated security triage or blanket security approval. Codex fallback follows the confirmed Claude limit.

## Matcher assessment

The helper compares the entire literal prefix, removes at most one leading decimal index, and then requires exact end or a native path/attribute/presence delimiter. Prefix siblings, malformed or nested indices, signed/fractional indices and an extra local-name suffix stay outside the selected subtree. Exact repeated descendants remain inside it. The old regular expression's end anchor could match before a final line terminator; the new empty-string check deliberately rejects that exact-root case, including CR/LF and Unicode line separators. This tightening is retained.

Namespace aliases still use exact map keys. Unknown namespaces remain expanded identities, retain presence/value evidence and participate in hashes. The actual Atom link exclusion cannot swallow a lookalike namespace or prefix sibling. `matches` continues protecting extension-namespace fields even inside a caller-selected native subtree. Both change authorization and saved-field verification retain those unknown values; they do not merely preserve the metadata hash while permitting its loss during rebuild.

The structural `MetadataMatcher.test(path)` interface remains compatible with the existing static RegExp selectors. All consumers use `.test`; no source consumer depends on a dynamically generated RegExp's `.source`, captures or identity. The unchanged TTYP-derived RegExp and native metadata adapters typecheck and their tests pass. The pre-existing dynamic expression escaped regex metacharacters; this review does not recast the change as remediation of an established hostname-authorization vulnerability. The author records completed static CodeQL triage separately; fresh CI/CodeQL results are not supplied by this review.

The hoisted file-local dotenv mock prevents the unit helper import from executing the real configuration loader. Production dotenv behavior is untouched. Its three fixture tests passed within the focused matrix; the log contains no dotenv-load, `getaddrinfo` or `ENOTFOUND` messages. This check is disclosed as self-review for that tiny authored delta, supplemented by root's prior inspection.

## Unchanged native implementation and prior evidence

I verified the earlier immutable review2 snapshot at `a3a6ef55`: **4,634 files unchanged**, before and after comparison. A byte comparison of **440 files** under `src`, `scripts/qualification/pr1142`, plus instructions, package/lockfile and the three TS configurations found exactly one changed file: `src/adt/pinned-metadata-projection.ts`. This comparison includes the `.mjs` runtime/state helpers, not just TypeScript. All native entry, intent/prerequisite, observer, driver, transport, fixture-source, workflow, source binding and runner files are unchanged.

The newly committed raw review2 is byte-identical to the prior external verdict: SHA-256 **`c95499f0558c3ad736cd31f52069e0c20b33c217b22b84cd432e74088634b6b6`**. The preceding detailed review1 text has the expected SHA-256 **`6dd8cf4cb6320dca4b74f77c9e06e6287f1aa2e40ca483b8bdac46ff95c46679`**. I reuse that prior independent review specifically for unchanged code, not as automatic approval of the new SHA or checkout.

I reread the fixed v2 phase entry, intent/prerequisite validation, source-binding helper and protocol, and rechecked the three prior corrections in their current locations: request revalidation after awaited deletion guards, composite binding validation after independent final-absence reads, and rejection of every defined HTTP-debug override. The request/deletion/own-cleanup exceptions and no-repeat claim are retained. The new projection matcher is consumed by DDIC metadata code; it changes no native-v2 fixture, URI fence, phase, runtime condition or public admission.

## Phase-chain assessment — non-independent, not authorization

The proposed execution checkout is **`/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`**, branch **`codex/native-declarative-v2-qualification`**, at the exact candidate above. This is a new checkout binding; approval for main is not transferable. I did not invoke its binding helper, inspect its ignored configuration, or run a real phase. Root reports it is clean/frozen with existing real dependencies and no actual v2 state/intent/preflight/attempt. Those real prerequisites must be checked before execution, with the native runtime/source gates remaining authoritative.

| Phase | Technical assessment for the independent reviewer |
| --- | --- |
| Permanent offline preparation | No new blocker found. Subject to final independent GO, use the fixed prepare entry once in the named clean checkout. The fixed state root must not already exist. This creates and binds the actual six-owner intent without loading credentials. Inspect the saved sources/names and binding before proceeding. |
| Fixed GET-only preflight | No new blocker found. Subject to separate final GO and the inspected prepared intent, sample only the six saved owners plus inactive inventory. Retain the actual successful preflight ID and all receipts. Existing 60-second outer and bounded per-request rules remain. Failed samples are not proof; preserve every sample and running sentinel. |
| One six-owner native lifecycle | No new blocker found from this delta/comparison, but **no native GO is issued here**. Final independent approval must bind the candidate, checkout and actual complete fresh prerequisites. Exactly one direct Basic-native A4H/001 MARIAN `$TMP` attempt; no other owner, source, target, profile or subsequent attempt. |

The following conditions remain necessary for any eventual independent GO:

- Node **22.21.1**, exactly `node --import tsx`, the reviewed real dependencies, TLS verification and all documented exclusions for `NODE_OPTIONS`, `GIT_*`, HTTP debugging, trust-root/module/TSX overrides and unsafe diagnostics. Source/index/shadow/lockfile gates must pass without bypass. Installed third-party dependency bytes remain unattested by the lockfile check. Keep the dedicated checkout frozen throughout; main may advance independently.
- The actual successful complete preflight and both real, unmodified, externally inspected SM12 PNGs must exist. After preflight completion: client `001`, table `*`, all users `*`, suffix argument `*<actual intent suffix>*`; and client `001`, table `*`, user `MARIAN`, all arguments `*`. Both must show zero locks. Their complete filters, contents, timestamps, owner-only files and actual calculated digests must agree with the saved intent/baseline. The harness validates bytes/fields, not screenshot meaning. All prerequisite times remain within five minutes through the first mutation.
- Do not invoke execute to discover a missing prerequisite: the exclusive attempt claim is consumed before prerequisite or credential loading. No invented suffix, ID, time, digest, image or native observation is provided by this report. No real command was run.
- Preserve the six-owner graph: view DDLS, separate abstract DDLS, DCLS, DDLX, abstract BDEF and SRVD; fixed create/activate/comment-update/activate sequence and reverse dependency deletion. No implementation class, service binding/publication, helper, table data, permission/configuration change, source repair or foreign cleanup. Native syntax/metadata uncertainty is a failed/stopped experiment, not authorization to fix and retry.
- Require an appropriate SAP CI idle window, an awake host and no concurrent fixture/checkout work. Afterwards, inspect receipts and repeat fresh external suffix and MARIAN-wide SM12 controls. A pass requires all owners completed, confirmed reverse deletions, workflow and independent typed absence/inventory proof, confirmed owning cleanup and both zero-lock controls. Preserve uncertainty or remaining resources for a separately reviewed cleanup; never delete locks, reset claims or replay consumed v1/recovery/v2 commands.

These are retained technical constraints for the final reviewer. They do not constitute PP qualification, public admission, deployment permission or whole-PR merge readiness.

## Actual checks

All commands used the immutable snapshot and existing dependencies with explicit Node 22.21.1 PATH. No source edit, install, manual Git operation, SAP/network/credential/browser action, real prepare/preflight/native CLI or delegation occurred. Tests used their mocked/injected edges and temporary test state. Logs and the independently written pure matcher probe are outside `source`.

| Check | Result |
| --- | --- |
| First candidate verifier | Exact `a0681f53`, **4,636 files unchanged** |
| Focused projection/DDIC/real-driver/workflow/fixtures/v2-entry/legacy-entry/binding/helper tests | **12 files / 473 tests passed** (`codex-focused.log`) |
| Additional pure matcher/preservation probe | **71 assertions passed**, including metacharacter literals, malformed indices, CR/LF/Unicode end boundaries, RegExp compatibility and unknown-namespace change/readback refusal (`codex-matcher-probe.mts`, `.log`) |
| All three TypeScript projects | Passed (`codex-typecheck.log`) |
| Changed-file Biome check | 3 files passed, no fixes (`codex-lint.log`) |
| Prior snapshot final verifier | `a3a6ef55`, **4,634 files unchanged** |
| **Final candidate source action: verifier** | Exact `a0681f53`, **4,636 files unchanged** |

The author reports a full suite of 524 files / 14,648 tests plus build, full lint, policy, sizes and strict docs. I did not repeat those broader checks for this narrow delta after the focused matrix and all-project typecheck passed. The historical 59-scenario harness was not rerun; the relevant implementation files are byte-identical and prior independent evidence is explicitly retained. Final CI remains separate.

No source action followed the final verifier. This report was written outside the snapshot afterwards. Final native phase authorization remains pending the independent reviewer requested by root.
