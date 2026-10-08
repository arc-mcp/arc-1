# Reference searches at a source position (#929)

## Research and reproduction

Current main (`907b02c0`) reads `line` and `column`, but the references handler never
puts them in the where-used URI. SAP therefore searches the whole object. PR
[#929](https://github.com/arc-mcp/arc-1/pull/929) correctly uses the existing ADT
`#start=<line>,<column>` convention and carries SAP's `resultDescription` through
as `searchedFor`. Keeping the existing array-returning `findWhereUsed` wrapper
preserves its other callers. No new service, cache, or schema is needed.

Independent direct-client research on 2026-10-07 used the contributor commit
`a5061d0a` merged with current main (`c1174ef7`), Node 24.11.1, Basic authentication,
verified HTTPS, and read-only ADT requests. SAP_BASIS releases were freshly
confirmed as 750 SP02 and 758 SP02. The main handler was loaded directly from
`origin/main` for the 758 before/after comparison; shared unchanged transport and
where-used parsing were reused.

| Scenario | Main / native SAP | Contributor candidate |
| --- | --- | --- |
| 758 `CL_ABAP_CONV_IN_CE`, GET_BUFFER at 73,12 | main: 760 whole-class entries | 0 entries; description names GET_BUFFER |
| 758 same line, column 0 | main: 760 entries | 760 entries; description names the class |
| 750 same method at 73,12 | whole-object control: 11 entries | 0 entries; description names GET_BUFFER |
| 750 same line, column 0 | whole-object control: 11 entries | 11 entries; description names the class |
| 758 `IF_HTTP_EXTENSION/source/main#start=15,12` (HANDLE_REQUEST) | raw SAP: 117 entries | **207** entries despite method description |
| 758 same cursor on interface root URI | raw SAP: 117 entries | 117 entries because augmentation accidentally queries the interface name including the fragment |
| 750 both interface URI forms | raw SAP: 7 entries | 7 entries plus an irrelevant failed interface-implementer warning (SEOMETAREL endpoint unavailable) |

The second bug is whole-interface enrichment: `lookupLiveUsages` appends
SEOMETAREL implementation relationships to every interface result, even when SAP
searched a method. Those relationships do not prove references to that method.
The regex also includes fragments in the interface name for root URIs. Skipping
that enrichment for fragment-scoped lookups fixes both without parsing localized
SAP descriptions.

Two smaller gaps remain: invalid positions are checked after FUNC/TABL URI
resolution can already call SAP; and older/simple responses without a result
description leave the requested symbol scope unconfirmed with no warning.
Existing focused suites pass (184 tests), so these interactions require new
regressions.

## Simple implementation plan

1. Continue PR #929. It permits maintainer changes, addresses the correct issue,
   and its main approach is valid. Preserve the contributor commit and normal
   merge of current main; add review fixes as a new commit, never force-push.
2. Validate explicit reference coordinates before symbolic URI resolution. Require
   both integer coordinates, line >= 1 and column >= 0. Preserve replacement of
   an existing fragment and existing no-position behavior.
3. Treat a non-empty URI fragment as a scoped lookup. Return SAP's `searchedFor`
   when available, including existing SAP member fragments. If SAP omits the
   description (also on the legacy fallback), retain results with a concise
   warning that the searched symbol could not be confirmed.
4. Skip whole-interface SEOMETAREL augmentation for scoped URI lookups. Retain it
   unchanged for whole-interface searches. Do not guess scope from localized
   descriptions or fetch extra metadata to repair the scope.
5. Add focused regressions for root/source interface cursors, data/SQL enrichment
   remaining available without a cursor, invalid FUNC/TABL coordinates before
   lookup, fallback fragment forwarding, and absent result descriptions. Update
   the reference documentation to explain these limits.

## Review and validation

- Review this plan before changing runtime code.
- Run focused code-intelligence/navigation tests; demonstrate the new regressions
  fail against the contributor candidate and pass after the change.
- Recheck the final branch against 750/758: class method, whitespace fallback,
  interface method root/source, numeric-string arguments through tool dispatch,
  and invalid positions without an SAP request. No new ABAP objects required.
- Run typecheck, lint, policy, build, size/schema checks, and the complete unit
  suite under supported Node 24; review the resulting diff independently and
  resolve findings before publication.
- The 816 live target currently reports an expired-license E00179 error according
  to the sibling workstream; do not claim independent 816 coverage. Contributor
  757/816 evidence remains separate. Principal propagation is not retested here.

## Roadmap

Checked `docs_page/roadmap.md`: no roadmap impact. FEAT-80 is the separate
completion repair. This change repairs the existing references action and adds
no new feature scope.

## Plan review and implementation

The parent reviewed and approved this plan before runtime implementation on
2026-10-07. The implementation uses one fragment-presence check in the shared
lookup; it does not interpret SAP's localized description or add metadata calls.
The contributor's request formatting, parsing wrapper, and documented cursor
convention are retained. The interface-name regex also excludes `#` so an empty
fragment continues to behave as a whole-object lookup.

Seven additional regressions failed against the contributor candidate, then
passed after the follow-up: three interface-member URI forms, early FUNC/TABL
validation, absent result description, and cursor forwarding through the legacy
fallback. Existing whole-interface augmentation tests continue to pass.

## Final validation (2026-10-07)

The final runtime source was tested directly with Node 24.11.1 against SAP_BASIS
750 SP02 (NPL) and 758 SP02 (A4H), client 001, via verified HTTPS and Basic
authentication. The branch base was merge `c1174ef7` with the reviewed follow-up
changes recorded in this PR. No SAP object was saved or changed.

| Final scenario | 750 | 758 |
| --- | --- | --- |
| Main handler with GET_BUFFER position 73,12 | 11 class entries | 760 class entries |
| Final handler with GET_BUFFER position 73,12 | 0; method description | 0; method description |
| No-position control | 11; no scope field | 760; no scope field |
| Whitespace at 73,0 | 11; class description | 760; class description |
| HANDLE_REQUEST at 15,12, interface root URI | 7 native entries; no warning | 117 native entries; no warning |
| Same cursor, interface `/source/main` URI | 7 native entries; no warning | 117 native entries; no warning (was 207 before review fix) |
| Numeric-string coordinates via `handleToolCall` | same method result | same method result |
| Incomplete position with FUNC/TABL symbolic input | rejected; 0 HTTP calls | rejected; 0 HTTP calls |

Automated checks: 191 focused tests passed; complete suite 259 files / 7,863 tests
passed. `npm run typecheck`, `npm run lint`, `npm run validate:policy`,
`npm run build`, `npm run check:sizes`, and `git diff --check` passed. Lint reports
two informational suggestions in unchanged files, with no errors or warnings.
The seven follow-up tests were also run before implementation and all failed,
confirming they exercise the missed behavior.

The old simple-reference fallback and missing-description warning are covered by
unit tests; the available live releases use the native POST response. Independent
757/816 and principal-propagation coverage is not claimed. No roadmap change was
needed after rechecking the current idea list.

## Final independent review

The parent independently reviewed the entire PR diff, the new regressions, the
plan, and the live evidence on 2026-10-07. No actionable findings remained.
Publication was approved after the successful checks above. The original
contributor commit remains in history; the follow-up is a separate fix commit.

## Re-review: preserve whole-interface fallback enrichment (F3)

The subsequent external review identified a gap in the original conservative
fragment rule. A cursor on whitespace or a comment can make SAP search the
original whole interface. Suppressing SEOMETAREL augmentation then changes that
whole-interface result: the review observed 151 native entries instead of 241
with implementers on 758 (CLAS/OC: 26 instead of 116), and the existing 750
incomplete-enrichment warning disappeared. The member and other-type cases must
still remain native-only.

The reviewed proposal uses SAP's structured `referencedObjectIdentifier` result
attribute rather than the localized description. Its exact empty value signals
fallback to the URI's original object. A nonempty identifier selects a member,
the interface name itself, or another type referenced in its source. An absent
attribute is not an empty attribute and must not enable enrichment.

### Proposed refinement

1. Carry optional `referencedObjectIdentifier` in the internal
   `WhereUsedLookup`, preserving exact empty strings and attribute absence.
   Do not use `asOptionalString`, which intentionally discards empty values.
   Keep this metadata internal; the model-facing result remains unchanged.
2. Allow existing whole-interface augmentation when no fragment was requested
   or SAP explicitly returned the empty identifier. Keep nonempty/missing
   identifiers and the legacy fallback endpoint native-only for cursor calls.
   Reuse the existing SQL/data authorization and failure-warning paths.
3. Preserve an enrichment-denial warning if SAP also omits its result
   description. Append the existing missing-description warning without losing
   the more specific incompleteness or policy warning.
4. Add parser and lookup regressions for empty versus absent attributes,
   member/other-type identifiers, SQL and data-preview enrichment, denied data
   permissions, failed enrichment, missing descriptions, and the legacy
   fallback. Update the reference documentation to describe the explicit
   whole-object exception. No schema change or new metadata request is needed.

The plan requires independent read-only reproduction on 750/758 before runtime
implementation, parent review, red/green focused regressions, final live checks,
all standard gates/full suite, and independent final review before normal push.
Latest main and the published PR head were fetched: `907b02c0` and `d8eb1b29`.
Roadmap rechecked: no impact; this corrects the existing reference repair.

### F3 review and verification

The parent reviewed and approved the refinement before implementation on
2026-10-07, including the warning-preservation case. Independent baseline calls
against published `d8eb1b29` reproduced the review's 758 counts exactly and
confirmed loss of the 750 enrichment warning. Raw SAP responses on both releases
explicitly contained an empty identifier on blank/comment fallback, a nonempty
`ABAPFullName;\TY:IF_HTTP_EXTENSION\ME:HANDLE_REQUEST` for the method, and
`ABAPFullName;\TY:IF_HTTP_SERVER` for the other referenced interface. Selecting
the interface's own name at line 2, column 12 also returned a nonempty identifier;
that case remains native-only without interpreting the identifier text.

The new regression cases distinguish a missing attribute from an exact empty
value, preserve native results for all nonempty identifiers, exercise both SQL
and structured data-preview enrichment, enforce disabled data access, retain
policy-denial warnings with and without a description, and preserve the legacy
fallback. Six assertions failed on the previous runtime and passed after the
fix; the additional preservation cases were already green.

Final built JavaScript from `npm run build` was tested directly on 750 SP02 and
758 SP02 via verified HTTPS/Basic, client 001, Node 24.11.1, without any SAP
writes. `IF_HTTP_EXTENSION/source/main` results were:

| Selection | Coordinates | 758 all / CLAS | 750 all / CLAS |
| --- | --- | --- | --- |
| No cursor control | — | 241 / 116 | 7 / 1, enrichment warning |
| Blank fallback | 4,0 | 241 / 116 (previously 151 / 26) | 7 / 1, warning restored |
| Comment fallback | 1,0 | 241 / 116 (previously 151 / 26) | 7 / 1, warning restored |
| HANDLE_REQUEST member | 15,12 | 117 / 25, unchanged | 7 / 1, unchanged |
| Interface name token | 2,12 | 151 / 26, unchanged | 7 / 1, unchanged |
| Referenced IF_HTTP_SERVER | 17,28 | 608 / 121, unchanged | 57 / 11, unchanged |

The final follow-up passed 203 focused tests and all 259 files / 7,875 unit
tests. Typecheck, lint, policy validation, build, size/schema budgets, and diff
whitespace checks passed. The same two unrelated informational lint suggestions
remain. No schema or public result-shape change was made. Roadmap rechecked:
no impact. The existing 816 license and principal-propagation coverage gaps
remain; no new claim is made for those environments.

### F3 final review and publication

On 2026-10-08, the parent and the independent completion reviewer examined the
final runtime, regressions, documentation, and evidence. Neither found an
actionable issue. The parent approved a separate conventional fix commit and
normal push to the existing PR. Main was fetched again and remains `907b02c0`;
the remote PR head remains the expected `d8eb1b29`. Both main and the original
contributor commit are ancestors. The roadmap was rechecked with no impact.
The runtime and tests are unchanged from the successful 2026-10-07 validation.
