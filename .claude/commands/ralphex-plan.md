# ralphex Plan Creator

Generate a structured implementation plan for the ralphex autonomous coding agent. The plan must be detailed enough for an autonomous agent (Claude Code) to execute each task without human guidance, in isolated sessions with fresh context.

> Canonical plan-file format and ralphex behavior: `docs/ralphex.md`. ralphex creates a git branch from the plan filename, runs each `### Task N:` in a fresh Claude Code session, runs `## Validation Commands` after each task, then runs a multi-agent review pipeline. The plan file is the *only* shared state between tasks.

**The golden rule (why most plans fail):** ARC-1 plans break when they assert SAP facts that aren't true on the target system — non-existent tool actions, wrong ADT endpoints/URLs, invented `objectType`/slash codes, XML response shapes ADT never emits, or behavior that differs by SAP release. A fresh-context agent has no way to know a fact is wrong; it implements the plan as written and ships the bug (a `200 OK` does **not** mean a filter or type was honored). **Every SAP-specific fact in the plan must be verified against the live system during research and cited as evidence** (see Phase 1g). When in doubt, verify; never plan from memory of ADT internals.

## Input

The user provides a feature/task description. This can be:
- A free-form description ("add caching for ADT responses")
- A reference to a gap analysis or roadmap item
- A GitHub issue
- A detailed requirements brief

If the description is vague, ask 1-2 targeted clarifying questions before proceeding. Don't over-interview — get enough to start researching.

---

## Phase 1: Deep Research

Before writing a single line of the plan, research exhaustively. ralphex tasks execute in isolated Claude Code sessions with **no shared context** — every task must be self-contained. The quality of your research directly determines whether the autonomous agent succeeds or gets stuck.

### 1a. Read project guidelines

Read `CLAUDE.md` in full. Pay attention to:
- Codebase structure (the file tree)
- Key Files for Common Tasks table
- Code patterns (ADT client method, handler pattern, safety check)
- Testing conventions (vitest, mock patterns, fixture locations)
- Technology stack
- Configuration options (the config table — new features may need new flags)

### 1b. Read infrastructure docs

Read `INFRASTRUCTURE.md` for context on the live test systems:
- The **three live SAP systems** and their releases — NW 7.50 (`npl.marianzeis.de`), S/4HANA 2023 / SAP_BASIS 758 (`a4h.marianzeis.de`), and ABAP Platform 2025 / SAP_BASIS 816 (`a4h-2025`). Host/port/credentials patterns are in `INFRASTRUCTURE.md`.
- BTP deployment details
- How to run integration/smoke tests and the `arc1-cli` / `npm run probe` commands against a live system
- PP (Principal Propagation) setup if auth-related

**Behavior diverges by release.** DDIC object routing, lock/stateful-session semantics, activation, lint grammar (abaplint ceiling is 758), release detection, and many ADT endpoints behave differently across 7.50 / 758 / 816. A feature "verified live" on one box is *not* proven on the others. This has caused a long tail of release-specific follow-up fixes (e.g. TABL create corrupting tables on 7.50, transport-target gating, lint false-blocks on 816). For any feature touching those areas, the plan must state expected behavior per release and verify on at least the oldest (7.50) and one newer (758/816) system, or explicitly justify why the change is release-invariant.

### 1c. Map the affected code

Based on the feature description, identify ALL files that will need changes. For each file:
- Read the current implementation
- Note line numbers for key sections
- Understand the patterns used

Use the "Key Files for Common Tasks" table in CLAUDE.md as a starting point, then trace the call chain to find additional files.

### 1d. Read existing tests

For every source file you plan to modify, find and read its test counterpart:
- Unit tests in `tests/unit/` (mirror source structure)
- Integration tests in `tests/integration/` if applicable
- Fixtures in `tests/fixtures/xml/` and `tests/fixtures/abap/`
- Understand mocking patterns: `vi.mock('undici', ...)` + `mockResponse()`

### 1e. Check for prior art

