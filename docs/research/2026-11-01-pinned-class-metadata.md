# Shared pinned class metadata surgery — implementation checkpoint

PR #1142 remains a draft. This checkpoint admits the existing class-action handlers for main-source
`edit_class_definition`, `edit_method_signature`, `add_method`, `delete_method` and
`change_method_visibility`. It does not qualify these new paths live or expand other type families.
The earlier local PP evidence at `77e41fdcd` remains tied to that revision.

## Shared protocol and evidence

The same `class-surgery.ts` callbacks serve single-target and pinned calls. The pinned context
supplies fresh package/recording preflight and under-lock checks, scoped non-replayable HTTP,
one editable-source save, exact read-back and bounded cleanup in the owning session. Metadata
and source reads use that same lock, deadline, selected owner and editable version. Every action
requires the editable main-source hash. `add_method` takes its declaration in `method`; deleting
or moving a method needs no submitted source. Signature edits keep the existing intermediate-save
behavior and deliberately skip whole-source lint. Other class actions retain configured lint;
the pinned result retains its warnings. No new per-call quality bypass is admitted.

`verifiedClassStructure` checks the native XML against an independent lexical source inventory:

- Exactly one CLAS/OC root for the requested uppercase owner and the expected namespaces.
- Only owner-relative main-source links; no source-version query, foreign origin or alternate
  resource. A supplied native base may carry only SAP client and language parameters; the client is compared,
  and the language value does not authorize a source range.
- Complete global declaration and implementation inventories, names, visibility, static/instance,
  abstract/redefinition state and exact token ranges. Split CLAS/OO + CLAS/OM metadata is checked
  without permitting duplicate definitions or implementations.
- Optional identifier links must select the actual class/method-name expression, including a name
  on a later line of a chained declaration. Native block ranges end at the terminating period/comma token, including whitespace before it.
  This corrects the first capture, whose punctuation directly followed the preceding token.
  Split metadata is covered by authored offline cases; SAP 7.50 has not been qualified here.
- The shared read parser's final result is checked again, so nested local-class metadata it ignores
  cannot overwrite an already verified global method. No returned URI is followed.

The shared splice helpers additionally prove that whole-line boundaries do not contain neighboring
statements. Individual chained declaration edits remain refused; insertion after a verified final
chain member is supported. Ambiguous metadata or unsupported syntax requires a complete editable
source update. The metadata response is bounded before XML parsing.

An already-correct visibility is an explicit `unchanged` result with the verified source hash and
no PUT. This marker is part of the shared callback protocol; it is not inferred from result prose.
It closes normally, and cleanup failure still returns an error. Confirmed saves retain hash,
transport and warnings on cleanup failure; unknown/rejected saves do not claim saved source.

At this checkpoint `edit_class_definition` with a local include remained denied; the subsequent
shared replacement adapter is described below. Existing include `update` and `edit_method` keep their separate admitted behavior.
Git/custom plugins and all unimplemented families remain refused. Global-off, read-only destination,
missing raw scope/exact target grant, aggregate and Basic routes remain mutation-free.

## Evidence and limits

A local replay of the previously captured read-only A4H `CL_ABAP_CONTEXT_INFO` source/native XML
passes the validator with all 12 global methods. That fixture includes a native chained declaration
and nested local test-class metadata. It is source/metadata compatibility evidence, not an actual
pinned mutation. Source SHA-256:
`037130349153fb070b26334014df01c05c85eea67e7d0ccd74815b7ac014aa85`.
The private original capture is dated 1 November 2026; no SAP class was modified for this probe.

Author validation before the last two defensive URI/boolean cases: 432 files / 11,709 tests,
all three TypeScript projects, build, lint, policy, strict documentation and file/schema budgets.
The 59 existing qualifier simulations also pass; their scenarios do not exercise this new metadata
adapter. Focused native-evidence and real-handler tests pass after those two final cases.

Tests exercise all five callbacks, exact splices and neighbor preservation, no-op, absent/stale hash,
wrong owner/source/version/client/ranges/inventory, duplicate/ignored nested metadata, package and
recording drift, cancellation, ambiguous save/read-back, warnings and unlock/session-close failures.
The selected body stays under the owner lock; refusal asserts no PUT. Route/catalog tests cover
all five actions and the existing read-only combinations. Legacy class/RAP tests remain green.

Required next evidence: Opus review of the fixed revision; reviewed live harness expansion with
real include methods and metadata operations; a fresh build/run binding and two mapped writers;
then transportable-object qualification with the later CTS work. These are not waived by unit
coverage. FEAT-93 remains open for these qualifications, all other
object/procedural/DDIC/RAP/batch/package/API/CTS/trace/FLP families and the shared-engine convergence.

## Whole-include convergence follow-up

`update` with a class include and `edit_class_definition` with a class include now enter the existing
shared action handlers and one `replaceClassInclude` adapter. The duplicated pinned update branch
was removed. Legacy and pinned calls retain explicit lifecycle profiles; the pinned profile uses
the same reviewed native include protocol, owner/package/recording checks, optional initialization,
exact existing-include hash and read-back. Its phase updates retain initialized/unknown/rejected
states and confirmed hashes through cleanup failures. Rejection classification is shared with
main-source writes. No action is rewritten to `update`, so the original deny-action checks apply.

