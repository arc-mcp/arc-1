# TABL pre-write hint for canonical `"%admin"` draft admin include

## Overview

When the user writes a TABL source containing `include sych_bdl_draft_admin_inc` without
the SAP-canonical named-include syntax `"%admin" : include sych_bdl_draft_admin_inc;`, ARC-1
should emit a non-blocking pre-write **warning** that points at the canonical pattern with
a doc reference. The bare `include` form activates at the TABL level on most releases but is
non-canonical per the ABAP keyword doc `ABENBDL_DRAFT_TABLE` and breaks BDEF binding for
some draft scenarios — every SAP standard draft table (e.g. `BOTD_TAB_ROOT_D`) uses the
named form.

This is an opt-out, non-blocking hint — it never prevents a write from succeeding. It is
attached to the existing `warnings` array on the `SAPWrite` success response, so callers
that ignore warnings see no behavior change. It rides the existing `SAP_LINT_BEFORE_WRITE`
config flag (default `true`) — when the flag is off, the hint is also skipped.

The implementation is a small pure function that inspects TABL source via regex; no
dependency on `@abaplint/core` (whose grammar doesn't model RAP draft conventions). The
function is the first ARC-1-native pre-write semantic rule, and the architecture leaves
room for additional ARC-1 rules to follow the same pattern (one pure function per rule,
filename-gated dispatch from `validateBeforeWrite`).

## Context

### Current State

- `src/lint/lint.ts` `validateBeforeWrite()` returns `{ pass, errors, warnings }` with
  warnings sourced **only** from `@abaplint/core` rules (lines 144–160). No ARC-1-native
  semantic rules exist.
- TABL writes flow through `src/handlers/intent.ts` `handleSAPWrite` (`case 'TABL'`), then
  through `validateBeforeWrite()` when `lintBeforeWrite=true`.
- `LintResult` shape (`src/lint/lint.ts:21–29`): `{ rule, message, line, column, endLine,
  endColumn, severity: 'error' | 'warning' | 'info' }`.
- The bare `include sych_bdl_draft_admin_inc;` shape ships in the user's `ZDM_PROJECT_D`
  draft table (verified live on a4h S/4HANA 2023, ABAP 7.58); SAP standard `BOTD_TAB_ROOT_D`
  uses `"%admin" : include sych_bdl_draft_admin_inc;`. ABAP keyword doc
  [`ABENBDL_DRAFT_TABLE`](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_DRAFT_TABLE.html)
  shows the named form as the documented requirement.

### Target State

- A new pure module `src/lint/pre-write-hints.ts` exports
  `inspectTablSource(source: string): LintResult[]`. The function returns zero or more
  warnings (severity `'warning'`) — never errors. For the draft admin include case it
  matches `\binclude\s+sych_bdl_draft_admin_inc\b` (case-insensitive) and emits a warning
  unless the same logical line begins with `"%admin"\s*:\s*include\s+sych_bdl_draft_admin_inc`
  (case-insensitive).
- `validateBeforeWrite()` calls `inspectTablSource()` when the filename ends with
  `.tabl.astabl` and concatenates the resulting warnings into the existing `warnings`
  array. `pass` semantics are unchanged (still `errors.length === 0`).
- Unit tests cover positive cases (bare include → 1 warning), negative cases (named include
  → 0 warnings; comments containing the include → 0 warnings; unrelated TABL with no
  draft include → 0 warnings), edge cases (mixed case, leading whitespace, multiple
  includes), and integration via `validateBeforeWrite` (TABL filename → hint applied;
  ABAP filename → hint not applied).
- Docs updated: `CLAUDE.md` Key Files row + `docs/tools.md` warnings field documentation +
  `docs/roadmap.md` entry marked as shipped + `compare/00-feature-matrix.md` if a row fits.

### Key Files

| File | Role |
|------|------|
| `src/lint/pre-write-hints.ts` | **(new)** Pure inspection functions per object type. v1 ships `inspectTablSource()`. |
| `src/lint/lint.ts` | Wire `inspectTablSource()` into `validateBeforeWrite()` (filename-gated). |
| `tests/unit/lint/pre-write-hints.test.ts` | **(new)** Unit tests for `inspectTablSource()` — positive, negative, edge cases. |
| `tests/unit/lint/lint.test.ts` | Add integration cases to existing tests for `validateBeforeWrite` proving the hint runs only for TABL filenames. |
| `CLAUDE.md` | Key Files for Common Tasks: add a row for "Add a pre-write semantic hint for an object type". Update codebase structure tree to list `src/lint/pre-write-hints.ts`. |
| `docs/tools.md` | Mention that the `warnings` array on `SAPWrite` responses can include ARC-1-native semantic hints in addition to abaplint findings. |
| `docs/roadmap.md` | Mark the Run 6 micro-improvement #5 (`%ADMIN` group naming hint on TABL) as shipped. |
| `compare/00-feature-matrix.md` | Add or update a row for "ARC-1-native pre-write semantic hints" if the matrix has a relevant column; otherwise skip. |

### Design Principles

1. **Non-blocking, opt-out via the existing flag.** The hint rides
   `SAP_LINT_BEFORE_WRITE`. There is no new config flag; the hint is on by default with
   the lint pipeline. Severity is always `'warning'`, never `'error'`.
2. **Pure function, no SAP HTTP.** `inspectTablSource()` is a synchronous string→array
   transform. Trivially unit-testable; no fixtures needed for the function itself.
3. **Filename-gated dispatch.** `validateBeforeWrite()` only invokes
   `inspectTablSource()` when the filename matches the TABL extension
   (`.tabl.astabl` per `detectFilename` in `src/lint/lint.ts`). Other types are unaffected.
4. **No coupling with abaplint.** ARC-1 rules live in their own module so future rules
   (e.g. for DDLS, BDEF, CLAS) can be added without touching the abaplint orchestration.
5. **Match the canonical `LintResult` shape.** Hints are returned as
   `LintResult` objects so existing call sites that already process the
   `warnings` array work unchanged. Use a stable `rule` identifier
   (`'arc1-tabl-draft-admin-include'`) so callers can filter or suppress.
6. **Zero false negatives over zero false positives** — when in doubt about whether the
   shape is canonical, do **not** warn. Better to miss a hint than emit a noisy one.

## Development Approach

- **Order**: pure hint module + unit tests → wire into `validateBeforeWrite` + integration
  tests → docs → final verification.
- **Test strategy**: unit tests only. The hint is a pure string-inspection function with no
  SAP interaction; integration / E2E tests would add no signal. The existing pre-write
  lint integration test in `tests/unit/handlers/intent.test.ts` already covers the
  warnings → response wiring; no new test needed there.
- **Commit boundary**: one PR. The plan splits into separate tasks for clean reviewability,
  but the change is a single coherent enhancement.
- **Backward compat**: writes that previously succeeded without warnings continue to do so
  except when they ship the bare draft admin include — those gain a warning but are not
  blocked. No client breakage expected.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create the `inspectTablSource` pure function

**Files:**
- Create: `src/lint/pre-write-hints.ts`
- Create: `tests/unit/lint/pre-write-hints.test.ts`

This task introduces the first ARC-1-native pre-write semantic rule. The function is pure
(no I/O, no async) and returns `LintResult[]` so call sites can append to the existing
warnings array unchanged.

- [ ] Create `src/lint/pre-write-hints.ts` exporting `inspectTablSource(source: string): LintResult[]`.
  Re-export `LintResult` from `./lint.js` so callers don't pull from two places.
- [ ] Implementation: locate every match of `/\binclude\s+sych_bdl_draft_admin_inc\b/gi`
  in the source. For each match, check whether the same logical line (i.e., the segment
  between the previous `\n` or `;` and the match) starts with `"%admin"\s*:\s*` (after
  trimming leading whitespace). If yes, the include is canonical — skip. If no, emit
  one warning per non-canonical match.
- [ ] Each emitted warning uses:
  - `rule: 'arc1-tabl-draft-admin-include'`
  - `severity: 'warning'`
  - `message`: a one-line explanation pointing at the canonical pattern, e.g. *"Draft
    admin include should use the canonical named form `\"%admin\" : include
    sych_bdl_draft_admin_inc;` — see ABAP keyword doc ABENBDL_DRAFT_TABLE
    (https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_DRAFT_TABLE.html).
    SAP standard draft tables (e.g. BOTD_TAB_ROOT_D) all use the named form."*
  - `line` / `column`: the 1-based line and column of the matched `include` keyword.
  - `endLine` / `endColumn`: the position immediately after `sych_bdl_draft_admin_inc`.
- [ ] Comments must not trigger the hint. Strip `"` and `*` comment lines (full-line ABAP
  comments starting with `*` and inline `"` comments) before scanning. Also skip lines
  inside a `/* ... */` block if any (defensive — TABL CDS doesn't use them in practice
  but it's cheap to handle).
- [ ] Add unit tests in `tests/unit/lint/pre-write-hints.test.ts` (~10 tests):
  - bare `include sych_bdl_draft_admin_inc;` → 1 warning with correct line/column
  - canonical `"%admin" : include sych_bdl_draft_admin_inc;` → 0 warnings
  - canonical with extra whitespace `"%admin"  :  include sych_bdl_draft_admin_inc;` → 0 warnings
  - mixed case `Include SYCH_BDL_DRAFT_ADMIN_INC` (bare) → 1 warning
  - mixed case (canonical) → 0 warnings
  - source with no draft include at all → empty array
  - source with two bare includes → 2 warnings (defensive; rare in practice)
  - bare include inside an inline comment `" include sych_bdl_draft_admin_inc;` → 0 warnings
  - bare include inside a full-line comment (`* include sych_bdl_draft_admin_inc;`) → 0 warnings
  - empty source → empty array
- [ ] Run `npm test -- tests/unit/lint/pre-write-hints.test.ts` — all new tests pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.

### Task 2: Wire `inspectTablSource` into `validateBeforeWrite` for TABL sources

**Files:**
- Modify: `src/lint/lint.ts`
- Modify: `tests/unit/lint/lint.test.ts`

`validateBeforeWrite()` currently calls `lintAbapSource()` (which uses abaplint) and
splits results by severity. This task makes it additionally call `inspectTablSource()`
when the filename indicates a TABL source, and concatenates the resulting warnings into
the existing `warnings` array. `pass` semantics stay `errors.length === 0` — hints never
block.

- [ ] In `src/lint/lint.ts`, import `inspectTablSource` from `./pre-write-hints.js`.
- [ ] Inside `validateBeforeWrite()` (lines 144–160), after computing `errors` and
  `warnings` from the abaplint pass, if `filename.endsWith('.tabl.astabl')`, call
  `inspectTablSource(source)` and concat its result into `warnings`. Do NOT touch
  `errors` or `pass`.
- [ ] The integration must be filename-gated; do not invoke for non-TABL sources. This
  protects future ARC-1 rules from running on the wrong type.
- [ ] Add unit tests in `tests/unit/lint/lint.test.ts` (~5 tests):
  - `validateBeforeWrite()` on TABL source with bare draft include → `warnings` includes
    the `'arc1-tabl-draft-admin-include'` rule; `pass: true`; `errors.length: 0`
  - `validateBeforeWrite()` on TABL source with canonical draft include → no
    `'arc1-tabl-draft-admin-include'` warning
  - `validateBeforeWrite()` on TABL source with no draft include at all → no
    `'arc1-tabl-draft-admin-include'` warning
  - `validateBeforeWrite()` on an ABAP source containing the literal text
    `"include sych_bdl_draft_admin_inc"` (e.g. inside a comment in a CLAS) → no hint;
    proves filename gating
  - `validateBeforeWrite()` on TABL source where abaplint emits a real error →
    `pass: false`, `errors.length: 1`, the abaplint error is preserved alongside the
    pre-write hint (defensive: hint and abaplint findings coexist)
- [ ] Run `npm test -- tests/unit/lint/lint.test.ts` — all tests pass.
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — existing pre-write lint
  gate suite still passes (no regressions in the warnings → response wiring).
- [ ] Run `npm run typecheck` — no errors.

### Task 3: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `compare/00-feature-matrix.md` (only if a relevant row fits)

This task surfaces the new hint architecture in the docs that drive future contributors
and end users.

- [ ] In `CLAUDE.md`:
  - Update the `src/lint/` listing inside the "Codebase Structure" tree to include
    `pre-write-hints.ts` with a one-line description ("ARC-1-native pre-write semantic
    hints (TABL draft admin include, etc.)").
  - Add a row to "Key Files for Common Tasks": `Add a pre-write semantic hint for a
    new object type | src/lint/pre-write-hints.ts (add inspect<Type>Source function),
    src/lint/lint.ts (wire into validateBeforeWrite based on filename), tests/unit/lint/pre-write-hints.test.ts`.
- [ ] In `docs/tools.md`, find the section that documents the `SAPWrite` response shape
  (look for `warnings` field — if not currently documented, add a one-liner under
  `SAPWrite create`/`update` saying *"`warnings` (array): non-blocking pre-write hints,
  including abaplint findings and ARC-1-native semantic rules (e.g.
  `arc1-tabl-draft-admin-include`)"*).
- [ ] In `docs/roadmap.md`, find the section listing ARC-1 enhancements / shipped
  micro-improvements. If a Run-6-derived enhancements list exists, mark item #5 (`%ADMIN`
  group naming hint on TABL) as **✓ shipped** with a one-line link to this PR. If no such
  list exists, add a small "Recently shipped" subsection capturing this enhancement.
- [ ] In `compare/00-feature-matrix.md`, scan for a row covering "pre-write semantic
  hints" / "validation hints" / "linting customization". If a column or row applies, mark
  the new capability and update the "Last Updated" date. If no relevant slot exists, skip
  this file (do not add a forced row).
- [ ] Verify edits render correctly: `cat CLAUDE.md | head -200` shows the structure
  tree with `pre-write-hints.ts`; `grep "arc1-tabl-draft-admin-include" docs/tools.md`
  returns a hit; `grep -i "%admin\|admin include" docs/roadmap.md` returns a hit.

### Task 4: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run build: `npm run build` — `dist/` produced cleanly.
- [ ] Manual smoke against a TABL source string: in a Node REPL or scratch script,
  `import('./dist/lint/pre-write-hints.js').then(m => console.log(m.inspectTablSource('define table z { include sych_bdl_draft_admin_inc; }')))` — should print one warning with `rule: 'arc1-tabl-draft-admin-include'`.
- [ ] Inspect the diff: `git diff main -- src/lint/ tests/unit/lint/ CLAUDE.md docs/tools.md docs/roadmap.md compare/00-feature-matrix.md` — only the planned files changed; no incidental edits.
- [ ] Move this plan to `docs/plans/completed/` as
  `docs/plans/completed/<YYYY-MM-DD>-tabl-pre-write-hint-admin-draft-include.md`.