Search the codebase for similar patterns. If the feature extends an existing pattern, identify it to ensure consistency. Also check:
- `docs/plans/completed/` — similar completed plans for format reference. **Pick a real ralphex plan as your template** — one that has both `### Task N:` sections and a `## Validation Commands` section (e.g. `fix-tabl-ds-create-routing.md`, `add-server-driven-object-read.md`, `add-cds-test-cases-scaffolding.md`). Several files under `docs/plans/` are prose design/research docs (the dated `2026-03-2x-*` files, `*-research.md`) with **no tasks** — do not copy their shape, and note that at least one older plan leaked checkboxes into a `## Success criteria` block (the anti-pattern in Rule 2). Don't inherit that.
- `docs/research/` — existing research documents
- `docs/plans/` — in-progress plans to avoid conflicts
- **If this task originated from a prior autonomous run** (ralphex, Cursor, or Codex) — read that run's log / progress file / `RUN-NOTES.md` first. Turn every "friction to note", wrong-tool-call, dead-end, and surprise into an explicit task or a documented constraint in the plan. These logs are the richest source of real execution pain (e.g. the `tadir_lookup` split-brain note from a run became a shipped feature).

### 1e2. Audit documentation, roadmap, feature matrix & skills

Every feature plan must account for the full artifact surface. Research what needs updating:

**Published documentation site (`docs_page/`)**
The user-facing docs live in `docs_page/` (this is the mkdocs `docs_dir` — see `mkdocs.yml`), **not** `docs/`. Read the ones that relate to the feature area. Key files include:
- `docs_page/tools.md` — tool reference (update if adding/changing tool operations or parameters)
- `docs_page/authorization.md` — auth model (update if changing safety, scopes, or auth behavior)
- `docs_page/security-guide.md` — security practices (update if changing security posture)
- `docs_page/caching.md` — caching architecture (update if touching cache layer)
- `docs_page/architecture.md` — architecture overview (update if changing request flow or major components)
- `docs_page/cli-guide.md` — CLI reference (update if adding new flags/env vars)
- `docs_page/docker.md`, `docs_page/btp-abap-environment.md`, `docs_page/enterprise-auth.md` — deployment docs (update if changing config or deployment behavior)

**Internal working docs (`docs/`)**
- `docs/setup-guide.md` — local/dev setup
- `docs/testing-skip-policy.md`, `docs/integration-test-skips.md` — test skip taxonomy (read before writing test tasks)
- `CLAUDE.md` (repo root) — AI assistant guidelines (update Key Files table, config table, codebase structure tree, code patterns — this is critical since autonomous agents depend on it)

While reviewing each doc, **verify its concrete claims against the current code** — not just whether it reads as stale. Counts ("N parallel probe requests"), endpoint paths, action/enum lists, and "works regardless of X" statements drift silently as code changes. Tool docs and runtime behavior are one product surface: if a doc claim no longer matches the code, that is a **required fix item in this plan**, not a "bonus" — and a task that changes behavior must update every doc that described the old behavior. Note genuinely unrelated staleness as bonus items.

**End-user documentation (`README.md`, `docs_page/index.md`)**
Read `README.md` and `docs_page/index.md`. Check whether:
- Feature highlights or capability lists need updating
- Quick start or client config examples need changes
- The feature table / badge section reflects the new capability

**Roadmap (`docs_page/roadmap.md`)**
Read `docs_page/roadmap.md`. Check whether:
- The feature corresponds to an existing roadmap item (update status to "completed" or "in progress")
- A new roadmap entry is needed
- The "Current State" feature matrix at the top needs a new row
- Any related items should be marked as unblocked or superseded

**Feature matrix (`docs/compare/00-feature-matrix.md`)**
Read `docs/compare/00-feature-matrix.md`. Check whether:
- The feature adds a new capability that should appear in the comparison matrix
- An existing row needs its status updated (e.g., from ❌ to ✅)
- The "Last Updated" date should be refreshed

