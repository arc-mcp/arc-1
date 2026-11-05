# PR #1142 at `909419f7`: review 18 follow-up and private group profile

## Verdict

**The development checkpoint is accepted, with 0 High, 1 Medium and 5 Low findings.** This is not whole-PR acceptance, and the PR stays draft.

- **Review 18:** all six findings are closed. Findings 2 and 4 below record gaps that remain near that work.
- **Group profile:** acceptable as private offline code. Close Finding 1 before any recorded-package qualification or admission.
- **Public function family:** still closed, and the private grant can't be supplied by a tool.
- **Snapshot:** the first and last checks both reported `909419f7…`, 4,816 files, `unchanged`.

I used review 18's severities: Medium is a missing control or wrong conclusion, and Low is an edge case or a test or doc gap.

## Findings

### 1. Medium: group-include activation never checks the include's own recording context

- **Where:** `src/handlers/write/pinned-activation.ts:132-134`, `:166`. Compare `src/handlers/write/pinned-source-context.ts:54`, `:103-106`. The test mock at `tests/unit/handlers/pinned-function-group-activation.test.ts:50` ignores the request URI.
- **Scenario:** in a recorded package, the include draft is locked in request R2, which isn't allowed, while `transportchecks` on the group URI reports allowed R1. The check passes and the group POST is sent. In the reverse case, the include is in allowed R1 and the group shows no lock, so the activation is wrongly refused.
- **Consequence:** this is the only path where the POST target differs from the object being claimed. The request allow-list (`src/adt/pinned-write-policy.ts:129`, `:165-170`) never sees that object. Local and `$TMP` packages are unaffected, and production can't reach this path. Whether SAP reports child locks on a group URI isn't in the evidence.
- **Fix:** for INCL, run `pinnedRecording` on both the child and the group, and require matching local/request results on every validation. Add rows that assert both `<URI>` bodies and refuse a foreign child request before POST.

### 2. Low: `activated` can be reported with no observed transition

- **Where:** `pinned-activation.ts:221-232`, `src/handlers/write/pinned-function-activation.ts:137-144`, `docs/research/2026-11-02-function-activation-review-followup.md:39`.
- **Include with no draft:** SAP returns `activationExecuted="false"`, and the pre-read is already active with no alternative, so every post-check passes trivially. The result still says `activated`, `activeSourceVerified: true` and `nativeMetadataVerified: true`.
- **What separates that case:** only `execution: 'generation'` and `previousNativeVersion: 'active'`, and no test references `previousNativeVersion`. The group mock always starts inactive (`:63`).
- **FUGR with `activationExecuted="true"`:** the result is `activated`, proved only by `?version=active`. In the receipts, the default, `?version=active` and `?version=inactive` reads share hash `3f92fa5c…` (`00174`, `00033`, `00054`), so that read doesn't discriminate.
- **Doc and test gap:** the doc says FUGR reports `generated`, and no handler row reaches this branch (`:81` hard-codes false).
- **Fix:** report `activated` for generation-only INCL only if the first capture showed `inactive` or an inactive alternative; otherwise report `generated` or `already-active`. For FUGR, add default-read proof or use a state that only relays SAP's flag. Update the doc and add rows.

### 3. Low: failed results omit the whole-group warning

- **Where:** `pinned-activation.ts:233-238` (warning on the normal result only), `:273-283` (catch path), rows at `pinned-function-group-activation.test.ts:154-178`. The doc claim is at `:41` of the follow-up.
- **Scenario:** generation succeeds and the include readback then returns 503. The result says to "inspect the selected owner", with no `scope` or whole-group warning. An uncertain POST failure has the same gap.
- **Consequence:** the caller checks one include, although the operation targeted the whole group.
- **Fix:** once a group POST has been submitted, add `scope` and the whole-group warning to failures, and add rows.

### 4. Low: some new rows can't detect a lost guard

