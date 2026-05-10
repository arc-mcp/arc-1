# Fix Apply Quickfix 500

## Overview

This plan fixes `SAPDiagnose(action="apply_quickfix")` so ARC-1 sends ADT quickfix application requests in the same XML model shape used by Eclipse ADT instead of the current partial body that can trigger SAP HTTP 500 responses such as "Dereferencing of the NULL reference".

The implementation keeps the existing `quickfix` and `apply_quickfix` tool actions, but hardens the model: `proposalUserContent` may be an empty string, proposals can carry affected object references, apply uses `application/xml`, callers can override the exact ADT `sourceUri` for include-level quickfixes, and delta parsing understands the ADT `proposalResult/deltas/unit` response shape. This PR does not try to replace Eclipse-only RAP behavior implementation wizards; it makes the generic ADT quickfix apply path correct and returns useful results for backend-applicable fixes.

## Context

### Current State

`src/adt/devtools.ts` can evaluate quickfix proposals and `SAPDiagnose(action="quickfix")` returns useful ADT proposals. The apply path currently builds a minimal `<quickfixes:proposalRequest>` body, posts it with `application/*`, drops affected objects returned by evaluation, requires a truthy `proposalUserContent` in `src/handlers/intent.ts`, and parses only legacy-looking `delta` nodes rather than the Eclipse ADT XSD-native `proposalResult/deltas/unit` response.

Research inputs for this PR include the saved chat transcript, `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/RUN-NOTES.md`, `/Users/marianzeis/DEV/arc-1-eclipse-adt/pr-review-guide.md`, Eclipse ADT 3.58 bundles under `/Users/marianzeis/eclipse/java-2025-09/Eclipse.app`, the public apidoc folder `/Users/marianzeis/DEV/arc-1-eclipse-adt/com.sap.adt.core.apidoc-3.58.1`, and existing ARC-1 compare notes. `INFRASTRUCTURE.md` was not present in this checkout. The public ADT apidoc does not expose quickfix internals, but the installed Eclipse bundles include `quickfixes.xsd`, `QuickfixService.apply`, and `RefactoringSerializationUtil.serializeQuickfixProposalRequest`, which define the request and response model.

### Target State

`apply_quickfix` accepts the exact proposal payload returned by `quickfix`, including empty `userContent`, optional affected object references, and an optional exact `sourceUri` for class includes such as `/includes/definitions`. ARC-1 serializes proposal application as valid ADT quickfix XML, posts with `application/xml`, and parses both existing delta fixtures and XSD-native unit deltas. The XML body follows `quickfixes.xsd` with a namespaced `quickfixes:proposalRequest` root and unqualified quickfix child elements such as `input`, `content`, `affectedObjects`, `unit`, and `userContent`. Existing clients that pass `proposalUri` and `proposalUserContent` continue to work.

The RAP `create_class_implementation` quickfix may still require a higher-level non-UI wrapper in a later PR because Eclipse's BDEF UI handler opens a wizard before apply. This PR should still eliminate avoidable ARC-1-side 500s and make backend-applicable quickfixes work predictably on S/4HANA 2023 and NW 7.50-compatible systems.

### Key Files

| File | Role |
|------|------|
| `src/adt/types.ts` | Defines `FixProposal`, `FixDelta`, and the quickfix data model shared by ADT and handlers. |
| `src/adt/devtools.ts` | Implements `getFixProposals`, `applyFixProposal`, XML request serialization, and quickfix response parsing. |
| `src/handlers/intent.ts` | Routes `SAPDiagnose` quickfix actions and validates handler-level required fields. |
| `src/handlers/schemas.ts` | Defines Zod validation for `SAPDiagnose` input fields. |
| `src/handlers/tools.ts` | Publishes MCP tool schema and descriptions for quickfix parameters. |
| `tests/unit/adt/devtools.test.ts` | Unit coverage for ADT quickfix request bodies and XML parsing. |
| `tests/unit/handlers/intent.test.ts` | Unit coverage for `SAPDiagnose` routing and handler validation. |
| `tests/unit/handlers/schemas.test.ts` | Unit coverage for accepted `SAPDiagnose` payload shapes. |
| `tests/unit/handlers/tools.test.ts` | Unit coverage for generated tool schema metadata. |
| `README.md` | User-facing tool capability table. Dedicated `docs/tools.md`, `docs/index.md`, and `docs/roadmap.md` files are not present in this checkout. |
| `docs/plans/completed/fix-proposals-auto-fix-from-atc.md` | Prior quickfix implementation plan and historical design notes. |

