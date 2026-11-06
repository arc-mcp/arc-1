# PR #930: verify and finish ADT completion repair

## Problem and evidence

`SAPNavigate(action="completion")` on main posts to the nonexistent plural
`/sap/bc/adt/abapsource/codecompletion/proposals` endpoint, sends the cursor as
separate query parameters, and expects `<proposal>` XML. These are three parts
of the same broken wire contract; changing only the endpoint cannot repair it.

On 2026-10-07, direct Basic-auth read-only calls through the HTTPS nginx endpoint
on A4H (SAP_BASIS 758 SP02, client 001) reproduced HTTP 404 with main's exact
request. Contributor head `05364201` plus current main (`e1137f0f` local merge)
was built with Node 24.19.0. With the same posted source, the candidate returned
`LV_COUNTER` for an unsaved local declaration, three `DAT` keyword proposals,
four `DESCRIBE_BY_*` methods, 50 `cl_` matches with `truncated: true`, and an empty
complete list for `zzqqxxvvww`. No SAP object was saved or changed.

The existing patch agrees with the maintained
[abap-adt-api implementation](https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/syntax.ts):
singular `/proposal`, an encoded `uri` containing `#start=line,column`, posted
source, and `SCC_COMPLETION/IDENTIFIER` records. That client discards `@end`;
#930 additionally exposes it as truncation. The PR reports matching 757/816
observations. Its media type is `application/vnd.sap.as+xml`, and its result is
`{proposals: [{text}], truncated, hint?}`. No evidence supports inventing text
labels for numeric SAP `KIND` values.

## Approach

