# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working in this repository.
Single source of truth — `CLAUDE.md` imports this file. It is loaded into every session, and Codex
reads only its first 32 KiB, so `npm run check:sizes` caps its size: rules every change must
follow stay here, anything that matters for one area goes to [docs/dev-guide.md](docs/dev-guide.md)
(not auto-loaded — grep it for the object type, tool action or file you are about to change).

## Project Overview

**ARC-1** is a TypeScript MCP (Model Context Protocol) server for SAP ABAP Development Tools (ADT).
It provides 12 intent-based tools (SAPRead, SAPSearch, SAPWrite, SAPActivate, SAPNavigate, SAPQuery,
SAPTransport, SAPGit, SAPContext, SAPLint, SAPDiagnose, SAPManage) for Claude and other MCP clients.
Distributed as npm package (`arc-1`) and Docker image (`ghcr.io/arc-mcp/arc-1`).

## Design Principles

1. **Centralized admin control** — managed service; server-wide safety ceiling (`allowWrites`, package allowlists, SQL/data/transport/Git gates, deny actions); every call audited; per-user scopes restrict, never expand.
2. **Per-user SAP identity by default** — principal propagation maps each MCP user to their own SAP user. ADR-0007 permits only an explicit mutation-free multi-target Basic exception, labeled shared and never used as PP fallback.
3. **Token-efficient tools** — 12 intent tools vs 200+ endpoints, with schema payload guarded by CI budgets; hyperfocused mode = 1 tool (~200 tokens); method-level surgery + context compression keep mid-tier LLMs viable.
4. **BTP-native deployment** — Destination Service, Cloud Connector, XSUAA OAuth, BTP Audit Log; also Docker/npm/stdio.
5. **Multi-client, vendor-neutral** — XSUAA OAuth + Entra ID OIDC + API key coexist; one instance serves Claude, Copilot Studio, VS Code, Gemini CLI, Cursor.
6. **Safe defaults, opt-in power** — read-only by default; free SQL blocked; package allowlist defaults to `$TMP`; everything forbidden until the admin allows it.
7. **Single target by default; explicit BTP exceptions** — default-off discovered targets per ADR-0006/0007/0011;
   see the multi-system boundary under Security & Architectural Invariants.
8. **ABAP execution and RFC belong in extensions** — no built-in report/class execution, direct RFC,
   or installed/temporary ABAP helpers. Core uses existing SAP APIs and TypeScript; user ABAP
   development and dedicated ATC/Unit workflows retain their gates. See [ADR-0009](docs/adr/0009-abap-execution-and-rfc-belong-in-extensions.md).

## Security & Architectural Invariants

