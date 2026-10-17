# Claude review 1 — arc-mcp/arc-1 PR #1008 (transport review evidence and reports)

| | |
|---|---|
| PR | https://github.com/arc-mcp/arc-1/pull/1008 (draft) |
| Reviewed head | `0244d4cc1ff13038f3c9be3677f4dcf1e6647732` (`feat: add bounded transport review evidence and reports`) |
| Base | `ce649ca9b64a3f3c8870be111210d0c4a0b9157c` (diff includes `faefaf68` docs commit) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only. Diff and files read from the shared git object store; reproductions ran in isolated `git archive` exports of base and head (with an APFS clone of the reviewed checkout's `node_modules`). The reviewed checkout, `~/DEV/arc-1` and the other Codex worktree were not touched. No SAP calls, no credential/setting changes, nothing committed, pushed or posted. |
| Read first | `AGENTS.md`, `docs/plans/2026-10-17-transport-review.md`, `docs/research/2026-10-17-transport-review-validation.md`, `docs/research/adt-vscode-1.2/README.md`, `docs_page/review-workflows.md`; also `docs_page/tools.md`, `cli-guide.md`, `roadmap.md`, `docs/dev-guide.md`, the August transport-diff plan, and the evidence archive. |

All line numbers below refer to the reviewed head `0244d4cc`.

## Summary and verdict

The direction is right and most of the engine fails safe: unknown or missing evidence becomes
`partial`, never `complete`; a 404 is not treated as absence; released mode never substitutes work
states; the collector validates page identity, bounds, duplicates and progress, and re-checks the
inventory; HTML output is escaped, script-free and written privately without overwrite. The full unit
suite, typecheck and lint pass independently on the exact head.

I found **three must-fix defects** in the new bounded-collection and status contract, plus
several smaller issues. Each has a concrete reproduction. I validated small fixes for all of the
code findings in a scratch copy. With those fixes, only one existing test, TD-03, needs updating
because it asserts the old REPT-only behavior.

**Verdict: request changes before marking ready. Must fix F1, F2 and F3.** I also recommend F4, F5
and the AGENTS.md/dev-guide parts of F11 in the same PR. Everything else is optional or follow-up.

| # | Severity | Introduced? | Finding | Must-fix |
|---|---|---|---|---|
| F1 | Medium-High | Introduced | When the page budget runs out partway through an object, that object is saved as SAP-unavailable and paging skips it | **Yes** |
| F2 | Medium | Introduced (status semantics) | Whole-object `R3TR PROG`/`R3TR CLAS` entries can be `complete` without comparing the text pool (or program screens/GUI status) | **Yes** |
| F3 | Medium | Introduced | An oversized CTS inventory is reported with data-preview SQL advice (“lower maxRows … WHERE clause”) | **Yes** (2-line fix) |
| F4 | Medium | Introduced | Continuation HMAC key is random per process: paging breaks across CF instances/restarts; no security benefit | Recommended |
| F5 | Low-Medium | Introduced regression | REPT-only class change fans out to five speculative includes (base: main only) | Recommended |
| F6 | Low-Medium | Introduced | Default (`legacy`) MCP diff page is ~3.6× larger; hunks are ~13% of the bytes | Recommended (partial trim) |
| F7 | Low | Pre-existing, partially fixed | Undated foreign snapshot numbered *between* the chosen pair still yields `prior-revision` | Optional |
| F8 | Low | Introduced | Under `ARC1_MINIMAL_ERRORS`, ARC-1's own budget/CPU limits read “request failed” | Optional |
| F9 | Low | Introduced (design) | Speculative whole-class includes that 404 count as `unavailable`, so whole-class entries are almost always partial | Decision |
| F10 | Low | Introduced | Page `status` is page-scoped but undocumented; an out-of-range offset returns `complete` with 0 objects | Optional |
| F11 | Low | Introduced | Documentation drift (duplicate stale AGENTS row, dev-guide detail lost, tools.md `summary`, “this branch”, demo) | AGENTS/dev-guide recommended |
| F12 | Low | — | Test gaps vs. validation claims (deadline, send cap wiring, METH note) | Optional |

---

## Findings (most severe first)

### F1 — Page budget exhaustion inside an object is saved as missing SAP evidence, and paging skips that object (Medium-High, introduced, must-fix)

**Where.** `src/handlers/transport-review.ts:73-99`: the loop checks `budget.exhausted` only
*before* diffing an object (line 74). It pushes the result unconditionally at line 98.
`src/adt/transport-diff.ts:544-555, 580-590, 699-707` turn the budget's
`Error('Review collection budget exhausted.')` (or the deadline/limit error) into
`baseline-unavailable` parts. `nextOffset = offset + objects.length` (line 101) then moves past that
object. The PR's own test codifies this (`tests/unit/handlers/transport-review.test.ts:109-123`
asserts `nextOffset === shown` while the last shown object carries a budget-failed part).

