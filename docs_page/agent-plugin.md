# Agent Plugin

ARC-1 is available as an [Agent Plugins 1.0](https://agent-plugins.org/) package alongside the
Claude Desktop `.mcpb` extension. One installation provides the ARC-1 MCP server and all 22 SAP
development skills in this repository.

The portable package is the repository root:

```text
arc-1/
├── plugin.json       # Agent Plugins 1.0 identity and metadata
├── mcp.json          # portable stdio MCP server definition
└── skills/           # Agent Skills discovered on demand
```

Compatible clients include GitHub Copilot in VS Code, Copilot CLI and the Copilot app, Cursor,
ChatGPT/Codex, and other clients listed by the
[Agent Plugins project](https://agent-plugins.org/compatible-clients). Component support varies by
client; ARC-1 uses the two portable 1.0 components, Agent Skills and stdio MCP.

## Choose The Package For Your Client

| Package | Best fit | Configuration experience |
|---|---|---|
| **Agent Plugin** | Copilot, VS Code, Cursor, Codex, and other Agent Plugins clients | Server + skills; put ARC-1 configuration in the client-managed plugin data directory |
| **Claude Code plugin** | Claude Code | Server + skills; Claude prompts for settings and stores the password in the OS keychain |
| **Claude Desktop `.mcpb`** | Claude Desktop | Bundled server; Desktop shows a configuration form |

The Agent Plugin is a directory/repository format, not another `.mcpb`-style archive. Installation
and marketplace distribution are managed by each compatible client.

## Install

Local stdio use requires Node.js 22.19 or newer with `npx` on the executable path. The MCP entry
uses `arc-1@latest` explicitly so an obsolete globally installed `arc-1` command cannot shadow the
current npm release.

### GitHub Copilot CLI

ARC-1's repository is also a single-plugin marketplace:

```bash
copilot plugin marketplace add arc-mcp/arc-1
copilot plugin install arc-1@arc-1
copilot plugin list
```

The same installed plugin is discovered by current VS Code releases. In VS Code, you can instead
run **Chat: Install Plugin From Source** and enter:

```text
https://github.com/arc-mcp/arc-1
```

In Cursor, install the repository as an Agent Plugin from **Customize**, a team marketplace, or the
[documented local plugin directory](https://cursor.com/docs/plugins#test-plugins-locally).

## Configure The Portable MCP Server

Agent Plugins 1.0 does not define a portable password prompt, OAuth declaration, or credential
reference. ARC-1 therefore keeps credentials out of `mcp.json` and starts the server with the
client-provided `${PLUGIN_DATA}` directory as its working directory. That directory persists across
plugin updates, and ARC-1 loads its `.env` file on startup.

1. Find the installed plugin's persistent data directory. With Copilot CLI:

   ```bash
   copilot mcp get arc-1 --json --show-secrets
   ```

   Read `env.PLUGIN_DATA` from the result. (`cwd` retains the portable `${PLUGIN_DATA}` token in
   Copilot's diagnostic output.) VS Code automatically discovers the same Copilot CLI installation.
   For a separate VS Code or Cursor installation, use that client's MCP diagnostics to locate the
   `PLUGIN_DATA` directory supplied to the ARC-1 process.

2. Create `<PLUGIN_DATA>/.env` with the connection and safety policy for this installation:

   ```dotenv
   SAP_URL=https://your-sap-host:44300
   SAP_USER=YOUR_USER
   SAP_PASSWORD=YOUR_PASSWORD
   SAP_CLIENT=100
   SAP_LANGUAGE=EN
   SAP_INSECURE=false

   # Mutations and sensitive reads remain off unless explicitly enabled.
   SAP_ALLOW_WRITES=false
   SAP_ALLOW_DATA_PREVIEW=false
   SAP_ALLOW_FREE_SQL=false
   ```

3. Restrict the file to your account where the operating system supports it, then restart or
   toggle the plugin's MCP server:

   ```bash
   chmod 600 <PLUGIN_DATA>/.env
   ```

Do not put credentials in `plugin.json`, `mcp.json`, a committed workspace file, or the installed
plugin root. The root may be replaced during an update; `${PLUGIN_DATA}` is the standardized
writable, persistent location. See [Configuration](configuration-reference.md) for SSO cookies,
BTP service keys, feature gates, and the complete safety surface.

!!! note "Hosted or cloud-agent ARC-1"
    If your client should use a centrally hosted ARC-1 endpoint, disable or override the plugin's
    local `arc-1` server with the client's native MCP configuration and keep using the bundled
    skills. For Copilot cloud agent, configure the remote or repository-level MCP connection with
    GitHub Agents secrets/variables and ensure the runner can reach SAP; a local laptop `.env`
    cannot travel to the cloud agent.

## Verify

For Copilot CLI, these commands should show versioned plugin metadata, 22 skills, and one local
`arc-1` MCP server:

```bash
copilot plugin list
copilot mcp list
copilot mcp get arc-1
```

ARC-1 is read-only by default. A successful install does not grant SAP permissions and does not
enable writes, table-data preview, free SQL, transport mutations, or Git mutations. Those remain
controlled by ARC-1's server-side settings and the connected SAP user's authorizations.

## Updating And Removing

```bash
copilot plugin update arc-1
copilot plugin uninstall arc-1
```

Clients preserve `${PLUGIN_DATA}` across updates and may remove it on uninstall. Back up the local
`.env` before uninstalling if you intend to reinstall with the same settings.
