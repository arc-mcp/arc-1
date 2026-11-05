# Independent renewed native phase verdict

Candidate: **`a0681f531efc452edaf8fca0777cfce0d0312ef6`**.
Comparison base: previously approved `a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`.
Reviewer: Codex, independent of the v2 harness and the literal-matcher correction.

**No actionable correctness or security finding in the reviewed delta. Private integration: GO for this narrow correction. The three native phase verdicts below are bounded GO, subject to their actual prerequisites.** This does not mean the experiment has run or passed.

The only approved real execution checkout is
**`/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`**, branch
**`codex/native-declarative-v2-qualification`**, clean and frozen at the exact candidate above.
The immutable review snapshot is not an execution checkout. Approval does not transfer to main,
another checkout, a later revision or altered runtime/configuration/dependencies. Other work may
be integrated elsewhere without changing this frozen execution checkout or its runtime inputs.

| Phase | Verdict and bound |
| --- | --- |
| Permanent offline intent preparation | **GO once**, using the fixed v2 entry and exact revision in the named checkout. The fixed v2 root must not already exist. Inspect the resulting saved six-owner intent before proceeding. This phase is local-only and must not load credentials. |
| Fixed GET-only preflight | **GO** after the genuine saved intent exists and has been inspected, in the same checkout/runtime. Only the six fixed owners and inactive inventory are sampled. Retain the actual emitted preflight ID, full result and receipts. A failed sample is not proof; any separately authorized refresh is another retained sample, with no overwrite or sentinel reset. |
| One six-owner native lifecycle | **GO for exactly one attempt**, only after the actual successful fresh preflight and both genuinely inspected complete zero-lock SM12 proofs below. Scope is direct HTTPS **Basic-native A4H/001, MARIAN, `$TMP`**, with the fixed v2 sources, identities and dependency graph. No additional owner, target, phase or repair is authorized. |

The parent reports no real v2 root, intent, preflight, attempt claim or credential load has run.
I did not independently inspect private operational state or configuration, and created no real
intent, ID, timestamp, screenshot, hash of operational evidence, fixture or native result.

## Delta and independent evidence

I compared actual file bytes for the union of **2,745 tracked paths** in this snapshot and review2:
**2,739 unchanged**, with exactly the six disclosed code/test/documentation changes. The explicit
relevant-file list contains **93 unchanged native-script, adapter, HTTP/mutation, instruction,
configuration/lockfile and protocol paths**. Details are retained in
`independent-source-comparison.json`. The committed raw review2 report is byte-identical to the
previous independent report.

The production delta is confined to `pinned-metadata-projection.ts`. The literal matcher requires
the exact path prefix, optionally consumes one decimal repetition index, and accepts only the end
or the existing child/attribute/presence boundaries. Prefix siblings and malformed repeated-index
boundaries remain outside the selection. Namespace identities are literal strings, never hostname
authorization expressions. Unknown expanded namespaces remain in projected metadata/hashes and
cannot be admitted by the native field-selection gate merely because their local names resemble
selected fields. Static RegExp selectors remain compatible through their existing `test(path)` API;
there is no caller-selectable matcher or new public input.

An independent probe exercised **592 old/new matcher comparisons**, actual native-XML projection,
repeated selected values, unrequested sibling/foreign-child preservation and saved-field checks.
It found **no selection differences** in that corpus and verified refusal of terminal LF/CR/CRLF/
Unicode line separators after an exact path or indexed path. Thus the new explicit end test
preserves the required refusal; this review does **not** establish that the old JavaScript regex
accepted those trailing line breaks. The change is supported as literal equivalence/clarity,
not remediation of a demonstrated hostname or newline exploit. Fresh CodeQL results remain
separate; I did not dismiss alerts or issue a blanket security verdict.

The dotenv change is confined to the unit helper test. Vitest's hoisted `vi.mock('dotenv', ...)`
provides a no-op `config` before importing the integration helper, with file isolation enabled.
The real helper and native credential loader are unchanged. The three helper cases passed in the
focused run, which emitted no dotenv-load or external DNS messages. No `.env` was read in this review.

Checks used Node **22.21.1**, existing dependencies, mocks/injected execution edges and temporary
test state. No source edit, install, manual Git operation, browser, SAP/network request, credential
access or native CLI/preparation/preflight invocation was performed. All new review artifacts
are outside `source`, using the separate `independent-` log/probe prefix.

| Independent check | Result / artifact |
| --- | --- |
| First snapshot verification | Exact revision; **4,636 files unchanged** (initial tool result) |
| Source byte comparison | 2,745 tracked paths; disclosed delta only; `independent-source-comparison.json` |
| Focused affected DDIC/projection/helper and actual native driver/entry/workflow/evidence/runtime tests | **13 files / 563 tests passed**; `independent-focused.log` |
| Independent matcher/preservation probe | **592 comparisons**, preservation/readback and static-RegExp checks passed; `independent-matcher-probe.mjs` and `.log` |
| All three TypeScript projects | Passed; `independent-typecheck.log` |
| Changed TypeScript lint | Passed without fixes; `independent-delta-lint.log` |
| **Final source action: snapshot verifier** | **4,636 files unchanged**; `independent-snapshot-final.log` |

