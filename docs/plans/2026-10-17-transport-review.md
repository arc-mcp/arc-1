# Transport review: plan, spikes and review gates

**17 October 2026 · scope: transport evidence and reports.**
The [adoption backlog](../research/adt-vscode-1.2/README.md) retains the other ADT ideas.
An existing local prototype is input to review, not proof that this slice is ready.

## Outcome

A reviewer can see which source changed, which revisions were compared, and which CTS components
could not be reviewed. Save a bounded JSON/HTML report through the existing intent dispatcher.
Missing or uncertain evidence must never become a verified unchanged/complete result.

## Scope and design

| Layer | Responsibility | Keep it small |
|---|---|---|
| Revision/feed helpers | Parse valid history, retain flags and completeness; select explicit source mode | Pure functions; no inferred backend pagination or new cache |
| Existing transport diff | Roll up CTS components; preserve failed/unattributed parts; source hashes and bounded hunks | Reuse current URL mapping and diff library |
| Transport handler | Inventory fingerprint, bounded page, continuation bound to caller/target/request/mode | Existing SAPTransport.diff; no new tool or background job |
| CLI collector | Collect pages, recheck inventory, optionally collect current syntax/context | Sequential calls through handleToolCall; no authentication stack |
| Report | Versioned JSON and escaped static HTML with summary, changes, gaps and checks | No frontend framework, scripts, model dependency or generic workflow engine |

Compatibility: keep legacy selection as the tool default and existing result fields. The new review
CLI defaults to released history. Explicit active/draft modes label their source state. A source-system
diff does not establish the contents of another system or readiness for release.

Out of scope: notebook runner, new policy/diagnostic actions, native batch syntax API, new historical
type adapters, test-transport filtering, transport release, deployment and writable multi-target work.
Optional checks reuse existing single-object syntax and context. ATC/Unit remain explicit separate calls.

## Execution sequence

- [x] Preserve the original worktree and record its file hashes; start a separate branch from current main.
- [x] Archive/index the complete research; distinguish shipped/main/prototype/unproven claims.
- [x] Write and review this plan before extracting implementation.
- [x] Reproduce the original eight observations against clean main.
- [x] Extract the transport-only prototype; review every reused module and test.
- [x] Add regressions for newly discovered failures; simplify avoidable abstractions.
- [x] Run bounded live read-only spikes and inspect complete/partial/stale reports.
- [x] Run focused tests, full unit suite and repository gates; record exact results.
- [x] Final diff/documentation/roadmap review; create draft PR #1008.
- [x] Ask Claude Code Opus 5.5 Max in the GUI to review the exact PR revision.
- [x] Evaluate each Claude finding, fix valid issues, retest, and request a final Claude pass if changed.
- [x] Archive all three reviews; final approval at `f7598c33`, with 8,939 unit tests passing.

## Spike protocol

Use Node 24.11.1 and existing dependencies. Live requests use the existing authorized identity,
HTTPS `https://a4h.marianzeis.de`, port 443, client 001; writes disabled. Never create/release/activate
an object to manufacture evidence. Save sanitized results outside version control unless approved
demo fixtures are necessary. Do not copy credentials or full business data into a PR.

| Spike | Inputs / bound | Evidence and decision |
|---|---|---|
| S1: baseline regressions | Original eight mocked observations on clean main | Record original behavior; convert desired outcomes into assertions |
| S2: known released transport | A4HK906371 / task A4HK906372; class ZCL_ARC1_TD_CALC and program ZARC1_TD_REPORT | Verify main +1, helper *2→*3 and program change; request/task attribution and hashes |
| S3: coverage failures | Mock selected CCIMP 404 beside successful main; REPT-only; unattributed sibling | Each missing/uncertain part remains visible; report is partial |
| S4: version modes | Numbered history plus 00000/99999, undated/equal dates, missing predecessor, task/request IDs | Work states cannot become historical baselines; ambiguity stays explicit |
| S5: bounded collection | Wide UTF-8 lines, many classes, oversized inventory/source, timeout/cancellation and retries | Enforce source/page/read/CPU bounds; retain a bounded way to resume; no false complete |
| S6: drift and identity | Reorder/remove/add objects, changed task/status/components; changed caller/target/mode | Stable reorder accepted; inventory drift rejected; no cross-context continuation |
| S7: artifacts/checks | Complete/partial/stale fixtures; malformed pages, escaping and source changes around checks | Invalid evidence rejected; current checks stay current; accessible human summary |
| S8: backend limits | Existing 758 histories; 750/816 only if authorized reachable fixture available | Record actual tested release/route, exact request, missing fixtures and unsupported contracts |

Suggested page ceiling: 30 seconds, 180 actual backend sends, 1 MiB per response, 8 MiB cumulative,
512 KiB output, 40 logical objects maximum. Detail output is 400 lines / 16 KiB per part.
Collector: default 5 pages, hard maximum 10. Check existing HTTP/diff primitives before adding new
controls. Document exactly what each bound includes; cancellation must reach the backend request.

## Test matrix

| Invariant | Required regressions |
|---|---|
| Every selected CTS part accounted for | Mixed success/404/403/invalid history; all-failed and speculative absence; raw component preservation |
| Attribution and change are separate | Changed unattributed sibling retains hunks/counts; exact main does not erase it; METH broader-part warning |
| Honest baseline | Empty/malformed feed distinction; undated active, draft-only, no prior numbered version; contiguous same-request versions |
| Explicit intent | released/active/draft/legacy; normalized request/task IDs; no silent current-source substitution in released mode |
| Bounded work | Large source/output, many parts, timeouts, cancellation, byte limit abort, CPU diff cap and retry accounting |
| Continuation integrity | Binding tampering, caller/target/mode mismatch, changed inventory and stale token; no source snapshot promise |
| Collector integrity | Missing/duplicate/contradictory pages and counts; gaps remain partial; final inventory recheck |
| Check provenance | Active source hash before/after; drift makes check stale; no historical validation claim |
| Safe output | HTML escaping, no executable source, bounded input/output, private files and no overwrite |

Run relevant existing transport/source-diff/revision tests and new regressions first. Then run
`npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run build`, `npm run lint`,
`npm run validate:policy`, `npm run check:sizes`, `npm run docs:build`, and `git diff --check`.
Review regenerated schema snapshots. Run no broad CRUD suite as part of this read-only spike.

## Plan review before implementation

| Question | Review outcome |
|---|---|
| Is the existing 67-file prototype one reviewable change? | No. Extract transport and reports; preserve later stages untouched. |
| Is a new workflow framework or service needed? | No. One collector with a typed invoke function and static renderer is enough. |
| Should batch syntax block the review feature? | No. Existing single-object checks are sufficient for a bounded optional check. |
| Can an inventory token prove source stability? | No. Record hashes/times; label active/draft collection non-atomic and check drift explicitly. |
| Does no predecessor prove a new object? | No. Keep baseline uncertainty and avoid a creation/release verdict. |
| Should test-transport filtering/history paging be copied from SAP's client? | No. Preserve metadata, but require observed backend fixtures before enabling rules. |
| How will humans and LLMs navigate it? | Short task-to-file map, explicit status fields, one quickstart, compact tables and linked deep evidence. |

## Definition of done

The draft PR has a focused diff, reproducible regressions, recorded live limits, passing applicable
checks, a short user guide and roadmap impact. Claude's exact-head review is recorded with each
finding accepted/fixed or rejected with evidence. Remaining backend research is named, not disguised
as supported functionality. Nothing is merged, deployed or released by this task.

Review findings and measured results: [validation log](../research/2026-10-17-transport-review-validation.md).
