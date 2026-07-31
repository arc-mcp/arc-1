# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working in this repository.
Single source of truth — `CLAUDE.md` imports this file. Keep it terse: task→files + ≤1 gotcha per
row; verbose details and live-verified behaviors live in [docs/dev-guide.md](docs/dev-guide.md)
(not auto-loaded — read the matching row there when working on one of these tasks).

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
7. **Single target by default; one experimental read-only BTP exception** — ADR-0005 remains the rule
   for writable/general multi-system access. ADR-0006 permits only the default-off BTP CF mode with
   explicit pinned/aggregate targets under its mutation-free safety contract. ADR-0007 permits the
   default-off shared Basic identity only under its one-instance/lockout controls. Do not broaden
   either exception to writes or another discovery/auth model without a new ADR/security review.

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

## Configuration (Priority: CLI > Env > .env > Defaults)

Copy `.env.example` to `.env`. Parser: `src/server/config.ts`; defaults: `src/server/types.ts`.
Full per-option details (defaults, clamps, layer interactions): [docs_page/configuration-reference.md](docs_page/configuration-reference.md).

| Variable / Flag | Description |
|-----------------|-------------|
| `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT` | SAP connection (client default 100) |
| `SAP_LANGUAGE` | Request language AND master language of created objects (default EN, #343) |
| `SAP_INSECURE` | Skip TLS verification (default false) |
| `SAP_TRANSPORT` | `stdio` (default) or `http-streamable` |
| `ARC1_PORT` / `ARC1_HTTP_ADDR` | HTTP port (8080) / full bind address |
| `ARC1_SERVER_NAME` / `--server-name` | Server name advertised in the MCP handshake (default `arc-1`); use a unique value per direct-connect instance |
| `SAP_ALLOW_WRITES` | Enable mutations (default false); prerequisite for transport/git writes |
| `SAP_ALLOW_DATA_PREVIEW` / `SAP_ALLOW_FREE_SQL` | TABLE_CONTENTS preview / freestyle SQL (default false) |
| `SAP_ALLOW_TRANSPORT_WRITES` / `SAP_ALLOW_GIT_WRITES` | Transport / git mutations (each ALSO needs `SAP_ALLOW_WRITES`) |
| `SAP_ALLOWED_PACKAGES` | Write allowlist (default `$TMP`): exact, `Z*`, `ZFOO/**` subtree, `*`. Enforced fail-closed on every mutation incl. activation, against the object's REAL package |
| `SAP_DENY_ACTIONS` | Per-action denial: `Tool`, `Tool.action`, `Tool.glob*` — see docs_page/authorization.md |
| `ARC1_API_KEYS` | `key:profile` pairs (viewer…admin); profile ∩ server ceiling |
| `SAP_OIDC_ISSUER` / `SAP_OIDC_AUDIENCE` | OIDC JWT validation |
| `ARC1_OAUTH_DCR_TTL_SECONDS` | DCR client_id lifetime (default `0` = no expiry; positive opts into expiry, clamped 60s–90d) |
| `ARC1_DCR_SIGNING_SECRET` | Dedicated HMAC secret so `cf deploy` doesn't invalidate cached client_ids |
| `ARC1_ALLOWED_ORIGINS` | CORS allowlist for browser MCP clients (empty = CORS off) |
| `ARC1_PUBLIC_URL` | Advertised OAuth-metadata URL when behind a reverse proxy |
| `SAP_BTP_SERVICE_KEY[_FILE]` / `SAP_BTP_OAUTH_CALLBACK_PORT` | BTP ABAP service key / OAuth callback port |
| `SAP_SYSTEM_TYPE` | `auto` (default), `btp`, `onprem` |
| `SAP_ABAP_RELEASE` | SAP_BASIS release override for abaplint (e.g. 758, 816); probe wins |
| `ARC1_TOOL_MODE` | `standard` (12 tools) or `hyperfocused` (1 tool, ~200 tokens) |
| `ARC1_SCHEMA_NULLABLE_OPTIONALS` | `auto`/`off`/`on` for optional `SAPWrite` schema null unions; default `auto` emits portable plain schemas, `on` is explicit OpenAI/Azure strict-mode compatibility (#360/#520) |
| `ARC1_PLUGINS` | FEAT-61 extensions: CSV of absolute LOCAL paths (`.js`/`.json`), NOT npm. Adds `Custom_*` tools (reads + gated non-ADT writes/execute) — docs_page/extensions.md |
| `SAP_ALLOW_PLUGIN_EXECUTE` | Opt-in (default false): let plugin tools execute ABAP console classes (`ctx.run.classRun`). ALSO needs `SAP_ALLOW_WRITES` + a `write`-scoped tool |
| `SAP_ALLOW_PLUGIN_RAW_WRITES` | Opt-in (default false): let plugin tools `ctx.http.post`/`put`/`delete` to **non-ADT** (OData/ICF) paths. ALSO needs `SAP_ALLOW_WRITES` + a `write`-scoped tool; `/sap/bc/adt/…` writes always refused |
| `SAP_ABAPLINT_CONFIG` / `SAP_LINT_BEFORE_WRITE` | Custom abaplint config / pre-write lint (default true) |
| `SAP_CHECK_BEFORE_WRITE` | SAP-side pre-write syntax check, non-blocking (default false) |
| `ARC1_CACHE[_FILE]` | Request-driven cache mode (auto/memory/sqlite/none) / SQLite file path |
| `ARC1_MAX_CONCURRENT` | Server-wide SAP request cap (default 10); size vs `rdisp/wp_no_dia` |
| `ARC1_AUTH_RATE_LIMIT` / `ARC1_MCP_HTTP_RATE_LIMIT` / `ARC1_RATE_LIMIT` | Per-IP OAuth cap (20/min), optional shared MCP HTTP/IP override (unset derives `max(OAuth×30,600)`; 0 disables), and per-user MCP cap (default 0 = off; ADR-0004) |
| `SAP_BTP_DESTINATION` / `SAP_BTP_PP_DESTINATION` | BTP Destination names (PP = PrincipalPropagation type) |
| `ARC1_MULTI_TARGET_ENDPOINTS` | Experimental/default-off BTP CF mode: marked subaccount destinations → mutation-free `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` plus `/multi/mcp`; requires XSUAA, cache none, standard tools, UI/plugins off; PP targets are strict. |
| `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` | Default false. Permits shared BasicAuthentication targets in multi mode; never PP fallback, credentials stay request-local, and v1 requires exactly one CF instance. |
| `SAP_PP_ENABLED` / `SAP_PP_STRICT` / `SAP_PP_ALLOW_SHARED_COOKIES` | Principal propagation + strict mode + cookie-coexistence escape hatch |
| `SAP_DISABLE_SAML` | Disable SAML redirect — never on BTP ABAP / S/4 Public Cloud |
| `ARC1_MINIMAL_ERRORS` | Hide SAP diagnostic details from client-facing tool errors; keep request correlation for operators |
| `ARC1_LOG_HTTP_DEBUG` | HTTP debug fields in audit; bodies are centrally redacted before sink writes |

## Codebase Structure

```
src/
├── index.ts                    # MCP server entry (bin: arc1)
├── cli.ts, cli-args.ts         # CLI entry (bin: arc1-cli)
├── extract-sap-cookies.ts      # Cookie helper (arc1-cli extract-cookies)
├── server/
│   ├── server.ts               # MCP server setup, tool registration
│   ├── config.ts, types.ts     # Config parser + ServerConfig defaults
│   ├── http.ts                 # HTTP auth + single-target, pinned, and aggregate routes
│   ├── destination-discovery.ts, destination-registry.ts # Secret-safe snapshot + immutable targets
│   ├── multi-target-destination-config.ts # Shared destination-property contract
│   ├── multi-target-identity.ts # Public target IDs, route aliases, and shared HTTP matchers
│   ├── multi-target-runtime.ts, multi-target-server.ts # Selected-identity runtime + request preparation
│   ├── multi-target-tools.ts, multi-target-catalog.ts # Mutation-free schemas + SAPTargets result
│   ├── multi-target-feature-state.ts # Per-target feature-probe flight coordination
│   ├── multi-target-shared-auth-state.ts # Process-wide Basic generation/lockout guard
│   ├── logger.ts               # Structured logger (stderr only, never stdout)
│   ├── audit.ts, sinks/        # Audit events + stderr/file/btp-auditlog sinks
│   ├── context.ts              # MCP context helpers
│   ├── xsuaa.ts                # XSUAA JWT validation (BTP); OAuth DCR store + proxy live in the @arc-mcp/xsuaa-auth dep
│   └── auth-rate-limit.ts, mcp-rate-limit.ts  # Rate-limit layers 1+2
├── handlers/                   # one module per tool (split from the former intent.ts monolith)
│   ├── dispatch.ts             # handleToolCall router + scope checks + LLM error formatting
│   ├── read.ts                 # SAPRead handler
│   ├── write.ts                # SAPWrite orchestrator → write/ package (create, update-delete, class-surgery, rap)
│   ├── search.ts, query.ts, activate.ts, navigate.ts, diagnose.ts, git.ts, transport.ts, context.ts, lint.ts, manage.ts
│   ├── object-types.ts         # type normalization, SLASH_TYPE_MAP/EVIDENCE, objectBasePath, LLM arg-stripping
│   ├── write-helpers.ts        # buildCreateXml, pre-write gates, server-driven write engine, package enforcement
│   ├── cds-hints.ts            # CDS dependency/impact hints + reserved-keyword guard
│   ├── tool-registry.ts        # SINGLE SOURCE of per-tool type tables ({type,btp} rows → derived ONPREM/BTP arrays)
│   ├── feature-cache.ts        # cached ADT discovery + features, keyed by target/destination (ALS fallback)
│   ├── cache-security.ts       # per-user cache isolation under principal propagation
│   ├── shared.ts               # ToolResult + textResult/errorResult
│   ├── tools.ts                # Tool definitions (JSON Schema the LLM sees)
│   ├── schemas.ts              # Zod v4 input schemas (runtime validation)
│   ├── zod-errors.ts           # Zod error formatting for LLM clients
│   └── hyperfocused.ts         # Hyperfocused mode (1 tool)
├── adt/                        # ADT client layer
│   ├── client.ts               # Facade (all read ops) | http.ts: transport, CSRF, cookies, sessions
│   ├── discovery.ts, features.ts, release.ts  # Endpoint MIME map, feature probes, release parsing
│   ├── errors.ts, safety.ts    # Typed errors + safety system (opt-ins, package gates, deny actions)
│   ├── crud.ts, devtools.ts    # lock/create/update/delete + syntax check/activate/publish/unit tests
│   ├── ddic-xml.ts, xml-parser.ts  # Create/update XML builders + response parsing (fast-xml-parser v5)
│   ├── gcts.ts, abapgit.ts     # Git backends | transport.ts: CTS management
│   ├── cds-impact.ts, rap-preflight.ts, rap-handlers.ts, rap-generate.ts  # CDS/RAP intelligence
│   ├── class-structure.ts      # Class-section surgery splice + diff (#303)
│   ├── server-driven.ts        # Server-driven objects (DESD/EVTB/DSFD/DTDC/… — AFF engine)
│   ├── oauth.ts, cookies.ts    # BTP OAuth (browser/PKCE) + cookie parsing (Destination Service lives in server.ts + @arc-mcp/xsuaa-auth)
│   ├── ui5-repository.ts, flp.ts    # UI5 ABAP Repository + FLP OData clients
│   └── authorization-trace.ts, diagnostics.ts, codeintel.ts # auth/ST22 traces + code intelligence
├── context/                    # deps.ts, cds-deps.ts, contract.ts, compressor.ts, method-surgery.ts, grep.ts
├── cache/                      # cache.ts, memory.ts, sqlite.ts, caching-layer.ts (ETag), inactive-list-cache.ts
├── aff/                        # validator.ts (Ajv 2020-12) + bundled AFF schemas/
├── probe/                      # ADT type-availability probe (catalog, runner, fixtures)
└── lint/                       # lint.ts (@abaplint/core), config-builder.ts, pre-write-hints.ts, presets/

scripts/ci/                     # check-file-sizes (ratchet), coverage/reliability reporting
tests/                          # helpers/ unit/ integration/ e2e/ fixtures/ (tool-definitions = LLM-surface snapshots)
```

## Key Files for Common Tasks

Terse routing only — full gotchas per row in [docs/dev-guide.md](docs/dev-guide.md).

| Task | Files (+ key gotcha) |
|------|------|
| Multi-target ADR-0006/0007 work | Read `docs/adr/0006-experimental-read-only-multi-target.md` and `docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md`, then the normative `docs/plans/destination-discovered-multi-target-v1.md`, `docs_page/multi-target-setup.md`, and `docs_page/multi-target-administration.md`; code is `src/server/{destination-discovery,destination-registry,multi-target-*,server,http}.ts`, `src/authz/policy.ts`, and `src/handlers/{dispatch,feature-cache}.ts`; focused tests are `tests/unit/server/{destination-discovery,destination-registry,multi-target-*,http-destinations,http-multi-target-routes,mta-descriptor}.test.ts`, `tests/unit/authz/policy.test.ts`, and `tests/unit/handlers/multi-target-errors.test.ts`. Keep the mutation-free boundary and explicit lint/transport action allowlists; ATC/Unit are workload-producing reads. Basic is default-off/shared/one-instance and never PP fallback. `SAPTargets` is aggregate-only. Real `sap-sysid`/`sap-client` remain mandatory. |
| Add new read operation | `src/adt/client.ts`, `src/handlers/read.ts`, `src/handlers/tools.ts` (+ `src/adt/xml-parser.ts`, `src/adt/types.ts` for structured) |
| Add ADT slash alias to `SLASH_TYPE_MAP` | `src/handlers/object-types.ts`, `tests/unit/handlers/slash-type-map.test.ts` — needs `docs/research/abap-types/types/<short>.md` evidence, verify live `<adtcore:type>` first (#218) |
| SAPWrite TABL subtype routing (TABL/DT vs /DS, #285) | `src/handlers/object-types.ts`, `src/handlers/write-helpers.ts`, `src/handlers/write/create.ts`, `src/handlers/{schemas,tools}.ts` — reads collapse to bare `TABL` |
| AUTH/FEATURE_TOGGLE/ENHO/VERSIONS/MSAG-style reads | `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/adt/types.ts`, `src/handlers/read.ts`, `src/handlers/{schemas,tools}.ts` |
| Add fix proposal / quickfix | `src/adt/devtools.ts`, `src/handlers/diagnose.ts`, `src/handlers/{schemas,tools}.ts`, tests |
| OData-based read (non-ADT) / FLP ops | `src/adt/ui5-repository.ts` → `src/handlers/read.ts` / `src/adt/flp.ts` → `src/handlers/manage.ts` |
| Package create/delete/move (DEVC) | `src/handlers/manage.ts`, `src/adt/ddic-xml.ts`, `src/adt/refactoring.ts`, `{schemas,tools}.ts` — BTP cloud create: `buildPackageXml({cloud})` nests under the structure `superPackage` + SC `ZLOCAL` + `responsible`=internal ABAP user (IAS email rejected by `SPAK_ST_PACKAGES`; auto-resolved from the createdBy of a prior cloud object create — no whoami endpoint). Details: docs/research/2026-06-27-btp-package-create-solved.md |
| API release write (`SAPManage set_api_state`) | `src/adt/client.ts` (`setApiReleaseState`) + `src/adt/xml-parser.ts` (`buildApiReleasePutBody`), `src/handlers/manage.ts` — GET→transform→PUT→GET `/apireleases/{uri}/{contract}`; PUT schema is a NARROW subset of the GET (drop atom:link/stateTransitions/transportObject/authValueObject) + needs `apiCatalogData/ApiCatalogs`; visibility taken VERBATIM from the contract's behaviour defaults (never invented/broadened) — ARC-1 does NOT pre-judge whether visibility is required (varies: C0/C1 need ≥1, C4 wants AMDP etc.), it sends defaults and lets SAP return the contract-accurate error; use v10 (v11 500s on 7.58). `contract` param C0–C4 (default C1) — types support different contracts (SRVD=C0-only, classic VIEW=C3-only; the matrix is per-release, so rely on the live `meta/supportedcontracts` + the not-available error which lists supported ones). Idempotent: SAP 400 "No changes were made" → `changed:false` no-op success |
| FUGR/FUNC write (#250) | `src/handlers/write.ts` + `write-helpers.ts` — FUNC bypasses `objectBasePath` (keep its throw); SAPGUI `*"…"*` blocks auto-stripped |
| Read FUNC processingType/updateTaskKind back | `src/adt/client.ts` (`getFunctionModuleProperties`), `src/adt/xml-parser.ts` (`parseFunctionModuleProperties`), `src/handlers/read.ts` (`includeSignature` branch) — the WRITE side lives in `src/handlers/function-processing.ts` + `write/create.ts`; this is the read-back only, and it reports SAP's value verbatim (incl. kinds the create enum omits, e.g. `collectiveRun`) |
| FUGR expanded read (`expand_includes`) | `src/adt/client.ts` (`getFunctionGroupExpanded`), `src/handlers/read.ts` — bodies live in nested LZ…U01 includes; dynpros NOT reachable via ADT |
| FUNC structured parameters (#252) | `src/adt/fm-signature.ts`, `src/handlers/write.ts`, `src/handlers/read.ts` — FUNC excluded from pre-write lint |
| CLAS include writes | `src/handlers/write/update-delete.ts`, `src/adt/crud.ts` (`safeUpdateClassInclude` POST-creates a missing include under the class lock) |
| CLAS text symbols read/write (`SAPRead include=text_symbols`, `SAPWrite action=edit_text_symbols`) | `src/adt/client.ts` (`get/writeClassTextSymbols`), `src/handlers/read.ts` (pre-switch CLAS branch — bypasses version/cache), `src/handlers/write/update-delete.ts` (`writeActionEditTextSymbols`), `{schemas,tools}.ts` — top-level `/sap/bc/adt/textelements/classes/{n}/source/symbols`; PUT needs Content-Type AND Accept `…symbols.v1`; lock the textelements object (not the class); immediately active (no SAPActivate); on-prem only, discovery-gated (absent on 7.50). Body: per-symbol `@MaxLength:NN` then `NNN=text`, blank-line separated. Selection texts are a program concept (classes have none → SAP 406) — deferred with programs. Details: docs/research/2026-07-02-class-text-symbols-textpool.md |
| FUGR structural-include write (FEAT-18 sibling) | `src/handlers/write.ts` (objectUrl branch: `type=INCL`+`group` → `/functions/groups/{grp}/includes/{inc}`, flows the generic `safeUpdateSource` path) — lock the INCLUDE not the group (group 423s the PUT); the include's `containerRef` carries the group package (fail-closed gate intact). Create/delete supported too: POST the group's `/includes` collection with CT `…functions.fincludes.v2+xml` (unversioned is refused); name must start with `L<GROUP>` or SAP 500s; SAP maintains the main program's INCLUDE line. Create gates `allowedPackages` on the GROUP's resolved package (the include inherits it and SAP ignores `_package`) — reuses `resolveFunctionGroupCreatePackage`, never `args.package` |
| Package listing (`SAPRead type=DEVC`) | `src/adt/client.ts` (`getPackageContents` — informationsystem/search GET, omits legacy SEGW types) |
| Transport history / create / TR_TARGET | `src/adt/transport.ts`, `src/handlers/transport.ts`, `src/authz/policy.ts` — only `/cts/transportrequests` sets the target, discovery-gated (7.58 yes, 7.50 no); `release`/`release_recursive` run a fail-fast `getInactiveObjects` pre-check (`inactiveObjectsForTransport`) AFTER the `checkTransport` write gate — inactive objects hang SAP's release pipeline; `create` always makes a Workbench (K) request (type is not a param; the package sets the target/layer, not the K/W category — live-verified) |
| gCTS / abapGit operation | `src/adt/gcts.ts` or `src/adt/abapgit.ts`, `src/handlers/git.ts`, `{schemas,tools}.ts` — abapGit payload/namespace/Accept must match abapGit's own ST transformations (the bridge 406s a wrong `Accept` and 400s a wrong root); never fixture it from another client: docs/research/2026-07-29-abapgit-adt-bridge-contract.md |
| RAP preflight / scaffolding / generate_behavior_implementation | `src/adt/rap-preflight.ts` + `src/handlers/write-helpers.ts` / `src/adt/rap-handlers.ts` + `src/handlers/write/rap.ts` (skeletons → CCIMP only, never CCDEF) / `src/adt/rap-generate.ts` |
| BDEF behavior EXTENSION create (`extend behavior for`) | `src/handlers/write/create.ts` (detect `extend behavior for X` → `baseBdef=X`) + `src/handlers/write-helpers.ts` (`buildCreateXml` BDEF emits `adtcore:adtTemplate(base_bdef)` BEFORE packageRef — trailing = ignored). Type stays BDEF/BDO; base must be `extensible`. Details: docs/research/2026-06-25-bdef-behavior-extension-create.md |
| Add new tool type | `src/handlers/tools.ts`, `src/handlers/schemas.ts`, `src/handlers/dispatch.ts` |
| Add/modify tool input schema | `src/handlers/schemas.ts` + `src/handlers/tools.ts` (three-file sync — see invariants) |
| Harden against GPT/OpenAI arg pollution (#360) | `src/handlers/object-types.ts` (`stripLlmEmptyValues`), `src/handlers/schemas.ts` — `looseOptionalBoolean` for EVERY optional boolean, never `z.coerce.boolean()` (maps "false"→true) |
| DDIC domain/data-element write | `src/adt/ddic-xml.ts`, `src/adt/crud.ts`, `src/handlers/write.ts` |
| TTYP (table type) read/write (FEAT-65) | `src/adt/ddic-xml.ts` (`buildTableTypeXml`/`parseTableType`), `src/handlers/write/create.ts` (POST creates a CHAR shell → follow-up PUT sets the real row type; `rowType`/`rowTypeKind` params), `src/adt/client.ts` (`getTableType`). TRAN write is NOT supported — `/sap/bc/adt/aps/iam/tran` is absent on 758/816/7.50 |
| Master language on create (#343) | `src/adt/ddic-xml.ts`, `src/handlers/write-helpers.ts`, `src/handlers/write/create.ts` — see docs/research/2026-06-04-issue-343-masterlanguage-on-create.md |
| ADT discovery / MIME types | `src/adt/discovery.ts`, `src/adt/http.ts` |
| SAP error classification + hints | `src/adt/errors.ts`, `src/handlers/dispatch.ts` — ground hints in verified SAP Notes; release-aware via `src/adt/release.ts` (#293) |
| Release-gated content-type fallback | `src/adt/crud.ts` (`CONTENT_TYPE_FALLBACKS` — narrow allowlist, 415-only retry) |
| Test skip reason | `tests/helpers/skip-policy.ts`, `tests/e2e/helpers.ts`, `docs/integration-test-skips.md`, `scripts/ci/summarize-skips.mjs` — keep all four in sync |
| Live ADT type probe | `scripts/probe-adt-types.ts` (`npm run probe`), `src/probe/`, `tests/unit/probe/replay.test.ts` |
| CDS impact classifier | `src/adt/cds-impact.ts`, `src/adt/codeintel.ts`, tests |
| Inactive syntax check / post-save check | `src/adt/devtools.ts`, `src/handlers/write-helpers.ts` (`tryPostSaveSyntaxCheck`) |
| Method-level surgery | `src/context/method-surgery.ts` — `<localclass>~<method>` specifiers; ambiguous bare names error |
| SAPRead `grep` (#313) | `src/context/grep.ts`, `src/handlers/read.ts` — rejects `grep`+`method` together |
| edit_method for CCDEF/CCIMP includes | `src/handlers/write/class-surgery.ts`, `src/handlers/schemas.ts` — auto-detect `lhc_*`/`lcl_*`→implementations, `ltc_*`→testclasses |
| Class-section surgery (#303) | `src/adt/class-structure.ts`, `src/adt/client.ts`, `src/adt/xml-parser.ts`, `src/handlers/write/class-surgery.ts` — client-side refuse-diff before PUT |
| SAPSearch tadir_lookup source variants | `src/handlers/search.ts`, `src/adt/client.ts`, `src/authz/policy.ts` — `db`/`both` escalate to sql scope |
| SAPQuery freestyle SQL hints + IN-list chunking | `src/handlers/{query,query-errors}.ts` — ABAP Open SQL uses `alias~field` + `ASCENDING`/`DESCENDING`; auto-chunk plain SELECTs only |
| batch_create `activateAtEnd` | `src/handlers/write/create.ts` — prefer for interdependent objects (one activator pass) |
| Hyperfocused mode | `src/handlers/hyperfocused.ts`, `src/handlers/tools.ts` |
| ATC run (`SAPDiagnose action=atc`) | `src/adt/devtools.ts` (`runAtcCheck`) — three-step flow; variant MUST bind at worklist creation; ATC skips `$TMP` (details: dev-guide) |
| CDS test-case suggestions (8.16+) | `src/adt/devtools.ts`, `src/handlers/diagnose.ts` — discovery-gated, read-only |
| Server-driven objects read/write (DESD/EVTB/DSFD/…) | `src/adt/server-driven.ts` (`SDO_TYPES` + `SDO_REGISTRY` — the SAPRead/SAPWrite table rows derive from the tuple; `sourceFormat` is per-type: `text` for DTSC/DSFD/DTDC, `json` for the rest — wrong one = hard 415; DTDC is the first NON-blue type — metadata root/ns/marker are per-entry (`metadataRootQName`/`metadataNamespace`/`discoveryMarker`), blue family shares the `BLUE_METADATA` spread), `src/handlers/read.ts` + `write.ts`/`write-helpers.ts` early branches — per-type/release-adaptive gates; EVTO=v2 content type (details: dev-guide) |
| XML response parser / safety check | `src/adt/xml-parser.ts` / `src/adt/safety.ts` |
| PrettyPrint / lint rules / pre-write hints | `src/handlers/lint.ts` + `src/adt/devtools.ts` / `src/lint/{lint,config-builder}.ts` + presets/ / `src/lint/pre-write-hints.ts` |
| abaplint beyond its grammar ceiling (8xx) | `src/adt/features.ts` (`ABAPLINT_MAX_RELEASE`), `src/lint/config-builder.ts` — parser errors demoted to warnings when release > 758 |
| Dependency / CDS-dep / contract / compressor | `src/context/{deps,cds-deps,contract,compressor}.ts` |
| Runtime + source-state diagnostics | `src/adt/diagnostics.ts`, `src/handlers/diagnose.ts`, `{schemas,tools}.ts` |
| Authorization trace (`SAPDiagnose authorization_trace`) | `src/adt/authorization-trace.ts` (`getAuthorizationTrace`/`decodeAuthTraceRows`), `diagnostics.ts` re-export, `diagnose.ts`, `{schemas,tools}.ts`, `policy.ts` — data scope + `SAP_ALLOW_DATA_PREVIEW`; on-prem `SUAUTHVALTRC` via `runTableQuery`, TOBJ decode, client-side sort; not SU53/STAUTHTRACE (details: `docs/research/2026-07-09-su53-authorization-analysis-adt-surface.md`) |
| OData/SQL perf insight (`SAPDiagnose odata_perf`/`cds_sql`) + ICF-inactive guard | `src/adt/diagnostics.ts` (`probeODataPerformance`/`verdictFromStatistics`, `getCdsCreateStatements`/`parseCdsCreateStatements`), `diagnose.ts`, `{schemas,tools}.ts`, `policy.ts`, `errors.ts` (`icf-service-inactive` = 403 "Service cannot be reached" HTML) — odata_perf=data scope (host-relative path only, SSRF guard; `gwhub`→framework on 7.50); `cds_sql` POST createstatements + CSRF + `Accept: …ddl.createStatements+xml`; `statement` is an ARRAY_TAG (read `node.statement` as array). Verified 750/758/816 |
| ST05 SQL-trace control (`SAPDiagnose sql_trace_state`/`set_sql_trace_state`/`sql_trace_directory`) | `src/adt/diagnostics.ts` (`getSqlTraceState`/`setSqlTraceState`/`getSqlTraceDirectory` + `parseSqlTraceState`/`parseSqlTraceDirectory`), `diagnose.ts`, `{schemas,tools}.ts`, `policy.ts` — `set`=write/Update GET→edit-raw-XML→PUT `/st05/trace/state` (CT `…perf.trace.state.v1+xml`, flips ALL instances); `sql_trace_directory` returns SAP's TMC deep-link (no ADT SQL-record API). ADT-native record reader = Cross Trace `/sap/bc/adt/crosstrace/*` (follow-up; present on 758, request types incl. OData V4). Verified 758 |
| Audit logging / new audit event type | `src/server/audit.ts` (typed `*Event` union; emit via `logger.emitAudit`), `src/server/sinks/` |
| Trace context / agent attribution | `src/server/trace-context.ts` (validators), `src/server/{context,http}.ts`, `src/handlers/dispatch.ts`, `src/adt/http.ts` (`doFetch` = the one outbound injection point) — ARC-1 forwards `traceparent` verbatim and NEVER originates one (W3C non-participating pass-through); `clientAgent` falls back to `User-Agent` because stateless HTTP makes `getClientVersion()` always undefined. Rationale: docs/research/2026-07-30-sap-architecture-center-mcp-alignment.md |
| Rate limiting (3 layers) | `src/server/auth-rate-limit.ts` / `src/server/mcp-rate-limit.ts` + `src/handlers/dispatch.ts` / `Semaphore` in `src/adt/http.ts` — docs/adr/0004 |
| Release npm SBOM | `.github/workflows/release.yml` (`publish-npm-sbom`), `tests/unit/server/release-sbom-workflow.test.ts`, `docs_page/security-guide.md` — production lockfile graph only; keep the job non-gating with job-level `continue-on-error: true`, check out the release tag, pin npm to `publish-npm`, validate version/shape, and never use destructive asset replacement |
| Dependabot / npm-audit / container scanning / action pinning | `.github/dependabot.yml` / `.github/workflows/{test,dependency-review,docker,release,security-scan}.yml` — third-party actions SHA-pinned with trailing tag comment |
| CLI sub-command | `src/cli.ts`, `src/cli-args.ts` — never duplicate Zod validation; `handleToolCall` does it |
| SAP version-quirk workaround | `src/adt/errors.ts` (`extractExceptionType` preferred); body-marker heuristics only with a release-scoped guard (ADR-0002) |
| Activation batch ED064 recovery | `src/adt/devtools.ts` (`activateBatch`) — pure ED064 retried once as singles; mixed real errors must NOT retry |
| Plugin elicitation (`ctx.elicit`) / XSUAA / OIDC / DCR store | `src/server/plugin-loader.ts` (`buildMcpCapabilities` — only live elicitation path; core tools use the config safety ceiling, not interactive prompts) / `src/server/xsuaa.ts` / `src/server/http.ts` / DCR store + OAuth proxy in the `@arc-mcp/xsuaa-auth` dep (revocation = rotate `ARC1_DCR_SIGNING_SECRET` or rebind XSUAA; `KDF_LABEL` bump lives in the package) |
| Scope enforcement / auth scopes | `src/authz/policy.ts` (`ACTION_POLICY`), `src/handlers/dispatch.ts`, `src/server/server.ts`, `xs-security.json` |
| Auth combination rule | `src/server/config.ts` (`validateConfig`), `src/server/types.ts`, `docs_page/enterprise-auth.md` |
| Layer B auth mechanism | `src/adt/http.ts` (`applyAuthHeader` — Basic / `samlAuthorization`→`Authorization`+`x-sap-security-session:create`), `src/server/server.ts` (`applyPerUserAuthTokens` sets PP creds incl. SAMLAssertion for S/4HC; `buildAdtConfig` perUser flag — strips shared creds). New Layer B field must also be mapped in `src/adt/client.ts` httpConfig + set only per-user |
| Safety config option | `src/adt/safety.ts`, `src/server/config.ts`, `src/server/types.ts` |
| AdtClient instance field / `withSafety()` clone | `src/adt/client.ts` — clone is `Object.assign(Object.create(proto), this, {safety})`; new own fields share automatically (use TS `private`, never `#private`) (#333) |
| `allowedPackages` pattern syntax | `src/adt/safety.ts`, `src/adt/package-hierarchy.ts`, `src/handlers/write-helpers.ts` (`enforceAllowedPackageForObjectUrl`, fail-closed) — details: dev-guide |
| Feature probe / feature-gated write guard | `src/adt/features.ts` (`PROBES`) / `src/handlers/write/rap.ts` pattern |
| E2E test / fixture | `tests/e2e/`, `tests/e2e/fixtures.ts` + `tests/fixtures/abap/` + `tests/e2e/setup.ts` |
| Source caching / ETag / inactive drafts | `src/cache/caching-layer.ts` + `src/cache/*`, `src/cache/inactive-list-cache.ts` + `src/handlers/read.ts` |
| Integration / BTP / CRUD tests | `tests/integration/adt.integration.test.ts`, `btp-abap[.smoke].integration.test.ts`, `crud-harness.ts` + `crud.lifecycle.integration.test.ts` |
| BTP auth / Destination Service | `src/adt/oauth.ts` (browser OAuth) + `src/server/server.ts` (`buildAdtConfig` per-user destination) + `@arc-mcp/xsuaa-auth` dep |
| AFF schema / validation | `src/aff/schemas/` + `src/aff/validator.ts` / `src/handlers/write/create.ts` (create/batch_create paths) |
| CI coverage / reliability reporting | `scripts/ci/coverage-summary.mjs`, `scripts/ci/collect-test-reliability.mjs`, `.github/workflows/test.yml` |

## Architecture: Request Flow

1. **Transport** (`src/server/http.ts` or stdio; stdio has no auth).
2. **Auth** (HTTP): XSUAA → OIDC JWT → API key → `AuthInfo { scopes, clientId?, userName? }`.
3. **SAP client** (`src/server/server.ts`): normally `ppEnabled` + JWT → per-user SAP session; ADR-0007 multi-target Basic resolves one request-local shared credential behind the process guard.
4. **`handleToolCall`** (`src/handlers/dispatch.ts`): arg normalization (`stripLlmEmptyValues`) → scope check (`ACTION_POLICY`) → Zod validation → per-tool handler → package check for writes. Source reads consult the inactive-list + ETag source cache.
5. **ADT client** (`src/adt/{client,crud,devtools}.ts`): every endpoint behind `checkOperation(safety, …)`.
6. **HTTP** (`src/adt/http.ts`): MIME negotiation, conditional GET, CSRF auto-refresh, 406/415 one-retry, cookie hot-reload, stateful lock→modify→unlock sessions.
7. **SAP**: native auth (`S_DEVELOP`, `S_ADT_RES`, `S_TRANSPRT`).

**Key invariant:** scope ∧ safety ∧ SAP auth — all must pass.

## Authorization & Safety

- **Safety ceiling** (`src/adt/safety.ts`, startup): `allow*` flags + `allowedPackages` + `allowedTransports` + `denyActions`. ALL ADT endpoints go through `checkOperation()`; `OperationType` is internal-only.
- **Scopes** (`src/authz/policy.ts`): `read`/`write`/`data`/`sql`/`transports`/`git`/`admin` (`admin` ⊇ all, `write` ⊇ `read`, `sql` ⊇ `data`). `ACTION_POLICY` maps `(tool, action/type) → scope` — single source for runtime checks + tool-list pruning. Stdio skips scopes.
- **Principal propagation**: JWT → per-user SAP session; ARC-1 scopes stay enforced as defense-in-depth.
- **Multi-target Basic exception**: XSUAA identifies the human, but SAP sees one shared technical user. It is default-off, mutation-free, one-instance, request-local-secret, and process-guarded per ADR-0007.
- **ADT POSTs that look like reads** (where-used, completion, syntax check, ATC, table preview, …): read-only SAP users need `S_ADT_RES` with `ACTVT=01 AND 02`.

## Code Patterns

```typescript
// ADT client method — safety guard first, always
async getProgram(name: string, opts: SourceReadOptions = {}): Promise<SourceReadResult> {
  checkOperation(this.safety, OperationType.Read, 'GetProgram');
  return this.fetchSource(`/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`, opts);
}

// Handler case (per-tool module, e.g. read.ts)
case 'PROG':
  return textResult((await client.getProgram(name)).source);

// CRUD: lock → modify → unlock inside a stateful session
await http.withStatefulSession(async (session) => {
  const lock = await lockObject(session, objectUrl);   // returns { lockHandle, corrNr }
  try {
    await updateSource(session, safety, sourceUrl, source, lock.lockHandle, transport ?? lock.corrNr || undefined);
  } finally {
    await unlockObject(session, objectUrl, lock.lockHandle);
  }
});
```

## Testing

Every code change requires tests. Skip taxonomy: `docs/testing-skip-policy.md`.

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
- The LLM-visible tool surface is frozen by `tests/fixtures/tool-definitions/*.json` (see Playbook §1).

## Style, Stack & Releasing

- **ESM-only**: local imports need `.js` extensions. **TypeScript strict** (noUnusedLocals/Parameters, Node16 resolution). **Biome**: 2-space, single quotes, 120 cols — auto-fixed on commit, never hand-format.
- **Logging to stderr only** (`src/server/logger.ts`); `console.log` corrupts MCP JSON-RPC on stdout.
- Stack: TypeScript 6.0, Node 22+, `@modelcontextprotocol/sdk`, `@abaplint/core`, `undici`, `fast-xml-parser` v5, `better-sqlite3`, `commander`, `ajv` (2020-12), `zod` v4, `vitest`, `biome`.
- **Releasing** ([release-please](https://github.com/googleapis/release-please)): `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major; `refactor:`/`test:`/`docs:`/`chore:`/`ci:` → **no release** (use these for behavior-preserving PRs). Version lives in `package.json` + `src/server/server.ts` `VERSION` (the `x-release-please-version` marker — never bump by hand). npm publishes via OIDC trusted publishing.

## Security & Architectural Invariants

- **Threat model + the 7 security invariants + per-PR review checklist + residual-risk register live in [docs/security-model.md](docs/security-model.md)** (review narrative + remediation roadmap in [docs/security-review-2026-06.md](docs/security-review-2026-06.md)). Read it before touching auth, the safety ceiling, caches, audit sinks, or any arg→URL/SQL/XML sink.
- **stdout is sacred** — MCP JSON-RPC only; all logging to stderr.
- Never commit `.env`, `cookies.txt`, `.arc1.json`; sensitive fields are redacted in logs.
- **Safety config is the server ceiling** — per-user scopes only restrict.
- **Multi-system boundary** — single target remains the default and all writable multi-system access
  stays out of scope under ADR-0005. ADR-0006 is the sanctioned experimental, default-off, BTP/XSUAA,
  mutation-free exception for pinned and aggregate endpoints. Principal Propagation remains recommended;
  ADR-0007 permits only an explicit, default-off shared Basic identity under its mutation-free, one-instance
  controls and never as a PP fallback. Follow both normative plans exactly; do not add writes,
  target-specific roles, another discovery/auth model, or a hidden compatibility mode. Route requirements
  outside those boundaries to the
  [MCP hub](https://github.com/arc-mcp/mcp-hub) or a new ADR/security review.
- **Per-user auth never inherits shared credentials** — `buildAdtConfig(..., { perUser: true })` strips username/password/cookies; any new Layer B field must respect the flag.
- **All ADT endpoints have safety guards** — no unguarded `http.{get,post,put,delete}`.
- **Cookie hot-reload**: `SAP_COOKIE_FILE` re-read before the 401 retry, and again on the next request after a persistent 401; `SAP_COOKIE_STRING` cannot hot-reload.
- **Error types**: `AdtApiError` / `AdtSafetyError` / `AdtNetworkError`; `dispatch.ts` formats them with LLM-friendly hints.
- **Stateful sessions** for lock→modify→unlock; CSRF auto-managed (`src/adt/http.ts`).
- **ADT locks never cross an MCP round-trip** — `lock→modify→unlock` completes inside ONE synchronous tool call; never elicit inside a lock block, never expose writes as async MCP Tasks holding a lock ([ADR-0006](docs/adr/0006-mcp-legacy-era-until-triggers.md)).
- **Tool schema three-file sync** — every property must exist in `tools.ts` (JSON Schema → visible to LLMs), `schemas.ts` (Zod), and the per-tool handler. `batch_create` item schemas are separate from the top-level schema — update both.
- **MTA layout** — `mta.yaml` committed (safe defaults); `mta-overrides.mtaext` gitignored.

## Engineering Playbook (proven in the 2026-06 handler consolidation)

Hard-won practices from a 40-commit, behavior-preserving refactor (intent.ts 8.2K lines → per-tool
modules; write.ts 2K → write/ package) — apply to any sizeable change:

1. **Freeze the observable surface FIRST.** Snapshot what users/LLMs actually see — here the tool-definition JSON (`tests/fixtures/tool-definitions/`, locked by `tool-definitions-snapshot.test.ts`) — and require byte-identical fixtures through every commit. Changing them takes `vitest -u` + a reviewed fixture diff.
2. **Move-only refactors.** Relocate code verbatim; park every improvement as a follow-up. Verify each step with the full gate (`npm test`, `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes`) and commit small.
3. **Make invariants true by construction.** Derive parallel lists from one annotated table (`tool-registry.ts` `*_TYPE_TABLE`); re-export shared constants instead of copying. A consolidation that leaves one copy alive recreates the drift it was meant to kill (schema-accepted-but-runtime-rejected).
4. **Security values ride REQUIRED parameters.** `cacheSecurity` is required through the handler chain, so a forgotten call site is a compile error — never an optional param that silently fails open.
5. **Guard the guards.** Ratchets must fail on their own staleness: `scripts/ci/check-file-sizes.mjs` fails CI on a dangling BUDGETS key (a rename would otherwise silently 18× a budget). Lower budgets in the same commit that shrinks a file.
6. **Bound automated codemods.** A scripted cleaner may only edit the region it understands (e.g. the top-of-file import block). A whole-file `name,`-line stripper once corrupted call bodies that shared a name with an unused import — typecheck caught it; the rewrite refuses to touch code bodies.
7. **Keep this file terse.** Task→files + ≤1 gotcha per row here; full detail goes to `docs/dev-guide.md` (read on demand, not loaded every session).

## History

Migrated from Go to TypeScript on 2026-03-26. Handler monolith split into per-tool modules 2026-06
(see `docs/plans/completed/2026-06-11-architecture-consolidation-progress.md`).