**Why it matters.** Any part read after the budget ran out is recorded as unavailable evidence.
The documented resume path (same continuation, `nextOffset`) never revisits that object. The CLI
collector therefore ends `partial` for evidence SAP would have returned. That breaks the plan's S5
requirement to “retain a bounded way to resume”. It happens whenever a page ends mid-object:

- **reads (180):** a whole `R3TR CLAS` entry costs 15 reads (5 includes × history + 2 sources), so
  any page with ≥12 whole classes ends mid-object;
- **time (30 s):** reads are now sequential. At the measured ~190 ms/read on 758, a page of 20
  two-part objects is ~120 reads ≈ 23 s; slower systems hit the deadline mid-object;
- **bytes:** late in a page the per-read cap is `min(1 MiB, remaining)`. A 700 KB source fails
  although a fresh page would accept it.

**Reproduction** (`claude-review-1-repros/zz-review-repro.test.ts`, “R3”): 13 whole classes, a mock
client whose reads always succeed, the real handler and the real collector:

```text
budget-failed parts:            ['ZCL_11:testclasses']   (note: "Review collection budget exhausted.")
pages [offset, shown]:          [[0, 12], [12, 1]]
SAPTransport offsets requested: [0, 12, 0]               (ZCL_11 is never revisited)
artifact.status:                'partial'
```

**Fix (validated).** After `diffTransportObject`, discard an object the budget cut short unless it
is the first one on the page. The first object always lands, so paging still makes progress:

```ts
// The page budget ran out inside this object: retry it on the next page instead of
// recording ARC-1's own limit as missing SAP evidence. The first object always lands.
if (budget.exhausted && objects.length) break;
```

With this change the same scenario pages `[[0, 11], [11, 2]]` with no budget notes. The existing
“bounds a page of whole classes” test still passes (`nextOffset === shown` holds). Also update that
test's intent and add a deadline/attempt variant (see F12).

---

### F2 — Whole-object `R3TR PROG` / `R3TR CLAS` entries can be `complete` while their text pool (and program screens/GUI status) were never compared (Medium, introduced status semantics, must-fix)

**Where.** `src/adt/transport-diff.ts:649-655`: the text-pool coverage gap is added only for an
explicit `LIMU REPT` component. Line 697 diffs only `main` for programs. `reviewCoverage`
(712-736) then counts the object as fully reviewed.

**Why it matters.** `R3TR PROG X` (and `R3TR CLAS X`) is the whole repository object. The
repository's own evidence (`docs/plans/2026-08-03-transport-diff.md:200-202`) states that `R3TR
CLAS X` and `LIMU <sub> X` are mutually exclusive per request: the whole-object entry *replaces* the
component keys, including the `REPT` text pool that would otherwise appear. The PR flags an
explicit `REPT` key as a gap, so a reviewer sees `partial`. But the same text change carried by a
whole-object entry produces `complete`. That contradicts the plan's outcome (“Missing or uncertain
evidence must never become a verified unchanged/complete result”) and the doc's promise that text
pools are explicitly identified. This affects existing programs or classes added to a request as
whole objects (manual collection, retrofit and consolidation requests). New objects are already
`partial` through `no-prior-snapshot`.

**Reproduction** (“R5”): one `R3TR PROG ZPROG` with an attributed, numbered pair →
`status: 'complete'`, `coverage.reviewed: 1`, `coverage.unsupported: 0`, `coverageGaps` undefined.

**Fix (validated).** Key the gap on the *logical* type, so a whole-object include (`R3TR PROG` with
`wbtype PROG/I` → `INCL`) is not affected:

```ts
// A whole-object entry also carries the text pool (and, for programs, screens and GUI status).
const wholeObject = (type === 'PROG' || type === 'CLAS') && object.components.some((c) => c.pgmid === 'R3TR');
...(wholeObject || object.components.some((c) => c.type === 'REPT')
  ? { coverageGaps: [wholeObject
      ? 'Whole-object entry: text pool (and for programs, screens and GUI status) was not compared; only source parts were.'
      : textGap] }
  : {}),
