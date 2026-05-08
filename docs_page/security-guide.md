# Security Best Practices Guide

A consolidated security reference for ARC-1 operators. This guide covers hardening, authentication, authorization, and incident response. It references detailed setup guides where appropriate rather than duplicating their content.

---

## 1. Security Architecture Overview

ARC-1 enforces authorization at three stacked gates. All relevant gates must allow an operation for it to succeed.

| Layer | What it checks | Controlled by |
|-------|---------------|---------------|
| **Server ceiling** | Positive opt-in flags such as `SAP_ALLOW_WRITES`, `SAP_ALLOW_FREE_SQL`, `SAP_DENY_ACTIONS` | ARC-1 administrator |
| **User permission** | Scopes from XSUAA/OIDC JWTs or API-key profiles | BTP/IdP/ARC-1 administrator |
| **SAP authorization** | SAP authorization objects (`S_DEVELOP`, `S_ADT_RES`, package auth, etc.) | SAP Basis / role admin |

Checks are additive: server ceiling AND user scope/profile AND SAP authorization must all pass. If any layer blocks, the operation fails. The server safety config acts as a hard ceiling - user scopes can only restrict further, never expand beyond server config.

For the full model, scope definitions, API-key profiles, and BTP role mapping, see [Authorization & Roles](authorization.md).

---

## 2. Authentication Methods and When to Use Each

| Scenario | Transport | MCP Client Auth | Recommended Guide |
|----------|-----------|----------------|-------------------|
| Local development (single user) | stdio | None | [Local Development](local-development.md) |
| Shared server (single access level) | HTTP | One `ARC1_API_KEYS` entry | [API Key Setup](api-key-setup.md) |
| Team server (role-based access) | HTTP | Multiple API keys with profiles | [API Key Setup](api-key-setup.md) |
| Enterprise (per-user identity) | HTTP | OIDC / JWT | [OAuth / JWT Setup](oauth-jwt-setup.md) |
| Enterprise + SAP audit trail | HTTP | OIDC / JWT + Principal Propagation | [OAuth / JWT](oauth-jwt-setup.md) + [PP Setup](principal-propagation-setup.md) |
| BTP Cloud Foundry | HTTP | XSUAA OAuth | [XSUAA Setup](xsuaa-setup.md) |

When XSUAA is enabled, all three auth methods are active in a fallback chain: XSUAA first, then OIDC, then API key. This allows coexistence of BTP users, external IdP users, and service accounts.

For the full decision guide and common combinations, see [Authentication Overview](enterprise-auth.md).

---

## 3. OIDC/JWT Configuration Checklist

When using an external identity provider (Entra ID, Okta, Keycloak, etc.), configure these environment variables or CLI flags:

| Variable / Flag | Required | Description |
|----------------|----------|-------------|
| `SAP_OIDC_ISSUER` / `--oidc-issuer` | **Yes** | OIDC issuer URL. Must match the `iss` claim in tokens. |
| `SAP_OIDC_AUDIENCE` / `--oidc-audience` | **Yes** | Expected `aud` claim value. For Entra ID v2.0, this is the raw client ID GUID. For v1.0, it is `api://{client-id}`. |
| `SAP_OIDC_CLOCK_TOLERANCE` / `--oidc-clock-tolerance` | No | Clock skew tolerance in seconds for `exp`/`nbf` validation. Default: 0. Useful when server and IdP clocks drift. |

Verification checklist:

- [ ] `SAP_OIDC_ISSUER` matches the `iss` claim in your tokens exactly (trailing slashes matter).
- [ ] `SAP_OIDC_AUDIENCE` matches the `aud` claim in your tokens (decode a token at jwt.ms to verify).
- [ ] The OIDC provider includes ARC-1 scopes (`read`, `write`, `data`, `sql`, `transports`, `git`, `admin`) in the `scope` or `scp` claim. Tokens without scope claims default to read-only access.
- [ ] The JWKS endpoint at `{issuer}/.well-known/openid-configuration` is reachable from the ARC-1 server.
- [ ] TLS certificates on the issuer URL are valid (no self-signed certs without `--insecure`).