**Skills (`.claude/commands/*.md`)**
Read all skill files in `.claude/commands/`. Check whether:
- Any existing skill can leverage the new feature (e.g., a new ADT operation that `explain-abap-code.md` or `implement-feature.md` could use)
- A skill's instructions reference behavior that the feature changes (update the skill)
- A new skill is warranted for the feature
- Existing skills have outdated references to tool names, parameters, or workflows

### 1f. SAP-specific research (when needed)

If the feature involves SAP-specific concepts (ADT APIs, authorization objects, BTP services, ABAP language features), use available MCP tools:
- `sap-docs` MCP tools — search SAP documentation, discovery center, community
- `sap-notes` MCP tools — search SAP Notes for known issues, corrections, recommendations (cite the Note number in the plan when a hint or workaround depends on it)
- Use these whenever the feature touches SAP domain knowledge (new ADT endpoints, auth objects, BTP service config, ABAP language features). Pair documentation research with the live verification in 1g — docs tell you what *should* happen; the live system tells you what *does*.

### 1g. Verify the SAP surface live (mandatory for any SAP-touching feature)

This is the single most important research step and the one most often skipped. Plans repeatedly assert ADT facts that turn out false on the target system — tool actions that don't exist, wrong endpoint URLs, invented `objectType`/slash codes, XML response shapes ADT never emits, or object-create mechanisms that differ from what was assumed (e.g. a source-based `extend type` vs a hand-built `appendStructure` XML builder). A fresh-context executor cannot catch these; it ships them. **A `200 OK` does not prove an `objectType` filter or type code was honored — ADT silently ignores unknown filters and still returns 200.**

Before writing any task that depends on an external surface, confirm it against a live system (creds + recipes in `INFRASTRUCTURE.md`):

- **Tool actions / parameters exist:** `arc1-cli tools <Tool>` prints the live JSON schema; `arc1-cli call <Tool> --<param> <value> ...` runs it end-to-end (e.g. `arc1-cli call SAPRead --type VIEW --name V_USR_NAME`). Confirm every tool action a task names actually exists and accepts the parameters you plan to pass.
- **ADT endpoints return the assumed shape:** capture the *real* response body, don't assume it. For type-availability/response-shape questions use `npm run probe -- --save-fixtures tests/fixtures/probe/<name>` (with `TEST_SAP_URL` etc. set per `INFRASTRUCTURE.md`).
- **Object create/read paths match reality:** source-based DDL vs XML-metadata create; which include/section a class subclass must live in; etc.
- **Behavior per release:** re-check on the oldest (7.50) and a newer (758/816) system when the area is release-sensitive (see 1b).

Then **cite the evidence in the plan**: a captured real ADT response saved to `tests/fixtures/xml/`, an `npm run probe` fixture, the `arc1-cli` command + its observed output, or a `docs/research/` write-up. A task that introduces or changes an ADT endpoint URL, an `objectType`/slash code, an Accept/content-type header, or an XML-response parser MUST include a step that asserts the parser against a *real* captured response — never against a hand-written fixture alone. Never reference a tool action, endpoint, or payload shape you have not confirmed exists on the target release.

For a strong example of a live-verified plan, see `docs/plans/completed/2026-06-05-add-server-driven-object-read.md` (its dated "Verified Live Evidence" block) and `docs/plans/completed/2026-05-08-audit-purge-invented-adt-types.md` (the audit that unwound a batch of invented type codes that had shipped because nobody checked the response *content*).

### 1h. Summarize findings

Before writing the plan, organize your findings:
- **Affected files** (source + test + config + docs + skills)
- **Existing patterns** to follow (with stable symbol names + file:line references)
- **Verified live evidence** (the `arc1-cli`/probe commands run, captured responses, per-release behavior observed)
- **Adjacent paths impacted** (for each new field/param/cache: which sibling paths — create/update/delete/activate, read/write, the `withSafety()` clone — must also handle it)
- **Dependencies** between changes
- **Security/safety considerations**
- **Test strategy** (what to test, how to test it — unit, integration, and E2E; happy path **and** failure/negative paths)
- **Documentation updates** (which docs in `docs_page/`, roadmap entries, feature matrix rows, skills)
- **Outdated docs spotted** (claims that no longer match code — required fixes — plus unrelated staleness as bonus items)

