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
| P2: SAPNavigate.relations denial did not cover hidden native lookups | Fixed by narrowing the native provider at both root validation and the POST sink. Whole-tool and action denials produce a denied optional provider while retaining the base. Six real-HTTP public CLAS/INTF/BDEF cases assert zero optional sends. Operator docs state the shared effect. |
| P3: raw class include selection | Uppercase section names reproduced and are normalized like the base reader. The claimed comma-list trigger is already rejected by the public schema; it was not implemented as a new scope. Regressions cover upper/lowercase routes and existing comma/whitespace rejection before HTTP. |
| P3: block-commented DDIC includes became source evidence | Fixed with a linear comment/literal mask that preserves token spacing and supports nested/unfinished blocks. Regressions exclude phantom nodes, edges and source sends in both extension discovery and explicit structure context. |
| P3: published docs linked to a disposable feature branch | Fixed to the canonical main documentation path. |

The follow-up passed 404 unit files / 10,896 tests and source/scripts/tests typecheck,
lint, policy, build and size/schema gates. Two existing lint informational suggestions
remain. The final strengthened deny fixture also passed its seven public integration
cases after the full run. No tool schema or published budget increased.

The review also noted unqualified alias/define-only BDEF interpretations and live
frequency of non-active WUL rows. These do not establish defects in the approved
entity-declaration verification scope; no speculative syntax or inactive fallback was
added. Cold discovery, positive interfaces, inactive snapshots, runtime applicability,
exhaustive indexing and the other documented deployment/release boundaries remain
explicit. See the [test gap audit](2026-10-31-extension-test-gaps.md).

The repaired source is followed by fresh live checks and a focused confirmation review;
their exact commits and results are recorded below when complete. Roadmap checked:
no roadmap impact.
