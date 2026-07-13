# Authentication Test Process

Step-by-step verification for each authentication method. Run these tests after deploying arc1 to confirm the configured methods work as intended.

## Prerequisites

```bash
# Build arc1
npm run build

# Run unit tests first (all must pass)
npm test
```

---

## API Key Setup

### Unit Tests

```bash
# Run auth-related unit tests
npm test
```

### HTTP Profile Manifest Smoke Test

When a local HTTP authz test server is already running with four API-key profiles, run:

```bash
npm run test:authz:http
```

Default assumptions:

- URL: `http://127.0.0.1:19081/mcp` (override with `ARC1_AUTHZ_MCP_URL`)
- Keys: `viewer-key-local`, `sql-key-local`, `dev-key-local`, `admin-key-local`
- Server ceiling: writes, data preview, SQL, and transport writes enabled; Git writes disabled

The script checks the live MCP `tools/list` manifest for each key. It verifies that unauthorized tools/actions are hidden before any SAP mutation can be attempted:

- `viewer`: no `SAPWrite`, no `SAPQuery`, no `TABLE_CONTENTS`, transport read actions only
- `viewer-sql`: `SAPQuery` and `TABLE_CONTENTS` visible, no writes
- `developer`: writes and transport mutations visible, SQL hidden, Git write actions hidden
- `admin`: writes, SQL, and transport mutations visible; Git write actions still hidden when `SAP_ALLOW_GIT_WRITES=false`

### Manual Integration Test

**1. Start arc1 with API key:**

```bash
npx arc-1 --url http://your-sap:8000 \
  --user DEVELOPER --password secret --client 001 \
  --transport http-streamable --http-addr 0.0.0.0:8080 \
  --api-keys 'test-key-12345:admin'
```

**2. Verify health endpoint (no auth required):**

```bash
curl -s http://localhost:8080/health
# Expected: {"status":"ok"}
```

**3. Verify request without API key is rejected:**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/mcp
# Expected: 401
```

**4. Verify request with wrong API key is rejected:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-key" \
  http://localhost:8080/mcp
# Expected: 401
```

**5. Verify request with correct API key succeeds:**

```bash
curl -s -H "Authorization: Bearer test-key-12345" \
  -H "Content-Type: application/json" \
  http://localhost:8080/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 200 with JSON-RPC response containing tool list
```

**6. Verify case-insensitive Bearer prefix:**

```bash
curl -s -H "Authorization: bearer test-key-12345" \
  -H "Content-Type: application/json" \
  http://localhost:8080/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 200 (same as above)
```

### Checklist

- [ ] Health endpoint returns 200 without auth
- [ ] Missing Authorization header → 401
- [ ] Wrong API key → 401
- [ ] Correct API key → 200 with tools
- [ ] Case-insensitive "Bearer" prefix works
- [ ] MCP client (VS Code/Cursor) connects with Authorization header

---

## OAuth / JWT Setup

### Unit Tests

```bash
npm test
```

### Manual Integration Test

**Prerequisites:** You need an OIDC identity provider (Microsoft Entra ID, Keycloak, Cognito).

**1. Start arc1 with OIDC:**

```bash
npx arc-1 --url http://your-sap:8000 \
  --user DEVELOPER --password secret --client 001 \
  --transport http-streamable --http-addr 0.0.0.0:8080 \
  --oidc-issuer 'https://your-idp.example.com' \
  --oidc-audience 'your-audience'
```

**2. Verify Protected Resource Metadata endpoint:**

```bash
curl -s http://localhost:8080/.well-known/oauth-protected-resource | jq .
# Expected: JSON with "resource", "authorization_servers", "bearer_methods_supported"
```

**3. Verify request without token is rejected:**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/mcp
# Expected: 401
```

**4. Get a real JWT from your IdP:**

```bash
# Example for Azure CLI:
TOKEN=$(az account get-access-token --resource your-audience --query accessToken -o tsv)

# Example for Keycloak (password grant for testing):
TOKEN=$(curl -s -X POST https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token \
  -d "grant_type=password&client_id=arc1&username=testuser&password=testpass" | jq -r .access_token)
```

**5. Verify request with valid JWT succeeds:**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 200 with tool list
```

**6. Verify expired/invalid token is rejected:**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid.jwt.token" \
  http://localhost:8080/mcp
# Expected: 401
```

**7. Check logs for username extraction:**

```
# In arc1 stderr output, look for:
# [OIDC] Authenticated user: <username>
```

### Checklist

- [ ] Protected Resource Metadata endpoint returns valid JSON
- [ ] Missing token → 401
- [ ] Invalid/expired token → 401
- [ ] Valid JWT → 200 with tools
- [ ] Username extracted from JWT claims (check logs)
- [ ] JWKS auto-discovery works (check logs for JWKS fetch)

---

## Principal Propagation Setup

### Unit Tests

```bash
npm test
```

### Manual Integration Test

**Prerequisites:**
- OIDC or XSUAA configured and working
- ARC-1 deployed on BTP CF with Destination + Connectivity services
- Cloud Connector connected and configured for principal propagation
- SAP system configured with CERTRULE / VUSREXTID (see [Principal Propagation Setup](principal-propagation-setup.md))

**1. Configure ARC-1 with PP:**

```bash
SAP_BTP_DESTINATION=SAP_TRIAL \
SAP_BTP_PP_DESTINATION=SAP_TRIAL_PP \
SAP_PP_ENABLED=true \
SAP_PP_STRICT=true
```

**2. Verify per-user identity in SAP:**

Check in SAP transaction `SM20` (security audit log) or `SM04` (user sessions) that the request was executed as the mapped SAP user, not a technical account.

**3. Check ARC-1 logs:**

```bash
cf logs arc1-mcp-server --recent | grep -E "Principal propagation|per-user|BTP destination"
```

### Checklist

- [ ] BTP Destination with `PrincipalPropagation` authentication type configured
- [ ] Cloud Connector principal propagation enabled
- [ ] SAP certificate mapping (CERTRULE / VUSREXTID) configured
- [ ] JWT-authenticated requests use per-user destination
- [ ] SAP logs show per-user identity (not technical account)
- [ ] Identity topology is explicit: recommended strict PP + separate API-key instance, or supported mixed mode with `SAP_PP_STRICT=false`

---

## BTP / Cloud Foundry

### Unit Tests

```bash
npm test
```

### Manual Integration Test

**To test on BTP Cloud Foundry:**

**1. Deploy to CF:**

```bash
# Build Docker image
docker build -t arc1 .
# Push to CF (see btp-cloud-foundry-deployment.md)
cf push
```

**2. Verify app is running** (check app logs):

```bash
cf logs arc1 --recent | grep "BTP"
# Expected: Log messages showing parsed XSUAA and Destination bindings
```

**3. Verify health:**

```bash
cf ssh arc1 -c "curl -s http://localhost:8080/health"
# Expected: {"status":"ok"}
```

### Checklist

- [ ] BTP config → OAuth config conversion works
- [ ] App starts on CF without errors
- [ ] Health endpoint returns 200

---

## Full Regression Suite

Run all tests:

```bash
# All unit tests
npm test

# Integration tests (requires SAP credentials)
npm run test:integration
```

---

## Quick Smoke Test

For a quick check that nothing is broken after code changes:

```bash
npm test
# Expected: All tests pass, no failures
```