---

## Phase 2: Write the Plan

Write the plan to `docs/plans/<descriptive-name>.md`. The filename should be kebab-case and describe the feature (e.g., `add-cache-warmup.md`, `authorization-roles-scopes.md`).

### Plan Structure

The plan MUST follow this exact structure for ralphex compatibility:

```markdown
# <Title>

## Overview

<1-3 paragraphs: what this plan does, why, and key design decisions>

## Context

### Current State
<What exists today, what's missing or broken — anchored to real symbols/files>

### Target State
<What the end result looks like>

### Key Files

| File | Role |
|------|------|
| `src/...` | Description of what this file does |

### Verified Live Evidence
<OPTIONAL but strongly recommended for any feature touching ADT endpoints / DDIC objects / type codes.
Dated, system-vs-system ground truth captured during Phase 1g, e.g.:
"2026-06-05, a4h-2025 (816) vs a4h (758): GET .../<endpoint> returns <shape>; 758 → 404.
Verified via `arc1-cli call SAPRead --type DESD --name ...`. Fixture: tests/fixtures/sdo/desd.json">

### Design Principles
<Numbered list of architectural decisions and constraints. Call out release-dependent
behavior explicitly (7.50 vs 758 vs 816). State scope boundaries — e.g. "No new env vars
or config flags", or "read behavior must not change".>

## Development Approach

<Substantive notes, not one line: TDD ordering (red→green), test strategy including
failure paths, fixture provenance ("captured live, do not hand-edit"), release-specific
test handling (e.g. "NPL 7.50 live writes blocked by SAP Note 2727890 → classify the 423
with expectSapFailureClass and move on"), and any explicit scope declarations.>

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

<Keep Validation Commands to the always-safe, fast gates above — ralphex runs them after
EVERY task. Do NOT put `npm run test:integration` / `npm run test:e2e` here: they need live
SAP creds and `requireSapCredentials()` THROWS without `TEST_SAP_URL`, which would fail every
task. Put integration/E2E runs in the specific task that adds them and in Final verification,
with the credential caveat (see Task N).>

### Task 1: <Descriptive, imperative title>

**Files:**
- Create: `src/adt/new-module.ts`
- Modify: `src/handlers/read.ts` (the `handleSAPRead` switch, near `case 'TABL'` at ~line NNNN)
- Modify: `tests/unit/adt/new-module.test.ts`

<1-2 sentences of context ending in WHY this task exists. Point to prior art to mirror, e.g.
"Mirror `getServerDrivenObject()` in `src/adt/server-driven.ts:~120` — same discovery-gate shape.">

- [ ] Add the `<Thing>` type to `src/adt/types.ts` near the other `*Result` types. Shape:
      interface ExampleResult { name: string; kind: string; optionalField?: string }
- [ ] Implement `<function>()` in `src/adt/new-module.ts`, calling `checkOperation(this.safety, OperationType.Read, '<Name>')` first (every ADT endpoint must be safety-guarded)
- [ ] Wire it into `handleSAPRead` in `src/handlers/read.ts`; keep the three-file schema sync (`tools.ts` + `schemas.ts` + handler) — see Rule 7
- [ ] Regression guard: existing `<type>` reads must behave identically — do not change that path
- [ ] Add unit tests (~N tests) in the `describe('<function>')` block: happy path against a captured real fixture, the 404/not-found branch, and one malformed/over-populated-input case
- [ ] Run `npm test` — all tests must pass

### Task 2: ...

### Task N: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] <If renaming identifiers> grep the repo for the old name — zero residual references
- [ ] <For SAP-touching features> Live verification on a live system (creds per `INFRASTRUCTURE.md`): e.g. `arc1-cli call <Tool> ...`, or `npm run test:integration` / `npm run test:e2e` (requires `TEST_SAP_URL`). For object-write features this MUST include a successful `SAPActivate` — activation is the definitive correctness check. Throwaway smoke scripts: do not commit them.
- [ ] <Feature-specific verification steps>
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed plans sit one directory deeper — `../` paths gain a level)
```