```

Validated: whole PROG → `partial` with the gap; whole include → still `complete`. Trade-off: every
whole-object PROG/CLAS review becomes `partial`, which is the honest result.

---

### F3 — An oversized CTS inventory returns data-preview SQL advice (Medium, introduced, must-fix)

**Where.** `src/handlers/transport-review.ts:26` reads the inventory through `ReviewBudget`, whose
per-response cap is 1 MiB (`src/adt/transport-review-budget.ts:17-18`, family
`'transport-review'`). Unlike part reads, this read is not caught. The `AdtResponseLimitError`
reaches `src/handlers/dispatch.ts:200-212`, which handles every family except
`repository-relations` as a data preview.

**Reproduction** (`zz-inventory-limit.test.ts`, real AdtClient + HTTP + dispatch, place it under
`tests/unit/handlers/`): a 9,000-object organizer response returns

```json
{"error":"DATA_RESPONSE_TOO_LARGE","message":"The SAP data-preview result exceeded the 1 MiB server limit. Submit a new request with lower maxRows, fewer columns, or a restrictive non-overlapping key-range WHERE clause.","limitBytes":1048576,"retryable":false,"requestId":"REQ-1"}
```

The live 758 fixture uses ~420 bytes per `tm:abap_object`, and released requests mirror objects at
request level. That puts the ceiling at roughly a thousand-plus objects. Large refactoring or
generated-object requests reach it. The collector records the misleading text as its `error` gap.

**Fix (validated, mirrors the `repository-relations` branch):**

```ts
if (err instanceof AdtResponseLimitError && err.endpointFamily === 'transport-review') {
  return `${message} The request inventory is too large for an automated review page; review it in SAP. This is an analysis limit, not a connectivity failure.`;
}
```

Also add a row to the bounds table in `docs_page/review-workflows.md:56-58`: the inventory GET shares
the page budget and its 1 MiB per-response cap, so larger requests are refused.

---

### F4 — The continuation uses a per-process random HMAC key, so paging fails across instances and restarts with no security benefit (Medium, introduced, recommended)

**Where.** `src/handlers/transport-review.ts:1, 16, 52-67`; documented as restart-only at
`docs_page/review-workflows.md:70`.

**Mechanism.** `continuationKey = randomBytes(32)` exists per process. On Cloud Foundry with `N > 1`
instances, the router balances requests across instances, so each follow-up page has roughly a
`(N−1)/N` chance of reaching a process with a different key. The caller then gets “Review
continuation is stale … Restart at offset 0”, which can send an LLM back to page 1 repeatedly.
Restarts (`cf restage`, crash, deploy) invalidate tokens too. The default `instances: 1` avoids
this, but scaling out is a supported operation (`docs_page/btp-administration.md` sizes for `N`
instances).

**The HMAC protects nothing.** The server recomputes the expected value from the *current*
request's caller, destination, URL, target, client, request, mode and inventory, then compares. A
token is accepted only for the binding it encodes. A client gains nothing by computing one: an
offset without a token is accepted anyway, and page 1 returns the token. A plain digest gives the
same drift and identity detection deterministically.

**Reproduction** (“R4”): reloading the handler module with identical caller and inventory rejects
the page-1 token (`isError`, text matches `/stale/`).

**Fix (validated):** `createHash('sha256').update(binding).digest('hex')`. Remove `createHmac`,
`randomBytes` and the key. Drop “or server process” from the error message, and change the doc
sentence. All existing continuation tests still pass: a forged token, another caller, another
target, mode or client, and inventory or task drift are all still rejected.

---

### F5 — A REPT-only class change fans out to all five speculative includes (Low-Medium, introduced regression)

**Where.** `src/adt/transport-diff.ts:421` skips `REPT`, then 430-432 fall back to all five includes
when nothing else was selected. For programs, line 697 still diffs `main` and labels it
`selectionOrigin: 'cts'`, although CTS selected only the text pool.

**Reproduction** (“R1” and base “R1”): a single `LIMU REPT ZCL_DEMO=…CP`

- base `ce649ca9`: 1 history read, parts `['main']`;
- head: 5 history reads (up to 15 SAP reads), 5 rows labelled `speculative`. In `released` mode they
  are typically 5 “No revision satisfies …” unavailable rows; in `legacy` mode they show unrelated
  latest-revision diffs.

**Fix (validated):** when every component is `REPT`, return no source parts. Put the existing text
sentence in `inventoryReason` (no separate `coverageGaps` entry, which would count the same
component twice; see the nits). TD-03
(`tests/unit/adt/transport-review-evidence.test.ts:130-138`) must change to expect `parts: []` with
that reason. It is the only existing test that fails across the full suite with all fixes applied.

---

### F6 — The default MCP diff payload grew ~3.6×; review content is ~13% (Low-Medium, introduced, LLM token cost)

**Measurement** (`zz-size.test.ts`: the same 20 single-`METH` class changes, default `legacy` mode,
`handleSAPTransport`):

| | bytes |
|---|---|
| base page | 9,374 |
| head page | 33,903 |
| head: full `revisions` records (+`skipped`) | 9,400 |
| head: per-part labels (`comparisonMode`, `activationStatus`, `retrievedAt`, `selectionOrigin`, `historyCompleteness`, `statisticsComplete`, `sourceState`, `attribution`, `change`) | 5,340 |
| head: the METH `scopeNote` sentence repeated per object | 3,080 |
| head: `sourceHashes` | 3,360 |
| head: `components` | 2,600 |
| head: actual hunks | 4,300 |

Every existing `SAPTransport diff` caller pays this, although they never opted into evidence mode.
Design principle 3 asks for token-efficient tools. Cheap trims that keep the evidence:

- emit the METH scope note once per page;
- drop per-part `comparisonMode` (equals page `reviewMode`) and `activationStatus` (1:1 with
  `sourceState`);
- consider deriving `attribution` from `selectionMethod`, or trimming `revisions` to
  `{id, transport, uri}`;
- or emit full evidence only when `reviewMode` is not `legacy`.

This is not a correctness defect.

---

### F7 — An undated foreign snapshot numbered *between* the chosen pair still yields `prior-revision` (Low, pre-existing, partially fixed)

**Where.** `src/adt/transport-diff.ts:215-225`. The new chronology check flags only
`previous ≥ current`.

**Reproduction** (“R2” on head and base): `[00005 dated (request), 00003 dated (other), 00004
undated (other)]` → `previous = 00003`, `baselineStatus = 'prior-revision'`. The diff
`00003 → 00005` contains the undated `00004` change from another request, presented as an
attributed pair. Base behaves identically.

**Realism.** Undated entries exist (`CERTRULE_DYNP 00001`, August plan F10). They are probably
mostly old low numbers, so the in-between case is rare.

**Fix (validated):** treat a foreign numbered snapshot strictly between `previous` and `current` as
ambiguous chronology. Consistent dated feeds and same-request siblings are unaffected (both
asserted in `zz-review-fix.test.ts`).

---

### F8 — Under `ARC1_MINIMAL_ERRORS`, ARC-1's own limits read as a failed SAP request (Low, introduced)

**Where.** `src/adt/transport-diff.ts:36-40` (`describeError`), used at 554, 589, 606.
`'Review collection budget exhausted.'` and `'Diff calculation exceeded its work budget; statistics
are unavailable.'` are local messages without SAP diagnostics. In minimal mode they become
`'source read failed: request failed'` (reproduced in “R3 minimal”).

