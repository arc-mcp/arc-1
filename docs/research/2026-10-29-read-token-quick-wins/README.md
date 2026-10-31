# Focused SAPRead token improvements — implementation evidence

## Scope and contract

Three related changes keep successful implementation-body reads unchanged:

1. `CLAS` + `method` + `format="structured"` now fails before SAP access, including draft
   discovery. Previously structured format silently won and returned the whole class.
2. Method-not-found errors use the existing selected-source inventory to suggest at most five
   nearby implemented-method names. Declared methods without a body are identified separately. Ranking examines at most 2,000 candidates, caps names/query work at 128 characters,
   and retains local/interface qualification. The error directs callers to an explicit inventory
   or grep; it is not a complete inherited API listing.
3. `methodView="signature"` returns the named global class's own MAIN declaration. It is opt-in,
   uses existing read authorization and source/version/cache paths, and makes no additional
   metadata requests. It still downloads and parses MAIN; it reduces model context, not cold SAP
   transfer. The JSON text reports ownership, method, visibility and declaration line range, with
   an optional version warning.

The declaration reader scopes parsed statements to exactly one matching global DEFINITION.
It supports abstract methods, declaration-only sources, chained declarations, multiline parameter
text and classic exceptions. A selected chain clause becomes a standalone METHODS/CLASS-METHODS
statement. It never uses the older listing parser's synthesized signatures. Duplicate or incomplete
definitions, unknown declaration syntax, redefinitions and aliases fail explicitly. Interface or
superclass names from that definition provide bounded follow-up hints; their signatures are not
resolved automatically. Unsupported implementation syntax does not prevent a parsed declaration read.

Standard and hyperfocused dispatch share the guard. Both on-prem and BTP schemas expose the new
property. The wire-byte and estimated-token ceilings stay unchanged; overlapping SAPRead property
descriptions were shortened to fit. The description-count budget grows by one for the new property.

## Live read-only validation

The [machine-readable evidence](live-results.json) records all 16 scenarios, timestamps, source-file
SHA-256 fingerprints and token counts. Base revision: `90abdfc3`; the fingerprints identify the
modified code actually executed. Node 22.18.0, local `handleToolCall` dispatch over real ADT HTTPS,
direct Basic authentication with the existing authorized test identities, client 001, default
read-only safety. SAP_BASIS 758 on A4H and 750 on NPL were confirmed using installed components.
This is **not** a deployed remote-MCP/PP or BTP runtime qualification. No SAP object was changed.

All eight scenarios passed on each system:

| Scenario | SAP 758 response tokens | SAP 750 response tokens | SAP GETs per call |
|---|---:|---:|---:|
| HTTP CREATE_BY_URL implementation (existing path) | 4,281 | 2,649 | 1 |
| HTTP method inventory (existing path) | 2,062 | 1,261 | 1 |
| HTTP CREATE_BY_URL own declaration | 365 | 162 | 1 |
| GUI_DOWNLOAD own declaration, including exceptions | 577 | 577 | 1 |
| ALV REFRESH_TABLE_DISPLA typo with useful suggestion | 102 | 102 | 1 |
| HTTP SEND interface-owned declaration refusal/hint | 51 | 51 | 1 |
| structured + CREATE_BY_URL guard, with version=auto | 99 | 99 | 0 |
| structured + method="*" guard, with version=auto | 99 | 99 | 0 |

Counts use gpt-tokenizer 3.4.0/o200k_base on serialized ToolResult, consistently across these rows.
Decoded-content counts and byte sizes are recorded separately. These are response-size proxies,
not billed input tokens or measured end-to-end model success. The implementation keeps declaration
formatting and adds scope/range metadata, so its counts differ from the earlier compact prototype.

For the earlier body-then-inventory declaration workflow, the new explicit selector reduces returned
tokens from 6,343 to 365 (94.2%) on 758 and 3,910 to 162 (95.9%) on 750. This comparison assumes the
caller selects the new option; it is not a claim that every agent automatically does so.

The initial live harness expected a release field from `getSystemInfo`, whose actual contract is a
user/collection inventory. That assertion failed before the scenarios; release verification was
corrected to `getInstalledComponents`, then both complete scenario sets passed. No harness failure
is counted as live coverage.

## Regression coverage and limits

Focused tests live in `tests/unit/context/method-{signature,suggestions}.test.ts` and
`tests/unit/handlers/read-method-options.test.ts`. They cover both tool modes, both runtime schemas,
zero-request conflicting selectors, declaration ownership/ambiguity, unparseable declarations,
chain/comment/literal preservation, active/inactive/auto selection, JSON version warnings, typo
output bounds, local/interface qualification, and the unchanged body/list/full/grep behavior.
Existing structured-without-method tests and the full unit suite cover ordinary structured reads.
The old test requiring structured format to silently override method was intentionally replaced.

