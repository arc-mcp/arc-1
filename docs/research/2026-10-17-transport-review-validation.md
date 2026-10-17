# Transport review validation and review log

**17 October 2026.** This record covers the focused transport branch, not every feature in the
preserved broader prototype. See the [plan](../plans/2026-10-17-transport-review.md) and
[ADT adoption backlog](adt-vscode-1.2/README.md).

## What was reviewed

- Existing revision selection, raw CTS rollup, per-part reads and failure handling.
- Page budgets, source hashes, continuation identity and inventory binding.
- Collector validation, current-source check provenance, output escaping and file handling.
- Public/runtime schemas, snapshot changes, user guide and roadmap consistency.

The implementation keeps one transport engine, one sequential collector and one static renderer.
It reuses the dispatcher, authentication, policy, HTTP budgets and diff library. There is no new
service, background job, frontend framework, credential store or general workflow engine.

## Plan and implementation review findings

| Finding | Decision / verification |
|---|---|
| Broad prototype mixes independent stages | Extract transport/report work into a new worktree; original 67 file hashes remain identical |
| Collector imported coverage from handler | Move pure coverage counting into the transport evidence module |
| Task state and empty tasks absent from continuation fingerprint | Include task identities/status/owner; regressions fail before the fix and pass after |
| Configured target label could hide a changed SAP client | Bind actual SAP client explicitly; regression fails before and passes after |
| Duplicate objects/parts could inflate collection coverage | Reject duplicate evidence before saving/counting it; two failing-before regressions |
| Empty/malformed entry could look like valid empty history | Validate every entry before filtering; two failing-before regressions; mixed entries also rejected |
| Undated higher-numbered candidate could become a certified predecessor | Retain candidate but mark chronology ambiguous; failing-before regression |
| Oversized first-object metadata could return offset 0 repeatedly | Return an explicit incomplete-review error; bounded regression |
| Existing output directory could mix new JSON with old HTML | Reserve a new private directory before SAP calls; no-overwrite regression |
| New tool parameters absent from docs table | First full run failed seven parity assertions; add both fields to the canonical table |

Tests also cover selected-include 404 with successful main, unattributed changed siblings, REPT
scope, explicit modes, flagged metadata without filtering, history continuation qualification,
wide UTF-8 output, byte/attempt/cancellation limits, CPU diff bounds, malformed collector pages,
current-source drift and inert HTML rendering. CLI tests verify dispatcher use, private files,
failed collection evidence, invalid modes and preserving earlier reports.

## Read-only live spikes

All calls used this local checkout's CLI and an existing Basic-auth test identity, TLS verification
on, cache off, writes/transport writes/Git writes/data preview/free SQL disabled. There were no
SAP mutations, activations, transport releases or configuration changes. These are local CLI
results, not verification that a deployed connector was upgraded.

| Target | Release confirmed through COMPONENTS | Observed result | Limit |
|---|---|---|---|
| A4H/001, HTTPS 443 | SAP_BASIS 758 SP02 | Released A4HK906371: 2 logical objects, 3 changed parts; main adds +1, helper *2→*3, report literal changes. Two current syntax checks passed; two contexts returned. | Existing demo only; no broad CRUD/ATC/Unit suite |
| NPL/001, HTTPS 443 | SAP_BASIS 750 SP02 | CL_ABAP_TYPEDESCR VERSIONS parsed; missing NPLK999999 returns a tool error. Current caller has no released requests. | Active-only standard history; no historical transport pair verified |
| A4H/001 at the 2025 host, HTTPS 443 | SAP_BASIS 816 SP01 | Standard-class VERSIONS parsed; existing empty released A4HK910276 returns zero objects and explicit “not a release verdict.” | No nonempty historical transport pair verified |

Exact public calls:

```text
SAPRead {"type":"COMPONENTS"}
SAPRead {"type":"VERSIONS","objectType":"CLAS","name":"CL_ABAP_TYPEDESCR"}
SAPTransport {"action":"diff","id":"A4HK910276","reviewMode":"released","limit":1}
SAPTransport {"action":"diff","id":"NPLK999999","reviewMode":"released","limit":1}
```

End-to-end report:

```bash
arc1-cli review A4HK906371 --mode released --syntax --context --output-dir NEW_DIRECTORY
```

The initial focused 758 run took 17.327 s including startup and optional calls. Its first page used
10 high-level reads / 10 actual sends, 18,704 successful response bytes and 1,932 ms. The empty
816 review used one send, 4,924 bytes and 163 ms inside the handler. These single-run timings were
collected while local tests ran; they are observations, not benchmarks or sizing guarantees.