**Fix:** keep these local messages in minimal mode, for example with a small local error class or
fixed notes for the two local limits. F1's fix removes most budget cases.

---

### F9 — Speculative whole-class includes that 404 count as `unavailable` (Low, design decision)

**Where.** `src/adt/transport-diff.ts:551-553`, counted at 718.

Base dropped a 404 for a non-main include; head keeps a `baseline-unavailable` row (repro “R6” and
base “R6”). Most classes lack `testclasses` and often `macros`, so nearly every whole-class entry is
`partial`. In `released` mode, existing includes that this request did not version are also
unavailable. This matches the plan's “speculative absence” intent and is not a false complete. It
does make `partial` routine for whole classes and costs up to 4 failing history reads per class.

Alternatives: a distinct note and counter for “speculative include not found”, or one class
metadata GET to learn which includes exist. Your call; not required.

---

### F10 — Page `status` is page-scoped and undocumented; an out-of-range offset returns `complete` (Low, introduced)

**Where.** `src/handlers/transport-review.ts:100-108`.

**Reproduction** (`zz-offset.test.ts`): one unsupported object (page 1 `partial`), then
`offset: 5` with the valid continuation → `{"status":"complete","shown":0,"totalObjects":1}`.
More generally, a final page can say `complete` while earlier pages were `partial`. The collector
aggregates correctly, but an MCP/LLM caller reading `status` may not.

