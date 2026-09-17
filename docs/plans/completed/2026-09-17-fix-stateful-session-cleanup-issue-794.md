# Fix stateful ADT session cleanup — issue #794

**Status:** Completed in [PR #803](https://github.com/arc-mcp/arc-1/pull/803).

**Research:** [Issue #794 dossier](../../research/issues/794-stateful-http-session-leak.md)

## Goal

Ensure every ARC-1-owned stateful ADT context is explicitly closed after its lock/write/unlock block,
on both success and failure, without changing public tools or masking the original operation result.

## Design review

The implementation stays in `AdtHttpClient`, which already owns the isolated stateful client and is
used by every stateful write path. It follows SAP Eclipse ADT's exact close exchange rather than
adding cleanup to each CRUD helper or introducing a session manager.

The plan deliberately excludes cookie synchronization, cleanup retries, a reaper, configuration,
and new abstractions. Live evidence did not require them. Cleanup is best-effort because the write
may already be persisted; a teardown failure must not turn that into a misleading write failure or
replace the original exception.

## Task 1: Pin the lifecycle with regression tests

**File:** `tests/unit/adt/http.test.ts`

- [x] Assert that a configured `stateless` session emits `X-sap-adt-sessiontype: stateless`.
- [x] Assert the exact close URI, GET method, purpose header, context header, stateless header, and
      same-session cookie after a callback establishes `sap-contextid`.
- [x] Assert cleanup runs when the callback throws and preserves the original error.
- [x] Assert close failure does not fail a successful callback.
- [x] Assert a missing close resource falls back to the release-compatible stateless transition.
- [x] Assert no close request is sent when SAP never supplied a context id.

## Task 2: Implement the central close lifecycle

**File:** `src/adt/http.ts`

- [x] Make normal and CSRF request builders emit either configured session type.
- [x] Add one private best-effort close method using SAP's dedicated session endpoint and headers,
      with the verified NW 7.50 fallback only when that resource returns 404.
- [x] Await the callback and invoke close in `finally` inside `withStatefulSession()`.
- [x] Keep authentication, cookies, proxying, semaphore use, and request error handling on the
      existing transport path; do not hand-build a parallel HTTP request.
- [x] Run the focused HTTP-client tests, typecheck, and lint.

## Task 3: Validate offline and on live SAP systems

**Files:** implementation, tests, and issue dossier

- [x] Run the complete unit suite plus build, typecheck, lint, size checks, and diff checks.
- [x] On SAP_BASIS 758, execute public create/update/activate operations and prove with SM04 that no
      new HTTPS application session remains.
- [x] On SAP_BASIS 750, run a stateful lock/unlock/close cycle to verify release compatibility.
- [x] Delete the disposable 758 class and verify it is absent.
- [x] Record exact release-scoped outcomes and qualifications in the issue dossier.

## Task 4: Review, finish documentation, and prepare the PR

**Files:** all changed files, plan, and dossier

- [x] Review the full diff for lifecycle correctness, error preservation, authentication safety,
      compatibility, test quality, and unnecessary complexity.
- [x] Fix every material finding and repeat affected tests until the review is clean.
- [x] Update the dossier with the implemented result and move this checked plan to
      `docs/plans/completed/`.
- [x] Confirm no credentials, disposable artifacts, generated build output, or unrelated changes
      are present.
- [x] Commit with a conventional `fix:` subject, push the branch, and create a PR linking issue
      #794 with offline and live validation evidence.

## Validation commands

```bash
npx vitest run tests/unit/adt/http.test.ts
npm run typecheck
npm run lint
npm run build
npm run check:sizes
npm test
git diff --check
```

## Validation result

- `npm test`: 219 files and 6,793 tests passed.
- `npm run typecheck`, `npm run build`, `npm run lint`, `npm run check:sizes`,
  `npm run docs:build`, touched-file Biome, and `git diff --check`: passed.
- The HTTP transport and its shared test harness deliberately received small, reviewed file-size
  budget increases. Keeping the lifecycle and its tests beside the existing cookie/fetch machinery
  is easier to review than introducing one-feature adapter modules or duplicating the test harness.
- SAP_BASIS 758: success, failure, activation, and delete paths retained no HTTPS row in SM04.
- SAP_BASIS 750 SP02: the 404-only fallback reset `sap-contextid` to `0`; public CRUD passed.
- Disposable objects on both systems were deleted and confirmed absent.

## Acceptance criteria

1. A stateful context carrying `sap-contextid` receives the verified close-session GET in all exit
   paths.
2. The close request carries `X-sap-adt-sessiontype: stateless`; normal stateful calls are unchanged.
3. Missing context skips cleanup; teardown failure cannot mask the callback result or error.
4. One public SAPWrite no longer adds a retained HTTPS application session in SM04 on SAP_BASIS 758.
5. SAP_BASIS 750 uses its verified stateless-transition fallback and all offline checks pass.