ARC-1 validates tokens per the OAuth 2.0 Protected Resource model (RFC 9700): signature verification via JWKS, issuer match, audience match, and expiration check.

---

## 4. API Key Security

### Key Generation

Always use cryptographically random keys with sufficient entropy:

```bash
openssl rand -base64 32
```

### Per-Key Profiles

Use `--api-keys` to assign each key a profile with specific scopes and safety restrictions. The old single `--api-key` mode was removed because it made the access level ambiguous.

```bash
arc1 --api-keys "$VIEWER_KEY:viewer,$DEV_KEY:developer,$SQL_KEY:developer-sql"
```

### Key Rotation

- Rotate keys on a regular schedule (quarterly recommended) and immediately upon suspected compromise.
- Multi-key mode allows rolling rotation: add the new key, distribute it, then remove the old key.
- Audit logs include the profile name (e.g., `api-key:viewer`) to identify which key was used, aiding in compromise investigation.
- API key rotation requires updating all clients that use the affected key.

### Limitations

API keys identify roles, not individuals. They do not support per-user SAP audit trails. For user-level identity, use OIDC or XSUAA.

For full setup instructions, see [API Key Setup](api-key-setup.md).

---

## 5. Safety Configuration Best Practices

All safety flags are **positive opt-ins** (default: `false` / restrictive). Enable only what you need.

### SAP API Policy alignment

The April 2026 [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) is accompanied by an [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html). The FAQ section *"How does the policy apply to ADT-based access and developer tooling?"* explicitly endorses ADT-based developer tooling — including "**custom developer utilities built on the documented Eclipse Java SDK for internal development automation such as code checks, build processes, and transport management**". ARC-1 used for internal development is aligned with that endorsement.

ARC-1 is designed to stay within the ADT development-tooling scope described in SAP's API Policy FAQ v1.1. It uses documented ADT / Eclipse SDK capabilities for internal development-related use cases and does not expose ADT Data Preview, SQL execution, table reads, or business-data extraction.

When ARC-1 is used with AI assistants or MCP clients, customers should apply additional governance for AI-driven or automated access patterns, including real user identity, authorization checks, audit logging, rate limits, conservative tool exposure, and customer-side review against SAP documentation and agreements.

The same FAQ also lists what ADT APIs are **not** intended for: "**programmatic reading of application tables or export of business data, SQL execution against SAP backend systems, business data integration or runtime orchestration, agentic AI workflows operating on business data, or substitution for business APIs**".

Two ARC-1 capabilities sit outside the endorsed-development-tooling scope and require explicit env vars before they are reachable:

| Capability | Env var | Default | Policy note |
| ---------- | ------- | ------- | ----------- |
| Named table content preview (`SAPRead(type=TABLE_CONTENTS)`) | `SAP_ALLOW_DATA_PREVIEW=true` | `false` (off) | Reading application tables / exporting business data is excluded by the FAQ. Keep off for the policy-aligned development use case. |
| Freestyle ABAP SQL (`SAPQuery`) | `SAP_ALLOW_FREE_SQL=true` | `false` (off) | SQL execution against SAP backend systems is excluded by the FAQ. Keep off for the policy-aligned development use case. |

**Recommendation for productive systems:** keep both flags at their defaults. ARC-1 still covers the full developer-tooling surface — read source/metadata, search, navigate, lint, write/activate ABAP objects, manage transports, drive Git workflows. Turning either flag on is a customer decision against the SAP API Policy, the customer's SAP agreement, and the customer's internal data-protection rules.

### Recommended production defaults

