# Private publication review corrections — 3 November 2026

Scope: follow-up to `8e0ef608b5f97f6e638b714aa501dd511e5e5bd5`, with both
private publication recording contracts retained. No public schema, dispatch admission,
ordinary single-target sender, generated-owner cleanup or native configuration reader changes.

## Preserved review and disposition

The independent [verbatim review](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-publication-native-governed-review1-verbatim.md)
has SHA256 `784823449a5056f16a4a846ba11a3aa7583284aa95f30d753bdec3ba26b74415`.
Its original candidate, probes, four failing observations and logs remain unchanged in the private
review packet. Rebound probes change only absolute source/fixture and external output paths.
Their eight assertions reproduce the original four failures before this correction.

| Finding | Correction and evidence |
| --- | --- |
| F1 (P2): a matching getter skips an explicit workflow and returns complete success | Remove the shared private executor's `already-reported` branch. Both profiles submit one authorized native job even when the initial getter matches. Matching false/unpublish and matching true/publish tests exercise direct and Connectivity paths, with separate synthetic runtime state, native ERROR and uncertain HTTP failure. All retain existing full-batch preflight, final-send guards, native status/readback checks and no replay. |
| F2 (P2): native diagnostic text escapes minimal-error responses | A shared pure handler projection omits native `shortText` and `longText` when `minimalErrors` is true. Both wrappers retain severity, recording disclosure, submission count, observed state and per-item partial outcomes. False keeps full diagnostics. Real HTTP/mock tests cover both routes/profiles and a three-owner partial batch; a frozen raw result remains unchanged after projection. |

A native job acknowledgement plus matching metadata remains a native observation. Cloud-mode
BAdI no-op/branch behavior, caught-error getters and consumer availability are not upgraded to
stronger evidence. Errors may have partial effects, including CTS effects; no retry or automatic
compensation is added. Native-governed recording remains unverified; the distinct non-recording
profile still requires its trusted current-principal configuration reader.

## Validation and remaining limits

All eight unchanged independent probes pass after correction. The two affected publication suites,
legacy devtools and private FLP regressions pass: **397 tests across four files** (including 32
additional cases). All three TypeScript projects, build, Biome, policy/schema/file budgets and
strict documentation pass. Biome reports only three existing informational diagnostics. Exact
commands and logs are in the private author report. No further full suite is required for this bounded correction; the prior clean
archive full-suite evidence and its environment/setup caveats remain historical author evidence.

All added runtime observations are synthetic HTTP/mock evidence. No native script or phase,
SAP request, browser, credentials, environment-file read or installation is part of this work.
Independent re-review, native/PP lifecycle, generated-owner cleanup and public admission remain
open. FEAT-93 retains those remaining gaps; no whole-PR or native readiness is claimed.
