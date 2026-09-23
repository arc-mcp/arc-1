# Fix SAPRead Local-Class Method Include Routing

## Overview

Fix `SAPRead(type="CLAS", method=...)` so method extraction reads the class source section that can
actually contain the method. Qualified RAP/local-class methods use the existing prefix convention to
select `implementations` or `testclasses` when `include` is omitted, while every explicit `include`
value—including `main`—remains authoritative. Keep the public input schema unchanged.

Research and live evidence are recorded in
`docs/research/issues/743-sapread-local-class-method-include.md`.

## Context

### Current State

`handleSAPRead` enters method extraction only when `method` is present and `include` is absent. It
then always reads `/source/main`. That fails for RAP handler methods stored in CCIMP, and a caller who
supplies `include="implementations"` receives the entire include because method extraction is skipped.

The defect reproduces through the ARC-1 handler on SAP_BASIS 816 and 758 with
`/DMO/BP_TRAVEL_M`: `lhc_travel~set_status_accepted` reports no available methods even though the
method is present in `/includes/implementations`. The existing focused handler suite passes 135/135,
confirming the missing coverage.

### Target State

- `method` always triggers extraction for ordinary CLAS text reads.
- An explicit `include` selects exactly that source; `include="main"` selects `/source/main`.
- With no explicit `include`, `lhc_*` and `lcl_*` qualifiers select `implementations`, `ltc_*`
  selects `testclasses`, and all other method names continue to use MAIN.
- Include reads use raw `getClassInclude` bodies and bypass the MAIN-only cache key.
- `method="*"`, active/inactive selection, parser errors, missing includes, and not-found diagnostics
  remain useful and deterministic.
- The tool schema and authorization surface do not change.

### Key Files

- `src/handlers/read.ts` — CLAS source selection and method extraction orchestration.
- `src/handlers/object-types.ts` — existing `detectLocalHandlerInclude` source-selection convention.
- `src/adt/client.ts` — raw `getClassInclude` endpoint access.
- `src/context/method-surgery.ts` — method listing and extraction.
- `tests/unit/handlers/read.test.ts` — handler routing and output regressions.
- `src/handlers/tools.ts`, `tests/fixtures/tool-definitions/` — accurate, byte-pinned LLM guidance.
- `AGENTS.md`, `docs/dev-guide.md`, `docs_page/tools.md` — maintainer and user guidance.
- `docs/research/issues/743-sapread-local-class-method-include.md` — verified issue dossier and final
  implementation evidence.

### Verified Live Evidence

- SAP_BASIS 816 and 758 return identical source separation for `/DMO/BP_TRAVEL_M`: MAIN is a
  152-byte behavior-pool shell, while CCIMP is a 34,446-byte local implementation source containing
  `lhc_travel~set_status_accepted`.
- Current HEAD returns `Available methods: (none)` for the qualified call on both systems.
- Direct class metadata advertises MAIN, definitions, implementations, macros, and testclasses as
  separate `CLAS/I` resources.
- The Eclipse ADT contract and SAP's ADT language server independently model the same five sources.
- PR #743 demonstrates the correct raw-include extraction shape, but its patch silently overrides an
  explicit `include="main"`; this implementation must not inherit that precedence bug.

### Design Principles

1. Reuse `detectLocalHandlerInclude`; do not create a read-only prefix table that can drift from
   `SAPWrite edit_method`.
2. Treat argument presence separately from the resolved endpoint so explicit MAIN cannot collapse
   into omitted `include`.
3. Pass raw source to `listMethods`/`extractMethod`; display wrappers are output formatting, not ABAP.
4. Do not put class includes into the existing `(type, name, version)` cache because the key has no
   source-section dimension.
5. Preserve read-only safety, scope, release, and schema behavior; SAP already exposes the required
   endpoints on the verified releases.

## Development Approach

Use test-driven development: first add the routing and precedence regressions and demonstrate the
expected failures on the current implementation, then make the smallest handler change that passes
them. Review the complete diff for behavior combinations and documentation accuracy, run focused and
full local gates, then replay the fixed product path against both live SAP systems before opening the
pull request.

## Plan Review

