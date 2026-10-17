# Post-1.6 review workflows: implementation and evidence

Date: 2026-10-17. Read the October 16 handoff, implementation prompt, both detailed HTML reports,
eight synthetic observations, probe script, flight notebook and screenshot. The detailed report
supersedes the broad comparison. In particular, SAP ADT 1.2 does have whitespace-ignore support;
do not repeat the older blanket limitation or claim comparative superiority without a corpus.

## Priority decision

The highest-value next slice is trustworthy transport review evidence plus a deliverable report.
It improves an existing customer workflow and prevents missing/uncertain source from being
reported as unchanged. Ship/review the correctness slice before the optional workflow additions.

| Stage | Result | Validation boundary |
|---|---|---|
| 1: TD-01–04 | Retained failed selected includes, unattributed hunks, raw CTS/text scope; ambiguous undated work-state baselines | Synthetic regressions and existing live source history |
| 2: TD-05–09 | Explicit source modes, revision/hash evidence, bound collection and continuation, invalid-feed distinction | Live 758 review; no test-transport filtering or guessed history paging |
| 3: review artifacts | CLI collector; JSON/HTML; optional current syntax/context; complete/partial/stale offline demos | Whole workflow executed against the existing demo request |
| 4: notebook | Pure import and explicit SAPQuery execution, mappings, limits, scalar assertions, optional string-preserving results | Supplied flight fixture and real policy-denied run |
| 5: policy explanations | Current-caller evaluators with explicit unresolved prerequisites | Unit gate/package cases plus live read-only ceiling denial |
| 6: diagnostics | Native syntax batch; discovered dump schema/filters; advertised DDIC log reader | Native 758 contracts, including an old log with no attempt correlation |
| 7: wider history | Bounded investigation and concrete resume conditions | No unproven historical adapter enabled |

After this slice, use pilot coverage counts to choose the next historical family. For classic ERP
maintenance, text pools/FUGR/DDIC gaps are a stronger candidate than blanket type parity. For RAP
teams, collect actual DDLS/BDEF/SRVD review gaps first. A full notebook editor, generic RFC/action
execution, OData/SRVC authoring and admin-UI IDE expansion remain deferred. No concrete customer
workflow in this handoff justified further OData/SRVC work.

## Upstream and workspace revalidation

The research used `9775645400fdb27f37aff486f14fe9845ecf8639`. The isolated worktree was clean at
that revision; the normal checkout remained on `codex/readonly-ui-console` at `ceb5d6d00caa41864baee6ef455b368a3d00a166`,
with its existing untracked DemoJam/WebGUI research and tests untouched. Work lives on
`codex/post-1-6-review-workflows` in the supplied isolated worktree.

