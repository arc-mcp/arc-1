# Extend abaplint CDS Lint Support

## Overview

abaplint has a full CDS parser and 6 CDS-specific rules (`cds_parser_error`, `cds_association_name`, `cds_comment_style`, `cds_field_order`, `cds_legacy_view`, `cds_naming`) that are currently unused by ARC-1. The pre-write lint gate (`intent.ts:2183`) skips all non-ABAP types with an outdated comment claiming "abaplint is an ABAP statement parser — it cannot parse CDS DDL." This is wrong for DDLS (CDS views) — abaplint parses them fully and catches real syntax errors (missing commas, wrong keywords, invalid constructs).

This plan extends the lint system to leverage abaplint's CDS capabilities for DDLS objects, while correctly keeping BDEF/SRVD/SRVB/DDLX skipped (abaplint does NOT parse those — garbage input passes silently).

**Key design decisions:**
- Only DDLS gets pre-write lint — BDEF/SRVD/SRVB/DDLX remain skipped (verified: abaplint silently ignores them)
- `cds_parser_error` is the only blocking rule for pre-write (catches real syntax errors)
- `cds_naming` is disabled by default (too opinionated — enforces VDM prefixes like `ZI_`, `ZC_`)
- `cds_legacy_view` is warning on on-prem (legacy views still valid), error on BTP
- `cds_association_name`, `cds_comment_style`, `cds_field_order` are warnings (advisory, not blocking)
- `detectFilename` is extended to handle SRVD, SRVB, TABL, DDLX for the SAPLint on-demand tool
- The `define table` syntax is NOT supported by abaplint's CDS parser (fires false `cds_parser_error`), so TABL remains skipped for pre-write

## Context

### Current State

- Pre-write lint gate at `intent.ts:2183` only allows `PROG, CLAS, INTF, FUNC, INCL`
- All CDS types (DDLS, BDEF, SRVD, SRVB, DDLX, TABL) are skipped with a misleading comment
- Presets (`cloud.ts`, `onprem.ts`) don't mention CDS rules — they're enabled by abaplint's defaults but never configured
- `detectFilename` doesn't handle SRVD, SRVB, TABL, or DDLX — these fall through to `.clas.abap` default
- SAPLint on-demand tool works for DDLS (detectFilename catches `define view` and `@`), but BDEF/SRVD/SRVB/DDLX get wrong extensions
- Tool description says "Lint only applies to ABAP types (PROG, CLAS, INTF, FUNC) — CDS/BDEF/SRVD are always skipped automatically"

### Target State

- Pre-write lint gate includes DDLS — `cds_parser_error` blocks writes with syntax errors
- Presets explicitly configure all 6 CDS rules with appropriate severities
- `detectFilename` handles all source-based types: DDLS, BDEF, SRVD, SRVB, TABL, DDLX
- Pre-write config (`buildPreWriteConfig`) includes `cds_parser_error` as a blocking rule for DDLS
- Tool descriptions updated to reflect CDS lint support
- Comment at `intent.ts:2178` corrected

### Key Files

| File | Role |
|------|------|
| `src/lint/lint.ts` | `detectFilename()` — extend for SRVD, SRVB, TABL, DDLX |
| `src/lint/config-builder.ts` | `buildPreWriteConfig()` — add `cds_parser_error`; `buildLintConfig()` presets |
| `src/lint/presets/cloud.ts` | Add CDS rule configuration for cloud systems |
| `src/lint/presets/onprem.ts` | Add CDS rule configuration for on-prem systems |
| `src/handlers/intent.ts` | Pre-write lint gate (~line 2183) — add DDLS to allowed types; fix comment |
| `src/handlers/tools.ts` | SAPLint tool description — update to mention CDS support |
| `tests/unit/lint/lint.test.ts` | `detectFilename` tests — add SRVD, SRVB, TABL, DDLX cases |
| `tests/unit/lint/lint-enhanced.test.ts` | Enhanced lint tests — add CDS-specific test cases |
| `tests/unit/lint/config-builder.test.ts` | Config builder tests — verify CDS rules in presets and pre-write config |
| `tests/unit/handlers/intent.test.ts` | Pre-write lint gate tests — add DDLS test cases |

### Design Principles

