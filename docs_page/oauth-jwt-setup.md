# OAuth / JWT Setup

Use this guide when an external identity provider issues JWT access tokens for your ARC-1 HTTP server.
ARC-1 validates those tokens; it does not issue them. For SAP BTP sign-in, use [XSUAA setup](xsuaa-setup.md).

## When to Use

<a id="architecture"></a>

Choose this path for an existing OIDC provider and a client that can acquire tokens from it.
Check [client discovery compatibility](#auto-discovery-rfc-9728), especially for Microsoft Entra ID, before configuring the server.

## Identity Provider Setup

### Microsoft Entra ID (Azure AD)

1. Register the ARC-1 API in your tenant and record the tenant and application IDs.
2. Expose an API scope, such as `api://<client-id>/access_as_user`, and authorize the intended client.
3. For the v2 setup below, set `api.requestedAccessTokenVersion` to `2` in the API application manifest.
4. Register the client's exact redirect URI. Create a client secret only for a confidential client that needs one.
5. Obtain an access token for ARC-1 and inspect `iss`, `aud`, `exp` and scope claims locally.

Token version is controlled by the resource application's manifest; match the issuer metadata to that version.
See [Microsoft's access-token reference](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens).

For Power Platform, follow [Microsoft's custom-connector registration](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication)
and the connection settings below. Review permissions and consent with the identity owner.

### AWS Cognito

Use an OIDC-capable user pool and app client. Issuer format:
`https://cognito-idp.<region>.amazonaws.com/<pool-id>`.
Confirm the issued access token contains the audience ARC-1 will validate.
See [Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html).

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

For a Power Platform custom connector, use the registered application's credentials and exact redirect URI.
For the single-tenant Entra setup:

| Connector field | Value |
|---|---|
| Host | ARC-1's external hostname |
| Base URL | `/` |
| Authentication | OAuth 2.0 / Microsoft Entra ID |
| Client ID / secret | The approved connector registration |
| Tenant ID | Your tenant GUID |
| Resource URL for the same-app flow | Raw API client-ID GUID |
| Scope | `api://<api-client-id>/access_as_user offline_access` |
| Action | `POST https://<arc1-host>/mcp` |

Save the connector, copy its generated redirect URI into the Entra registration, then create a connection and sign in.
Preserve existing redirect URIs when adding a new one.

#### Troubleshooting Copilot Studio

| Error | Next check |
|---|---|
| `AADSTS50011` | Match the reported redirect URI and application ID to the intended registration |
| `AADSTS90009` | Confirm whether the connector requests a token for its own app; review resource/audience format |
| `AADSTS90008` | Have the identity owner inspect the connector's required API permissions; add only approved permissions |
| `AADSTS65001` | Check the requested scopes and tenant consent policy with the identity owner |
| Sign-in fails or popup closes | Inspect the exact provider error, tenant, redirect URI and client registration before changing grants |

### Manual Token Testing

Obtain a token through the approved client flow and run the [JWT smoke tests](auth-test-process.md#oauth-jwt-setup).
The token must target ARC-1, not Microsoft Graph or another API.

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

Once protected-resource metadata exists, MCP clients send the [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)
`resource` parameter on `/authorize` and `/token` — the MCP spec requires it. **Entra ID v2.0 does not accept
that parameter** and answers `AADSTS9010010: The resource parameter provided in the request doesn't match with
the requested scopes` (or `AADSTS901002: The 'resource' request parameter is not supported`). Verified against a
live tenant: the identical request without `resource` succeeds.

If your Entra sign-in fails that way, turn discovery off:

```bash
SAP_OIDC_DISCOVERY=false
```

This removes ARC-1's discovery document. For a client that supports a manual authorization-server override,
configure the IdP metadata directly and verify the new request. Whether the client omits `resource` depends on that client's behavior;
disabling discovery alone is not a guarantee.

For example, clients with an `authServerMetadataUrl` setting can point it to
`https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`.
Clients without a compatible manual path need a supported provider/client combination or a broker.
Keep discovery enabled for providers that support the client's normal OAuth flow.

#### If you need Claude.ai / Claude Desktop connectors behind Entra today

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
