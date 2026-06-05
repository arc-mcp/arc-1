# Implement Feature

Quality-first implementation workflow for ARC-1 features. Guides you through research, planning, test-driven development, and documentation updates.

## Input

The user provides a feature description — either a reference to a gap analysis item (e.g., from `compare/08-dassian-adt-feature-gap.md`), a GitHub issue, or a free-form description.

SAP auth guidance:
- When touching auth (Layer A or Layer B), read `docs/enterprise-auth.md#coexistence-matrix` first. The `validateConfig` fail-fast rules in `src/server/config.ts` are the authoritative source — extend them if adding a new combination.

Ask the user for:
- **Feature description** (required) — what to implement
- **Scope** (optional) — small/medium/large, helps calibrate effort

If only a description is given, infer scope from the description and proceed.

---

## Phase 1: Research & Understand

Before writing any code, understand the full picture.

### 1a. Read project guidelines

Read `CLAUDE.md` to refresh on project conventions, code patterns, and key file mappings.

### 1b. Understand existing code in the affected area

Based on the feature description, identify and read all relevant source files. Use the "Key Files for Common Tasks" table in CLAUDE.md as a starting point:

| Task | Files |
|------|-------|
| Add new read operation | `src/adt/client.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts` |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/intent.ts` |
| Add safety check | `src/adt/safety.ts` |
| Add XML parser rule | `src/adt/xml-parser.ts` |
| Add error handling | `src/adt/errors.ts`, `src/handlers/intent.ts` |
| Add transport feature | `src/adt/transport.ts`, `src/handlers/intent.ts` |
| Add DDIC domain/data element write | `src/adt/ddic-xml.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts` |
| Add context feature | `src/context/compressor.ts`, `src/context/deps.ts` |
| Add CDS impact analysis context | `src/adt/cds-impact.ts`, `src/adt/codeintel.ts` (`findWhereUsed`), `src/handlers/intent.ts` (`SAPContext action="impact"`), `tests/unit/adt/cds-impact.test.ts` |
| Add diagnostic | `src/adt/diagnostics.ts`, `src/handlers/intent.ts` |

### 1c. Read existing tests for the affected area

Find and read the corresponding test files in `tests/unit/` that mirror the source structure. Understand:
- What mocking patterns are used (axios mock, spy patterns)
- What fixtures exist in `tests/fixtures/xml/` or `tests/fixtures/abap/`
- How similar features are tested

### 1d. Check for prior art

Search the codebase for similar patterns already implemented. If the feature extends an existing pattern (e.g., adding a new error hint follows the same shape as existing ones), identify that pattern to follow consistently.

### 1e. Summarize findings

Before proceeding, output a brief summary:
- **Affected files** (source + test)
- **Existing patterns** to follow
- **Dependencies** or prerequisites
- **Security considerations** (does this need safety checks? new OperationType?)

---

## Phase 2: Plan & Align

### 2a. Create an implementation plan

Enter plan mode to draft the implementation strategy. The plan should include:

1. **What changes** — list each file and what will be modified/added
2. **Test strategy** — what unit tests, integration tests, and (if applicable) e2e tests to write
3. **Safety & security** — any new safety checks, input validation, or security considerations
4. **Documentation impact** — which docs need updating (README, docs/, tool descriptions)
5. **Commit strategy** — how to split into logical commits (prefer small, focused commits)

### 2b. Align with the user

Present the plan and wait for user approval before proceeding to implementation. Specifically call out:
- Any design decisions that have trade-offs
- Any scope creep risks (features that could balloon)
- Any missing information needed from the user

---

## Phase 3: Implement (Test-First)

Follow test-driven development where practical. For each logical change:

### 3a. Write tests first

Write unit tests BEFORE the implementation. This ensures:
- You understand the expected behavior before coding it
- Tests actually test the right thing (not written to match existing code)
- Edge cases are considered upfront

**Unit test conventions for this project:**
- Test files mirror source structure: `src/adt/foo.ts` → `tests/unit/adt/foo.test.ts`
- Use vitest: `describe`, `it`, `expect`, `vi.fn()`, `vi.mock()`
- Mock axios at module level for HTTP tests:
  ```typescript
  vi.mock('axios', () => ({ default: { create: vi.fn(() => mockInstance) } }));
  ```
- Use XML fixtures from `tests/fixtures/xml/` for ADT response parsing
- Test both success paths AND error paths
- Test edge cases: empty inputs, malformed data, boundary conditions

### 3b. Verify tests fail

Run `npm test` to confirm the new tests fail (since the implementation doesn't exist yet). This validates the tests are actually testing something.

### 3c. Implement the feature

Write the minimal code to make the tests pass. Follow project patterns:

- **ADT client methods**: `checkOperation()` → HTTP call → parse response
- **Handler routing**: case statement in `intent.ts` dispatching to client methods
- **Safety checks**: use `checkOperation(this.safety, OperationType.X, 'OpName')`
- **Error handling**: throw typed errors (`AdtApiError`, `AdtSafetyError`)
- **Input validation**: define Zod v4 schemas in `src/handlers/schemas.ts` — see existing schemas for pattern
- **Logging**: use structured logger, stderr only, redact sensitive fields

### 3d. Verify tests pass

Run `npm test` to confirm all tests pass, including existing tests (no regressions).

### 3e. Run full quality checks

Run all three in sequence:
```bash
npm run lint
npm run typecheck
npm test
```

Fix any issues before proceeding.

---

## Phase 4: Integration & Edge Cases

### 4a. Add integration test coverage (if applicable)

If the feature involves SAP system interaction, add integration tests:
- File: `tests/integration/adt.integration.test.ts` (on-premise) or `tests/integration/btp-abap.integration.test.ts` (BTP)
- Use `getTestClient()` from `tests/integration/helpers.ts`
- Tests are auto-skipped when SAP credentials aren't configured
- Use 30-second timeouts for SAP calls

### 4b. Test error scenarios

Ensure error paths are covered:
- What happens with invalid input?
- What happens when the SAP system returns an error?
- What happens when safety checks block the operation?
- Are error messages LLM-friendly (actionable hints, not raw stack traces)?

Troubleshooting guidance should reuse ARC-1's SAP-domain error intelligence:
- Lock/enqueue failures should reference `SM12`
- Authorization failures should reference `SU53` (and role follow-up in `PFCG`)
- Transport-related failures should reference `SE09`
- RAP activation dependency failures should guide users to `SAPRead(type='INACTIVE_OBJECTS')` before retrying `SAPActivate`

### 4c. Test with hyperfocused mode (if applicable)

If the feature adds or modifies a tool, verify it works in both:
- Standard mode (12 tools) — `src/handlers/tools.ts`
- Hyperfocused mode (1 tool) — `src/handlers/hyperfocused.ts`

---

## Phase 5: Documentation

### 5a. Update tool descriptions (if applicable)

If the feature changes tool behavior, update the tool description in `src/handlers/tools.ts`. Tool descriptions are the primary documentation for LLM consumers — they must be accurate and complete.

### 5b. Update end-user documentation

Check and update as needed:
- `docs/tools.md` — tool reference
- `docs/mcp-usage.md` — agent workflow patterns
- `README.md` — if feature is user-facing
- `docs/cli-guide.md` — if CLI flags changed

### 5c. Update CLAUDE.md (if applicable)

If the feature adds new files, patterns, or conventions, update the relevant sections in `CLAUDE.md`:
- Codebase Structure table
- Key Files for Common Tasks table
- Code Patterns section

### 5d. Update feature gap tracking (if applicable)

If implementing a feature from `compare/08-dassian-adt-feature-gap.md` or similar tracking docs, update the status to reflect the implementation.

---

## Phase 6: Final Verification

### 6a. Run the full test suite

```bash
npm run lint && npm run typecheck && npm test
```

All must pass with zero warnings in lint/typecheck.

### 6b. Review the diff

Before committing, review all changes:
- No unrelated changes snuck in
- No debug code left behind
- No `console.log` (use structured logger instead)
- No `any` types (use proper typing)
- No commented-out code
- Sensitive fields properly redacted in any new logging

### 6c. Verify commit message

Use conventional commits for the PR title/commit:
- `feat:` for new features (minor bump)
- `fix:` for bug fixes (patch bump)
- `chore:` for non-functional changes

---

## Quality Checklist

Before marking the feature as complete, verify:

- [ ] **Tests written first** — unit tests exist for all new code paths
- [ ] **Tests pass** — `npm test` green, no skipped tests (unless integration)
- [ ] **Lint clean** — `npm run lint` zero errors
- [ ] **Type safe** — `npm run typecheck` zero errors
- [ ] **Security reviewed** — safety checks in place, no new OWASP risks
- [ ] **Error handling** — errors are typed, messages are LLM-friendly
- [ ] **Documentation updated** — tool descriptions, docs/, CLAUDE.md as needed
- [ ] **No scope creep** — only what was requested, nothing extra
- [ ] **Conventional commit** — proper `feat:`/`fix:`/`chore:` prefix
- [ ] **Integration tests** — added if feature touches SAP system interaction