### Critical ralphex Format Rules

These rules are non-negotiable — violating them causes ralphex to malfunction:

1. **Task headers MUST use `### Task N:` format** — ralphex detects tasks by this pattern. `N` can be integer or non-integer (2.5, 2a).

2. **Checkboxes (`- [ ]`) belong ONLY inside Task sections.** Never put checkboxes in Overview, Context, Design Principles, Development Approach, or any section outside `### Task N:`. Checkboxes outside tasks cause extra loop iterations. **In particular, do NOT add a `## Success criteria` or `## Definition of Done` section with checkboxes** — this is the exact mistake that slipped into a past plan (`ralphex-feedback-plan.md`). Fold success criteria into the Overview as plain `-` bullets, or into the Final-verification task as checkboxes.

3. **Include `## Validation Commands`** — ralphex runs these after each task. List only the fast, always-runnable gates (`npm test`, `npm run typecheck`, `npm run lint`). Commands needing live SAP creds (`test:integration`, `test:e2e`) must NOT go here (they throw without `TEST_SAP_URL` and would fail every task) — put them in the owning task and Final verification.

4. **No checkboxes in Context or Overview** — even if listing requirements or design decisions, use plain bullets (`-`) not checkboxes (`- [ ]`).

5. **Each task must be self-contained** — ralphex executes each task in a fresh Claude Code session with no memory of previous tasks. Include enough context in each task for the agent to understand what to do without reading other tasks.

6. **Anchor references on stable symbols, not bare line numbers.** Line numbers drift between planning and execution. Lead with the function/const/type/`describe()` name (which the executor can grep for) and treat any line number as an approximate hint, prefixed `~` (e.g. "in `normalizeWriteObjectType()` at `object-types.ts:~330`"). The executor re-confirms by searching for the symbol.

7. **Respect the three-file schema sync (ARC-1-specific).** Any task that adds or changes a tool parameter/type must touch all of `src/handlers/tools.ts` (JSON Schema the LLM sees), `src/handlers/schemas.ts` (Zod validation), and the per-tool handler module (`src/handlers/read.ts`, `write.ts`, …) — plus the separate `batch_create` item sub-schema. Object-type lists are single-sourced in `src/handlers/tool-registry.ts` (`*_TYPE_TABLE` rows) — add the row there, never hand-copy lists into `tools.ts`/`schemas.ts`. A parameter missing from `tools.ts` is invisible to LLMs; missing from `schemas.ts` fails Zod. The task's **Files:** block must name all of them.

### Writing Effective Tasks

Each task runs in an isolated Claude Code session. The agent sees only the plan file and can read the codebase, but has NO context from previous task executions. Write tasks accordingly:

**DO:**
- Anchor on symbol names with line numbers as `~` hints (e.g., "modify `isOperationAllowed()` at `safety.ts:~95`") — per Rule 6
- Include the **Files:** block, using the right verb per entry: `Create:`, `Modify:`, `Delete:`, `Move:`, `Verify:` (not everything is a Modify — `Create:` and `Delete:` are common and easy to forget)
- Reference existing patterns by file and function name ("mirror `getDomain()`")
- **Embed the exact shape** when it removes ambiguity — a TypeScript interface, the XML/JSON payload, the grep pattern. A fresh-context agent guesses wrong about shapes; an inlined `interface {...}` or sample response is the highest-leverage thing you can give it. (Use a fenced code block or indentation for it — just make sure nested fences don't prematurely close the plan's own example block.)
- Include a "Run `npm test`" checkbox at the end of every code-changing task
- Include approximate test counts AND name the `describe()` block ("Add unit tests (~8 tests) in `describe('parseFoo')`: ...")
- Cover **failure and negative paths**, not only the happy path (see Test Requirements) — the bugs live there
- List the **adjacent paths** a change must also handle (create/update/delete/activate, read/write, the `withSafety()` clone) so the executor doesn't fix one and miss its siblings
- Describe the expected behavior, not just "implement X"
- Include context sentences explaining WHY this task exists

