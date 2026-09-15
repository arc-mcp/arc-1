# Quickstart

Connect an assistant to one SAP development system and read an ABAP object.
This guide uses a local ARC-1 process with your SAP username and password.
For a team server, use [Deployment](deployment.md); for BTP ABAP, use
[service-key login](btp-abap-environment.md).

## Prerequisites

- Node.js **22.19 or later**.
- Network access to your SAP system's ADT HTTPS endpoint.
- An SAP user and password with ADT read authorization.

## 1. Configure your client

Your client starts ARC-1 and passes it the SAP connection settings. Replace the four example values
below. Use a private user configuration for credentials; do not commit a file containing your password.

=== "Claude Code"

    Add this server to the `mcpServers` object in your user configuration, `~/.claude.json`:

    ```json
    {
      "mcpServers": {
        "sap": {
          "command": "npx",
          "args": ["-y", "arc-1@latest"],
          "env": {
            "SAP_URL": "https://your-sap-host",
            "SAP_USER": "YOUR_USER",
            "SAP_PASSWORD": "YOUR_PASSWORD",
            "SAP_CLIENT": "100"
          }
        }
      }
    }
    ```

    Restart Claude Code and check the server with `/mcp`.
    For the plugin or Claude Desktop, follow [Install in Claude](install-in-claude.md).

=== "GitHub Copilot / VS Code"

    Run **MCP: Open User Configuration** from the Command Palette and add this server:

    ```json
    {
      "servers": {
        "sap": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "arc-1@latest"],
          "env": {
            "SAP_URL": "https://your-sap-host",
            "SAP_USER": "YOUR_USER",
            "SAP_PASSWORD": "YOUR_PASSWORD",
            "SAP_CLIENT": "100"
          }
        }
      }
    }
    ```

    Use **MCP: List Servers** to start `sap`, then open Copilot Chat in **Agent** mode.

=== "GitHub Copilot / Eclipse"

    Open the GitHub Copilot preferences and select **MCP**. Add the `servers` configuration
    from the VS Code tab, then choose **Apply and Close**. Open Copilot Chat in **Agent** mode.

For other clients, configure a stdio server that launches `npx -y arc-1@latest` with the same
four environment variables. The JSON wrapper depends on the client.

<a id="1-verify-arc-1-can-reach-your-sap"></a>
<a id="2-wire-it-into-your-mcp-client"></a>
<a id="3-try-a-read"></a>

## 2. Verify a read

In your assistant, ask:

> Using SAPSearch, find ABAP classes whose names start with `ZCL_`. Do not change anything.

A successful tool result, even an empty list, confirms the connection. If a class is returned, ask
for its source by name. A startup message alone does not verify this read.

## If the connection fails

| Symptom | Check |
| --- | --- |
| ARC-1 cannot start | Run `node --version`; confirm `npx` is on the client's PATH. |
| Cannot reach SAP | Check the HTTPS URL, VPN, proxy, and ADT service availability with your SAP administrator. |
| Authentication fails | Check the client number and ADT credentials. A browser or SAP GUI login alone does not prove ADT access. |
| Certificate error | Use the trusted HTTPS endpoint or configure the required CA certificate. For a self-signed development system only, `SAP_INSECURE=true` disables verification. |
| SAP returns an HTML login page | Follow the [local SSO cookie procedure](local-development.md#sso-only-on-prem-cookie-extractor). |

<a id="if-direct-adt-https-is-not-reachable"></a>

If Eclipse can connect only through RFC/SAProuter, see the
[local ADT-to-RFC bridge option](enterprise-auth.md#3-local-adt-to-rfc-bridge-local-rfcsaprouter-workaround).

<a id="what-you-just-got-read-only-by-default"></a>
<a id="enabling-writes-sql-and-data-preview"></a>

## Next steps

This setup leaves writes, table preview, SQL, transport mutations, and Git mutations disabled.
To enable a capability, use the [permission requirements](authorization.md#capability-requirements)
and add the required settings to the same server `env` block.

- [Example workflows](mcp-usage.md) for a connected assistant.
- [Local development](local-development.md) for `.env`, SSO, or running ARC-1 from source.
- [Configuration](configuration-reference.md) for all settings.