| Setting                            | Recommended | Rationale                                                                                      |
|------------------------------------|-------------|------------------------------------------------------------------------------------------------|
| `SAP_ALLOW_WRITES`                 | `false` unless writes are needed | Blocks every mutation — object writes, activation, transport writes, git writes. |
| `SAP_ALLOW_FREE_SQL`               | `false` on sensitive systems | Blocks arbitrary SQL queries against the database via `SAPQuery`.                               |
| `SAP_ALLOW_DATA_PREVIEW`           | `false` unless table preview is required | Blocks named table content preview.                                              |
| `SAP_ALLOWED_PACKAGES`             | `$TMP` or `Z*,Y*,$TMP` | Restricts writes to custom-code packages. Reads are never package-gated.                           |
| `SAP_ALLOW_TRANSPORT_WRITES`       | `false` unless CTS needed | Opt-in for transport mutations (`SAPTransport.create`/`release`/`delete`).                           |
| `SAP_ALLOW_GIT_WRITES`             | `false` unless Git needed | Opt-in for abapGit/gCTS mutations (`clone`/`pull`/`push`/`commit`).                                 |
| `SAP_DENY_ACTIONS`                 | Use for fine-grained blocks | E.g. `SAPWrite.delete,SAPManage.flp_*` — overrides scope + flag checks.                              |
| `SAP_PP_STRICT`                    | `true` when PP is enabled | Rejects requests without user identity (no fallback to shared account).                              |

### API-key profiles (non-BTP multi-user)

For HTTP-streamable deployments without XSUAA/OIDC, use `ARC1_API_KEYS` with per-key profile names. Each profile maps to a scope set AND a partial SafetyConfig intersected with the server ceiling.

| Profile           | Scopes                                                  | Default `allowedPackages` |
|-------------------|---------------------------------------------------------|---------------------------|
| `viewer`          | `[read]`                                                | —                         |
| `viewer-data`     | `[read, data]`                                          | —                         |
| `viewer-sql`      | `[read, data, sql]`                                     | —                         |
| `developer`       | `[read, write, transports, git]`                        | `$TMP`                    |
| `developer-data`  | `[read, write, data, transports, git]`                  | `$TMP`                    |
| `developer-sql`   | `[read, write, data, sql, transports, git]`             | `$TMP`                    |
| `admin`           | all 7 scopes (implies everything)                       | (unrestricted)            |

A user's effective safety is always the intersection of (1) the server ceiling, (2) their profile's partial safety, and (3) their JWT scopes. Per-user config can only tighten, never widen.

Important: API-key `developer*` profiles are sandboxed to `$TMP` by design. If a key must write to transportable packages, use a tightly scoped `admin` key with a narrow server-side `SAP_ALLOWED_PACKAGES`, or use OIDC/XSUAA for per-user authorization.

Full authorization model: [authorization.md](authorization.md).

---

## 6. Scope Implications

ARC-1 scopes have transitive grants that operators should understand:

| Scope assigned | Scopes effectively granted | Reason |
|---------------|---------------------------|--------|
| `write` | `write` + `read` | A developer who can write can also read |
| `sql` | `sql` + `data` | A user who can run freestyle SQL can also preview tables |
| `admin` | all 7 scopes | Emergency/operator profile, still limited by server flags |
| `read` | `read` only | No transitive grants |
| `data` | `data` only | No transitive grants |
| `transports` | `transports` only | Specialized CTS scope; mutations also need `write` |
| `git` | `git` only | Specialized Git scope; mutations also need `write` |

This means:

- Assigning `write` without `read` is unnecessary -- `write` already includes `read`.
- Assigning `sql` without `data` is unnecessary -- `sql` already includes `data`.
- Assigning `data` does NOT grant `read` (source code access) -- these are independent dimensions.
- Assigning only `transports` or only `git` is not enough for mutations -- grant `write` as well.

The scope model separates several dimensions: **objects** (source code: `read`/`write`), **data** (table contents: `data`/`sql`), and **shared infrastructure** (CTS and Git: `transports`/`git`). A developer may need full source code access without being able to query production data, and vice versa.

---

## 7. Reverse Proxy Requirements

When deploying ARC-1 behind a reverse proxy (nginx, HAProxy, Traefik, etc.) outside of Cloud Foundry:

| Requirement | Details |
|-------------|---------|
| **TLS termination** | Terminate TLS at the proxy. ARC-1's HTTP listener does not handle TLS natively. |
| **Header sanitization** | Strip or overwrite `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` from incoming requests to prevent spoofing. Only the proxy should set these. |
| **Proxy headers** | Forward `Host`, `X-Real-IP`, and `X-Forwarded-For` to ARC-1 for accurate logging. |
| **Health check** | Expose `/health` without authentication for load balancer probes. |
| **Timeouts** | Set proxy read/write timeouts to at least 120 seconds. Some ADT operations (activation, unit tests) can take 30-60 seconds. |
| **Request size** | Allow request bodies up to at least 10 MB for large source code writes. |

