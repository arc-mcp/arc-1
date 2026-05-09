# BTP ABAP Environment Setup

ARC-1 supports direct connections to SAP BTP ABAP Environment (Steampunk) using OAuth 2.0 Authorization Code flow via a BTP service key.

This is the same authentication flow used by Eclipse ADT when connecting to BTP ABAP systems — a browser opens for login, and tokens are cached for subsequent use.

> **Do not set `SAP_DISABLE_SAML=true` with BTP ABAP.** The SAML/SAML2 disable opt-in (SEC-09) is intended for on-prem SAP systems and breaks BTP ABAP / S/4HANA Public Cloud authentication. See [enterprise-auth.md](enterprise-auth.md) for details.

## Prerequisites

- A SAP BTP ABAP Environment service instance (see [Provisioning a BTP ABAP Free Tier Instance](#provisioning-a-btp-abap-free-tier-instance) if you don't have one)
- A service key for the instance (created in BTP Cockpit)
- ARC-1 installed (`npm install -g arc-1` or via Docker)

## Provisioning a BTP ABAP Free Tier Instance

If you don't have a BTP ABAP Environment instance yet, you can create one on the free tier:

### Prerequisites for Free Tier

- A SAP BTP global account with free-tier eligible entitlements (trial or pay-as-you-go)
- Cloud Foundry enabled in your subaccount (with an org and space)
- The `abap` / `free` entitlement assigned to your subaccount

### Assign the Entitlement

1. Go to **Global Account** > **Entitlements** > **Entity Assignments**
2. Select your subaccount
3. Click **Configure Entitlements** > **Add Service Plans**
4. Search for **ABAP Environment**, select the **free** plan
5. Click **Save**

### Create the Instance

**Via BTP Cockpit:**
1. Go to your **Subaccount** > **Service Marketplace**
2. Find **ABAP Environment** and click **Create**
3. Select plan **free**
4. In the JSON parameters, provide:
   ```json
   {
     "admin_email": "your.email@example.com",
     "is_development_allowed": true,
     "sap_system_name": "H01"
   }
   ```
5. Click **Create**

**Via CF CLI:**
```bash
# Login to Cloud Foundry
cf login -a https://api.cf.<region>.hana.ondemand.com

# Create the instance (use a params file to avoid shell quoting issues)
cat > params.json << 'EOF'
{
  "admin_email": "your.email@example.com",
  "is_development_allowed": true,
  "sap_system_name": "H01"
}
EOF

cf create-service abap free my-abap-instance -c params.json
```

**Important notes:**
- `admin_email` must be a valid email address (the one you use to log into BTP)
- `sap_system_name` is a 3-character SID (e.g., `H01`, `DEV`, `Z01`)
- Free tier availability depends on your region and commercial model; check SAP Discovery Center and your subaccount entitlements for current region support
- Only **one** free instance per global account
- Provisioning takes **30-60 minutes** — check status with `cf service my-abap-instance`
- Free tier instances may be **stopped periodically** — restart via Landscape Portal or BTP Cockpit
- Check current free-tier limits (system sizing, expiry) in SAP Help before planning capacity

### Common Error: admin_email Validation

If you see:
```
Service broker error: Failed to validate service parameters,
reason: /admin_email must NOT have fewer than 6 characters, /admin_email must match pattern...
```

This means `admin_email` was missing or invalid in your parameters JSON. Make sure you provide a valid email address in the JSON body (not as a separate field).

### Required: Run the Booster and Assign Developer Role

After provisioning, you **cannot log in** to the ABAP system directly — the classic login form (Benutzer/Kennwort) appears but you have no password. You must first set up trust with SAP Cloud Identity Services:

1. **Run the Booster**: BTP Cockpit → **Global Account** → **Boosters** → search for **"Prepare an Account for ABAP Development"** → run it
   - This configures trust between your subaccount and SAP Cloud Identity Services (IAS)
   - Creates the initial admin user with SSO-based login
   - After the booster, login redirects to IAS instead of showing the classic form

2. **Subscribe to "Web Access for ABAP"** (if not already done): BTP Cockpit → subaccount → **Service Marketplace** → "Web access for ABAP" → **Create**

3. **Assign the Developer Role**:
   - Access the admin launchpad: BTP Cockpit → your space → Service Instances → your instance → **View Dashboard**
   - Open **"Maintain Business Users"**
   - Find your user
   - Go to **"Assigned Business Roles"** → **Add** → search for **`SAP_BR_DEVELOPER`**
   - Save

   > **Note:** The booster only assigns the administrator role. Without `SAP_BR_DEVELOPER`, Eclipse ADT and ARC-1 connections will fail with: "You have not been successfully logged on. Make sure the developer role is assigned to the user."

4. **Verify**: Connect with Eclipse ADT to confirm login works before testing with ARC-1.

## Step 1: Create a Service Key

1. Open your SAP BTP Cockpit
2. Navigate to your Subaccount > Service Instances
3. Find your **ABAP Environment** service instance
4. Go to **Service Keys** and create a new one (or use an existing one)
5. Download the service key JSON file

The service key looks like this:

```json
{
  "uaa": {
    "url": "https://your-subdomain.authentication.eu10.hana.ondemand.com",
    "clientid": "sb-abap-12345...",
    "clientsecret": "your-client-secret"
  },
  "url": "https://your-system.abap.eu10.hana.ondemand.com",
  "abap": {
    "url": "https://your-system.abap.eu10.hana.ondemand.com",
    "sapClient": "100"
  },
  "catalogs": {
    "abap": { "path": "/sap/bc/adt", "type": "sap_abap" }
  }
}
```

## Step 2: Configure ARC-1

### Option A: Service Key File (Recommended)

Save the service key to a file and point ARC-1 to it:

```bash
# Save the service key
cp ~/Downloads/service-key.json ~/.config/arc-1/btp-service-key.json

# Start ARC-1 with the service key
SAP_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-service-key.json arc1
```

### Option B: Inline Service Key (for Docker / CI)

Pass the entire service key JSON as an environment variable:

```bash
SAP_BTP_SERVICE_KEY='{"uaa":{"url":"...","clientid":"...","clientsecret":"..."},"url":"..."}' arc1
```

### Option C: CLI Flags

```bash
arc1 --btp-service-key-file /path/to/service-key.json
# or
arc1 --btp-service-key '{"uaa":{...}}'
```

## Step 3: Configure Your MCP Client

### Claude Desktop / Claude Code

Add to your MCP client config (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "arc-1-btp": {
      "command": "arc1",
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "/path/to/service-key.json",
        "SAP_SYSTEM_TYPE": "btp"
      }
    }
  }
}
```

Or via npx (no global install):

```json
{
  "mcpServers": {
    "arc-1-btp": {
      "command": "npx",
      "args": ["-y", "arc-1"],
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "/path/to/service-key.json",
        "SAP_SYSTEM_TYPE": "btp"
      }
    }
  }
}
```

### VS Code (Copilot Chat)

In your `.vscode/mcp.json`:

```json
{
  "servers": {
    "arc-1-btp": {
      "command": "arc1",
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "${userHome}/.config/arc-1/btp-service-key.json",
        "SAP_SYSTEM_TYPE": "btp"
      }
    }
  }
}
```

### Docker

```bash
docker run -p 8080:8080 \
  -e SAP_BTP_SERVICE_KEY='{"uaa":{"url":"...","clientid":"...","clientsecret":"..."},"url":"..."}' \
  -e SAP_SYSTEM_TYPE=btp \
  ghcr.io/marianfoo/arc-1:latest
