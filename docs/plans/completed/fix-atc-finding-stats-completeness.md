# Fix ATC completeness semantics (#728)

## Overview

Replace ARC-1's invented `findings.length === sum(FINDING_STATS)` completion rule with the terminal
run lifecycle used by Eclipse ADT, while preserving the proven full-worklist settlement fallback
for SAP releases that execute the run synchronously. Keep severity statistics visible as
informational compatibility data and preserve all structural fail-closed checks.

Research: [Issue #728 dossier](../research/issues/728-atc-finding-stats-completeness.md)

### Context

Issue #728 provides repeated SAP_BASIS 758 runs where ARC-1 returns the correct findings but reports
`complete=false` and `truncated=true` because `FINDING_STATS` sums to a different number. Eclipse
ADT identifies the triple as errors, warnings, and infos; it uses a separate asynchronous run status
to determine completion. Live checks confirm that SAP_BASIS 758 exposes that status while 750
continues to return a synchronous response with no status location.

### Current State

`runAtcCheck()` posts the run without `clientWait=false`, parses the synchronous response's three
statistics into `expectedFindingCount`, and begins polling the worklist. `parseAtcRunResult()` treats
the informational total as an exact expected finding count, synthesizes `truncated`, and requires
equality for `complete`. The poll loop also uses that equality as an early termination condition.

### Target State

Runs advertise their lifecycle through behavior, not a hard-coded release check:

- a safe `/sap/bc/adt/atc/runs/…` response location is polled until a successful terminal status;
- a synchronous response without a location retains the ten-second worklist settlement fallback;
- `FINDING_STATS` is exposed as named informational severity counters and a deprecated total alias;
- terminal evidence and valid worklist structure decide `complete`;
- `truncated` is never inferred from the statistics or the ignored `maximumVerdicts` hint.

### Key Files

- `src/adt/atc.ts` — run protocol, status parsing, worklist parsing, completeness result.
- `src/cli-checks.ts` — dedicated CLI soundness validation; currently repeats the faulty equality.
- `tests/unit/adt/devtools.test.ts` — ATC unit and regression coverage.
- `tests/fixtures/xml/` — captured 758 running/completed status responses.
- `tests/integration/adt.integration.test.ts` — live invariants independent of severity-count equality.
- `tests/unit/cli/cli-checks.test.ts` and `tests/unit/cli/ci-commands.test.ts` — typed result fixtures.
- `AGENTS.md`, `docs/dev-guide.md`, `docs_page/tools.md` — contributor and user-facing semantics.

### Verified Live Evidence

On A4H/SAP_BASIS 758, `POST /atc/runs?worklistId=…&clientWait=false` returns HTTP 201 with a
host-relative run location. Its exact media type reports `Not Yet Started`, then `Running` through
the worklist/display-load phases, and finally `Completed` with worklist/result links. On
NPL/SAP_BASIS 750, the same request
returns HTTP 200 with the legacy `<worklistRun>` body and no location. The reporter and prior PR
#710 supply independent 758 evidence that severity totals can differ from persisted finding counts.

### Design Principles

- Prefer protocol capability evidence over release-number heuristics.
- Treat SAP response URLs as untrusted and constrain them to the exact host-relative ATC run path.
- Preserve the single request deadline and abort signal across variant resolution, run polling, and
  worklist retrieval.
- Fail closed on missing processed-object or malformed structural evidence.
- Keep response compatibility additive; do not change the LLM-visible input schema.
- Use captured real responses for the new parser and keep legacy behavior covered.

## Development Approach

Implement the lifecycle in `src/adt/atc.ts` without changing handler or schema plumbing. Parse the
run response once into raw infos and optional named severity statistics. When a location exists,
validate it, poll the status using `application/vnd.sap.atc.run.v1+xml`, and fetch one worklist after
completion. Without a location, poll the worklist until its timestamp-normalized XML settles. Pass
explicit terminal evidence into the worklist parser so structural validity cannot end the legacy
poll early. Update documentation only after the behavior and tests are stable.

## Validation Commands

```bash
npm test
npm run typecheck
npm run lint
```

### Task 1: Add status and statistics contract coverage

- [x] Add unmodified captured SAP_BASIS 758 `Running` and `Completed` run-status XML fixtures.
- [x] Extend the ATC mock helpers for 201/location/status polling without weakening legacy mocks.
- [x] Add regression tests proving mismatched `FINDING_STATS` does not imply truncation or
      incompleteness once terminal evidence and a valid worklist exist.
- [x] Add tests for running-to-completed polling, exact media type, unsafe locations, terminal
      failure/cancellation, deadline handling, and the synchronous no-location fallback.

### Task 2: Implement release-adaptive run lifecycle handling

- [x] Add a narrow parser for the ATC run status and named run infos.
- [x] Request `clientWait=false`; validate and follow only canonical host-relative ATC run locations.
- [x] Poll `Running` responses under the shared deadline and return explicit incomplete evidence for
      timeout, cancellation, failure, or an unusable terminal status.
- [x] Preserve the synchronous path and its timestamp-normalized ten-second settlement rule.

### Task 3: Decouple severity statistics from completeness

- [x] Expose `{ errors, warnings, infos, total }` statistics and raw run infos in structured results.
- [x] Retain `expectedFindingCount` as a deprecated informational compatibility alias.
- [x] Remove the statistic from `truncated`, worklist poll termination, incomplete reasons, and the
      `complete` predicate.
- [x] Require explicit async completion or legacy settlement plus all existing structural checks.
- [x] Update `evaluateAtc()` to validate the named statistics and lifecycle evidence without
      independently reintroducing `findingCount === expectedFindingCount`.
- [x] Update typed CLI fixtures and integration invariants for the additive result fields.

### Task 4: Update contract documentation

- [x] Update the ATC routing row in `AGENTS.md` and the detailed invariant in `docs/dev-guide.md`.
- [x] Update `docs_page/tools.md` to explain asynchronous completion, the legacy fallback, named
      informational statistics, and structural incomplete outcomes.
- [x] Confirm no tool-definition snapshots change because the input schema is untouched.

### Task 5: Validate and review the implementation

- [x] Run the focused ATC unit, handler, and CLI tests.
- [x] Run the live ATC integration test on SAP_BASIS 758 and verify the completed status path avoids
      the old ten-second count wait.
- [x] Run the validation commands and repository build/size/policy gates required by `AGENTS.md`.
- [x] Review the complete diff for URL safety, deadline propagation, compatibility, stale count
      semantics in both ADT and CLI paths, accidental fixture/schema changes, and unrelated edits.
- [x] Compare the final structured result against issue #728's 44/0 and 47/22 failure mode.

### Task 6: Publish the fix

- [x] Move this plan to `docs/plans/completed/` with its task state preserved.
- [x] Commit the reviewed change with a conventional `fix:` subject.
- [x] Push `codex/fix-atc-completeness` and create a `fix:` pull request that links #728, explains
      the corrected root cause, lists live evidence and validation, and calls out the 750 fallback.

## Post-review hardening

Claude's review of PR #729 identified two applicable cross-release robustness gaps. Unknown
non-failure run statuses now remain pending instead of being treated as terminal, and every async
protocol-deviation/failure/deadline path attempts to preserve worklist findings without weakening
the terminal-evidence requirement. The review also prompted explicit documentation that modern
empty HTTP 201 responses cannot carry legacy run statistics, the synchronous fallback adds at least
ten seconds, and `truncated` remains false until SAP provides an independent reliable signal.

The suggested removal of `expectedFindingCount` was not applied: it shipped in 1.1.0, and removing
it in this patch would break structured-response consumers. It remains a deprecated compatibility
alias and is documented as null on modern asynchronous runs.
