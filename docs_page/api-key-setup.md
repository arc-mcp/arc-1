# API Key Setup

<a id="when-to-use"></a><a id="architecture"></a>

Use API keys to protect a shared ARC-1 HTTP server without an identity provider.
Each key selects a fixed access profile. SAP sees the shared technical account configured on the server.
For per-user SAP identity, use [Principal Propagation](principal-propagation-setup.md).

## Server Setup

### 1. Generate an API Key

Generate 32 random bytes and retain the value in your secret store:

```bash
ARC1_VIEWER_KEY=$(openssl rand -base64 32)
```

### 2. Start arc1 with API Key

Configure the existing SAP connection through your environment or secret injection.
For this local HTTP test, bind only to loopback:

```bash
export SAP_URL=https://sap.example.com
export SAP_USER=YOUR_TECHNICAL_USER
export SAP_PASSWORD='REPLACE_WITH_YOUR_PASSWORD'
export SAP_TRANSPORT=http-streamable
export ARC1_HTTP_ADDR=127.0.0.1:8080
export ARC1_API_KEYS="$ARC1_VIEWER_KEY:viewer"
arc1
```

The server starts read-only, with table preview and SQL disabled.

### 3. Test the Connection

In another shell, set `ARC1_VIEWER_KEY` to the same generated key. A request without it must return `401`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/mcp
```

A valid key should return the permitted tools:

```bash
curl -sS http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $ARC1_VIEWER_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Then connect an MCP client and run `SAPRead(type="SYSTEM")` to verify SAP access.
See [Authentication tests](auth-test-process.md) for negative tests.

## Multi-Key Setup (Role-Based Access)

<a id="1-generate-keys-per-role"></a><a id="2-start-arc1-with-per-key-profiles"></a>

Generate one key per required profile and configure the mapping on the server:

```bash
ARC1_DEVELOPER_KEY=$(openssl rand -base64 32)
export ARC1_API_KEYS="$ARC1_VIEWER_KEY:viewer,$ARC1_DEVELOPER_KEY:developer"
export SAP_ALLOW_WRITES=true
export SAP_ALLOWED_PACKAGES='$TMP'
arc1
```

The viewer remains read-only. The developer can write in `$TMP`.
Transport and Git mutations need their separate server flags too; see [Capability requirements](authorization.md#capability-requirements).

### Available Profiles

| Need | Profile |
|---|---|
| Source reads | `viewer` |
| Reads and named table preview | `viewer-data` |
| Reads, table preview and SQL | `viewer-sql` |
| Development in `$TMP` | `developer` |
| Development and table preview | `developer-data` |
| Development, table preview and SQL | `developer-sql` |
| All scopes, within the server ceiling | `admin` |

Profiles cannot widen server permissions. `developer*` profiles always cap package writes to `$TMP`;
there is no custom profile or `key:developer:Z*` syntax. For writes to transportable packages, use
OIDC/XSUAA or an `admin` key on a server with a narrow package ceiling.
The exact scope and safety mapping is in [API-key profiles](authorization.md#api-key-profiles-non-btp).

### Test Per-Key Access

<a id="3-test-per-key-access"></a>

Repeat `tools/list` with each key. A viewer should not see `SAPWrite`; a developer should see it only
when writes are enabled on the server. API-key users with the same profile share the same profile identity in audit and quota accounting.

## Client Configuration

Clients send `Authorization: Bearer <key>`. The `:profile` suffix stays on the server.

### VS Code / Cursor

For VS Code, use `.vscode/mcp.json`:

```json
{
  "servers": {
    "arc1": {
      "type": "http",
      "url": "https://arc1.company.com/mcp",
      "headers": {"Authorization": "Bearer REPLACE_WITH_YOUR_KEY"}
    }
  }
}
```

For Cursor, add the same URL and header in its MCP server configuration.
See [client configuration](quickstart.md) for client-specific file formats.

### Copilot Studio

Choose API-key authentication for the MCP connection. Set the header name to `Authorization`
and the header value to `Bearer <your-key>`.

### Claude Desktop (via mcp-remote)

For Claude Desktop connection options, use [Connect Claude](install-in-claude.md).
If your setup needs an HTTP bridge, configure its Authorization header through its supported secret handling;
keep the API key out of command-line arguments and tracked configuration.

## Production Deployment

<a id="docker"></a>

Use the maintained [Docker guide](docker.md) or [deployment guide](deployment.md).
Inject `ARC1_API_KEYS` through the deployment's secret handling and expose HTTP only behind HTTPS.

### Behind a Reverse Proxy (nginx)

A proxy must preserve the MCP and OAuth paths, support streaming and sanitize forwarded headers.
Use the [reverse proxy requirements](security-guide.md#7-reverse-proxy-requirements).

## Security Notes

Store keys outside tracked client configuration. To rotate one, add the replacement, restart the server,
update its clients, then remove the old key and restart again. After compromise, remove the old key immediately.

## Limitations

<a id="next-steps"></a>

API keys do not provide individual SAP identity or user-level revocation.
Use [OIDC](oauth-jwt-setup.md) or [XSUAA](xsuaa-setup.md) when you need individual sign-in.