- **Inactive alternative:** the `inactive-alternative` fault applies to both reads (`tests/unit/handlers/pinned-function-activation.test.ts:104-107`). Removing either `pinned-function-activation.ts:109` or `:117` stays green, and the link isn't in the hash.
- **Metadata hash:** `metadata-change` also hits both reads (`:99-103`), which hides removal of `current.hash` at `:109`.
- **Namespaces:** the namespaced row has no `objectstates` link, so `canonical()` at `src/adt/function-activation-metadata.ts:70` never sees lowercase `%2f`. A4H uses that form in a native container URI (`tests/fixtures/function-owners/a4h-758.json:52`).
- **Canonicalizer:** no test covers repeated-child order or the guards at `src/adt/native-xml-evidence.ts:72`, `:77`, `:94`, `:110`, `:115`. The doc does claim repeated-child order.
- **Group rows:**
  - There are no handler rows for namespaces, cancellation before confirmation, metadata drift, recording refusal or minimal errors.
  - `package-drift` (`:145`, mock `:58`) stops at the allow-list. FUNC's `drift-between-allowed` row does cover the shared line.
- **Fix:** split each fault so it affects one read only, and add these rows.

### 5. Low: canonicalizer CPU is not bounded

- **Where:** `native-xml-evidence.ts:26`, `:106`, against the size and depth guards at `:125`, `:72`.
- **Scenario:** a hostile or faulty 1 MiB response has about 32,000 namespace declarations on the root and about 130,000 empty children. Each child copies the whole binding map, giving roughly 4 billion synchronous insertions, likely minutes by my estimate (not measured). The deadline and abort signal can't interrupt it.
- **Consequence:** the event loop can stall. Normal native metadata is unaffected, with 3 root bindings and about 10 children in the fixture records. The threat model matches review 18's response-budget finding.
- **Fix:** reuse the inherited map unless the element declares bindings, cap the element count, and add a row.

### 6. Low: the earlier activation doc is superseded but has no pointer

- **Where:** `docs/research/2026-11-02-pinned-function-activation.md:4-5`, `:19-27`, `:36`, still linked from `docs/plans/2026-10-26-broader-pinned-pp-writes.md:37`.
- **Consequence:** it still describes the old proof and budget scope, says group profiles are separate, and says no independent review has occurred.
- **Fix:** add a superseded banner that links the follow-up.

## Review 18 disposition

| Finding | Status | Basis |
|---|---|---|
| Medium 1: metadata-only draft | **Closed** | Default and explicit active reads must be active, have no alternative and match the captured hash; source must also match (`pinned-function-activation.ts:108-120`). The no-draft label is Finding 2. |
| Medium 2: handler gate | **Closed** | Refusal at `pinned-activation.ts:106-110`. Only tests import the private entry. Direct, spoofed, dispatch and route rows exist. |
| Low 3: minimal errors | **Closed** | Carried from dispatch through `src/handlers/activate.ts:116` to `pinned-activation.ts:218` and `pinned-result.ts:92`. FUNC and PROG sentinel rows cover both settings. |
| Low 4: consumed README | **Closed** | Banner at `scripts/qualification/pr1142/README.md:200-203`, and the anchor resolves. No "stateless", "Candidate only" or "not executed" remains. |
| Low 5: fault and namespace tests | **Closed as listed** | All listed rows exist. `drift-between-allowed` reaches the stability guard. Finding 4 covers new masking. |
| Low 6: owner and lookup budgets | **Closed** | Parent, child and lookup reads have 1 MiB all-response budgets, and the rows reach the real stream cap. |

## Metadata canonicalizer

- **Values:** preserved exactly, including attribute whitespace. Only whitespace-only text between child elements is dropped.
- **Namespaces:** compared by expanded name. Aliases hash the same, and foreign look-alike fields stay in the hash.
- **Omissions:** limited to root core `version` and `changedAt`, ETags on the two known source links, and one exact owned `objectstates` link (`function-activation-metadata.ts:51-73`). The author's correction holds: nested fields stay in the hash, with rows proving it.
- **Bounds:** 1 MiB, no DOCTYPE, depth 64 and parser nesting 100 all hold. CPU is the gap in Finding 5.
- **Fixture:** all three body hashes match `00146`, `00164` and `00140`. I compared the raw bodies: only the sanitized fields differ from the fixture, and the records differ from each other only in `changedAt`, `version`, ETags and the `objectstates` link.

