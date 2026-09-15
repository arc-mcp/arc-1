# OAuth and JWT setup

<a id="oauth-jwt-setup"></a>

Use this guide when an external identity provider issues JWT access tokens for your ARC-1 HTTP server.
ARC-1 validates those tokens; it does not issue them. For SAP BTP sign-in, use [XSUAA setup](xsuaa-setup.md).

## When to Use

<a id="architecture"></a>

Choose this path for an existing OIDC provider and a client that can acquire tokens from it.
Check [client discovery compatibility](#auto-discovery-rfc-9728), especially for Microsoft Entra ID, before configuring the server.

## Identity Provider Setup

### Microsoft Entra ID (Azure AD)

1. Open **Microsoft Entra ID → App registrations → New registration**. For this setup, select **Single tenant** and record the tenant and application client IDs.
2. Open **Expose an API**, set the Application ID URI (`api://<client-id>`), and add the delegated scope `access_as_user`. Authorize the intended client for it.
3. Under **Manifest**, set `api.requestedAccessTokenVersion` to `2` on the API application.
4. Under **Authentication**, add the client's exact redirect URI. For a confidential client such as the connector below, create a secret under **Certificates & secrets** and save its value immediately in your secret store.
5. Obtain an access token for ARC-1 and inspect `iss`, `aud`, `exp` and scope claims locally.

Token version is controlled by the resource application's manifest. Check the actual access-token claims before setting ARC-1:

| Token version | Expected `iss` in the public Azure cloud | `aud` |
|---|---|---|
| v2 (`ver=2.0`) | `https://login.microsoftonline.com/<tenant-id>/v2.0` | API application client-ID GUID |
| v1 (`ver=1.0`) | `https://sts.windows.net/<tenant-id>/` | API client-ID GUID or resource URI, depending on the request |

Use the matching issuer metadata and exact audience; a v1 token does not become v2 because the client used a v2 sign-in endpoint. See [Microsoft's claim reference](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference).

For Power Platform, follow [Microsoft's custom-connector registration](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication)
and the connection settings below. Review permissions and consent with the identity owner.

### AWS Cognito

Use an OIDC-capable user pool and app client. Issuer format:
`https://cognito-idp.<region>.amazonaws.com/<pool-id>`.
Cognito access tokens normally identify the client with `client_id`. ARC-1's OIDC configuration requires an audience, so the access token must contain a matching `aud`. Use a supported resource-binding flow that adds the API audience, then set `SAP_OIDC_AUDIENCE` to that exact URL. Do not substitute an ID token. See [Cognito access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html).

### Keycloak

Create the realm and client for your MCP application. Issuer format:
`https://keycloak.company.com/realms/<realm>`.
Configure access-token audience and ARC-1 scopes; see [Keycloak realm configuration](https://www.keycloak.org/docs/latest/server_admin/#configuring-realms).

## Server Setup

<a id="start-arc1-with-oidc-validation"></a><a id="environment-variables"></a>

Set the issuer and the exact audience of the access token issued for ARC-1. ARC-1 refuses to start with an issuer but no audience.
Configure SAP credentials separately through your deployment's secret handling.

```bash
export SAP_TRANSPORT=http-streamable
export ARC1_HTTP_ADDR=127.0.0.1:8080
export SAP_OIDC_ISSUER='https://login.microsoftonline.com/REPLACE_WITH_TENANT_ID/v2.0'
export SAP_OIDC_AUDIENCE='REPLACE_WITH_API_CLIENT_ID'
export SAP_OIDC_SCOPES='api://REPLACE_WITH_API_CLIENT_ID/access_as_user'
arc1
```

Use a TLS reverse proxy and `ARC1_PUBLIC_URL` for remote access. On CF, place non-secret settings in the deployment descriptor.

### How ARC-1 permissions are derived

ARC-1 recognizes `read`, `write`, `data`, `sql`, `transports`, `git`, `admin` in `scope` or `scp`.
A verified token with no accepted ARC-1 scopes receives fallback `read`, including an `access_as_user`-only token.
To grant more, configure the IdP to issue the matching ARC-1 scopes; `SAP_OIDC_SCOPES` advertises requested IdP scopes, not a scope mapping.

All operations still require the [server flags and SAP permissions](authorization.md#capability-requirements).
OIDC sign-in does not change the SAP identity: configure [PP](principal-propagation-setup.md) or
[BTP ABAP user-token exchange](btp-abap-environment.md) for per-user SAP access.

## Client Configuration

### VS Code (with OAuth)

VS Code supports MCP OAuth natively. Configure in `.vscode/mcp.json`:

```json
{
  "servers": {
    "arc1": {
      "type": "http",
      "url": "https://arc1.company.com/mcp"
    }
  }
}
```

The client reads ARC-1's protected-resource metadata and follows its IdP metadata.
Whether sign-in completes depends on the client's registration and the IdP's supported OAuth flow.
Set `SAP_OIDC_SCOPES` to the scopes your IdP expects; see [discovery](#auto-discovery-rfc-9728).

### Microsoft Copilot Studio / Power Automate

<a id="step-1-create-custom-connector"></a><a id="step-2-configure-security-tab"></a><a id="step-3-create-definition"></a><a id="step-4-add-redirect-uri-to-entra-id"></a><a id="step-5-create-connection"></a>

Before configuring the connector, open its Entra registration → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → **User.Read**. Ensure consent has been granted; use **Grant admin consent** when tenant policy requires it or the administrator preapproves team access. This supplies the sign-in permission; ARC-1 does not call Graph. Microsoft also documents delegated `openid` as an alternative for flows using it. See [Microsoft consent troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/troubleshoot-consent-issues).

In [Power Automate](https://make.powerautomate.com/), open **Custom connectors → New custom connector → Create from blank**. Set the host/base URL on **General**, OAuth fields on **Security**, and the MCP action on **Definition**. Use the connector registration's credentials and exact redirect URI:


| Connector field | Value |
|---|---|
| Host | ARC-1's external hostname |
| Base URL | `/` |
| Authentication | OAuth 2.0 / Microsoft Entra ID |
| Client ID / secret | The approved connector registration |
| Tenant ID | Your tenant GUID |
| Resource URL for the same-app flow | Raw API client-ID GUID |
| Scope | `api://<api-client-id>/access_as_user offline_access` |
| Definition action / operation ID | `InvokeServer` |
| Action URL | `POST https://<arc1-host>/mcp` |

Save the connector, copy its generated redirect URI from **Security**, and add it under the Entra registration's **Authentication → Add a platform → Web**. Then create a connection and sign in.
Preserve existing redirect URIs when adding a new one.

#### Troubleshooting Copilot Studio

| Error | Next check |
|---|---|
| `AADSTS50011` | Match the reported redirect URI and application ID to the intended registration |
| `AADSTS90009` | Confirm whether the connector requests a token for its own app; review resource/audience format |
| `AADSTS90008` | Check the sign-in permission (`User.Read` or supported `openid`) and consent on the application named in the error; follow the steps above |
| `AADSTS65001` | Check the requested scopes and tenant consent policy with the identity owner |
| Sign-in fails or popup closes | Inspect the exact provider error, tenant, redirect URI and client registration before changing grants |

### Manual Token Testing

For Entra, an administrator must first allow Azure CLI as a client for the API's delegated scope. Then acquire a user token without printing it:

```bash
az login --tenant <tenant-id> --allow-no-subscriptions
ARC1_TEST_TOKEN=$(az account get-access-token \
  --tenant <tenant-id> \
  --scope api://<api-client-id>/access_as_user \
  --query accessToken --output tsv)
```

See [Azure CLI token acquisition](https://learn.microsoft.com/en-us/cli/azure/account?view=azure-cli-latest#az-account-get-access-token). If the tenant refuses CLI consent, use the approved MCP client flow; requesting a Graph token will not fix ARC-1 audience validation.

Run the [JWT smoke tests](auth-test-process.md#oauth-jwt-setup), then `unset ARC1_TEST_TOKEN`. Other providers require their own approved access-token flow.

## Auto-discovery (RFC 9728)

With `SAP_OIDC_ISSUER` set, ARC-1 publishes OAuth 2.0 Protected Resource Metadata — the mechanism MCP
clients use to find your IdP without per-client configuration. ARC-1 stays a pure resource server: it
advertises *where* the authorization server is and mints no tokens itself.

```bash
curl -s https://arc1.company.com/.well-known/oauth-protected-resource/mcp | jq .
```
```json
{
  "resource": "https://arc1.company.com/mcp",
  "authorization_servers": ["https://login.microsoftonline.com/<tenant-id>/v2.0"],
  "bearer_methods_supported": ["header"],
  "resource_name": "ARC-1 SAP MCP Server",
  "scopes_supported": ["api://<client-id>/access_as_user"]
}
```

- The document is served at the RFC 9728 path-insertion URL (`…/oauth-protected-resource/mcp`), at the
  root fallback, and — behind a base-path proxy — at the `ARC1_PUBLIC_URL` prefix. Every `401` on `/mcp`
  carries `resource_metadata="…"` pointing at it.
- With a base-path proxy, also route the host-root `/.well-known/oauth-protected-resource*` path to ARC-1:
  SDK clients may insert the well-known path before the public base path (for example,
  `https://gateway.example.com/.well-known/oauth-protected-resource/arc1/mcp`). If that route does not
  reach ARC-1, the gateway returns its own `404`/`502` before ARC-1 can serve the prefix-aware document.
- URLs come from `ARC1_PUBLIC_URL` (or the CF route), never from the request `Host` header. Set
  `ARC1_PUBLIC_URL` when ARC-1 sits behind a reverse proxy.
- `scopes_supported` appears only when you set `SAP_OIDC_SCOPES`. Clients request exactly these scopes at
  your IdP, so they must be **your IdP's** scope names — ARC-1 cannot derive them from `SAP_OIDC_AUDIENCE`.
- ARC-1 does **not** serve `/.well-known/oauth-authorization-server`: it is not the authorization server.
  Clients read your IdP's own metadata from the issuer (Entra answers at
  `{issuer}/.well-known/openid-configuration`).

### Microsoft Entra ID caveat — `AADSTS9010010`

MCP clients can include the [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) `resource` parameter in authorization and token requests. Entra v2 can reject this with `AADSTS9010010` or `AADSTS901002` even when the requested scope is correct.

With `mcp-remote` 0.14.2, keep discovery enabled and add `--disable-resource-parameter` to its arguments. This omits the parameter from the OAuth flow; see [the bridge's documented Entra option](https://github.com/punkpeye/mcp-remote#extra-authorization-parameters). Confirm your installed version supports it.

For another client, check whether it can omit `resource`. If it instead requires manual issuer metadata, you can disable ARC-1 discovery:

```bash
SAP_OIDC_DISCOVERY=false
```

This removes ARC-1's discovery document. It does not itself control the client's OAuth request parameters.

For example, clients with an `authServerMetadataUrl` setting can point it to
`https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.
Clients without a compatible manual path need a supported provider/client combination or a broker.
Keep discovery enabled for providers that support the client's normal OAuth flow.

#### Clients that need an OAuth broker

Some client/provider combinations need an OAuth broker. It must own discovery and preserve the user's
identity through a user-facing flow; a `client_credentials` shortcut cannot provide per-user PP.
Set `SAP_OIDC_DISCOVERY=false` if the broker serves the protected-resource metadata.
A broker is an additional service to operate and secure; ARC-1 does not provide it.

## How It Works

ARC-1 discovers the IdP's signing-key endpoint, verifies signature, issuer, audience and expiry,
then applies ARC-1 scopes and server policy. SAP authentication and authorization run separately.

## Security Notes

Keep tokens out of shared tools, logs and tickets. Use trusted HTTPS for issuer discovery.
`SAP_OIDC_CLOCK_TOLERANCE` permits explicit clock skew for expiry/not-before validation; default is zero.

## References

- [MCP Specification - Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — OAuth 2.1 auth for MCP servers, including Protected Resource Metadata
- [RFC 9728 - OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728) — Auto-discovery of authorization servers
- [Microsoft Entra ID - App Registrations](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) — Microsoft Entra app setup
- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) — AWS IdP setup
- [Keycloak - Creating a Realm](https://www.keycloak.org/docs/latest/server_admin/#configuring-realms) — Open-source IdP setup

## Next Steps

→ [Principal Propagation Setup](principal-propagation-setup.md) — Per-user SAP authentication
