# Production security

<a id="security-best-practices-guide"></a>

Review this page before exposing an ARC-1 HTTP server and after changing its access policy.
For initial configuration, use [Authentication](enterprise-auth.md) and [Authorization](authorization.md).

## Review access

<a id="1-security-architecture-overview"></a>

### Confirm the three permission gates

A request must pass the server ceiling, the caller's scopes/profile and SAP authorization.
Enable only required capabilities; no user role can widen the server ceiling.

<a id="2-authentication-methods-and-when-to-use-each"></a>

### Choose the identity model

Use XSUAA on BTP, OIDC for an external identity provider, or API keys for a shared technical SAP identity.
The [authentication chooser](enterprise-auth.md#choosing-your-setup) links each setup.

With PP enabled, set `SAP_PP_STRICT=true` explicitly to reject API-key/non-JWT tool calls.
If unset or `false`, API-key calls use the configured shared SAP client and startup warns about mixed identities.
JWT PP failures always return an error; they never fall back to the shared user.

<a id="3-oidcjwt-configuration-checklist"></a>

### Verify OIDC tokens

- Match `SAP_OIDC_ISSUER` to the token's `iss` and `SAP_OIDC_AUDIENCE` to its `aud`; both are required.
- Make the issuer's discovery document and its `jwks_uri` reachable from ARC-1 over trusted HTTPS.
- Verify intended scopes in `scope` or `scp`. ARC-1 grants fallback `read` when a verified token has no accepted ARC-1 scope.
- Check token expiry and server time. Use `SAP_OIDC_CLOCK_TOLERANCE` only for the required clock skew.

Inspect claims locally; decoding a JWT does not validate its signature. See [OIDC setup](oauth-jwt-setup.md).

<a id="4-api-key-security"></a>

### Protect API keys

<a id="key-generation"></a><a id="per-key-profiles"></a><a id="key-rotation"></a><a id="limitations"></a><a id="api-key-profiles-non-btp-multi-user"></a>

Use random keys (`openssl rand -base64 32`) and the least-privileged [profile](authorization.md#api-key-profiles-non-btp).
`developer*` keys are capped to `$TMP`. Keep keys out of tracked files and rotate compromised keys immediately.
For routine rotation, add the replacement, restart, update clients, then remove the old key and restart again.
Audit identifies API keys by profile, so it cannot distinguish people sharing that profile.

<a id="5-safety-configuration-best-practices"></a>

### Set the server ceiling

<a id="recommended-production-defaults"></a>

| Control | Production choice |
|---|---|
| `SAP_ALLOW_WRITES` | Keep `false` unless mutations are required |
| `SAP_ALLOWED_PACKAGES` | Restrict enabled writes to owned packages, preferably a subtree such as `ZTEAM/**` |
| `SAP_ALLOW_DATA_PREVIEW` | Keep `false` unless table access is required |
| `SAP_ALLOW_FREE_SQL` | Keep `false` unless caller-authored SQL is required |
| `SAP_ALLOW_TRANSPORT_WRITES` / `SAP_ALLOW_GIT_WRITES` | Enable only required families; both also need general writes |
| `SAP_DENY_ACTIONS` | Deny individual operations, for example `SAPWrite.delete` |
| `SAP_PP_STRICT` | Explicit `true` for a per-user-only instance |

Package rules restrict writes, not reads. SAP roles remain responsible for read restrictions.
SAP-resident source, comments and errors are untrusted model input; package restrictions also limit the impact of a steered agent.

#### SAP API Policy and data-access gates

Review productive data access against [SAP API Policy & Architecture Alignment](sap-api-policy-and-architecture.md).
If structured preview is sufficient, enable `SAP_ALLOW_DATA_PREVIEW` and leave free SQL disabled.

`SAP_BLOCKED_DATA_SOURCES` adds an experimental exact-name blocklist with live dependency checks.
It does not enable data access, protect every output or replace SAP DCL. Unlisted sources remain eligible.
See the [full boundary and limitations](authorization.md#experimental-data-source-blocklist).
Apply SAP fixes independently; this default-off control is not remediation for SAP Note 3772411.

Git opt-in does not enable quarantined gCTS mutations. An accepted abapGit mutation may return
incomplete when its postcondition cannot be verified; inspect repository state before retrying.

<a id="6-scope-implications"></a>

### Match scopes to enabled actions

`write` implies `read`; `sql` implies `data`; `admin` implies all scopes.
Transport/Git mutations also need `write`. Use the [capability matrix](authorization.md#capability-requirements) to match scopes and flags.

## Configure network access

<a id="7-reverse-proxy-requirements"></a>

### Configure the reverse proxy

ARC-1's HTTP listener does not terminate TLS. Configure the proxy to:

1. Terminate HTTPS and restrict direct access to the ARC-1 port.
2. Replace untrusted `Forwarded` / `X-Forwarded-*` headers with the proxy's own values. ARC-1 trusts one proxy hop.
3. Forward the selected MCP paths and OAuth metadata/callback paths, including host-root well-known routes when using a base path.
4. Support streaming. Start proxy read/write timeouts at 120 seconds for activation and Unit tests; increase them to cover longer ATC/CI deadlines, then test the expected workload.
5. Use unauthenticated `/health` for process probes, then verify an authenticated SAP read separately.

Set `ARC1_PUBLIC_URL` to the external URL. ARC-1 currently uses the Express JSON-body default of
**100 KiB (102,400 bytes)** for the complete JSON request body, including JSON overhead. Larger writes
can receive HTTP `413` before tool dispatch. Raising a proxy limit does not raise this application
limit; there is no ARC-1 setting for it. See [Express JSON parsing](https://expressjs.com/en/api/express/).

<a id="11-network-security"></a>

### OAuth Callback Server

Local BTP ABAP browser OAuth binds its callback to `127.0.0.1`.

### HTTP Streamable Transport

The HTTP listener defaults to `0.0.0.0:8080`. Use loopback for local tests and a TLS proxy for network access.
HTTP without authentication requires explicit `ARC1_ALLOW_HTTP_NO_AUTH=true` for local development.

### HTTP Security Headers (helmet)

ARC-1 adds browser security headers to HTTP responses, including HSTS, CSP, `nosniff`, same-origin framing
and `no-referrer`. Cross-Origin-Opener-Policy is deliberately absent to support Copilot Studio OAuth popups.
Cross-Origin-Resource-Policy changes from `same-origin` to `cross-origin` when CORS is enabled.

```bash
curl -sSI https://arc1.example.com/health
```

### Read-only UI surface

`ARC1_UI` is experimental and off by default. Web UI routes require bearer authentication and `admin` scope;
local UI binds only to loopback. The UI shows sanitized state and metadata, not mutation controls, cached source bodies or secrets.
For BTP browser login, use the optional AppRouter. See [UI settings](configuration-reference.md).

### CORS for browser-based MCP clients (opt-in)

Enable CORS only for browser applications calling ARC-1 across origins. Native HTTP clients do not need it.
Set exact origins in the deployment configuration, then restart:

```text
ARC1_ALLOWED_ORIGINS=https://your-ui.example.com,https://other.example.com
```

Origins are compared literally: `*` and wildcard hostnames do not match browser origins. Allowed origins receive credentialed responses with their exact origin reflected.
Allowed methods are `GET`, `POST`, `DELETE`, `OPTIONS`; request headers are `Content-Type`, `Authorization`,
`mcp-session-id`, `mcp-protocol-version`, `last-event-id`. The exposed response header is `mcp-session-id`.
Disallowed browser origins receive no CORS permission and produce `cors_rejected` events; CORS is not authentication.

```bash
curl -si -X OPTIONS https://arc1.example.com/mcp \
  -H 'Origin: https://your-ui.example.com' \
  -H 'Access-Control-Request-Method: POST'
```

Expect `204` and the matching `Access-Control-Allow-Origin`. Repeat with an unlisted origin; it must not receive that header.

### SAP Connection

Use HTTPS and trusted certificates. For an internal CA, set `NODE_EXTRA_CA_CERTS=/path/to/ca.crt`.
Keep `SAP_INSECURE=false` in production.

## Check the BTP deployment

<a id="xsuaa-role-collections"></a><a id="principal-propagation"></a><a id="destination-service"></a>

<a id="8-btp-specific-security"></a>

Use the [BTP runbook](btp-cloud-foundry-deployment.md) for service ownership, roles and connectivity.
Keep DCR registrations stable with a dedicated [signing secret](xsuaa-setup.md#stable-dcr-signing-key-recommended).

For PP, verify the human identity in SAP after a safe read. For BTP ABAP, use `OAuth2UserTokenExchange`;
local browser service-key OAuth is not the deployed-server path.

Experimental multi-target Basic requires explicit enablement, a least-privileged shared SAP user,
exactly one CF instance and no overlapping rolling/blue-green deployment. Human attribution then comes from ARC-1 audit records.
See [Multi-system setup](multi-target-setup.md).

## Monitor the service

<a id="8a-layered-rate-limiting"></a>

### Control request load

Keep HTTP-edge abuse protection enabled. Size SAP concurrency against backend capacity and enable
per-user quotas when needed for shared access. Limits are per process; scaling multiplies them.
Use the [rate-limiting guide](rate-limiting.md) for defaults, sizing and failure signals.

<a id="9-audit-logging"></a>

### Retain and correlate audit logs

<a id="retention"></a>

Stderr receives audit events by default; `ARC1_LOG_FILE` adds a JSON-line file.
A bound BTP Audit Log premium service receives supported security/data categories.
See [Log Analysis](log-analysis.md) for queries and retention setup.

<a id="what-gets-logged"></a>

The [audit event reference](log-analysis.md#audit-event-reference) defines event names, fields and retention.
Events for one tool call share `requestId`; selected-target calls also carry public `target` and `identity`.
Secrets and response bodies are redacted before sink writes.

## Protect secrets and respond to incidents

<a id="10-secrets-management"></a>

### Store secrets

Inject SAP passwords, API keys, service credentials and DCR signing secrets through your deployment's secret handling.
Keep `.env`, cookie files, service keys and copied `VCAP_SERVICES` out of source control.
Use mounted files where supported; limit access to environment dumps, crash reports and backups.

<a id="12-incident-response"></a>

### Contain a compromise

<a id="api-key-compromise"></a><a id="btp-service-key-compromise"></a><a id="jwt-oidc-token-compromise"></a><a id="cloud-connector-pp-trust-compromise"></a>

| Compromised item | Immediate action | Evidence to review |
|---|---|---|
| API key | Remove it, restart ARC-1 and distribute a new key | Profile's tool calls; for write-enabled keys, recent transports/object changes in STMS and system messages in SM21. A shared profile limits attribution. |
| BTP service key | Revoke/replace it with its owner; update local files or destinations using it | BTP audit and affected consumers |
| JWT / OIDC token | Contain access with IAM/network owners and revoke affected sessions where supported | Token lifetime, user's ARC-1 calls and SAP actions if PP was enabled |
| Cloud Connector PP trust | Basis removes the compromised Connector CA from SAP STRUST, generates a new CA/key pair, rotates Connector PP certificates, then restores trust and checks subject-mapping rules | Review SM20 for all users during the compromise window |

Already-issued JWTs can remain valid until expiry; sign-out or role removal alone does not prove immediate revocation.
Preserve sanitized timestamps and request IDs before making recovery changes.

## Verify the release

<a id="github-native-security-features-verified-enabled"></a><a id="roadmap"></a>

<a id="13-dependency-supply-chain-security"></a>

Use pinned artifacts and inspect the checks for the release you deploy.
The repository includes npm dependency/audit checks, container scans, npm provenance and a production npm SBOM.
Release container scans and SBOM publication are non-gating; a published artifact is not proof of a clean scan.

### What runs in CI

See the [security workflows](https://github.com/arc-mcp/arc-1/tree/main/.github/workflows) and release results for the exact checks.
Runtime image rebuilds refresh Alpine packages; previously pulled images do not acquire fixes automatically.

### Verifying the chain as an operator

```bash
# 1. npm package — verify the published tarball was built from this repo
npm install arc-1@<version>
npm audit signatures
# Inspect signature/provenance verification results

# 2. npm package — download and inspect the production dependency SBOM
VERSION=REPLACE_WITH_VERSION
gh release download "v${VERSION}" \
  --repo arc-mcp/arc-1 \
  --pattern "arc-1-${VERSION}-sbom.cdx.json"
jq -e --arg version "$VERSION" '
  .bomFormat == "CycloneDX" and
  .metadata.component.name == "arc-1" and
  .metadata.component.version == $version and
  .metadata.component.type == "application"
' "arc-1-${VERSION}-sbom.cdx.json"
# Expected: true

# 3. npm package — confirm no known vulnerabilities at install time
npm audit --audit-level=high
# Review reported vulnerabilities at or above the threshold

# 4. Docker image — scan locally with the same scanner CI uses
trivy image ghcr.io/arc-mcp/arc-1:<version> \
  --severity HIGH,CRITICAL \
  --exit-code 1
# Exit 1 means the configured severity threshold was met

# 5. View the full advisory history for the project
open https://github.com/arc-mcp/arc-1/security/advisories
```

The release SBOM describes the production npm graph resolved from the root `package-lock.json`.
It does not inventory Alpine packages in the Docker image, the assembled MCPB contents, or
dynamically loaded extensions. Those artifacts need their own build-output SBOMs; do not use the
npm SBOM as evidence for their full contents.

SBOM publication is best-effort. If the asset is absent, inspect the release's `publish-npm-sbom` job; release success alone does not prove an SBOM was attached.

### Reporting a vulnerability

Follow [SECURITY.md](https://github.com/arc-mcp/arc-1/blob/main/SECURITY.md) and use
[private vulnerability reporting](https://github.com/arc-mcp/arc-1/security/advisories/new).