## Private group profile

| Area | Verdict | Basis |
|---|---|---|
| Exact group refs before both POSTs | **Holds** | `src/adt/devtools.ts:247-251`, `:282`; `pinned-activation.ts:146` |
| Shared orchestrator, no replay, deadline | **Holds** | `devtools.ts:233`; `src/adt/mutation-http.ts:49-63` |
| Package evidence | **Holds** | Fresh parent and child reads on each validation |
| Recording evidence | **Partial** | Group URI only, see Finding 1 |
| Generation semantics | **Holds** | The flag is accepted only for this profile (`devtools.ts:1097-1100`), which matches `docs/research/2026-11-02-native-function-protocol.md:95-100` |
| No implied module activation | **Holds** | FUGR makes no child claim, and the warning says modules aren't verified |
| Source, default and active proof | **Holds for INCL** | FUGR has identity and package only, see Finding 2 |
| Uncertainty | **Holds** | `activation-not-confirmed`, phase, no retry and preserved native result; see Finding 3 for the missing whole-group warning |
| Legacy, CLAS, INTF, PROG, INCL | **Holds** | Boolean parsing paths are unchanged, and the capability matrix and schemas aren't in the delta |
| Public admission | **Closed** | `src/server/pinned-mutation-capabilities.ts:109` lists only CLAS, INTF, PROG, INCL |

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,816 files |
| `npm exec -- vitest run --silent=true` | **Pass:** 490 of 490 files, 13,104 of 13,104 tests, 37.61 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios (20 + 22 + 17); these are historical and don't exercise the new profile |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 971 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,816 files; nothing read after it |

The unit and scenario counts match the author's. Build, lint, policy, strict docs and CI remain author-reported.

## Evidence limits

- **No native execution:** nothing here ran against SAP, and tests use mocks. The native5b run is not execution of this profile or PP.
- **Findings by reading:** ad hoc scripts were barred, so the Finding 4 masking is reasoned, not mutation-tested, and the Finding 5 cost is an unmeasured estimate.
- **Group includes:** the only native shapes are GET projections without Atom links, so ETag and `objectstates` handling on includes is unverified. No include draft has been observed through group generation. Group generation left a module draft inactive, and if includes behave the same, this path ends `activation-not-confirmed` after a whole-group generation.
- **FUGR flags:** record `00154` from `1bb2eb43` wasn't supplied. Only the protocol doc supports the generation-only flags and the test's "exact" body.
- **Metadata-only drafts:** no native receipt exists, so those rows are synthetic.
- **Two writers:** `changedBy` is in the hash and the receipts show one user. A different activating user might fail closed, which is safe but unobserved.
- **Budget scope:** package-hierarchy reads, `transportchecks` and standalone `readPinnedProgramOwner` (`src/adt/pinned-program-owner.ts:25`) remain deadline-only. The docs don't claim otherwise.
- **Historical receipts:** I checked only `00033`, `00054`, `00140`, `00146`, `00153`, `00164`, `00174` and the manifest hash of the committed review 18 copy (`e9011fbe…`).
- **Accepted unfinished scope:** fresh native and PP workflows, public admission, DDIC/CDS/SDO/RAP/batches, and management/CTS/trace/quickfix/FLP remain open, per the plan's readiness checklist.

## Execution deviations

- **Saved Vitest output:** at 2.3 MB it overflowed the display, so the harness saved it under `~/.claude/projects/…/tool-results/`. I only searched that file with `Grep`, as allowed.
- **Dependency reads:** I read parser files under `node_modules/fast-xml-parser`. The manifest lists 58 entries under that path, so they're snapshot files, not symlink targets. My first `Glob` of that path ran before I had checked the manifest.
- **Test side effects:** the suites produced their normal outputs, which I didn't inspect apart from that saved Vitest file. The closing check reports the snapshot unchanged.
- **Otherwise none:** Bash ran only the approved commands, one at a time in the foreground. There were no edits, report files, delegation, mutants, installs, or SAP, browser or other network activity.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.