# Release readiness — #811

## Release inputs

The pending **1.4.0** release covers #807 (Connectivity session reuse), #829 (extension reports),
#813 (XSUAA descriptor compatibility), #809 (server-driven where-used), #828 (legacy ADT discovery)
and #678 (callback restrictions). Its annotated notes include all six changes and link to #678's
admin migration. The annotations are carried by #678 so they survive release-please regeneration.

## Before publishing

After #678 merges, let release-please regenerate #811 from `main`. Check its version, complete
changelog-to-notes coverage and release date, then validate that candidate: unit tests, typecheck,
build, lint, policy, size/schema budgets, MTA validation, strict docs and packed-npm smoke.
Earlier candidate results do not validate a regenerated release. Live callback evidence and its
deployment limitations remain in [the #678 record](2026-09-21-oauth-callback-revalidation.md).

release-please rebuilds its branch from `main` with `force: true`
([implementation](https://github.com/googleapis/release-please/blob/v17.6.0/src/github.ts)); any later
feature/fix merge requires another reconciliation. Do not use `workflow_dispatch` on `release.yml`
to refresh the PR: it also runs `publish-npm`.

Roadmap: no impact; this is release preparation for existing changes.
