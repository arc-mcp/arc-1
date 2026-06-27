# BTP ABAP Environment Setup

ARC-1 connects to a SAP BTP ABAP Environment (Steampunk) in two ways:

- **Recommended — deploy ARC-1 on BTP Cloud Foundry and connect through a per-user destination** (`OAuth2UserTokenExchange`). This is how ARC-1 is meant to be consumed: a centrally managed, BTP-native service that acts in SAP as each MCP user's own identity (see [deployment-best-practices.md](deployment-best-practices.md)). It runs fully headless and needs no Cloud Connector. See [Recommended: BTP deployment with a per-user destination](#recommended-btp-deployment-with-a-per-user-destination).
- **Local development — a BTP service key with browser login** (the same OAuth 2.0 Authorization Code flow Eclipse ADT uses; a browser opens and tokens are cached). Fine on a laptop with `stdio` transport, but it **cannot run headless** — the OAuth callback binds to `localhost`, so it is not suitable for a deployed or shared server. This mode is covered first, below.

> **Do not set `SAP_DISABLE_SAML=true` with BTP ABAP.** The SAML/SAML2 disable opt-in (SEC-09) is intended for on-prem SAP systems and breaks BTP ABAP / S/4HANA Public Cloud authentication. See [enterprise-auth.md](enterprise-auth.md) for details.

## Prerequisites

