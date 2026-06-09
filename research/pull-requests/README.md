# PR review dossiers

Durable review dossiers produced by the **`/deep-pr`** command, one file per reviewed
pull request: `<pr-number>-<short-slug>.md`.

Each dossier records the **verdict** (APPROVE / REQUEST CHANGES / COMMENT), what was actually
run and observed (typecheck/lint/test output + live `arc1-cli` results), the security/architectural
invariant findings, and each issue anchored to `file:line` — plus the paste-able review markdown.

Mirrors `research/issues/` (which holds the `/deep-issue` dossiers). These notes are evidence,
not the GitHub review itself — `/deep-pr` never posts, approves, or pushes; the maintainer acts on
origin (`marianfoo`).
