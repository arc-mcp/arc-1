# Configuration Reference

Every flag, env var, and default in one place.

Global precedence: **CLI flag > env var > `.env` file > built-in default**.

!!! tip "Looking for the big picture?"
    This page is a flat reference. For the mental model (three-layer authorization, two-gate rule, scope implications, recipes), start with the [Authorization & Roles](authorization.md) overview.

For the grouped template with inline commentary, see [`.env.example`](https://github.com/marianfoo/arc-1/blob/main/.env.example).

---

## Mental model (short version)

ARC-1 has **three independent gates** that all must pass for a mutation:

1. **Server safety config** (Layer 1) — e.g. `SAP_ALLOW_WRITES`, `SAP_ALLOW_TRANSPORT_WRITES`. Positive opt-ins, defaults restrictive.
2. **User scope** (Layer 2) — from JWT (XSUAA/OIDC) or API-key profile. Scopes: `read`, `write`, `data`, `sql`, `transports`, `git`, `admin`. `admin` implies all.
3. **SAP authorization** (Layer 3) — the underlying SAP user's PFCG roles / S_DEVELOP checks. Per-user via principal propagation.

Reads of SAP object source/metadata only need Layer 2 (`read` scope) — no server opt-out. Data preview and freestyle SQL each need both layers. Transport/Git mutations need `write` plus their specialized `transports` / `git` scope because users without `write` are treated as no-mutation users.

See [Authorization & Roles](authorization.md) for the full model.

---

## Safety flags (Layer 1)

**Every flag below defaults to the restrictive setting.** ARC-1 starts read-only: no writes, no free SQL, no named table preview, no transport writes, no git writes, writes confined to `$TMP`.

!!! warning "`SAP_ALLOW_DATA_PREVIEW` and `SAP_ALLOW_FREE_SQL` sit outside the SAP API Policy FAQ envelope"
    The April 2026 [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) and its accompanying [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html) endorse ADT-based developer tooling for internal development automation. The same FAQ excludes "programmatic reading of application tables or export of business data" and "SQL execution against SAP backend systems". Both `SAP_ALLOW_DATA_PREVIEW` and `SAP_ALLOW_FREE_SQL` map directly onto these excluded capabilities, which is why they are off by default and gated behind explicit env vars. Keep them off on systems where you want to stay aligned with the FAQ's endorsed-development-tooling scope. See [authorization.md](authorization.md#sap-api-policy-data-preview-and-free-sql-are-gated-for-a-reason) for the full policy alignment.

| Flag                             | Env Var                       | Default | What it enables                                                                                                              |
| -------------------------------- | ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--allow-writes`                 | `SAP_ALLOW_WRITES`            | `false` | Object mutations (`SAPWrite`, `SAPActivate`, package CRUD, FLP mutations). Also required for transport/git writes.            |
| `--allow-data-preview`           | `SAP_ALLOW_DATA_PREVIEW`      | `false` | Named table preview (`SAPRead(type=TABLE_CONTENTS)`). **Outside SAP API Policy FAQ endorsed-development-tooling scope** — explicit opt-in required. |
| `--allow-free-sql`               | `SAP_ALLOW_FREE_SQL`          | `false` | Freestyle SQL via `SAPQuery`. **Outside SAP API Policy FAQ endorsed-development-tooling scope** — explicit opt-in required. |
| `--allow-transport-writes`       | `SAP_ALLOW_TRANSPORT_WRITES`  | `false` | Transport mutations (`SAPTransport.create`/`release`/`delete`/`reassign`). **Also requires** `allowWrites=true`.              |
| `--allow-git-writes`             | `SAP_ALLOW_GIT_WRITES`        | `false` | Git mutations (`SAPGit.clone`/`pull`/`push`/`commit`). **Also requires** `allowWrites=true`.                                 |
| `--allowed-packages`             | `SAP_ALLOWED_PACKAGES`        | `$TMP`  | Package allowlist for writes. Comma-separated. `Z*` prefix wildcard. `*` = unrestricted. **Reads are never package-gated.**   |
| `--allowed-transports`           | `SAP_ALLOWED_TRANSPORTS`      | `[]`    | Advanced: specific CTS transport ID whitelist.                                                                               |
| `--deny-actions`                 | `SAP_DENY_ACTIONS`            | `[]`    | Fine-grained per-action denial. Tool-qualified grammar. See [deny actions](authorization.md#advanced-deny-actions).          |
| `--tool-mode`                    | `ARC1_TOOL_MODE`              | `standard` | `standard` (12 tools) / `hyperfocused` (1 universal tool, ~200 tokens).                                                  |
| `--abaplint-config`              | `SAP_ABAPLINT_CONFIG`         | —       | Path to custom `abaplint.jsonc`.                                                                                             |
| `--lint-before-write`            | `SAP_LINT_BEFORE_WRITE`       | `true`  | Pre-write lint validation (block syntax errors before save).                                                                 |

### Recipes

| Goal                                           | Set these flags                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Read/search only                               | (nothing — defaults are restrictive)                                                     |
| Read + table preview                           | `SAP_ALLOW_DATA_PREVIEW=true`                                                             |
| Read + table preview + freestyle SQL           | `SAP_ALLOW_DATA_PREVIEW=true`, `SAP_ALLOW_FREE_SQL=true`                                  |
| Writes to `$TMP`/`Z*`                          | `SAP_ALLOW_WRITES=true`, `SAP_ALLOWED_PACKAGES='$TMP,Z*'`                                 |
| Writes + CTS transports                        | `SAP_ALLOW_WRITES=true`, `SAP_ALLOW_TRANSPORT_WRITES=true`                                |
| Writes + Git mutations                         | `SAP_ALLOW_WRITES=true`, `SAP_ALLOW_GIT_WRITES=true`                                      |
| Full local dev (everything)                    | All `SAP_ALLOW_*=true`, `SAP_ALLOWED_PACKAGES='*'`                                        |
| Deny specific actions (fine-grained)           | e.g. `SAP_DENY_ACTIONS=SAPWrite.delete,SAPManage.flp_*`                                   |

Shell-quote package patterns with `*` or `$TMP`: `-e SAP_ALLOWED_PACKAGES='*'` or `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. In `.env` files, no extra quoting needed.

API-key profile note: `developer`, `developer-data`, and `developer-sql` profiles are intentionally capped to `$TMP`. If you use API keys and need Z-package writes, use a tightly scoped `admin` key with a narrow server-side `SAP_ALLOWED_PACKAGES`, or use OIDC/XSUAA for per-user scopes.

### Internal classification (for developers)

ARC-1 classifies each action internally using an `OperationType` enum (Read, Search, Query, FreeSQL, Create, Update, Delete, Activate, Workflow, Test, Lock, Intelligence, Transport). This classification drives the `isOperationAllowed` safety check. The enum is **internal** — admins configure via the `SAP_ALLOW_*` flags and `SAP_DENY_ACTIONS`, not directly.

The single source of truth for `(tool, action) → (scope, opType)` lives at `src/authz/policy.ts`. The CI validator (`npm run validate:policy`) asserts every action declared in `src/handlers/schemas.ts` has a matching policy entry.

### Operation summary

| Op type     | Admin-facing flag           | Example tool actions                                       |
| ----------- | --------------------------- | ---------------------------------------------------------- |
| Read        | (always allowed)             | `SAPRead` (except TABLE_CONTENTS), `SAPSearch`, many others |
| Search      | (always allowed)             | `SAPSearch`                                                 |
| Intelligence | (always allowed)             | `SAPNavigate`, `SAPLint`, `SAPContext`                     |
| Test        | (always allowed)             | `SAPDiagnose(action=unittest)`                             |
| Lock        | (always allowed)             | Internal CRUD lock step                                     |
| Query       | `SAP_ALLOW_DATA_PREVIEW`     | `SAPRead(type=TABLE_CONTENTS)`                             |
| FreeSQL     | `SAP_ALLOW_FREE_SQL`         | `SAPQuery`                                                  |
| Create      | `SAP_ALLOW_WRITES`           | `SAPWrite(action=create)`, `SAPManage.create_package`      |
| Update      | `SAP_ALLOW_WRITES`           | `SAPWrite(action=update)`, `SAPLint.set_formatter_settings` |
| Delete      | `SAP_ALLOW_WRITES`           | `SAPWrite(action=delete)`, `SAPManage.delete_package`      |
| Activate    | `SAP_ALLOW_WRITES`           | `SAPActivate`                                               |
| Workflow    | `SAP_ALLOW_WRITES`           | FLP mutations in `SAPManage`                               |
| Transport   | `SAP_ALLOW_WRITES` + `SAP_ALLOW_TRANSPORT_WRITES` | `SAPTransport.create`/`release`/`delete`                 |

---

## SAP connection

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--url` | `SAP_URL` | — | SAP system URL (required) |
| `--client` | `SAP_CLIENT` | `100` | SAP client number |
| `--language` | `SAP_LANGUAGE` | `EN` | SAP logon language |
| `--insecure` | `SAP_INSECURE` | `false` | Skip TLS verification (dev only) |
| `--system-type` | `SAP_SYSTEM_TYPE` | `auto` | `auto` / `btp` / `onprem` |

## Layer B — ARC-1 → SAP authentication

Pick one primary method. Combinations that coexist safely are in the [Coexistence Matrix](enterprise-auth.md#coexistence-matrix).

### B1. Basic Auth

| Flag | Env Var | Description |
|---|---|---|
| `--user` | `SAP_USER` | SAP username |
| `--password` | `SAP_PASSWORD` | SAP password |

### B2. Cookie Auth (dev-only, SSO on-prem)

| Flag | Env Var | Description |
|---|---|---|
| `--cookie-file` | `SAP_COOKIE_FILE` | Path to Netscape-format cookie file. **Hot-reloaded** on stale 401: re-extract cookies (e.g. via `arc1-cli extract-cookies`) and the next SAP call picks them up — no restart needed. |
| `--cookie-string` | `SAP_COOKIE_STRING` | Inline cookies (`k=v; k2=v2`). **Cannot hot-reload** — the value is read once at startup. To refresh, restart the process with a new value, or switch to `SAP_COOKIE_FILE`. |

Not for production. See [local-development.md → SSO cookie extractor](local-development.md#sso-only-on-prem-cookie-extractor).

**Cookie hot-reload (SAP_COOKIE_FILE only).** When the SAP session expires and a request returns 401 after the standard one-shot session-reset retry, ARC-1 clears the in-memory cookie jar (including any session cookies harvested from intermediate responses) and re-reads the configured cookie file lazily on the next outgoing request. Implications:

- The startup auth preflight downgrades a 401 from blocking to non-blocking when `SAP_COOKIE_FILE` is set, so the MCP server starts even if cookies are about to be re-extracted out-of-band. The first real tool call triggers the reload.
- `SAP_COOKIE_STRING` keeps the existing blocking-401 behavior — ARC-1 cannot refresh a static env var without restart.
- Per-user Principal Propagation clients never inherit shared cookie state; `cookieFile`/`cookieString` are stripped from per-user configs in `buildAdtConfig`.

### B3. BTP ABAP Environment (direct OAuth)

| Flag | Env Var | Description |
|---|---|---|
| `--btp-service-key-file` | `SAP_BTP_SERVICE_KEY_FILE` | Path to BTP service key JSON |
| `--btp-service-key` | `SAP_BTP_SERVICE_KEY` | Inline BTP service key JSON |
| `--btp-oauth-callback-port` | `SAP_BTP_OAUTH_CALLBACK_PORT` | `0` (auto) |

Full reference: [btp-abap-environment.md](btp-abap-environment.md).

### B4. BTP Destination Service

| Env Var | Description |
|---|---|
| `SAP_BTP_DESTINATION` | Destination name (shared/Basic) |
| `SAP_BTP_PP_DESTINATION` | Destination name (`PrincipalPropagation` type) |

Full reference: [btp-destination-setup.md](btp-destination-setup.md).

### B5. Principal Propagation

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--pp-enabled` | `SAP_PP_ENABLED` | `false` | Per-user SAP identity |
| `--pp-strict` | `SAP_PP_STRICT` | `false` | PP failure = error, no fallback |
| `--pp-allow-shared-cookies` | `SAP_PP_ALLOW_SHARED_COOKIES` | `false` | Escape hatch: allow cookies to coexist with PP (cookies stay on shared client only) |

Full reference: [principal-propagation-setup.md](principal-propagation-setup.md).

### Layer B extras

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--disable-saml` | `SAP_DISABLE_SAML` | `false` | Emit `X-SAP-SAML2: disabled` + `?saml2=disabled` (SAP Note 3456236). **Breaks BTP ABAP / S/4 Public Cloud.** |

---

## Layer A — MCP Client → ARC-1 authentication

Multiple methods chain — API Key + OIDC + XSUAA can all be active on one instance.

### A1. No auth (stdio only, local dev)

Set nothing.

### A2. API Key(s)

| Flag | Env Var | Description |
|---|---|---|
| `--api-keys` | `ARC1_API_KEYS` | Multi-key with profiles: `key1:viewer,key2:developer`. Valid profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. Each profile maps to a scope set AND a partial SafetyConfig intersected with the server ceiling. |

Full reference: [api-key-setup.md](api-key-setup.md). Single `--api-key` / `ARC1_API_KEY` was removed in v0.7 — see [updating.md](updating.md#v07-authorization-refactor-breaking-change).

### A3. OIDC / JWT

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--oidc-issuer` | `SAP_OIDC_ISSUER` | — | OIDC issuer URL |
| `--oidc-audience` | `SAP_OIDC_AUDIENCE` | — | Expected audience claim |
| `--oidc-clock-tolerance` | `SAP_OIDC_CLOCK_TOLERANCE` | `0` | JWT clock skew seconds |

Full reference: [oauth-jwt-setup.md](oauth-jwt-setup.md).

### A4. XSUAA OAuth (BTP)

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--xsuaa-auth` | `SAP_XSUAA_AUTH` | `false` | Enable XSUAA token validation |
| `--oauth-dcr-ttl-seconds` | `ARC1_OAUTH_DCR_TTL_SECONDS` | `2592000` (30 d) | Lifetime of an OAuth Dynamic Client Registration `client_id`. Min 60 s, max 90 d. Lower bounds blast radius if the signing key leaks; higher reduces re-auth churn. Only consulted when `--xsuaa-auth=true`. |

Full reference: [xsuaa-setup.md](xsuaa-setup.md).

---

## Transport & logging

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--transport` | `SAP_TRANSPORT` | `stdio` | `stdio` / `http-streamable` |
| `--http-addr` | `ARC1_HTTP_ADDR` / `SAP_HTTP_ADDR` | `0.0.0.0:8080` | HTTP bind address |
| `--port` | `ARC1_PORT` | `8080` | HTTP port (simpler alternative to `--http-addr`) |
| `--allowed-origins` | `ARC1_ALLOWED_ORIGINS` | (empty) | Comma-separated CORS allowlist for **browser-based** MCP clients. Empty disables CORS entirely. Native clients (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) don't need this. Exact match only (no wildcards) because the response sets `credentials: true`. See [Security headers & CORS](security-guide.md#11-network-security). |
| — | `ARC1_PUBLIC_URL` | (auto from `VCAP_APPLICATION`) | Public URL ARC-1 advertises in OAuth metadata (issuer, `authorize` / `token` / `register` / `revoke`, protected-resource metadata, and the `WWW-Authenticate: ... resource_metadata=` URL). Set this when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix than the bound route — without it, MCP clients receive metadata pointing at the underlying host and bypass the proxy. Path prefix supported (e.g. `https://gateway.example.com/arc1`); when present, the well-known endpoints are also served at that prefix so OAuth discovery works through the proxy. Trailing slash stripped. |
| `--log-file` | `ARC1_LOG_FILE` | — | File sink path |
| `--log-level` | `ARC1_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `--log-format` | `ARC1_LOG_FORMAT` | `text` | `text` / `json` |
| `--verbose` | `SAP_VERBOSE` | `false` | Debug-level logging |

ARC-1 also sets standard browser security headers (HSTS, CSP, X-Frame-Options, COOP, etc.) on every HTTP response via [helmet](https://helmetjs.github.io/). These are always-on; there's no flag to disable them. Full header list and rationale is in the [Security Guide §11](security-guide.md#11-network-security).

---

## Cache & concurrency

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--cache` | `ARC1_CACHE` | `auto` | `auto` / `memory` / `sqlite` / `none` |
| `--cache-file` | `ARC1_CACHE_FILE` | `.arc1-cache.db` | SQLite cache path |
| `--cache-warmup` | `ARC1_CACHE_WARMUP` | `false` | Pre-warm cache via TADIR scan on startup |
| `--cache-warmup-packages` | `ARC1_CACHE_WARMUP_PACKAGES` | — | Package filter (e.g. `Z*,Y*`) |
| `--max-concurrent` | `ARC1_MAX_CONCURRENT` | `10` | Max concurrent SAP HTTP requests |

Full reference: [caching.md](caching.md).

---

## Priority and combination rules

- **Priority:** CLI flag > env var > `.env` file > built-in default.
- **Layer A methods chain:** any combination of API Key / OIDC / XSUAA is valid and active simultaneously.
- **Layer B methods don't chain freely:** see the [Coexistence Matrix](enterprise-auth.md#coexistence-matrix). Unsafe combinations fail fast at startup.
- **Startup auth summary:** ARC-1 logs one line telling you exactly what's active — `auth: MCP=[...] SAP=[...] (shared|per-user) [disable-saml=on]`. When in doubt, read that line first.
