# Independent RAP follow-up review

## Verdict

**Request changes before private integration: one newly confirmed P2 source-plan completeness gap.**
Both original review1 P2 findings are closed by the follow-up.

Candidate: `755eb70a4f88a5e1c0a594ceca4e5d189619b71c`.
Previously reviewed base: `dec70f489a21374698f9fe803f7778132ed2ad12`.
This is an independent private-integration review under the authorized Codex fallback, not native,
PP, public-admission or whole-PR approval. I authored neither the RAP changes nor their tests.

## F1 — P2: Verify actual handler bindings when an existing method hides a required handler

Primary location: `src/handlers/write/pinned-rap-runtime.ts:201–209`, especially the generated-plan
acceptance at lines 202–204. Related validation: `src/adt/pinned-rap-plan.ts:107–110`.
Shared behavior: `src/adt/rap-handlers.ts::findMissingRapHandlerRequirements` and
`parseClassDefinitionMethods` index a declared ABAP method name even when it is not the required
RAP handler binding.

The new token proof correctly maps BDEF declarations to extracted requirements, but accepting the
resulting class plan still assumes the shared name-only missing-method check proves those handlers
exist. If `lhc_item` already contains `METHODS approve.` and an ordinary `METHOD approve.` body,
a BDEF action `Item~approve` is treated as satisfied despite having no handler declaration.
The same occurs when that declaration binds `Other~approve` or a determination instead of the
required action.

Independent real-handler/mock-HTTP probes add a second valid `reject` action. **Both private
RAP actions** then issue exactly one PUT adding only `reject`, retain the unrelated/wrong `approve`
declaration, and return successful `saved-inactive`. Six expected-refusal assertions fail across
the three collision forms and both actions. `plan.unresolved` is empty because the missing-member
finder silently skipped the required binding. This can leave an incomplete implementation while
reporting successful generation; it is not a target/package authorization bypass.

Before accepting any source plan, establish that each selected requirement has the correct
handler binding in the final source, including cases satisfied by existing methods. Refuse before
PUT if a plain or incompatible declaration hides the requirement. Preserve valid semantic method
renaming: a method `do_approve` correctly bound `FOR ACTION Item~approve` must remain accepted.
A same-name ordinary utility can also coexist when another method supplies the correct binding;
do not replace this gap with a blanket name-collision refusal.

Evidence: `codex-variant-probes.test.ts` and `codex-probes-final.log`; `EXISTING_COLLISION` records
contain the exact replacement bodies, one PUT and `saved-inactive` for both actions. The positive
renamed-handler and renamed-handler-plus-utility controls both pass and retain their existing
bodies. This is a newly reproduced inherited/shared-origin gap within the requested signature
collision review, not a regression introduced by the new BDEF token parser.

## Original finding dispositions and reviewed changes

- **Review1 R1 closed.** Header separators are restricted to horizontal whitespace, with complete
  entity/alias correspondence to the shared parser. Original split-line probes refuse without save;
  the committed suite covers header separators, CRLF, comments, selected aliases and valid tabs/case.
- **Review1 R2 closed for the BDEF admission layer.** The new bounded token consumer derives the
  expected entity/alias/kind/method/signature set and compares it one-to-one with the shared
  extractor. Original feature-control and combined-authorization omissions now refuse. Full BDEF
  validation precedes alias selection; unselected unsupported clauses cannot evade it.
- The explicit managed/unmanaged subset and its different unsupported-contract reasons are
  documented. Supported unmanaged read/global-auth and action cases, single-mode authorization,
  static/factory forms, managed associations and selected multi-entity cases remain covered.
  Native/compiler completeness is not implied by the lexical subset. No additional blanket
  unmanaged restriction is requested by this review.
- The independent literal/annotation and repeated-apply probe passes: masked strings do not add
  requirements and a second no-op preserves source without PUT.
- The batch Object.hasOwn fix is present and its interaction tests pass. It was separately accepted
  by root; this review does not duplicate that audit or treat it as a new RAP correction.

## Checks and reuse of unchanged review

- **Eight focused/legacy files / 546 tests passed** in `codex-focused.log`: new parser cases,
  existing RAP lifecycle/evidence, shared pure generator and legacy orchestration/concurrency,
  plus the interacting batch tests.
- Original immutable review1 probes, redirected only to this snapshot: **8/8 passed** in
  `codex-probes.log`, also repeated in the final combined probe run.
- Final independent probe run: **18 tests, 12 passed and 6 expected-refusal failures** for F1.
  Passing controls include original uncertainty/no-replay and opaque preservation checks,
  supported single-mode authorization, selected mixed-mode entities, valid renamed handlers,
  a renamed handler with a same-name utility, and annotation/repeated no-op behavior.
- Source/scripts/tests typecheck passed: `codex-typecheck.log`.
- Full lint passed without edits: `codex-lint.log`; three existing informational suggestions.
- No full unit/build/docs run was redundantly repeated. The bound author2 report retains its
  final 527-file/14,871-test and full-gate evidence; those results are not relabeled independent.

The supplied exact follow-up diff changes only the BDEF/private-plan validation, documentation,
parser tests and the separately accepted batch input fix. The RAP runtime was additionally compared
byte-for-byte with the prior reviewed snapshot and is unchanged. Review1's protocol assessment is
reused for unchanged exact-owner/mapped-context, package/recording, source freshness, lock/include
initialization, deadline/no-replay, partial outcomes, activation/readback, cleanup and public-closure
code. The newly confirmed source-plan hole above is explicitly excepted from that reuse.
Review1 provenance: `/Users/marianzeis/.local/state/arc1-review/pr1142-rap-review1-20261102-221004/codex-verdict.md`,
SHA-256 `e55b77b616380193ef8e523eb4211f90cfe45b39e8d3165baaf1e9673a54cf2e`.
FEAT-93 was read at start/end and continues to describe the private/native/PP/public gaps.

## Integrity, limits and incidents

First and final source actions were `/opt/homebrew/bin/python3 review-input/verify-snapshot.py`.
Both confirm **4,644 unchanged bound files** at the exact candidate. The final result is retained
in `codex-final-integrity.log`. This verdict was written outside the snapshot afterward; no source
action followed the final verifier. All checks used existing dependencies and Node 22.21.1.

Temporary probes/configuration/logs are outside the snapshot. One initial probe-file construction
had a Python literal-quoting error before the file was written; it was corrected outside the
snapshot. No source or production behavior changed. There were no installs, manual Git operations,
delegation, credentials/.env reads, external network/SAP/browser access, deployments or native
qualification commands. HTTP evidence is modeled, not a live SAP activation observation.

After correcting F1, an exact-candidate independent re-review is still required. Current native
behavior-pool/BDEF/include contracts, local/transported recording and lifecycle outcomes, whole-owner
activation and two mapped PP writers remain open. Public mutation admission and whole-PR merge
readiness are separate decisions. The class lock still does not make the BDEF dependency atomic.
