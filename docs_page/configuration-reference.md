# Configuration reference

Look up ARC-1 settings, defaults, and accepted values. For a first connection, use
[Quickstart](quickstart.md); for a BTP deployment, use the [BTP setup guide](btp-overview.md).

Configure local processes with environment variables or `.env`. On BTP Cloud Foundry, use MTA
extension properties or `cf set-env`. See [Configuration precedence](configuration-precedence.md)
and the [`.env.example` template](https://github.com/arc-mcp/arc-1/blob/main/.env.example).


## How values are resolved

```
CLI flag   >   process.env   >   .env file (in CWD)   >   built-in default
```

The process environment includes shell exports, Docker `-e`, CF properties, and MCP subprocess
`env` settings. `.env` only fills unset keys. A remote MCP URL has no subprocess environment;
configure the server that owns that URL.

**Boolean values.** Most boolean flags accept either `"true"` or `"1"`. One exception: `ARC1_LOG_HTTP_DEBUG` accepts only `"true"` ([known inconsistency](#logging-and-observability)).

**Comma-separated lists.** `SAP_ALLOWED_PACKAGES`, `SAP_ALLOWED_TRANSPORTS`, `SAP_DENY_ACTIONS`, `SAP_BLOCKED_DATA_SOURCES`, and `ARC1_ALLOWED_ORIGINS` use list-specific parsing rules described below. `SAP_DENY_ACTIONS` also accepts a JSON-file path. Quote shell-sensitive entries (`*`, `$TMP`, glob characters): `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. In `.env` files no extra quoting is needed.


## SAP connection

Connection settings select the SAP endpoint and request behavior. [Capability settings](#authorization-and-safety) control which tool actions are allowed.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_URL`<br>`--url` | — | SAP base URL with scheme and any nonstandard port. Required for direct single-target SAP calls unless a destination/service key supplies it. A target-free process can start and pass `/health`; it cannot perform SAP calls until a target is configured. Multi-target mode selects destinations instead. |
| `SAP_CLIENT`<br>`--client` | `100` | Logon client number. Sent as `sap-client` in every ADT request and as the `client` field during authentication. Wrong value → "Logon not possible (incorrect client)". |
| `SAP_LANGUAGE`<br>`--language` | `EN` | SAP request language and master language for created objects. Affects translated messages and descriptions. |
| `SAP_INSECURE`<br>`--insecure` | `false` | Disable SAP TLS certificate verification. Use only for isolated development; prefer `NODE_EXTRA_CA_CERTS` for internal CAs. |
| `SAP_GZIP_DATAPREVIEW_BODY`<br>`--gzip-datapreview-body` | `false` | Gzip non-empty POST bodies on the exact ADT `/datapreview/freestyle` and `/datapreview/ddic` collection paths. Default-off WAF compatibility option; requires security-owner approval. See [Data-preview gzip](#data-preview-gzip). |
| `SAP_SYSTEM_TYPE`<br>`--system-type` | `auto` | Forces ARC-1's release/feature gating to behave as if the target is `btp` (Steampunk/Public Cloud) or `onprem`. `auto` (default) lets ARC-1 detect via probes. Override when auto-detection is wrong (e.g. mirrored systems). |
| `SAP_ABAP_RELEASE`<br>`--abap-release` | — | Manual `SAP_BASIS` release override for local tooling that needs a release number (e.g. abaplint's syntax-feature gating). Examples: `758` for S/4HANA 2023, `816` for ABAP Platform 2025 (SAP renumbered 75x→8xx). ARC-1's runtime probe still wins when available — this is the fallback. |

### TLS / proxy notes

ARC-1 uses [undici](https://github.com/nodejs/undici) for SAP HTTP. Ordinary direct ADT traffic does
**not yet** honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`; that work is tracked as
[COMPAT-06](roadmap.md#compat-06). BTP Destination Service / Cloud Connector connectivity is a separate
platform-managed proxy path and is unaffected. For custom CA certificates, set
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem` (read by Node, not by ARC-1 directly). For Docker mounts of CA
bundles, see [docker.md](docker.md#self-signed-or-internal-ca-certificates).

### Data-preview gzip

Enable `SAP_GZIP_DATAPREVIEW_BODY` only after the gateway audit log confirms a false-positive WAF
rule; HTTP 403 alone can also mean a CSRF/session failure. Prefer a rule exclusion narrowed to the
authenticated route, method, variable, and rule.

Gzip can prevent raw-body inspection by a WAF. ARC-1 never enables it or retries with it
automatically. It preserves the data-preview, SQL, scope, and SAP-authorization checks. The setting
applies globally in multi-target mode. Startup logs report its resolved state.

Request decompression was verified on SAP_BASIS 758 and 816. Validate a query on other releases;
the available 750 test system did not bind data preview.

## Authentication

ARC-1 has two independent authentication boundaries:

- **Layer B** — how ARC-1 itself authenticates to SAP (cookies, basic auth, OAuth, principal propagation…).
- **Layer A** — how MCP clients authenticate to ARC-1 (none for stdio, API key / OIDC / XSUAA for HTTP).

The full coexistence matrix is in [enterprise-auth.md](enterprise-auth.md#coexistence-matrix). Below is what each env var does.

The credential-bearing flags remain for compatibility, but do not pass passwords, cookie strings,
API keys, tokens, or inline service-key JSON in argv: shell history, process listings, and CI logs may
retain them. Use the environment variables or protected file forms shown below, populated by your
secret store.

### Layer B — ARC-1 → SAP

Select the SAP identity method for your deployment. Combining PP with shared cookies requires the explicit exception described below.

#### B1. Basic auth

| Setting (environment / CLI) | Effect |
| --- | --- |
| `SAP_USER`<br>`--user` | SAP username for the shared Basic-auth client. With PP enabled, JWT calls use the per-user identity; API-key/non-JWT calls use the shared client unless `SAP_PP_STRICT=true` is explicitly set. JWT PP failures never fall back. |
| `SAP_PASSWORD`<br>`--password` | Password for the above. Redacted from ARC-1 logs; prefer the environment variable because command-line argv is outside that redaction boundary. |

#### B2. Cookie auth (dev-only SSO bridge)

| Setting (environment / CLI) | Effect |
| --- | --- |
| `SAP_COOKIE_FILE`<br>`--cookie-file` | Netscape-format cookie jar. ARC-1 sends these cookies on every SAP request. **Hot-reloaded**: when a request returns 401 after the standard session-reset retry, the jar is cleared and the file is re-read on the next request — no restart needed. |
| `SAP_COOKIE_STRING`<br>`--cookie-string` | Inline cookies (`k=v; k2=v2`) read once at startup. **Cannot hot-reload** — restart with a new value or switch to `SAP_COOKIE_FILE`. |

Cookie auth is not for production. See [local-development.md → SSO cookie extractor](local-development.md#sso-only-on-prem-cookie-extractor). On startup, the auth preflight is non-blocking when `SAP_COOKIE_FILE` is set, so the server starts even if cookies are about to be re-extracted out-of-band. Per-user PP clients never inherit cookie state — `cookieFile`/`cookieString` are stripped from per-user configs.

#### B3. BTP ABAP Environment (direct OAuth)

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_BTP_SERVICE_KEY_FILE`<br>`--btp-service-key-file` | — | Path to a BTP ABAP service key JSON. ARC-1 reads `url` and `uaa` from it and performs an OAuth 2.0 Authorization Code flow on first use (browser opens). This is for local/interactive service-key OAuth, not a headless CF production path. |
| `SAP_BTP_SERVICE_KEY`<br>`--btp-service-key` | — | Same as above but inline JSON. Avoid for deployed/shared servers; for BTP CF + BTP ABAP, create a BTP Destination with `OAuth2UserTokenExchange` instead. |
| `SAP_BTP_OAUTH_CALLBACK_PORT`<br>`--btp-oauth-callback-port` | `0` (auto) | Local TCP port the OAuth callback listener binds to. `0` picks any free port. Pin it when you need a fixed redirect URI registered in BTP. |

Full reference: [btp-abap-environment.md](btp-abap-environment.md).

#### B4. BTP Destination Service

| Setting (environment / CLI) | Effect |
|---|---|
| `SAP_BTP_DESTINATION` | Name of the BTP Destination ARC-1 reads to obtain SAP URL + auth details. For BasicAuth destinations this creates the shared technical client. For BTP ABAP `OAuth2UserTokenExchange` destinations, this can also be the per-user destination used when `SAP_PP_ENABLED=true`. Bypasses `SAP_URL` / `SAP_USER` / `SAP_PASSWORD` — those are ignored when a destination is set. |
| `SAP_BTP_PP_DESTINATION` | Optional separate per-user destination name. Use this for on-premise `PrincipalPropagation` when shared startup traffic and per-user traffic must route via different destinations. If unset, ARC-1 falls back to `SAP_BTP_DESTINATION`. Applies only to the single-target `/mcp` route. |
| `ARC1_MULTI_TARGET_ENDPOINTS`<br>`--multi-target-endpoints` | Default `false`; experimental. Discover marked subaccount destinations and expose mutation-free pinned `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` and aggregate `/multi/mcp` routes. Requires CF XSUAA/Destination/Connectivity, HTTP, cache `none`, standard tools, and UI/plugins/cookies off. It never assigns a target to `/mcp`. Follow [multi-target setup](multi-target-setup.md). |
| `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH`<br>`--multi-target-allow-basic-auth` | Default `false`; experimental. Permit marked BasicAuthentication targets with a shared SAP user, scoped XSUAA callers and exactly one CF instance. Never a PP fallback. Credentials resolve per request and can rotate without restart; other destination changes need restart. See [shared Basic controls](multi-target-administration.md#basic-shared-identity-controls). |

Full reference: [btp-destination-setup.md](btp-destination-setup.md) · [multi-target-setup.md](multi-target-setup.md).

#### B5. Principal Propagation

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_PP_ENABLED`<br>`--pp-enabled` | `false` | Enables ARC-1's per-user destination path. For on-premise SAP this resolves a `PrincipalPropagation` destination through Connectivity Service and Cloud Connector. For BTP ABAP Environment this resolves an `OAuth2UserTokenExchange` destination and uses the returned ABAP bearer token. Without it, every SAP call uses the shared technical client. |
| `SAP_PP_STRICT`<br>`--pp-strict` | Unset allows non-JWT shared calls | Explicit `true` rejects API-key/non-JWT tool calls. Unset or `false` allows API keys to use the configured shared SAP client and logs a mixed-identity warning when keys are configured. JWT PP failures always fail closed. The internal default `true` does not enforce non-JWT rejection without an explicit setting. |
| `SAP_PP_ALLOW_SHARED_COOKIES`<br>`--pp-allow-shared-cookies` | `false` | Escape hatch. Without it, setting `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` together with `SAP_PP_ENABLED=true` fails at startup (cookies belong to one user, PP wants per-user). With `true`, cookies stay on the shared client only and PP traffic runs cookie-free. |

Full reference: [principal-propagation-setup.md](principal-propagation-setup.md).

#### Layer B extras

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_DISABLE_SAML`<br>`--disable-saml` | `false` | Emits `X-SAP-SAML2: disabled` header + `?saml2=disabled` query on every ADT request (SAP Note 3456236). Stops on-prem systems from redirecting to SAML IdP when Basic Auth is intended. **Breaks BTP ABAP Environment and S/4 Public Cloud — only enable for on-prem with SAML enforcement.** |

### Layer A — MCP Client → ARC-1

These only apply to HTTP transport. Stdio has no authentication boundary — the client *is* the spawner.

On single-target HTTP routes, configured API keys, OIDC and XSUAA can coexist. Multi-target routes require XSUAA.

#### A1. No auth

Set nothing. Stdio only. Anyone who can pipe stdin to the process is "authenticated" by being the spawner.

#### A2. API Key(s)

| Setting (environment / CLI) | Effect |
| --- | --- |
| `ARC1_API_KEYS`<br>`--api-keys` | Comma-separated `key:profile` pairs. Each profile maps to a scope set (read/write/data/sql/transports/git/admin) **and** a partial SafetyConfig intersected with the server ceiling. Valid profiles: `viewer`, `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`, `admin`. Caller sends `Authorization: Bearer <key>`; ARC-1 looks the key up and applies that profile's scopes for the request. |
| `ARC1_ALLOW_HTTP_NO_AUTH`<br>`--allow-http-no-auth` | Unsafe local/dev escape hatch. HTTP transport refuses to start without API key, OIDC, or XSUAA auth unless this is explicitly `true`. Never use on a network-reachable instance. |

Full reference: [api-key-setup.md](api-key-setup.md). The single-key `ARC1_API_KEY` env var was removed in v0.7 — see [updating.md](updating.md#v07-authorization-refactor-breaking-change).

#### A3. OIDC / JWT

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_OIDC_ISSUER`<br>`--oidc-issuer` | — | OIDC issuer URL (e.g. Entra ID, Auth0). ARC-1 reads `{issuer}/.well-known/openid-configuration`, follows its `jwks_uri`, and validates incoming JWTs with those signing keys. |
| `SAP_OIDC_AUDIENCE`<br>`--oidc-audience` | — | Expected `aud` claim. Tokens whose `aud` doesn't match are rejected. |
| `SAP_OIDC_CLOCK_TOLERANCE`<br>`--oidc-clock-tolerance` | `0` | Seconds of clock skew tolerated when checking `exp`/`nbf`. Set 30–60 if your auth server and ARC-1 host clocks drift. |
| `SAP_OIDC_DISCOVERY`<br>`--oidc-discovery` | `true` | Serve RFC 9728 protected-resource metadata and link to it from `401` challenges. Ignored in XSUAA and API-key-only modes. For Entra errors involving `resource`, follow the [client-specific workaround](oauth-jwt-setup.md#microsoft-entra-id-caveat-aadsts9010010); disabling discovery alone does not change OAuth parameters. |
| `SAP_OIDC_SCOPES`<br>`--oidc-scopes` | — | Scopes advertised as `scopes_supported` in the protected-resource metadata, comma or space separated (Entra: `api://<client-id>/access_as_user`). Clients request these at your IdP; omitted from the document when unset. These are **IdP scope names**, unrelated to ARC-1's `read`/`write`/… scopes. Requires `SAP_OIDC_ISSUER`. |

Full reference: [oauth-jwt-setup.md](oauth-jwt-setup.md).

#### A4. XSUAA OAuth (BTP)

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_XSUAA_AUTH`<br>`--xsuaa-auth` | `false` | When `true`, ARC-1 reads XSUAA credentials from `VCAP_SERVICES`, validates incoming JWTs against XSUAA's keys, and exposes OAuth metadata (RFC 8414), Protected Resource Metadata (RFC 9728), and Dynamic Client Registration endpoints. Required for BTP CF deployments. |
| `ARC1_OAUTH_DCR_TTL_SECONDS`<br>`--oauth-dcr-ttl-seconds` | `0` (never expire) | XSUAA DCR `client_id` lifetime. `0` means no expiry; positive values clamp to 60 seconds–90 days. Finite TTLs can cause `invalid_client` errors in clients that do not re-register. TTL does not provide individual-client revocation. |
| `ARC1_DCR_SIGNING_SECRET`<br>`--dcr-signing-secret` | unset (falls back to XSUAA `clientsecret`) | HMAC secret for DCR `client_id`s. Keeps registrations valid across XSUAA binding recreation. Rotating it invalidates all registrations. Generate at least 32 bytes (for example `openssl rand -base64 48`). Empty/whitespace falls back to the XSUAA secret; fewer than 16 bytes or use without XSUAA emits a warning. |

Full reference: [xsuaa-setup.md](xsuaa-setup.md).


## Authorization and safety

ARC-1 starts read-only, with table data and SQL disabled. These settings define the server
ceiling; user scopes can restrict it but cannot expand it.

Review the [SAP API policy](sap-api-policy-and-architecture.md) before enabling data-preview or SQL
for a deployment.

### Capability flags

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_ALLOW_WRITES`<br>`--allow-writes` | `false` | Master switch for every mutation: `SAPWrite` (create/update/delete), `SAPActivate`, package CRUD, FLP mutations. When `false`, every mutating tool call is rejected at the safety layer regardless of caller scopes. Also required (in addition to the specific flag below) for transport and git writes. |
| `SAP_ALLOW_DATA_PREVIEW`<br>`--allow-data-preview` | `false` | Enables `SAPRead(type=TABLE_CONTENTS)` and the structured `TABLE_QUERY` path. When off, those data reads are rejected; ordinary object/source reads still work. |
| `SAP_ALLOW_FREE_SQL`<br>`--allow-free-sql` | `false` | Enables `SAPQuery` (freestyle ABAP SQL via `/sap/bc/adt/datapreview/freestyle`). When off, `SAPQuery` is rejected. |
| `SAP_BLOCKED_DATA_SOURCES`<br>`--blocked-data-sources` | empty (off) | Experimental exact table/CDS denylist. Checks direct and transitive active CDS/replacement sources for data-preview calls. Empty/unset is off. See [Blocklist syntax and limits](#blocklist-syntax-and-limits). |
| `SAP_ALLOW_TRANSPORT_WRITES`<br>`--allow-transport-writes` | `false` | Permit CTS mutations with `SAP_ALLOW_WRITES=true` and the required user scopes. Transport reads remain available. See [SAPTransport](tools/sap-transport.md). |
| `SAP_ALLOW_GIT_WRITES`<br>`--allow-git-writes` | `false` | Permit gated abapGit mutations and `external_info` with `SAP_ALLOW_WRITES=true` and caller scope. Package-affecting actions also enforce the real package. gCTS mutations remain refused. An incomplete abapGit result may follow a mutation; inspect state before retrying. See [SAPGit](tools/sap-git.md). |
| `SAP_ALLOWED_PACKAGES`<br>`--allowed-packages` | `$TMP` | Write package allowlist: exact name (`ZFOO`), prefix (`Z*`), subtree (`ZFOO/**`), or unrestricted (`*`). Default `$TMP`. Reads are not package-gated. See [Package patterns](#package-patterns). |
| `SAP_ALLOWED_TRANSPORTS`<br>`--allowed-transports` | `[]` | Advanced: CTS ID allowlist. Empty (default) = legacy unrestricted/no per-transport filter; `*` is explicit unrestricted. Exact/prefix entries can constrain single-ID mutations, but deliberately block `release_recursive`: SAP may attach/fold a concurrent child into the live subtree, so only empty or explicit `*` can authorize that action. Use either only when every current/concurrent child is intended to be released. |
| `SAP_DENY_ACTIONS`<br>`--deny-actions` | `[]` | Fine-grained per-action denylist. Grammar: `Tool`, `Tool.action`, `Tool.glob*`. Example: `SAPWrite.delete,SAPManage.flp_*`. Accepts a CSV string or a `path/to/file.json` containing an array. Denylisted actions are both hidden from tool listings and blocked at call time. See [authorization.md → Advanced deny actions](authorization.md#advanced-deny-actions). |

### Recipes

| Goal | Set these flags |
|---|---|
| Read/search only (default) | nothing |
| Read + table preview | `SAP_ALLOW_DATA_PREVIEW=true` |
| Read + table preview + freestyle SQL | `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true` |
| Approved data/SQL plus experimental source brake | `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true SAP_BLOCKED_DATA_SOURCES=USR02,PA0002` |
| Writes to `$TMP`/`Z*` | `SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='$TMP,Z*'` |
| Writes confined to one team's DEVCLASS subtree | `SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='$TMP,ZFOO/**'` (uses `TDEVC.PARENTCL` — names of children don't need to share a prefix) |
| Writes + CTS transports | `SAP_ALLOW_WRITES=true SAP_ALLOW_TRANSPORT_WRITES=true` |
| Writes + Git mutations | `SAP_ALLOW_WRITES=true SAP_ALLOW_GIT_WRITES=true` |
| Block specific mutations even with writes on | `SAP_DENY_ACTIONS=SAPWrite.delete,SAPManage.flp_*` |

Shell-quote package patterns with `*` or `$TMP`: `-e SAP_ALLOWED_PACKAGES='*'` or `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. In `.env` files no extra quoting needed.

### Blocklist syntax and limits

`SAP_BLOCKED_DATA_SOURCES` accepts exact ASCII identities, uppercased and deduplicated in input
order, with at most 128 characters per name. Unset, empty, or ASCII whitespace means off. Once
non-empty, every comma-separated field must be present: `USR02,` or `USR02,,PA0002` fails startup.
Values are validated before case folding and are not silently removed.

An active list adds strict SQL validation and fresh live lineage reads. Unsupported SQL or unresolved
lineage fails closed; direct blocked names are refused without contacting SAP. The metadata check
and data read are not atomic. Metadata authorization failures can deny a query SAP itself would allow.

The list only narrows already enabled data access. Unlisted sources remain eligible, and generic
extension HTTP GETs are outside its scope. It also affects internal table reads and applies globally
in multi-target mode. Use `TABLE_QUERY` for filters; filtered `TABLE_CONTENTS` is refused. See
[the supported grammar and impact matrix](authorization.md#experimental-data-source-blocklist).
Keep SAP roles and CDS DCL as the primary controls and apply SAP Note 3772411 independently.

### Package patterns

| Pattern | Matches |
|---|---|
| `ZFOO` | Exactly that package |
| `Z*`, `/COMPANY/*` | Literal name prefix |
| `ZFOO/**`, `/COMPANY/THING/**` | Package plus its transitive subpackages |
| `*` | Every package |

Subtrees follow `TDEVC.PARENTCL`, resolved through ADT `repository/nodestructure` and cached for
10 minutes. Package create/delete/move invalidates the cache. Resolution failures deny the write.
Shell-quote `$TMP` and wildcard patterns; for example `SAP_ALLOWED_PACKAGES='$TMP,ZFOO/**'`.

API-key profile note: `developer`, `developer-data`, and `developer-sql` profiles are intentionally capped to `$TMP` regardless of `SAP_ALLOWED_PACKAGES`. For Z-package writes via API keys use a tightly scoped `admin` key with a narrow server-side `SAP_ALLOWED_PACKAGES`, or use OIDC/XSUAA for per-user scopes.

## Server runtime

How ARC-1 itself listens for MCP traffic.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_TRANSPORT`<br>`--transport` | `stdio` | `stdio` (subprocess over stdin/stdout) or `http-streamable` (long-lived HTTP server). The Docker image overrides this to `http-streamable` by default. |
| `ARC1_SERVER_NAME`<br>`--server-name` | `arc-1` | Server name advertised in the MCP `initialize` handshake. Give each direct-connect instance a unique name when running several ARC-1 instances so clients can derive a target-specific tool prefix without numeric collision suffixes. |
| `ARC1_SYSTEM_LABEL`<br>`--system-label` | empty | Optional human-readable label of the connected SAP system (for example `ERP production (read-only)`). It is normalized to one line, limited to 160 characters, and prepended to the single-target MCP instructions so a model can distinguish instances even when a client replaces the handshake name with an opaque connector ID. Ignored in multi-target mode, whose target-aware instructions remain authoritative. |
| `ARC1_HTTP_ADDR` / `SAP_HTTP_ADDR`<br>`--http-addr` | `0.0.0.0:8080` | Bind address for HTTP streamable. Use `127.0.0.1:3000` to restrict to localhost. `SAP_HTTP_ADDR` is the legacy fallback name. |
| `ARC1_PORT`<br>`--port` | `8080` | Simpler alternative when only the port needs to change. Wins over `ARC1_HTTP_ADDR`'s port if both are set. Valid range `1–65535`. |
| `ARC1_UI`<br>`--ui[=MODE]` | `off` | Experimental read-only browser console. `off` disables it. `local` starts a loopback sidecar UI at `ARC1_UI_ADDR` for stdio/Claude-style local use. `web` mounts `/ui` and `/ui/api/*` on the HTTP server and requires an admin API key, OIDC, or XSUAA auth. `true` maps to `local` for stdio and `web` for HTTP. |
| `ARC1_UI_ADDR` / `ARC1_UI_PORT`<br>`--ui-addr` / `--ui-port` | `127.0.0.1:8711` | Bind address for `ARC1_UI=local`. Local mode must stay on loopback; use `ARC1_UI=web` with `SAP_TRANSPORT=http-streamable` for Docker or CF exposure. |
| `ARC1_UI_OPEN`<br>`--ui-open` | `false` | Opens the local sidecar UI in the system browser after startup. Intended for developer machines only. |
| `ARC1_ALLOWED_ORIGINS`<br>`--allowed-origins` | (empty) | Comma-separated CORS allowlist for **browser-based** MCP clients. Exact match only (no wildcards — the response sets `Access-Control-Allow-Credentials: true`). Preflight allows the MCP protocol headers (`mcp-session-id`, `mcp-protocol-version`, `last-event-id`). Empty disables CORS entirely. Native clients (Claude Desktop / Cursor / VS Code Copilot / Copilot Studio) don't need this. See [security-guide.md §11](security-guide.md#11-network-security). |
| `ARC1_PUBLIC_URL` | (auto from `VCAP_APPLICATION`, else bind host:port) | Public URL ARC-1 advertises in OAuth metadata (issuer, `authorize`/`token`/`register`/`revoke` URLs, protected-resource metadata, `WWW-Authenticate` headers). Set this when ARC-1 is reached through a reverse proxy on a different hostname or under a base-path prefix — without it, MCP clients receive metadata pointing at the underlying host and bypass the proxy. Path prefix supported (e.g. `https://gateway.example.com/arc1`); the well-known endpoints are also served at that prefix. Trailing slash stripped. |
| `ARC1_MAX_CONCURRENT`<br>`--max-concurrent` | `10` | Maximum concurrent in-flight SAP HTTP requests, **server-wide across all users** (not per-client). One shared `Semaphore` gates every `AdtClient`, including per-user PP clients. Honors `Retry-After` on `429`/`503` (clamped to 60 s, single retry). Size against `rdisp/wp_no_dia`. See [Rate Limiting Guide](rate-limiting.md). |
| `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES`<br>`--max-datapreview-response-bytes` | `2097152` (2 MiB) | Cumulative successful data-preview response allowance for one complete tool call, including automatic query chunks and internal table reads. Counts decompressed transfer bytes before UTF-8/string conversion. A result that crosses it fails with `DATA_RESPONSE_TOO_LARGE`; retry with lower `maxRows`, fewer columns, or a restrictive non-overlapping key-range `WHERE`. `maxRows` is separately clamped to 10,000, but wide rows can reach this byte limit much earlier. |
| `ARC1_MAX_CONCURRENT_DATA_RESULTS`<br>`--max-concurrent-data-results` | `2` | Process-wide data-result calls admitted concurrently across single-target, PP, pinned, and aggregate routes. The FIFO lease is held through SAP fetch, XML parsing, tool-result serialization, and terminal audit, while ordinary source/metadata reads do not use it. If increasing the byte allowance, benchmark bounded peak RSS and normally lower this value proportionally. |

Both data-result values must be positive base-10 safe integers. An explicitly empty, malformed,
fractional, signed, zero, negative, exponent-form, or unsafe value fails startup; `0` is not a
disable switch. Their product is logged as the raw-body admission envelope (4 MiB by default), but
that product is not a heap guarantee because XML parsing and JSON serialization amplify memory.
For BTP Cloud Foundry, use the
[data-preview RAM sizing model and parameter table](btp-administration.md#data-preview-ram-sizing)
before increasing either value.

The UI is experimental, off by default, and inspection-only in v1: sanitized config, safety/auth state, feature-probe status, cache counts/source metadata, and recent sanitized audit events. It does not expose writes, config mutation, cache mutation, feature probes, or cached ABAP source bodies. In HTTP mode, ARC-1 refuses `ARC1_UI=web` unless an admin API key, OIDC, or XSUAA auth is configured, and every `/ui/*` route requires an `admin`-scoped bearer token. When `ARC1_UI=off`, no `/ui` static or API routes are mounted. On BTP CF, use `mta-ui-approuter.mtaext` for browser login via SAP AppRouter.

ARC-1 also sets standard browser security headers (HSTS, CSP and X-Frame-Options) on every HTTP response via [helmet](https://helmetjs.github.io/). COOP is disabled for OAuth popup compatibility. There is no flag to disable the remaining headers. Header details in [Production security](security-guide.md#11-network-security).

### Rate limiting

Three rate-limit knobs cover the OAuth HTTP edge, MCP HTTP edge, and per-user MCP quota.
`ARC1_MAX_CONCURRENT` above is the separate SAP-bound concurrency control. See the
[Rate Limiting Guide](rate-limiting.md) for the threat model, sizing math, shared multi-target profile,
and audit-event reference.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `ARC1_AUTH_RATE_LIMIT`<br>`--auth-rate-limit` | `20` | **Layer 1 OAuth.** Per-IP cap on `/register`, `/authorize`, `/token`, `/revoke`, and callback requests per minute. When `ARC1_MCP_HTTP_RATE_LIMIT` is unset, the MCP cap remains derived as `max(value × 30, 600)`. Set `0` to disable OAuth limiting (use only behind a rate-limiting reverse proxy). |
| `ARC1_MCP_HTTP_RATE_LIMIT` | unset (derived) | **Layer 1 MCP.** One process-wide per-IP cap shared by single-target, pinned, aggregate, and Copilot JSON-RPC `/authorize` traffic. Unset preserves `max(ARC1_AUTH_RATE_LIMIT × 30, 600)`; `0` explicitly disables this MCP-edge limiter; a positive integer replaces the derivation. |
| `ARC1_RATE_LIMIT`<br>`--rate-limit` | `0` (disabled) | Per-user MCP calls per minute; `0` disables the quota. Stdio is exempt. A hit returns an MCP `rate_limited` tool error with `retryAfter` and emits `mcp_rate_limited`, rather than HTTP 429. See [rate-limit identity and sizing](rate-limiting.md). |


## Caching

ARC-1 normally revalidates cached source with SAP ETags. Successful activation can create a 120-second freshness guard; see [caching](caching.md#after-activation) for the exception and `force_refresh` behavior.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `ARC1_CACHE`<br>`--cache` | `auto` | `auto` uses the in-process memory cache for every transport. `memory` = in-process only, lost on restart. `sqlite` = persistent across restarts, shared across processes that point at the same file, and explicit opt-in because it stores source bodies at rest. `none` = disable caching entirely (every read hits SAP). |
| `ARC1_CACHE_FILE`<br>`--cache-file` | `.arc1-cache.db` | SQLite file path when `ARC1_CACHE=sqlite`. Created on first use. |

!!! warning "`ARC1_CACHE=sqlite` stores SAP source in cleartext at rest"
    The default `ARC1_CACHE=auto` mode does not create a SQLite cache file. If you explicitly set `ARC1_CACHE=sqlite`, the cache holds full ABAP source unencrypted at `.arc1-cache.db`. ARC-1 creates and repairs the cache DB and file audit sink (`ARC1_LOG_FILE`) with owner-only file permissions (`0600`), but this is not encryption. For IP-sensitive landscapes keep `ARC1_CACHE=auto`/`memory` or `none`, or place persistent files on an encrypted volume with restricted access.


## Logging and observability

Logs go to **stderr**; stdout is reserved for MCP or CLI output.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `ARC1_LOG_FILE`<br>`--log-file` | — | Additional JSON-line audit file. Receives all audit events regardless of stderr level; ordinary startup logger messages are not copied to it. |
| `ARC1_LOG_LEVEL`<br>`--log-level` | `info` | One of `debug` / `info` / `warn` / `error`. Filters the stderr audit sink; the audit file retains all event levels. Use `SAP_VERBOSE` for ordinary server debug messages. |
| `ARC1_LOG_FORMAT`<br>`--log-format` | `text` | `text` (human-readable) or `json` (one JSON object per line — for shipping to ELK / Loki / CF log aggregator). |
| `ARC1_MINIMAL_ERRORS`<br>`--minimal-errors` | `false` for stdio, `true` for HTTP | When `true`, client-facing tool errors hide SAP diagnostic details such as lock owners, transport IDs, T100 variables, and authorization object names. HTTP deployments default to minimal errors because they are commonly shared or remotely reachable; stdio keeps detailed local diagnostics. Server-side audit logs retain request correlation and status data; use SAP-native logs or a trusted admin retry for full diagnostics. Set `ARC1_MINIMAL_ERRORS=false` only for trusted debugging sessions. |
| `SAP_VERBOSE`<br>`--verbose` | `false` | Enable ordinary server debug messages and set the audit log level to `debug`. `ARC1_LOG_LEVEL=debug` alone does not enable ordinary debug messages. |
| `ARC1_LOG_HTTP_DEBUG` | `false` | When `"true"`, captures HTTP request/response body fields and headers on `http_request` audit events. Sensitive headers (`Authorization`, `Cookie`, CSRF tokens) are redacted immediately; payload bodies are length-capped and centrally redacted before sink writes. **Do not enable in production** — it still increases log volume and records payload-size/timing metadata. **Boolean parsing inconsistency:** unlike other booleans, this one accepts only the literal string `"true"` — `"1"` does **not** work. |


## ABAP feature toggles

Each toggle gates a class of ADT tools that depend on a SAP component being installed or active. All default to `auto` — ARC-1 probes the SAP system on startup. Override to `on`/`off` when probing is wrong, slow, or you want deterministic behaviour in tests.

When a feature is `off` (either set explicitly or detected as unavailable), every tool action that depends on it is hidden from tool listings *and* rejected at call time with a clear error.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_FEATURE_ABAPGIT`<br>`--feature-abapgit` | `auto` | abapGit ADT bridge (`/sap/bc/adt/abapgit/*`). Required for `SAPGit` actions that talk to abapGit. |
| `SAP_FEATURE_GCTS`<br>`--feature-gcts` | `auto` | gCTS Git backend (`/sap/bc/cts_abapvcs/*`). Required for `SAPGit` actions that talk to gCTS. |
| `SAP_FEATURE_RAP`<br>`--feature-rap` | `auto` | RAP behavior definitions, services, drafts. Required for `SAPWrite` of BDEF/SRVD/SRVB and the RAP-specific code-intel and preflight tools. |
| `SAP_FEATURE_AMDP`<br>`--feature-amdp` | `auto` | ABAP Managed Database Procedures. Required for AMDP-specific read/write paths. |
| `SAP_FEATURE_UI5`<br>`--feature-ui5` | `auto` | UI5 application development tools (general). |
| `SAP_FEATURE_UI5REPO`<br>`--feature-ui5repo` | `auto` | UI5 ABAP Repository OData service. Required for `SAPRead(type="BSP_DEPLOY")` deployment metadata. |
| `SAP_FEATURE_FLP`<br>`--feature-flp` | `auto` | FLP `PAGE_BUILDER_CUST` OData service. Required for `SAPManage` FLP page/role mutations. |
| `SAP_FEATURE_TRANSPORT`<br>`--feature-transport` | `auto` | CTS transport endpoints. Required for `SAPTransport` (even reads). |
| `SAP_FEATURE_HANA`<br>`--feature-hana` | `auto` | HANA-specific developer tools. |

For these nine switches, `auto` treats 401/403/404 or network failure as unavailable; other endpoint responses indicate presence. HANA also has component/discovery fallbacks. Presence does not prove a complete operation will succeed. Separate probes, such as source-code search, use their own status rules. Inspect the reason in startup logs or `SAPManage(action="features")`.


## Code-quality gates

Optional checks before supported source writes.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `SAP_LINT_BEFORE_WRITE`<br>`--lint-before-write` | `true` | Lint supported source types before writing. Errors block the write; warnings do not. Parser errors above the supported grammar release are warnings. `false` skips this lint layer; other checks still apply. Some types, including `FUNC`, are exempt. |
| `SAP_ABAPLINT_CONFIG`<br>`--abaplint-config` | — (uses built-in preset) | Path to a custom `abaplint.jsonc`. When unset, ARC-1 builds a preset config based on the detected system type (cloud-strict for BTP, relaxed for on-prem). Custom config takes full precedence. |
| `SAP_CHECK_BEFORE_WRITE`<br>`--check-before-write` | `false` | Run a SAP-side syntax check before save. Diagnostic findings are appended without blocking the write. Adds a SAP round-trip; activation remains the definitive check. |

## Tool mode

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `ARC1_TOOL_MODE`<br>`--tool-mode` | `standard` | `standard` exposes 12 intent tools. `hyperfocused` exposes one `SAP` tool with a smaller schema that routes the same operations. |
| `ARC1_SCHEMA_NULLABLE_OPTIONALS`<br>`--schema-nullable-optionals` | `auto` | Optional SAPWrite fields as nullable JSON Schema unions: `auto` currently resolves to `off`; `off` emits plain types; `on` permits nulls for clients requiring strict-mode compatibility. Some clients reject unions, so test before enabling. See [issue #520](https://github.com/arc-mcp/arc-1/issues/520). |


<span id="extensions-feat-61"></span>

## Extensions

Load your own `Custom_*` tools (the [extension framework](extensions.md)). Plugins are **trusted
in-process code** — see the security note on that page before enabling.

| Setting (environment / CLI) | Default | Effect |
| --- | --- | --- |
| `ARC1_PLUGINS`<br>`--plugins` | — (none) | Comma-separated absolute local `.js` or `*.tool.json` paths. No npm names or shell-variable expansion. Remove a path and restart to disable that plugin; `SAP_DENY_ACTIONS` cannot match `Custom_*` tool names. Loads once at startup; invalid paths, collisions, or malformed plugins refuse startup. POSIX requires server ownership and no world-write permission; Windows uses ACLs. See [Extensions](extensions.md). |
| `SAP_ALLOW_PLUGIN_EXECUTE`<br>`--allow-plugin-execute` | `false` | Allow `ctx.run.classRun` only with `SAP_ALLOW_WRITES=true` and a `write`-scoped tool/caller. `true`/`1` enable it; false/empty remain off. |
| `SAP_ALLOW_PLUGIN_RAW_WRITES`<br>`--allow-plugin-raw-writes` | `false` | Allow plugin POST/PUT/DELETE to non-ADT OData/ICF paths, only with `SAP_ALLOW_WRITES=true` and a `write`-scoped tool/caller. `/sap/bc/adt/` writes remain refused. Package allowlists do not constrain OData/ICF calls. `true`/`1` enable it. |


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


## See also

- [Configuration Precedence](configuration-precedence.md) — CLI vs env vs `.env`, and what changes across npx / local / Docker / BTP.
- [Authorization & Roles](authorization.md) — three-layer model, scope semantics, capability requirements.
- [Enterprise Auth](enterprise-auth.md) — Layer A / Layer B coexistence matrix.
- [`.env.example`](https://github.com/arc-mcp/arc-1/blob/main/.env.example) — grouped template with inline commentary.
- Effective config at startup: ARC-1 logs `auth: MCP=[…] SAP=…` and a safety summary line on every boot. When in doubt, read that first.