**DON'T:**
- Assume the agent knows what happened in previous tasks
- Use vague instructions ("update the tests accordingly")
- Reference a tool action, ADT endpoint, or payload shape you didn't verify in Phase 1g
- Skip test requirements — every task that changes code MUST include tests, and at least one of them must exercise a failure/negative path
- Create tasks that are too large (>10 checkboxes is a yellow flag, >15 is too many)
- Create tasks that are too small (a single checkbox task should be merged with an adjacent task)

### Task Ordering

Order tasks to minimize cross-task dependencies:
1. **Foundation first** — types, interfaces, core functions
2. **Wiring second** — connecting new code to existing infrastructure
3. **Config/CLI third** — new flags, env vars, profiles
4. **External config fourth** — `xs-security.json`, `mta.yaml` (primary BTP descriptor), `manifest.yml`, etc.
5. **Tests fifth** — ensure unit tests cover the new code (happy + failure paths); add integration tests if the feature touches SAP system interaction; add E2E tests if the feature adds new tool operations or changes MCP protocol behavior (see "Test Requirements" below)
6. **Documentation sixth** — runs *after* implementation so it reflects what actually shipped, not the intended feature. Write doc updates against the **as-shipped, release-gated** behavior: if a capability is partial, version-gated, or has known endpoint/parser edge cases, say so explicitly (over-promising docs create false-troubleshooting loops for the next agent/user). Update all affected artifacts:
   - `CLAUDE.md` (repo root) — codebase structure tree, Key Files table, config table, code patterns
   - Published docs in `docs_page/` — `tools.md`, `architecture.md`, `security-guide.md`, `authorization.md`, `caching.md`, `cli-guide.md`, etc.
   - End-user docs — `README.md`, `docs_page/index.md`
   - `docs_page/roadmap.md` — mark items completed, add new entries, update current state matrix
   - `docs/compare/00-feature-matrix.md` — add/update capability rows, refresh "Last Updated"
   - Skills in `.claude/commands/` — update existing skills that can leverage the feature, fix stale references
7. **Final verification last** — always the last task; for object-write features it MUST activate on a live system (activation is the definitive check)

### Test Requirements

Tests are critical to quality. Every task that modifies code MUST include test checkboxes. Read `CLAUDE.md` "Testing" section and `docs/testing-skip-policy.md` before writing any test task. These documents define the fixtures, helpers, skip policy, and try/catch conventions that tests must follow.

**Unit tests (`tests/unit/`, mirrors `src/` structure — 100+ files)**
- Mirror source structure under `tests/unit/` (e.g., `src/adt/client.ts` → `tests/unit/adt/client.test.ts`)
- Mock HTTP layer: `vi.mock('undici', ...)` with `mockResponse()` helper from `tests/helpers/mock-fetch.ts`
- XML fixtures: `tests/fixtures/xml/` for ADT response parsing
- ABAP fixtures: `tests/fixtures/abap/` for source parsing
- Config: `vitest.config.ts` (10s timeout, isolated modules)
- Run: `npm test`

**Integration tests (`tests/integration/`)**
- Add tests when the feature touches SAP system interaction
- Hard fail when `TEST_SAP_URL` is not set — `requireSapCredentials()` throws (no silent skips)
- Use `getTestClient()` factory from `tests/integration/helpers.ts`
- Sequential execution (SAP session conflicts)
- Config: `vitest.integration.config.ts` (30s timeout)
- Run: `npm run test:integration`
- CRUD tests use `generateUniqueName()` from `tests/integration/crud-harness.ts` for collision-safe names
- BTP-specific: `tests/integration/btp-abap.integration.test.ts` (local only, needs `TEST_BTP_SERVICE_KEY_FILE`)
- BTP smoke lane: `tests/integration/btp-abap.smoke.integration.test.ts` (`npm run test:integration:btp:smoke`)