The original October 29 checks used active standard classes. The October 31 follow-up below adds
live BTP and HTTP MCP coverage. A real edited BTP draft and a deployed PP route remain untested.
No new caching, inherited resolution, default truncation, paging or automatic metadata-first policy
is introduced. Those require their own evidence and compatibility decisions; see FEAT-96 in the roadmap.

## October 31: missing-test audit and qualification

The audit found feature-specific gaps beyond the original parser and selector tests. Added coverage:

| Gap | Verification |
|---|---|
| Source cache vs. derived signature | Signature → body → full source across real mocked HTTP 304 replies; full source remains cached |
| Freshness and draft selection | `force_refresh`, separate active/inactive declarations, and `auto` selecting a known draft |
| Authorization and unavailable source | Per-user SAP revalidation, read-scope denial, and 403/404/410 without a cached-signature fallback |
| ABAP/resource boundaries | Namespaced class, escaped parameters, Unicode/literal punctuation, pragmas; 2,000-candidate ranking cap and duplicate hints |
| BTP runtime and MCP dispatch | 10 passing read-only cases in `btp-read-methods.integration.test.ts`, standard and hyperfocused SDK MCP requests over linked in-memory transports, real developer OAuth/ADT HTTPS |
| HTTP MCP wire path | 3 passing `sapread-methods.e2e.test.ts` cases against this checkout's local loopback HTTP server and the existing A4H fixture, direct Basic/ADT HTTPS |
| Model behavior | Four fixture-backed scenarios use the real read handler; full tool trajectories and final-answer assertions, not first-call scoring alone |

BTP reports SAP_BASIS 920 SP0005 and SAP_CLOUD 920 SP0005 via installed components. The tests read
`CL_ABAP_RANDOM`: declaration content/ownership, subsequent full/body reads with a
source cache, inactive fallback/refresh JSON, typo hints, and conflicting selectors. No SAP object
was created or changed. This is developer OAuth access to BTP ABAP, not a Cloud Foundry deployment
or principal-propagation qualification. The HTTP tests use the existing `ZCL_ARC1_TEST` fixture;
fixture synchronization was not run.

The [BTP measurements](btp-results.json) record source hashes and serialized ToolResult counts:
full class 3,943 tokens, body 98, inventory 844, own declaration 86, typo error 102, conflict error 99.
Each ordinary case performs one GET; the conflict performs zero. The declaration is 97.8% smaller
than the full class. For a parameter question, body → inventory costs 942 tokens versus 86 for the
explicit declaration (90.9% less). Against a single inventory read (844 tokens), the declaration is 89.8% smaller. The original
758/750 inventory-only comparisons are 82.3%/87.2%. These are response-size proxies, not
billable-token savings.

The [model results](model-evals.json) retain all local `qwen3.6:35b-mlx` runs. Two runs of the
pre-review wording each passed 3/4 strict completed trajectories: signature selection, inventory, and
typo recovery. Both selected the correct implementation read first, then made unnecessary calls
and exhausted the three-call budget before a final answer. A small wording experiment passed 2/4
and was reverted. It does not establish a model-level improvement. There is no pre-feature schema control, so these runs cannot establish a causal model improvement.
After the review fixes, a five-scenario run passed 4/5, including the new qualified-local-method
case. The implementation-only task still made extra reads. The eval remains strict;
failures are not hidden by weakening its expected trace. The harness reports the 83 unselected scenarios as skipped; they are not coverage from this run.

Recommendation: ship the bounded, opt-in read changes with this regression coverage. Next measure
why agents continue after a sufficient body read, across models and tool profiles, before changing
server defaults or adding automatic summaries. Returned source is only one cost: these full-tool
model runs also repeatedly supplied the entire schema/context. The present sample is too small
for general success-rate or billed-cost claims.

Local full-suite runs initially hit two existing subprocess timing limits while other jobs
were active (`cli/runtime` and `server/shutdown`). Both files passed serially (56 tests), then the final
full suite passed with two workers: 386 files, 10,682 tests. Typecheck, lint, build, policy coverage,
schema snapshots and size budgets also passed; lint retains two existing informational diagnostics.

## Claude Code review

The [independent review and dispositions](claude-review.md) cover the initial three findings.
All were addressed: explicit SAPRead follow-ups for read and write-surgery failures, exclusion
of unreadable declaration-only suggestions, and restored qualified-name examples. The legacy
listing parser is not broadened; unknown ownership is not asserted. The refreshed [per-test
qualification record](qualification-results.json) retains the live BTP/HTTP results and source
fingerprints, alongside the full unit-suite summary.
