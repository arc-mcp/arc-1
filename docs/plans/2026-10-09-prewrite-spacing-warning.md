# Pre-write spacing warning (#954)

## Root cause and reproduction

`buildPreWriteConfig` promotes `parser_missing_space` to an error even though
abaplint describes it as enforcing consistent whitespace where ABAP permits its
omission. `DEFAULT '')` reproduces the finding. Class surgery validates the whole
spliced class, so editing another method is blocked by the unchanged literal.
The local reproducer fails before and after that unrelated edit; an explicit
warning override passes while a real parser error remains blocking.

## Plan and review

1. Make only this pre-write rule advisory by default. Keep whole-source validation,
   parser errors, cloud restrictions, and explicit administrator overrides.
2. Test the original class, a spliced unrelated method, invalid ABAP, and an
   explicit Error override. Keep standalone lint configuration unchanged.
3. Reproduce against SAP 758 with a disposable class, then verify default create,
   edit, activation and read-back with the candidate. Delete the fixture.

Review: a rule-level severity change matches its documented purpose and uses the
existing warning path. No new configuration, suppression-by-line logic, parser
fork, or changed-source-only lint is necessary. This is not a full SAP syntax
validator; activation remains authoritative.

Roadmap checked: no roadmap impact.

## Verification

On the parent main revision `3ac9caa`, a disposable `$TMP` class on SAP_BASIS
758 SP02 (HTTPS/Basic, client 001) activates, but editing its second method is
blocked by the first method's unchanged spacing. With this branch's built
dispatcher, default create and edit both return the warning, activation succeeds,
and read-back preserves `DEFAULT '')` alongside the changed method body. Both
fixtures were deleted and subsequent source GETs returned 404.

The new regression fails on main and passes after the change. Full unit suite:
8,070 tests / 270 files. Typecheck, Biome, policy validation, build and size/schema
budgets pass. Final diff review found no further change needed. Live BTP/PP and
other SAP releases were not exercised; existing cloud/version tests pass.
