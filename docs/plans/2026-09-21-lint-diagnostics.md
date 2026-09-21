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
3. Point pre-write failures to `SAPLint list_rules` and version/configuration checks before
   suggesting source changes. Preserve validation, severity, override and write behavior.
4. Cover default, explicit, probed, Cloud and custom syntax configurations through dispatch.
   Reproduce #775 through `edit_unit`, proving the untouched source survives at release 758
   and that rejected edits issue no PUT. Keep malformed replacement coverage.
5. Update the existing tool documentation, run focused and full local checks, review the final
   diff, then update #597. Keep #775 open unless its complete reported failure is resolved.

## Validation

- Regression tests failed before the diagnostic changes; 6,976 unit tests now pass. Typecheck,
  lint, build, policy, size/schema budgets and strict documentation build pass.
- Current code, direct Basic over HTTPS to a4h SAP_BASIS 758: live feature probe followed by
  local `SAPLint list_rules` reports onprem/probe, release 758/probe, v758 syntax and no warning.
  This checks metadata and diagnostics, not live source mutation, syntax checking or activation.
- #775 remains open: the complete customer source and effective configuration are unavailable.

No roadmap impact: this explains existing configuration and preserves lint policy.