**E2E tests (`tests/e2e/`)**
- Add tests when the feature adds new tool operations or changes MCP protocol behavior
- Exercise the full MCP JSON-RPC stack via `@modelcontextprotocol/sdk` client
- Use helpers: `connectClient()`, `callTool()`, `expectToolSuccess()`, `expectToolError()` from `tests/e2e/helpers.ts`
- **Fixture management:** Persistent objects defined in `tests/e2e/fixtures.ts`, auto-synced by `tests/e2e/setup.ts` via `npm run test:e2e:fixtures`. If adding a new E2E test that needs a persistent SAP object, add it to `PERSISTENT_OBJECTS` in `fixtures.ts`, create the ABAP source in `tests/fixtures/abap/`, and the sync script will handle creation.
- **Transient objects** created within a test must use `try/finally` for cleanup.
- Config: `tests/e2e/vitest.e2e.config.ts` (120s test timeout, 120s hook timeout)
- Run: `npm run test:e2e` (requires running MCP server at `E2E_MCP_URL`)
- Full cycle: `npm run test:e2e:full` (build + deploy + test + stop)

**The test system described in `INFRASTRUCTURE.md` can be used for smoke testing and creating test fixtures.**

**Failure-path & input-pollution testing (required):**
Happy-path-only tests are where ARC-1 bugs have historically slipped through (e.g. one PR shipped five bugs that a single deliberately-broken-object test would have caught). Every code-changing task must include at least one test that is NOT a happy path:
- The error surface for bad input, and the not-found / permission / lock branch
- For any tool input-schema change, a **polluted-payload** test: empty-string optionals, irrelevant optional fields set, and wrong-type/cross-type fields (e.g. `include="definitions"` on a non-CLAS write). LLM clients — GPT especially — over-populate optional fields; `z.coerce.boolean` silently turns `"false"` into `true`. Model that input.
- Prefer **one deliberate-failure E2E/integration test that guards many code paths** over many happy-path unit tests (an activation-failure E2E is worth more than ten green-path unit assertions).

**Test quality rules (non-negotiable):**
- Never use `if (!x) return;` to skip — use `requireOrSkip(ctx, x, 'reason')` from `tests/helpers/skip-policy.ts`
- Never use empty `catch {}` — use `expectSapFailureClass(err, [404], [/pattern/])` from `tests/helpers/expected-error.ts`
- Tag cleanup-only catches with `// best-effort-cleanup` comment
- Every try/catch must assert something in both paths (success shape OR expected error class)
- Transient SAP objects must be cleaned up in `finally` blocks
- See `docs/testing-skip-policy.md` for the full skip taxonomy and valid/invalid patterns

**Deciding which test tiers to include:**
- Code-only changes (parsers, safety checks, config logic) → unit tests only
- New ADT endpoints or changed SAP interaction → unit tests + integration tests
- New/changed MCP tool operations → unit tests + E2E tests
- Auth or transport changes → unit tests + integration tests + E2E tests
- Release-sensitive areas (DDIC object routing, locks, activation, lint, release detection) → verify on the oldest (7.50) and a newer (758/816) live system, or justify in Design Principles why the change is release-invariant

---

## Phase 3: Review & Refine

A good plan review catches plan-killing bugs *before* a single autonomous task runs — in practice it catches them roughly half the time, and it's the highest-leverage gate in this whole process. Do not treat it as a quick re-read. **For best results, run the adversarial pass below as a separate, context-free reviewer** (a subagent or fresh session that has NOT seen your research) — fresh eyes catch the false-confidence defects that authoring blindness hides.

