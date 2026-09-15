# BTP ABAP Environment setup

Connect ARC-1 to SAP BTP ABAP Environment (Steampunk). Choose the connection for your environment:

| ARC-1 runs on | Authentication | Continue |
|---|---|---|
| Shared BTP Cloud Foundry service | Each user's identity through a destination | [BTP setup](#recommended-btp-deployment-with-a-per-user-destination) |
| Developer laptop | Service key plus interactive browser login | [Local setup](#local-development-service-key-browser-login) |

Both call the `.abap.` API host and need no Cloud Connector. Leave `SAP_DISABLE_SAML` unset or false.

## Before you start

- Confirm [SAP-side prerequisites](btp-abap-prerequisites.md), including an Eclipse ADT login and the developer role.
- Obtain the ABAP service key through your secret-management process.
- For BTP deployment, use the same subaccount as the ABAP Environment. Different subaccounts need the [SAML trust path](#cross-subaccount-principal-propagation-fails).

## Recommended: BTP deployment with a per-user destination

XSUAA authenticates the MCP user. Destination Service exchanges that user's token for an ABAP token, so SAP applies their own permissions.

<a id="1-bind-the-btp-services"></a>

### 1. Prepare the ARC-1 checkout

Complete [deployment steps 1–3](btp-cloud-foundry-deployment.md#1-choose-the-topology-before-configuring-anything), then clone the source and run `npm ci` as shown at the start of step 4. Return here for the destination and extension below; do not select an on-premise profile. The MTA will bind XSUAA and Destination during deployment. This cloud connection does not need Connectivity or Cloud Connector; the base MTA's Connectivity binding is harmless.

### 2. Create the per-user destination

Create an HTTP destination in **BTP Cockpit → Connectivity → Destinations**:

| Field | Value |
|---|---|
| `Name` | `ABAP_PP` |
| `Type` | `HTTP` |
| `URL` | Service key `abap.url` when present, otherwise `url`: `https://<guid>.abap.<region>.hana.ondemand.com` |
| `ProxyType` | `Internet` |
| `Authentication` | `OAuth2UserTokenExchange` |
| `tokenServiceURL` | Service key `uaa.url` plus `/oauth/token` |
| `clientId` | Service key `uaa.clientid` |
| `clientSecret` | Service key `uaa.clientsecret` |

The OAuth client belongs to the ABAP instance. Store its secret in the destination, not ARC-1's env or source. `OAuth2UserTokenExchange` requires the same identity zone/subaccount; see SAP's [property reference](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication).

### 3. Configure ARC-1

For a new deployment, create `mta-overrides.mtaext` with this configuration. For an existing deployment, merge the properties into its protected extension:

```yaml
_schema-version: "3.1"
ID: arc1-mcp-overrides
extends: arc1-mcp

modules:
  - name: arc1-mcp-server
    properties:
      SAP_SYSTEM_TYPE: btp
      SAP_TRANSPORT: http-streamable
      SAP_XSUAA_AUTH: "true"
      SAP_PP_ENABLED: "true"
      SAP_PP_STRICT: "true"
      SAP_BTP_DESTINATION: ABAP_PP
      SAP_ALLOW_WRITES: "false"
      SAP_ALLOW_DATA_PREVIEW: "false"
      SAP_ALLOW_FREE_SQL: "false"
      SAP_ALLOW_TRANSPORT_WRITES: "false"
      SAP_ALLOW_GIT_WRITES: "false"
```

Keep any separate `SAP_BTP_PP_DESTINATION` absent unless it intentionally names this cloud destination. Continue at [deployment step 5](btp-cloud-foundry-deployment.md#5-validate-build-and-inspect-the-mtar) for validation, archive inspection and deployment, then complete the DCR and role checks.

### 4. Grant users access

1. Assign the test user `ARC-1 Viewer (<space>)` in BTP; see [Authorization](authorization.md).
2. Give the matching ABAP user `SAP_BR_DEVELOPER`; see [SAP prerequisites](btp-abap-prerequisites.md#3-assign-the-developer-role).
3. Sign in to the MCP endpoint and call `SAPRead` with `type: "COMPONENTS"`.

BTP role collections and ABAP business roles grant different permissions; both are needed.

### 5. Verify

Check the deployed app's logs after a safe read:

```bash
cf logs arc1-mcp-server --recent
```

With `SAP_VERBOSE=true`, successful setup logs include `PP: using destination-exchanged Bearer token (OAuth2UserTokenExchange)` and `auth_pp_created` with `success:true`. These confirm exchange/client creation; verify the actual ABAP user separately with the ABAP administrator. A successful setup log alone does not prove backend identity.

## Local development: service key + browser login

Use this for one developer on a laptop with Node.js 22.19 or later. The examples run ARC-1 through `npx`. ARC-1 opens a browser for OAuth login and stores tokens in memory. The callback binds to loopback, so this flow is unsuitable for a shared/headless server.

### Configure ARC-1

```bash
mkdir -p ~/.config/arc-1
cp ~/Downloads/service-key.json ~/.config/arc-1/btp-service-key.json
chmod 600 ~/.config/arc-1/btp-service-key.json

SAP_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-service-key.json SAP_SYSTEM_TYPE=btp npx -y arc-1
```

Alternatives: `SAP_BTP_SERVICE_KEY='{"uaa":{…},"url":"…"}'` (inline JSON, short-lived local env only)
or the CLI flags `--btp-service-key-file` / `--btp-service-key`.

### MCP client configuration

Two env vars in the client's stdio server entry — the rest of the file follows your client's normal
format ([Install in Claude](install-in-claude.md), [Local Development](local-development.md#mcp-client-configuration)):

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

### First login

Make a tool call and complete the browser login. ARC-1 uses Authorization Code + PKCE with a loopback callback (`SAP_BTP_OAUTH_CALLBACK_PORT`, auto by default). It refreshes access tokens while the refresh token remains valid.

If no browser opens, use the URL logged to stderr from a browser that can reach the same machine's callback. For remote servers, use the deployed destination path.

### Smoke test

Ask your MCP client to read system components, then search for a known custom class. Login should open once and the calls should return SAP results.

A `client_credentials` token cannot replace the user login; ADT requires user context.

## System type: `SAP_SYSTEM_TYPE=btp`

Set `SAP_SYSTEM_TYPE=btp` so the first tool catalog uses ABAP Cloud definitions. With the default `auto`, discovery adapts the catalog after startup and the first listing may still contain on-premise types.

## What to expect on BTP ABAP

ARC-1 adapts its [tool catalog](tools.md) to ABAP Cloud and detected system capabilities.

| Area | Difference from on-premise |
|---|---|
| Development | ABAP Cloud language rules and released APIs; classic programs/includes are unavailable |
| Data | Custom tables and released CDS entities can be queried when enabled; SAP standard tables are blocked |
| Transport | Software-component transport flow differs from classic TMS; transport release can trigger a Git push |
| Diagnostics | ATC uses the system's default variant unless you select one |
| Object support | Discovery controls release-dependent types; a registered type does not guarantee backend create support |

## Writing objects on BTP

After read/identity verification, enable writes and allow an exact development package:

```dotenv
SAP_ALLOW_WRITES=true
SAP_ALLOWED_PACKAGES=ZARC1_DEV
```

For CF, put these in the protected `.mtaext` and deploy. `$TMP` is unavailable and the `ZLOCAL` structure package cannot contain objects. Create a development sub-package under `ZLOCAL`, or a package in your own transportable software component.

`SAPManage(action="create_package")` needs the **internal ABAP username** as `responsible`, not the IAS email. ARC-1 can infer it from an object created in the session; otherwise supply it explicitly. A new tenant may need its first package created through Eclipse ADT. See [package prerequisites](btp-abap-prerequisites.md#6-a-development-package-writes-only).

ARC-1 uses ABAP Cloud creation metadata automatically. Backend feature support remains authoritative; UIAD writes are unverified on ABAP Environment, and DSFD/DTDC support is discovery-gated.

## Constraints vs on-premise

Use SAP's [ABAP Cloud development model](https://help.sap.com/docs/abap-cloud/abap-cloud/abap-cloud-in-nutshell) for language, API and transport constraints. These apply even when ARC-1 enables a capability.

## Configuration reference

### Deployed BTP CF destination

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_DESTINATION` | Destination with `Authentication=OAuth2UserTokenExchange`. Resolved at startup; a change needs a restart. |
| `SAP_BTP_PP_DESTINATION` | Optional separate per-user destination name; falls back to `SAP_BTP_DESTINATION`. |
| `SAP_PP_ENABLED=true` / `--pp-enabled` | Enables the per-user destination path |
| `SAP_PP_STRICT=true` / `--pp-strict` | Rejects API-key / non-JWT tool calls; keep enabled for this per-user cloud connection. |
| `SAP_XSUAA_AUTH=true` / `--xsuaa-auth` | MCP clients authenticate through XSUAA OAuth |
| `SAP_SYSTEM_TYPE=btp` / `--system-type btp` | ABAP Cloud tool definitions from startup |

### Local service-key OAuth

| Variable / Flag | Description |
|---|---|
| `SAP_BTP_SERVICE_KEY_FILE` / `--btp-service-key-file` | Path to the service key JSON |
| `SAP_BTP_SERVICE_KEY` / `--btp-service-key` | Inline service key JSON |
| `SAP_BTP_OAUTH_CALLBACK_PORT` / `--btp-oauth-callback-port` | Loopback port for the OAuth callback (default: auto) |
| `SAP_SYSTEM_TYPE` / `--system-type` | `auto` (default), `btp`, `onprem` |

Full option semantics: [Configuration Reference](configuration-reference.md#b3-btp-abap-environment-direct-oauth).

## Troubleshooting

### Cross-subaccount principal propagation fails

**Symptom:** MCP login works, but every tool call fails with `Principal propagation failed:
Destination Service auth token error … Token header claim [kid] references unknown signing key` (or
`Unable to map issuer: No identity provider found for issuer …`), and the audit log shows
`auth_pp_created success:false`.

The systems may be in different identity zones. Check their subaccounts and destination authentication before changing roles.

**Fix — pick one** (SAP's rule in [Routing via Destination](https://help.sap.com/docs/btp/sap-business-technology-platform/routing-via-destination):
same subaccount → `OAuth2UserTokenExchange`, different subaccounts → `SAMLAssertion`):

1. **Same subaccount (simplest):** deploy ARC-1 into the ABAP Environment's subaccount and keep the
   destination as-is.
2. **Different subaccounts:** configure the documented `SAMLAssertion` destination and register the source subaccount's Destination service as a trusted
   IdP in the ABAP environment's subaccount — see
   [OAuth SAML Bearer Assertion Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-saml-bearer-assertion-authentication)
   and [User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow).
   ARC-1 consumes either returned assertion or bearer token. This path is verified on S/4HANA Public Cloud; ABAP Environment cross-subaccount verification is still required.

### 401 after a successful login

The token was issued but SAP rejected it — usually the missing `SAP_BR_DEVELOPER` business role
([prerequisites](btp-abap-prerequisites.md#3-assign-the-developer-role)). BTP role collections do not
substitute for it.

### 403 on specific ADT endpoints

Login works, one endpoint does not: the business role lacks that authorization, or a cross-system
scenario (e.g. remote ATC) needs a communication arrangement. See the
[SAP-side troubleshooting table](btp-abap-prerequisites.md#troubleshooting-sap-side).

### Browser opens but login fails / the browser never opens

Verify the service key is current with the ABAP administrator and that its `uaa.url`
matches the system's region. When ARC-1 cannot launch a browser it logs the authorization URL —
copy/paste only works if that browser can reach the loopback callback, which rules out most remote
and headless hosts. Use the [deployed destination path](#recommended-btp-deployment-with-a-per-user-destination)
there.

### Connection works in `curl` but not in ARC-1

Run with `--verbose` / `SAP_VERBOSE=true` and read stderr: it shows the resolved URL, the OAuth flow
and every ADT request. Check the service-key path is readable, and that the URL is the `.abap.` API
host.

### Timeouts / `ECONNREFUSED` on a free-tier system

Free-tier systems stop automatically each night. Start the system through **Landscape Portal → Manage System Hibernation** before retrying; opening the Fiori launchpad does not start it. See SAP's [hibernation guidance](https://help.sap.com/docs/btp/btp-developers-guide/use-system-hibernation).

## References

- [SAP-Side Prerequisites](btp-abap-prerequisites.md) — provisioning, booster, developer role, service key
- [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) · [BTP Destination Setup](btp-destination-setup.md) · [Principal Propagation](principal-propagation-setup.md)
- [S/4HANA Public Cloud](s4hana-public-cloud.md) — the sibling ABAP Cloud setup (`SAMLAssertion`)
- SAP: [OAuth User Token Exchange Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication) · [Routing via Destination](https://help.sap.com/docs/btp/sap-business-technology-platform/routing-via-destination)
- Testing ARC-1 against a BTP ABAP system (contributors): [Authentication Test Process](auth-test-process.md#btp-abap-environment-service-key)
- Design background: [BTP ABAP Environment connectivity report](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/completed/2026-04-01-btp-abap-environment-connectivity.md)