```

## Step 4: First Login

1. Start your MCP client (Claude Desktop, VS Code, etc.)
2. Make any tool call (e.g., ask Claude to "search for ABAP classes")
3. **A browser window opens automatically** to the SAP BTP login page
4. Authenticate in the browser (SAP IdP, IAS, Azure AD, etc.)
5. After successful login, the browser shows "Authentication Successful"
6. Return to your MCP client — the tool call completes
7. Subsequent calls reuse the cached token (no browser needed)

When the access token expires (~12 hours), ARC-1 automatically refreshes it using the refresh token. A browser login is only needed again if the refresh token also expires.

### Browser Doesn't Open?

If the browser fails to open automatically (e.g., on a headless server), ARC-1 logs the authorization URL. Copy it and open it manually in any browser.

## Configuration Reference

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | Inline service key JSON |
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to service key JSON file |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | Port for OAuth browser callback (default: auto-assigned) |
| `SAP_SYSTEM_TYPE` / `--system-type` | System type: `auto` (default), `btp`, or `onprem` |

### Recommended: Set SAP_SYSTEM_TYPE=btp

When connecting to BTP ABAP, set `SAP_SYSTEM_TYPE=btp` for the best experience. This adapts tool definitions immediately at startup:

- **SAPRead**: Removes PROG, INCL, VIEW, TEXT_ELEMENTS, VARIANTS (not available on BTP)
- **SAPWrite**: Only CLAS, INTF (ABAP Cloud syntax, Z/Y namespace)
- **SAPQuery**: Warns about blocked SAP standard tables, suggests CDS views instead
- **SAPTransport**: Explains gCTS behavior (release = Git push, not TMS export)
- **SAPContext**: Only CLAS, INTF (includes released SAP APIs)

Without this flag, ARC-1 auto-detects the system type on the first `SAPManage probe`, which works but means the first tool listing may show on-premise types.

## How It Works

1. **Service key parsing**: ARC-1 reads the service key to extract:
   - `url` — The ABAP system base URL (where ADT API endpoints live)
   - `uaa.url` — The XSUAA token endpoint
   - `uaa.clientid` / `uaa.clientsecret` — OAuth client credentials

2. **OAuth Authorization Code flow with PKCE**:
   - ARC-1 starts a local callback server bound to `localhost` only (not `0.0.0.0`)
   - Generates a PKCE code verifier/challenge and a random `state` parameter for CSRF protection
   - Opens the browser to `{uaa.url}/oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...&state=...`
   - User authenticates in the browser
   - Browser redirects to callback with authorization code; ARC-1 verifies the `state` parameter matches
   - ARC-1 exchanges code + PKCE code verifier for JWT access token + refresh token
   - No user action is required for these security enhancements — they are applied automatically

3. **Bearer token auth**: All ADT API requests use `Authorization: Bearer <token>` instead of Basic Auth. CSRF token handling and cookie management work identically to on-premise.

4. **Token lifecycle**: Access tokens are cached in memory. When they expire, ARC-1 uses the refresh token to get a new one. Only if the refresh token also expires does it trigger another browser login.

## Constraints vs On-Premise

BTP ABAP Environment has some limitations compared to on-premise:

| Area | Constraint |
|---|---|
| ABAP Language | Restricted ABAP ("ABAP for Cloud Development") |
| Released APIs only | Only C1-released objects accessible |
| No SAP GUI | Only ADT (Eclipse/API) available |
| No direct DB table preview | Data preview may be restricted |
| Package restrictions | Custom development in `Z*` or customer namespace only |
| Transport system | Uses gCTS or software components instead of classic transports |
| SAPQuery | `RunQuery` (free SQL) likely blocked; CDS views work |

## Cross-Platform Support

The browser login works on all platforms:
- **macOS**: Opens with `open` command
- **Linux**: Opens with `xdg-open` command
- **Windows**: Opens with `start` command

If the system cannot open a browser (e.g., headless server or WSL without browser integration), the authorization URL is logged to stderr for manual copy-paste.

## Testing the Connection

### Quick Smoke Test (CLI)

Before using with an MCP client, test the connection directly:

```bash
# Test with verbose logging to see the OAuth flow
SAP_BTP_SERVICE_KEY_FILE=/path/to/service-key.json arc1 search "ZCL_*" --verbose
```

This will:
1. Open browser for login
2. After authentication, search for classes matching `ZCL_*`
3. Print results as JSON

### Manual Token Test (curl)

> **Note:** Client credentials (`grant_type=client_credentials`) does NOT work for ADT endpoints — ADT requires a user context. Use the Authorization Code flow via ARC-1 or Eclipse ADT for interactive testing. The curl test below uses client_credentials for connectivity testing only — it will confirm the XSUAA URL and credentials are valid, but ADT will return 401.

```bash
# 1. Get values from your service key
UAA_URL="https://your-subdomain.authentication.eu10.hana.ondemand.com"
CLIENT_ID="sb-abap-12345..."
CLIENT_SECRET="your-secret"
ABAP_URL="https://your-system.abap.eu10.hana.ondemand.com"

