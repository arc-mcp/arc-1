# Plan Status

This folder is for active or backlog implementation plans. Completed and historical plans live in
[`docs/plans/completed/`](completed/).

When a plan is fully implemented, move it to `docs/plans/completed/` in the same PR that closes the
work, or add a clear status note near the top if it must remain in the active folder for a follow-up
reason. This keeps test and architecture audits from repeatedly re-triaging work that already shipped.

2026-06-07 cleanup:

- Moved `layered-rate-limiting.md` to `completed/` because rate limiting is implemented and
  documented through ADR-0004 and the operator docs.
- Moved `oauth-security-hardening.md` to `completed/` because the file is explicitly marked as a
  historical record and later OAuth/DCR work superseded the remaining stateful-client-store details.

This README is a navigation aid. A plan remaining in this folder means it needs triage or execution;
it does not imply the item is currently scheduled or higher priority than issue/PR work.
