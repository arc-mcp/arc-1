# Claude review 3 — policy PR #1010 final verification

| | |
|---|---|
| Reviewed commit | **`70388fa166af10f0d84f7bfc8513f1bb883e35ac`** (`fix: preserve explicit multi-target proposal restrictions`) |
| Compared with | `b9b65ecf678bac60f85d90369503d9234a9d373d`: a normal merge of the notebook fix `df8e642f` into the approved `83d02146`. Its delta has the same `git patch-id --stable` (`64a70249…`) as `2f8c6600..df8e642f`, so it contains only the notebook fix and is excluded. |
| Worktree | `/Users/marianzeis/.codex/worktrees/policy-explanations/arc-1`, clean at `70388fa1` on `codex/policy-explanations` |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only `git archive` scratch copy; no shared edits, SAP calls, credentials, commits, pushes or merges. |

## Verdict

**Approve. Review-2 N1 is fixed, and there is no blocking residual.** The only remaining item is
optional: a one-section move in the docs (see the end of this report).

## What changed and how it was verified

**The fix, `src/handlers/policy-explanation.ts:84-92`.** For an explicit `SAP` proposal,
`targetCeiling` now requires the real multi-target gate to allow the `SAP` route itself
(`multiTargetInvocationDecision('SAP', { action: delegator }, config)`) in addition to the expanded
intent operation.

That is better than the hard-coded condition I suggested in review 2, because it reuses the actual
gate. `MULTI_TARGET_TOOLS` excludes `SAP`, so the gate returns `forbidden`. If multi-target ever
admits that route, the explanation follows automatically. `delegator` is always set when
`proposedTool` is `SAP`.

**Regression.** `policy-explanation.test.ts` adds an explicit `SAP` read on a multi-target target;
it expects `decision: denied` and `targetCeiling: denied`.

My review-2 check (`zz-policy-mt-sap.test.ts`) now shows:

```text
explicit SAP proposal → decision "denied", targetCeiling denied
intent SAPRead        → "allowed"
route gate for SAP    → "forbidden"
```

My review-2 parity suite (`zz-policy-final.test.ts`) still passes all five cases: M1 handler-level
data gates, M2 hyperfocused delegator, combined scope, M3 scope-first disclosure with the R1
ceilings for scoped callers, and the single narrow metadata read.

**Docs.**

- `authorization.md` now explains that `SAP.read` covers only the delegator route and recommends
  intent-level rules (for example `SAPRead.PROG`) to cover both paths. That accurately records the
  pre-existing behavior noted in review 2.
- The validation log records the second review and the N1 fix.
- `evidence/policy-claude-review-2.md` is byte-identical to my report.

## Checks run (scratch copy of `70388fa1`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: `policy-explanation` (30), `multi-target-tools` (10), tool-definition snapshots (12), `authz/policy` (48), plus my `zz-policy-final` (5) and `zz-policy-mt-sap` (1) | **6 files / 106 tests passed** |
| `tsc --noEmit` (src and tests configs) | pass |
| Biome on the changed files | pass |

No full-suite rerun: the product change is one condition plus tests and docs, review 2's clean
full rerun at `83d02146` passed 9,005 tests, and Codex reports the full suites green.

## Residuals

- **Optional docs placement (not blocking).** The new `### Hyperfocused deny rules` subsection
  sits under `## References` (`docs_page/authorization.md:720`, after `:708`). It would read better
  next to the `SAP_DENY_ACTIONS` section (around `:453`) or inside “Explain a proposed operation”
  (`:662`). The strict docs build is unaffected.
- No other actionable residuals.
