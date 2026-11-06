# Claude Code extension review and triage

Claude Code 2.1.308 (configured model `claude-opus-5-5`) reviewed the immutable
`c6560da937376b852cd9e80a457525b365e278da` snapshot after implementation, all required
gates and BTP qualification were complete. The primary range was `6994d2f4..c6560da9`;
combined extension runtime integration was also checked against `ac8385fa`.

The snapshot contained tracked files only, without `.env`, credentials or `node_modules`.
The reviewer had Read/Grep/Glob tools; MCP, customizations, execution and writes were
disabled. It made 63 read/search calls, ran no code or SAP calls, and reported no P1,
two P2 and three P3 findings. Its transport, cancellation, base-preservation, session
isolation and output-cap review found no actionable defects.

## Findings and disposition

| Finding | Verified result and repair |
|---|---|
| P2: missing source enhancement relation reported as a valid empty provider | Fixed. Summary exits now pass through provider finalization: missing relations report `not_advertised`, and qualified 750 summaries retain provenance. FUNC/CLAS absence and 750 summary regressions cover this. |
| P2: SAPNavigate.relations denial did not cover hidden native lookups | Fixed by narrowing the native provider at both root validation and the POST sink. The confirmation follow-up also handles the hyperfocused alias and preserves independent class hooks; see below. Operator docs state the shared effect. |
| P3: raw class include selection | Uppercase section names reproduced and are normalized like the base reader. The claimed comma-list trigger is already rejected by the public schema; it was not implemented as a new scope. Regressions cover upper/lowercase routes and existing comma/whitespace rejection before HTTP. |
| P3: block-commented DDIC includes became source evidence | Fixed with a linear comment/literal mask that preserves token spacing. Nested or unfinished scans explicitly report incomplete coverage. Regressions exclude phantom nodes, edges and source sends in both extension discovery and explicit structure context. |
| P3: published docs linked to a disposable feature branch | Fixed to the canonical main documentation path. |

The first repair checkpoint passed 404 unit files / 10,896 tests and source/scripts/tests typecheck,
lint, policy, build and size/schema gates. Two existing lint informational suggestions
remain. The final strengthened deny fixture also passed its seven public integration
cases after the full run. No tool schema or published budget increased.

The review also noted unqualified alias/define-only BDEF interpretations and live
frequency of non-active WUL rows. These do not establish defects in the approved
entity-declaration verification scope; no speculative syntax or inactive fallback was
added. Cold discovery, positive interfaces, inactive snapshots, runtime applicability,
exhaustive indexing and the other documented deployment/release boundaries remain
explicit. See the [test gap audit](2026-10-31-extension-test-gaps.md).

## Verification after repairs

The repaired source commit is `863f5dbf72c0d5cbc34f1d5cc3d2633c171fc436`.
Fresh read-only checks preserve the base in all successful modes:

- [A4H 758](2026-10-31-extension-a4h-after-review.json): both BDEF extensions still
  verify through public none/summary/sources reads.
- [NPL 750](2026-10-31-extension-npl-after-review.json): all four nested program
  implementation identities remain; summary and sources both retain the qualified
  unadvertised-provider provenance note.
- [BTP 920](2026-10-31-extension-btp-after-review.json): 38 observations again cover
  the qualified families and negative states. FUNC summary now reports `not_advertised`.
  All four BDEF sources remain verified in five sends / 10,003 decoded bytes / 1,352 ms.

Each capture records the same tracked source SHA-256
`9c7f26d4963290e08b5845dc6f46f2b1771bf333f88a96cd511311a4c8d2b901`;
the exact path/bytes hash format is stored with the evidence. Denied sources, unavailable
interfaces, candidate/request caps and the earlier qualification boundaries remain explicit.
The comment and admin-denial repairs are additionally exercised by the regression fixtures;
no SAP test objects were created or changed. Timing remains an observation, not an SLA.

## Confirmation review and final triage

Claude Code completed a second review at `17f31634921dd57326800e48e5644433fe3ea6d0`.
It confirmed the first repairs and identified further edge cases. Their dispositions are:

- **Independent class hooks (P2): fixed.** A statically disabled native provider is now
  excluded before entering the shared read boundary. It reports `denied` while hooks
  keep their own authorized path. Runtime HTTP authorization failures remain terminal.
- **Empty include (P2): not reproduced through public dispatch.**
  `normalizeTypeArgsForValidation` removes blank includes before validation and method
  inference. New public tests for omitted/empty includes both reach main hooks. The
  suggested special main override would disagree with existing public normalization.
- **Hyperfocused denial alias (P3): fixed.** The common native-action predicate honors
  `SAP.navigate` as well as the standard action/whole-tool denials. Twelve real-HTTP
  cases cover CLAS/INTF/BDEF, including cold BDEF capabilities. CLAS retains positive
  rendered hook sources with no native POST; BDEF/INTF make zero optional sends.
- **Comment nesting (conditional P3): qualification retained, silent completeness fixed.**
  Nested and unfinished scans now propagate explicit issues into the extension provider
  and structure context. They do not assert that hidden includes are absent.
- **Legacy dash comments (conditional P3): defensive masking added.** An apostrophe in
  a `--` line cannot consume following include evidence. This scanner behavior is not
  a new claim that every DDIC release accepts that syntax.

SAP documents the basic comment delimiters in its
[DDIC append reference](https://help.sap.com/docs/abap-cloud/abap-keywords-standard-abap/ABENDDICDDL_EXTEND_TYPE.html)
and distinguishes legacy CDS dash comments in the
[CDS syntax rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_GENERAL_SYNTAX_RULES.html).
Those references do not establish DDIC nesting semantics. An attempted read-only inline
[syntax comparison](2026-10-31-ddic-comment-syntax-check.json) processed the invalid
control correctly but also rejected the slash-comment control. It is therefore not a
reliable grammar qualification on this target. The stored source hash was unchanged;
no object was created or edited.

Final triage passed 404 files / 10,907 unit tests, typecheck, lint, policy, build and size
gates. The focused regressions passed 49 tests. Both Claude reviews completed;
confirmed findings were repaired and verified through regressions, reported triggers were
checked against public normalization, and conditional grammar claims remain explicit. Roadmap checked:
no roadmap impact.

## Final live runtime checkpoint

The final runtime commit `adf69977519707d1bf643bd93e955627b049d60e` passed the
[final live checks](2026-10-31-extension-final-runtime.json). BTP 920 repeated all
38 observations, including four source-verified BDEF extensions, after the confirmation
repairs. Every successful mode preserved its base block.

On A4H 758, each of `SAPNavigate.relations`, `SAPNavigate` and hyperfocused `SAP.navigate`
was parsed and validated through the `SAP_DENY_ACTIONS` configuration path, intersected
with read-only user safety, then tested through public dispatch. Native discovery was
denied while seven hook identities and eight rendered source bodies remained available.
Each optional phase used exactly two GETs. The evidence binds these checks to the final
tracked source hash; it does not claim a deployed CF/PP/Cloud Connector qualification.