I did not automatically repeat the complete suite/build/docs/policy/budgets. Review2's independent
full checks apply only as historical evidence for its byte-identical relevant files; this packet's
author separately reports current-source **524 files / 14,648 tests** and all static/build/docs gates.
The current independent focused tests and typechecking above cover the actual delta and native
consumers. No source action followed the final verifier; this report was written outside afterward.

## Reused native review, explicitly limited to unchanged paths

I reread the current v2 entry, runner, observer, driver, binding, prerequisite reader and protocol.
The prior independent detailed review remains applicable to the byte-identical fixed fixture graph,
request/transport fence, owned receipt and child-absence deletion guards, source/index/shadow/lockfile
checks, workflow, private declarative activation, typed absence, stop/no-replay rules and recovery
history. The changed metadata projection is used by DDIC metadata profiles; it does not replace
the fixed five-family declarative source/evidence contracts. Both the affected DDIC tests and real
v1/v2 driver lifecycle tests passed here.

The earlier R1–R3 corrections remain present and exercised: request/source validation repeats
after awaited owner/child deletion checks and immediately before dispatch; composite evidence
binding repeats after independent final absence before confirmation; every defined HTTP-debug
value is refused. Validated own unlock and bounded owning-session close remain available on drift.
No deadline/attempt budget is renewed and no claim or mutation is replayed. This review does not
re-authorize any consumed v1, recovery or other historical command.

## Required operating conditions

Use Node **22.21.1** and exactly `node --import tsx` in the named frozen checkout. Keep all reviewed
runtime exclusions: no `NODE_OPTIONS`, `GIT_*`, HTTP debug, extra trust-root/module/TSX overrides or
unsafe diagnostics; TLS verification remains enabled. Existing real dependencies and ignored
configuration must not be changed. The source/lockfile checks are mandatory; installed third-party
dependency bytes remain an explicit attestation limitation. Do not commit this report into the
execution checkout during the phase chain.

The preparation and preflight flags are respectively `--prepare-reviewed-declarative-v2` and
`--preflight-reviewed-declarative-v2`, on `scripts/qualification/pr1142/native-declarative-v2.ts`,
with the full candidate SHA above. Execution uses `--execute-reviewed-declarative-v2`, that same
SHA and **the actual ID emitted by the successful approved preflight**. No example operational ID
is supplied. Do not invoke the attempt merely to test prerequisites: its exclusive claim is consumed
before prerequisite/credential loading, including on configuration refusal or interruption.

After the complete successful preflight, inspect and retain both real SM12 searches:

- Client **001**, all tables **`*`**, all users **`*`**, argument **`*<actual saved intent suffix>*`**:
  complete result showing **zero locks**.
- Client **001**, all tables **`*`**, user **MARIAN**, all arguments **`*`**:
  complete result showing **zero locks**.

The actual unmodified PNGs and protocol-shaped baseline must be private regular files in the
selected sample directory, with hashes calculated from those real files and genuine observation
times. Both captures must follow preflight completion. The full preflight and both captures must
remain no more than five minutes old through the first mutation. The harness checks structure,
identity/filter/count assertions, freshness, signatures and hashes; it cannot interpret the PNGs.
An operator/reviewer must inspect their visible contents. An old image, session refresh, failed
search or partial receipt is insufficient.

Use an appropriate idle SAP CI window and keep unrelated MARIAN writers/fixture activity out of
the experiment and its post-controls; keep the host awake. The fixed sequence completes create,
activate, comment update and activate for view DDLS, abstract DDLS, DCLS, DDLX, abstract BDEF and
SRVD, then deletes in reverse dependency order. It does not create a behavior implementation
class, SRVB/publication, table data, helper or execution endpoint, and makes no BTP/destination/
permission change. Native compilation and metadata variants remain unknown until actually observed.

After exit, inspect all receipts and take fresh external suffix and MARIAN-wide zero-lock controls.
A pass needs all six completed owners, confirmed reverse deletions, workflow and independent typed
absence/inventory evidence, confirmed owning-session cleanup and both controls. Preserve failures,
remaining resources and uncertainty. No source repair, repeated activation, forced DELETE, foreign
cleanup, SM12 lock deletion, claim removal/rename or second v2 attempt is approved; further cleanup
requires a separate exact-scope review.

This verdict is only for the reviewed **Basic-native A4H/001 MARIAN `$TMP` phase chain** and the
narrow private code correction. It is **not PP qualification, public capability/read-profile
admission, deployment approval or a whole-PR merge verdict**.
