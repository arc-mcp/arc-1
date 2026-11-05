# PR #1142 at `63303383`: review 21 closures and disposable fixture preparation

## Verdict
**The development checkpoint is accepted, with 0 High, 0 Medium and 5 new Low findings.** This is not a whole-PR readiness claim.

- **Review 21:** all three findings are closed.
- **Fixture preparation:** it is data and a closure helper only. Only its test imports it, it has no runner, and `test:qualification:pr1142` doesn't call it.
- **Public surface:** the function and declarative mutation families are still closed. The delta changes two `src` files and no dispatch, schema, `src/server`, Git or plugin file, so Aggregate, Basic, Copilot and read-only gain no mutation route.
- **Unfinished, per the plan's readiness table:** native qualification, public admission, the remaining accepted families, current two-writer PP and recording transports.
- **Snapshot:** the first and last checks both reported `63303383…`, 4,542 files, `unchanged`.

## Findings

### 1. Low: no declarative row covers the saved-draft shape seen natively on FUNC
- **Where:** `src/handlers/write/pinned-declarative-activation.ts:51`; `tests/unit/handlers/pinned-declarative-activation.test.ts:49-50`, `:408-414`.
- **Evidence:** FUNC's default read with a draft returned `version="inactive"` with a `?version=active` link (`tests/fixtures/function-owners/activation-default-states.json:7`, record `00146`). The new row's `active` plus `?version=inactive` shape matches FUNC's explicit active read (`:17`, record `00140`; `docs/research/broader-pinned-pp-writes/claude-function-activation-review-20261102.md:27-29`).
- **Scenario:** removing the `?version=active` branch at `:51` leaves the suite green, because `duplicate-alternative` is refused either way. I reasoned this and ran no mutant.
- **Consequence:** if CDS/RAP behaves like FUNC, ordinary edits would be refused at capture and only a native run would show it. This fails closed, with no false success.
- **Remedy:** keep the new row and add a row for each of the five types: capture `inactive` with a `?version=active` link, expecting `activated`, `previousNativeVersion: 'inactive'` and two POSTs.

### 2. Low: the recording comparison has no public row with a recorded owner
- **Where:** `src/handlers/write/pinned-activation.ts:212-214`.
- **Gap:**
  - Public activation rows run local: `tests/unit/handlers/pinned-writes.test.ts:404-475`, `:786-809`.
  - `tests/unit/handlers/pinned-program-activation.test.ts:55-58` is local only, and `tests/unit/handlers/pinned-text-pool.test.ts:130` returns no lock.
  - Recorded rows that reach this comparison are all private.
- **Scenario:** a change that wrongly refuses a stable recorded CLAS, or skips the comparison on public routes, keeps the suite green.
- **Consequence:** by reading, I found no regression today (see the regression check below). The guard is still live on a public route with no direct proof.
- **Remedy:**
  - Add public CLAS and PROG rows: a stable recorded request over the prompt succeeds with two POSTs, and a move between two allowed requests stops after one POST.
  - Add one private `group-unlocked` row where the child moves between allowed requests. The existing `recording-drift` row stops on the allow-list instead (`tests/unit/handlers/pinned-function-group-activation.test.ts:63`, `:268-276`).

### 3. Low: three of the four dependency edges aren't pinned by a test
- **Where:** `tests/unit/adt/native-declarative-fixtures.test.ts:19`, `:45-50`; `scripts/qualification/pr1142/native-declarative-fixtures.ts:49`, `:58`, `:63`.
- **Scenario:** the `every` check passes on an empty list, and the closure row exercises only DCLS. Removing the DDLX, BDEF or SRVD dependency leaves all 15 tests green.
- **Consequence:** the closure would miss that base, so a future runner could delete it under an uncertain child. The data is correct today and no runner exists.
- **Remedy:** assert the exact edge map, or derive the referenced fixture names from each source and compare them with `dependencies`.