# 2. Get a token (client credentials — only tests XSUAA connectivity)
TOKEN=$(curl -s -X POST "$UAA_URL/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials" | jq -r '.access_token')

# 3. Verify token was obtained (non-empty = XSUAA is working)
echo "Token length: ${#TOKEN}"

# 4. Test ADT API access (expect 401 with client_credentials — this is normal)
curl -s -o /dev/null -w "%{http_code}" "$ABAP_URL/sap/bc/adt/core/discovery" \
  -H "Authorization: Bearer $TOKEN"
# 401 = expected (client_credentials lacks user context for ADT)
# 200 = connection works (unlikely with client_credentials)
```

For proper testing, use ARC-1 with the service key — it performs the Authorization Code flow with browser login to obtain a user-scoped token.

### What to Expect on BTP ABAP

When `SAP_SYSTEM_TYPE=btp` is set (or auto-detected), tool definitions and behavior adapt:

| Tool | BTP Behavior |
|---|---|
| `SAPRead` | Types CLAS, INTF, DDLS, BDEF, SRVD, TABL, TABLE_CONTENTS, DEVC, SYSTEM, COMPONENTS, MSAG (deprecated alias: MESSAGES). PROG, INCL, VIEW, TEXT_ELEMENTS, VARIANTS, SOBJ are removed — returns helpful error if the LLM tries them. |
| `SAPSearch` | Works — returns released SAP objects and custom Z/Y objects. Classic programs and includes not searchable. |
| `SAPWrite` | Only CLAS, INTF. Must use ABAP Cloud language version. Z/Y namespace only. |
| `SAPActivate` | Works — no changes. |
| `SAPQuery` | Only custom Z/Y tables and released CDS entities (I_LANGUAGE, I_COUNTRY, etc.). SAP standard tables (DD02L, TADIR, MARA, etc.) are blocked. Returns helpful error with CDS view suggestions. |
| `SAPTransport` | Works, but release triggers gCTS Git push (not TMS export). Description explains this. |
| `SAPLint` | Works — runs client-side (abaplint). |
| `SAPDiagnose` | Works — ATC with ABAP_CLOUD_DEVELOPMENT_DEFAULT variant. |
| `SAPContext` | Only CLAS, INTF. Includes released SAP APIs (they're the dev surface on BTP). |
| `SAPNavigate` | Works — scope limited to released and custom objects. |
| `SAPManage` | Returns `systemType: "btp"` in probe results. |

## Automated Testing

ARC-1 has two tiers of BTP ABAP integration tests: a CI-capable smoke suite and a local-only extended suite.

### Smoke Tests (CI-Capable)

Smoke tests are deterministic, non-interactive tests that verify core BTP connectivity and API contracts. They can run in CI with a service key secret — no browser login required.

**What they test:**
- Connectivity: establishes a connection and retrieves a CSRF token
- System info shape: verifies expected fields (user, collections) are returned
- Released object read: reads a standard released class (e.g., `CL_ABAP_RANDOM`)
- Released object search: searches for released objects and validates result shape
- BTP-specific behavior: confirms classic programs (e.g., `RSHOWTIM`) are not accessible

**How to run:**
```bash
# With service key file
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp:smoke