Example nginx configuration is provided in the [API Key Setup](api-key-setup.md#behind-a-reverse-proxy-nginx) guide.

---

## 8. BTP-Specific Security

### XSUAA Role Collections

Scopes are assigned to BTP users via role templates and role collections in the BTP Cockpit. The seven scopes (`read`, `write`, `data`, `sql`, `transports`, `git`, `admin`) map to role templates (`MCPViewer`, `MCPDeveloper`, `MCPDataViewer`, `MCPSqlUser`, `MCPAdmin`) that are combined into role collections for assignment.

### Principal Propagation

When `SAP_PP_ENABLED=true`, each MCP user's JWT identity flows through to SAP via Cloud Connector or mTLS. SAP sees the real user identity for authorization checks and audit logging. Use `SAP_PP_STRICT=true` in production to reject requests without user identity.

### Destination Service

BTP Destination Service centralizes SAP connection details and credentials. ARC-1 resolves the destination at runtime. Use `SAP_BTP_DESTINATION` for shared-user destinations and `SAP_BTP_PP_DESTINATION` for principal propagation destinations.

If Cloud Connector uses path-level allowlists, include non-ADT OData routes needed by ARC-1 features, especially:
- `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` for FLP launchpad management (`SAPManage` FLP actions)
- `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` for UI5 ABAP Repository metadata reads

For detailed setup instructions:

- [XSUAA Setup](xsuaa-setup.md) -- role templates, role collections, xs-security.json
- [Principal Propagation Setup](principal-propagation-setup.md) -- Cloud Connector, CERTRULE, mTLS
- [BTP Destination Setup](btp-destination-setup.md) -- Destination Service configuration
- [Authorization & Roles: BTP XSUAA role templates](authorization.md#btp-xsuaa-role-templates) -- role-to-scope mapping

---

## 9. Audit Logging

ARC-1 emits structured audit events to all registered sinks. Three sink types are available:

| Sink | Activation | Output |
|------|-----------|--------|
| **Stderr** | Always active | JSON lines to stderr |
| **File** | Set `--log-file` / `ARC1_LOG_FILE` | JSON lines appended to a file |
| **BTP Audit Log** | Auto-detected from `VCAP_SERVICES` (requires `auditlog` premium plan) | Events sent to BTP Audit Log Service v2 API |

### What Gets Logged

| Event | Description |
|-------|-------------|
| `tool_call_start` | Tool name, arguments, user, client ID |
| `tool_call_end` | Duration, success/error status, error class, result size |
| `http_request` | HTTP method, ADT path, status code, duration |
| `http_csrf_fetch` | CSRF token fetch success/duration |
| `scope_denied` | Scope check failure (tool, required scope, user scopes) |
| `elicitation` | User confirmation prompts and responses |
| `oauth_client_registered` | XSUAA only: a new DCR `client_id` was minted (`/register`). Includes id length and redirect-URI count. |
| `oauth_client_lookup_failed` | XSUAA only: a `client_id` failed to resolve. `reason` ∈ {`unknown_prefix`, `malformed`, `bad_signature`, `invalid_payload`, `expired`}. Useful for spotting forgery / probing. |
| `oauth_redirect_uri_registered` | XSUAA only: a redirect URI was added at `/authorize` time to the pre-registered XSUAA default client. |
| `cors_rejected` | A browser request was blocked because its `Origin` header is not in `ARC1_ALLOWED_ORIGINS`. Includes origin, method, path. Useful for spotting misconfigured browser clients or probing. |

All events within a single MCP tool call share a `requestId` for correlation. Events include `user` and `clientId` fields when authentication is active.

### Retention

- **File sink**: Retention is the operator's responsibility. Implement log rotation (e.g., logrotate) for long-running deployments.
- **BTP Audit Log**: Retention is managed by the BTP Audit Log Service per the service plan.
- **Stderr**: Transient unless captured by a container runtime or log aggregator.

---

## 10. Secrets Management

The following files and values must never be committed to version control:

| Secret | Storage Recommendation |
|--------|----------------------|
| `.env` files | Listed in `.gitignore`. Use environment variables or mounted files in production. |
| SAP passwords (`SAP_PASSWORD`) | Inject via environment variable, secrets manager, or `cf set-env`. |
| API keys (`ARC1_API_KEYS`) | Store in a secrets manager (Vault, AWS Secrets Manager, Azure Key Vault). |
| BTP service keys (`SAP_BTP_SERVICE_KEY`) | Use `SAP_BTP_SERVICE_KEY_FILE` pointing to a mounted secret, not inline JSON. |
| Cookie files (`cookies.txt`) | Listed in `.gitignore`. Ephemeral by nature. |
| PP CA private key (`SAP_PP_CA_KEY`) | Store in HSM or secrets manager. This is the root of trust for principal propagation. |
| Client certificate keys (`SAP_CLIENT_KEY`) | Mount as a file with restricted permissions (0600). |

In containerized deployments, prefer mounted secrets (Kubernetes Secrets, CF user-provided services) over environment variables, as environment variables may appear in process listings or crash dumps.

---

## 11. Network Security

### OAuth Callback Server

The OAuth callback server (used for BTP ABAP browser login) binds exclusively to `127.0.0.1`. It is not reachable from the network. This prevents network-adjacent attackers from intercepting the OAuth authorization code.

### HTTP Streamable Transport

When ARC-1 runs with `--transport http-streamable`, the default bind address is `0.0.0.0:8080`. In production:

- Always place ARC-1 behind a TLS-terminating reverse proxy or load balancer.
- Restrict network access using firewall rules, security groups, or VPN.
- Without `--api-keys`, `--oidc-issuer`, or `--xsuaa-auth`, the HTTP endpoint is open to anyone who can reach the port.

### HTTP Security Headers (helmet)

When `--transport http-streamable` is active, every HTTP response (including `/health`, `/mcp`, OAuth endpoints) carries a curated set of browser security headers via [helmet](https://helmetjs.github.io/). These are always-on; there's no flag to disable them. Native MCP clients ignore these — they exist to harden the server when a browser ever reaches it.

| Header | Default value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | Force HTTPS for the host and its subdomains (180 days). |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' https: 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests; …` | Helmet's standard CSP. When CORS is enabled, only `style-src` is widened to allow inline styles for browser UIs; every other directive is preserved via `useDefaults: true`. |
| `Cross-Origin-Opener-Policy` | (not set) | **Disabled.** Microsoft Copilot Studio uses popup-based OAuth and relies on `window.open()` / `postMessage` to receive the redirect result. Any non-default COOP on `/authorize` (including `same-origin-allow-popups`) puts the popup in a separate browsing context group, severs the parent's window reference, and surfaces as "consent pop-up window has been closed unexpectedly". Helmet's stock `same-origin` has the same effect. ARC-1 renders no JS UI that would benefit from cross-origin isolation, so dropping COOP costs nothing. |
| `Cross-Origin-Resource-Policy` | `same-origin` (default) / `cross-origin` (when CORS is enabled) | Auto-relaxed when `ARC1_ALLOWED_ORIGINS` is set so browser clients can read responses cross-origin. |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type confusion attacks. |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking guard for older browsers without CSP support. |
| `Referrer-Policy` | `no-referrer` | Strips Referer on outbound navigations. |
| `Origin-Agent-Cluster` | `?1` | Asks browsers to isolate this origin's agent cluster. |
| `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection` | (helmet defaults) | Legacy / browser-quirk hardening. |

To verify the headers on a running deployment:

```bash
curl -sI https://<your-app-url>/health | \
  grep -iE 'strict-transport|content-security|cross-origin|x-content-type|x-frame|referrer'
```

### CORS for browser-based MCP clients (opt-in)

CORS is **off by default**. The four MCP clients shipped with the project — Claude Desktop, Cursor, VS Code Copilot, Copilot Studio — use native HTTP, not the browser fetch API, and never trigger CORS. Only enable CORS when a browser UI (custom playground, embedded client, internal dashboard) calls `/mcp` directly:

```bash
cf set-env arc1-mcp-server ARC1_ALLOWED_ORIGINS "https://your-ui.example.com,https://other.example.com"
cf restage arc1-mcp-server
```

Configuration rules:

- **Comma-separated, exact match.** No wildcards (`*`, `https://*.example.com`) — they are silently rejected.
- **Pairs with `credentials: true`.** ARC-1 sends `Access-Control-Allow-Origin: <reflected origin>` (never `*`) and `Access-Control-Allow-Credentials: true`. The wildcard form is incompatible with credentialed requests by browser policy.
- **Allowed methods:** `GET`, `POST`, `DELETE`, `OPTIONS`. Allowed request headers: `Content-Type`, `Authorization`, `mcp-session-id`. Exposed response headers: `mcp-session-id`.
- **Disallowed origins are silently dropped** by the browser, but ARC-1 emits a `cors_rejected` audit event server-side so misconfigured browser clients are observable. See [§9 Audit Logging](#what-gets-logged).
- **Browser-based DCR clients** (rare) hitting `POST /register` or `POST /authorize` from a foreign origin must be in the allowlist for the same reason native browser fetches are. See [Stateless DCR](xsuaa-setup.md#stateless-dcr) for the OAuth flow.

To verify CORS on a running deployment:

```bash
# Allowed origin → 204 + Allow-Origin reflected
curl -sI -X OPTIONS \
  -H "Origin: https://your-ui.example.com" \
  -H "Access-Control-Request-Method: POST" \
  https://<your-app-url>/mcp | \
  grep -i 'access-control\|vary'

# Disallowed origin → no CORS headers (and a cors_rejected audit event)
curl -sI -X OPTIONS \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST" \
  https://<your-app-url>/mcp | \
  grep -i 'access-control'   # expect: empty
```

### SAP Connection

- Use HTTPS for the SAP connection (`SAP_URL=https://...`) whenever possible.
- Avoid `--insecure` / `SAP_INSECURE=true` in production. If SAP uses an internal CA, configure it at the OS/Node.js level (`NODE_EXTRA_CA_CERTS` environment variable).
- BTP deployments route through Cloud Connector, which handles TLS termination to the on-premise SAP system.

---

## 12. Incident Response

### API Key Compromise

1. **Rotate immediately**: Remove the compromised key from `ARC1_API_KEYS` and restart ARC-1.
2. **Review audit logs**: Search for events with the compromised key's profile to assess the blast radius. Look for `tool_call_start` and `tool_call_end` events.
3. **Generate a new key**: `openssl rand -base64 32`. Distribute to legitimate users.
4. **Check for damage**: If the key had write access, review recent transport requests and object modifications in the SAP system (SM21, STMS).

### BTP Service Key Compromise

1. **Regenerate in BTP Cockpit**: Delete the compromised service key and create a new one.
2. **Update ARC-1 config**: Deploy the new service key file and restart.
3. **Review BTP audit logs**: Check for unauthorized access via the compromised credentials.

### JWT / OIDC Token Compromise

1. **Revoke at the IdP**: Disable the compromised user account or rotate the signing keys at the identity provider.
2. **Short-lived tokens limit exposure**: JWT tokens typically expire in minutes to hours. Verify your IdP's token lifetime configuration.
3. **Check ARC-1 audit logs**: Correlate the user's identity across `tool_call_start` events.
4. **If PP was active**: The attacker may have acted as the user in SAP. Check SAP security audit log (SM20) for the user's actions.

### PP CA Key Compromise

This is the most critical compromise scenario -- the CA key can mint certificates for any SAP user.

1. **Revoke the CA immediately**: Remove the CA certificate from SAP STRUST.
2. **Generate a new CA**: Create a new key pair and import the new certificate into STRUST.
3. **Update ARC-1**: Deploy the new CA key and certificate.
4. **Audit all SAP activity**: Review SM20 for all users during the compromise window.

---

## 13. Dependency & Supply-Chain Security

ARC-1 ships as an [npm package](https://www.npmjs.com/package/arc-1) and a [Docker image](https://github.com/marianfoo/arc-1/pkgs/container/arc-1) consumed by enterprise customers running on regulated landscapes (banks, government, defense, pharma). Customers will run their own image scanners (Aqua, Prisma Cloud, Microsoft Defender) against the published image and reject vulnerable artifacts. ARC-1 layers its own supply-chain controls on top of GitHub-native primitives so issues are caught upstream of those scanners.

### What runs in CI

| Control | Workflow | Severity gate |
|---|---|---|
| Dependabot — npm + GitHub Actions + Docker | `.github/dependabot.yml` | weekly + same-day security advisories |
| `npm audit` PR gate | `.github/workflows/test.yml` (`Security audit (npm audit)` step) | fails on `high` / `critical` |
| GitHub Dependency Review (PR diff) | `.github/workflows/dependency-review.yml` | fails on `high`; license allow/deny lists |
| CodeQL SAST (JavaScript/TypeScript) | GitHub Default Setup | findings on Security tab; PR check fails on `High or higher` |
| Trivy container scan — dev push | `.github/workflows/docker.yml` | non-gating; SARIF uploaded to Security tab |
| Trivy container scan — release | `.github/workflows/release.yml` | **gating**: fails the release on `HIGH` / `CRITICAL` |
| Workflow-level `permissions: contents: read` | all workflows | minimum `GITHUB_TOKEN` scope |
| Third-party action SHA pinning | `googleapis/release-please-action`, `docker/*`, `aquasecurity/trivy-action` | mitigates the `tj-actions/changed-files` 2024 supply-chain compromise class |
| npm provenance | `.github/workflows/release.yml` (`npm publish --provenance`) | every release tarball is Sigstore-attested |
| `SECURITY.md` policy | repo root | private vulnerability reporting + severity-tiered response SLAs |

GitHub-native repository toggles that should also be on (verified in Settings → Advanced Security):

- Dependabot alerts + security updates + version updates + grouped security updates + malware alerts
- Secret scanning + push protection
- Private vulnerability reporting

### Verifying the chain as an operator

```bash
# 1. npm package — verify the published tarball was built from this repo
npm install arc-1
npm audit signatures arc-1
# Expected: "audited <N> packages — verified <N> packages with Sigstore"

# 2. npm package — confirm no known vulnerabilities at install time
npm audit --audit-level=high
# Expected: "found 0 vulnerabilities"

# 3. Docker image — scan locally with the same scanner CI uses
trivy image ghcr.io/marianfoo/arc-1:<version> \
  --severity HIGH,CRITICAL \
  --exit-code 1
# Expected: exit 0, "No vulnerabilities found"

# 4. View the full advisory history for the project
open https://github.com/marianfoo/arc-1/security/advisories
```

### Reporting a vulnerability

See [`SECURITY.md`](https://github.com/marianfoo/arc-1/blob/main/SECURITY.md). Preferred channel is GitHub [Private Vulnerability Reporting](https://github.com/marianfoo/arc-1/security/advisories/new); fallback is email. Do **not** open a public issue or post on the SAP Community before the maintainers acknowledge the report — that bypasses coordinated disclosure and can put deployed instances at risk.

### Roadmap

This section corresponds to roadmap entry **SEC-11 (Tier 1: Foundation)**. Future tiers extend the chain:

- **Tier 2 (Attestation)** — CycloneDX SBOM (npm + image), Cosign keyless image signing, OpenSSF Scorecard. Plan in [`docs/plans/dependency-security-tier2-attestation.md`](https://github.com/marianfoo/arc-1/blob/main/docs/plans/dependency-security-tier2-attestation.md).
- **Tier 3 (Active Defense)** — Socket.dev PR review, vulnerability triage runbook, formal non-adoption decisions for Renovate / Snyk / SLSA L3. Plan in [`docs/plans/dependency-security-tier3-defense.md`](https://github.com/marianfoo/arc-1/blob/main/docs/plans/dependency-security-tier3-defense.md).