1. **Only extend where abaplint actually works** — DDLS is parsed with a real CDS parser; BDEF/SRVD/SRVB/DDLX are silently ignored (garbage passes). Never add a type that produces false positives or false negatives.
2. **Pre-write blocks only on correctness errors** — `cds_parser_error` blocks; naming/style rules are warnings at most. Same philosophy as the existing ABAP pre-write gate.
3. **Presets are explicit** — even though CDS rules are enabled in abaplint defaults, we configure them explicitly in our presets so admins can see and override them.
4. **TABL (`define table`) stays skipped** — abaplint's CDS parser doesn't support `define table` syntax, so it would produce false `cds_parser_error` on valid tables. TABL uses a different ADT path anyway.

## Development Approach

Changes are layered bottom-up: detectFilename → presets → config-builder → intent gate → tool descriptions. Each layer has focused unit tests. No integration/E2E tests needed since the lint system is entirely offline (no SAP round-trips).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Extend detectFilename for all source-based types

**Files:**
- Modify: `src/lint/lint.ts`
- Modify: `tests/unit/lint/lint.test.ts`

The `detectFilename()` function at `src/lint/lint.ts:166` currently handles CLASS, INTERFACE, FUNCTION, REPORT, DDLS (`define view` / `@`), and BDEF (`managed` / `unmanaged` / `abstract`). It does NOT detect SRVD (`define service`), SRVB, TABL (`define table`), or DDLX (`annotate view`). These fall through to the `.clas.abap` default, which causes incorrect parsing when passed to abaplint.

