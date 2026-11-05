These three XML bodies are metadata of the dedicated ARC1-owned fixtures from the
failed local-package attempt on 2026-11-03. They contain no native credentials,
lock/session handles, standard SAP implementation source or unrelated inventory.
They exercise the fixed cleanup receipt hashes without a test-only hash override.

Original source revision: `fc14a7465cf10eed29b5e0291f33b3310e8a5ac0`.
Bodies: journal rows 00044 (child), 00051 (root), 00111 (active class).
Fresh GET-only inspection returned identical bodies. `version=inactive` returning
these active bodies is not evidence of an inactive draft.

The tests simulate later native responses and deletions; those simulated outcomes
are not native qualification. The original HTTP 400 body was not retained, is not
reconstructed here, and does not establish a successful noncascade refusal.
