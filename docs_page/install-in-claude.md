# Install in Claude

Choose your Claude app and whether ARC-1 runs on your computer or on a shared server.

| You use… | ARC-1 runs… | Install path | Skills included? |
|---|---|---|---|
| **Claude Desktop** | locally (`npx`, your machine) | [One-click `.mcpb` — or hand-edit JSON](#claude-desktop-one-click-mcpb) | No |
| **Claude Code** | locally (`npx`, your machine) | [Plugin](#claude-code-plugin-server-skills) (`/plugin install`) | Yes |
| **claude.ai / Desktop / mobile / Cowork** | remotely (BTP Cloud Foundry) | [Custom connector](#remote-btp-cloud-foundry-custom-connector) (URL + OAuth) | No |
| **Claude Code** | remotely (BTP Cloud Foundry) | [`claude mcp add --transport http`](#remote-btp-cloud-foundry-custom-connector) | add separately |

The Claude Code plugin includes the server and SAP workflow [skills](skills.md). Desktop bundles
and remote connectors provide the tools; install skills separately where your client supports them.

## Claude Desktop — one-click (`.mcpb`)

Use this when SAP is reachable from your computer.

1. Download the latest **`arc-1-<version>.mcpb`** from the
   [Releases page](https://github.com/arc-mcp/arc-1/releases).
2. **Double-click** it, or open Claude Desktop → **Settings → Extensions** and drag the file in.
3. Claude prompts for your SAP connection. **URL, user, and password** are required (the password is
   stored in your OS keychain). The rest are optional and default to the safe choice — client,
   language, TLS, and the **safety toggles** (Allow Writes, the write **package scope**, data preview,
   free SQL, transport and Git writes). Fill them in and enable the extension. Full field list:
   [configuration reference](configuration-reference.md).
4. Ask Claude: *"Using the SAP tools, show me the source of report `RSPO0041`."* — it should call
   `SAPRead`.

The bundle uses in-memory caching. Writes remain off by default; when enabled, the default package
scope is `$TMP`. For persistent SQLite caching, see [Docker](docker.md).

### Or hand-edit the JSON directly

Skip the bundle and edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sap": {
      "command": "npx",
      "args": ["-y", "arc-1@latest"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "YOUR_USER",
        "SAP_PASSWORD": "YOUR_PASS",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

Read-only by default; restart Claude Desktop after editing. To enable writes, SQL, data preview, or
transports, add the `SAP_ALLOW_*` flags to the `env` block — see
[capability settings](configuration-reference.md#capability-flags).

## Claude Code — plugin (server + skills)

Install the plugin from the repository marketplace:

```text
/plugin marketplace add arc-mcp/arc-1
/plugin install arc-1@arc-1
```

Claude Code prompts for your SAP connection when the plugin is enabled (password → OS keychain),
starts the `arc-1` MCP server via `npx`, and loads the skills namespaced as `/arc-1:<skill>` — e.g.
`/arc-1:generate-rap-service`. Manage it with `/plugin`; run `/reload-plugins` after an update.

### Install only the server or only the skills

For only the MCP server, configure SAP in a protected `.env` file as shown in the
[CLI connection setup](cli-guide.md#configure-the-sap-connection). From that directory, run:

```bash
claude mcp add arc-1 -- npx -y arc-1@latest
claude
```

Keep the working directory the same so ARC-1 can read `.env`. Do not put the password in
`claude mcp add --env` arguments. See [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)
for other ways to supply the server environment.

For only the skills, run `npx skills add arc-mcp/arc-1`; see [Skills](skills.md).

## Remote (BTP Cloud Foundry) — custom connector

Use the endpoint URL supplied by your ARC-1 administrator.

=== "claude.ai / Desktop / mobile / Cowork"

    1. Open **Settings → Connectors → Add custom connector**.
    2. Paste your server URL: `https://<your-cf-app>/mcp`.
    3. Authenticate via OAuth (XSUAA). For most clients ARC-1's Dynamic Client Registration handles
       the rest; if your client asks, supply the OAuth Client ID / Secret under *Advanced settings*.

    !!! warning "The endpoint must be internet-reachable"
        Claude connects to your server **from Anthropic's cloud**, not from your device. The CF
        route is public by design, with XSUAA OAuth + scopes enforcing access — but a server bound
        only to an internal network won't work for these clients.

=== "Claude Code (remote)"

    ```bash
    claude mcp add --transport http arc-1 "https://<your-cf-app>/mcp"
    ```

    Claude Code opens a browser for the OAuth login. Add the [skills](#claude-code-plugin-server-skills)
    separately with `npx skills add arc-mcp/arc-1`.

**Setting up the deployment** (XSUAA, Destination Service, Cloud Connector, per-user principal
propagation) is covered in [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md),
[XSUAA Setup](xsuaa-setup.md), and [Principal Propagation](principal-propagation-setup.md).

## Next steps

- **SSO-only local SAP:** use the [cookie extractor](local-development.md#sso-only-on-prem-cookie-extractor).
- **First SAP task:** follow [Using the tools](mcp-usage.md).
- **Missing capabilities:** check [Authorization](authorization.md).