The definition action replaces the **whole** selected include and retains its trailing-newline
normalization. Explicit `source=""` plus a hash now survives normalization for this action too,
allowing a guarded clear; omitted/blank/unhashed clears remain refused. This also makes the guarded
clear available through the single-target action. Normal whole-include update keeps its exact
submitted bytes. Both fragment paths skip lint/advisory syntax, now explicitly tested with both
checks globally enabled. No include initialization is added to `edit_method`.

Focused tests cover all four include kinds, guarded empty source in both profiles, initialization,
stale/absent hashes, definitive/unknown partial failures and cleanup. Source/metadata main surgery
still uses its own verified-read callback. This follow-up requires review and fresh live evidence;
the earlier run and earlier review snapshot are not retroactively extended to it.

Follow-up validation: 432 files / 11,733 tests, all three TypeScript projects, build, lint, policy,
file/schema budgets and strict documentation pass. The added whole-include cases are real shared
handler/native-client tests; the unchanged live harness still needs expansion before PP qualification.

### Shared source-edit lifecycle follow-up

Class and procedural unit surgery now use the same lock/read/hash/save/unlock adapter.
The class facet supplies native metadata; procedural unit editing supplies its existing parser.
Legacy cache-error handling stays explicit for each caller. This does not yet admit pinned
PROG/INCL edits or remove the remaining pinned CRUD orchestrator. All 11,733 unit tests
(432 files) and three TypeScript projects passed after extraction.

## Opus review at `aa4dfb14` and follow-up

The [verbatim review](broader-pinned-pp-writes/claude-class-adapters-review-20261101.md) was produced
by actual Claude Code `claude-opus-5-5` with launcher `--effort max`. Its SHA-256 is
`69dc1f9ade2dc382551bd13a64bdf521321edde3bda68377384a6d42ef6fef41`. It found **2 Medium and
5 Low** issues, no High, and explicitly kept this PR a draft. It independently passed 432 files /
11,711 tests, 59 existing harness simulations, three TypeScript projects and size checks. The
2,615-file snapshot was unchanged, including the author's verification after review. The report
discloses its command/read deviations and lack of live evidence. It predates the whole-include
convergence and shared procedural source lifecycle; neither is retroactively covered.

Follow-up dispositions, to be reviewed again:

1. Exact interface-qualified method names now receive the same cross-class ambiguity check as
   bare names. A containing-class qualifier selects the intended body; duplicate exact bodies
   also refuse. Parser and real pinned-handler regressions preserve the other class.
2. Shared helpers validate replacement declarations against the selected name and replacement
   definitions against exactly one owner block. Multiple declarations, renamed signatures,
   neighboring classes and single-member declaration chains refuse. Method-set comparison now
   counts every chained declaration. Legacy namespaced redefinitions retain their existing
   syntax exception by validating the one lexed declaration with only its name normalized for
   parsing; the actual submitted name/text is preserved. Malformed tails and extra statements
   still refuse. Both route profiles have negative tests.
3. Known boundary/chain refusals use `AdtSafetyError`; pinned callers receive the actual remedy.
4. GET-only A4H captures of `CL_HTTP_CLIENT` and `CL_ABAP_ZIP` exposed classic syntax, whitespace
   before punctuation and interface-body identifier links. Source-boundary parsing now uses the
   newest normal ABAP dialect; configured deployment-language lint remains separate. Interface
   bodies bind to the matching direct `INTERFACES` declaration and exact body, without following
   a link to another source. They do not become editable `METHODS` declarations. Local replay
   accepts 33 declared / 53 implemented methods and 7 / 7 respectively. Indirect interface
   references not proven from the selected source and unsupported parser syntax still refuse.
   This is author compatibility evidence, not a write or PP qualification; raw captures remain
   private. The [read-only observation receipt](broader-pinned-pp-writes/class-shapes-readonly-20261101.json)
   records hashes and before/after results. Older releases remain unqualified.
5. Added public authored chain/interface fixtures and tests for chain insertion, positive
   abstract/redefinition flags, a namespaced owner, no-op cleanup failure, real configured lint
   refusal, actionable pinned refusals, XML size and parent-request recording on metadata saves.
   Historical chain examples now use punctuation-start columns. These authored fixtures model
   the observed shapes; they are not exported SAP source or additional native runs.
6. Unchanged success/refusal results omit a transport selected during preflight. Confirmed saves
   still report their recording request.
7. The roadmap explicitly keeps shared-engine convergence pending. Language and historical
   pending-review/run wording was corrected; whole-include quality-skip tests already passed in
   the separate include-convergence follow-up.

No new bytes are PP-qualified. Both Medium fixes and these compatibility changes require another
immutable Opus review before the next live artifact is frozen.

Author validation of the review fixes: **432 files / 11,783 tests**, all three TypeScript
projects, build, lint, policy, strict documentation and file/schema budgets passed. The added
tests run the shared single-target and pinned handlers; the existing qualification simulations
still exercise their earlier harness, not the new metadata mutation scenarios.