- [ ] Add detection for `define service` → `.srvd.asrvd` in `detectFilename()` at `src/lint/lint.ts:166`
- [ ] Add detection for `define table` → `.tabl.astabl` in `detectFilename()` (abaplint won't parse it, but the extension is correct for any future support)
- [ ] Add detection for `annotate view` / `annotate entity` → `.ddlx.asddlx` in `detectFilename()`
- [ ] Add detection for `projection;` (BDEF projection syntax) → `.bdef.asbdef` in `detectFilename()`
- [ ] Add unit tests (~8 tests) in `tests/unit/lint/lint.test.ts` under the existing `detectFilename` describe block: test SRVD detection, TABL detection, DDLX detection, BDEF projection detection, and edge cases (leading whitespace, annotations before `define service`, etc.)
- [ ] Run `npm test` — all tests must pass

### Task 2: Add CDS rules to presets

**Files:**
- Modify: `src/lint/presets/cloud.ts`
- Modify: `src/lint/presets/onprem.ts`
- Modify: `tests/unit/lint/config-builder.test.ts`

The presets currently only configure ABAP rules. abaplint's 6 CDS rules (`cds_parser_error`, `cds_association_name`, `cds_comment_style`, `cds_field_order`, `cds_legacy_view`, `cds_naming`) are enabled by default in abaplint's config but not explicitly configured by our presets. We need explicit configuration so admins can see what's enabled and our severity levels are intentional.

**Cloud preset (`src/lint/presets/cloud.ts`):**
- [ ] Add `cds_parser_error: { severity: 'Error' }` to `CLOUD_ERROR_RULES`
- [ ] Add `cds_legacy_view: { severity: 'Error' }` to `CLOUD_ERROR_RULES` (legacy views not supported on BTP)
- [ ] Add `cds_association_name: { severity: 'Warning' }`, `cds_comment_style: { severity: 'Warning' }`, `cds_field_order: { severity: 'Warning' }` to `CLOUD_WARNING_RULES`
- [ ] Add `cds_naming` to `CLOUD_DISABLED_RULES` with comment "VDM naming prefixes are project-specific"

**On-prem preset (`src/lint/presets/onprem.ts`):**
- [ ] Add `cds_parser_error: { severity: 'Error' }` to `ONPREM_ERROR_RULES`
- [ ] Add `cds_legacy_view: { severity: 'Warning' }` to `ONPREM_WARNING_RULES` (legacy views still valid on-prem)
- [ ] Add `cds_association_name: { severity: 'Warning' }`, `cds_comment_style: { severity: 'Warning' }`, `cds_field_order: { severity: 'Warning' }` to `ONPREM_WARNING_RULES`
- [ ] Add `cds_naming` to `ONPREM_DISABLED_RULES` with comment "VDM naming prefixes are project-specific"
- [ ] Add unit tests (~4 tests) in `tests/unit/lint/config-builder.test.ts`: verify CDS rules appear in built configs for cloud and on-prem, verify `cds_naming` is disabled, verify `cds_legacy_view` severity differs between cloud (Error) and on-prem (Warning)
- [ ] Run `npm test` — all tests must pass

### Task 3: Add CDS parser error to pre-write config and extend lint gate to DDLS

**Files:**
- Modify: `src/lint/config-builder.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/lint/config-builder.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The pre-write config (`buildPreWriteConfig` at `src/lint/config-builder.ts:82`) disables all rules then enables only correctness rules. It does not include any CDS rules. The pre-write lint gate at `src/handlers/intent.ts:2183` restricts lint to `ABAP_ONLY_TYPES = new Set(['PROG', 'CLAS', 'INTF', 'FUNC', 'INCL'])`.

**Config builder changes (`src/lint/config-builder.ts`):**
- [ ] Add `cds_parser_error: { severity: 'Error' }` to the `preWriteRules` object in `buildPreWriteConfig()` at line ~94. This is a correctness rule (catches syntax errors in CDS DDL) and belongs in pre-write regardless of system type.
- [ ] Add unit test in `tests/unit/lint/config-builder.test.ts`: verify `cds_parser_error` is enabled in pre-write config

**Intent handler changes (`src/handlers/intent.ts`):**
- [ ] At line ~2183, change `ABAP_ONLY_TYPES` to `LINTABLE_TYPES` and add `'DDLS'`: `const LINTABLE_TYPES = new Set(['PROG', 'CLAS', 'INTF', 'FUNC', 'INCL', 'DDLS']);`
- [ ] Update the comment at line ~2178 to accurately reflect the current state: explain that DDLS is linted for CDS syntax errors, while BDEF/SRVD/SRVB/DDLX are skipped because abaplint doesn't parse them, and TABL is skipped because abaplint's CDS parser doesn't support `define table` syntax
- [ ] Update the tool description for `lintBeforeWrite` in `src/handlers/tools.ts` at line ~501: change from "Lint only applies to ABAP types (PROG, CLAS, INTF, FUNC) — CDS/BDEF/SRVD are always skipped automatically." to "Lint applies to ABAP types (PROG, CLAS, INTF, FUNC) and DDLS (CDS views). BDEF/SRVD/SRVB/DDLX/TABL are skipped (not supported by offline linter)."
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts`: test that pre-write lint catches CDS syntax errors for DDLS, test that valid DDLS passes pre-write, test that BDEF/SRVD still bypass pre-write lint. Look for existing pre-write lint tests in the file and add CDS cases alongside them.
- [ ] Run `npm test` — all tests must pass

### Task 4: Add CDS lint tests and update SAPLint tool description

**Files:**
- Modify: `tests/unit/lint/lint.test.ts`
- Modify: `tests/unit/lint/lint-enhanced.test.ts`
- Modify: `src/handlers/tools.ts`

The lint test files currently have no CDS-specific test cases. The SAPLint tool description in `src/handlers/tools.ts` at line ~672 doesn't mention CDS support.

- [ ] Add a new `describe('CDS Lint')` block in `tests/unit/lint/lint.test.ts` with tests (~6 tests):
  - `lintAbapSource` with valid CDS view → no `cds_parser_error`
  - `lintAbapSource` with invalid CDS (missing comma) → `cds_parser_error` found
  - `lintAbapSource` with bad association name → `cds_association_name` found
  - `lintAbapSource` with wrong field order (association before key) → `cds_field_order` found
  - `lintAbapSource` with legacy view (no `entity` keyword) → `cds_legacy_view` found
  - `lintAbapSource` with BDEF source and `.bdef.asbdef` extension → no issues (abaplint doesn't parse BDEF)
- [ ] Add CDS cases to `tests/unit/lint/lint-enhanced.test.ts` if it has relevant `lintAndFix` or `validateBeforeWrite` tests (~3 tests):
  - `validateBeforeWrite` with valid CDS view → `pass: true`
  - `validateBeforeWrite` with invalid CDS view → `pass: false`, errors include `cds_parser_error`
  - `lintAndFix` with CDS view — verify it processes without errors (CDS rules generally don't have auto-fixes)
- [ ] Update SAPLint tool description in `src/handlers/tools.ts` at line ~672: mention that SAPLint also checks CDS views (DDLS) for syntax errors, naming conventions, field order, and legacy view patterns. Keep it concise.
- [ ] Run `npm test` — all tests must pass

### Task 5: Final verification

**Files:**
- No modifications

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify manually that the CDS lint works end-to-end by running: `node -e "const {validateBeforeWrite} = require('./dist/lint/lint.js'); console.log(validateBeforeWrite('define view entity ZI_TEST as select from ztable { key f1 field2 }', 'zi_test.ddls.asddls'));"` — should show `pass: false` with `cds_parser_error`
- [ ] Move this plan to `docs/plans/completed/`
