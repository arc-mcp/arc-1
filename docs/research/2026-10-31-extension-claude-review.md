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

A focused confirmation review of the repairs follows these checks. Roadmap checked:
no roadmap impact.