1. **Adversarial defect pass — for EACH task, check every item:**
   - **Claims about current code are literally true.** Re-open every file:line/symbol the task cites and confirm the stated current behavior is real — not assumed, not remembered. (Recurring defect: "existing X already does Y" where the cited code does not.)
   - **SAP facts have Phase-1g evidence.** Every ADT endpoint, `objectType`/type code, header, and response shape the task depends on was verified live and is cited. No unverified surfaces.
   - **No intra-task contradictions.** No two checkboxes in the same task conflict.
   - **Ambiguous cases are specified.** For every lookup / match / name-resolution step, the plan states the behavior for the not-found, duplicate, and resolves-in-two-places cases.
   - **Adjacent paths covered.** For each new field/param/cache: are create/update/delete/activate, read/write, and the `withSafety()` `Object.create` clone (`src/adt/client.ts` — every instance field must be re-attached on the clone, see issue #333) all handled and tested? CRUD features: is the **create** path (no existing object to resolve) covered, not just update?
   - **Three-file schema sync** (Rule 7) is reflected in the Files: block of any parameter-adding task.
   - **RAP / draft-state** (if touched): reads after a write specify `version: 'inactive'`; handler subclasses go in CCIMP, never CCDEF; a test covers the inactive-has-method / active-is-empty case.
   - **No unverified "tests/typecheck will pass" claims.**

2. **Check for missing dependencies** — does Task 3 assume something from Task 2 that isn't explicitly stated? Each task is read in isolation.

3. **Verify the format** — run a mental checklist:
   - `### Task N:` headers? Yes
   - Checkboxes only in Task sections (no `## Success criteria` / `## Definition of Done` checkbox block)? Yes
   - `## Validation Commands` present, fast-gates-only? Yes
   - Every code-changing task has test checkboxes incl. a failure-path test? Yes
   - Final verification task exists (with move-to-completed + relative-link fix)? Yes

4. **Verify artifact coverage** — every plan must account for all affected artifacts:
   - [ ] **Tests**: Are the right test tiers included? (unit for all code changes, integration for SAP interaction, E2E for tool/protocol changes; failure paths everywhere; per-release where relevant)
   - [ ] **Published docs**: Does a task update relevant `docs_page/*.md` files? (`tools.md`, `authorization.md`, `security-guide.md`, `caching.md`, `architecture.md`, `cli-guide.md`, etc.) — and do the updates match as-shipped behavior?
   - [ ] **End-user docs**: Does a task update `README.md` and/or `docs_page/index.md` if the feature is user-visible?
   - [ ] **CLAUDE.md**: Does a task update the codebase structure tree, Key Files table, config table, or code patterns?
   - [ ] **Roadmap**: Does a task update `docs_page/roadmap.md` (mark completed, add entry, update current state)?
   - [ ] **Feature matrix**: Does a task update `docs/compare/00-feature-matrix.md` if the feature adds a new capability?
   - [ ] **Skills**: Does a task update `.claude/commands/*.md` skills that reference changed behavior or could leverage the new feature?
   - [ ] **Outdated docs**: Are doc claims that no longer match code included as required fixes (and unrelated staleness as bonus items)?

5. **Check total scope** — aim for 5-12 tasks. Fewer than 5 means tasks are too large. More than 12, OR a feature spanning multiple independent ADT capabilities / multiple CRUD lifecycles that can ship and verify independently (the RAP cluster needed write-side, then activation-side, then quality passes), means it should be **split into separate sequenced plans now**, each with explicit dependency notes ("Plan B assumes Plan A's CCIMP scaffolding"). A plan whose tasks can't all be confirmed by a single Final-verification run is too big.

---

## Output

Save the plan to `docs/plans/<name>.md` (kebab-case — ralphex derives the git branch name from the filename, so make it descriptive) and tell the user:
- The plan file path
- How to execute it: `ralphex docs/plans/<name>.md` (or `ralphex --worktree docs/plans/<name>.md` to run isolated in a git worktree)
- A brief summary of the task breakdown
- Any SAP facts you could NOT verify live during Phase 1g (so the user can confirm before an autonomous run depends on them)

**See also:** `docs/ralphex.md` for the full ralphex reference and plan-file spec; `.claude/commands/implement-feature.md` if the user wants to implement interactively (with plan-mode approval) instead of generating a plan for autonomous execution.