Continue [PR #930](https://github.com/arc-mcp/arc-1/pull/930), whose branch permits
maintainer edits. Preserve the contributor's commit, merge main normally, and
add reviewed follow-up commits. A replacement PR or broader completion API is
unnecessary.

1. Retain the contributor's focused request/parser repair. Use the conservative
   result envelope `{proposals: [{text}], complete, hint?}`: absence of `@end`
   confirms completeness; its presence does not prove that more matches exist.
   SAP 750 emits `@end` for an empty list and invalid positions as well as for
   truncated matches (verified in `CL_CC_ADT_RES_BASE->CALL_CODE_COMPLETION`).
   When `complete` is false, suggest checking the cursor/source or narrowing
   the prefix; do not claim a fixed cap or invent a total.
   Keep the `Intelligence` safety guard, fixed ADT endpoint, percent-encoded
   complete target URI, raw posted source, and explicit SAP errors.
2. Tighten source-URI validation: completion, like definition, must not attempt
   a symbolic type/name lookup before reporting a missing source URI. Such a
   lookup produces an object URI which SAP refuses for completion.
3. Clarify the existing LLM-visible `uri` description so definition **and**
   completion advertise source URI, line, column, and source requirements. Keep
   the existing properties and schemas; regenerate and review tool snapshots.
4. Add focused regression coverage for missing-URI validation without lookup,
   zero-based column acceptance, escaped identifiers, and backend error
   propagation. Retain existing request/media/fragment/empty/marker tests, including the real marker-only 750 response.
   Verify read-only default safety and deny-action enforcement without adding a
   new authorization path.
5. Complete the 750/758 live matrix (current and posted unsaved source, useful
   and empty lists, broad-prefix truncation, old-fragment replacement). Inspect
   raw responses/media, verify the `@end` interpretation, and attempt 816 when
   the shared test window is available. Record deployment/auth route and limits.
6. Keep FEAT-80 removed only after the original 750/758 acceptance cases are
   verified. Document the final evidence in a research note and this plan.

## Review and validation

Review this plan before implementation. Then run focused code-intelligence,
handler, schema-snapshot, and authorization tests, followed by typecheck, lint,
policy, build, size budgets, and the unit suite. Request an independent review of
the entire PR diff, resolve findings, and repeat the affected checks. Final
review precedes a normal push to `kts982:fix/navigate-completion`.

## Boundaries

No saved SAP changes, completion insertion/template APIs, numeric `KIND`
interpretation, result caching, broad XML parser refactor, or schema expansion.
The new result shape replaces an action that failed on the verified releases;
callers receive an explicit completeness flag without a false claim that an empty
legacy response contains undisplayed matches. BTP principal propagation and
unverified releases remain separately stated validation gaps.

## Plan review

The parent reviewed and approved the request/parser, URI guard, and tool hint on
2026-10-07. Independent 750 research then disproved the original truncation
interpretation: marker-only response for `zzqqxxvvww`, but no marker for one
`CL_IDENTITY_FACTORY`, one unsaved variable, keywords, or methods. Backend source
confirmed overloaded marker behavior. The amended conservative completeness
contract was approved by the parent before implementation.

## Implementation and verification record

- Retained the singular resource, cursor fragment and AS XML parser. Replaced the
  contributor's unverified truncation claim with the reviewed `complete` contract.
- Completion rejects symbolic names without a source URI before SAP lookup.
  Existing tool properties are unchanged; the URI description and nine snapshots
  now include completion requirements. The description stays inside existing
  file and schema budgets; no ratchet was raised.
- Focused 252 tests passed. Full final checks and independent implementation review
  are recorded in the PR. Initial full-suite failure was solely the longer schema
  description exceeding the token budget by one; shortening it resolved the gate.
- Final direct Basic-auth read-only builds passed the 750/758 live matrix, including
  unmodified backend source and unsaved declarations. See the
  [contract evidence](../research/2026-10-07-pr930-completion-contract.md).
- Rechecked the roadmap: FEAT-80's original 750/758 acceptance cases are complete;
  keep its removal. Fresh 816 verification was blocked by a SAP license failure;
  BTP principal propagation remains unverified.

Independent implementation review found that an unrelated HTTP 200 XML body could
be mistaken for an empty complete result. Added a minimal `abap/values/DATA`
envelope check, preserving valid empty DATA, and three wrong-envelope regressions.
This adds no broad XML validation or fallback behavior.

The independent reviewer rechecked the envelope correction and the full PR diff:
no further actionable findings. Final automated gates passed: 7,868 tests in 258
files, typecheck, lint, policy, build, file-size and schema budgets. Rebuilt 750
live cases passed again after the envelope guard.

The final 758 live guard check caught a regression: SAP returns HTTP 200 with an
empty body and no Content-Type for no matches, rather than an empty DATA envelope.
Added that exact empty-success case before the nonempty XML envelope guard, plus
a regression fixture; unrelated nonempty XML still errors. Repeated final live
and automated checks before publication.

The independent reviewer approved the exact-empty-200 correction; the rebuilt
758 matrix then passed, including empty body, complete keyword/method/local lists,
broad-prefix uncertainty and unmodified backend source. Parent final review found
no remaining actionable findings.

## Follow-up review F1: bound cursors to the posted source

An external review of published head `7e18fc3c` identified that the shared
`hasCursorAndSource` predicate validates coordinate types and lower bounds but
never checks the posted source. A line beyond the source or a column beyond its
line reaches SAP, whose 758 empty HTTP 200 response becomes `complete: true`.
750 uses `@end` for the same invalid position, so the same invalid tool input has
different apparent completeness. The valid empty-200 response must remain
supported; the correction belongs in input validation.

Parent reviewed and approved this follow-up plan before runtime edits:

1. Add failing handler regressions for completion and definition with lines and
   columns outside the posted source. Every rejected case must perform zero HTTP
   calls. Add boundary cases for a cursor at line end, zero on an existing trailing
   empty line, and CRLF without counting the carriage return as a source column.
2. Keep the shared predicate and existing explicit finite-integer/lower-bound and
   nonblank-source checks. Split source on LF/CRLF, require the selected line to
   exist, and allow `0 <= column <= selectedLine.length`. Do not introduce a
   cursor abstraction or alter references, URI resolution, or SAP response parsing.
3. Explain in both validation messages that coordinates must fit the source.
   Update docs to say SAP rejects non-source URIs without claiming one status on
   all releases, and clarify that unsaved source means edits to an existing SAP
   object, not a not-yet-created object.
4. Reproduce the old behavior on 750/758, then verify local refusals and unchanged
   valid local-variable/empty responses on the final build. Run focused tests,
   full unit suite and standard gates; request independent review before adding
   a visible follow-up commit and pushing normally to the existing PR.

Roadmap rechecked: FEAT-80 remains removed; this tightens its already implemented
cursor contract and does not introduce or close another roadmap item. Current
main and published PR head were fetched and compared before this work.

Independent reproduction at head `7e18fc3c`: both out-of-source cases made a SAP
request and returned `complete: true` on 758 but `complete: false` on 750. The new
shared-action regression matrix failed all eight invalid-position cases before
the fix; all ten line-end/CRLF/trailing-line positive controls already passed.

Follow-up verification: all 18 new cursor tests passed after the fix; full suite
7,886 tests in 259 files passed with typecheck, lint, policy, build and size/schema
gates. On rebuilt 750/758 clients, definition and completion rejected both invalid
positions with zero HTTP calls. The existing valid completion matrix passed again,
including unsaved local variables, line-end cursors, current backend source and
758's valid empty HTTP 200. Independent final review precedes the follow-up push.

On 2026-10-08, the independent reviewer rechecked the shared predicate, boundary
tests and documentation and reran 173 handler/cursor tests successfully. Parent
final review also found no actionable findings and approved publication. Latest
main remained `907b02c0`, already an ancestor; published head remained `7e18fc3c`.
The follow-up is a new commit with a normal push, preserving contributor history.