- A SAP BTP ABAP Environment service instance (see [Provisioning a BTP ABAP Free Tier Instance](#provisioning-a-btp-abap-free-tier-instance) if you don't have one)
- For local service-key OAuth: a service key for the instance (created in BTP Cockpit)
- For deployed CF usage: XSUAA and Destination service instances, plus a BTP Destination configured with `OAuth2UserTokenExchange`
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

### Option A: Service Key File (recommended for local development)

Save the service key to a file and point ARC-1 to it:

```bash
# Save the service key
cp ~/Downloads/service-key.json ~/.config/arc-1/btp-service-key.json

# Start ARC-1 with the service key
SAP_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-service-key.json arc1
```

!!! danger "A service key is a full-access SAP credential — keep it outside the repo"
    The `uaa.clientid` + `uaa.clientsecret` + `url` in a service key grant OAuth access to the entire ABAP system. Store it outside the repository (e.g. `~/.config/arc-1/`, as above) and never commit it. ARC-1's `.gitignore` / `.dockerignore` / `.cfignore` match `*service-key*.json` so an in-tree key won't be committed or baked into an image by accident — but keep keys outside the tree as defense-in-depth, and treat an inline `SAP_BTP_SERVICE_KEY` env value the same way.

### Option B: Inline Service Key (short-lived local env only)

Pass the entire service key JSON as an environment variable:

```bash
SAP_BTP_SERVICE_KEY='{"uaa":{"url":"...","clientid":"...","clientsecret":"..."},"url":"..."}' arc1
```

Do not use this as the normal CF production path. The direct service-key mode opens a browser and binds the callback to local loopback, so it is not suitable for a shared or headless server. For deployed BTP CF, create the destination shown in [Recommended: BTP deployment with a per-user destination](#recommended-btp-deployment-with-a-per-user-destination).

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

The direct service-key Docker example is only useful for a local interactive run where the OAuth callback can be reached from the browser. For a deployed/shared Docker container, use the per-user destination pattern instead.

```bash
docker run -p 8080:8080 \
  -e SAP_BTP_SERVICE_KEY='{"uaa":{"url":"...","clientid":"...","clientsecret":"..."},"url":"..."}' \
  -e SAP_SYSTEM_TYPE=btp \
  ghcr.io/arc-mcp/arc-1:latest
```

## Step 4: First Login

1. Start your MCP client (Claude Desktop, VS Code, etc.)
2. Make any tool call (e.g., ask Claude to "search for ABAP classes")
3. **A browser window opens automatically** to the SAP BTP login page
4. Authenticate in the browser (SAP ID service, SAP Cloud Identity Services / IAS, Microsoft Entra ID, etc.)
5. After successful login, the browser shows "Authentication Successful"
6. Return to your MCP client — the tool call completes
7. Subsequent calls reuse the cached token (no browser needed)

When the access token expires (~12 hours), ARC-1 automatically refreshes it using the refresh token. A browser login is only needed again if the refresh token also expires.

### Browser Doesn't Open?

If the browser fails to open automatically, ARC-1 logs the authorization URL. Manual copy/paste only works when the browser can reach the callback listener on the same local machine or container mapping. On remote/headless servers this usually fails because the callback is bound to loopback; use the per-user BTP Destination pattern instead.

## Recommended: BTP deployment with a per-user destination

ARC-1 is designed to run as a **centrally managed service on SAP BTP Cloud Foundry** — not on individual laptops — and to act in SAP as **each MCP user's own identity**. For a BTP ABAP Environment, the recommended setup follows directly from that: deploy ARC-1 on Cloud Foundry and connect through a **per-user destination** using `OAuth2UserTokenExchange`. It runs fully headless (no browser), propagates the logged-in user to the ABAP system so SAP's own authorizations apply per user, and needs **no Cloud Connector** — the ABAP Environment is Internet-facing, so this is a direct cloud-to-cloud call.

SAP documents `OAuth2UserTokenExchange` for applications that need to call another application while passing the logged-in user's context through the Destination service ([SAP Help](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication)). That matches ARC-1 on Cloud Foundry calling the ABAP Environment: ARC-1 validates the MCP user's XSUAA token, the Destination service exchanges it for an ABAP-context token, and no technical SAP user is needed for ADT calls.

### 1. Bind the BTP services

ARC-1 needs an XSUAA instance (for MCP-client login) and a Destination service instance. No Connectivity service is needed, because there is no Cloud Connector.

```bash
cf create-service xsuaa application arc1-xsuaa -c xs-security.json
cf create-service destination lite arc1-destination
```

### 2. Create the per-user destination

Take the OAuth client credentials from the ABAP instance's **service key** (`uaa` section; append `/oauth/token` to `uaa.url` for the token endpoint). Create the destination in the BTP cockpit (**Connectivity → Destinations**) or declaratively when provisioning the destination service instance (`cf create-service destination lite arc1-destination -c dest.json`):

```json
{ "init_data": { "instance": {
  "existing_destinations_policy": "update",
  "destinations": [{
    "Name": "ABAP_PP",
    "Type": "HTTP",
    "URL": "https://<guid>.abap.<region>.hana.ondemand.com",
    "ProxyType": "Internet",
    "Authentication": "OAuth2UserTokenExchange",
    "tokenServiceURL": "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
    "clientId": "<service-key uaa.clientid>",
    "clientSecret": "<service-key uaa.clientsecret>"
  }]
}}}
```

| Property | Value |
|---|---|
| **Type** | `HTTP` |
| **URL** | service key `url` (the ABAP system) |
| **Proxy Type** | `Internet` (no Cloud Connector) |
| **Authentication** | `OAuth2UserTokenExchange` |
| **Token Service URL** | `<uaa.url>/oauth/token` |
| **Client ID / Secret** | service key `uaa.clientid` / `uaa.clientsecret` (the ABAP instance's own OAuth client) |

> **⚠️ `OAuth2UserTokenExchange` requires the same subaccount.** This auth type is an XSUAA→XSUAA
> token exchange *within one subaccount/identity zone*, so ARC-1 and the ABAP Environment must be in
> the **same BTP subaccount**. If they are in **different subaccounts**, the Destination Service fails
> with `Token header claim [kid] references unknown signing key` (or `Unable to map issuer`) and every
> tool call returns `Principal propagation failed`. Per SAP's
> [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html):
> **same subaccount → `OAuth2UserTokenExchange`; different subaccounts → `OAuth2SAMLBearerAssertion`**
> (the source subaccount's Destination Service becomes a trusted IdP in the ABAP env's subaccount; see
> [User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow)).
> ARC-1 handles the bearer token from an `OAuth2SAMLBearerAssertion` destination with no extra
> configuration on its side. See [Troubleshooting](#cross-subaccount-principal-propagation-fails).

### 3. Configure ARC-1

```yaml
env:
  SAP_SYSTEM_TYPE: btp
  SAP_TRANSPORT: http-streamable
  SAP_XSUAA_AUTH: "true"      # MCP clients authenticate via XSUAA OAuth
  SAP_PP_ENABLED: "true"      # per-user principal propagation
  SAP_BTP_DESTINATION: ABAP_PP
services:
  - arc1-xsuaa
  - arc1-destination
```

Per request, ARC-1 validates the MCP user's XSUAA JWT, has the Destination service exchange it for an ABAP-context Bearer token, and sends `Authorization: Bearer <token>` on every ADT call. SAP therefore sees the actual end user, and SAP-side authorizations (`S_DEVELOP`, package checks) apply per user.

### 4. Grant users access

Assign each MCP user a role collection that grants the ARC-1 scopes they need (e.g. `ARC-1 Developer`) in the subaccount under **Security → Role Collections / Users** — XSUAA only issues a token for scopes the user actually holds. The user must also have developer authorization in the ABAP Environment itself (the `SAP_BR_DEVELOPER` business role; see [Required: Run the Booster and Assign Developer Role](#required-run-the-booster-and-assign-developer-role)).

### References (SAP documentation)

- [OAuth2 User Token Exchange Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication) — how Destination service exchanges the logged-in user's token for a target-application token.
- [Destination Authentication Methods](https://help.sap.com/docs/btp/btp-admin-guide/destination-authentication-methods) — `OAuth2UserTokenExchange` alongside the other destination auth types.
- [SAP Cloud SDK — Destinations](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/destinations) — how the destination and token exchange are resolved at runtime (ARC-1 uses this SDK).
- [ARC-1 BTP Destination Setup](btp-destination-setup.md) and [Principal Propagation Setup](principal-propagation-setup.md) — ARC-1's destination / principal-propagation configuration in depth (including the on-premise Cloud Connector variant).

## Configuration Reference

### Local service-key OAuth

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | Inline service key JSON |
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to service key JSON file |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | Port for OAuth browser callback (default: auto-assigned) |
| `SAP_SYSTEM_TYPE` / `--system-type` | System type: `auto` (default), `btp`, or `onprem` |

### Deployed BTP CF destination

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_DESTINATION` | Destination name with `Authentication=OAuth2UserTokenExchange` |
| `SAP_PP_ENABLED=true` / `--pp-enabled` | Enables ARC-1's per-user destination path |
| `SAP_PP_STRICT=true` / `--pp-strict` | Optional JWT-only strict mode; rejects API-key / non-JWT calls as well as PP failures |
| `SAP_XSUAA_AUTH=true` / `--xsuaa-auth` | MCP clients authenticate through XSUAA OAuth |
| `SAP_SYSTEM_TYPE=btp` / `--system-type btp` | Expose the BTP-adapted tool definitions from startup |

### Recommended: Set SAP_SYSTEM_TYPE=btp

When connecting to BTP ABAP, set `SAP_SYSTEM_TYPE=btp` for the best experience. This adapts tool definitions immediately at startup:

- **SAPRead**: Removes classic-only types such as PROG, INCL, VIEW, TRAN, TEXT_ELEMENTS, VARIANTS, SOBJ, AUTH, FEATURE_TOGGLE/FTG2, ENHO, and version history actions
- **SAPWrite**: Supports CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL/TABL/DT/TABL/DS, DOMA, DTEL, MSAG (ABAP Cloud syntax, custom namespaces)
- **SAPQuery**: Warns about blocked SAP standard tables, suggests CDS views instead
- **SAPTransport**: Explains gCTS behavior (release = Git push, not TMS export)
- **SAPContext**: Supports CLAS, INTF, and DDLS (including CDS impact analysis for DDLS)

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

## Writing objects on BTP

Object create/update works on the ABAP Environment (live-verified: `CLAS create → activate → read → delete`). ARC-1 emits the **cloud-correct** create body automatically when the system type is `btp` — it drops the on-prem `adtcore:masterSystem`/`adtcore:responsible` and adds `abapLanguageVersion="cloudDevelopment"`; the object owner is taken from your JWT. The same cloud-correct body covers the **RAP stack — BDEF, SRVD and SRVB create is live-verified on the ABAP Environment** (they keep their existing content types; no extra handling needed). Two prerequisites:

1. **Enable writes** — `SAP_ALLOW_WRITES=true`.
2. **Target a real development package** — the booster-provided `ZLOCAL` is a *structure* package that cannot contain development objects, and `$TMP` does not exist on BTP. Create a development **sub-package under `ZLOCAL`** in ADT/Eclipse (e.g. `ZARC1_DEV`, software component `ZLOCAL`), then point the allowlist at it:

   ```bash
   SAP_ALLOW_WRITES=true
   SAP_ALLOWED_PACKAGES=Z*          # or the exact package name, e.g. ZARC1_DEV
   ```

You also need the developer role assigned — see [Required: Run the Booster and Assign Developer Role](#required-run-the-booster-and-assign-developer-role).

> **Package creation is Eclipse-only.** ARC-1 cannot create the package for you. The ABAP Environment rejects the package-create body every ADT REST client sends (`SPAK_ST_PACKAGES` won't accept `adtcore:responsible`, yet the package framework requires it — Eclipse's interactive session resolves the owner a bearer token can't). Create the dev package once in Eclipse; everything **inside** it is then fully scriptable via ARC-1.

## Constraints vs On-Premise

BTP ABAP Environment has some limitations compared to on-premise:

| Area | Constraint |
|---|---|
| ABAP Language | Restricted ABAP ("ABAP for Cloud Development") |
| Released APIs only | Only C1-released objects accessible |
| No SAP GUI | Only ADT (Eclipse/API) available |
| Table preview is restricted and off by default | `SAP_ALLOW_DATA_PREVIEW=true` is required, and the ABAP backend may still restrict standard tables |
| Package restrictions | Custom development in `Z*` or customer namespace only |
| Transport system | Uses gCTS or software components instead of classic transports |
| SAPQuery | `SAP_ALLOW_FREE_SQL=true` is required; custom tables and released CDS views are the practical targets, while many SAP standard tables are blocked |

## Cross-Platform Support

The browser login works on all platforms:
- **macOS**: Opens with `open` command
- **Linux**: Opens with `xdg-open` command
- **Windows**: Opens with `start` command

If the system cannot open a browser, the authorization URL is logged to stderr for manual copy-paste. The browser still has to reach the local callback listener, so this is practical on a laptop or WSL setup with local browser integration, but not for most remote/headless servers.

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
| `SAPRead` | Types CLAS, INTF, FUNC/FUGR where released/custom, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, DOMA, DTEL, TABLE_CONTENTS, TABLE_QUERY, DEVC, SYSTEM, COMPONENTS, MSAG (deprecated alias: MESSAGES), BSP/BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS. PROG, INCL, VIEW, TRAN, TEXT_ELEMENTS, VARIANTS, SOBJ, AUTH, FEATURE_TOGGLE/FTG2, ENHO, VERSIONS, VERSION_SOURCE are removed — returns helpful error if the LLM tries them. |
| `SAPSearch` | Works — returns released SAP objects and custom Z/Y objects. Classic programs and includes not searchable. |
| `SAPWrite` | Supports CLAS, INTF, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL/TABL/DT/TABL/DS, DOMA, DTEL, MSAG. Must use ABAP Cloud language version and custom namespaces. |
| `SAPActivate` | Works — no changes. |
| `SAPQuery` | Only custom Z/Y tables and released CDS entities (I_LANGUAGE, I_COUNTRY, etc.). SAP standard tables (DD02L, TADIR, MARA, etc.) are blocked. Returns helpful error with CDS view suggestions. |
| `SAPTransport` | Works, but release triggers gCTS Git push (not TMS export). Description explains this. |
| `SAPLint` | Works — runs client-side (abaplint). |
| `SAPDiagnose` | Works — ATC with ABAP_CLOUD_DEVELOPMENT_DEFAULT variant. |
| `SAPContext` | Supports CLAS, INTF, and DDLS. Use `action="impact"` for CDS blast-radius analysis. |
| `SAPNavigate` | Works — scope limited to released and custom objects. |
| `SAPManage` | Returns `systemType: "btp"` in probe results. |

## Automated Testing

ARC-1 has two tiers of BTP ABAP integration tests. With the current direct service-key test harness, both are local in practice because first authentication uses the browser Authorization Code flow. Tests skip when credentials are absent.

### Smoke Tests

Smoke tests verify core BTP connectivity and API contracts without mutating repository objects. They still use the same service-key OAuth provider as local ARC-1, so the first run may open a browser unless a token is already valid in the running process.

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

# With inline service key
TEST_BTP_SERVICE_KEY='{"uaa":{...},...}' npm run test:integration:btp:smoke
```

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
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp
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

### Cross-subaccount principal propagation fails

**Symptom:** Tool calls fail with `Principal propagation failed (SAP_PP_STRICT=true): Destination Service auth token error … Token header claim [kid] references unknown signing key` (or `Unable to map issuer: No identity provider found for issuer …`). MCP login itself works; only the SAP call fails, and the audit log shows `auth_pp_created` with `success:false`.

**Cause:** ARC-1 (its XSUAA) and the ABAP Environment are in **different BTP subaccounts**. `OAuth2UserTokenExchange` exchanges the MCP user's token at the ABAP env's XSUAA, but XSUAA tokens are subaccount-scoped — the ABAP env's XSUAA does not trust a signing key issued by another subaccount.

**Fix — pick one** (per SAP's [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html)):

1. **Same subaccount (simplest):** deploy ARC-1 in the **same subaccount** as the ABAP Environment and keep `OAuth2UserTokenExchange`. This is ARC-1's recommended one-instance-per-system model (see [BTP Setup for multiple systems](btp-cloud-foundry-deployment.md)).
2. **Different subaccounts:** change the destination's `Authentication` to **`OAuth2SAMLBearerAssertion`** and establish trust — register the source subaccount's Destination Service as a trusted IdP in the ABAP env's subaccount (see [User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow)). ARC-1 needs no code change — it already handles the bearer token this destination type returns.

To serve several ABAP systems across subaccounts from a single ARC-1 instance, use option 2 (trust set up once per backend).

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

For the research report covering authentication options, competitor analysis, and design decisions, see [btp-abap-environment-connectivity.md](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/completed/2026-04-01-btp-abap-environment-connectivity.md) in the repo.
