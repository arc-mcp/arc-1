# Plan: FEAT-22 gCTS / abapGit Integration

## Overview

Add a new intent-based MCP tool `SAPGit` that exposes Git-based ABAP version-control workflows against two backends: **gCTS** (SAP's native Git-enabled Change and Transport System) and **abapGit** (community add-on, accessed via the ADT abapGit bridge). Both backends are auto-detected at startup; operations are routed to whichever is available, with gCTS preferred when both are present.

Why two backends: they coexist in the wild. gCTS is SAP-delivered (BASIS 7.53+, on most S/4HANA and BTP ABAP systems) and uses a flat JSON REST API at `/sap/bc/cts_abapvcs/*`. abapGit is community-driven, installed as a Z add-on, and SAP exposes it to ADT clients via an XML/HATEOAS endpoint namespace at `/sap/bc/adt/abapgit/*`. Users of ARC-1 will have one or the other (rarely both). A single `SAPGit` tool hides the wire protocol split and presents a uniform action set to the LLM.

Live probes against the A4H trial (`http://65.109.59.210:50000`) confirmed **both backends are operational**:
- **gCTS v2.7.1** at `/sap/bc/cts_abapvcs/` — `/system` returns GREEN for `tp`, `dataset`, `cts`, `java`, `gcts_path`. `/user` reports `DEVELOPER` has admin scope on `config`, `teams`, `registry`, `repository`, `tms`. No repositories are cloned yet (`/repository` returns `{}`).
- **abapGit ADT bridge** (user installed it during plan authoring) at `/sap/bc/adt/abapgit/` — `/repos` returns **4 pre-existing linked repositories** ready for integration testing: `$TUTORIALS`, `$TUTORIALS_TABLE`, `$TUTORIALS-TABLE` (tutorials, key `000000000001`/`2`/`3`), and `/DMO/FLIGHT` (`github.com/SAP/abap-platform-refscen-flight.git`, key `000000000006`, already deserialized).

Both backends get real integration coverage — no mocking the trial away.

**Non-trivial findings from live probing** (plan accounts for each):
1. abapGit list endpoint (`GET /sap/bc/adt/abapgit/repos`) only accepts `Accept: application/abapgit.adt.repos.v2+xml`. Requesting v3 returns 406 Not Acceptable. There is **no v3 list**.
2. There is **no per-repo GET** endpoint: `GET /sap/bc/adt/abapgit/repos/{repoId}` returns 405 `ExceptionMethodNotSupported`. All repo metadata comes from the list response, which embeds HATEOAS `<atom:link>` elements for `pull`, `stage`, `push`, `checks` (note: path segment is `/checks` plural, even though abap-adt-api's source tags it with `type="check_link"`).
3. There is **no per-repo `branches` GET** for local repos: `GET /sap/bc/adt/abapgit/repos/{repoId}/branches` returns 404. The only way to get branches is `POST /sap/bc/adt/abapgit/externalrepoinfo` — which accepts a remote URL, not a local repoId, and returns branches for that remote. This changes the tool's `branches` action to require a URL (and optional user/password), not a repoId, for abapGit.
4. The `externalrepoinfo` request namespace is `http://www.sap.com/adt/abapgit/externalRepo` (capital R), not the `externalrepoinfo` prefix used in the URL path. Getting this wrong returns a 400 `ExceptionInvalidData` — fixtures and request builders must use the correct namespace.
5. abapGit bridge errors carry a **different namespace** than ADT framework errors: `<namespace id="org.abapgit.adt"/>` for bridge-level errors (e.g. `Repository not found in database. Key: REPO, <id>`) vs `<namespace id="com.sap.adt"/>` for framework errors (method not supported, content type not acceptable). The error classifier needs both paths.
6. `POST /sap/bc/adt/abapgit/repos/{repoId}/checks` returns 200 with `content-length: 0` — it's a "health ping" that reports repo reachability, not a payload-bearing action. The tool wrapper should translate this to `{ ok: true }` rather than returning an empty string.
7. gCTS `/repository` returns `{}` (object) when no repos exist — **not** `[]` (array). When repos exist it switches shape to `{result: [...]}`. The parser must tolerate both.
8. gCTS `/user` returns structured scope info (`config|teams|registry|repository|tms` × `admin|viewer`). This is a cheap, auth-sanity-checking read action worth exposing as `SAPGit(action="whoami", backend="gcts")`.
9. Stage operations that require reaching the remote Git registry **hang indefinitely** on the trial (no outbound cert trust to `github.tools.sap` for the `$TUTORIALS` repos; `/DMO/FLIGHT` needs GitHub CA in STRUST). Integration tests must not exercise remote-touching operations without controlled preconditions — cover these via unit tests with mocked HTTP.

All write operations (clone, pull, push, commit, switch-branch, create-branch, unlink) are gated behind a new opt-in safety flag `enableGit` — mirroring the existing `enableTransports` pattern. Read operations (list repos, whoami, external_info, history, config) are always available when the backend is reachable. The new flag is OFF by default: safe-by-default, opt-in power.

## Context

### Current State

- ARC-1 has **no** gCTS or abapGit support. The feature matrix row 22 (FEAT-22) is "Not started".
- `src/adt/features.ts:37` already probes abapGit at `/sap/bc/adt/abapgit/repos` via HEAD and exposes `features.abapGit` through `SAPManage(action="features")`. No probe exists for gCTS.
- `src/adt/transport.ts` handles classic CTS transport requests (SE09/SE10 equivalent). gCTS is orthogonal to CTS — it wraps CTS with a Git overlay.
- The HTTP client at `src/adt/http.ts:125-152` supports `get/post/put/delete` with arbitrary headers. gCTS uses `Accept: application/json` and JSON request bodies; abapGit uses vendor XML content types like `application/abapgit.adt.repos.v2+xml` and `application/abapgit.adt.repo.v3+xml` with HATEOAS links.
- VSP v2.33.0 added 10 gCTS tools (commit 81cce41, Apr 5, 2026). marcellourbani/abap-adt-api exposes only abapGit (9 functions: `gitRepos`, `externalRepoInfo`, `createRepo`, `pullRepo`, `unlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `switchRepoBranch`), not gCTS.
- `docs/compare/00-feature-matrix.md` row #15 lists gCTS/abapGit as a Medium gap. Three competitors (VSP, dassian-adt, abap-adt-api) have some form of coverage.

### Target State

1. A new `SAPGit` MCP tool with backend auto-selection (prefers gCTS, falls back to abapGit) and a uniform action set. Actions are distinguished by **which backends support them** — the handler validates and routes before calling a client:

   | Action | gCTS | abapGit | Notes |
   |--------|------|---------|-------|
   | `list_repos` | ✓ | ✓ | Unified shape with a `backend` discriminator field in the response. |
   | `whoami` | ✓ | — | gCTS-only (`GET /user`). Returns user + scope levels. |
   | `config` | ✓ | — | gCTS-only (`GET /config` or `/repository/{rid}/config`). |
   | `branches` | ✓ (repoId) | — | gCTS-only: `GET /repository/{rid}/branches`. For abapGit, use `external_info`. |
   | `external_info` | — | ✓ (url) | abapGit-only: `POST /externalrepoinfo` with remote URL; returns branches for a **remote** URL. |
   | `history` | ✓ | — | gCTS-only: `GET /repository/{rid}/getCommit`. |
   | `objects` | ✓ | — | gCTS-only: `GET /repository/{rid}/objects`. |
   | `check` | — | ✓ | abapGit-only: `POST /repos/{repoId}/checks` — repo reachability ping. |
   | `stage` | — | ✓ | abapGit-only HATEOAS call; may hang without remote reachability. |
   | `clone` | ✓ | ✓ | write. gCTS: `POST /repository`; abapGit: `POST /repos`. |
   | `pull` | ✓ | ✓ | write. gCTS: `POST /repository/{rid}/pullByCommit`; abapGit: `POST /repos/{rid}/pull`. |
   | `push` | — | ✓ | write. abapGit HATEOAS `push_link`. |
   | `commit` | ✓ | — | write. gCTS: `POST /repository/{rid}/commit`. |
   | `switch_branch` | ✓ | ✓ | write. gCTS: `POST /repository/{rid}/checkout/{branch}`; abapGit: `POST /repos/{rid}/branches/{branch}?create=false`. |
   | `create_branch` | ✓ | ✓ | write. gCTS: `POST /repository/{rid}/branches`; abapGit: `POST /repos/{rid}/branches/{branch}?create=true`. |
   | `unlink` | ✓ | ✓ | write. gCTS: `DELETE /repository/{rid}`; abapGit: `DELETE /repos/{rid}`. |

   **Removed from the first draft:** `get_repo` action (no per-repo GET endpoint — list embeds the data). `branches` as a unified abapGit-local action (local branches endpoint doesn't exist on the bridge).
2. Two new client modules: `src/adt/gcts.ts` (JSON, `/sap/bc/cts_abapvcs/*`) and `src/adt/abapgit.ts` (XML/HATEOAS, `/sap/bc/adt/abapgit/*`).
3. Feature probing extended: a new `gcts` feature probe against `/sap/bc/cts_abapvcs/system` added to `PROBES` in `src/adt/features.ts`. `ResolvedFeatures.gcts` exposed to LLM via `SAPManage(action="features")`.
4. Safety system extended with `enableGit` flag (default `false`). All write operations call `checkGit(safety, operation)` that throws `AdtSafetyError` when disabled, mirroring `checkTransport`.
5. Write operations (clone, create_branch, push, commit, unlink) also call `checkPackage(safety, pkg)` so the package allowlist gates which packages can be bound to Git.
6. Scope enforcement: `SAPGit` added to `TOOL_SCOPES` — `read` scope covers the read actions, `write` scope required for write actions. Scope checked at dispatch time, like every other tool.
7. New CLI/env flag `--enable-git` / `SAP_ENABLE_GIT` plumbed through `src/server/config.ts` and `src/server/types.ts`.
8. Secrets handling: gCTS requires `CLIENT_VCS_AUTH_USER` + `CLIENT_VCS_AUTH_PWD` or `CLIENT_VCS_AUTH_TOKEN` for private repos (passed per-request in JSON bodies). abapGit uses per-request `Username` + `Password` (base64) headers. Credentials are redacted in logs via the existing `sanitizeArgs()` path (add `password`, `token`, `remotePassword`, `authPwd`, `authToken` to the redaction list if not already covered).
9. Unit tests cover both backends with mocked HTTP. Integration tests cover gCTS against the live trial system (read actions only; no remote Git registry is configured on trial, so write actions are skipped with `SkipReason.NO_FIXTURE`). E2E tests exercise the read path end-to-end through the MCP protocol.
10. Docs updated: `docs/tools.md` (new tool reference), `docs/roadmap.md` (FEAT-22 → Done, competitive status update), `docs/compare/00-feature-matrix.md` (row 22 → ✅ for gCTS/abapGit), `CLAUDE.md` (Key Files table + codebase tree + config table + code patterns), `README.md` (feature bullet), `docs_page/roadmap.md` (same as `docs/roadmap.md`).

### Key Files

| File | Role |
|------|------|
| `src/adt/gcts.ts` | **NEW** — gCTS client: list/get/create/delete repos, branches, commits, pull, push, switch, config, system. JSON over `/sap/bc/cts_abapvcs/*`. |
| `src/adt/abapgit.ts` | **NEW** — abapGit ADT-bridge client: repos, external_info, create, pull, unlink, stage, push, check, switch_branch. XML with HATEOAS over `/sap/bc/adt/abapgit/*`. |
| `src/adt/features.ts:35-48` | Add `{ id: 'gcts', endpoint: '/sap/bc/cts_abapvcs/system', description: 'gCTS (git-enabled CTS)' }` to `PROBES`; update `FeatureConfig` and `defaultFeatureConfig`. |
| `src/adt/config.ts:17-40` | `FeatureConfig` / `defaultFeatureConfig` — add `gcts: FeatureMode`. |
| `src/adt/types.ts` | Add `ResolvedFeatures.gcts: FeatureStatus`; add types for gCTS (`GctsRepo`, `GctsBranch`, `GctsCommit`, `GctsSystemInfo`, `GctsConfig`, `GctsCloneResult`) and abapGit (`AbapGitRepo`, `AbapGitLink`, `AbapGitBranch`, `AbapGitExternalInfo`, `AbapGitStaging`, `AbapGitObject`). |
| `src/adt/safety.ts` | Add `enableGit: boolean` to `SafetyConfig`; add `checkGit(safety, operation)` that mirrors `checkTransport`; update `defaultSafetyConfig` / `unrestrictedSafetyConfig`. |
| `src/adt/errors.ts` | Add `classifyGctsError()` helper for gCTS error body shape (`{"exception": "..."}` from 500 / 404 responses). |
| `src/handlers/intent.ts` | New `handleSAPGit(client, args, ...)` function that dispatches to `gcts.ts` or `abapgit.ts` based on resolved features. Add `SAPGit: 'read'` entry to `TOOL_SCOPES` with a per-action override map (write actions require `write` scope). Wire into the tool dispatch switch. |
| `src/handlers/schemas.ts` | `SAPGitSchema` (Zod) with `action` enum, optional `repoId`, `url`, `branch`, `package`, `transport`, `commit`, `message`, `objects[]`, `user`, `password`, `token`. Add `case 'SAPGit': return SAPGitSchema;` to `getToolSchema`. |
| `src/handlers/tools.ts` | New `SAPGit` tool definition with on-prem / BTP description strings. Tool is registered only when `features.gcts.available || features.abapGit.available`. |
| `src/server/config.ts` | Parse `--enable-git` / `SAP_ENABLE_GIT`; surface to `SafetyConfig.enableGit`. |
| `src/server/types.ts` | Add `enableGit?: boolean` to `ServerConfig`. |
| `src/server/server.ts` | Plumb `enableGit` into `AdtClient` construction (via `buildAdtConfig` path) and tool-registration filter. |
| `src/server/audit.ts` | Ensure `password`, `token`, `authPwd`, `remotePassword` are redacted in `sanitizeArgs()`. |
| `tests/unit/adt/gcts.test.ts` | **NEW** — mock-fetch tests for every gCTS client method (success + error shapes + safety gating). |
| `tests/unit/adt/abapgit.test.ts` | **NEW** — mock-fetch tests for every abapGit client method (XML fixtures, HATEOAS link following, safety gating). |
| `tests/unit/adt/features.test.ts` | Extend to cover the new `gcts` probe. |
| `tests/unit/adt/safety.test.ts` | Add `checkGit` + `enableGit` tests. |
| `tests/unit/handlers/intent.test.ts` | Add `handleSAPGit` tests: backend selection, per-action scope, read-only default, error classification. |
| `tests/unit/handlers/schemas.test.ts` | Add `SAPGitSchema` tests (valid + invalid shapes). |
| `tests/unit/server/config.test.ts` | Extend to cover `--enable-git` / `SAP_ENABLE_GIT` parsing. |
| `tests/integration/gcts.integration.test.ts` | **NEW** — live gCTS read-path tests against trial (`getSystemInfo`, `getUserInfo`, `getConfig`, empty `listRepos`, error shape of `getTransportHistory`). Skips write tests with `NO_FIXTURE`. |
| `tests/integration/abapgit.integration.test.ts` | **NEW** — live abapGit ADT-bridge tests against trial: `listRepos` (4 pre-linked repos), `externalRepoInfo` against `abapGit-tests/CLAS.git`, error-namespace classification, 406 on v3 list. `stage`/`pull` skipped pending STRUST setup. |
| `tests/e2e/sap-git.e2e.test.ts` | **NEW** — full MCP protocol test: list tools includes `SAPGit`, `SAPGit(action="list_repos")` round-trips, `SAPGit(action="clone")` without `--enable-git` returns safety error. |
| `tests/fixtures/xml/abapgit-repos-v2.xml` | **NEW** — abapGit list-repos response fixture (based on abap-adt-api shape). |
| `tests/fixtures/xml/abapgit-external-info.xml` | **NEW** — abapGit external-repo-info response fixture. |
| `tests/fixtures/xml/abapgit-staging.xml` | **NEW** — abapGit staging response fixture. |
| `tests/fixtures/json/gcts-system.json` | **NEW** — gCTS `/system` response fixture (captured from A4H trial). |
| `tests/fixtures/json/gcts-repository.json` | **NEW** — gCTS `/repository` response fixture (single-repo example). |
| `tests/fixtures/json/gcts-branches.json` | **NEW** — gCTS branches response fixture. |
| `tests/fixtures/json/gcts-commit-history.json` | **NEW** — gCTS commit history fixture. |
| `docs/tools.md` | Add `SAPGit` tool reference section. |
| `docs/roadmap.md` | Mark FEAT-22 as Done, update "Current State" matrix row. |
| `docs_page/roadmap.md` | Same as `docs/roadmap.md` (user-facing mirror). |
| `docs/compare/00-feature-matrix.md` | Row 22 → ✅, refresh "Last Updated". |
| `CLAUDE.md` | Add `src/adt/gcts.ts` + `src/adt/abapgit.ts` to codebase tree; add "Add gCTS/abapGit operation" row to Key Files table; document `SAP_ENABLE_GIT` / `--enable-git` in config table. |
| `README.md` | Add feature bullet mentioning Git-based ABAP workflows (gCTS + abapGit). |
| `.claude/commands/implement-feature.md` | Note the new `SAPGit` tool if relevant. |

### Design Principles

1. **Backend auto-selection is explicit at the handler.** `handleSAPGit` reads `client.features` once and picks gCTS if `features.gcts.available`, otherwise abapGit if `features.abapGit.available`, otherwise returns an LLM-friendly error ("Neither gCTS nor abapGit is available on this SAP system"). The LLM can override with an optional `backend: 'gcts' | 'abapgit'` argument when it needs to disambiguate.
2. **Distinct client modules per backend.** `src/adt/gcts.ts` and `src/adt/abapgit.ts` are siblings — they do not share an interface class. The unifying layer is the `SAPGit` tool's action-to-backend dispatch, not an abstraction. This keeps each module aligned with its actual API shape (JSON vs. HATEOAS XML) without inventing a lowest-common-denominator model that hides useful detail. Matches the repo's existing pattern (no `SapApi` superclass; `client.ts`, `crud.ts`, `devtools.ts`, `transport.ts`, `flp.ts` are peers).
3. **Safety-first.** Write operations require `readOnly=false` (checked via `checkOperation(safety, OperationType.Write)`) **and** `enableGit=true` (checked via new `checkGit(safety, operation)`) **and** `checkPackage(safety, pkg)` for any package-bound operation. All three are enforced before the HTTP call. Read operations only need `checkOperation(safety, OperationType.Read)`.
4. **Scopes map to tool actions, not tools.** `TOOL_SCOPES` currently maps whole tools to one scope. `SAPGit` is the first tool where actions split across `read` and `write` scopes. Extend the check in `handleSAPGit` with a per-action lookup (same pattern as `SAPTransport` implicitly does via `checkTransport`). Document the split in the tool description.
5. **Credentials never persist.** Per-request `user`/`password`/`token` params forward directly to the SAP system. They are not cached, logged (redacted by `sanitizeArgs`), or stored in config. For gCTS, configured system-wide credentials (set via SAP UI) are used when the tool call omits them.
6. **Feature-gated tool registration.** `SAPGit` only appears in `tools/list` when `features.gcts.available || features.abapGit.available`. This matches the existing pattern (e.g., `SAPTransport` registered only when `features.transport.available`). Admins who disable both backends (`--features.gcts=off --features.abapgit=off`) don't see the tool at all — no schema tokens wasted.
7. **Integration-test both backends against the live trial.** Both gCTS and the abapGit ADT bridge are installed on A4H trial, so both get real integration coverage. Unit tests with XML/JSON fixtures catch wire-protocol regressions; integration tests catch API-contract regressions against a real SAP kernel.
8. **No remote-touching coverage without STRUST.** The trial has no outbound cert trust for github.tools.sap or github.com. Any operation that reaches the remote Git host (`stage`, `pull` on a repo whose remote needs CA validation, `clone` of a public GitHub repo) hangs indefinitely or 500s. These cases are covered by unit tests only; integration tests mark them `test.skip` with a comment pointing at the STRUST precondition in `INFRASTRUCTURE.md`.
9. **Error classification matters.** gCTS returns `{"exception": "<text>"}` JSON bodies on 404/500 (confirmed: `/repository/history/ZARC1` → 500 with `"exception":"No relation between system and repository"`). A new `classifyGctsError(body)` parses this and maps to LLM-friendly messages, analogous to how `classifySapDomainError()` handles T100 messages.
10. **Commit scope in one plan.** Roadmap calls this effort "M" (3-5 days). Plan is 9 tasks; each task is self-contained and independently validatable (`npm test` + `npm run typecheck` + `npm run lint` passing).

## Development Approach

- **TDD per task.** Each task that adds code also adds the corresponding unit tests in the same task. Run `npm test` at the end of every task.
- **Ordering matters.** Foundation (types, safety, features) before clients, clients before handler, handler before tool schema/registration, then config/CLI, then integration and E2E, then docs.
- **Match existing patterns.** Client methods follow the `checkOperation` → HTTP call → parse → return shape used everywhere in `src/adt/`. Handler dispatch mirrors `handleSAPTransport`. Tool registration follows the `features.*.available` gate used for `SAPTransport`.
- **Fixtures from live captures.** gCTS JSON fixtures are copied from the actual A4H responses captured during research. abapGit XML fixtures are constructed to match the documented response shapes in `marcellourbani/abap-adt-api/src/api/abapgit.ts`.
- **Integration/E2E skip gracefully.** Use `requireOrSkip(ctx, features.gcts.available, SkipReason.BACKEND_UNSUPPORTED)` — not `if (!x) return;`. Follow `docs/testing-skip-policy.md`.

## Validation Commands

- `npm test` — unit tests (primary gate for each task)
- `npm run typecheck` — strict TypeScript check
- `npm run lint` — Biome check
- `npm run test:integration` — live gCTS read path (needs `TEST_SAP_URL` pointed at trial)
- `npm run test:e2e` — MCP protocol round-trip (needs running MCP server)

---

### Task 1: Add gCTS feature probe, types, and safety flag foundation

**Files:**
- Modify: `src/adt/features.ts`
- Modify: `src/adt/config.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/adt/features.test.ts`
- Modify: `tests/unit/adt/safety.test.ts`

Foundation task. Adds the `gcts` feature probe (`/sap/bc/cts_abapvcs/system`), extends `FeatureConfig` / `ResolvedFeatures` with `gcts`, adds `enableGit: boolean` to `SafetyConfig`, and introduces `checkGit(safety, operation)` that mirrors `checkTransport`. No client code yet — this purely expands the type system and safety primitives so later tasks have a stable base.

- [ ] Add `{ id: 'gcts', endpoint: '/sap/bc/cts_abapvcs/system', description: 'gCTS (git-enabled CTS)' }` to `PROBES` in `src/adt/features.ts:35-48`.
- [ ] Add `gcts: FeatureMode` to `FeatureConfig` in `src/adt/config.ts:17-26`; default to `'auto'` in `defaultFeatureConfig()`.
- [ ] Add `gcts: config.gcts` to the `modeMap` inside `probeFeatures()` in `src/adt/features.ts:82-88`.
- [ ] Add `gcts: FeatureStatus` to `ResolvedFeatures` in `src/adt/types.ts` (next to `abapGit`). Add the human-readable label mapping (`gcts: 'gCTS (git-enabled CTS)'`) at `src/adt/features.ts:350`.
- [ ] Add `enableGit: boolean` field to `SafetyConfig` in `src/adt/safety.ts:44-55`. Default `false` in `defaultSafetyConfig()`; `true` in `unrestrictedSafetyConfig()`.
- [ ] Add `checkGit(safety: SafetyConfig, operation: string): void` in `src/adt/safety.ts` that throws `AdtSafetyError` when `safety.enableGit === false`, with message pattern `Git operation "${operation}" is disabled. Set SAP_ENABLE_GIT=true or pass --enable-git to enable.`. Model the function on `checkTransport` (same file).
- [ ] Add `GctsRepo`, `GctsBranch`, `GctsCommit`, `GctsSystemInfo`, `GctsConfig`, `GctsObject`, `GctsCloneResult` interfaces to `src/adt/types.ts`. Base them on the JSON shapes observed from the A4H trial (see fixture files created in later tasks).
- [ ] Add `AbapGitRepo`, `AbapGitLink`, `AbapGitBranch`, `AbapGitExternalInfo`, `AbapGitStaging`, `AbapGitStagingObject`, `AbapGitObject`, `AbapGitUser` interfaces to `src/adt/types.ts`. Base them on `marcellourbani/abap-adt-api/src/api/abapgit.ts`.
- [ ] Add unit tests (~6 tests): features probe picks up `gcts` in auto mode; respects `on`/`off`; `checkGit` throws when disabled, passes when enabled; `defaultSafetyConfig().enableGit === false`; `unrestrictedSafetyConfig().enableGit === true`; the `gcts` key appears on `ResolvedFeatures`.
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 2: gCTS client module

**Files:**
- Create: `src/adt/gcts.ts`
- Create: `src/adt/errors.ts` (extend with `classifyGctsError`)
- Create: `tests/unit/adt/gcts.test.ts`
- Create: `tests/fixtures/json/gcts-system.json`
- Create: `tests/fixtures/json/gcts-repository.json`
- Create: `tests/fixtures/json/gcts-branches.json`
- Create: `tests/fixtures/json/gcts-commit-history.json`
- Create: `tests/fixtures/json/gcts-config.json`

Adds the JSON gCTS client. All functions take `AdtHttpClient` and `SafetyConfig`, and call `checkOperation` (read) or `checkOperation + checkGit + checkPackage` (write) before the HTTP call. Every function parses the JSON response with `JSON.parse` (no XML here) and returns typed results.

Confirmed endpoints (from live probe of `http://65.109.59.210:50000/sap/bc/cts_abapvcs/`):
- `GET /system` — system info (returns `{"result":{sid, name, sapsid, workstate, config, status, client, servername, version, availableVsid}}`). Already captured as live fixture.
- `GET /user` — user scope info (returns `{"user":{"user": "DEVELOPER", "scope":{"system":[{"scope":"config","level":"admin"},...]}}}`). Powers the `whoami` action.
- `GET /config` — config schema (list of `{ckey, ctype, datatype, defaultValue, description, category, ...}`). Already captured as live fixture.
- `GET /registry` — VCS registry entries (returns `{}` on trial; unused in tool surface but probed for feature-detection completeness).
- `GET /repository` — list repos. **Important**: returns `{}` (empty object) when no repos, `{"result":[...]}` when repos exist. Parser MUST accept both shapes. On A4H trial currently `{}`.
- `POST /repository` — clone repo (JSON body: `{rid, name, role, type, vSID, url, privateFlag?, config:[{key,value}]}`). Requires CSRF token.
- `POST /repository/{rid}/pullByCommit` — pull by commit (JSON body: `{commit: "<sha>"}` or `{}` for HEAD).
- `POST /repository/{rid}/commit` — commit local changes (JSON body: `{message, description, objects:[...]}`).
- `GET /repository/{rid}/branches` — list branches.
- `POST /repository/{rid}/branches` — create branch (JSON: `{branch, isSymbolic, isPeeled, type}`).
- `POST /repository/{rid}/checkout/{branch}` — switch branch.
- `GET /repository/{rid}/getCommit?limit=N` — commit history.
- `GET /repository/{rid}/objects` — list repo objects.
- `GET /repository/history/{rid}` — transport history. **Returns 500 with `{"exception":"No relation between system and repository"}`** when repo is not yet linked to the CTS database. This is a documented corner case; error classifier must surface the exception text.
- `DELETE /repository/{rid}` — unlink repo. Requires CSRF token.

Set `Accept: application/json` for GETs and both `Accept: application/json` and `Content-Type: application/json` for POSTs. Base URL path is `/sap/bc/cts_abapvcs` — no `/adt/` prefix. CSRF token flow is identical to the ADT endpoints (HEAD `/sap/bc/adt/core/discovery` with `X-CSRF-Token: fetch`); the existing `AdtHttpClient` CSRF logic already handles this transparently for `POST/PUT/DELETE`.

- [ ] Create `src/adt/gcts.ts` with exported functions: `getSystemInfo`, `getUserInfo`, `getConfig`, `listRepos`, `cloneRepo`, `pullRepo`, `commitRepo`, `listBranches`, `createBranch`, `switchBranch`, `getCommitHistory`, `listRepoObjects`, `getTransportHistory`, `deleteRepo`. Each function signature: `(http: AdtHttpClient, safety: SafetyConfig, ...args) => Promise<...>`. **No `getRepo`** — gCTS doesn't have a stable per-repo GET beyond `/repository/{rid}` which is functionally equivalent to filtering `listRepos` output; keep the surface minimal.
- [ ] Read operations call `checkOperation(safety, OperationType.Read, 'Gcts<Action>')`. Write operations call `checkOperation(safety, OperationType.Update|Create|Delete, ...)` AND `checkGit(safety, '<action>')` AND (for create/clone/branch) `checkPackage(safety, pkg)` if a package is supplied.
- [ ] `listRepos` must handle both response shapes: `{}` → return `[]`; `{"result": [...]}` → return the array. Add an explicit comment citing the live-probe discrepancy.
- [ ] Add `classifyGctsError(body: string): { exception?: string }` to `src/adt/errors.ts`. Parse JSON body; return the `exception` field if present. Tolerate malformed JSON by returning `{}`. Also handle nested `{"log":[{"severity":"ERROR","message":"..."}]}` shape that gCTS returns on some commit/pull errors.
- [ ] In `gcts.ts`, on any response with `resp.status >= 400`, call `classifyGctsError(resp.body)` and throw `new AdtApiError(resp.status, url, exception ?? logMessage ?? resp.body)`.
- [ ] Capture fixture JSON files from the **live A4H trial** responses (the `/system`, `/config`, `/user`, and `/repository` empty-state bodies are captured in research output — use them verbatim as `gcts-system.json`, `gcts-config.json`, `gcts-user.json`, `gcts-repository-empty.json`). For shapes not live-capturable (repo-with-content, branches, commit-history, commit-response, pull-response, transport-history-500), base on SAP gCTS REST API doc (`help.sap.com/doc/en-US/saphelp_nw75/.../gCTS_REST_API.pdf`) and the VSP implementation at `https://github.com/abap-tools/mcp-abap-adt/tree/main/internal/adtclient/gcts`.
- [ ] Create `tests/unit/adt/gcts.test.ts` with unit tests (~20 tests): one per gCTS function (14 functions) covering success path, plus 6 negative/edge cases: `cloneRepo` without `enableGit` → `AdtSafetyError`; `cloneRepo` with disallowed package → `AdtSafetyError`; `listRepos` with `{}` body → empty array; `listRepos` with `{"result":[...]}` body → populated array; `getTransportHistory` returning 500 + `{"exception":"No relation..."}` body → `AdtApiError` carrying the exception text; `commitRepo` returning 200 + `{"log":[{"severity":"ERROR",...}]}` → `AdtApiError` surfacing the log message.
- [ ] Follow the mocking pattern from `tests/unit/adt/transport.test.ts`: `vi.mock('undici', ...)`, `mockResponse(200, JSON.stringify(fixture), { 'content-type': 'application/json' })`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: abapGit ADT-bridge client module

**Files:**
- Create: `src/adt/abapgit.ts`
- Create: `tests/unit/adt/abapgit.test.ts`
- Create: `tests/fixtures/xml/abapgit-repos-v2.xml`
- Create: `tests/fixtures/xml/abapgit-external-info.xml`
- Create: `tests/fixtures/xml/abapgit-staging.xml`
- Create: `tests/fixtures/xml/abapgit-repo-v3.xml`

Adds the XML/HATEOAS abapGit client, wrapping `/sap/bc/adt/abapgit/*`. Follows the shape of `marcellourbani/abap-adt-api/src/api/abapgit.ts` but re-implemented natively using ARC-1's XML parser and HTTP client. **With the ADT bridge now installed on the trial**, unit tests are complemented by integration tests against the 4 pre-existing repos (`$TUTORIALS`, `$TUTORIALS_TABLE`, `$TUTORIALS-TABLE`, `/DMO/FLIGHT`). Write tests are still skipped because the trial lacks outbound cert trust for the remote Git hosts.

Endpoints (all under `/sap/bc/adt/abapgit/`, confirmed via live probe unless noted):
- `GET /repos` with `Accept: application/abapgit.adt.repos.v2+xml` — list repos (returns HATEOAS-linked XML). **Only v2 is accepted** — v3 returns 406 `ExceptionResourceNotAcceptable` (`Accepted content types: application/abapgit.adt.repos.v2+xml`).
- `POST /externalrepoinfo` — branch listing for a remote URL. Request type `application/abapgit.adt.repo.info.ext.request.v2+xml`, response type `application/abapgit.adt.repo.info.ext.response.v2+xml`. **Request root element namespace is `http://www.sap.com/adt/abapgit/externalRepo`** (capital R). Using `.../externalrepoinfo` (lowercase) returns 400 `ExceptionInvalidData`.
- `POST /repos` with `Content-Type: application/abapgit.adt.repo.v3+xml` — create/link repo. Body: `<abapgitrepo:repository>...</abapgitrepo:repository>` with `<package>`, `<url>`, `<branchName>`, `<transportRequest>`, `<remoteUser>`, `<remotePassword>`.
- `POST /repos/{repoId}/pull` with body type `application/abapgit.adt.repo.v3+xml` — pull. Same body shape as create.
- `DELETE /repos/{repoId}` — unlink (local only, doesn't remove objects). Tested live with a fake id: returns 404 with `org.abapgit.adt` namespace exception `Repository not found in database. Key: REPO, <id>`.
- `GET <stage_link_href>` (HATEOAS, href ends `/stage`) with `Content-Type: application/abapgit.adt.repo.stage.v1+xml` — stage. ⚠ **Hangs on trial** when remote is unreachable; don't call from integration tests without a reachable remote.
- `POST <push_link_href>` (HATEOAS, href ends `/push`) with `application/abapgit.adt.repo.stage.v1+xml` — push (full staging payload).
- `POST /repos/{repoId}/checks` — **note plural**: the HATEOAS link has `rel="http://www.sap.com/adt/abapgit/relations/check"` and `type="check_link"` but the path segment is `/checks`. Returns **200 with empty body** on success. The client should translate this to `{ ok: true }`.
- `POST /repos/{repoId}/branches/{encodeURIComponent(branch)}?create={true|false}` — switch branch (`create=false`) or create+switch (`create=true`).
- `GET /repos/{repoId}/branches` — **does not exist** (404). Use `external_info` (needs URL) instead.
- `GET /repos/{repoId}` — **does not exist** (405 `ExceptionMethodNotSupported`). All repo data is embedded in the list response.

For private-repo requests, set headers `Username: <plain>` and `Password: <base64(password)>` (matches abap-adt-api convention). For every mutating call, rely on the existing `AdtHttpClient` CSRF flow — don't fetch manually.

**Error classifier** (new helper in `src/adt/errors.ts`, `classifyAbapgitError(xmlBody)`): parses the `<exc:exception>` envelope and distinguishes `org.abapgit.adt` namespace (bridge errors — e.g. repository not found, clone conflict, stage conflict) from `com.sap.adt` (framework errors — e.g. 405/406). Returns `{ namespace, message, t100Key }`. The handler uses this to format LLM-friendly error responses.

- [ ] Create `src/adt/abapgit.ts` with exported functions: `listRepos`, `getExternalInfo`, `createRepo`, `pullRepo`, `unlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `switchBranch` (+ `createBranch` as thin wrapper over `switchBranch` with `create=true`).
- [ ] Parse all responses with `parseXml` from `src/adt/xml-parser.ts`. Add dedicated parsers: `parseAbapGitRepos` (handles `<abapgitrepo:repositories>` with embedded `<atom:link>` HATEOAS), `parseAbapGitExternalInfo` (handles `<abapgitexternalrepo:externalRepoInfo>` with `<accessMode>` + `<branch>` children), `parseAbapGitObjects` (handles `<abapgitrepo:objects>` returned by `pull`).
- [ ] Every function calls `checkOperation` + (for writes) `checkGit` + (for `createRepo`) `checkPackage` before HTTP.
- [ ] For HATEOAS operations (`stageRepo`, `pushRepo`, `checkRepo`), accept an `AbapGitRepo` object (from `listRepos`) and pull the link from `repo.links[type=stage_link|push_link|check_link]`. Throw a descriptive error if the link is missing. Store the `rel` attribute as the canonical lookup key (`type` is optional on some repo entries — observed on the pull link in live data where no `type` attribute is present, only `rel`).
- [ ] `checkRepo` interprets a 200 with empty body as `{ ok: true, message: null }` and a 200 with XML body as `{ ok: false, message: <parsed> }`. Don't throw on empty body.
- [ ] Credentials: accept optional `user: string, password: string`. If present, set `Username: <plain>` + `Password: <base64(password)>` headers. In the XML body, also set `<remoteUser>` / `<remotePassword>` for `createRepo` / `pullRepo`.
- [ ] Create fixture XML files using the captured live responses: `abapgit-repos-v2.xml` (the 4-repo response from A4H with HATEOAS links), `abapgit-external-info.xml` (captured from the public `abapGit-tests/CLAS.git` probe — shows PUBLIC access mode + HEAD + `german` + `main` branches), `abapgit-staging.xml` (based on abap-adt-api shape), `abapgit-repo-v3-create.xml` (request body template), `abapgit-error-bridge.xml` (captured `Repository not found` 404 body), `abapgit-error-framework.xml` (captured 405/406 bodies).
- [ ] Create `tests/unit/adt/abapgit.test.ts` with unit tests (~16 tests): one per function (10 functions), plus: `createRepo` without `enableGit` → safety error; `createRepo` with disallowed package → safety error; `stageRepo` with missing stage_link → descriptive error; `pullRepo` on 404 bridge-namespace error → `AdtApiError` with parsed message; `listRepos` parses 4 HATEOAS links per repo; `externalRepoInfo` namespace exactly `http://www.sap.com/adt/abapgit/externalRepo` (fail if case changes); `checkRepo` empty body → `{ok:true}`; `Username`/`Password` base64 encoding check; switch_branch URL has `?create=false` when `create=false`.
- [ ] Run `npm test` — all tests must pass.

### Task 4: `SAPGit` Zod schema and tool definition

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

Defines the tool-facing surface. The schema is one `action` enum, a small set of optional string params, and an optional `backend` override. The tool is registered only when either backend is available; description text steers the LLM toward the available backend.

- [ ] In `src/handlers/schemas.ts`, add `SAPGitSchema = z.object({ action: z.enum([...]), repoId: z.string().optional(), url: z.string().optional(), branch: z.string().optional(), package: z.string().optional(), transport: z.string().optional(), commit: z.string().optional(), message: z.string().optional(), objects: z.array(z.object({ type: z.string(), name: z.string() })).optional(), user: z.string().optional(), password: z.string().optional(), token: z.string().optional(), backend: z.enum(['gcts','abapgit']).optional(), limit: z.coerce.number().optional() })`. Action enum (matches the Target State matrix — 16 actions): `list_repos`, `whoami`, `config`, `branches`, `external_info`, `history`, `objects`, `check`, `stage`, `clone`, `pull`, `push`, `commit`, `switch_branch`, `create_branch`, `unlink`. **Removed from the first draft:** `get_repo` (no per-repo GET endpoint exists on either backend — data is in the list response), `status` (not distinct from `list_repos` + `history`).
- [ ] Add `case 'SAPGit': return SAPGitSchema;` to `getToolSchema` in `src/handlers/schemas.ts:554-580`.
- [ ] In `src/handlers/tools.ts`, add `SAPGIT_DESC_ONPREM` and `SAPGIT_DESC_BTP` strings near the other tool descriptions (~line 243 pattern). Describe the backend auto-selection, list the actions with a one-liner each, and state that write actions require `--enable-git` and package allowlist inclusion.
- [ ] Add a new `name: 'SAPGit'` entry to the tool list inside `buildTools()` (same place where `SAPTransport` is registered). Gate registration on `resolvedFeatures.gcts?.available || resolvedFeatures.abapGit?.available`. Include full JSON Schema `inputSchema` matching the Zod schema.
- [ ] Add unit tests (~5 tests) to `tests/unit/handlers/schemas.test.ts`: valid shape accepted; unknown action rejected; `backend` enum restricted to `gcts|abapgit`; `objects` array shape validated; `limit` coerced from string to number.
- [ ] Run `npm test`.

### Task 5: `handleSAPGit` handler with backend dispatch and scope enforcement

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wires the schema to the clients. Reads the resolved features, picks the backend, enforces per-action scope, dispatches to the correct client module, and formats the result for the LLM.

- [ ] Add imports for `src/adt/gcts.ts` (`getSystemInfo`, `getConfig`, `listRepos as listGctsRepos`, ...) and `src/adt/abapgit.ts` (`listRepos as listAbapgitRepos`, ...) at the top of `src/handlers/intent.ts`.
- [ ] Add a `SAPGIT_ACTION_SCOPES: Record<string, 'read' | 'write'>` map. Read: `list_repos`, `whoami`, `config`, `branches`, `external_info`, `history`, `objects`, `check`. Write: `clone`, `pull`, `push`, `commit`, `stage`, `switch_branch`, `create_branch`, `unlink`. Note that `stage` is classified as **write** (even though it's an HTTP GET under the HATEOAS link) because it produces a staging payload tied to pending Git state — treating it as read would let read-only users observe staging state that leaks work-in-progress.
- [ ] Add `SAPGit: 'read'` baseline to `TOOL_SCOPES` (so the tool appears for users with read scope; per-action enforcement inside the handler denies write actions for read-only users).
- [ ] Add `handleSAPGit(client: AdtClient, args: Record<string, unknown>, authInfo?: AuthInfo): Promise<ToolResult>`. Steps: (1) resolve `backend` — honor `args.backend` if set, otherwise prefer `gcts` when available; (2) per-action scope check against `authInfo?.scopes` (only when `authInfo` present); (3) switch over `action` and call the appropriate client function; (4) format response as JSON string via `textResult(JSON.stringify(result, null, 2))`.
- [ ] Handle backend mismatches using the Target State support matrix: gCTS-only actions (`whoami`, `config`, `branches`, `history`, `objects`, `commit`) on abapGit backend → descriptive error "Action '<x>' is only supported by gCTS; this system uses abapGit." Same in reverse for abapGit-only (`external_info`, `check`, `stage`, `push`). `list_repos`, `clone`, `pull`, `switch_branch`, `create_branch`, `unlink` work on either.
- [ ] Wire `handleSAPGit` into the main tool dispatch switch in `src/handlers/intent.ts` (near the `handleSAPTransport` case at line ~506). Pattern: `case 'SAPGit': result = await handleSAPGit(client, args, authInfo); break;`.
- [ ] Add unit tests (~12 tests) to `tests/unit/handlers/intent.test.ts`: backend auto-selects gCTS when both present; honors explicit `backend: 'abapgit'`; returns error when neither backend available; scope check denies write action without write scope; dispatches `list_repos` to gCTS client; dispatches `stage` to abapGit client; returns error for gCTS-only action on abapGit backend; formats success as JSON; surfaces `AdtSafetyError` as error result; surfaces `AdtApiError` with SAP exception text; handles 404 gracefully; unknown action rejected.
- [ ] Run `npm test`.

### Task 6: CLI/env flag plumbing for `--enable-git` / `SAP_ENABLE_GIT`

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/server.ts`
- Modify: `src/server/audit.ts`
- Modify: `tests/unit/server/config.test.ts`

Threads the new safety flag from CLI/env/`.env` into `SafetyConfig.enableGit`. Ensures credentials passed as tool arguments (`password`, `token`, etc.) are redacted in audit logs.

- [ ] Add `enableGit?: boolean` to `ServerConfig` in `src/server/types.ts` (next to `enableTransports`).
- [ ] Parse `--enable-git` (commander flag) and `SAP_ENABLE_GIT` (env var) in `src/server/config.ts`. Default to `false`. Precedence: CLI > env > `.env` > default (same as existing flags).
- [ ] In `src/server/server.ts`, plumb `config.enableGit` into the `SafetyConfig` used by `AdtClient` (the same place `enableTransports` is assigned).
- [ ] In `src/server/audit.ts`, ensure `password`, `token`, `authPwd`, `remotePassword`, `remotePassword` are added to the redaction list in `sanitizeArgs()` (check what's already there — the function redacts `password`/`cookie` today; add `token`, `authToken`, `remotePassword` if missing).
- [ ] Add unit tests (~4 tests) to `tests/unit/server/config.test.ts`: `--enable-git` flag sets `enableGit=true`; `SAP_ENABLE_GIT=true` env sets `enableGit=true`; missing flag defaults to `false`; CLI overrides env.
- [ ] Add unit test (~2 tests) to `tests/unit/server/audit.test.ts` (create if not present): `password`, `token` redacted in `sanitizeArgs()` output.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.

### Task 7: Integration tests for gCTS and abapGit read paths against live trial

**Files:**
- Create: `tests/integration/gcts.integration.test.ts`
- Create: `tests/integration/abapgit.integration.test.ts`

Exercises the read paths of both backends against the A4H trial. Uses `getTestClient()`, probes features first, skips gracefully when a backend isn't available. Trial has both backends installed: gCTS (v2.7.1, no repos) and abapGit (4 pre-linked repos: `$TUTORIALS`, `$TUTORIALS_TABLE`, `$TUTORIALS-TABLE`, `/DMO/FLIGHT`). Write paths are deliberately NOT covered — they require a reachable remote Git host with valid cert trust, which the trial lacks.

**gCTS test file** (`tests/integration/gcts.integration.test.ts`):

- [ ] Follow the pattern of `tests/integration/adt.integration.test.ts` (same `describe`/`beforeAll`/`requireSapCredentials()` structure).
- [ ] Run `probeFeatures()` first; use `requireOrSkip(ctx, features.gcts.available, SkipReason.BACKEND_UNSUPPORTED)` for every test.
- [ ] Tests (~6 tests): `getSystemInfo` returns `result.sid === 'A4H'`, `result.version` matching `2.x.y`, and GREEN `status` entries for `tp`/`dataset`/`cts`/`java`/`gcts_path`; `getUserInfo` returns `user.user === <test-user>` and at least one scope entry; `getConfig` returns array of config entries with `CLIENT_VCS_URI` present; `listRepos` tolerates the empty-object response (`{}` → `[]`); `cloneRepo` with `enableGit=false` throws `AdtSafetyError`; `getTransportHistory("NONEXISTENT_REPO")` surfaces the 500 exception as `AdtApiError` with `"No relation between system and repository"` text.

**abapGit test file** (`tests/integration/abapgit.integration.test.ts`):

- [ ] Same structure with `requireOrSkip(ctx, features.abapGit.available, SkipReason.BACKEND_UNSUPPORTED)`.
- [ ] Tests (~7 tests): `listRepos` returns ≥ 1 repo (don't hard-code count — ADT bridge repo list can change); for each repo, assert `key`, `package`, `url`, `branchName`, `links` all populated; assert at least one repo has a `push_link`, `pull` link, `stage_link`, and `check_link`; `listRepos` with `Accept: application/abapgit.adt.repos.v3+xml` throws `AdtApiError` with 406 + "Accepted content types: application/abapgit.adt.repos.v2+xml"; `getExternalInfo("https://github.com/abapGit-tests/CLAS.git")` returns `accessMode: 'PUBLIC'` with HEAD + `main` branches present (this URL is a stable abapGit test fixture maintained by the abapGit project — no cert issues); `unlinkRepo("FAKE")` throws `AdtApiError` with `org.abapgit.adt` namespace + "Repository not found in database" message; `createRepo` with `enableGit=false` throws `AdtSafetyError`; `checkRepo` against a repo with no remote reachability should either return `{ok:true}` or throw within a 30s timeout (test guards with `expect(...).resolves` or `expect(...).rejects.toThrow()` wrapped in `Promise.race` timeout — never hang the suite).
- [ ] Mark `stageRepo` / `pullRepo` test cases as `test.skip` with a comment pointing to the cert-trust precondition in `INFRASTRUCTURE.md`. Do NOT attempt them without STRUST setup — they hang.

Run `npm run test:integration -- gcts` and `npm run test:integration -- abapgit` with the trial credentials. All tests must pass or skip cleanly.

### Task 8: E2E test for `SAPGit` via MCP protocol

**Files:**
- Create: `tests/e2e/sap-git.e2e.test.ts`

Verifies the whole stack — tool registration, schema validation, handler dispatch, safety enforcement — over the MCP protocol. Uses the live MCP server (with `--enable-git=false` by default, trial SAP) and asserts that read actions succeed and write actions are blocked by safety.

- [ ] Create `tests/e2e/sap-git.e2e.test.ts` using `connectClient()`, `callTool()`, `expectToolSuccess()`, `expectToolError()` from `tests/e2e/helpers.ts`.
- [ ] Tests (~7 tests): `tools/list` includes `SAPGit` when either backend is available; `SAPGit(action="list_repos")` returns a JSON string parseable to an array (≥0 items — don't hard-code count, both backends may be live on trial); `SAPGit(action="whoami", backend="gcts")` returns an object with `user` and `scope` fields; `SAPGit(action="config", backend="gcts")` returns a non-empty config array; `SAPGit(action="external_info", backend="abapgit", url="https://github.com/abapGit-tests/CLAS.git")` returns `accessMode: 'PUBLIC'` and a `branches` array; `SAPGit(action="clone", url=..., package="$TMP")` without `--enable-git` returns error mentioning "Git operation"; `SAPGit(action="whoami", backend="abapgit")` returns a backend-mismatch error ("only supported by gCTS"); unknown `action` returns schema validation error.
- [ ] Follow the sequential pattern (`test.sequential`) and 120s timeout convention.
- [ ] Run `npm run test:e2e -- sap-git` — all tests must pass or skip cleanly.

### Task 9: Documentation, roadmap, feature matrix, and CLAUDE.md

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Review: `.claude/commands/implement-feature.md` (update if it references tool lists or mentions git workflows)

Propagates the new capability across all user-visible and agent-visible documentation. Uses the patterns established by prior completed FEAT-\* plans (see `docs/plans/completed/` for reference).

- [ ] `docs/tools.md`: Add a new `## SAPGit` section describing the tool. List all actions with short descriptions, required arguments, scope and `--enable-git` requirements, and backend matrix (gCTS-only, abapGit-only, both).
- [ ] `docs/roadmap.md`: Change FEAT-22 status from "Not started" to "Done". Update the "Current State" matrix (top of the file) to add a new row or update an existing Git-related row. Update the "Key competitive threats" VSP bullet to note gCTS parity has been closed.
- [ ] `docs_page/roadmap.md`: Apply the same changes as `docs/roadmap.md` (this is the user-facing mirror — keep them in sync). The FEAT-22 table block at lines 689-705 of the current file is the target.
- [ ] `docs/compare/00-feature-matrix.md`: Update the gCTS/abapGit row (around the #15 capability) — change ARC-1 from ❌ to ✅. Refresh the "Last Updated" date at the top.
- [ ] `CLAUDE.md`: (a) Add `src/adt/gcts.ts` and `src/adt/abapgit.ts` to the codebase structure tree. (b) Add a new row to the "Key Files for Common Tasks" table: `| Add gCTS / abapGit operation | src/adt/gcts.ts or src/adt/abapgit.ts, src/handlers/intent.ts (handleSAPGit), src/handlers/tools.ts, src/handlers/schemas.ts |`. (c) Add `SAP_ENABLE_GIT` / `--enable-git` to the config table. (d) Mention `SAPGit` in the 11-tool count (now 12) or note it as opt-in. (e) Add a short Git-specific code pattern snippet if helpful.
- [ ] `README.md`: Add a short feature bullet under the capabilities section mentioning Git-based ABAP workflows (gCTS + abapGit) with the `--enable-git` safety note.
- [ ] `.claude/commands/implement-feature.md`: If it references available tools, add `SAPGit` and note the backend split.
- [ ] Run `npm test` — all must still pass.
- [ ] Run `npm run lint` — no errors.

### Task 10: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run integration tests: `npm run test:integration -- gcts` and `npm run test:integration -- abapgit` (with trial SAP creds set) — tests pass or skip cleanly, never silently.
- [ ] Run E2E tests: `npm run test:e2e -- sap-git` — tests pass or skip cleanly.
- [ ] Manual smoke (gCTS): start the MCP server with `--enable-git` pointed at trial; call `SAPGit(action="whoami", backend="gcts")` — confirm returns `user.user = "DEVELOPER"` + scope array; call `SAPGit(action="config", backend="gcts")` and confirm the full config schema comes back.
- [ ] Manual smoke (abapGit): call `SAPGit(action="list_repos", backend="abapgit")` — confirm returns the 4 pre-linked repos (`$TUTORIALS`, `$TUTORIALS_TABLE`, `$TUTORIALS-TABLE`, `/DMO/FLIGHT`); call `SAPGit(action="external_info", backend="abapgit", url="https://github.com/abapGit-tests/CLAS.git")` — confirm PUBLIC access and branches list.
- [ ] Confirm `tools/list` includes `SAPGit` only when the features probe reports gCTS or abapGit as available.
- [ ] Confirm `SAPGit(action="clone", ...)` without `--enable-git` returns the descriptive safety error ("Git operation ... is disabled. Set SAP_ENABLE_GIT=true or pass --enable-git to enable.").
- [ ] Move this plan to `docs/plans/completed/2026-04-18-feat-22-gcts-abapgit-integration.md`.
