# Lint configuration diagnostics (#597 / #775)

## Evidence and scope

- #775 reports ARC-1 1.0.2 / SAP_BASIS 758, with unchanged `DELETE ... UP TO ... ROWS`
  rejected while replacing another FORM. The complete source and effective lint configuration
  were not supplied; the request to retest a current version remains unanswered.
- The reduced example parses with both the 1.0.2-era abaplint 2.120.9 and current locked
  2.120.54 at v758, but not at v702 or v750. A missing probe/configured release reproduces
  the pre-write rejection; an old parser alone does not explain the report.
- #597 correctly adds preset provenance, but its unconditional unknown-release warning claims
  v702 even when Cloud or a custom config selects another grammar. Its docs also incorrectly
  say `abapVersion` falls back to v702; it actually stays `unknown`.

## Implemented plan

1. Merge current main, retaining request/target-scoped feature lookup and probe precedence.
2. Report preset and SAP-release provenance alongside the effective syntax version. Unknown
   release warnings name the actual syntax; keep their wording short and actionable. Preserve
   an explicit system-type override's origin when the probe caches it.
3. Include the syntax from the config actually used for pre-write validation in blocked-write
   errors, then point to `SAPLint list_rules` and version/configuration checks. Keep one syntax
   reporting helper for both paths. Preserve rule severity, custom overrides and whole-source validation.
4. Cover default, explicit, probed, Cloud and custom syntax configurations through dispatch.
   Reproduce #775 through `edit_unit`, proving the untouched source survives at release 758
   and that rejected edits issue no PUT. Align the unknown-release `edit_unit` fallback with
   unit lookup using the shared on-prem ceiling; leave standalone lint defaults unchanged.
5. Update the existing tool documentation, run focused and full local checks, review the final
   diff, then update #597. Keep #775 open unless its complete reported failure is resolved.

## Validation

- The original diagnostics regressions and the new no-release `edit_unit` regression failed
  before their respective fixes. **6,980 tests** pass; typecheck, lint, build, policy,
  file/schema budgets and strict MkDocs pass. Known older probe/config releases, probe
  precedence, a custom v750 config and malformed replacements remain blocking controls.
- Live a4h SAP_BASIS 758, direct HTTPS Basic, this PR's built implementation: created an
  owned disposable `$TMP` program with modern `SELECT FROM ... FIELDS ...` in an untouched
  FORM. Cleared the probe cache and omitted the configured release for `edit_unit`.
  The edit succeeded, preserved the untouched source and passed SAP's inactive syntax check.
  A malformed replacement was blocked and readback proved the source stayed unchanged.
  No program was executed or activated. Deleted the test program and verified HTTP 404.
- Earlier read-only live diagnostics correctly reported onprem/probe, 758/probe, v758.
  The exact customer `DELETE ... UP TO` example remains a local regression: #775 stays
  open because its complete source/effective configuration is unavailable.

## Review decisions

Accepted F1 narrowly: unit lookup and validation shared no-release grammar after previously
using v758/v702 respectively. Both now use the existing `ABAPLINT_MAX_RELEASE` constant.
Known releases/custom lint syntax still win. Rejected the broader global-default change:
it would also alter standalone `lint_and_fix` output. F2 is clarified in the tool docs:
`list_rules` reports standalone lint, while `edit_unit` has an explicit local fallback.
No roadmap impact; this fixes an existing operation and explains its configuration.
