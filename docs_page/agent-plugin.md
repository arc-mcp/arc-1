# Install the Agent Plugin

Install the ARC-1 server and SAP workflow skills together in an Agent Plugins-compatible client.
For Claude, use [Install in Claude](install-in-claude.md).

You need Node.js **22.19 or newer**, `npx` on the client's executable path, and a SAP system your
computer can reach. The plugin launches `npx -y arc-1@latest`.

## Install

### GitHub Copilot CLI

```bash
copilot plugin marketplace add arc-mcp/arc-1
copilot plugin install arc-1@arc-1
copilot plugin list
```

VS Code can discover the same Copilot CLI installation.

### VS Code

Run **Chat: Install Plugin From Source** and enter:

```text
https://github.com/arc-mcp/arc-1
```

### Cursor and other clients

In Cursor, install the repository from **Customize**, a team marketplace, or its
[local plugin directory](https://cursor.com/docs/plugins#test-plugins-locally).
Other clients use their own plugin installation flow. Check the
[Agent Plugins compatibility list](https://agent-plugins.org/compatible-clients); support for
skills and MCP components varies by client.

## Configure the SAP connection

The client gives the plugin a persistent `${PLUGIN_DATA}` directory. ARC-1 starts there and reads
its `.env` file. This directory survives plugin updates.

1. Find the data directory. In Copilot CLI:

   ```bash
   copilot mcp get arc-1 --json --show-secrets
   ```

   Read `env.PLUGIN_DATA`. Treat this diagnostic output as sensitive. For a separate VS Code or
   Cursor installation, find the process's `PLUGIN_DATA` value in the client's MCP diagnostics.

2. Create `.env` in that directory:

   ```dotenv
   SAP_URL=https://your-sap-host:44300
   SAP_USER=YOUR_USER
   SAP_PASSWORD=YOUR_PASSWORD
   SAP_CLIENT=100
   SAP_LANGUAGE=EN
   SAP_INSECURE=false
   SAP_ALLOW_WRITES=false
   SAP_ALLOW_DATA_PREVIEW=false
   SAP_ALLOW_FREE_SQL=false
   ```

3. Restrict access to the file, then restart the plugin's MCP server. On macOS/Linux, replace the
   example path with the data directory:

   ```bash
   chmod 600 /absolute/plugin-data/.env
   ```

Keep credentials in the data directory, outside the installed plugin files and version control.
See [Configuration](configuration-reference.md) for cookie authentication, BTP service keys, and
capability settings.

### Connect to a hosted server

If your administrator supplies an ARC-1 URL, disable or override the plugin's local server in the
client's MCP configuration. The bundled skills can use the hosted connection. For a Copilot cloud
agent, configure MCP and secrets in GitHub Agents and ensure its runner can reach the endpoint.
Your computer's `.env` does not configure the cloud runner.

## Verify the connection

1. Check that the client lists the plugin, its skills, and one ARC-1 MCP server. In Copilot CLI:

   ```bash
   copilot plugin list
   copilot mcp list
   copilot mcp get arc-1
   ```

2. Ask the client to call `SAPRead(type="SYSTEM")`. Verify the returned SAP system and client.
   A successful MCP handshake alone does not prove SAP access.

3. Start a [read workflow](mcp-usage.md). Writes, table data, and SQL remain controlled by the server
   policy and the SAP user's authorizations.

| Symptom | Check |
|---|---|
| Plugin missing | Installation path, enablement, and whether the client needs a reload |
| Skills appear, server missing | Node.js/`npx` on the IDE path; MCP process-launch output |
| Server starts, SAP calls fail | Data-directory `.env`, network/TLS, credentials, and SAP authorization |
| Duplicate tools or unexpected server | Disable the manually configured ARC-1 server and inspect the plugin server's launch command |

The first startup can take longer while npm downloads the package.

## Update or remove

```bash
copilot plugin update arc-1
copilot plugin uninstall arc-1
```

Back up `.env` before uninstalling if you need those settings again. Clients may remove the data
directory on uninstall.

## Test a local plugin checkout

Use this to test plugin metadata and bundled skills from a branch. The MCP entry still launches
the published `arc-1@latest` server; it does not run the branch's TypeScript source.

### VS Code

Add to user or workspace settings, then run **Developer: Reload Window**:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/to/arc-1": true
  }
}
```

Open **Chat: Open Customizations** → **Plugins** and **MCP: List Servers**. Check the version against
root `plugin.json`, the bundled skills, and the plugin-supplied `arc-1` server.

### Cursor

Inspect any existing path before creating the link:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/arc-1 ~/.cursor/plugins/local/arc-1
```

Reload Cursor and check **Customize** → **Plugins**, **Skills**, and **MCP Servers**.
After testing, remove the VS Code settings entry or the symlink:

```bash
unlink ~/.cursor/plugins/local/arc-1
```

The portable package uses root `plugin.json` for metadata, `mcp.json` for the stdio server, and
`skills/` for workflows. It follows [Agent Plugins 1.0](https://agent-plugins.org/).