The plan was reviewed against the current schema, handler ordering, cache implementation, ADT client,
method parser, write-side routing, external PR #743, and the live 816/758 responses. The review made
four constraints explicit: `main` must be distinguished from an omitted argument; explicit non-MAIN
includes must override a conflicting method prefix; include parsing must use the raw endpoint rather
than `getClass`'s display wrapper; and section reads must not enter the MAIN-only source cache. A new
committed live integration fixture is intentionally unnecessary because this is pure handler routing,
the required `/DMO/` behavior pool is absent on supported 7.50 systems, and the same handler path will
be replayed live on both systems that contain the fixture. Mocked handler tests will pin the requested
URLs and output boundaries durably.

## Validation Commands

```bash
npm test
npm run typecheck
npm run lint
```

### Task 1: Pin the CLAS method source-selection contract with failing tests

- [x] Add a qualified `lhc_*~method` case that expects `/includes/implementations` and returns only
  the requested method.
- [x] Add a qualified `lcl_*~method` case for the same CCIMP route and an `ltc_*~method` case for
  `/includes/testclasses`.
- [x] Add `method` plus explicit `include="implementations"` coverage proving extraction happens and
  unrelated methods are excluded.
- [x] Add precedence coverage proving explicit `include="main"` and a conflicting explicit include
  are honored rather than replaced by prefix detection.
- [x] Preserve MAIN behavior with tests for a bare method and a global-interface-qualified method.
- [x] Cover `method="*"` against an explicit include, requested version propagation, and a missing
  include/error path.
- [x] Run `npx vitest run tests/unit/handlers/read.test.ts` and record that the new regression cases
  fail for the expected source-routing reasons before changing `src/`.

### Task 2: Implement source-aware CLAS method reads

- [x] Import and reuse `detectLocalHandlerInclude` in `src/handlers/read.ts`.
- [x] Resolve the method source from explicit argument presence first, mapping explicit `main` to the
  MAIN endpoint without allowing fallback auto-detection.
- [x] Apply prefix auto-detection only when `include` is omitted.
- [x] Fetch MAIN through the existing cache path and non-MAIN sections through raw
  `client.getClassInclude`, forwarding the effective active/inactive version.
- [x] Run method listing or extraction on the selected raw source and preserve the existing version
  warning and error-result behavior.
- [x] Run the focused handler tests until all new and existing cases pass.

### Task 3: Document the invariant and implementation evidence

- [x] Add a terse `AGENTS.md` routing row for `SAPRead` local-class method reads.
- [x] Add the source-selection, explicit-include precedence, and cache invariant to
  `docs/dev-guide.md`.
- [x] Add user-facing `SAPRead` examples and guidance in `docs_page/tools.md` for qualified local
  methods and explicit include selection.
- [x] Append final implementation and validation results to the issue dossier, correcting any
  assumptions that changed during implementation.
- [x] Keep `schemas.ts` unchanged; update the behavior-changing `tools.ts` guidance and review the
  intentionally regenerated tool-definition snapshots without raising schema or file-size budgets.

### Task 4: Review and verify the implementation

- [x] Review the entire branch diff for explicit/omitted include precedence, endpoint encoding,
  version propagation, cache isolation, text-symbol and structured-format ordering, security scope,
  and accidental schema changes.
- [x] Run the focused handler suite plus relevant method-surgery/object-type suites.
- [x] Run `npm test`, `npm run typecheck`, and `npm run lint`; fix every branch-caused failure and
  repeat review and gates until clean.
- [x] Replay qualified CCIMP extraction, explicit-include extraction, explicit MAIN precedence, and
  method listing through ARC-1 on SAP_BASIS 816 and 758.
- [x] Confirm repository status contains only intended files and no credentials, generated reports,
  or unrelated changes.

### Task 5: Finalize the reviewed change and open a pull request

- [x] Move this plan to `docs/plans/completed/` after every prior task is complete and update internal
  links if necessary.
- [x] Perform a final diff and commit-content review against `origin/main`.
- [x] Commit with a conventional `fix:` subject, push the `codex/` branch, and create a conventional
  `fix:` pull request describing the goal, implementation, live evidence, validation, and relationship
  to external PR #743.
- [x] Verify the created pull request's title, body, base/head, commits, changed files, and checks.
