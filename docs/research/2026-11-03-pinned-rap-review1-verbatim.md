# Independent private RAP review

## Verdict

**Request changes before private integration: two P2 findings.**

Reviewed candidate `dec70f489a21374698f9fe803f7778132ed2ad12` against base
`ba0f21182871d14b1f072a6dd418e21b0b05fd59`. This is an independent review of the new
private RAP profile and its shared dependencies, not native qualification, PP qualification,
public admission, or whole-PR approval. The reviewer did not author this RAP delta or its tests.
Codex was used under the authorized fallback after Claude capacity was exhausted.

## Findings

### R1 — P2: Enforce the same-line alias boundary before invoking the line-oriented generator

Location: `src/adt/pinned-rap-plan.ts:70–79`, particularly line 71.

The new private guard promises an explicit same-line alias, but its `\s+` separators also
consume newlines. The shared `parseBehaviorBlocks` parser reads one line at a time, so a BDEF
containing `define behavior for ZI_RAP_TEST\nalias Item` passes the private guard while the
shared parser does not see `Item`. It falls back to the derived alias `RAP_TEST`.

Independent probes through **both actual private actions and the real mocked HTTP stack**
produced one include PUT, generated `lhc_rap_test` and `FOR ACTION RAP_TEST~approve`, and
returned successful `saved-inactive`. The BDEF still declares alias `Item`. The generated-plan
validation repeats the same insufficient check and does not catch this wrong binding.
This can save an incorrect implementation before any optional activation catches it.

Bound separators to horizontal whitespace for the deliberately supported same-line contract,
and/or verify that every parsed requirement's entity/alias identity agrees with the declarations
recognized by the admission guard. Refuse the unsupported layout before saving. Add before/after
regressions for both actions with default/omitted `targetAlias`, plus a normal same-line control.

Evidence: `codex-probes.test.ts`, tests named `independent review: %s refuses unsupported
split-line alias before save`; `codex-probes.log` contains both `SPLIT_ALIAS` records with the
exact submitted replacement and successful outcome. Both expected-refusal assertions fail.

### R2 — P2: Reject unhandled handler forms rather than silently treating the subset as complete

Location: `src/adt/pinned-rap-plan.ts:80–90`; unsupported-family admission at lines 56–62.

The private completeness check counts only action/determination/validation declarations. It
therefore admits additional handler requirements which the reused generator silently omits.
Two independent examples are `authorization master ( global, instance )` and
`action ( features: instance ) approve`. The shared parser recognizes only separate single-mode
authorization clauses (`src/adt/rap-handlers.ts:159–160`) and implements no feature-control
handler family. For each example, the private path generated only `approve`, sent one include
PUT, and returned successful `saved-inactive`, without reporting the omitted requirements.
Single-mode instance and global authorization controls do generate their respective methods.

These are limitations of the inherited generator, but the new private envelope is responsible
for keeping unsupported contracts outside its admitted complete-plan path. The general
parser/parity disclaimer does not identify these accepted omissions in the result, and the
known unsupported families are otherwise explicitly refused. Saving a known incomplete set
and describing the operation as successful defeats that boundary.

Keep ordinary single-target behavior unchanged. Either reject these unsupported clauses before
any initialization/save, or deliberately extend and verify the shared parser and its complete
requirement mapping. Preserve the accepted syntax and the remaining limitation explicitly in
the private contract. Add regressions for both omissions and the recognized single-mode controls.

Evidence: `codex-probes.test.ts`, tests `unsupported feature-control handler cannot silently
pass completeness` and `combined authorization cannot silently pass completeness`;
`codex-probes.log` contains `FEATURE_CONTROL` and `COMBINED_AUTH`, each with one PUT,
only the action method, and successful `saved-inactive`. Both refusal assertions fail.
These are modeled parser/HTTP observations; no SAP activation behavior was asserted or tested.

## Checks and positive observations

- **15 existing focused/legacy test files, 641 tests passed**: 297 in `codex-focused.log` and
  344 in `codex-legacy.log`. This includes the 80 private RAP tests, pure RAP generator tests,
  shared class-include/lifecycle tests, public capability/inventory checks, legacy RAP handler
  and concurrency tests, source-precondition and dispatch regressions.
- **Eight independent adversarial/control probes**: four expected-refusal failures above and
  four passing controls. The passing probes establish one uncertain PUT without replay or
  activation and with owning-session close, preservation of an existing opaque implementation,
  and generation of recognized single-mode instance/global authorization methods.
- `npm run typecheck` passed for source, scripts and tests: `codex-typecheck.log`.
- `npm run lint` passed without changes; three informational suggestions remain:
  `codex-lint.log`.
- `npm run validate:policy` and `npm run check:sizes` passed:
  `codex-policy.log`, `codex-sizes.log`.
- Checks used the existing dependencies and supported Node 22.21.1 PATH. Full unit/build/docs
  gates were not redundantly rerun; the bound author report records its final full gates.

The candidate reuses the existing generators and orchestrators through a request-owned profile;
there is no alternate public RAP registration. The public dispatcher remains closed. Fresh
editable sources are read under one class lock. The BDEF is explicitly an observed dependency,
not a fabricated locked owner or a source of mutation package rights. Package and recording
checks, typed include initialization, same-context activation, no replay, bounded evidence reads,
source readback and cleanup/partial-state reporting are present. Focused tests exercise their
important negative paths. The author's class/package URI contradiction corrections reject the
modeled mismatches and preserve the valid encoded-package/owner case.

The separate inherited batch unknown-field P3 was not reclassified as a RAP finding. RAP's raw
field allowlist does not use that inherited `in` check. No other actionable RAP regression was
confirmed within this review's scope.

## Integrity, limits and provenance

The verifier was the first source action and passed for **4,642 unchanged bound files**. The
last source action was `/opt/homebrew/bin/python3 review-input/verify-snapshot.py`; it also
passed for candidate `dec70f489a21374698f9fe803f7778132ed2ad12`, 4,642 unchanged files.
The final result is preserved in `codex-final-integrity.log`. This report was written afterward,
outside the source snapshot. No source action followed the final verifier.

No source edits, installs, manual Git operations, delegation, credentials, browser, external
network/SAP operations, deployments or native qualification commands were performed. The tests
use mocked HTTP and the supplied native-shaped fixtures; they are not live or current-build SAP
proof. No unexpected DNS/network incident appeared in these review logs. The previously reported
inherited batch dotenv incident is historical and was not reproduced through external access.
The adversarial files and logs are outside the immutable snapshot.

After these fixes, another exact-candidate review is required. The author-documented native
behavior-pool/BDEF/include metadata variants, real locking/recording, successful and partial
lifecycles, default/activation-only/save-only behavior, complete active-state evidence, and
current-build PP/two-writer qualification remain open. Namespace and unsupported parser/native
contracts remain explicit parity gaps. Nothing in this review admits public RAP mutations or
approves the broader PR for merge.