### Design Principles

1. Follow Eclipse ADT's XML model where observed: `proposalRequest` contains `input` as a quickfix `unit`, optional `affectedObjects`, and optional `userContent`; apply posts as `application/xml`. Per `quickfixes.xsd` `elementFormDefault="unqualified"`, child elements inside the quickfix namespace are serialized without the `quickfixes:` prefix.
2. Preserve backwards compatibility: existing `proposalUri` plus `proposalUserContent` calls should keep working, including non-empty legacy user content and the default type/name main-source URI.
3. Treat empty `proposalUserContent` as valid data, not as a missing required field.
4. Do not invent a RAP-specific behavior implementation generator in this PR; document that as follow-up because Eclipse's RAP quickfix path has UI-specific pre-apply behavior.
5. Keep SAP safety posture unchanged: this is still a diagnostic/devtools operation routed through existing ADT calls and server-side authorization.

## Development Approach

Implement the ADT model changes first, then wire optional affected-object payloads through `SAPDiagnose`, then update documentation and tests. Use unit tests with mocked `undici` responses for deterministic request-body and parser verification. Live SAP tests are useful as smoke checks only when credentials are available; they are not required for CI because the regression is in request serialization and response parsing.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Harden ADT quickfix serialization and parsing

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

This task fixes the ADT-layer contract before tool routing is changed. It should follow Eclipse ADT's quickfix model while preserving the current public method names.

- [x] Extend quickfix types with optional affected object units carrying URI metadata and optional source content.
- [x] Update `parseFixProposals()` to preserve affected object references returned by quickfix evaluation.
- [x] Update `applyFixProposal()` to use `application/xml` and serialize `input`, optional `affectedObjects`, and optional `userContent` safely.
- [x] Update `parseFixDeltas()` to parse ADT `proposalResult/deltas/unit` responses in addition to the existing legacy delta shapes.
- [x] Add unit tests (~6 tests): affected object parsing, `application/xml` apply content type, empty user content handling, affected object serialization, XSD-native unit delta parsing, and compatibility with the existing delta parser.
- [x] Run `npm test -- tests/unit/adt/devtools.test.ts` — all ADT quickfix tests must pass.

### Task 2: Wire affected quickfix proposals through SAPDiagnose

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

This task makes `SAPDiagnose(action="apply_quickfix")` accept the complete proposal shape produced by `quickfix`. The most important behavior change is accepting `proposalUserContent: ""` as valid.

- [x] Add optional `proposalAffectedObjects` validation for affected object units with URI metadata and optional content.
- [x] Change handler validation so `proposalUserContent` is missing only when it is `undefined`, not when it is an empty string.
- [x] Pass `proposalAffectedObjects` into `client.applyFixProposal()`.
- [x] Add optional `sourceUri` override for include-level quickfix targets while preserving the type/name default.
- [x] Update MCP tool schema and descriptions to say `proposalUserContent` may be empty and affected objects should be passed through when returned by `quickfix`.
- [x] Add unit tests (~5 tests): empty user content accepted, missing user content still rejected, affected objects forwarded into the apply body, schema accepts the new payload shape, and tool schema exposes the new field.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts` — all handler quickfix tests must pass.

### Task 3: Update docs and plan status

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/completed/fix-proposals-auto-fix-from-atc.md`
- Modify: `docs/plans/completed/fix-apply-quickfix-500.md`

This task records the externally visible behavior and the boundary discovered during research. It should not overpromise RAP behavior implementation generation because that still needs a separate feature.

- [x] Update `README.md` for `SAPDiagnose` quickfix capability visibility.
- [x] Add a short hardening note to the completed fix-proposals plan that records the Eclipse ADT `application/xml` and `proposalResult/deltas/unit` findings.
- [x] Mark this plan's implementation checkboxes as completed after code and docs land.
- [x] Move this plan to `docs/plans/completed/`.
- [x] Run `npm test -- tests/unit/adt/devtools.test.ts tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts` — targeted tests must pass after docs changes.

### Task 4: Final verification and PR

**Files:**
- Review: all modified files
- Review: git diff

This task performs the implementation review requested by the user, then prepares the branch for review.

- [x] Run full test suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Review the final diff for accidental secrets, unrelated churn, and compatibility with the PR-B scope.
- [x] Commit with a conventional `fix:` message.
- [x] Push branch `codex/fix-apply-quickfix-500`.
- [x] Create a pull request with a `fix:` title and a description covering goal, content, and validation.