The final 758 source replay returned the same complete two-object report, both syntax checks
passed and both contexts returned. It took 22.348 s overall; its page used 10 sends, 18,704 bytes
and 1,654 ms. Tested source manifest SHA-256:
`77258acefe2f97b17f41c3e43bfafacd249ff93c499e9852326fa7ff90d52bc1`.

Private ignored artifacts are under `test-results/transport-review/`: original/updated observation
JSON, live command inputs recorded above, command envelopes/logs, the live report and complete/
partial/stale synthetic demos. Synthetic demos call no SAP system. The final source-file hash
manifest identifies the tested implementation independently of documentation-only changes.

## Automated results

Recorded before draft creation; refresh this section after substantive code changes.

- Initial focused extraction: 203 tests passed in eight files.
- Additional review regressions: six failed before fixes, all 26 then passed in three files.
- Chronology regression: one failed before its fix.
- Final focused review/CLI/docs run: 92 passed in seven files.
- First full suite: 8,910 passed, seven documentation parity failures; corrected and parity 9/9 passed.
- Final full suite: **8,920 passed in 314 files**, 159.25 seconds (two workers).
- Typecheck (source/scripts/tests), build, lint, policy validation (130 entries / 14 schemas),
  file/schema budgets and strict documentation build passed. Lint reported two existing informational
  suggestions in unrelated files; no errors. Final whitespace check passed after removing an extra EOF blank line.

HTML escaping/CSP and report contents are covered by tests. Browser automation refused the local
`file:` preview; no browser-policy workaround was attempted and no new rendered-browser check is
claimed. The original notebook screenshot in the archive was inspected and shows demo flight data.

## Remaining work and release limits

No verified historical text/FUGR/DDIC/deletion adapter, test-transport exclusion rule or backend
history paging is added. Method keys identify a whole class part, not individual hunk ownership.
Current active syntax/context do not validate an older released snapshot. Hashes identify retrieved
source, but collection is not atomic. Multi-target transport diff remains excluded.

The roadmap adds FEAT-86 (historical coverage), FEAT-87 (notebook runner), FEAT-88 (policy explanation),
and corrects FEAT-71's GET evidence. FEAT-69/74 remain open because their local prototypes are not
part of this change. The adoption index retains the other conditional ideas and resume criteria.

## External review

Claude Code Opus 5.5 Max reviewed `0244d4cc1ff13038f3c9be3677f4dcf1e6647732` through the GUI.
Its [full report](adt-vscode-1.2/evidence/claude-review-1.md) and reproduction files were evaluated,
not applied without review. Claude independently passed all 8,920 tests on Node 22.21.1.

| Finding | Disposition |
|---|---|
| F1: budget cut an object short and paging skipped it | Fixed: retry on a fresh page; first-object failure remains visible so collection progresses. Read-cap and deadline continuation regressions. |
| F2: whole-object non-source scope disappeared | Fixed: whole PROG/CLAS entries retain text/screen/GUI coverage gaps; whole INCL stays source-only. |
| F3: inventory limit produced SQL advice | Fixed in the existing family-specific error formatter; real HTTP/dispatch regression and documented inventory ceiling. |
| F4: continuation failed across processes | Fixed with a deterministic digest. It grants no authority; every call still authorizes and compares the current binding. Restart, caller, client, target and drift tests. |
| F5: text-only CTS scope read unrelated source | Fixed: one inventory gap, no source reads and no double count. |
| F6: normal replies paid full provenance cost | Fixed: compact default; existing `resultFormat="structured"` opts into full provenance, which the CLI always requests. Same hunks/components/coverage, over 35% smaller in the test fixture. |
| F7: intervening undated snapshot | Fixed conservatively for released and active/draft comparisons; stable dated history and same-request siblings remain valid. |
| F8: minimal mode hid local limits | Fixed: local collection/CPU limit notes remain intelligible without SAP diagnostics. |
| F9: speculative 404 makes review partial | Retained deliberately. A 404 cannot prove absence; future verified include metadata may improve classification (FEAT-86). |
| F10: out-of-range page looked complete | Fixed: reject invalid offsets; document page-scoped status and collector aggregation. |
| F11: routing/documentation drift | Fixed: one AGENTS row, restored dev-guide wire evidence, updated parameters, version wording and demo formatting/default path. |
| F12: overstated test coverage | Added the actual 180-send HTTP cap including CSRF/retry, 30-second boundary, deadline continuation and METH scope assertions. |

Six imported regressions failed on the reviewed head before their fixes. An additional active-state
chronology regression also failed before its correction. Follow-up focused/full checks and final
Claude review are recorded below when complete.