**Suggestion:** document in `tools.md` that `status`/`coverage` describe the returned page only, and
reject or mark `partial` an `offset >= totalObjects > 0`.

---

### F11 — Documentation drift (Low, introduced)

- `AGENTS.md:222-223` now has **two** “Transport review diff” rows. The old row (223) is stale: it
  points to `src/handlers/transport.ts` and `src/adt/xml-parser.ts (revisionTransportId)`, which
  moved to `transport-review.ts`/`revision-feed.ts`. Replace it rather than add a second row.
- `docs/dev-guide.md:199` replaced the detailed live wire-facts row with a summary. That row covered
  `adtcore:name` vs title, href-tail shape guard, feed order `00002, 00000, 00001`, undated entries,
  request ∪ task, per-type feed URLs via `REVISION_URL_BUILDERS`, CTS-driven include selection and
  `describeError`. AGENTS.md says that detail belongs in the dev-guide; restore it with the new
  file names.
- `docs_page/tools.md:1527` still says `summary` is “For `list` only”; diff now uses it. Diff
  `status`/`coverage` are undocumented. The tool text `src/handlers/tools.ts:1586` says
  “unavailable = failed read”, but `baseline-unavailable` now also means “no revision for the
  requested mode” and “speculative include 404”.
- `docs_page/review-workflows.md:6` (“implementation on this branch”) will be wrong after merge.
  Line 70 mentions restart expiry only (see F4). The bounds table omits the inventory ceiling (F3).
- `scripts/demo-review-workflows.ts:9` defaults to `test-results/workflow-demos`, but the doc uses
  `test-results/review-demos`. The script is outside Biome `files.includes`, so it is never
  formatted or linted, and its style differs from the repository.

---

### F12 — Test gaps compared with the validation log (Low)

- The validation says tests cover “byte/attempt/cancellation limits”. Bytes, high-level reads and
  cancellation are tested. Nothing in the review path tests the **180-send attempt cap**
  (retries/CSRF) or the **30-second deadline**.