### 4. Low: "deterministic preflight" means little for four of the six sources
- **Where:** `tests/unit/adt/native-declarative-fixtures.test.ts:26-38`; `src/adt/rap-preflight.ts:54-69`; `docs/research/2026-11-02-pinned-declarative-sources.md:135-136`.
- **Scenario:**
  - DCLS and SRVD hit `default: break`, so those rows can't fail.
  - BDEF and DDLX get narrow pattern rules, not grammar checks.
  - Only the two DDLS rows reach a parser, because the lint gate covers only that declarative type (`src/handlers/write-helpers.ts:1230-1236`).
  - `updatedSource` is never preflighted.
- **Consequence:** a malformed DCLS, SRVD or BDEF stays green until SAP compiles it. This is not a safety gap, and the doc does say the sources are uncompiled, but "preflight" reads stronger than it is.
- **Remedy:** state these limits in the doc, run `updatedSource` through the same rows, and assert each fixture's expected declaration and target.

### 5. Low: one test count is still unlabelled
- **Where:** `docs/research/2026-11-02-pinned-declarative-sources.md:91`.
- **Scenario:** line 83 gained "At `70d4e83b`", but "494 files / 13,301 unit tests" has no checkpoint, and the current count is 495 / 13,332.
- **Consequence:** it can be read as current. Review 20 Low 5 was the same kind of issue.
- **Remedy:** label it with its checkpoint.

## Review 21 closure

| Item | Status | Basis |
|---|---|---|
| `already-active`, five CDS/RAP types | **Closed** | `pinned-declarative-activation.ts:118-120`, `pinned-activation.ts:300-302`; five rows at `:397-407` |
| `already-active`, FUNC | **Closed** | `pinned-activation.ts:301`; row at `tests/unit/handlers/pinned-function-activation.test.ts:429-443`. FUGR stays excluded by the outer branch, and the INCL rows still pass |
| Captured draft over active stays `activated` | **Closed as requested** | Five rows at `:408-414`. The FUNC saved-draft shape asserts `activated` at `pinned-function-activation.test.ts:389-413`, and the shared alternative check has an INCL row at `pinned-function-group-activation.test.ts:373-378`. See Finding 1 |
| Missing or unknown version | **Closed** | Rows at `:415-422` assert zero POSTs, which tells the guard at `pinned-declarative-activation.ts:41-42` apart from the later check |
| Unexpected or duplicate state link | **Closed** | Same rows; guard at `:49-53` |
| Exact budget evidence | **Closed** | The spy has no replacement implementation. `mockResponse` sets no content length, so failures come from streaming `reserve` (`src/adt/bounded-response.ts:99`, `src/adt/data-result-context.ts:46-50`). The rows also exclude the XML refusal (`src/adt/native-xml-evidence.ts:135`), a 503 status and the source-mismatch message |
| Recording stability | **Closed** | `pinned-activation.ts:212-214`; two-allowed-requests row at `:423-433` asserts the message and one POST |
| Reference wording | **Closed** | The doc's `:66-67` now matches `pinned-declarative-activation.ts:82-90`. Absent type and deleted fields run on every first pass (`src/adt/devtools.ts:252`) |

A locality flip has no row of its own. It still can't pass, because `pinnedRecording` returns either `{local: true}` with no request or `{local: false}` with one (`src/adt/pinned-write-policy.ts:161`, `:178`), so the request comparison catches it.

## Regression check on the recording comparison and labels

| Family | Result | Basis |
|---|---|---|
| CLAS, INTF, PROG, INCL | **No regression found by reading** | The labels still resolve to `activated`, since `declarative` and `functionOwner` are undefined. The owner URI is the same on both passes, and the compared `request.id` is the parent request, so a task or parent spelling can't cause a false refusal. Local two-pass rows pass. See Finding 2 |
| FUNC | **No regression found by reading** | Only the label changed for existing cases. Its mock is local only (`pinned-function-activation.test.ts:76-80`), so the recording comparison runs there without a recorded owner |
| Group INCL | **No regression found** | The stable recorded row keeps `[include, group, include, group]` (`pinned-function-group-activation.test.ts:259-267`), and the unlocked-group row passes (`:252-258`). If a locked group's child moves, `src/adt/pinned-write-policy.ts:171` refuses it first |
| FUGR | **No regression found by reading** | The labels are unchanged, and the positive recorded group rows use INCL. FUGR has only the same stable-owner reasoning |

