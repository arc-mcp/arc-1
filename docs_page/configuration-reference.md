# Configuration Reference

Every environment variable and CLI flag that ARC-1 reads, grouped by what it configures and what it actually does at runtime.

This page is the flat reference. For the mental model (three-layer authorization, scope semantics), start with [Authorization & Roles](authorization.md). For *where values come from* across `npx` / local / Docker / BTP, see [Configuration Precedence](configuration-precedence.md).

The full grouped template with inline commentary is [`.env.example`](https://github.com/marianfoo/arc-1/blob/main/.env.example).

---

## Sections

1. [How values are resolved](#how-values-are-resolved) — precedence summary
2. [SAP connection](#sap-connection) — URL, client, language, TLS, system type, ABAP release
3. [Authentication](#authentication) — Layer B (ARC-1 → SAP) and Layer A (MCP Client → ARC-1)
4. [Authorization and safety](#authorization-and-safety) — what tool calls are allowed
5. [Server runtime](#server-runtime) — transport, bind address, CORS, concurrency
6. [Caching](#caching) — source cache, warmup
7. [Logging and observability](#logging-and-observability) — log file, level, format, HTTP debug
8. [ABAP feature toggles](#abap-feature-toggles) — abapGit, gCTS, RAP, AMDP, UI5, HANA, FLP
9. [Code-quality gates](#code-quality-gates) — pre-write lint/check, abaplint config, tool mode

---

## How values are resolved

```
CLI flag   >   process.env   >   .env file (in CWD)   >   built-in default
```

`process.env` covers shell exports, `docker run -e`, `cf set-env`, and the `env` block in mcp.json (because that block becomes the environment of the subprocess the MCP client spawns). `.env` is loaded via dotenv and **only fills in keys that aren't already set** — it never overrides existing env values.

For the full per-deployment-mode breakdown (npx vs local vs Docker vs BTP, and the gotcha where mcp.json `env` does nothing for `url`-based remote connections), see [Configuration Precedence](configuration-precedence.md).

**Boolean values.** Most boolean flags accept either `"true"` or `"1"`. One exception: `ARC1_LOG_HTTP_DEBUG` accepts only `"true"` ([known inconsistency](#logging--observability)).

**Comma-separated lists.** `SAP_ALLOWED_PACKAGES`, `SAP_ALLOWED_TRANSPORTS`, `SAP_DENY_ACTIONS`, and `ARC1_ALLOWED_ORIGINS` are split on `,` and `.trim()`-ed. Quote shell-sensitive entries (`*`, `$TMP`, glob characters): `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. In `.env` files no extra quoting is needed.

---

## SAP connection

The bare minimum needed to reach a SAP system. None of these affect what tool calls are allowed — that's the [Authorization and safety](#authorization-and-safety) section.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--url` | `SAP_URL` | — (required) | Base URL ARC-1 uses for every ADT call. Include the scheme and port (e.g. `https://host:44300`). Required unless you use a BTP Destination or service key, which supply the URL. |
| `--client` | `SAP_CLIENT` | `100` | Logon client number. Sent as `sap-client` in every ADT request and as the `client` field during authentication. Wrong value → "Logon not possible (incorrect client)". |
| `--language` | `SAP_LANGUAGE` | `EN` | SAP logon language. Affects message texts, DDIC short descriptions, and any other language-dependent server response. |
| `--insecure` | `SAP_INSECURE` | `false` | When `true`, skips TLS certificate verification on the SAP HTTP client. **Dev only** — masks man-in-the-middle attacks and corp-CA misconfiguration in production. |
| `--system-type` | `SAP_SYSTEM_TYPE` | `auto` | Forces ARC-1's release/feature gating to behave as if the target is `btp` (Steampunk/Public Cloud) or `onprem`. `auto` (default) lets ARC-1 detect via probes. Override when auto-detection is wrong (e.g. mirrored systems). |
| `--abap-release` | `SAP_ABAP_RELEASE` | — | Manual `SAP_BASIS` release override for local tooling that needs a release number (e.g. abaplint's syntax-feature gating). Example: `758` for S/4HANA 2023. ARC-1's runtime probe still wins when available — this is the fallback. |

### TLS / proxy notes

ARC-1 uses [undici](https://github.com/nodejs/undici) for all SAP HTTP. It respects standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` env vars. For custom CA certificates, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` (read by Node, not by ARC-1 directly). For Docker mounts of CA bundles, see [docker.md](docker.md#self-signed-or-internal-ca-certificates).

---

## Authentication

ARC-1 has two independent authentication boundaries:

- **Layer B** — how ARC-1 itself authenticates to SAP (cookies, basic auth, OAuth, principal propagation…).
- **Layer A** — how MCP clients authenticate to ARC-1 (none for stdio, API key / OIDC / XSUAA for HTTP).

The full coexistence matrix is in [enterprise-auth.md](enterprise-auth.md#coexistence-matrix). Below is what each env var does.

### Layer B — ARC-1 → SAP

Pick one primary method. Combining methods that conflict (e.g. basic + cookies + PP) fails fast at startup unless an escape-hatch flag is set.

#### B1. Basic auth

| Flag | Env var | Effect |
|---|---|---|
| `--user` | `SAP_USER` | Username sent in `Authorization: Basic` on every ADT request. With `SAP_PP_ENABLED=true`, this becomes the *fallback* technical user used only when per-user PP is unavailable. |
| `--password` | `SAP_PASSWORD` | Password for the above. Redacted from all logs. |

#### B2. Cookie auth (dev-only SSO bridge)

| Flag | Env var | Effect |
|---|---|---|
| `--cookie-file` | `SAP_COOKIE_FILE` | Netscape-format cookie jar. ARC-1 sends these cookies on every SAP request. **Hot-reloaded**: when a request returns 401 after the standard session-reset retry, the jar is cleared and the file is re-read on the next request — no restart needed. |
| `--cookie-string` | `SAP_COOKIE_STRING` | Inline cookies (`k=v; k2=v2`) read once at startup. **Cannot hot-reload** — restart with a new value or switch to `SAP_COOKIE_FILE`. |

Cookie auth is not for production. See [local-development.md → SSO cookie extractor](local-development.md#sso-only-on-prem-cookie-extractor). On startup, the auth preflight is non-blocking when `SAP_COOKIE_FILE` is set, so the server starts even if cookies are about to be re-extracted out-of-band. Per-user PP clients never inherit cookie state — `cookieFile`/`cookieString` are stripped from per-user configs.

#### B3. BTP ABAP Environment (direct OAuth)

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--btp-service-key-file` | `SAP_BTP_SERVICE_KEY_FILE` | — | Path to a BTP ABAP service key JSON. ARC-1 reads `url` and `uaa` from it and performs an OAuth 2.0 Authorization Code flow on first use (browser opens). |
| `--btp-service-key` | `SAP_BTP_SERVICE_KEY` | — | Same as above but inline JSON. Useful when the key can't live on disk (e.g. CF deploys via `cf set-env`). |
| `--btp-oauth-callback-port` | `SAP_BTP_OAUTH_CALLBACK_PORT` | `0` (auto) | Local TCP port the OAuth callback listener binds to. `0` picks any free port. Pin it when you need a fixed redirect URI registered in BTP. |

Full reference: [btp-abap-environment.md](btp-abap-environment.md).

#### B4. BTP Destination Service

| Env var | Effect |
|---|---|
| `SAP_BTP_DESTINATION` | Name of the BTP Destination ARC-1 reads to obtain SAP URL + credentials. Used for the shared technical client and as a fallback for per-user PP. Bypasses `SAP_URL` / `SAP_USER` / `SAP_PASSWORD` — those are ignored when a destination is set. |
| `SAP_BTP_PP_DESTINATION` | Destination of type `PrincipalPropagation`. When set, per-user PP requests use this; when unset, ARC-1 falls back to `SAP_BTP_DESTINATION`. Set this when shared and PP traffic must route via different destinations (different Cloud Connector subaccount mapping, different authorization model, etc.). |

Full reference: [btp-destination-setup.md](btp-destination-setup.md).

#### B5. Principal Propagation

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--pp-enabled` | `SAP_PP_ENABLED` | `false` | Enables per-user identity to SAP: incoming JWT `email`/`user_name` is used to mint a per-user SAP session via BTP Destination Service. Without PP, every SAP call uses the shared technical user. |
| `--pp-strict` | `SAP_PP_STRICT` | `false` | When PP fails (token mapping missing, destination unavailable), `false` falls back to the shared technical client. `true` returns an error to the MCP caller — no shared-client fallback. Production should use `true`. |
| `--pp-allow-shared-cookies` | `SAP_PP_ALLOW_SHARED_COOKIES` | `false` | Escape hatch. Without it, setting `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` together with `SAP_PP_ENABLED=true` fails at startup (cookies belong to one user, PP wants per-user). With `true`, cookies stay on the shared client only and PP traffic runs cookie-free. |

Full reference: [principal-propagation-setup.md](principal-propagation-setup.md).

#### Layer B extras

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--disable-saml` | `SAP_DISABLE_SAML` | `false` | Emits `X-SAP-SAML2: disabled` header + `?saml2=disabled` query on every ADT request (SAP Note 3456236). Stops on-prem systems from redirecting to SAML IdP when Basic Auth is intended. **Breaks BTP ABAP Environment and S/4 Public Cloud — only enable for on-prem with SAML enforcement.** |

### Layer A — MCP Client → ARC-1

These only apply to HTTP transport. Stdio has no authentication boundary — the client *is* the spawner.

Methods chain: any combination of API Key + OIDC + XSUAA is valid and active simultaneously.

#### A1. No auth

Set nothing. Stdio only. Anyone who can pipe stdin to the process is "authenticated" by being the spawner.

#### A2. API Key(s)

| Flag | Env var | Effect |
|---|---|---|
| `--api-keys` | `ARC1_API_KEYS` | Comma-separated `key:profile` pairs. Each profile maps to a scope set (read/write/data/sql/transports/git/admin) **and** a partial SafetyConfig intersected with the server ceiling. Valid profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. Caller sends `Authorization: Bearer <key>` (or `X-API-Key: <key>`); ARC-1 looks the key up and applies that profile's scopes for the request. |

Full reference: [api-key-setup.md](api-key-setup.md). The single-key `ARC1_API_KEY` env var was removed in v0.7 — see [updating.md](updating.md#v07-authorization-refactor-breaking-change).

#### A3. OIDC / JWT

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--oidc-issuer` | `SAP_OIDC_ISSUER` | — | OIDC issuer URL (e.g. Entra ID, Auth0). ARC-1 fetches JWKS from `{issuer}/.well-known/openid-configuration` and validates incoming JWTs against it. |
| `--oidc-audience` | `SAP_OIDC_AUDIENCE` | — | Expected `aud` claim. Tokens whose `aud` doesn't match are rejected. |
| `--oidc-clock-tolerance` | `SAP_OIDC_CLOCK_TOLERANCE` | `0` | Seconds of clock skew tolerated when checking `exp`/`nbf`/`iat`. Set 30–60 if your auth server and ARC-1 host clocks drift. |

Full reference: [oauth-jwt-setup.md](oauth-jwt-setup.md).

#### A4. XSUAA OAuth (BTP)

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--xsuaa-auth` | `SAP_XSUAA_AUTH` | `false` | When `true`, ARC-1 reads XSUAA credentials from `VCAP_SERVICES`, validates incoming JWTs against XSUAA's keys, and exposes RFC 9449 OAuth metadata + Dynamic Client Registration endpoints. Required for BTP CF deployments. |
| `--oauth-dcr-ttl-seconds` | `ARC1_OAUTH_DCR_TTL_SECONDS` | `2592000` (30d) | Lifetime of a dynamically-registered OAuth `client_id` (Anthropic-style stateless DCR). Lower it to bound blast radius if the signing key leaks; raise it to reduce re-auth churn for long-lived agents. Clamped to `[60, 7776000]` (1 min – 90 d). Only consulted when XSUAA auth is on. |

Full reference: [xsuaa-setup.md](xsuaa-setup.md).

---

## Authorization and safety

ARC-1 starts **fully restrictive**. Every capability below is a positive opt-in. Per-user scopes (from JWT or API-key profile) can only restrict further — they never expand beyond what these flags allow. This is the server ceiling.

!!! warning "Two flags sit outside the SAP API Policy FAQ envelope"
    The April 2026 [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html) endorses ADT-based developer tooling, but excludes "programmatic reading of application tables or export of business data" and "SQL execution against SAP backend systems". `SAP_ALLOW_DATA_PREVIEW` and `SAP_ALLOW_FREE_SQL` map directly onto these excluded capabilities — that's why they're off by default and gated behind explicit env vars. Keep them off on systems where you want to stay aligned with the FAQ. See [authorization.md](authorization.md#sap-api-policy-data-preview-and-free-sql-are-gated-for-a-reason).

### Capability flags

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--allow-writes` | `SAP_ALLOW_WRITES` | `false` | Master switch for every mutation: `SAPWrite` (create/update/delete), `SAPActivate`, package CRUD, FLP mutations. When `false`, every mutating tool call is rejected at the safety layer regardless of caller scopes. Also required (in addition to the specific flag below) for transport and git writes. |
| `--allow-data-preview` | `SAP_ALLOW_DATA_PREVIEW` | `false` | Enables `SAPRead(type=TABLE_CONTENTS)`. When off, that one read action is rejected — every other SAPRead type still works. |
| `--allow-free-sql` | `SAP_ALLOW_FREE_SQL` | `false` | Enables `SAPQuery` (freestyle ABAP SQL via `/sap/bc/adt/datapreview/freestyle`). When off, `SAPQuery` is rejected. |
| `--allow-transport-writes` | `SAP_ALLOW_TRANSPORT_WRITES` | `false` | Enables `SAPTransport.create` / `release` / `delete` / `reassign`. **Requires `SAP_ALLOW_WRITES=true`** — without it, transport mutations fail even with this flag on, because users without `write` scope are treated as no-mutation users. Transport *reads* (list / get / check / history) are always available. |
| `--allow-git-writes` | `SAP_ALLOW_GIT_WRITES` | `false` | Enables `SAPGit.clone` / `pull` / `push` / `commit` against gCTS and abapGit. Same `SAP_ALLOW_WRITES` precondition as transport writes. Git reads always available. |
| `--allowed-packages` | `SAP_ALLOWED_PACKAGES` | `$TMP` | Glob allowlist for **writes only**. Comma-separated, supports `Z*` / `Y*` / `/COMPANY/*` prefix wildcards, and `*` for unrestricted. Writes to a package outside this list fail at the safety layer. **Reads are never package-gated.** |
| `--allowed-transports` | `SAP_ALLOWED_TRANSPORTS` | `[]` | Advanced: specific CTS transport ID whitelist. Empty (default) = no per-transport filter. |
| `--deny-actions` | `SAP_DENY_ACTIONS` | `[]` | Fine-grained per-action denylist. Grammar: `Tool`, `Tool.action`, `Tool.glob*`. Example: `SAPWrite.delete,SAPManage.flp_*`. Accepts a CSV string or a `path/to/file.json` containing an array. Denylisted actions are both hidden from tool listings and blocked at call time. See [authorization.md → Advanced deny actions](authorization.md#advanced-deny-actions). |
| `--check-before-write` | `SAP_CHECK_BEFORE_WRITE` | `false` | When `true`, ARC-1 runs an ADT server-side `checkruns` syntax check before save. Warnings are appended to the response (non-blocking); errors still fail. Adds one round-trip per write. Activation remains the definitive check — this is an early-feedback option. |

### Recipes

| Goal | Set these flags |
|---|---|
| Read/search only (default) | nothing |
| Read + table preview | `SAP_ALLOW_DATA_PREVIEW=true` |
| Read + table preview + freestyle SQL | `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true` |
| Writes to `$TMP`/`Z*` | `SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='$TMP,Z*'` |
| Writes + CTS transports | `SAP_ALLOW_WRITES=true SAP_ALLOW_TRANSPORT_WRITES=true` |
| Writes + Git mutations | `SAP_ALLOW_WRITES=true SAP_ALLOW_GIT_WRITES=true` |
| Full local dev (everything) | All `SAP_ALLOW_*=true`, `SAP_ALLOWED_PACKAGES='*'` |
| Block specific mutations even with writes on | `SAP_DENY_ACTIONS=SAPWrite.delete,SAPManage.flp_*` |

Shell-quote package patterns with `*` or `$TMP`: `-e SAP_ALLOWED_PACKAGES='*'` or `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. In `.env` files no extra quoting needed.

API-key profile note: `developer`, `developer-data`, and `developer-sql` profiles are intentionally capped to `$TMP` regardless of `SAP_ALLOWED_PACKAGES`. For Z-package writes via API keys use a tightly scoped `admin` key with a narrow server-side `SAP_ALLOWED_PACKAGES`, or use OIDC/XSUAA for per-user scopes.

### Internal classification (for ARC-1 developers)

ARC-1 classifies each action internally using an `OperationType` enum: Read, Search, Query, FreeSQL, Create, Update, Delete, Activate, Workflow, Test, Lock, Intelligence, Transport. This drives the safety check at `checkOperation()`. The enum is **internal** — admins configure via the `SAP_ALLOW_*` flags and `SAP_DENY_ACTIONS`, not directly.

The `(tool, action) → (scope, opType)` mapping lives at [src/authz/policy.ts](https://github.com/marianfoo/arc-1/blob/main/src/authz/policy.ts). `npm run validate:policy` asserts every action in `src/handlers/schemas.ts` has a matching policy entry.

| Op type | Admin-facing flag | Example actions |
|---|---|---|
| Read | (always allowed) | `SAPRead` (except TABLE_CONTENTS), `SAPSearch`, many others |
| Search / Intelligence / Test / Lock | (always allowed) | `SAPSearch`, `SAPNavigate`, `SAPLint`, `SAPContext`, unit tests, internal CRUD lock |
| Query | `SAP_ALLOW_DATA_PREVIEW` | `SAPRead(type=TABLE_CONTENTS)` |
| FreeSQL | `SAP_ALLOW_FREE_SQL` | `SAPQuery` |
| Create / Update / Delete / Activate / Workflow | `SAP_ALLOW_WRITES` | `SAPWrite`, `SAPActivate`, FLP mutations |
| Transport | `SAP_ALLOW_WRITES` + `SAP_ALLOW_TRANSPORT_WRITES` | `SAPTransport.create`/`release`/`delete` |

---

## Server runtime

How ARC-1 itself listens for MCP traffic.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--transport` | `SAP_TRANSPORT` | `stdio` | `stdio` (subprocess over stdin/stdout) or `http-streamable` (long-lived HTTP server). The Docker image overrides this to `http-streamable` by default. |
| `--http-addr` | `ARC1_HTTP_ADDR` / `SAP_HTTP_ADDR` | `0.0.0.0:8080` | Bind address for HTTP streamable. Use `127.0.0.1:3000` to restrict to localhost. `SAP_HTTP_ADDR` is the legacy fallback name. |
| `--port` | `ARC1_PORT` | `8080` | Simpler alternative when only the port needs to change. Wins over `ARC1_HTTP_ADDR`'s port if both are set. Valid range `1–65535`. |
| `--allowed-origins` | `ARC1_ALLOWED_ORIGINS` | (empty) | Comma-separated CORS allowlist for **browser-based** MCP clients. Exact match only (no wildcards — the response sets `Access-Control-Allow-Credentials: true`). Empty disables CORS entirely. Native clients (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) don't need this. See [security-guide.md §11](security-guide.md#11-network-security). |
| — | `ARC1_PUBLIC_URL` | (auto from `VCAP_APPLICATION`, else bind host:port) | Public URL ARC-1 advertises in OAuth metadata (issuer, `authorize`/`token`/`register`/`revoke` URLs, protected-resource metadata, `WWW-Authenticate` headers). Set this when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix — without it, MCP clients receive metadata pointing at the underlying host and bypass the proxy. Path prefix supported (e.g. `https://gateway.example.com/arc1`); the well-known endpoints are also served at that prefix. Trailing slash stripped. |
| `--max-concurrent` | `ARC1_MAX_CONCURRENT` | `10` | Maximum concurrent in-flight SAP HTTP requests. Caps work-process consumption on the SAP side. Increase only if your SAP system has spare work processes. |

ARC-1 also sets standard browser security headers (HSTS, CSP, X-Frame-Options, COOP, etc.) on every HTTP response via [helmet](https://helmetjs.github.io/). These are always-on; there's no flag to disable them. Full list and rationale in [Security Guide §11](security-guide.md#11-network-security).

---

## Caching

ARC-1 caches SAP source/metadata with ETag revalidation on every hit. See [caching.md](caching.md) for the full design.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--cache` | `ARC1_CACHE` | `auto` | `auto` picks `sqlite` for HTTP transport and `memory` for stdio. `memory` = in-process only, lost on restart. `sqlite` = persistent across restarts, shared across processes that point at the same file. `none` = disable caching entirely (every read hits SAP). |
| `--cache-file` | `ARC1_CACHE_FILE` | `.arc1-cache.db` | SQLite file path when `ARC1_CACHE=sqlite` (or `auto` → sqlite). Created on first use. |
| `--cache-warmup` | `ARC1_CACHE_WARMUP` | `false` | When `true`, ARC-1 runs a TADIR scan on startup and bulk-fetches matching object sources into the cache. Speeds up first reads at the cost of a longer startup and more SAP load. |
| `--cache-warmup-packages` | `ARC1_CACHE_WARMUP_PACKAGES` | (empty = all custom) | Comma-separated package filter for warmup (e.g. `Z*,Y*,/COMPANY/*`). Empty matches all custom packages found in TADIR. Ignored when `ARC1_CACHE_WARMUP=false`. |

---

## Logging and observability

All ARC-1 logging goes to **stderr** to keep stdout clean for MCP JSON-RPC. Never use `console.log` from inside the codebase.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--log-file` | `ARC1_LOG_FILE` | — | Path to an additional file sink. Stderr output is unchanged; the file gets the same stream. |
| `--log-level` | `ARC1_LOG_LEVEL` | `info` | One of `debug` / `info` / `warn` / `error`. Filters every log line, including the audit stream's structured entries. |
| `--log-format` | `ARC1_LOG_FORMAT` | `text` | `text` (human-readable) or `json` (one JSON object per line — for shipping to ELK / Loki / CF log aggregator). |
| `--verbose` | `SAP_VERBOSE` | `false` | Alias for `--log-level=debug`. Slightly older flag, kept for compatibility. |
| — | `ARC1_LOG_HTTP_DEBUG` | `false` | When `"true"`, attaches the full HTTP request and response bodies + headers to `http_request` audit events. Sensitive headers (`Authorization`, `Cookie`, CSRF tokens) are redacted; bodies are truncated at 64 KB. **Do not enable in production** — increases log volume substantially and can leak business data in payloads. **Boolean parsing inconsistency:** unlike other booleans, this one accepts only the literal string `"true"` — `"1"` does **not** work. |

---

## ABAP feature toggles

Each toggle gates a class of ADT tools that depend on a SAP component being installed or active. All default to `auto` — ARC-1 probes the SAP system once on startup and decides. Override to `on`/`off` when probing is wrong, slow, or you want deterministic behaviour in tests.

When a feature is `off` (either set explicitly or detected as unavailable), every tool action that depends on it is hidden from tool listings *and* rejected at call time with a clear error.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--feature-abapgit` | `SAP_FEATURE_ABAPGIT` | `auto` | abapGit ADT bridge (`/sap/bc/adt/abapgit/*`). Required for `SAPGit` actions that talk to abapGit. |
| `--feature-gcts` | `SAP_FEATURE_GCTS` | `auto` | gCTS Git backend (`/sap/bc/cts_abapvcs/*`). Required for `SAPGit` actions that talk to gCTS. |
| `--feature-rap` | `SAP_FEATURE_RAP` | `auto` | RAP behavior definitions, services, drafts. Required for `SAPWrite` of BDEF/SRVD/SRVB and the RAP-specific code-intel and preflight tools. |
| `--feature-amdp` | `SAP_FEATURE_AMDP` | `auto` | ABAP Managed Database Procedures. Required for AMDP-specific read/write paths. |
| `--feature-ui5` | `SAP_FEATURE_UI5` | `auto` | UI5 application development tools (general). |
| `--feature-ui5repo` | `SAP_FEATURE_UI5REPO` | `auto` | UI5 ABAP Repository OData service. Required for `SAPManage` UI5 repo upload/download actions. |
| `--feature-flp` | `SAP_FEATURE_FLP` | `auto` | FLP `PAGE_BUILDER_CUST` OData service. Required for `SAPManage` FLP page/role mutations. |
| `--feature-transport` | `SAP_FEATURE_TRANSPORT` | `auto` | CTS transport endpoints. Required for `SAPTransport` (even reads). |
| `--feature-hana` | `SAP_FEATURE_HANA` | `auto` | HANA-specific developer tools. |

`auto` probes one specific endpoint per feature and classifies the response: 2xx/400/405/5xx → available; 401/403/404 → unavailable. The reason is surfaced in startup logs and in the `SAPManage.system_info` response.

---

## Code-quality gates

Optional pre-write validation layers and tool-set selection.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `--lint-before-write` | `SAP_LINT_BEFORE_WRITE` | `true` | Runs `@abaplint/core` against the source body before every `SAPWrite`. Syntax errors block the write; warnings are appended to the response (non-blocking). When `false`, lint is skipped — the write goes straight to the activation/save round-trip. Some object types (e.g. `FUNC` source with structured signatures) are exempt from lint regardless of this flag. |
| `--abaplint-config` | `SAP_ABAPLINT_CONFIG` | — (uses built-in preset) | Path to a custom `abaplint.jsonc`. When unset, ARC-1 builds a preset config based on the detected system type (cloud-strict for BTP, relaxed for on-prem). Custom config takes full precedence. |
| `--check-before-write` | `SAP_CHECK_BEFORE_WRITE` | `false` | See [Authorization and safety](#authorization-and-safety) — adds a server-side ADT syntax check round-trip before save. Different layer from `lint-before-write` (this hits SAP, lint runs locally). |
| `--tool-mode` | `ARC1_TOOL_MODE` | `standard` | `standard` exposes the 12 intent-based tools (~5K schema tokens). `hyperfocused` exposes a single universal `sap` tool (~200 tokens) that dispatches everything internally. Use `hyperfocused` for severely token-constrained LLM clients (e.g. GPT-4o-mini, Copilot Studio). |

---

## Removed in v0.7 (will fail at startup)

ARC-1 detects these legacy identifiers and exits with a migration message. Replace before upgrading:

| Removed | Replacement |
|---|---|
| `SAP_READ_ONLY` | `SAP_ALLOW_WRITES` (inverted — set to `true` to enable writes) |
| `SAP_BLOCK_DATA` | `SAP_ALLOW_DATA_PREVIEW` (inverted) |
| `SAP_BLOCK_FREE_SQL` | `SAP_ALLOW_FREE_SQL` (inverted) |
| `SAP_ENABLE_TRANSPORTS` | `SAP_ALLOW_TRANSPORT_WRITES` + `SAP_ALLOW_WRITES=true` |
| `SAP_ENABLE_GIT` | `SAP_ALLOW_GIT_WRITES` + `SAP_ALLOW_WRITES=true` |
| `SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS` | `SAP_DENY_ACTIONS` |
| `ARC1_PROFILE` | Individual `SAP_ALLOW_*` flags (see [recipes](#recipes)) |
| `ARC1_API_KEY` (single) | `ARC1_API_KEYS="key:profile"` |

Full migration guide: [updating.md](updating.md#v07-authorization-refactor-breaking-change).

---

## See also

- [Configuration Precedence](configuration-precedence.md) — CLI vs env vs `.env`, and what changes across npx / local / Docker / BTP.
- [Authorization & Roles](authorization.md) — three-layer model, scope semantics, capability requirements.
- [Enterprise Auth](enterprise-auth.md) — Layer A / Layer B coexistence matrix.
- [`.env.example`](https://github.com/marianfoo/arc-1/blob/main/.env.example) — grouped template with inline commentary.
- Effective config at startup: ARC-1 logs `auth: MCP=[…] SAP=[…]` and a safety summary line on every boot. When in doubt, read that first.