- The METH `scopeNote` (“METH broader-part warning” in the plan's matrix) has no assertion.
- `tests/unit/handlers/transport-review.test.ts:109-123` asserts the F1 behavior; update it with F1.

---

### Nits and optional hardening (no action required)

- **Undated work-state branch** (`transport-diff.ts:195-199`): returns `skipped: []` although it
  silently skipped same-request snapshots. List them for evidence completeness.
- **Fallback label** (`transport-diff.ts:173-176`): an unattributed `draft` (99999) fallback is
  labelled `active-only-fallback`.
- **Double count** (`reviewCoverage`, `transport-diff.ts:715-716`): an object with both an
  `inventoryReason` and a REPT gap (e.g. a FUGR text pool rolled up to `FUGR_INCLUDE`) adds 2 to
  `unsupported` for one component.
- **Bidi controls in HTML**: U+202A–U+202E and U+2066–U+2069 inside hunks render without warning
  (`src/workflows/artifact.ts:30-38`). For a human review artifact, consider making them visible
  (Trojan Source, CVE-2021-42574).
- **Check provenance** (`src/workflows/transport-review.ts:134-180`): in `active` mode the reviewed
  `sourceHashes.after` (00000 content) could be compared with `object_state`'s active `sha256`. The
  report could then say whether the syntax-checked source equals the reviewed source; today it
  always says “not established”. Confirm byte-identical hashing first.
- **Open requests in released mode**: every part shows “No revision satisfies …”. One gap line
  suggesting `--mode active` for a modifiable request would help.
- **Stricter VERSIONS parsing** (`src/adt/revision-feed.ts`): this also changes `SAPRead
  type=VERSIONS` and the version diff. Malformed or non-feed bodies, an empty body, or one entry
  without `content@src` now fail the whole read instead of returning empty. That is sensible, but
  call it out in release notes and tools.md.
- **Latency**: sequential reads replace the base's semaphore-bounded fan-out. This is fine for
  bounds, but it increases page latency and makes F1 more frequent on slow systems.
- **Research archive privacy**: the archive publishes absolute local paths and workstation details
  (`ARC1_IMPLEMENTATION_PROMPT.txt:4,15`, `ARC1_RESEARCH_HANDOFF.md:25,49,53,59`,
  `arc1-adt12-adoption-review.html:16`). The A4H host is already public in `docs/`. All 11 files
  match `archive-sha256.json`, and the HTML evidence contains no scripts. The owner should decide
  whether to keep the paths.

---

## What I checked and found sound

- **Revision selection:** released mode accepts only attributed numbered snapshots. Active/draft
  fallbacks are labelled unverified. An undated work state with history becomes ambiguous.
  `previous ≥ current` becomes ambiguous. Same-request siblings are skipped. Request and task IDs
  are normalized.
- **Honest claims:** `no-prior-snapshot` never claims creation. A 404 never claims absence. A
  selected include failure stays visible beside a successful main (TD-01). Unattributed changed
  siblings keep hunks (TD-02). `historyComplete:false` makes the part uncertain. An untrusted `next`
  URL is neither followed nor echoed.
- **Feed parser:** rejects non-feed, empty, malformed entries and entries without content.
  `isTestTransport` is preserved without filtering.
- **Bounds plumbing:**
  - deadline and abort signal reach `fetch`;
  - the semaphore wait honors the deadline;
  - redirects are refused under the attempt budget;
  - 401/403 are flagged;
  - error bodies are capped per response;
  - oversized-body overshoot is charged;
  - `throwIfRequestCancelled` runs before each read.
- **CPU:** jsdiff 9 returns `undefined` on `timeout`/`maxEditLength`, which becomes
  `statisticsComplete:false`. `capDiff` is UTF-8 safe and stays ≤16 KiB.
- **Output budget:** compact JSON is measured per object. An oversized first object returns an
  explicit error instead of a non-progressing continuation.
- **Continuation binding:** covers caller, destination, URL, target, actual SAP client, request,
  mode, and inventory (task id/status/owner, components including `taskId`, request status and
  type). Reordering is accepted; drift is rejected.
- **Collector:**
  - checks offset, shown, total, request, mode and target identity;
  - rejects duplicate objects and parts;
  - detects missing continuation and non-progress;
  - revalidates the inventory at the end;
  - never saves the token;
  - gaps can never become `complete`;
  - checks are labelled current-source with before/after hashes;
  - blocked and failed calls are kept as such.
- **Files and HTML:** a fresh 0700 directory is reserved before SAP work, files are written 0600
  with `wx` (O_EXCL), and nothing is overwritten. Every interpolation is escaped (`& < > " '`), CSP
  is `default-src 'none'`, and there are no scripts.
- **Surface:** `reviewMode`/`continuation` are in sync across `tools.ts`, `schemas.ts` and the
  handler, and snapshots were regenerated. The schema budget passes (SAPTransport tool 7,705 → 6,418
  bytes). The trimmed action text survives in the parameter descriptions (`target`, `package`,
  `removeLockedObjects`), so no create/delete guidance was lost.
- **Roadmap:** FEAT-86/87/88 are consistent across overview and details; FEAT-71 was corrected.

## Tests run (all on isolated scratch exports; no SAP)

| Run | Result |
|---|---|
| Full unit suite, exact head (Node 22.21.1, `--maxWorkers=2`) | **314 files / 8,920 tests passed**, 138.7 s |
| `npm run typecheck` (src + scripts + tests), head | pass |
| `biome check src tests`, head | pass (1 info, unrelated) |
| Schema budget script, head vs base | pass; SAPTransport 7,705 → 6,418 B |
| Focused review suites (6 files), head | 143/143 pass |
| Reviewer repros on head (`zz-review-repro.test.ts`, 7 tests; `zz-inventory-limit.test.ts`; `zz-offset.test.ts`; `zz-size.test.ts`) | all pass, confirming F1–F10 behaviors as described |
| Same scenarios on base (`zz-review-repro-base.test.ts`, 3 tests) | REPT-only → `main` only; in-between undated → same `prior-revision`; whole-class 404 rows dropped |
| Full suite with F1, F2, F3, F4, F5 and F7 fixes applied (scratch “fix” copy) | 8,926 passed, **1 failed: TD-03 (expected; asserts the old REPT-only behavior)**; the fix-validation tests pass |

Not run: `npm run build`, `validate:policy`, `check:sizes` (file part), `docs:build`, `git diff
--check`, integration/E2E (no SAP calls by instruction). I used Node 22.21.1; the plan used 24.11.1.

## Reproduction files

`/Users/marianzeis/.codex/reviews/arc1-transport-review-20261017/claude-review-1-repros/`

| File | Place under | Runs against |
|---|---|---|
| `zz-review-repro.test.ts` | `tests/unit/` | head; R1 F5, R2 F7, R3 F1+F8, R4 F4, R5 F2, R6 F9 |
| `zz-review-repro-base.test.ts` | `tests/unit/` | base `ce649ca9` |
| `zz-inventory-limit.test.ts` | `tests/unit/handlers/` | head (F3 message) |
| `zz-inventory-limit.fixed.test.ts` | `tests/unit/handlers/` | with the dispatch fix |
| `zz-offset.test.ts` | `tests/unit/` | head (F10) |
| `zz-size.test.ts` | `tests/unit/` | head; prints the F6 byte breakdown |
| `zz-review-fix.test.ts` | `tests/unit/` | with `suggested-fixes.diff` applied |
| `suggested-fixes.diff` | — | validated patch for F1, F2, F3, F4, F5, F7. Not applied anywhere; update the error text and docs for F4, and TD-03 for F5 |

## Limitations

- No SAP access. The whole-object CTS semantics (F2) and undated entries (F7) rest on the
  repository's own live evidence (`docs/plans/2026-08-03-transport-diff.md` mutual-exclusivity census
  and F10) plus standard CTS semantics, not on new captures. Whether SAP writes versions for every
  include of a whole-class entry on release was not verified; it does not affect F2's conclusion.
- Real-system latency for F1 is inferred from the validation log's single 758 timing (~190 ms/read).
- The scratch exports are not git repositories, so Biome's VCS integration was inactive there.
- Notebook, policy and new diagnostic prototypes were out of scope and not reviewed.

## Verdict

**Request changes.** Must fix before the PR leaves draft:

1. **F1:** do not save budget-truncated objects; retry them on the next page.
2. **F2:** add a coverage gap for whole-object `R3TR PROG`/`R3TR CLAS` text pool, screens and GUI
   status.
3. **F3:** replace the data-preview advice for an oversized inventory and document that ceiling.

Recommended in the same PR: F4 (plain digest continuation), F5 (no speculative fan-out for
REPT-only), and the AGENTS.md/dev-guide repairs from F11. Everything else is optional or follow-up.