## CodeQL literal
The literal is the same string the old expression produced: `/sap/bc/adt/functions/groups/%252Fns%2Fzgroup/fmodules/%2Fns%2Fzfunc`. `canonical` doesn't touch `%252F`, so it is still rejected as intended. This is a test-only rewrite, not a runtime security fix, and no CI evidence for this revision was available, so the alert is not shown as cleared. No first-occurrence `%2F` replacement remains outside `review-input`, but I can't predict CodeQL's verdict on the other `.replace` calls.

## Fixture review
- **Order:** view, abstract entity, DCLS, DDLX, BDEF, SRVD. Every dependency comes first.
- **Preservation closure:** it runs from child to base only, which is the right direction. A preserved child keeps its base, and siblings stay eligible. Unknown owners throw.
- **Constraints:**
  - Six fresh `$TMP` resources with 25-character names, within the 30-character limit.
  - Updates differ only by a comment, and the BDEF has no implementation class.
  - The SRVD has no binding or publication, and nothing writes table data.
- **Tests:** 15, made up of 1 + 6 + 6 + 1 + 1.

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged:** 4,542 files |
| `npm exec -- vitest run --silent=true` | **Pass:** 495 of 495 files, 13,332 of 13,332 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios, none of which exercise these profiles |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 979 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged:** 4,542 files; nothing read after it |

The counts add up: 31 new tests (15 fixture, 15 declarative, 1 FUNC), the private suite has 85 cases, and the prior review's hash `49b0d8b1…` matches the manifest.

## Evidence limits
- **Nothing here touched SAP:** I did not open or run `probe.mts`, and this review proposes no live experiment.
- **Fixture sources:**
  - Compilation and mutation on A4H are unproven, including the abstract BDEF clauses and the keyless root abstract entity.
  - I couldn't open the SAP links, because network access was barred.
  - The test's `758` matches the parser marker in `review-input/declarative-read-contract/BDEF.json:18`, but the cited docs are the `latest` index.
- **`already-active`:**
  - No native receipt exists for this label on these types.
  - An already-active owner on 758 previously returned no positive execution evidence (`docs_page/multi-target-writes.md:261-263`), so this label may not be reached there.
  - If a draft over active ever appeared as `active` with no link, the label would understate a real activation. The source check would still hold.
- **State links:**
  - None has been observed on the five types. The BDEF's own links use `./<name>/source/main`, so an exact-string guard might refuse a BDEF draft. That would fail closed.
  - FUNC's metadata hash omits version and state link (`src/adt/function-activation-metadata.ts:50-52`). A same-byte draft created during preaudit would be labelled from the first capture, with active content unchanged.
- **Reasoned, not run:** the "stays green" claims and the seven pre-fix failures. The seven fit the diff (five labels, FUNC, recording), but I didn't rerun them.
- **Author-reported only:** build, lint, policy, strict docs, CI status (including `70d4e83b` integration) and native fixture absence.

## Execution deviations
- **Refused read:** I mistyped one `Read` path without `/source`. The harness refused it and returned no content, and I then read the correct file.
- **Saved Vitest output:** at 2.3 MB it went to `~/.claude/projects/…/tool-results/bezhkf4l9.txt`, and I only searched it. The first search pattern was too broad and returned log lines, so I narrowed it.
- **Check order:** the checks ran one at a time in separate batches. The Vitest searches came before the next check, and the other reads followed the last check but came before the final snapshot check.
- **Historical receipts:** I read only `DCLS.json` and `BDEF.json` from the read contract, for inspection. I didn't re-review the group evidence.
- **Dependencies:** the approved checks load `node_modules` at runtime. My own reads and searches excluded it or were scoped away from it.
- **Otherwise none:** no edits, report files, delegation, mutants, installs, git, or SAP, browser or other network activity.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
