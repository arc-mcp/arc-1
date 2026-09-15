# Authentication Test Process

Verify three things after an auth change: valid users can connect, invalid credentials are rejected,
and SAP uses the intended identity. Choose the section matching your deployment.

## Prerequisites

- An ARC-1 HTTP server configured through [API keys](api-key-setup.md), [OIDC](oauth-jwt-setup.md) or [XSUAA](xsuaa-setup.md).
- Its reviewed MCP URL and a valid key/token in your local shell as `ARC1_TEST_TOKEN`.
- A test user with source-read access; keep tokens out of logs and tickets.

```bash
ARC1_TEST_URL=https://arc1.example.com/mcp
```

These runtime checks do not require a source checkout or a build.

## API Key Setup

<a id="unit-tests"></a>

### Manual Integration Test

1. Without credentials, expect HTTP `401`:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "$ARC1_TEST_URL"
   ```

2. With incorrect credentials, expect HTTP `401`:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "$ARC1_TEST_URL" \
     -H 'Authorization: Bearer deliberately-invalid'
   ```

3. With the valid key, expect a JSON-RPC tool list:

   ```bash
   curl -sS "$ARC1_TEST_URL" \
     -H "Authorization: Bearer $ARC1_TEST_TOKEN" \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

4. In the MCP client, run `SAPRead(type="SYSTEM")`. Confirm the viewer's tool list excludes writes and SQL.

### HTTP Profile Manifest Smoke Test

For contributors with a prepared local auth test server:

```bash
npm run test:authz:http
```

The default URL is `http://127.0.0.1:19081/mcp` (`ARC1_AUTHZ_MCP_URL` overrides it).
The script expects `viewer-key-local`, `sql-key-local`, `dev-key-local`, `admin-key-local` and a ceiling
with writes, table preview, SQL and transports enabled; Git writes disabled.
It checks the visible actions for `viewer`, `viewer-sql`, `developer` and `admin` without SAP mutations.

## OAuth / JWT Setup

<a id="unit-tests_1"></a><a id="manual-integration-test_1"></a><a id="checklist_1"></a>

1. Repeat the missing, invalid and valid-token tests above with an issued JWT.
2. If OIDC discovery is enabled, inspect the protected-resource metadata:

   ```bash
   curl -fsS https://arc1.example.com/.well-known/oauth-protected-resource/mcp | jq .
   ```

   Verify `resource`, `authorization_servers` and the configured `scopes_supported` against the selected endpoint and IdP.
   With `SAP_OIDC_DISCOVERY=false`, metadata endpoints return `404`.
3. Confirm a `401` response includes the intended `WWW-Authenticate` metadata URL when discovery is enabled.
4. Sign in through the real MCP client and run one safe SAP read. Confirm the audit identity and permitted tools.
5. After changing roles, obtain a fresh token and reload the tool catalog. See [XSUAA scope diagnosis](xsuaa-setup.md#insufficient-scope-invalid_scope).

## Principal Propagation Setup

<a id="unit-tests_2"></a><a id="manual-integration-test_2"></a><a id="checklist_2"></a>

Complete [PP setup](principal-propagation-setup.md) before testing. Then:

1. Run a safe SAP read from a JWT-authenticated MCP client.
2. Ask the SAP owner to verify the mapped SAP user in the security audit log (`SM20`) or relevant session evidence (`SM04`). ARC-1's username alone does not prove SAP identity.
3. Repeat with a second mapped test user to check per-user separation.
4. For explicit `SAP_PP_STRICT=true`, verify non-JWT tool calls are rejected. For supported mixed mode (`false`), verify API-key calls use the intended shared identity.
5. In staging, verify a user with no valid PP mapping receives an error and never reaches SAP as the shared user.

## BTP / Cloud Foundry

<a id="unit-tests_3"></a><a id="manual-integration-test_3"></a><a id="checklist_3"></a>

Use the existing deployment; do not create or rebind services for a smoke test.

```bash
cf target
cf app arc1-mcp-server
cf logs arc1-mcp-server --recent
```

Verify XSUAA discovery using [Step 4 of XSUAA setup](xsuaa-setup.md#step-4-verify-oauth-discovery), then run the JWT and SAP-identity checks above.
For multi-target, inspect Admin `SAPTargets`, verify each intended route and run the safe read with its explicit target.
A successful `/health` proves process health only.

## BTP ABAP Environment (service key)

ARC-1 has two tiers of BTP ABAP integration tests. Both are **local-only**: the service-key provider
authenticates with the browser Authorization Code flow, and free-tier instances are stopped
automatically. Tests skip when no credentials are configured. Setup: [BTP ABAP Environment](btp-abap-environment.md).

### Smoke tests

Core connectivity and API contracts, no repository mutations: connect + CSRF token, system-info
shape, read a released class (`CL_ABAP_RANDOM`), search released objects, and confirm classic
programs (`RSHOWTIM`) are not reachable.

```bash
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp:smoke
# or: TEST_BTP_SERVICE_KEY='{"uaa":{…},…}' npm run test:integration:btp:smoke
```

### Extended tests

Interactive scenarios — browser OAuth login, writes (create/update/delete), code intelligence,
transports, and restriction behavior. Never run in CI.

```bash
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp
```

### Failure taxonomy

| Category | Symptoms | Cause |
|---|---|---|
| **Auth** | 401, token exchange failure | Token expired, service key invalid or revoked |
| **Connectivity** | `ECONNREFUSED`, `ETIMEDOUT`, DNS failure | Instance stopped (free tier), network unreachable |
| **Backend unavailable** | 503, maintenance page | Platform maintenance or provisioning |
| **Assertion** | `expect` mismatch | API contract changed — a real regression to investigate |

Investigate assertion failures as possible regressions. For auth/connectivity failures, first confirm the tenant is running and credentials are valid.

### Tenant assumptions

<a id="checklist_4"></a>

- Standard released objects exist (`CL_ABAP_RANDOM`, `IF_ABAP_RANDOM`).
- If the tenant is stopped, start it before running the tests.

### Checklist

- [ ] Smoke suite passes against a running instance
- [ ] Browser login completes and the token is reused for later calls
- [ ] `SAPManage probe` reports `systemType: "btp"`
- [ ] Write tests target a real development package (not `ZLOCAL`/`$TMP`)

---

## Full Regression Suite

<a id="quick-smoke-test"></a>

For code changes in a repository checkout:

```bash
npm ci
npm run build
npm test
```

Run `npm run test:integration` only against the configured SAP test system; individual integration suites can create test objects.
Unit-test success does not replace live authentication verification.
