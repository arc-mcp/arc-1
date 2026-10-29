# Focused SAPRead token improvements — implementation evidence

## Scope and contract

Three related changes keep successful implementation-body reads unchanged:

1. `CLAS` + `method` + `format="structured"` now fails before SAP access, including draft
   discovery. Previously structured format silently won and returned the whole class.
2. Method-not-found errors use the existing selected-source inventory to suggest at most five
   nearby names. Ranking examines at most 2,000 candidates, caps names/query work at 128 characters,
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

Live checks use active standard classes. Draft/version behavior and BTP schema behavior are covered
by tests, not fresh BTP/PP live reads. No new caching, inherited resolution, default truncation,
paging or automatic metadata-first policy is introduced. Those require their own evidence and
compatibility decisions; see FEAT-96 in the roadmap.