Upstream was checked again during implementation and incorporated through
`ce649ca9b64a3f3c8870be111210d0c4a0b9157c`: [#1002](https://github.com/arc-mcp/arc-1/pull/1002)
corrects missing-program advice; [#1003](https://github.com/arc-mcp/arc-1/pull/1003) fixes legacy
transport ownership. Neither duplicates this work. The final open-PR check included
[#1007](https://github.com/arc-mcp/arc-1/pull/1007) (legacy responses),
[#1006](https://github.com/arc-mcp/arc-1/pull/1006) (per-target source search),
[#970](https://github.com/arc-mcp/arc-1/pull/970) (1.6 release), #927, #906, #844, #843, #765,
#712, #711 and [#586](https://github.com/arc-mcp/arc-1/pull/586) (anchored editing). No competing
review/notebook implementation was identified. #906 is not authorization to broaden multi-target
writes. ADR-0006/7/8 and current repository instructions remain binding.

The package remains version 1.5.2 and the 1.6 release PR was open at inspection. Main, a released
package, and the deployed connector are distinct. The handoff's connector lacked transport diff;
the verification here used the local checkout CLI, not a claim that a deployed service was upgraded.
No PR was merged/published and no deployment was performed by this task.

## Live evidence (HTTPS 443, client 001, SAP_BASIS 758)

All requests used `https://a4h.marianzeis.de`, TLS verification on. No SAP repository writes,
activations, transport releases or policy changes occurred. Native syntax-check POSTs are
workload-producing reads. Local CLI verification narrowed `SAP_ALLOW_WRITES=false`.

| Probe/run | Observed result | Measurement |
|---|---|---|
| Review `A4HK906371`, released, syntax/context | 2 logical objects, 3 reviewed/changed source parts, no coverage gaps; class main `+1`, helper `*2→*3`, report change | First page: 10 reads / 10 actual sends / 18,704 response bytes / 1,742 ms; output 6,869 bytes |
| Full checked review CLI | 2 active syntax checks passed with stable before/after hashes; 2 current dependency contexts returned | 10 intent calls including inventory recheck, 14.59 s wall time, 346,128,384 bytes peak RSS on this workstation |
| Flight notebook | 6 rows, total 6, strings retained, results exported only by explicit flag | Backend 61.655 ms; SAPQuery handler 425 ms in the measured run |
| Flight with free SQL disabled | SQL cell blocked, whole run partial | No successful query evidence; safety error propagated |
| Public syntax batch | Class + program both processed, 2/2 checked | 291 ms handler; 661-byte result |
| Runtime-error typed filter | Accepted by 758, no matching rows in this sample | 202 ms handler; separate contains/date-range probes also HTTP 200 |
| DDIC log for `ZARC1_TD_DOM` | Advertised relation GET returned 9 hierarchical entries; text says August 3 activation | 207 ms handler; 2,454-byte result; activation time unknown/correlation not established |
| Proposed delete explanation | Denied by current read-only ceiling; no proposed mutation executed | 9 ms handler |

These are single-run observations, not benchmarks or production sizing claims. CLI startup and
capability probes repeat between intent calls and are outside page counters. The whole-process
RSS includes the TS runtime and loaded ARC-1 dependencies; it is not incremental review memory.
The fixed history probe recorded 17 main-budget sends, 30,843 bytes and 2,986 ms, with a separate
bounded DDIC-reader scope outside those send/byte counters. Its whole-process peak was 187,856 KiB.

Artifacts under ignored `test-results/`:

- `review-live-final/{evidence.json,report.html}`: checked live review.
- `notebook-live/{evidence.json,report.html}` and `notebook-denied/`: successful and blocked runs.
- `workflow-demos/{complete,partial,stale}.{json,html}`: visibly synthetic offline fixtures.
- `review-contract-probe-final/evidence.json`: bounded metadata/history investigation.
- `diagnostic-calls/`: exact public-action inputs and returned tool envelopes.
- `transport-probes-after.json`: original observation script rerun; its historical case labels are unchanged.

Reproduce demos with `npx tsx scripts/demo-review-workflows.ts NEW_DIRECTORY`. The fixed read-only
contract probe is `scripts/probe-review-contracts.ts`; supply existing authorized SAP environment
credentials and a new output directory. No credentials are written into evidence.

## Historical contracts and remaining limits

| Family | Evidence inspected | Decision / resume condition |
|---|---|---|
| Text pools | Current program/class metadata HTTP 200, no history relation in these samples | Preserve REPT gap. Need two historical text-only versions, languages, symbols/selections/headings |
| DOMA | SPRAS: active only. ZARC1_TD_DOM: one numbered snapshot attributed to A4HK906369 plus active | Historical endpoint exists; need two differing historical payloads and stable field semantics before adding adapter |
| DTEL/TABL | SPRAS/T000 advertised history, active only in samples | No claimed before/after metadata coverage; need two numbered versions and deletion semantics |
| FUGR | Existing ZARC1 group search + metadata; advertised main history returned active only | Need structural includes, owner mapping and two numbered snapshots. Whole main history is not complete group coverage |
| Methods in different requests | Existing main+CCIMP sample validates part changes, not simultaneous method ownership | Preserve METH keys and whole-part scope note; require controlled/existing two-request fixture |
| Transport of copies | No `isTestTransport` flag observed in inspected histories | Preserve parser flag; no exclusion rule. Need intermediate flagged snapshot and direct flagged-request review |
| History pagination | No continuation advertised in inspected feeds | Synthetic `rel=next` produces partial evidence. Need actual backend continuation contract before following |
| Deletion/Customizing/table keys | No representative controlled historical fixture in this bounded pass | Keep explicit unsupported inventory; 404 cannot prove deletion |
| DDIC activation log | Standard objects lacked relation; demo domain advertised canonical GET with log MIME | Reader implemented for observed profile. No new-attempt correlation, timezone inference or recursive log traversal |

The table history link was `./t000/source/main/versions`; resolving it relative to a forced
trailing slash initially produced a 404. Resolving this advertised self-relative form against the
metadata resource returned HTTP 200. The maintained probe records that distinction; it is not
evidence of unsupported table history.

## Checks and review boundaries

Use Node 24.11.1 for the recorded checks. Regression tests cover TD-01–04 mixed cases, explicit
modes, malformed/partial feeds, UTF-8 wide hunks, bounded whole-class pages, response-budget
exhaustion, cancellation, continuation identities, stale checks, malformed collector pages,
HTML escaping, notebook mappings/precision/policy failures/assertions, typed filter rejection,
native syntax report coverage and safe DDIC relation following.

The initial full run found stale test expectations/docs/schema budgets, which were corrected;
three shutdown timing tests failed under four-worker load and passed in isolation. Final checks
use two workers. The last full run passed **8,927 tests in 316 files** in 121.64 seconds.
Build, all three TypeScript configurations, Biome, strict MkDocs, policy validation (133 entries / 14
schemas), file-size and all schema-wire budgets passed. Full on-prem tools/list is 73,739 bytes,
under the unchanged 74,500-byte ceiling. Biome emitted informational suggestions, not failures.
The earlier wording expectation was fixed and snapshots regenerated. No broad SAP CRUD suite was
run, since SAP mutations were not part of this task. The live and partial HTML reports were also
visually inspected in the browser; the live report adds clearly separated model observations
with object/part/hunk references.

Compatibility: legacy transport selection and existing fields remain. New evidence fields are
additive; failed class parts are intentionally no longer omitted. Invalid history now throws
instead of looking empty. The CLI requires schemaVersion 1 evidence. Empty/no-predecessor diffs
never establish release readiness. Policy explanations remain partial for action-specific
prerequisites; they are not permission leases. Current active checks never validate an older
snapshot. Report collection is not atomic and does not establish QAS/PRD deployment state.

Roadmap impact: remove fulfilled FEAT-69; narrow FEAT-71 to attempt correlation and FEAT-74 to
richer grammar/feed families; add FEAT-86 historical coverage and FEAT-87 explanation adapters.
The roadmap remains deferred ideas with evidence/resume triggers, not an execution queue.