- **Threat model + the 7 security invariants + per-PR review checklist + residual-risk register live in [docs/security-model.md](docs/security-model.md)** (review narrative + remediation roadmap in [docs/security-review-2026-06.md](docs/security-review-2026-06.md)). Read it before touching auth, the safety ceiling, caches, audit sinks, or any arg→URL/SQL/XML sink.
- **stdout is sacred** — MCP JSON-RPC only; all logging to stderr.
- Never commit `.env`, `cookies.txt`, `.arc1.json`; sensitive fields are redacted in logs.
- **Safety config is the server ceiling** — per-user scopes only restrict.
- **Multi-system boundary** — single target remains the default. ADR-0006/0007/0008 define discovered
  BTP/XSUAA routes, shared Basic read-only identity and verified target grants. ADR-0011 (
  superseding ADR-0010's adapter) admits listed `SAPWrite` actions and activation on pinned strict-PP
  routes through the single-target handlers. Every call requires the server ceiling, destination opt-in/restrictions, read access, raw write scope
  and exact write grant. Aggregate/Copilot and Basic remain mutation-free; no PP fallback. Follow the
  normative plans and R23 in `docs/security-model.md`; broader mutations or another discovery/auth
  model require a new ADR/security review. Separate instances remain the stronger isolation option.
- **Per-user auth never inherits shared credentials** — `buildAdtConfig(..., { perUser: true })` strips username/password/cookies; any new Layer B field must respect the flag.
- **All ADT endpoints have safety guards** — no unguarded `http.{get,post,put,delete}`.
- **Cookie hot-reload**: `SAP_COOKIE_FILE` re-read during auth recovery and before CSRF bootstrap outside a live stateful context; changed cookies reset the old session, empty/unreadable files preserve known cookies, and `SAP_COOKIE_STRING` cannot hot-reload.
- **Error types**: `AdtApiError` / `AdtSafetyError` / `AdtNetworkError` / `AdtResponseLimitError`; `dispatch.ts` formats them with LLM-friendly hints.
- **Stateful sessions** for lock→modify→unlock; CSRF auto-managed (`src/adt/http.ts`).
- **ADT locks never cross an MCP round-trip** — `lock→modify→unlock` completes inside ONE synchronous tool call; never elicit inside a lock block, never expose writes as async MCP Tasks holding a lock ([ADR-0006](docs/adr/0006-mcp-legacy-era-until-triggers.md)).
- **Tool schema three-file sync** — every property must exist in `tools.ts` (JSON Schema → visible to LLMs), `schemas.ts` (Zod), and the per-tool handler. `batch_create` item schemas are separate from the top-level schema — update both.
- **MTA layout** — `mta.yaml` committed (safe defaults); `mta-overrides.mtaext` gitignored.

## Authorization & Safety

- **Safety ceiling** (`src/adt/safety.ts`, startup): `allow*` flags + `allowedPackages` + `allowedTransports` + `denyActions`. ALL ADT endpoints go through `checkOperation()`; `OperationType` is internal-only.
- **Scopes** (`src/authz/policy.ts`): `read`/`write`/`data`/`sql`/`transports`/`git`/`admin` (`admin` ⊇ all, `write` ⊇ `read`, `sql` ⊇ `data`). `ACTION_POLICY` maps `(tool, action/type) → scope` — single source for runtime checks + tool-list pruning. Stdio skips scopes.
- **Principal propagation**: JWT → per-user SAP session; ARC-1 scopes stay enforced as defense-in-depth.
- **Multi-target Basic exception**: XSUAA identifies the human, but SAP sees one shared technical user. It is default-off, mutation-free, one-instance, request-local-secret, and process-guarded per ADR-0007.
- **ADT POSTs that look like reads**: `S_ADT_RES` allows URI prefixes and has no `ACTVT`; HTTP POST does not imply create/change permission. Trace backend activity checks separately — [SAP authorization guidance](docs_page/btp-destination-setup.md#startup-user-authorizations).

## Architecture: Request Flow

1. **Transport** (`src/server/http.ts` or stdio; stdio has no auth).
2. **Auth** (HTTP): XSUAA → OIDC JWT → API key → `AuthInfo { scopes, clientId?, userName? }`.
3. **SAP client** (`src/server/server.ts`): normally `ppEnabled` + JWT → per-user SAP session; ADR-0007 multi-target Basic resolves one request-local shared credential behind the process guard.
4. **`handleToolCall`** (`src/handlers/dispatch.ts`): arg normalization (`stripLlmEmptyValues`) → scope check (`ACTION_POLICY`) → Zod validation → per-tool handler → package check for writes. Source reads consult the inactive-list + ETag source cache.
5. **ADT client** (`src/adt/{client,crud,devtools}.ts`): every endpoint behind `checkOperation(safety, …)`.
6. **HTTP** (`src/adt/http.ts`): MIME negotiation, conditional GET, CSRF auto-refresh, 406/415 one-retry, cookie hot-reload, stateful lock→modify→unlock sessions. Write-enabled pinned clients turn off transient retries for POST/PUT/DELETE, resend a 403 only on the CSRF challenge, and check every `corrNr` and lock request against both transport lists.
7. **SAP**: native auth (`S_DEVELOP`, `S_ADT_RES`, `S_TRANSPRT`).

**Key invariant:** scope ∧ safety ∧ SAP auth — all must pass; pinned writes additionally require exact verified target capability and destination restrictions.

## Build & Test

```bash
npm ci                          # Install dependencies
npm run build                   # TypeScript → dist/ (also copies AFF schemas)
npm test                        # Unit tests (all)
npx vitest run tests/unit/adt/client.test.ts   # Single test file
npx vitest run -t "getProgram"  # Tests matching a name pattern
npm run typecheck               # tsc --noEmit (src + scripts + tests via tsconfig.tests.json)
npm run lint / lint:fix / format  # Biome
npm run dev / dev:http          # Dev mode (stdio / HTTP Streamable)
npm run test:integration[:slow|:crud]  # Needs SAP credentials (TEST_SAP_URL)
npm run test:e2e[:slow]         # Needs running MCP server (syncs fixtures first)
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp[:smoke]
```

Pre-commit: Husky runs `lint-staged` → Biome auto-fixes staged `*.{ts,js,json}`. Never hand-fix formatting.

Pre-push: Husky runs `check:sizes`, `validate:policy` and `typecheck` on the working tree, not the pushed
commits. Tests, full lint and build are not included; CI remains authoritative.

## Testing

Every code change requires tests. Skip taxonomy: `docs/testing-skip-policy.md`.

For SAP-facing/runtime changes, test on a real authorized SAP test system when possible and record
the tested build, release, deployment/auth route, observed result, and gaps in the
[PR template](.github/pull_request_template.md). If unavailable, state why and the remaining scenario;
never present mocks or skipped tests as live coverage. Documentation-only changes may use N/A.

| Level | Command | Needs |
|-------|---------|-------|
| Unit | `npm test` | — |
| Integration (+slow/crud) | `npm run test:integration[:slow|:crud]` | `TEST_SAP_URL` creds |
| BTP (+smoke) | `npm run test:integration:btp[:smoke]` | service key (local only) |
| E2E (+slow) | `npm run test:e2e[:slow]` | running MCP server |

- Unit mocking: `vi.mock('undici', …)` + `mockResponse` from `tests/helpers/mock-fetch.ts`.
- Skip policy: `requireOrSkip(ctx, value, reason)` + `SkipReason` constants — never `if (!x) return;` or empty catches.
- try/catch: assert success shape in try, expected error class in catch (`expectSapFailureClass`); tag cleanup `// best-effort-cleanup`; use `requireOrSkip` for preconditions.
- Integration: `getTestClient()`, sequential, `generateUniqueName()` for CRUD. E2E: `connectClient()`/`callTool()`/`expectToolSuccess()`, 120s, sequential.
- The LLM-visible tool surface is frozen by `tests/fixtures/tool-definitions/*.json` (see Engineering Playbook).

## Style, Stack & Releasing

- **Keep open-PR review changes visible** — apply review feedback and ordinary additions as new commits and
  push normally; never amend, squash, or force-push merely to fold those changes into published commits.
  Necessary branch maintenance such as rebasing onto the target branch or resolving history conflicts may
  rewrite history; verify the branch first, use `--force-with-lease` (never `--force`), and explain the rewrite.
- **ESM-only**: local imports need `.js` extensions. **TypeScript strict** (noUnusedLocals/Parameters, Node16 resolution). **Biome**: 2-space, single quotes, 120 cols — auto-fixed on commit, never hand-format.
- **Logging to stderr only** (`src/server/logger.ts`); `console.log` corrupts MCP JSON-RPC on stdout.
- Stack: TypeScript 6.0, Node 22+, `@modelcontextprotocol/sdk`, `@abaplint/core`, `undici`, `fast-xml-parser` v5, `better-sqlite3`, `commander`, `ajv` (2020-12), `zod` v4, `vitest`, `biome`.
- **Releasing** ([release-please](https://github.com/googleapis/release-please)): `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major; `refactor:`/`test:`/`docs:`/`chore:`/`ci:` → **no release** (use these for behavior-preserving PRs). Version lives in `package.json` + `src/version.ts` `VERSION` (the `x-release-please-version` marker — never bump by hand). npm publishes via OIDC trusted publishing. Every released version also needs an annotated entry in `docs_page/release-notes.md` (run `/release-notes`) — CI fails while one is missing.

## Contributing a Change

What review most often had to add or change on contributed PRs and issues, most frequent first. PRs that
merged with little rework added about 170 lines; ones above 1,000 were usually rebuilt by a maintainer.

**Before writing code**

- **Issue first for features.** A new tool action, object type, config option or auth path needs an issue
  and a maintainer go-ahead; check open PRs, `main` and the roadmap, since parallel implementations get
  folded into one. A bug fix with a reproducer needs no prior agreement.
- **One behavior per PR**, opened as a draft while you still push. No option, environment variable, gate,
  retry or hint the issue did not ask for.
- **Reuse the existing path** (XML parser, AFF source write, `withLockedMutation`, shared handlers) and
  extend the existing test file, never a parallel one.

**In the PR**

- **Tests for every edge you touch:** namespaced `/NS/…` names, cache hits, error paths, batch items.
- **Docs match observed behavior:** update `docs_page/tools.md` and related pages; no release claim you
  did not verify. State the SAP releases you tested and do not gate on the others.
- **Validate input before any SAP request and fail closed.** Bound downloads and output. A multi-step
  write reports what was created, what failed and what is unknown; never success SAP did not confirm.
- **Run `npm run check:sizes` and the tool-definition snapshot test;** never reuse a roadmap ID.

**Usually declined for core:** auth code CI cannot exercise, shared SAP identities, ABAP installed on the
system, ABAP execution or RFC (principle 8), and features with no existing SAP API. Propose an extension.

**Filing an issue** (also when an agent files it through the API): follow the form's fields; one problem
per issue; the verbatim tool-call JSON and the verbatim error with HTTP status; the exact ARC-1 version
(never "latest", reproduced on the latest release) and SAP_BASIS with SP level; whether the same call
works via `arc1-cli call`, another MCP client or Eclipse ADT. For a feature, name the SAP API and the
release where you saw it work.

Maintainers may push commits to your branch; a superseding PR credits you as co-author.

## Roadmap Discipline

- Check [docs_page/roadmap.md](docs_page/roadmap.md) at the start and before finishing every change
  (features, fixes, refactors, documentation, or research); use its evidence and avoid duplicate ideas.
- The roadmap is an idea parking lot, not an execution queue or changelog. An entry is not
  authorization or a commitment to implement it.
- Update it in the same PR when the change affects an idea: add useful deferred work, narrow partial
  completions to the remaining gap, and remove fully implemented/verified, rejected, or subsumed
  items from both the overview and details. Keep closed-PR links for unfinished ideas; do not add
  strikethroughs or a completed section.
- Ground decisions in current code, tests, docs, issues/PRs, and relevant specifications. Keep
  priority, effort, category, status, and resume trigger consistent in the overview and details.
- State the roadmap impact in the PR description (item IDs and changes, or "No roadmap impact"
  after checking). Unrelated changes need no artificial roadmap edit.

## Configuration (Priority: CLI > Env > .env > Defaults)

Parser: `src/server/config.ts`; defaults: `src/server/types.ts`. `.env` (copy `.env.example`) is for
local/stdio/Docker only; on BTP CF the same keys are `.mtaext` properties. Every option:
[docs_page/configuration-reference.md](docs_page/configuration-reference.md). The safety-relevant ones:

| Variable / Flag | Description |
|-----------------|-------------|
| `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT` | SAP connection (client default 100) |
| `SAP_TRANSPORT` | `stdio` (default) or `http-streamable` |
| `SAP_ALLOW_WRITES` | Enable mutations (default false); prerequisite for transport/git writes |
| `SAP_ALLOW_DATA_PREVIEW` / `SAP_ALLOW_FREE_SQL` | TABLE_CONTENTS preview / freestyle SQL (default false) |
| `SAP_ALLOW_TRANSPORT_WRITES` / `SAP_ALLOW_GIT_WRITES` | Transport / git mutations (each ALSO needs `SAP_ALLOW_WRITES`) |
| `SAP_ALLOWED_PACKAGES` | Write allowlist (default `$TMP`): exact, `Z*`, `ZFOO/**` subtree, `*`. Enforced fail-closed on every mutation incl. activation, against the object's REAL package |
| `SAP_DENY_ACTIONS` | Deny `Tool`, `Tool.action`, `Tool.glob*`, or exact plugin `Custom_<name>` — see docs_page/authorization.md |
| `ARC1_API_KEYS` | `key:profile` pairs (viewer…admin); profile ∩ server ceiling |
| `ARC1_TOOL_MODE` | `standard` (12 tools) or `hyperfocused` (1 tool, ~200 tokens) |
| `ARC1_MULTI_TARGET_AUTHORIZATION` | Default/unset `standard` = standard access. Opt-in `xsuaa-attribute` filters IAM-assigned targets, not discovered SAP accounts; multi-only, never fallback. Admin diagnostics do not grant execution. Contract/readiness: ADR-0008 + `docs/plans/xsuaa-target-authorization.md`. |
| `SAP_PP_ENABLED` / `SAP_PP_STRICT` / `SAP_PP_ALLOW_SHARED_COOKIES` | Principal propagation + strict mode + cookie-coexistence escape hatch |

## Codebase Structure

```
src/index.ts, src/cli.ts   # MCP server entry (bin: arc1) / CLI entry (bin: arc1-cli)
src/server/                # MCP setup, config, HTTP auth + routes, multi-target, audit sinks, rate limits, XSUAA
src/handlers/              # one module per tool; dispatch.ts routes; tools.ts (JSON Schema) + schemas.ts (Zod)
src/adt/                   # ADT client: client.ts (reads), http.ts (transport, CSRF), crud.ts, devtools.ts, safety.ts, errors.ts
src/authz/                 # policy.ts — ACTION_POLICY scopes
src/context/               # deps, CDS deps, compressor, method/unit surgery, grep
src/cache/                 # memory/sqlite cache, ETag layer, inactive-list cache
src/aff/ src/probe/ src/lint/   # AFF schema validation / ADT type probe / abaplint
scripts/ci/                # size ratchets, coverage and reliability reporting
tests/                     # helpers/ unit/ integration/ e2e/ evals/ fixtures/ (tool-definitions = LLM-surface snapshots)
```

File-level map: `docs/dev-guide.md` (Codebase structure — file level).

## Key Files for Common Tasks

**Required first step for any task about one object type, tool action or subsystem: grep
`docs/dev-guide.md` for it and read the matching rows** — e.g. `grep -n -i 'TTYP' docs/dev-guide.md`
(likewise `edit_method`, `atc`, `ST05`, `abapGit`, `traceparent`, `FUGR`, `transport`). Its "Key Files —
full reference" table has one row per feature with the files and the live-verified gotchas, which
are not repeated here and cannot be derived from the code. Do this even for a question or a plan.
The rows below cover cross-cutting tasks only. For opt-in target authorization read
[ADR-0008](docs/adr/0008-opt-in-xsuaa-target-authorization.md) and
[its contract](docs/plans/xsuaa-target-authorization.md); [ADR-0011](docs/adr/0011-broader-pinned-pp-mutations.md) defines pinned writes.

| Task | Files (+ key gotcha) |
|------|------|
| BTP deployment/docs guidance | `docs_page/btp-overview.md` → one canonical runbook or task reference; per-user targets: `docs_page/multi-target-authorization.md`. Research/specs are not shipped settings (details: `docs/dev-guide.md#btp-documentation`). |
| Multi-target ADR-0006/0007 work | Read ADR-0006/0007, then `docs/plans/destination-discovered-multi-target-v1.md`; code `src/server/{destination-*,multi-target-*,server,http}.ts`, `src/authz/policy.ts`, `src/handlers/{dispatch,feature-cache}.ts`; writes: ADR-0011 + `src/server/multi-target-write-surface.ts`. Aggregate/Basic stay mutation-free; Basic is never PP fallback. Full doc/test map: `docs/dev-guide.md` (multi-target developer map). |
| Add new read operation | `src/adt/client.ts`, `src/handlers/read.ts`, `src/handlers/tools.ts` (+ `src/adt/xml-parser.ts`, `src/adt/types.ts` for structured) |
| Shared mutation lifecycle | `src/adt/crud.ts` (`withLockedMutation`), `src/adt/http.ts` (`pinnedWrite` barrier); pinned targets use the single-target handlers — never add a per-resource pinned adapter. See `docs/dev-guide.md#shared-mutation-lifecycle`. |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/handlers/dispatch.ts` |
| Add/modify tool input schema | `src/handlers/schemas.ts` + `src/handlers/tools.ts` (three-file sync — see invariants) |
| Harden against GPT/OpenAI arg pollution (#360) | `src/handlers/object-types.ts` (`stripLlmEmptyValues`), `src/handlers/schemas.ts` — `looseOptionalBoolean` for EVERY optional boolean, never `z.coerce.boolean()` (maps "false"→true) |
| ADT discovery / MIME types | `src/adt/discovery.ts`, `src/adt/http.ts`, `src/adt/accept-fallback.ts`, `src/adt/legacy-content-handler.ts` — negotiated 406/415 headers apply to the exact normalized path; the #907 7.40 wildcard-400 retry stays uncached. |
| SAP error classification + hints | `src/adt/errors.ts`, `src/handlers/dispatch.ts` — ground hints in verified SAP Notes; release-aware via `src/adt/release.ts` (#293) |
| Unit test that starts an HTTP server | `tests/helpers/supertest-loopback.ts` (wired as `setupFiles`), `tests/unit/server/supertest-loopback.test.ts` — supertest binds `::` but addresses `127.0.0.1`; keep bind and request in one address family. |
| Test skip reason | `tests/helpers/skip-policy.ts`, `tests/e2e/helpers.ts`, `docs/integration-test-skips.md`, `scripts/ci/summarize-skips.mjs` — keep all four in sync |
| XML response parser / safety check | `src/adt/xml-parser.ts` (`parseXml` returns entity-DECODED values — never decode a parsed value again, always `escapeXmlAttr` it on write) / `src/adt/safety.ts` |
| Audit logging / new audit event type | `src/server/audit.ts` (typed `*Event` union; emit via `logger.emitAudit`), `src/server/sinks/` |
| Rate limiting (3 layers) | `src/server/auth-rate-limit.ts` / `src/server/mcp-rate-limit.ts` + `src/handlers/dispatch.ts` / `Semaphore` in `src/adt/http.ts` — docs/adr/0004 |
| Annotated release notes (per-release context for users + LLMs) | `docs_page/release-notes.md`, `.claude/commands/release-notes.md`, `tests/unit/server/release-notes.test.ts` — annotate WHILE the release-please PR is open; context never goes into `CHANGELOG.md`. |
| CLI sub-command | `src/cli.ts`, `src/cli-args.ts` — never duplicate Zod validation; `handleToolCall` does it |
| SAP version-quirk workaround | `src/adt/errors.ts` (`extractExceptionType` preferred); body-marker heuristics only with a release-scoped guard (ADR-0002) |
| Scope enforcement / auth scopes | `src/authz/policy.ts` (`ACTION_POLICY`), `src/handlers/dispatch.ts`, `src/server/server.ts`, `xs-security.json` |
| Auth combination rule | `src/server/config.ts` (`validateConfig`), `src/server/types.ts`, `docs_page/enterprise-auth.md` |
| Layer B auth mechanism | `src/adt/http.ts` (`applyAuthHeader`), `src/server/server.ts` (`applyPerUserAuthTokens`, `buildAdtConfig` perUser flag) — a new Layer B field must also be mapped in `src/adt/client.ts` httpConfig and set only per-user. |
| Safety config option | `src/adt/safety.ts`, `src/server/config.ts`, `src/server/types.ts` |
| AdtClient instance field / `withSafety()` clone | `src/adt/client.ts` — clone is `Object.assign(Object.create(proto), this, {safety})`; new own fields share automatically (use TS `private`, never `#private`) (#333) |
| `allowedPackages` pattern syntax | `src/adt/safety.ts`, `src/adt/package-hierarchy.ts`, `src/handlers/write-helpers.ts` (`enforceAllowedPackageForObjectUrl`, fail-closed) — details: dev-guide |
| Feature probe / feature-gated write guard | `src/adt/features.ts` (`PROBES`) / `src/handlers/write/rap.ts` pattern |
| E2E test / fixture | `tests/e2e/`, `tests/e2e/fixtures.ts` + `tests/fixtures/abap/` + `tests/e2e/setup.ts` |
| Source caching / ETag / inactive drafts | `src/cache/caching-layer.ts` + `src/cache/*`, `src/cache/inactive-list-cache.ts` + `src/handlers/read.ts` |
| Integration / BTP / CRUD tests | `tests/integration/adt.integration.test.ts`, `btp-abap[.smoke].integration.test.ts`, `crud-harness.ts` + `crud.lifecycle.integration.test.ts` |

## Deploying ARC-1 (not developing it)

If the task is "deploy/install ARC-1 for a team", you are an operator, not a contributor — do not edit
`src/`. Start at [docs_page/btp-overview.md](docs_page/btp-overview.md), then the runbook
[docs_page/btp-cloud-foundry-deployment.md](docs_page/btp-cloud-foundry-deployment.md); Docker/npx/stdio:
[docs_page/deployment.md](docs_page/deployment.md). On CF, config lives in `mta-overrides.mtaext`
`properties:`, never `.env`, and an extension can override a property but not remove one. Cockpit
destinations, role collections, Cloud Connector and SAP-side trust belong to other owners — hand off.
More traps: `docs/dev-guide.md#deployment-traps`.

## Engineering Playbook

- **Freeze the observable surface first.** The LLM-visible tool definitions are snapshotted in
  `tests/fixtures/tool-definitions/`; changing them takes `vitest -u` plus a reviewed fixture diff.
- **Security values ride REQUIRED parameters** (e.g. `cacheSecurity`), so a forgotten call site is a
  compile error, never an optional param that fails open.
- **Derive parallel lists from one table** (`tool-registry.ts`), and lower a size budget in the commit
  that shrinks the file. All seven practices: `docs/dev-guide.md` (Engineering playbook).