# With inline service key (for CI)
TEST_BTP_SERVICE_KEY='{"uaa":{...},...}' npm run test:integration:btp:smoke
```

**CI secret:** Set `TEST_BTP_SERVICE_KEY` as a GitHub Actions secret containing the full service key JSON.

**When the instance is down:** Tests skip gracefully when no credentials are configured. When credentials are present but the instance is stopped, tests fail with connectivity errors — this is expected for free-tier instances that stop nightly.

### Extended Tests (Local Only)

Extended tests cover interactive scenarios that require browser-based OAuth login. They are never run in CI.

**What they test:**
- Full OAuth browser login flow
- Write operations (create, update, delete)
- Code intelligence (find definition, where-used, completion)
- Transport management
- Restriction behavior (blocked operations, restricted objects)

**How to run:**
```bash
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp:extended
```

**Why local only:**
- BTP free tier instances are stopped each night and deleted after 90 days
- OAuth Authorization Code flow requires an interactive browser login
- Write operations need a running instance with developer access

### Failure Taxonomy

When BTP tests fail, failures fall into one of these categories:

| Category | Symptoms | Cause |
|----------|----------|-------|
| **Auth** | 401 Unauthorized, token exchange failure | OAuth token expired, service key invalid or revoked |
| **Connectivity** | ECONNREFUSED, ETIMEDOUT, DNS resolution failure | BTP instance stopped (free tier nightly), network unreachable |
| **Assertion** | Test assertion failure (expect mismatch) | API contract changed, potential regression in ARC-1 |
| **Backend unavailable** | 503 Service Unavailable, maintenance page | BTP platform maintenance, instance provisioning |

Auth and connectivity failures are expected with free-tier instances. Assertion failures indicate a real issue that needs investigation.

### Tenant Assumptions

- Tests assume a BTP ABAP Environment with standard released objects (e.g., `CL_ABAP_RANDOM`, `IF_ABAP_RANDOM`)
- Free-tier limitations: instances stop nightly, expire after 90 days, one instance per global account
- BTP test execution is local-only by design in this project

## Troubleshooting

### Classic login form (Benutzer/Kennwort) instead of SSO redirect

- The "Prepare an Account for ABAP Development" booster has not been run
- Without the booster, trust to SAP Cloud Identity Services (IAS) is not configured
- Run the booster first (see [Required: Run the Booster](#required-run-the-booster-and-assign-developer-role))

### "You have not been successfully logged on" / Developer role missing

- The booster only assigns the administrator role, not the developer role
- Open the admin launchpad → **Maintain Business Users** → find your user → add **`SAP_BR_DEVELOPER`** business role
- Both Eclipse ADT and ARC-1 require the developer role for ADT API access

### "Entity is currently being edited by another user" when assigning roles

- A previous browser session or the booster may still hold a lock on the user record
- Close all browser tabs accessing the admin launchpad, wait 1-2 minutes for the lock to expire, then try again

### Browser opens but login fails

- Verify the service key is correct and not expired
- Check that the XSUAA URL in the service key matches your BTP region
- Try creating a fresh service key in BTP Cockpit

### 401 Unauthorized after login

- The OAuth token was obtained but SAP rejected it
- This can happen if your BTP user doesn't have developer access
- Check that `SAP_BR_DEVELOPER` is assigned in the admin launchpad (not just BTP role collections)

### 403 Forbidden on specific ADT endpoints

- Some ADT endpoints may require Communication Arrangements on BTP
- ATC checks may need `SAP_COM_0763` communication scenario
- Check the ABAP system's Communication Management (in Fiori Launchpad)

### Token expires and browser doesn't open for re-login

- ARC-1 tries to refresh the token automatically using the refresh token
- If refresh also fails, it should re-open the browser
- Restart the MCP server if token issues persist

### Connection works in curl but not in ARC-1

- Enable verbose logging: `--verbose` or `SAP_VERBOSE=true`
- Check stderr output for OAuth flow details
- Verify the service key file path is correct and readable

### Free tier provisioning fails

- **Entitlement missing**: Assign `abap` / `free` in Global Account > Entitlements
- **Region not supported**: Free plan may not be available in your region/commercial model
- **Already have an instance**: Only one free instance per global account
- **CF not enabled**: Enable Cloud Foundry in your subaccount first

## Architecture Details

For the research report covering authentication options, competitor analysis, and design decisions, see [btp-abap-environment-connectivity.md](https://github.com/marianfoo/arc-1/blob/main/docs/plans/completed/btp-abap-environment-connectivity.md) in the repo.
