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
2. Test valid and SAP-rejected spacing plus an explicit Error override. Existing
   lint tests cover parser errors; keep standalone lint configuration unchanged.
3. Reproduce against SAP 758 with a disposable class, then verify default create,
   edit, activation and read-back with the candidate. Delete the fixture.

Review: a rule-level severity change uses the existing warning path while accepting
the explicit trade-off above. No new configuration, suppression-by-line logic, parser
fork, or changed-source-only lint is necessary. This is not a full SAP syntax
validator; activation remains authoritative.

Roadmap checked: no roadmap impact.

## Live verification

On SAP_BASIS 758 SP02/client 001/HTTPS Basic, create and an unrelated method edit
warned but succeeded; activation and read-back preserved `DEFAULT '')`. SAP's
inline syntax check rejected the missing-blank IF form. All fixtures were deleted
and absence verified. Other releases and BTP/PP were not tested live.