Optional suggestions remain deferred: verified absence metadata, active-review/check hash correlation,
additional per-state hint wording and bidi visualization. They do not change the supported-evidence
contract. Original archive paths are retained for exact provenance as requested; no credentials are included.


### Follow-up verification

- Full unit suite: **8,933 tests passed in 316 files**, 60.24 s, Node 24.11.1.
- Focused follow-up: 79 tests passed; final compact-reply/tool-snapshot checks: 21 passed.
- Typecheck, build, lint, policy, file/schema budgets and strict docs build passed.
- Read-only 758 replay after fixes: partial evidence for two objects; both current syntax
  checks passed and both contexts returned. The collector explicitly received structured provenance.
  The earlier complete label becomes partial because the R3TR program includes unreviewed text/
  screen/GUI scope (F2); all three source parts retain their attributed differences. Exit 1 is
  the expected partial-collection signal. The run took 12.059 s, with 10 sends / 18,704 bytes /
  1,506 ms on the first page.
- Source manifest SHA-256: `c42b9495db0dc2ee77f19464308d4bb592f2ec43433e547953b024accc8670b5`.
- Claude's [second GUI review](adt-vscode-1.2/evidence/claude-review-2.md) approves
  `d83cf19b` with no must-fix items. It independently passed all 8,933 tests on Node 22.21.1
  and measured compact replies at 16,084 bytes versus 34,087 bytes for 20 METH entries.

### Small diagnostic follow-up

| Second-review note | Decision |
|---|---|
| N1: oversized source described as generic exhaustion | Name the response's actual byte allowance, which can be lower than 1 MiB near the page limit. |
| N2: SAP failure masked by exhausted-budget state | Classify the actual error. Preserve SAP status/redaction; identify local time, send and collection limits separately. |
| N3: misplaced documentation paragraph | Move it into the transport diff subsection. |
| N4: compact output measured against full evidence size | Retain the conservative guard so both formats have identical page boundaries. |
| N5: minor wording and local repro paths | Restore the default in tool help. Keep the shared response-limit wording and original report paths; committed regression files below cover the accepted findings. |

Six new assertions failed before the diagnostic correction (both error modes, send and time limits).
They exercise `diffTransportObject` through `ReviewBudget`; no new abstraction or configuration is added.
The successful-path SAP behavior is unchanged from the recorded `d83cf19b` replay.

Reproducible tests are committed under `tests/unit/`: `transport-review-regressions.test.ts`,
`adt/transport-review-evidence.test.ts`, `adt/request-attempt-budget.test.ts`, and
`handlers/transport-review-limits.test.ts`. The archived Claude reports remain verbatim; their scratch
repro paths are local, while these committed tests are the maintained regressions.

Final code at `f7598c3338bff11711f70b0336d93682039831e0`:

- **8,939 tests passed in 316 files**, 155.66 s, Node 24.11.1 (`npm test -- --maxWorkers=2`).
- The earlier concurrent run observed six tool-help snapshot mismatches during the final wording
  refresh. All six snapshots were regenerated and the entire suite rerun against stable files.
- Targeted transport/limits/tool-snapshot run: 90 tests passed; final snapshot refresh: 12 passed.
- Typecheck, build, lint, policy, file/schema budgets and strict docs build passed. The first
  size check caught one extra help-text line; shortened the wording without raising the ratchet.
- Original work remains intact: 67/67 preserved files and 11/11 archived original evidence hashes.

Claude Code Opus 5.5 Max's [third GUI review](adt-vscode-1.2/evidence/claude-review-3.md)
approved exact product revision `f7598c3338bff11711f70b0336d93682039831e0`: **no must-fix items
and no remaining actionable findings**. It independently passed 442 targeted tests, 12 snapshot
tests and two real HTTP deadline checks on Node 22.21.1, plus typecheck, lint and schema budgets.
Its report's “full rerun is in progress” reflects when that request was sent; the complete passing
result is recorded above. This final record/archive commit changes documentation only.

All review findings have a recorded disposition. The draft PR remains post-1.6, with current GitHub
CI results visible on PR #1008. Local unit verification and the bounded SAP replay are distinct from
shared-runner integration/E2E qualification; pending or skipped jobs do not prove live coverage.

## Release integration check

Release 1.6.0 (`041a9e48`) includes #1007, which adds 12 lines of search-name normalization
to `xml-parser.ts`. The reduced parser budget now includes those upstream lines; no parser or
search behavior changed here. The combined stack passed 9,085 tests across 326 files before
this budget-only adjustment.
