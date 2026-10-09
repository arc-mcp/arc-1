# Pre-write spacing warning (#954)

## Root cause and reproduction

`buildPreWriteConfig` promotes `parser_missing_space` to an error even though
abaplint describes it as enforcing consistent whitespace where ABAP permits its
omission. `DEFAULT '')` reproduces the finding. Class surgery validates the whole
spliced class, so editing another method is blocked by the unchanged literal.
The local reproducer fails before and after that unrelated edit; an explicit
warning override passes while a `parser_error` finding remains blocking.

The rule also catches real SAP syntax errors that `parser_error` does not catch:
for example `IF ('bar' = foo ).` lacks a required blank after `(` on 758. Making
this rule advisory therefore permits some invalid spacing through pre-write lint;
the warning remains visible and SAP syntax checking/activation rejects it. The
trade-off avoids blocking valid source such as `DEFAULT '')`; it is not a claim
that every finding from the rule is stylistic.

## Plan and review

1. Make only this pre-write rule advisory by default. Keep whole-source validation,
   parser errors, cloud restrictions, and explicit administrator overrides.
2. Test the original class, a spliced unrelated method, invalid ABAP, and an
   explicit Error override. Keep standalone lint configuration unchanged.
3. Reproduce against SAP 758 with a disposable class, then verify default create,
   edit, activation and read-back with the candidate. Delete the fixture.

Review: a rule-level severity change uses the existing warning path while accepting
the explicit trade-off above. No new configuration, suppression-by-line logic, parser
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

## Claude review follow-up

Corrected the claim that this is always a style finding. Added a regression for
`IF ('bar' = 'bar' ). ENDIF.`: pre-write lint passes with a spacing warning and
no parser error. Independently verified on 758 SP02/client 001 via HTTPS/Basic:
SAP's inline syntax check rejects the same unsaved source because `(` requires a
following blank. The disposable program was deleted and a source read returned
404. The production severity is unchanged from the original PR.

All 8,071 unit tests and typecheck, lint, policy, build and size/schema checks
pass; the final focused file passes all four cases. Roadmap rechecked: no impact.
